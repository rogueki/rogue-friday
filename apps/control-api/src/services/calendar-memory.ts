import { createHash } from "node:crypto";
import { CONTRACT_VERSION } from "@friday/sdk";
import type { RequestContext } from "../http/context";

type MemoryRecord = { operationKey: string; action: string; identityId: string | null; channel: string;
  state: string; externalId: string | null; createdAt: string };

export const calendarOperationKey = (identityId: string, accountId: string, calendarId: string, action: string, key: string) =>
  createHash("sha256").update(JSON.stringify([identityId, accountId, calendarId, action, key])).digest("hex");

export async function captureCalendarOutcome(ctx: RequestContext, record: MemoryRecord): Promise<boolean> {
  try {
    const captured = ctx.runtime.durableMemory.capture({
      eventId: `cal-${record.operationKey.slice(0, 48)}`, contractVersion: CONTRACT_VERSION, eventType: "action_result",
      actor: { type: "assistant", id: "friday", role: null }, identityId: record.identityId,
      channel: record.channel, sessionId: null, dialogId: null, correlationId: null,
      source: "calendar/write", occurredAt: record.createdAt,
      outcome: record.state === "uncertain" || record.state === "pending" ? "uncertain" : "completed",
      captureEligibility: record.identityId ? "eligible" : "private", redaction: "required",
      payload: { kind: "action", actionId: `calendar.${record.action}`, targetId: null,
        externalId: record.externalId ? createHash("sha256").update(record.externalId).digest("hex").slice(0, 24) : null },
    });
    if (!captured.accepted) return false;
    const acknowledged = await ctx.runtime.calendarAccounts.ackMemory(record.operationKey);
    return acknowledged.acknowledged;
  } catch {
    // The provider result is already journaled; this will be retried from the pending memory row.
    return false;
  }
}

export async function flushCalendarMemory(ctx: RequestContext): Promise<void> {
  try {
    const { events } = await ctx.runtime.calendarAccounts.pendingMemory();
    for (const entry of events) {
      const done = await captureCalendarOutcome(ctx, { operationKey: entry.operationKey, action: entry.meta.action,
        identityId: entry.meta.identityId, channel: entry.meta.channel, state: entry.state,
        externalId: entry.result.id, createdAt: entry.createdAt });
      if (!done) break;
    }
  } catch {
    // Account reads remain available; journal rows retain the retry work.
  }
}
