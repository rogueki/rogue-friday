import type {
  EntityRef,
  Notification,
  NotificationActionRequest,
  NotificationSnoozeRequest,
  Priority,
} from "@friday/sdk";
import type { TimerHandle } from "../../core/clock";
import { conflict, notFound, validationFailed } from "../../core/errors";
import { asList, clone, compareDesc, priorityRank, type Page } from "../../core/util";
import type { MockWorld } from "../world";
import type { OpContext } from "../types";
import { checkEnum, NOTIFICATION_STATUSES, pageOf, PRIORITIES, type Query } from "./shared";

export type NotificationListQuery = Query<"listNotifications">;
type Channel = Notification["escalation"][number]["channel"];

export interface RaiseNotificationInput {
  priority: Priority;
  category: Notification["category"];
  title: string;
  body: string;
  sourceRef?: EntityRef | null;
  targetRoute?: string | null;
  /** Escalation channels; delays come from `stepSeconds` or the configured default escalation. */
  chain?: Channel[];
  stepSeconds?: number[];
  correlationId?: string;
}

export class NotificationService {
  private timers = new Map<string, TimerHandle[]>();

  constructor(private readonly w: MockWorld) {}

  find(id: string): Notification {
    const notification = this.w.state.notifications.find((candidate) => candidate.id === id);
    if (!notification) throw notFound("Benachrichtigung", id);
    return notification;
  }

  /** Validates the live owner-review step immediately before a bound messenger send is admitted. */
  assertMessengerStepActionable(id: string, stepNumber: number, platform?: string, recipient?: string): Notification {
    const notification = this.find(id);
    const step = notification.escalation.find((entry) => entry.step === stepNumber);
    const channelSetting = step && this.w.state.settings.notifications.channels.find((entry) => entry.kind === step.channel);
    const recipientAllowed = recipient === undefined || (channelSetting?.recipient?.trim() === recipient &&
      (channelSetting.accountId === undefined || channelSetting.accountId === "default"));
    const statusAllows = notification.status === "open" ||
      (notification.status === "acknowledged" && step?.stopOnAcknowledge === false);
    if (!statusAllows || step?.state !== "awaiting_approval" ||
        !["telegram", "whatsapp", "sms"].includes(step.channel) ||
        (platform !== undefined && step.channel !== platform) ||
        !recipientAllowed ||
        !this.channelEligible(notification.priority, step.channel) || this.quietHoursActive(this.w.nowMs(), notification.priority)) {
      throw conflict("Dieser Messenger-Schritt ist nicht mehr versandberechtigt.");
    }
    return notification;
  }

  recordMessengerReceipt(id: string, stepNumber: number, receiptState: "sent" | "uncertain"): Notification {
    const notification = this.find(id);
    const step = notification.escalation.find((entry) => entry.step === stepNumber);
    if (!step || !["telegram", "whatsapp", "sms"].includes(step.channel))
      throw conflict("Der Messenger-Beleg gehört nicht zu diesem Eskalationsschritt.");
    step.state = receiptState;
    step.sentAt = receiptState === "sent" ? this.w.nowIso() : null;
    this.w.bump(notification);
    this.persist(notification);
    this.w.emitFor("notifications", "friday.notification.updated", notification, `notification/${notification.id}`);
    this.w.refresh();
    return clone(notification);
  }

  list(query: NotificationListQuery = {}): Page<Notification> {
    return this.w.read("listNotifications", () => {
      const priorities = asList(query.priority);
      const statuses = asList(query.status);
      checkEnum("priority", priorities, PRIORITIES);
      checkEnum("status", statuses, NOTIFICATION_STATUSES);
      const items = this.w.state.notifications
        .filter((notification) => {
          if (priorities.length && !priorities.includes(notification.priority)) return false;
          if (statuses.length && !statuses.includes(notification.status)) return false;
          if (query.category && notification.category !== query.category) return false;
          return true;
        })
        .sort((a, b) => Number(a.status === "resolved") - Number(b.status === "resolved") || priorityRank(a.priority) - priorityRank(b.priority) || compareDesc(a.createdAt, b.createdAt) || compareDesc(a.id, b.id));
      return pageOf(items, query);
    });
  }

  acknowledge(id: string, body: NotificationActionRequest = {}, ctx?: OpContext): Notification {
    return this.w.run("acknowledgeNotification", ctx, { id, body }, () => {
      this.w.validate("NotificationActionRequest", body);
      const notification = this.find(id);
      this.w.assertVersion(notification, ctx, "Benachrichtigung");
      if (notification.status !== "open" && notification.status !== "snoozed") throw conflict(`Die Benachrichtigung ist bereits ${notification.status === "resolved" ? "erledigt" : "bestätigt"}.`, { status: notification.status });
      const now = this.w.nowIso();
      this.stopEscalation(notification, now);
      notification.status = "acknowledged";
      notification.acknowledged = true;
      notification.acknowledgedAt = now;
      notification.snoozedUntil = null;
      this.commit(notification, ctx, "notification.acknowledged", body.comment);
      return clone(notification);
    });
  }

  snooze(id: string, body: NotificationSnoozeRequest = {}, ctx?: OpContext): Notification {
    return this.w.run("snoozeNotification", ctx, { id, body }, () => {
      this.w.validate("NotificationSnoozeRequest", body);
      const notification = this.find(id);
      this.w.assertVersion(notification, ctx, "Benachrichtigung");
      if (notification.status === "resolved") throw conflict("Erledigte Benachrichtigungen können nicht zurückgestellt werden.", { status: notification.status });
      const nowMs = this.w.nowMs();
      let until: number;
      if (body.until) {
        until = Date.parse(body.until);
        if (until <= nowMs) throw validationFailed("until muss in der Zukunft liegen.", [{ path: "until", message: "Zeitpunkt liegt in der Vergangenheit" }]);
      } else {
        until = nowMs + (body.durationMinutes ?? this.w.state.settings.notifications.snoozeDefaultMinutes) * 60_000;
      }
      this.stopEscalation(notification, this.w.nowIso(), false);
      notification.status = "snoozed";
      notification.snoozedUntil = new Date(until).toISOString();
      this.commit(notification, ctx, "notification.snoozed");
      this.scheduleSnooze(notification);
      return clone(notification);
    });
  }

  resolve(id: string, body: NotificationActionRequest = {}, ctx?: OpContext): Notification {
    return this.w.run("resolveNotification", ctx, { id, body }, () => {
      this.w.validate("NotificationActionRequest", body);
      const notification = this.find(id);
      this.w.assertVersion(notification, ctx, "Benachrichtigung");
      if (notification.status === "resolved") throw conflict("Die Benachrichtigung ist bereits erledigt.", { status: notification.status });
      this.markResolved(notification, ctx, body.comment);
      return clone(notification);
    });
  }

  /** Creates a notification and schedules owner-review prompts for external escalation steps. */
  raise(input: RaiseNotificationInput): Notification {
    const now = this.w.nowIso();
    const settings = this.w.state.settings.notifications;
    let notificationId = this.w.id("ntf");
    while (this.w.state.notifications.some((notification) => notification.id === notificationId)) notificationId = this.w.id("ntf");
    const urgent = input.priority === "P0" || input.priority === "P1";
    const defaults = settings.defaultEscalation.map((step) => ({ channel: step.channel, afterSeconds: step.afterSeconds, stopOnAcknowledge: step.stopOnAcknowledge ?? true }));
    let steps: { channel: Channel; afterSeconds: number; stopOnAcknowledge?: boolean }[];
    if (input.chain) {
      steps = input.chain.map((channel, index) => ({ channel, afterSeconds: input.stepSeconds?.[index] ?? defaults.find((step) => step.channel === channel)?.afterSeconds ?? index * 120, stopOnAcknowledge: defaults.find((step) => step.channel === channel)?.stopOnAcknowledge ?? true }));
    } else {
      steps = urgent ? defaults : [{ channel: "dashboard", afterSeconds: 0, stopOnAcknowledge: true }];
    }
    const notification: Notification = {
      id: notificationId,
      version: 1,
      createdAt: now,
      updatedAt: now,
      source: this.w.source("notifications"),
      priority: input.priority,
      category: input.category,
      title: input.title,
      body: input.body,
      status: "open",
      acknowledged: false,
      acknowledgedAt: null,
      snoozedUntil: null,
      resolved: false,
      resolvedAt: null,
      escalation: steps.map((step, index) => {
        const immediate = step.afterSeconds === 0;
        const quietDeferral = step.channel !== "dashboard" && this.quietHoursActive(this.w.nowMs(), input.priority);
        return {
          step: index + 1,
          channel: step.channel,
          state: immediate && !quietDeferral ? (step.channel === "dashboard" ? ("sent" as const) : ("awaiting_approval" as const)) : ("pending" as const),
          scheduledAt: new Date(this.w.nowMs() + step.afterSeconds * 1000).toISOString(),
          sentAt: immediate && step.channel === "dashboard" ? now : null,
          acknowledgedAt: null,
          stopOnAcknowledge: step.stopOnAcknowledge ?? true,
        };
      }),
      sourceRef: input.sourceRef ?? null,
      targetRoute: input.targetRoute ?? null,
    };
    notification.escalation = notification.escalation.map((step) =>
      this.channelEligible(notification.priority, step.channel) ? step : { ...step, state: "skipped", sentAt: null },
    );
    this.w.state.notifications.push(notification);
    this.persist(notification);
    this.scheduleEscalation(notification);
    const correlationId = input.correlationId ?? this.w.correlationId();
    this.w.emitFor("notifications", "friday.notification.created", notification, `notification/${notification.id}`, correlationId);
    this.w.recordAudit({
      category: "system",
      action: "notification.created",
      severity: input.priority === "P0" ? "critical" : input.priority === "P1" ? "warning" : "info",
      correlationId,
      adapterId: "mock-notifications",
      actor: { type: "system", id: "control-api", name: "Control API" },
      after: { priority: input.priority, category: input.category },
    });
    this.w.refresh();
    return notification;
  }

  /** Closes alerts that belong to a finished resource (e.g. an approval that was decided). */
  resolveForRef(refId: string): void {
    for (const notification of this.w.state.notifications) {
      if (notification.sourceRef?.id === refId && notification.status !== "resolved") this.markResolved(notification, undefined);
    }
  }

  scheduleTimers(): void {
    for (const handles of this.timers.values()) for (const handle of handles) handle.cancel();
    this.timers.clear();
    for (const notification of this.w.state.notifications) {
      if (notification.status === "open" || (notification.status === "acknowledged" && notification.escalation.some((step) => step.state === "pending" && step.stopOnAcknowledge === false))) this.scheduleEscalation(notification);
      if (notification.status === "snoozed") this.scheduleSnooze(notification);
    }
  }

  private persist(notification: Notification): void {
    this.w.notificationPersistence?.save(notification, notification.escalation.some((step) => step.state === "pending"));
  }

  private channelEligible(priority: Priority, channel: Channel): boolean {
    const configured = this.w.state.settings.notifications.channels.find((entry) => entry.kind === channel);
    const supportedAccount = !["telegram", "whatsapp", "sms"].includes(channel) ||
      configured?.accountId === undefined || configured.accountId === "default";
    return Boolean(configured?.enabled && supportedAccount && priorityRank(priority) <= priorityRank(configured.minPriority));
  }

  private quietHoursActive(nowMs: number, priority: Priority): boolean {
    const quiet = this.w.state.settings.notifications.quietHours;
    if (!quiet.enabled || priority === "P0" || priority === "P1") return false;
    const timeZone = this.w.state.settings.profile.timeZone;
    try {
      const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(nowMs);
      const current = Number(parts.find((part) => part.type === "hour")?.value) * 60 + Number(parts.find((part) => part.type === "minute")?.value);
      const from = Number(quiet.from.slice(0, 2)) * 60 + Number(quiet.from.slice(3));
      const to = Number(quiet.to.slice(0, 2)) * 60 + Number(quiet.to.slice(3));
      return from <= to ? current >= from && current < to : current >= from || current < to;
    } catch {
      return false;
    }
  }

  private markResolved(notification: Notification, ctx: OpContext | undefined, comment?: string): void {
    const now = this.w.nowIso();
    this.stopEscalation(notification, now);
    notification.status = "resolved";
    notification.resolved = true;
    notification.resolvedAt = now;
    if (!notification.acknowledged) {
      notification.acknowledged = true;
      notification.acknowledgedAt = now;
    }
    notification.snoozedUntil = null;
    this.commit(notification, ctx, "notification.resolved", comment);
  }

  /** Acknowledging stops the chain: the last sent step is marked acknowledged, open steps are skipped. */
  private stopEscalation(notification: Notification, now: string, acknowledge = true): void {
    if (!acknowledge) {
      for (const handle of this.timers.get(notification.id) ?? []) handle.cancel();
      this.timers.delete(notification.id);
    }
    let lastSent = -1;
    notification.escalation.forEach((step, index) => {
      if (step.state === "sent") lastSent = index;
    });
    notification.escalation = notification.escalation.map((step, index) => {
      if (acknowledge && index === lastSent) return { ...step, state: "acknowledged" as const, acknowledgedAt: now };
      if ((step.state === "pending" || step.state === "awaiting_approval") && (acknowledge ? step.stopOnAcknowledge !== false : true)) return { ...step, state: "skipped" as const };
      return step;
    });
  }

  private scheduleEscalation(notification: Notification): void {
    for (const step of notification.escalation) {
      if (step.state !== "pending") continue;
      const delay = Math.max(0, Date.parse(step.scheduledAt) - this.w.nowMs());
      this.scheduleEscalationStep(notification.id, step.step, delay);
    }
  }

  private scheduleEscalationStep(notificationId: string, stepNumber: number, delay: number): void {
    const handle = this.w.clock.setTimeout(() => {
      this.forgetTimer(notificationId, handle);
      const current = this.w.state.notifications.find((candidate) => candidate.id === notificationId);
      const target = current?.escalation.find((entry) => entry.step === stepNumber);
      if (!current || !target || target.state !== "pending") return;
      if (!this.channelEligible(current.priority, target.channel) || (current.status !== "open" && !(current.status === "acknowledged" && target.stopOnAcknowledge === false))) {
        target.state = "skipped";
        this.persist(current);
        return;
      }
      if (target.channel !== "dashboard" && this.quietHoursActive(this.w.nowMs(), current.priority)) {
        this.scheduleEscalationStep(notificationId, stepNumber, 60_000);
        return;
      }
      target.state = target.channel === "dashboard" ? "sent" : "awaiting_approval";
      target.sentAt = target.channel === "dashboard" ? this.w.nowIso() : null;
      this.w.bump(current);
      this.persist(current);
      this.w.emitFor("notifications", "friday.notification.updated", current, `notification/${current.id}`);
      this.w.refresh();
    }, delay);
    this.timers.set(notificationId, [...(this.timers.get(notificationId) ?? []), handle]);
  }

  private forgetTimer(notificationId: string, handle: TimerHandle): void {
    const remaining = (this.timers.get(notificationId) ?? []).filter((entry) => entry !== handle);
    if (remaining.length) this.timers.set(notificationId, remaining);
    else this.timers.delete(notificationId);
  }

  private scheduleSnooze(notification: Notification): void {
    if (!notification.snoozedUntil) return;
    const delay = Math.max(0, Date.parse(notification.snoozedUntil) - this.w.nowMs());
    const handle = this.w.clock.setTimeout(() => {
      const current = this.w.state.notifications.find((candidate) => candidate.id === notification.id);
      if (!current || current.status !== "snoozed") return;
      current.status = "open";
      current.snoozedUntil = null;
      this.w.bump(current);
      this.persist(current);
      this.w.emitFor("notifications", "friday.notification.updated", current, `notification/${current.id}`);
      this.w.refresh();
    }, delay);
    this.timers.set(notification.id, [...(this.timers.get(notification.id) ?? []), handle]);
  }

  private commit(notification: Notification, ctx: OpContext | undefined, action: string, comment?: string): void {
    this.w.bump(notification);
    this.persist(notification);
    const correlationId = this.w.correlationId(ctx);
    this.w.emitFor("notifications", "friday.notification.updated", notification, `notification/${notification.id}`, correlationId);
    this.w.recordAudit({
      category: "user_action",
      action,
      correlationId,
      adapterId: "mock-notifications",
      actor: this.w.actorOf(ctx),
      after: { status: notification.status, priority: notification.priority },
      context: comment ? { comment } : {},
    });
    this.w.refresh();
  }
}
