import { CONTRACT_VERSION } from "@friday/sdk";
import type { RequestContext } from "../http/context";
import type { IntegrationEvent } from "../services/durable-memory";

/** Only safe action metadata enters native memory; mail contents and addresses stay out. */
export function captureMailSend(ctx: RequestContext, accountId: string, actor: string, identityId: string,
  channel: "dashboard" | "voice", state: "sent" | "uncertain"): "written" | "pending" | "skipped" | "error" {
  try {
    const receipt = ctx.runtime.mailSend.receipt(accountId, actor, ctx.idempotencyKey ?? "");
    const event: IntegrationEvent = {
      eventId: receipt.eventId, contractVersion: CONTRACT_VERSION, eventType: "action_result",
      actor: { type: "assistant", id: "friday", role: null }, identityId, channel,
      sessionId: null, dialogId: null, correlationId: null, source: "mail/send",
      occurredAt: receipt.occurredAt, outcome: state === "sent" ? "completed" : "uncertain",
      captureEligibility: "eligible", redaction: "required",
      payload: { kind: "action", actionId: "mail.send", targetId: accountId, externalId: null },
    };
    const result = ctx.runtime.durableMemory.capture(event);
    return result.pending ? "pending" : result.accepted ? "written" : "skipped";
  } catch {
    // A failed memory capture must never cause an already accepted SMTP send to be retried.
    return "error";
  }
}
