import { describe, expect, it, vi } from "vitest";
import type { RequestContext } from "../http/context";
import { calendarOperationKey, captureCalendarOutcome } from "./calendar-memory";

describe("calendar outcome memory handoff", () => {
  const record = { operationKey: calendarOperationKey("owner-1", "account-a", "calendar-a", "create", "idem-12345678"),
    action: "create", identityId: "owner-1", channel: "dashboard", state: "created", externalId: "private-resource-id",
    createdAt: "2026-10-19T09:00:00.000Z" };

  it("keeps operation identity scoped and uses the journal timestamp on capture", async () => {
    const capture = vi.fn().mockReturnValue({ accepted: true, pending: true });
    const ackMemory = vi.fn().mockResolvedValue({ acknowledged: true });
    const ctx = { runtime: { durableMemory: { capture }, calendarAccounts: { ackMemory } } } as unknown as RequestContext;
    expect(calendarOperationKey("owner-1", "account-b", "calendar-a", "create", "idem-12345678")).not.toBe(record.operationKey);
    expect(calendarOperationKey("owner-2", "account-a", "calendar-a", "create", "idem-12345678")).not.toBe(record.operationKey);
    expect(await captureCalendarOutcome(ctx, record)).toBe(true);
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({ eventId: `cal-${record.operationKey.slice(0, 48)}`,
      occurredAt: record.createdAt, outcome: "completed", identityId: "owner-1" }));
    expect(JSON.stringify(capture.mock.calls)).not.toContain("private-resource-id");
    expect(ackMemory).toHaveBeenCalledWith(record.operationKey);
  });

  it("retains the journal receipt when capture fails after a provider success", async () => {
    const ackMemory = vi.fn();
    const ctx = { runtime: { durableMemory: { capture: () => { throw new Error("vault unavailable"); } },
      calendarAccounts: { ackMemory } } } as unknown as RequestContext;
    expect(await captureCalendarOutcome(ctx, record)).toBe(false);
    expect(ackMemory).not.toHaveBeenCalled();
  });
});
