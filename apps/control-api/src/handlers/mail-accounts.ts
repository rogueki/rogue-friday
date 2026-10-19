import { CONTRACT_VERSION } from "@friday/sdk";
import { createHash } from "node:crypto";
import type { Handler } from "../http/context";
import type { OperationId } from "../http/route-types";
import type { MailAccountInput, MailSecrets } from "../services/mail-accounts";
import type { MailSendRequest } from "../services/mail-send";
import { forbidden, validationFailed } from "../util/errors";
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
    const request = ctx.body as { mailbox: string; uid: string; uidValidity: string; kind: "move" | "flag"; destination?: string };
    const result = await ctx.runtime.mailAccounts.change(accountId(ctx), request.mailbox, request.uid, request.uidValidity, request.kind, request.destination);
    ctx.audit.action = `mail.${request.kind}`;
    ctx.audit.after = { accountId: accountId(ctx), mailbox: request.mailbox, uid: request.uid };
    return { status: 200, body: single(result) };
  },
  async sendMailMessage(ctx) {
    const result = await ctx.runtime.mailSend.send(accountId(ctx), ctx.body as MailSendRequest, ctx.principal!.userId, ctx.idempotencyKey ?? "");
    const memoryCapture = captureMailSend(ctx, accountId(ctx), ctx.principal!.userId, ctx.principal!.userId, "dashboard", result.state);
    const { receiptId } = ctx.runtime.mailSend.receipt(accountId(ctx), ctx.principal!.userId, ctx.idempotencyKey ?? "");
    ctx.audit.action = "mail.sent";
    ctx.audit.severity = "warning";
    ctx.audit.after = { accountId: accountId(ctx), state: result.state, archivePending: result.archivePending, replayed: result.replayed, memoryCapture };
    return { status: 200, body: single({ ...result, receiptId, memoryCapture }),
      headers: { "Idempotent-Replayed": String(result.replayed) } };
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
