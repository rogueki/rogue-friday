import { CONTRACT_VERSION } from "@friday/sdk";
import type { Handler, RequestContext } from "../http/context";
import type { OperationId } from "../http/route-types";
import type { MessengerDraft, MessengerReceipt, MessengerSendDraft } from "../services/messenger-send";
import { checkedMessengerDraft } from "../services/messenger-send";
import type { NativeExecutableAction } from "../services/native-approval-requests";
import type { IntegrationEvent } from "../services/durable-memory";
import { ApiError, conflict, validationFailed } from "../util/errors";

const single = (data: unknown) => ({ contractVersion: CONTRACT_VERSION, data, freshness: { state: "fresh" as const, asOf: new Date().toISOString() } });

const PREVIEW_ID = /^corr_[0-9A-Za-z]{26}$/;

/** Only safe action metadata enters native memory; message text and recipient stay out. */
export function captureMessengerSend(ctx: RequestContext, ownerId: string,
  receipt: MessengerReceipt): "written" | "pending" | "skipped" | "error" {
  try {
    const event: IntegrationEvent = {
      eventId: `messenger-${receipt.receiptId.slice(0, 48)}`, contractVersion: CONTRACT_VERSION,
      eventType: "action_result", actor: { type: "assistant", id: "friday", role: null },
      identityId: ownerId, channel: "dashboard", sessionId: null, dialogId: null,
      correlationId: null, source: `messenger/send/${receipt.platform}`, occurredAt: receipt.createdAt,
      outcome: receipt.state === "sent" ? "completed" : "uncertain", captureEligibility: "eligible",
      redaction: "required", payload: { kind: "action", actionId: "messenger.send", targetId: null,
        externalId: null },
    };
    const result = ctx.runtime.durableMemory.capture(event);
    return result.pending ? "pending" : result.accepted ? "written" : "skipped";
  } catch {
    // An already attempted delivery must not be retried for a memory failure.
    return "error";
  }
}

interface MessengerWrite {
  action: Extract<NativeExecutableAction, { kind: "messenger.send" }>;
  actionText: string;
  previewText: string;
}

/**
 * Stages the exact messenger send as a draft, binds confirmation to the unchanged action and either hands it to
 * the tier-2 approval flow or lets the caller execute it once. Throws for every non-executable stage.
 */
function enforceMessengerWrite(ctx: RequestContext, ownerId: string, write: MessengerWrite): string {
  const confirmedPreviewId = ctx.headers["x-action-preview-id"];
  if (confirmedPreviewId !== undefined && !PREVIEW_ID.test(confirmedPreviewId)) {
    throw validationFailed("Die Vorschaukennung ist ungueltig.", [{ path: "X-Action-Preview-Id", message: "ungueltig" }]);
  }
  if (!confirmedPreviewId) {
    const previewId = ctx.correlationId;
    ctx.runtime.nativeApprovals.propose({ ownerId, requestKey: previewId, correlationId: ctx.correlationId,
      riskTier: 2, type: "system_change", action: write.actionText,
      rationale: "Messenger-Nachricht aus bestaetigter API-Anfrage", preview: { kind: "text",
        title: write.actionText, body: JSON.stringify(write.action) }, impacts: [], execution: write.action });
    throw new ApiError({ code: "APPROVAL_REQUIRED", message: "Nachricht zuerst mit unveraenderter Vorschau bestaetigen.",
      details: { stage: "preview", previewId, previewText: write.previewText } });
  }
  const policy = ctx.runtime.nativeApprovals.confirm(ownerId, confirmedPreviewId, write.action);
  if (policy.approval) {
    throw new ApiError({ code: "APPROVAL_REQUIRED", message: "Nachricht wartet auf Freigabe.",
      details: { stage: "approval", approvalId: policy.approval.id,
        targetRoute: `/approvals?approval=${policy.approval.id}` } });
  }
  return confirmedPreviewId;
}

/** Dispatches the stored messenger send once; the send journal keeps provider delivery at-most-once. */
async function executeMessengerWrite(ctx: RequestContext, ownerId: string, previewId: string): Promise<string> {
  return ctx.runtime.nativeApprovals.executeWithoutApproval(ownerId, previewId, async (savedAction, idempotencyKey) => {
    if (savedAction.kind === "messenger.send") {
      const receipt = await ctx.runtime.messengerSend.sendStaged(ownerId, savedAction.draft, idempotencyKey);
      return receipt.receiptId;
    }
    throw conflict("Die Bestaetigung passt nicht zum gespeicherten Entwurf.");
  });
}

/** The text summary in previews is capped; the full text lives only in the stored draft. */
const summarize = (text: string): string => {
  const squashed = text.replace(/\s+/g, " ").trim();
  return squashed.length > 80 ? `${squashed.slice(0, 77)}...` : squashed;
};

export const messengerPreviewText = (draft: MessengerSendDraft): string =>
  `Nachricht über ${draft.platform} an ${draft.recipient} senden? Text: „${summarize(draft.text)}“`;

/**
 * A plain outbound send (no escalation binding) goes through the native staged pipeline: exact-body preview,
 * optional tier-2 approval, one journaled dispatch. Escalation drafts keep their existing stage/token flow.
 */
async function confirmPlainSend(ctx: RequestContext, ownerId: string, draft: MessengerSendDraft): Promise<{ status: number; body: unknown; headers?: Record<string, string> }> {
  checkedMessengerDraft(draft);
  // An unregistered recipient, an unconfigured channel or a dead gateway fails before any preview is staged.
  if (!ctx.headers["x-action-preview-id"]) await ctx.runtime.messengerSend.assertSendable(ownerId, draft);
  const write: MessengerWrite = {
    action: { kind: "messenger.send", draft },
    actionText: `Nachricht senden: ${draft.platform}/${draft.recipient}`,
    previewText: messengerPreviewText(draft) };
  const previewId = enforceMessengerWrite(ctx, ownerId, write);
  const replayed = ctx.runtime.nativeApprovals.stateOf(ownerId, previewId) === "completed";
  const receiptId = await executeMessengerWrite(ctx, ownerId, previewId);
  const stored = ctx.runtime.messengerSend.receipt(ownerId, receiptId);
  const receipt: MessengerReceipt = stored ?? { receiptId, accountId: draft.accountId, platform: draft.platform,
    recipient: draft.recipient, state: "uncertain", externalId: null, createdAt: new Date().toISOString(), replayed };
  const memoryCapture = captureMessengerSend(ctx, ownerId, receipt);
  ctx.audit.action = "messenger.send";
  ctx.audit.severity = "warning";
  ctx.audit.after = { platform: receipt.platform, state: receipt.state, replayed, memoryCapture };
  return { status: 200, body: single({ ...receipt, replayed, memoryCapture }),
    headers: { "Idempotent-Replayed": String(replayed) } };
}


export const messengerSendHandlers: Partial<Record<OperationId, Handler>> = {
  async getMessengerCatalog(ctx) {
    return { status: 200, body: single(await ctx.runtime.messengerCatalog.list()),
      headers: { "Cache-Control": "no-store" } };
  },
  async getMessengerProvider(ctx) {
    return { status: 200, body: single(await ctx.runtime.messengerProvider.status(ctx.pathParams.platform!)),
      headers: { "Cache-Control": "no-store" } };
  },
  async updateMessengerProvider(ctx) {
    const input = ctx.body as { platform: string; revision: string; values: Record<string, string | null> };
    if (input.platform !== ctx.pathParams.platform) throw validationFailed("Provider-Pfad und Inhalt stimmen nicht überein.");
    const result = await ctx.runtime.messengerProvider.update(input.platform, input);
    ctx.audit.action = "messenger.provider.update";
    ctx.audit.after = { platform: input.platform, state: result.state, fieldNames: Object.keys(input.values) };
    return { status: 200, body: single(result), headers: { "Cache-Control": "no-store" } };
  },
  async applyMessengerProvider(ctx) {
    const input = ctx.body as { revision: string };
    const result = await ctx.runtime.messengerProvider.apply(ctx.pathParams.platform!, input.revision);
    ctx.audit.action = "messenger.provider.apply";
    ctx.audit.after = { platform: result.platform, state: result.state, gatewayRestarted: result.gatewayRestarted,
      connectionState: result.connectionState };
    return { status: 200, body: single(result), headers: { "Cache-Control": "no-store" } };
  },
  async listMessengerTargets(ctx) {
    return { status: 200, body: single({ items: ctx.runtime.messengerSend.targets(ctx.principal!.userId) }) };
  },
  async registerMessengerTarget(ctx) {
    const target = ctx.runtime.messengerSend.register(ctx.principal!.userId,
      ctx.body as Pick<MessengerDraft, "accountId" | "platform" | "recipient">);
    ctx.audit.action = "messenger.target.register";
    ctx.audit.after = { platform: target.platform, targetId: target.id };
    return { status: 200, body: single(target) };
  },
  async removeMessengerTarget(ctx) {
    const target = ctx.runtime.messengerSend.remove(ctx.principal!.userId, ctx.pathParams.id!);
    ctx.audit.action = "messenger.target.remove";
    ctx.audit.after = { platform: target.platform, targetId: target.id };
    return { status: 200, body: single(target) };
  },
  async previewMessengerMessage(ctx) {
    const draft = ctx.body as MessengerDraft;
    let idempotencyKey: string | undefined;
    if (draft.notificationId && draft.notificationStep) {
      if (!ctx.runtime.world) throw validationFailed("Diese Benachrichtigung ist nicht im lokalen Owner-Freigabespeicher verfügbar.");
      ctx.runtime.world.notifications.assertMessengerStepActionable(draft.notificationId, draft.notificationStep, draft.platform, draft.recipient);
      const stage = ctx.runtime.notifications.stageMessengerDraft(draft.notificationId, draft.notificationStep,
        ctx.principal!.userId, draft);
      if (stage.state !== "staged") throw validationFailed("Dieser Eskalationsversuch wurde bereits abgeschlossen; keinen neuen Versandversuch anlegen.");
      idempotencyKey = stage.idempotencyKey;
    }
    const preview = await ctx.runtime.messengerSend.preview(ctx.principal!.userId, draft);
    return { status: 200, body: single({ ...preview, ...(idempotencyKey ? { idempotencyKey } : {}) }),
      headers: { "Cache-Control": "no-store" } };
  },
  async confirmMessengerMessage(ctx) {
    const { draft, token } = ctx.body as { draft: MessengerDraft; token: string };
    const ownerId = ctx.principal!.userId;
    if (!draft.notificationId && !draft.notificationStep)
      return confirmPlainSend(ctx, ownerId, { accountId: draft.accountId, platform: draft.platform,
        recipient: draft.recipient, text: draft.text });
    if (!ctx.idempotencyKey) throw validationFailed("Idempotency-Key für Messenger-Versand erforderlich.");
    const origin = ctx.runtime.notifications.messengerStage(draft.notificationId!, draft.notificationStep!, ownerId);
    if (origin && (origin.idempotencyKey !== ctx.idempotencyKey || JSON.stringify(origin.draft) !== JSON.stringify(draft)))
      throw validationFailed("Der Eskalationsentwurf oder Idempotency-Key stimmt nicht mit der gespeicherten Freigabe überein.");
    const receipt = await ctx.runtime.messengerSend.confirm(ownerId, draft, token, ctx.idempotencyKey, {
      replayOnly: Boolean(origin && origin.state !== "staged"),
      ...(origin && origin.state === "staged" ? { beforeSend: () => {
        if (!ctx.runtime.world) throw validationFailed("Benachrichtigungszustand ist nicht verfügbar.");
        ctx.runtime.world.notifications.assertMessengerStepActionable(draft.notificationId!, draft.notificationStep!, draft.platform, draft.recipient);
      } } : {}),
    });
    if (origin) {
      const finalState = receipt.state === "sent" ? "sent" : "uncertain";
      const current = ctx.runtime.world?.notifications.find(origin.notificationId);
      const previous = current ? JSON.parse(JSON.stringify(current)) as typeof current : undefined;
      ctx.runtime.db.exec("BEGIN IMMEDIATE");
      try {
        if (current && current.escalation.find((step) => step.step === origin.step)?.state !== finalState)
          ctx.runtime.world!.notifications.recordMessengerReceipt(origin.notificationId, origin.step, finalState);
        ctx.runtime.notifications.completeMessengerStage(origin.notificationId, origin.step, origin.actor, origin.idempotencyKey,
          { state: finalState, receiptId: receipt.receiptId });
        ctx.runtime.db.exec("COMMIT");
      } catch (error) {
        ctx.runtime.db.exec("ROLLBACK");
        if (current && previous) Object.assign(current, previous);
        throw error;
      }
    }
    const memoryCapture = captureMessengerSend(ctx, ownerId, receipt);
    ctx.audit.action = "messenger.send";
    ctx.audit.severity = "warning";
    ctx.audit.after = { platform: receipt.platform, state: receipt.state, replayed: receipt.replayed, memoryCapture };
    return { status: 200, body: single({ ...receipt, memoryCapture }),
      headers: { "Idempotent-Replayed": String(receipt.replayed) } };
  },
  async listMessengerReceipts(ctx) {
    return { status: 200, body: single({ items: ctx.runtime.messengerSend.receipts(ctx.principal!.userId) }) };
  },
};
