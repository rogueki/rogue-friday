import { CONTRACT_VERSION } from "@friday/sdk";
import { createHash } from "node:crypto";
import type { Handler, RequestContext } from "../http/context";
import type { OperationId } from "../http/route-types";
import type { MailAccountInput, MailSecrets } from "../services/mail-accounts";
import { checkedMailSend, type MailSendRequest } from "../services/mail-send";
import type { NativeExecutableAction } from "../services/native-approval-requests";
import { ApiError, conflict, forbidden, validationFailed } from "../util/errors";
import { captureMailSend } from "./mail-memory";
import { MailOAuthService } from "../services/mail-oauth";
import type { Runtime } from "../runtime/types";

const single = <T>(data: T) => ({ contractVersion: CONTRACT_VERSION, data,
  freshness: { state: "fresh" as const, asOf: new Date().toISOString() } });
const accountId = (ctx: Parameters<Handler>[0]) => ctx.pathParams.accountId ?? "";
const oauth = new WeakMap<Runtime, MailOAuthService>();
function mailOAuth(runtime: Runtime): MailOAuthService {
  let service = oauth.get(runtime);
  if (!service) { service = new MailOAuthService(runtime.mailAccounts, runtime.config.server.port); oauth.set(runtime, service); }
  return service;
}
function assertLocalVoiceRead(ctx: Parameters<Handler>[0]): void {
  if (ctx.voiceBridgeAuthorized && !ctx.runtime.auth.ownerPasswordConfigured())
    throw forbidden("Besitzerkonto für lokalen Mailabruf fehlt.");
}
function revision(ctx: Parameters<Handler>[0]): number {
  const value = ctx.mutation.ifMatchVersion;
  if (value === undefined) throw validationFailed("If-Match mit aktueller Kontorevision ist erforderlich.");
  return value;
}
function write(ctx: Parameters<Handler>[0]): { account: MailAccountInput; secrets: MailSecrets } {
  const { secrets = {}, ...account } = ctx.body as MailAccountInput & { secrets?: MailSecrets };
  return { account, secrets };
}

const PREVIEW_ID = /^corr_[0-9A-Za-z]{26}$/;

interface MailWrite {
  action: Extract<NativeExecutableAction, { kind: "mail.send" | "mail.change" }>;
  actionText: string;
  previewTitle: string;
  previewText: string;
}

/**
 * Stages the exact mail write as a draft, binds confirmation to the unchanged action and either hands it to the
 * tier-2 approval flow or lets the caller execute it once. Throws for every non-executable stage.
 */
function enforceMailWrite(ctx: RequestContext, ownerId: string, write: MailWrite): string {
  const confirmedPreviewId = ctx.headers["x-action-preview-id"];
  if (confirmedPreviewId !== undefined && !PREVIEW_ID.test(confirmedPreviewId)) {
    throw validationFailed("Die Vorschaukennung ist ungueltig.", [{ path: "X-Action-Preview-Id", message: "ungueltig" }]);
  }
  if (!confirmedPreviewId) {
    const previewId = ctx.correlationId;
    ctx.runtime.nativeApprovals.propose({ ownerId, requestKey: previewId, correlationId: ctx.correlationId,
      riskTier: 2, type: "system_change", action: write.actionText,
      rationale: "E-Mail aus bestaetigter API-Anfrage", preview: { kind: "text", title: write.previewTitle,
        body: JSON.stringify(write.action) }, impacts: [], execution: write.action });
    throw new ApiError({ code: "APPROVAL_REQUIRED", message: "E-Mail zuerst mit unveraenderter Vorschau bestaetigen.",
      details: { stage: "preview", previewId, previewText: write.previewText } });
  }
  const policy = ctx.runtime.nativeApprovals.confirm(ownerId, confirmedPreviewId, write.action);
  if (policy.approval) {
    throw new ApiError({ code: "APPROVAL_REQUIRED", message: "E-Mail wartet auf Freigabe.",
      details: { stage: "approval", approvalId: policy.approval.id,
        targetRoute: `/approvals?approval=${policy.approval.id}` } });
  }
  return confirmedPreviewId;
}

/** The journal key of a staged mail write; stable across confirmation, approval and replay of the same draft. */
export const mailJournalKey = (ownerId: string, previewId: string) => `native-action:${ownerId}:${previewId}`;

/** Dispatches the stored mail write once; the send journal keeps SMTP at-most-once and uncertain forever. */
async function executeMailWrite(ctx: RequestContext, ownerId: string, previewId: string): Promise<string> {
  return ctx.runtime.nativeApprovals.executeWithoutApproval(ownerId, previewId, async (savedAction, idempotencyKey) => {
    if (savedAction.kind === "mail.send") {
      await ctx.runtime.mailSend.send(savedAction.accountId, savedAction.body, ownerId, idempotencyKey);
      return ctx.runtime.mailSend.receipt(savedAction.accountId, ownerId, idempotencyKey).receiptId;
    }
    if (savedAction.kind === "mail.change") {
      await ctx.runtime.mailAccounts.change(savedAction.accountId, savedAction.mailbox, savedAction.uid,
        savedAction.uidValidity, savedAction.change, savedAction.destination);
      return `${savedAction.mailbox}:${savedAction.uid}`;
    }
    throw conflict("Die Bestaetigung passt nicht zum gespeicherten Entwurf.");
  });
}

/** Account must exist before anything is staged; the runner reports an unknown account as a runner error. */
async function requireMailAccount(ctx: RequestContext, accountId: string): Promise<void> {
  const catalog = await ctx.runtime.mailAccounts.list();
  if (!catalog.accounts.some((item) => item.id === accountId)) throw validationFailed("Mail Postfach existiert nicht.");
}

export const mailAccountHandlers: Partial<Record<OperationId, Handler>> = {
  async listMailAccounts(ctx) { assertLocalVoiceRead(ctx); return { status: 200, body: single(await ctx.runtime.mailAccounts.list()) }; },
  async createMailAccount(ctx) {
    const { account, secrets } = write(ctx);
    const result = await ctx.runtime.mailAccounts.upsert(account, secrets, null);
    ctx.audit.action = "mail.account_created";
    ctx.audit.after = { accountId: result.id };
    return { status: 200, body: single(result) };
  },
  async updateMailAccount(ctx) {
    const { account, secrets } = write(ctx);
    const result = await ctx.runtime.mailAccounts.upsert({ ...account, id: accountId(ctx) }, secrets, revision(ctx));
    ctx.audit.action = "mail.account_updated";
    ctx.audit.after = { accountId: result.id, revision: result.revision };
    return { status: 200, body: single(result) };
  },
  async deleteMailAccount(ctx) {
    const result = await ctx.runtime.mailAccounts.remove(accountId(ctx), revision(ctx));
    ctx.audit.action = "mail.account_removed";
    ctx.audit.after = { accountId: accountId(ctx) };
    return { status: 200, body: single(result) };
  },
  async setDefaultMailAccount(ctx) {
    const result = await ctx.runtime.mailAccounts.setDefault(accountId(ctx), revision(ctx));
    ctx.audit.action = "mail.default_changed";
    ctx.audit.after = { accountId: accountId(ctx) };
    return { status: 200, body: single(result) };
  },
  async checkMailAccount(ctx) {
    const protocol = ctx.query.protocol;
    if (protocol !== "imap" && protocol !== "smtp") throw validationFailed("IMAP oder SMTP auswählen.");
    const result = await ctx.runtime.mailAccounts.check(accountId(ctx), protocol);
    ctx.audit.action = "mail.account_checked";
    ctx.audit.after = { accountId: accountId(ctx), protocol, ok: result.ok };
    return { status: 200, body: single(result) };
  },
  async startMailOAuth(ctx) {
    const result = await mailOAuth(ctx.runtime).start(accountId(ctx), ctx.principal!.userId);
    ctx.audit.action = "mail.oauth_started";
    ctx.audit.after = { accountId: accountId(ctx) };
    return { status: 200, body: single(result) };
  },
  async pollMailOAuth(ctx) {
    const { flowId } = ctx.body as { flowId: string };
    const result = await mailOAuth(ctx.runtime).microsoftPoll(flowId, ctx.principal!.userId, accountId(ctx));
    ctx.audit.action = "mail.oauth_polled";
    ctx.audit.after = { accountId: result.accountId, authorized: result.authorized };
    return { status: 200, body: single(result) };
  },
  async completeGoogleMailOAuth(ctx) {
    const result = await mailOAuth(ctx.runtime).googleCallback(String(ctx.query.state), String(ctx.query.code), ctx.ip);
    ctx.audit.action = "mail.oauth_connected";
    ctx.audit.after = { accountId: result.accountId };
    return { status: 200, body: single({ ...result, pending: false }) };
  },
  async revokeMailOAuth(ctx) {
    const result = await ctx.runtime.mailAccounts.revokeOAuth(accountId(ctx), revision(ctx));
    ctx.audit.action = "mail.oauth_local_revoked";
    ctx.audit.after = { accountId: result.id };
    return { status: 200, body: single(result) };
  },
  async listMailFolders(ctx) { assertLocalVoiceRead(ctx); return { status: 200, body: single(await ctx.runtime.mailAccounts.folders(accountId(ctx))) }; },
  async listMailEnvelopes(ctx) {
    assertLocalVoiceRead(ctx);
    return { status: 200, body: single(await ctx.runtime.mailAccounts.envelopes(accountId(ctx), String(ctx.query.mailbox), Number(ctx.query.page ?? 1))) };
  },
  async searchMailEnvelopes(ctx) {
    assertLocalVoiceRead(ctx);
    return { status: 200, body: single(await ctx.runtime.mailAccounts.search(accountId(ctx), String(ctx.query.mailbox),
      String(ctx.query.q), Number(ctx.query.page ?? 1))) };
  },
  async getMailMessage(ctx) {
    assertLocalVoiceRead(ctx);
    return { status: 200, body: single(await ctx.runtime.mailAccounts.message(accountId(ctx), String(ctx.query.mailbox), String(ctx.query.uid), String(ctx.query.uidValidity))) };
  },
  async getMailAttachment(ctx) {
    return { status: 200, body: single(await ctx.runtime.mailAccounts.attachment(accountId(ctx), String(ctx.query.mailbox),
      String(ctx.query.uid), String(ctx.query.uidValidity), Number(ctx.query.index))) };
  },
  async changeMailMessage(ctx) {
    const ownerId = ctx.principal?.userId;
    if (!ownerId) throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung erforderlich." });
    const account = accountId(ctx);
    const request = ctx.body as { mailbox: string; uid: string; uidValidity: string; kind: "move" | "flag"; destination?: string };
    if (request.kind === "move" && (!request.destination || request.destination === request.mailbox))
      throw validationFailed("Zielordner fehlt.");
    // An unknown mailbox account fails before any preview is staged; folder/message staleness is the runner's 409.
    if (!ctx.headers["x-action-preview-id"]) await requireMailAccount(ctx, account);
    const write: MailWrite = {
      action: { kind: "mail.change", accountId: account, mailbox: request.mailbox, uid: request.uid,
        uidValidity: request.uidValidity, change: request.kind,
        ...(request.destination ? { destination: request.destination } : {}) },
      actionText: request.kind === "move" ? `Mail verschieben: ${request.mailbox}/${request.uid}` : `Mail markieren: ${request.mailbox}/${request.uid}`,
      previewTitle: request.kind === "move" ? "E-Mail verschieben" : "E-Mail markieren",
      previewText: request.kind === "move"
        ? `E-Mail aus „${request.mailbox}“ nach „${request.destination}“ verschieben?`
        : `E-Mail in „${request.mailbox}“ markieren?` };
    const previewId = enforceMailWrite(ctx, ownerId, write);
    const replayed = ctx.runtime.nativeApprovals.stateOf(ownerId, previewId) === "completed";
    await executeMailWrite(ctx, ownerId, previewId);
    ctx.audit.action = `mail.${request.kind}`;
    ctx.audit.after = { accountId: account, mailbox: request.mailbox, uid: request.uid, replayed };
    return { status: 200, body: single({ changed: true }), headers: { "Idempotent-Replayed": String(replayed) } };
  },
  async sendMailMessage(ctx) {
    const ownerId = ctx.principal?.userId;
    if (!ownerId) throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung erforderlich." });
    const account = accountId(ctx);
    const body = checkedMailSend(ctx.body as MailSendRequest);
    // Invalid content, an unknown mailbox or a foreign sender fails before any preview is staged.
    if (!ctx.headers["x-action-preview-id"]) await ctx.runtime.mailSend.checkSendable(account, body);
    const write: MailWrite = {
      action: { kind: "mail.send", accountId: account, body },
      actionText: `Mail senden: ${body.subject}`,
      previewTitle: "E-Mail senden",
      previewText: `E-Mail an ${body.to.join(", ")} senden? Betreff: „${body.subject}“` };
    const previewId = enforceMailWrite(ctx, ownerId, write);
    const journalKey = mailJournalKey(ownerId, previewId);
    const replayed = ctx.runtime.nativeApprovals.stateOf(ownerId, previewId) === "completed";
    const receiptId = await executeMailWrite(ctx, ownerId, previewId);
    const outcome = ctx.runtime.mailSend.outcomeFor(account, receiptId) ?? { state: "uncertain" as const, archivePending: false };
    const memoryCapture = captureMailSend(ctx, account, ownerId, ownerId, "dashboard", outcome.state, journalKey);
    ctx.audit.action = "mail.sent";
    ctx.audit.severity = "warning";
    ctx.audit.after = { accountId: account, state: outcome.state, archivePending: outcome.archivePending, replayed, memoryCapture };
    return { status: 200, body: single({ ...outcome, replayed, receiptId, memoryCapture }),
      headers: { "Idempotent-Replayed": String(replayed) } };
  },
  async saveMailDraft(ctx) {
    const key = ctx.idempotencyKey;
    if (!key || key.length < 8 || key.length > 128) throw validationFailed("Idempotency-Key für Entwurf erforderlich.");
    const messageId = `<friday-${createHash("sha256").update(JSON.stringify([ctx.principal!.userId, accountId(ctx), key])).digest("hex")}@friday.local>`;
    const result = await ctx.runtime.mailAccounts.draft(accountId(ctx), { ...(ctx.body as object), messageId });
    ctx.audit.action = "mail.draft_saved";
    ctx.audit.after = { accountId: accountId(ctx), alreadyPresent: result.alreadyPresent };
    return { status: 200, body: single(result) };
  },
  async listMailReceipts(ctx) {
    return { status: 200, body: single({ items: ctx.runtime.mailSend.receipts(accountId(ctx)) }) };
  },
  async reviewMailReceipt(ctx) {
    const result = await ctx.runtime.mailSend.review(accountId(ctx), ctx.pathParams.receiptId ?? "");
    ctx.audit.action = "mail.receipt_reviewed";
    ctx.audit.after = { accountId: accountId(ctx), receiptId: result.receiptId, state: result.state };
    return { status: 200, body: single(result) };
  },
  async reconcileMailArchive(ctx) {
    const result = await ctx.runtime.mailSend.reconcileArchive(accountId(ctx), ctx.pathParams.receiptId ?? "", ctx.body as MailSendRequest);
    ctx.audit.action = "mail.sent_copy_reconciled";
    ctx.audit.after = { accountId: accountId(ctx), receiptId: result.receiptId, archivePending: result.archivePending };
    return { status: 200, body: single(result) };
  },
};
