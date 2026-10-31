import type { EntityRef, Notification } from "@friday/sdk";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../db/database";
import { ApiError } from "../util/errors";
import { NativeNotifications, type NotificationEventType, type RaiseNativeNotification } from "./native-notifications";
import { NotificationStore } from "./notification-store";

let db: Db | undefined;
afterEach(() => { db?.close(); db = undefined; });

const CLOCK_START = Date.parse("2026-03-01T09:00:00.000Z");
const iso = (ms: number): string => new Date(ms).toISOString();

const ref = (type: EntityRef["type"], id: string): EntityRef => ({ type, id } as EntityRef);
// "device" is a stable fixture label; the cast keeps the test independent of the SDK category union.
const category = (value: string): Notification["category"] => value as Notification["category"];

const alert = (overrides: Partial<RaiseNativeNotification> = {}): RaiseNativeNotification => ({
  priority: "P2",
  category: "system",
  title: "Adapter offline",
  body: "Der Adapter hat die Verbindung verloren.",
  ...overrides,
});

interface Harness {
  store: NotificationStore;
  service: NativeNotifications;
  events: Array<{ type: NotificationEventType; notification: Notification }>;
  advance: (ms: number) => void;
}

const setup = (options: { snoozeDefaultMinutes?: () => number } = {}): Harness => {
  const database = openDatabase(":memory:");
  db = database;
  const store = new NotificationStore(database);
  const events: Harness["events"] = [];
  let clock = CLOCK_START;
  const service = new NativeNotifications({
    store,
    publish: (type, notification) => { events.push({ type, notification }); },
    now: () => clock,
    ...(options.snoozeDefaultMinutes ? { snoozeDefaultMinutes: options.snoozeDefaultMinutes } : {}),
  });
  return { store, service, events, advance: (ms) => { clock += ms; } };
};

const apiError = (run: () => unknown): ApiError => {
  try {
    run();
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("Erwarteter ApiError blieb aus.");
};

describe("NativeNotifications", () => {
  it("raises a notification and publishes created with a sent dashboard step", () => {
    const { service, events } = setup();
    const created = service.raise(alert({ priority: "P1", sourceRef: ref("approval", "apr_1"), targetRoute: "/approvals/apr_1" }));

    expect(created.id).toMatch(/^ntf_[0-9A-Za-z]{26}$/);
    expect(created.version).toBe(1);
    expect(created.createdAt).toBe(iso(CLOCK_START));
    expect(created.updatedAt).toBe(iso(CLOCK_START));
    expect(created.source).toEqual({ adapterId: "friday-native-notifications", system: "friday", lastSyncedAt: iso(CLOCK_START) });
    expect(created.status).toBe("open");
    expect(created.acknowledged).toBe(false);
    expect(created.acknowledgedAt).toBeNull();
    expect(created.snoozedUntil).toBeNull();
    expect(created.resolved).toBe(false);
    expect(created.resolvedAt).toBeNull();
    expect(created.sourceRef).toEqual(ref("approval", "apr_1"));
    expect(created.targetRoute).toBe("/approvals/apr_1");
    expect(created.escalation).toEqual([
      { step: 1, channel: "dashboard", state: "sent", scheduledAt: iso(CLOCK_START), sentAt: iso(CLOCK_START), acknowledgedAt: null, stopOnAcknowledge: true },
    ]);
    expect(events).toEqual([{ type: "friday.notification.created", notification: created }]);
    expect(service.has(created.id)).toBe(true);
    expect(service.get(created.id)).toEqual(created);
  });

  it("updates the same source and category instead of duplicating and reopens an acknowledged one", () => {
    const { service, events } = setup();
    const source = ref("approval", "apr_2");
    const created = service.raise(alert({ sourceRef: source, priority: "P2" }));
    service.acknowledge(created.id);
    events.length = 0;

    const deduped = service.raise(alert({ sourceRef: source, priority: "P0", title: "Eskaliert", body: "Bitte prüfen.", targetRoute: "/approvals/apr_2" }));

    expect(deduped.id).toBe(created.id);
    expect(deduped.version).toBe(3);
    expect(deduped.priority).toBe("P0");
    expect(deduped.title).toBe("Eskaliert");
    expect(deduped.body).toBe("Bitte prüfen.");
    expect(deduped.targetRoute).toBe("/approvals/apr_2");
    expect(deduped.status).toBe("open");
    expect(deduped.acknowledged).toBe(false);
    expect(deduped.acknowledgedAt).toBeNull();
    expect(deduped.snoozedUntil).toBeNull();
    expect(deduped.escalation).toHaveLength(1);
    expect(deduped.escalation[0]).toMatchObject({ channel: "dashboard", state: "sent", acknowledgedAt: null });
    expect(events.map((event) => event.type)).toEqual(["friday.notification.updated"]);
    expect(service.list()).toHaveLength(1);
  });

  it("raises a separate notification for another category", () => {
    const { service, events } = setup();
    const source = ref("approval", "apr_3");
    const first = service.raise(alert({ sourceRef: source, category: "system" }));
    const second = service.raise(alert({ sourceRef: source, category: category("device") }));

    expect(second.id).not.toBe(first.id);
    expect(service.list()).toHaveLength(2);
    expect(events.map((event) => event.type)).toEqual(["friday.notification.created", "friday.notification.created"]);
  });

  it("acknowledges with a timestamp, marks the step and refuses a second acknowledge", () => {
    const { service, events } = setup();
    const created = service.raise(alert());
    events.length = 0;

    const acknowledged = service.acknowledge(created.id, { comment: "gesehen" });

    expect(acknowledged.status).toBe("acknowledged");
    expect(acknowledged.acknowledged).toBe(true);
    expect(acknowledged.acknowledgedAt).toBe(iso(CLOCK_START));
    expect(acknowledged.snoozedUntil).toBeNull();
    expect(acknowledged.version).toBe(2);
    expect(acknowledged.escalation[0]).toMatchObject({ state: "acknowledged", acknowledgedAt: iso(CLOCK_START) });
    expect(events.map((event) => event.type)).toEqual(["friday.notification.updated"]);

    const error = apiError(() => service.acknowledge(created.id));
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe("CONFLICT");
    expect(error.status).toBe(409);
    expect(error.message).toBe("Die Benachrichtigung ist bereits bestätigt.");
  });

  it("refuses a stale expected version with CONFLICT", () => {
    const { service } = setup();
    const created = service.raise(alert());

    const error = apiError(() => service.acknowledge(created.id, {}, 7));

    expect(error.code).toBe("CONFLICT");
    expect(error.message).toBe(`Benachrichtigung ${created.id} wurde zwischenzeitlich geändert (erwartet Version 7, aktuell 1).`);
    expect(error.details).toEqual({ expectedVersion: 7, currentVersion: 1, id: created.id });
  });

  it("snoozes for the given duration and wakes up on the next list after expiry", () => {
    const { service, events, advance } = setup();
    const created = service.raise(alert());
    events.length = 0;

    const snoozed = service.snooze(created.id, { durationMinutes: 15 });

    expect(snoozed.status).toBe("snoozed");
    expect(snoozed.snoozedUntil).toBe(iso(CLOCK_START + 15 * 60_000));
    expect(snoozed.version).toBe(2);
    expect(events.map((event) => event.type)).toEqual(["friday.notification.updated"]);

    advance(15 * 60_000 - 1);
    expect(service.list().map((item) => item.status)).toEqual(["snoozed"]);

    advance(1);
    events.length = 0;
    const woken = service.list();
    expect(woken.map((item) => item.status)).toEqual(["open"]);
    expect(woken.map((item) => item.snoozedUntil)).toEqual([null]);
    expect(woken.map((item) => item.version)).toEqual([3]);
    expect(events.map((event) => event.type)).toEqual(["friday.notification.updated"]);
  });

  it("uses the configured default without a duration", () => {
    const { service } = setup({ snoozeDefaultMinutes: () => 45 });
    const created = service.raise(alert());

    expect(service.snooze(created.id, {}).snoozedUntil).toBe(iso(CLOCK_START + 45 * 60_000));
  });

  it("refuses a snooze end in the past", () => {
    const { service } = setup();
    const created = service.raise(alert());

    const error = apiError(() => service.snooze(created.id, { until: iso(CLOCK_START - 1) }));

    expect(error.code).toBe("VALIDATION_FAILED");
    expect(error.details).toEqual({ fieldErrors: [{ path: "until", message: "Zeitpunkt liegt in der Vergangenheit" }] });
  });

  it("resolves a notification and refuses to resolve it twice", () => {
    const { service, events } = setup();
    const created = service.raise(alert());
    events.length = 0;

    const resolved = service.resolve(created.id, { comment: "behoben" });

    expect(resolved.status).toBe("resolved");
    expect(resolved.resolved).toBe(true);
    expect(resolved.resolvedAt).toBe(iso(CLOCK_START));
    expect(resolved.acknowledged).toBe(true);
    expect(resolved.acknowledgedAt).toBe(iso(CLOCK_START));
    expect(resolved.escalation.map((step) => step.state)).toEqual(["acknowledged"]);
    expect(events.map((event) => event.type)).toEqual(["friday.notification.updated"]);

    const error = apiError(() => service.resolve(created.id));
    expect(error.code).toBe("CONFLICT");
    expect(error.message).toBe("Die Benachrichtigung ist bereits erledigt.");
  });

  it("resolves everything of one source and leaves others alone", () => {
    const { service } = setup();
    const source = ref("approval", "apr_7");
    const first = service.raise(alert({ sourceRef: source }));
    const second = service.raise(alert({ sourceRef: source, category: category("device"), title: "Zweite" }));
    const unrelated = service.raise(alert({ sourceRef: ref("approval", "apr_8") }));

    expect(service.resolveBySource(source.type, source.id)).toBe(2);
    expect(service.get(first.id)?.status).toBe("resolved");
    expect(service.get(second.id)?.status).toBe("resolved");
    expect(service.get(unrelated.id)?.status).toBe("open");
  });

  it("filters by priority, status and category and sorts open ones first", () => {
    const { service, advance } = setup();
    const low = service.raise(alert({ priority: "P3" }));
    advance(1_000);
    const high = service.raise(alert({ priority: "P0", title: "Hoch" }));
    advance(1_000);
    const mid = service.raise(alert({ priority: "P1", category: category("device"), title: "Mittel" }));
    service.resolve(low.id);

    expect(service.list().map((item) => item.id)).toEqual([high.id, mid.id, low.id]);
    expect(service.list({ priority: ["P1"] }).map((item) => item.id)).toEqual([mid.id]);
    expect(service.list({ status: ["resolved"] }).map((item) => item.id)).toEqual([low.id]);
    expect(service.list({ category: "device" }).map((item) => item.id)).toEqual([mid.id]);
    expect(service.list({ priority: ["P0"], status: ["open"] }).map((item) => item.id)).toEqual([high.id]);
  });

  it("reads persisted entries through a new service on the same database", () => {
    const { service, store } = setup();
    const created = service.raise(alert());

    const restarted = new NativeNotifications({ store, publish: () => {} });

    expect(restarted.list().map((item) => item.id)).toEqual([created.id]);
    expect(restarted.get(created.id)).toEqual(created);
  });

  it("ignores notifications of other producers in the shared store", () => {
    const { service, store } = setup();
    const created = service.raise(alert());
    const foreign: Notification = { ...created, id: "ntf_01JZZZZZZZZZZZZZZZZZZZZZZZ",
      source: { adapterId: "mock-notifications", system: "mock", lastSyncedAt: created.createdAt }, status: "snoozed",
      snoozedUntil: "2026-01-01T00:00:00.000Z", sourceRef: ref("task", "task_1"), category: "task" };
    store.save(foreign);

    expect(service.list().map((item) => item.id)).toEqual([created.id]);
    expect(service.has(foreign.id)).toBe(false);
    expect(service.resolveBySource("task", "task_1")).toBe(0);
    expect(store.get(foreign.id)).toEqual(foreign);
    expect(() => service.acknowledge(foreign.id)).toThrow(ApiError);
  });

  it("trims and truncates title and body", () => {
    const { service } = setup();

    const created = service.raise(alert({ title: `  ${"T".repeat(250)}  `, body: `  ${"B".repeat(1200)}  ` }));

    expect(created.title).toBe("T".repeat(200));
    expect(created.body).toBe("B".repeat(1000));
  });
});
