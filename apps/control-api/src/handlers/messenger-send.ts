import { CONTRACT_VERSION } from "@friday/sdk";
import type { Handler } from "../http/context";
import type { OperationId } from "../http/route-types";
import type { MessengerDraft } from "../services/messenger-send";
import { validationFailed } from "../util/errors";

const single = (data: unknown) => ({ contractVersion: CONTRACT_VERSION, data, freshness: { state: "fresh" as const, asOf: new Date().toISOString() } });

export const messengerSendHandlers: Partial<Record<OperationId, Handler>> = {
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
    if (!ctx.idempotencyKey) throw validationFailed("Idempotency-Key für Messenger-Versand erforderlich.");
    const { draft, token } = ctx.body as { draft: MessengerDraft; token: string };
    const origin = draft.notificationId && draft.notificationStep ?
      ctx.runtime.notifications.messengerStage(draft.notificationId, draft.notificationStep, ctx.principal!.userId) : undefined;
    if (origin && (origin.idempotencyKey !== ctx.idempotencyKey || JSON.stringify(origin.draft) !== JSON.stringify(draft)))
      throw validationFailed("Der Eskalationsentwurf oder Idempotency-Key stimmt nicht mit der gespeicherten Freigabe überein.");
    const receipt = await ctx.runtime.messengerSend.confirm(ctx.principal!.userId, draft, token, ctx.idempotencyKey, {
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
    let memoryCapture: "written" | "pending" | "skipped" | "error" = "error";
    try {
      const result = ctx.runtime.durableMemory.capture({
        eventId: `messenger-${receipt.receiptId.slice(0, 48)}`, contractVersion: CONTRACT_VERSION,
        eventType: "action_result", actor: { type: "assistant", id: "friday", role: null },
        identityId: ctx.principal!.userId, channel: "dashboard", sessionId: null, dialogId: null,
        correlationId: null, source: `messenger/send/${receipt.platform}`, occurredAt: receipt.createdAt,
        outcome: receipt.state === "sent" ? "completed" : "uncertain", captureEligibility: "eligible",
        redaction: "required", payload: { kind: "action", actionId: "messenger.send", targetId: null,
          externalId: null },
      });
      memoryCapture = result.pending ? "pending" : result.accepted ? "written" : "skipped";
    } catch { /* An already attempted delivery must not be retried for a memory failure. */ }
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
