import { createHash } from "node:crypto";
import { CONTRACT_VERSION } from "@friday/sdk";
import type { Handler } from "../http/context";
import type { OperationId } from "../http/route-types";
import { stableUserId } from "../security/auth-service";
import type { MailAccountsService } from "../services/mail-accounts";
import { conflict, forbidden, validationFailed } from "../util/errors";
import { captureMailSend } from "./mail-memory";

type VoiceMailRequest = {
  action: "compose" | "reply" | "move" | "flag";
  accountId?: string; mailbox?: string; id?: string; uidValidity?: string; destination?: string;
  to?: string[]; subject?: string; body?: string;
};
type Canonical = {
  action: VoiceMailRequest["action"]; accountId: string; accountName: string; accountRevision: number;
  to: string[]; subject: string; body: string; mailbox: string; id: string; uidValidity: string;
  destination: string; inReplyTo: string; references: string; source: string;
};
const address = /^[A-Za-z0-9.!#$%&'*+/=?^_\x60{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
const messageId = /^<[^<>\s@]+@[^<>\s@]+>$/;
const ownerId = stableUserId("owner");
const single = <T>(data: T) => ({ contractVersion: CONTRACT_VERSION, data, freshness: { state: "fresh" as const, asOf: new Date().toISOString() } });
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function assertVoice(ctx: Parameters<Handler>[0]): void {
  if (!ctx.voiceBridgeAuthorized || !ctx.runtime.auth.ownerPasswordConfigured() ||
      ctx.runtime.auth.devMode && ctx.runtime.config.server.allowRemote)
    throw forbidden("E-Mail-Sprachaktionen erfordern den lokalen Voice-Dienst und ein Besitzerkonto.");
}

function oneAddress(header: string): string {
  const value = header.trim();
  const candidate = value.includes("<") ? /^([^<>]*)<([^<>]+)>$/.exec(value)?.[2]?.trim() : value;
  if (!candidate || !address.test(candidate) || value.includes("\n") || value.includes("\r"))
    throw conflict("Antwortadresse ist nicht eindeutig. Bitte im Dashboard antworten.");
  return candidate;
}

async function canonical(service: MailAccountsService, request: VoiceMailRequest): Promise<Canonical> {
  const catalog = await service.list();
  const account = catalog.accounts.find((item) => item.id === (request.accountId ?? catalog.defaultAccountId));
  if (!account) throw conflict("Bitte zuerst ein Mail Postfach einrichten oder ein vorhandenes Konto eindeutig nennen.");
  if (!account.secretState.imapPassword || !account.secretState.smtpPassword)
    throw conflict("Das gewählte Mail Postfach benötigt IMAP- und SMTP-Zugangsdaten.");
  const common = { action: request.action, accountId: account.id, accountName: account.displayName,
    accountRevision: account.revision, to: [] as string[], subject: "", body: "", mailbox: "", id: "",
    uidValidity: "", destination: "", inReplyTo: "", references: "", source: "" };
  if (request.action === "compose") {
    if (!request.to || !request.subject || !request.body || request.mailbox || request.id || request.destination || request.uidValidity)
      throw validationFailed("E-Mail-Entwurf ist unvollständig.");
    if (!request.to.every((value) => address.test(value))) throw validationFailed("Empfängeradresse ist ungültig.");
    return { ...common, to: request.to, subject: request.subject, body: request.body };
  }
  if (!request.mailbox || !request.id || request.to || request.subject) throw validationFailed("Nachrichtenauswahl fehlt.");
  const selected = await service.envelopes(account.id, request.mailbox, 1);
  if (!selected.uidValidity || request.uidValidity && request.uidValidity !== selected.uidValidity)
    throw conflict("Die Ordnerkennung hat sich geändert. Bitte Mail erneut auswählen.");
  const data = await service.message(account.id, request.mailbox, request.id, selected.uidValidity);
  const message = data as Record<string, string>;
  const source = hash([account.id, account.revision, selected.uidValidity, request.mailbox, request.id,
    message.subject, message.from, message.date, message.messageId]);
  const base = { ...common, mailbox: request.mailbox, id: request.id, uidValidity: selected.uidValidity, source,
    subject: String(message.subject || ""), body: request.body || "" };
  if (request.action === "reply") {
    if (!request.body || request.destination) throw validationFailed("Antworttext fehlt.");
    const to = oneAddress(String(message.replyTo || message.from || ""));
    const originalId = String(message.messageId || "").trim();
    if (originalId && !messageId.test(originalId)) throw conflict("Nachrichtenkennung ist ungültig. Bitte im Dashboard antworten.");
    const oldReferences = String(message.references || "").trim();
    const references = [oldReferences, originalId].filter(Boolean).join(" ");
    if (references.length > 2000 || oldReferences && !oldReferences.split(/\s+/).every((value) => messageId.test(value)))
      throw conflict("Antwortverlauf ist ungültig. Bitte im Dashboard antworten.");
    return { ...base, to: [to], subject: /^re\s*:/i.test(base.subject) ? base.subject : "Re: " + base.subject,
      inReplyTo: originalId, references };
  }
  if (request.body) throw validationFailed("Bei Sortieraktionen ist kein Nachrichtentext zulässig.");
  if (request.action === "move") {
    if (!request.destination || request.destination === request.mailbox) throw validationFailed("Zielordner fehlt.");
    const folders = await service.folders(account.id);
    if (!folders.folders.some((folder) => folder.id === request.destination)) throw validationFailed("Zielordner existiert nicht.");
    return { ...base, destination: request.destination };
  }
  if (request.action !== "flag" || request.destination) throw validationFailed("Ungültige Mailaktion.");
  return base;
}

export const voiceMailHandlers: Partial<Record<OperationId, Handler>> = {
  async previewVoiceMail(ctx) {
    assertVoice(ctx);
    const request = ctx.body as VoiceMailRequest;
    const detail = await canonical(ctx.runtime.mailAccounts, request);
    const fingerprint = hash([request, detail]);
    const { token, claims } = ctx.runtime.approvalTokens.issue({ approvalId: fingerprint, userId: ownerId, action: "mail.voice." + request.action });
    const { action, accountId, accountName, to, subject, body, mailbox, id, destination } = detail;
    return { status: 200, body: single({ token, expiresAt: new Date(claims.expiresAt).toISOString(), fingerprint,
      action, accountId, accountName, to, subject, body, mailbox, id, destination }) };
  },
  async confirmVoiceMail(ctx) {
    assertVoice(ctx);
    if (!ctx.idempotencyKey) throw validationFailed("Idempotency-Key ist für Sprachaktionen erforderlich.");
    const { request, token, fingerprint } = ctx.body as { request: VoiceMailRequest; token: string; fingerprint: string };
    const detail = await canonical(ctx.runtime.mailAccounts, request);
    if (hash([request, detail]) !== fingerprint) throw conflict("Die E-Mail wurde verändert. Bitte erneut vorlesen lassen.");
    const valid = ctx.runtime.approvalTokens.consume(token, { approvalId: fingerprint, userId: ownerId, action: "mail.voice." + request.action });
    if (!valid.ok) throw conflict("Die E-Mail-Bestätigung ist abgelaufen oder bereits verwendet.");
    let state: "sent" | "changed" | "unknown";
    let replayed = false;
    let memoryCapture: string | null = null;
    if (request.action === "compose" || request.action === "reply") {
      const outcome = await ctx.runtime.mailSend.send(detail.accountId, { to: detail.to, subject: detail.subject, body: detail.body,
        ...(detail.inReplyTo ? { inReplyTo: detail.inReplyTo } : {}), ...(detail.references ? { references: detail.references } : {}) },
      "friday-voice", ctx.idempotencyKey);
      state = outcome.state === "uncertain" ? "unknown" : "sent";
      replayed = outcome.replayed;
      memoryCapture = captureMailSend(ctx, detail.accountId, "friday-voice", ownerId, "voice", outcome.state);
    } else {
      try { await ctx.runtime.mailAccounts.change(detail.accountId, detail.mailbox, detail.id, detail.uidValidity,
        request.action, detail.destination || undefined); state = "changed"; }
      catch { state = "unknown"; }
    }
    ctx.audit.action = "communication.mail_voice_" + request.action;
    ctx.audit.severity = "warning";
    ctx.audit.after = { accountId: detail.accountId, action: request.action, state, replayed, memoryCapture };
    return { status: 200, body: single({ state, replayed }), headers: { "Idempotent-Replayed": String(replayed) } };
  },
};
