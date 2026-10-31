import type {
  EntityRef,
  Notification,
  NotificationActionRequest,
  NotificationSnoozeRequest,
  Priority,
} from "@friday/sdk";
import { createId } from "@friday/observability";
import { conflict, notFound, validationFailed } from "../util/errors";
import type { NotificationStore } from "./notification-store";

export type NotificationEventType = "friday.notification.created" | "friday.notification.updated";

export interface NativeNotificationDeps {
  store: NotificationStore;
  publish: (type: NotificationEventType, notification: Notification) => void;
  now?: () => number;
  snoozeDefaultMinutes?: () => number;
}

export interface RaiseNativeNotification {
  priority: Priority;
  category: Notification["category"];
  title: string;
  body: string;
  sourceRef?: EntityRef | null;
  targetRoute?: string | null;
}

export interface NativeNotificationQuery {
  priority?: Priority[];
  status?: Notification["status"][];
  category?: string;
}

const ADAPTER_ID = "friday-native-notifications";
const SYSTEM = "friday";
const TITLE_LIMIT = 200;
const BODY_LIMIT = 1000;
const DEFAULT_SNOOZE_MINUTES = 30;
const PRIORITY_RANK: Readonly<Record<Priority, number>> = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };

/** External channels need an owner approval flow that the live runtime does not have yet, so only the dashboard escalates. */
const dashboardEscalation = (nowIso: string): Notification["escalation"] => [
  { step: 1, channel: "dashboard", state: "sent", scheduledAt: nowIso, sentAt: nowIso, acknowledgedAt: null, stopOnAcknowledge: true },
];

const clampText = (value: string, limit: number): string => value.trim().slice(0, limit);

const compareDesc = (a: string, b: string): number => (a < b ? 1 : a > b ? -1 : 0);

/** Notification port implementation for the live runtime; durable state stays in the SQLite NotificationStore. */
export class NativeNotifications {
  private readonly store: NotificationStore;
  private readonly publish: (type: NotificationEventType, notification: Notification) => void;
  private readonly now: () => number;
  private readonly snoozeDefaultMinutes: () => number;

  constructor(deps: NativeNotificationDeps) {
    this.store = deps.store;
    this.publish = deps.publish;
    this.now = deps.now ?? Date.now;
    this.snoozeDefaultMinutes = deps.snoozeDefaultMinutes ?? (() => DEFAULT_SNOOZE_MINUTES);
  }

  has(id: string): boolean {
    return this.own(id) !== undefined;
  }

  get(id: string): Notification | undefined {
    this.wakeSnoozed();
    return this.own(id);
  }

  list(query: NativeNotificationQuery = {}): Notification[] {
    this.wakeSnoozed();
    const priorities = query.priority ?? [];
    const statuses = query.status ?? [];
    return this.ownList()
      .filter((notification) => {
        if (priorities.length > 0 && !priorities.includes(notification.priority)) return false;
        if (statuses.length > 0 && !statuses.includes(notification.status)) return false;
        if (query.category !== undefined && notification.category !== query.category) return false;
        return true;
      })
      .sort((a, b) =>
        Number(a.status === "resolved") - Number(b.status === "resolved") ||
        PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
        compareDesc(a.createdAt, b.createdAt) ||
        compareDesc(a.id, b.id));
  }

  raise(input: RaiseNativeNotification): Notification {
    const nowIso = this.nowIso();
    const sourceRef = input.sourceRef ?? null;
    const existing = sourceRef ? this.findBySourceRef(sourceRef, input.category) : undefined;
    if (existing) {
      existing.priority = input.priority;
      existing.title = clampText(input.title, TITLE_LIMIT);
      existing.body = clampText(input.body, BODY_LIMIT);
      existing.targetRoute = input.targetRoute ?? null;
      // The referenced entity changed again, so an already handled alert has to return to the inbox.
      if (existing.status === "acknowledged" || existing.status === "snoozed") {
        existing.status = "open";
        existing.acknowledged = false;
        existing.acknowledgedAt = null;
        existing.snoozedUntil = null;
        existing.escalation = dashboardEscalation(nowIso);
      }
      this.commit(existing, "friday.notification.updated");
      return existing;
    }
    const notification: Notification = {
      id: createId("ntf"),
      version: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
      source: { adapterId: ADAPTER_ID, system: SYSTEM, lastSyncedAt: nowIso },
      priority: input.priority,
      category: input.category,
      title: clampText(input.title, TITLE_LIMIT),
      body: clampText(input.body, BODY_LIMIT),
      status: "open",
      acknowledged: false,
      acknowledgedAt: null,
      snoozedUntil: null,
      resolved: false,
      resolvedAt: null,
      escalation: dashboardEscalation(nowIso),
      sourceRef,
      targetRoute: input.targetRoute ?? null,
    };
    this.store.save(notification);
    this.publish("friday.notification.created", notification);
    return notification;
  }

  /** A comment is accepted but not stored: the notification contract carries no field for it. */
  acknowledge(id: string, _body: NotificationActionRequest = {}, expectedVersion?: number): Notification {
    const notification = this.load(id, expectedVersion);
    if (notification.status !== "open" && notification.status !== "snoozed")
      throw conflict(`Die Benachrichtigung ist bereits ${notification.status === "resolved" ? "erledigt" : "bestätigt"}.`, { status: notification.status });
    const nowIso = this.nowIso();
    this.stopEscalation(notification, nowIso);
    notification.status = "acknowledged";
    notification.acknowledged = true;
    notification.acknowledgedAt = nowIso;
    notification.snoozedUntil = null;
    this.commit(notification, "friday.notification.updated");
    return notification;
  }

  snooze(id: string, body: NotificationSnoozeRequest, expectedVersion?: number): Notification {
    const notification = this.load(id, expectedVersion);
    if (notification.status === "resolved") throw conflict("Erledigte Benachrichtigungen können nicht zurückgestellt werden.", { status: notification.status });
    const nowMs = this.now();
    let until: number;
    if (body.until) {
      until = Date.parse(body.until);
      if (until <= nowMs) throw validationFailed("until muss in der Zukunft liegen.", [{ path: "until", message: "Zeitpunkt liegt in der Vergangenheit" }]);
    } else {
      until = nowMs + (body.durationMinutes ?? this.snoozeDefaultMinutes()) * 60_000;
    }
    this.stopEscalation(notification, this.nowIso(), false);
    notification.status = "snoozed";
    notification.snoozedUntil = new Date(until).toISOString();
    this.commit(notification, "friday.notification.updated");
    return notification;
  }

  /** A comment is accepted but not stored: the notification contract carries no field for it. */
  resolve(id: string, _body: NotificationActionRequest = {}, expectedVersion?: number): Notification {
    const notification = this.load(id, expectedVersion);
    if (notification.status === "resolved") throw conflict("Die Benachrichtigung ist bereits erledigt.", { status: notification.status });
    this.markResolved(notification);
    this.commit(notification, "friday.notification.updated");
    return notification;
  }

  resolveBySource(type: EntityRef["type"], id: string): number {
    let resolved = 0;
    for (const notification of this.ownList()) {
      if (notification.status === "resolved") continue;
      if (!notification.sourceRef || notification.sourceRef.type !== type || notification.sourceRef.id !== id) continue;
      this.markResolved(notification);
      this.commit(notification, "friday.notification.updated");
      resolved += 1;
    }
    return resolved;
  }

  private findBySourceRef(sourceRef: EntityRef, category: Notification["category"]): Notification | undefined {
    return this.ownList().find((notification) =>
      notification.status !== "resolved" &&
      notification.category === category &&
      notification.sourceRef?.type === sourceRef.type &&
      notification.sourceRef?.id === sourceRef.id);
  }

  private load(id: string, expectedVersion?: number): Notification {
    const notification = this.own(id);
    if (!notification) throw notFound("Benachrichtigung", id);
    if (expectedVersion !== undefined && expectedVersion !== notification.version) {
      throw conflict(
        `Benachrichtigung ${id} wurde zwischenzeitlich geändert (erwartet Version ${expectedVersion}, aktuell ${notification.version}).`,
        { expectedVersion, currentVersion: notification.version, id },
      );
    }
    return notification;
  }

  private markResolved(notification: Notification): void {
    const nowIso = this.nowIso();
    this.stopEscalation(notification, nowIso);
    notification.status = "resolved";
    notification.resolved = true;
    notification.resolvedAt = nowIso;
    if (!notification.acknowledged) {
      notification.acknowledged = true;
      notification.acknowledgedAt = nowIso;
    }
    notification.snoozedUntil = null;
  }

  /** Acknowledging stops the chain: the last sent step is marked acknowledged, open steps are skipped. */
  private stopEscalation(notification: Notification, nowIso: string, acknowledge = true): void {
    let lastSent = -1;
    notification.escalation.forEach((step, index) => {
      if (step.state === "sent") lastSent = index;
    });
    notification.escalation = notification.escalation.map((step, index) => {
      if (acknowledge && index === lastSent) return { ...step, state: "acknowledged" as const, acknowledgedAt: nowIso };
      const stoppable = step.state === "pending" || step.state === "awaiting_approval";
      if (stoppable && (acknowledge ? step.stopOnAcknowledge !== false : true)) return { ...step, state: "skipped" as const };
      return step;
    });
  }

  /** Snooze expiry has no timer in the live runtime, so reads are the wake-up point. */
  private wakeSnoozed(): void {
    const nowMs = this.now();
    for (const notification of this.ownList()) {
      if (notification.status !== "snoozed" || notification.snoozedUntil === null) continue;
      if (Date.parse(notification.snoozedUntil) > nowMs) continue;
      notification.status = "open";
      notification.snoozedUntil = null;
      this.commit(notification, "friday.notification.updated");
    }
  }

  private commit(notification: Notification, type: NotificationEventType): void {
    const nowIso = this.nowIso();
    notification.version += 1;
    notification.updatedAt = nowIso;
    notification.source = { ...notification.source, lastSyncedAt: nowIso };
    this.store.save(notification);
    this.publish(type, notification);
  }

  // The store also persists the mock world's notifications; those belong to the world's own port, not to this service.
  private own(id: string): Notification | undefined {
    const notification = this.store.get(id);
    return notification?.source.adapterId === ADAPTER_ID ? notification : undefined;
  }

  private ownList(): Notification[] {
    return this.store.list().filter((notification) => notification.source.adapterId === ADAPTER_ID);
  }

  private nowIso(): string {
    return new Date(this.now()).toISOString();
  }
}
