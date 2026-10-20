import type { Notification } from "@friday/sdk";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../db/database";
import { NotificationStore } from "./notification-store";

let db: Db | undefined;
afterEach(() => { db?.close(); db = undefined; });

const notification = (overrides: Partial<Notification> = {}): Notification => ({
  id: "ntf_01JAAAAAAAAAAAAAAAAAAAAAAA",
  version: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  source: { adapterId: "control-api", system: "control-api", lastSyncedAt: "2026-01-02T00:00:00.000Z" },
  priority: "P2",
  category: "system",
  title: "Test alert",
  body: "Local test data",
  status: "resolved",
  acknowledged: true,
  acknowledgedAt: "2026-01-02T00:00:00.000Z",
  snoozedUntil: null,
  resolved: true,
  resolvedAt: "2026-01-02T00:00:00.000Z",
  escalation: [],
  sourceRef: null,
  targetRoute: null,
  ...overrides,
});

describe("NotificationStore", () => {
  it("round-trips durable notifications and orders newest first", () => {
    db = openDatabase(":memory:");
    const store = new NotificationStore(db);
    const older = notification({ id: "ntf_01JBBBBBBBBBBBBBBBBBBBBBBB" });
    const newer = notification({ id: "ntf_01JCCCCCCCCCCCCCCCCCCCCCCC", createdAt: "2026-01-03T00:00:00.000Z" });
    store.save(older);
    store.save(newer);
    expect(store.get(older.id)).toEqual(older);
    expect(store.list().map((item) => item.id)).toEqual([newer.id, older.id]);
  });

  it("counts and deletes only resolved records older by resolvedAt without pending dispatch", () => {
    db = openDatabase(":memory:");
    const store = new NotificationStore(db);
    const cutoff = "2026-02-01T00:00:00.000Z";
    const eligible = notification({ id: "ntf_01JBBBBBBBBBBBBBBBBBBBBBBB", resolvedAt: "2026-01-31T23:59:59.000Z" });
    const newer = notification({ id: "ntf_01JCCCCCCCCCCCCCCCCCCCCCCC", resolvedAt: cutoff });
    const unresolved = notification({ id: "ntf_01JDDDDDDDDDDDDDDDDDDDDDDD", status: "open", resolved: false, resolvedAt: null });
    const pending = notification({ id: "ntf_01JEEEEEEEEEEEEEEEEEEEEEEE", escalation: [{ step: 1, channel: "email", state: "pending", scheduledAt: "2026-01-01T00:00:00.000Z", sentAt: null, acknowledgedAt: null }] });
    store.save(eligible, false);
    store.save(newer, false);
    store.save(unresolved, false);
    store.save(pending, true);

    expect(store.countResolvedBefore(cutoff)).toBe(1);
    expect(store.deleteResolvedBefore(cutoff)).toBe(1);
    expect(store.get(eligible.id)).toBeUndefined();
    expect(store.get(newer.id)).toEqual(newer);
    expect(store.get(unresolved.id)).toEqual(unresolved);
    expect(store.get(pending.id)).toEqual(pending);
    expect(() => store.countResolvedBefore("not-a-date")).toThrow("ISO date-time");
  });

  it("binds one immutable messenger draft and retry key to an owner-approved notification step", () => {
    db = openDatabase(":memory:");
    const store = new NotificationStore(db);
    const alert = notification({ status: "open", resolved: false, resolvedAt: null, acknowledged: false,
      acknowledgedAt: null, escalation: [{ step: 1, channel: "telegram", state: "awaiting_approval",
        scheduledAt: "2026-01-02T00:00:00.000Z", sentAt: null, acknowledgedAt: null }] });
    store.save(alert, false);
    const draft = { accountId: "default" as const, platform: "telegram", recipient: "12345678", text: "Alert" };
    const first = store.stageMessengerDraft(alert.id, 1, "owner", draft);
    const replay = store.stageMessengerDraft(alert.id, 1, "owner", draft);
    expect(replay.idempotencyKey).toBe(first.idempotencyKey);
    expect(store.messengerStage(alert.id, 1, "owner")).toEqual(first);
    expect(() => store.stageMessengerDraft(alert.id, 1, "other-owner", draft)).toThrow();
    expect(() => store.stageMessengerDraft(alert.id, 1, "owner", { ...draft, text: "Changed" })).toThrow();
    store.completeMessengerStage(alert.id, 1, "owner", first.idempotencyKey, { state: "uncertain", receiptId: "receipt" });
    expect(store.messengerStage(alert.id, 1, "owner").state).toBe("uncertain");
  });
});
