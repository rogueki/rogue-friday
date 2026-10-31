import type { AdapterHealth, FridayEvent, Notification, Task } from "@friday/sdk";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../db/database";
import { NativeNotifications } from "./native-notifications";
import { attachNotificationProducers } from "./notification-producers";
import { NotificationStore } from "./notification-store";

let db: Db | undefined;
afterEach(() => { db?.close(); db = undefined; });

function setup() {
  db = openDatabase(":memory:");
  const notifications = new NativeNotifications({ store: new NotificationStore(db), publish: () => undefined });
  let listener: ((event: FridayEvent) => void) | undefined;
  const errors: string[] = [];
  const detach = attachNotificationProducers({ subscribe: (next) => { listener = next; return () => { listener = undefined; }; } },
    notifications, (_error, type) => errors.push(type));
  const emit = (type: string, data: unknown) => listener?.({ type, data } as unknown as FridayEvent);
  const open = (): Notification[] => notifications.list({ status: ["open"] });
  return { notifications, emit, open, errors, detach };
}

const task = (overrides: Partial<Task> = {}): Task => ({
  id: "task_1", title: "Strompreise vergleichen", status: "running", blockers: [], errors: [], resultSummary: null,
  ...overrides,
} as Task);

const health = (status: AdapterHealth["status"], lifecycle: AdapterHealth["lifecycle"] = "OFFLINE"): AdapterHealth => ({
  adapterId: "hermes-tasks", status, lifecycle,
} as AdapterHealth);

describe("notification producers", () => {
  it("raises a task alert for a question and closes it when the task runs again", () => {
    const { emit, open } = setup();
    emit("friday.task.updated", task({ status: "waiting", blockers: [{ id: "blk_task_1", kind: "input_needed", description: "Welcher Tarif?" }] }));
    expect(open()).toEqual([expect.objectContaining({ category: "task", priority: "P2", title: "Rückfrage: Strompreise vergleichen",
      body: "Welcher Tarif?", targetRoute: "/tasks?task=task_1", sourceRef: expect.objectContaining({ type: "task", id: "task_1" }) })]);

    emit("friday.task.progress", task({ status: "running" }));
    expect(open()).toEqual([]);
  });

  it("turns the open question into a failure alert instead of adding a second one", () => {
    const { emit, notifications } = setup();
    emit("friday.task.updated", task({ status: "waiting", blockers: [{ id: "blk_task_1", kind: "input_needed", description: "Welcher Tarif?" }] }));
    emit("friday.task.failed", task({ status: "failed", errors: [{ message: "Quelle nicht erreichbar" } as Task["errors"][number]] }));
    expect(notifications.list()).toEqual([expect.objectContaining({ title: "Auftrag fehlgeschlagen: Strompreise vergleichen",
      body: "Quelle nicht erreichbar", status: "open" })]);
  });

  it("stays quiet for approval blockers, paused tasks and plain progress", () => {
    const { emit, notifications } = setup();
    emit("friday.task.updated", task({ status: "waiting", blockers: [{ id: "blk_a", kind: "approval", description: "Freigabe ausstehend" }] }));
    emit("friday.task.updated", task({ status: "waiting", blockers: [{ id: "blk_p", kind: "other", description: "Vom Benutzer pausiert" }] }));
    emit("friday.task.progress", task());
    emit("friday.task.completed", task({ status: "done" }));
    expect(notifications.list()).toEqual([]);
  });

  it("raises an urgent alert for an unreachable service and closes it when it is back", () => {
    const { emit, open } = setup();
    emit("friday.adapter.health_changed", health("offline"));
    emit("friday.adapter.health_changed", health("offline"));
    expect(open()).toEqual([expect.objectContaining({ category: "adapter", priority: "P1", title: "Dienst nicht erreichbar: hermes-tasks",
      targetRoute: "/system" })]);

    emit("friday.adapter.health_changed", health("online", "ONLINE"));
    expect(open()).toEqual([]);
  });

  it("does not alert for a service that is being stopped on purpose", () => {
    const { emit, notifications } = setup();
    emit("friday.adapter.health_changed", health("offline", "STOPPED"));
    emit("friday.adapter.health_changed", health("degraded", "DEGRADED"));
    expect(notifications.list()).toEqual([]);
  });

  it("reports a broken event to the caller instead of throwing into the hub", () => {
    const { emit, errors, detach } = setup();
    expect(() => emit("friday.task.failed", null)).not.toThrow();
    expect(errors).toEqual(["friday.task.failed"]);
    detach();
  });
});
