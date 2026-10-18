import { createHash } from "node:crypto";
import { CONTRACT_VERSION } from "@friday/sdk";
import type { Handler } from "../http/context";
import type { OperationId } from "../http/route-types";
import { stableUserId } from "../security/auth-service";
import type { HimalayaAccountService } from "../services/himalaya-account";
import type { HimalayaSendRequest } from "../services/himalaya-send";
import { conflict, forbidden, validationFailed } from "../util/errors";

type VoiceMailRequest = {
  action: "compose" | "reply" | "move" | "flag";
  mailbox?: string; id?: string; destination?: string;
  to?: string[]; subject?: string; body?: string;
};
type Canonical = {
  action: VoiceMailRequest["action"]; to: string[]; subject: string; body: string;
  mailbox: string; id: string; destination: string;
  inReplyTo: string; references: string; source: string;
  accountRevision: number;
};
const address = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
const messageId = /^<[^<>\s@]+@[^<>\s@]+>$/;
const ownerId = stableUserId("owner");
const single = <T>(data: T) => ({ contractVersion: CONTRACT_VERSION, data, freshness: { state: "fresh" as const, asOf: new Date().toISOString() } });
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function assertVoice(ctx: Parameters<Handler>[0]): void {
  if (!ctx.voiceBridgeAuthorized || !ctx.runtime.auth.ownerPasswordConfigured() ||
      ctx.runtime.auth.devMode && ctx.runtime.config.server.allowRemote) {
    throw forbidden("E-Mail-Sprachaktionen erfordern den lokalen Voice-Dienst und ein Besitzerkonto.");
  }
}

function oneAddress(header: string): string {
  const value = header.trim();
  const candidate = value.includes("<") ? /^([^<>]*)<([^<>]+)>$/.exec(value)?.[2]?.trim() : value;
  if (!candidate || !address.test(candidate) || value.includes("\n") || value.includes("\r")) {
    throw conflict("Antwortadresse ist nicht eindeutig. Bitte im Dashboard antworten.");
  }
  return candidate;
}

async function canonical(account: HimalayaAccountService, request: VoiceMailRequest): Promise<Canonical> {
  const status = await account.status();
  if (!status.readyForLocalUse || !Number.isSafeInteger(status.revision)) throw conflict("Das eingerichtete Postfach ist nicht verfuegbar.");
  const common = { action: request.action, to: [] as string[], subject: "", body: "", mailbox: "", id: "",
    destination: "", inReplyTo: "", references: "", source: "", accountRevision: status.revision };
  if (request.action === "compose") {
    if (!request.to || !request.subject || !request.body || request.mailbox || request.id || request.destination) throw validationFailed("E-Mail-Entwurf ist unvollstaendig.");
    if (!request.to.every((value) => address.test(value))) throw validationFailed("Empfaengeradresse ist ungueltig.");
    return { ...common, to: request.to, subject: request.subject, body: request.body };
  }
  if (!request.mailbox || !request.id || request.to || request.subject) throw validationFailed("Nachrichtenauswahl fehlt.");
  const message = await account.message(request.mailbox, request.id);
  const source = hash([message.mailbox, message.id, message.subject, message.from, message.date, message.messageId]);
  const base = { ...common, mailbox: request.mailbox, id: request.id, source,
    subject: String(message.subject || ""), body: request.body || "" };
  if (request.action === "reply") {
    if (!request.body || request.destination) throw validationFailed("Antworttext fehlt.");
    const to = oneAddress(String(message.replyTo || message.from || ""));
    const originalId = String(message.messageId || "").trim();
    if (originalId && !messageId.test(originalId)) throw conflict("Nachrichtenkennung ist ungueltig. Bitte im Dashboard antworten.");
    const oldReferences = String(message.references || "").trim();
    const references = [oldReferences, originalId].filter(Boolean).join(" ");
    if (references.length > 2000) throw conflict("Antwortverlauf ist zu lang. Bitte im Dashboard antworten.");
    if (oldReferences && !oldReferences.split(/\s+/).every((value) => messageId.test(value))) throw conflict("Antwortverlauf ist ungueltig. Bitte im Dashboard antworten.");
    return { ...base, to: [to], subject: /^re\s*:/i.test(base.subject) ? base.subject : `Re: ${base.subject}`,
      inReplyTo: originalId, references };
  }
  if (request.body) throw validationFailed("Bei Sortieraktionen ist kein Nachrichtentext zulaessig.");
  if (request.action === "move") {
    if (!request.destination || request.destination === request.mailbox) throw validationFailed("Zielordner fehlt.");
    const folders = await account.mailboxes();
    if (!folders.mailboxes.some((folder) => folder.id === request.destination)) throw validationFailed("Zielordner existiert nicht.");
    return { ...base, destination: request.destination };
  }
  if (request.action !== "flag" || request.destination) throw validationFailed("Ungueltige Mailaktion.");
  return base;
}

export const voiceMailHandlers: Partial<Record<OperationId, Handler>> = {
  async previewVoiceMail(ctx) {
    assertVoice(ctx);
    const request = ctx.body as VoiceMailRequest;
    const detail = await canonical(ctx.runtime.himalayaAccount, request);
    const fingerprint = hash([request, detail]);
    const { token, claims } = ctx.runtime.approvalTokens.issue({ approvalId: fingerprint, userId: ownerId, action: `mail.voice.${request.action}` });
    const { action, to, subject, body, mailbox, id, destination } = detail;
    return { status: 200, body: single({ token, expiresAt: new Date(claims.expiresAt).toISOString(), fingerprint,
      action, to, subject, body, mailbox, id, destination }) };
  },
  async confirmVoiceMail(ctx) {
    assertVoice(ctx);
    if (!ctx.idempotencyKey) throw validationFailed("Idempotency-Key ist fuer Sprachaktionen erforderlich.");
    const { request, token, fingerprint } = ctx.body as { request: VoiceMailRequest; token: string; fingerprint: string };
    const detail = await canonical(ctx.runtime.himalayaAccount, request);
    if (hash([request, detail]) !== fingerprint) throw conflict("Die E-Mail wurde veraendert. Bitte erneut vorlesen lassen.");
    const valid = ctx.runtime.approvalTokens.consume(token, { approvalId: fingerprint, userId: ownerId, action: `mail.voice.${request.action}` });
    if (!valid.ok) throw conflict("Die E-Mail-Bestaetigung ist abgelaufen oder bereits verwendet.");
    let state: "sent" | "changed" | "unknown";
    let replayed = false;
    if (request.action === "compose" || request.action === "reply") {
      const outgoing: HimalayaSendRequest = { to: detail.to, subject: detail.subject, body: detail.body,
        ...(detail.inReplyTo ? { inReplyTo: detail.inReplyTo } : {}), ...(detail.references ? { references: detail.references } : {}) };
      const outcome = await ctx.runtime.himalayaSend.send(outgoing, "friday-voice", ctx.idempotencyKey);
      state = outcome.state;
      replayed = outcome.replayed;
    } else {
      try { await ctx.runtime.himalayaAccount.changeMessage({ action: request.action, mailbox: detail.mailbox,
        id: detail.id, ...(detail.destination ? { destination: detail.destination } : {}) }); state = "changed"; }
      catch { state = "unknown"; }
    }
    ctx.audit.action = `communication.himalaya_voice_${request.action}`;
    ctx.audit.severity = "warning";
    ctx.audit.after = { action: request.action, state, replayed };
    return { status: 200, body: single({ state, replayed }), headers: { "Idempotent-Replayed": String(replayed) } };
  },
};
