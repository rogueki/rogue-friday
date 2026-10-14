import type { Notification, Priority } from "@jarvis/sdk";
import type { Tone } from "@jarvis/ui";
import { AlertOctagon, AlertTriangle, Bell, CalendarDays, Cpu, Info, Mail, Mic, Plug, ShieldAlert, ShieldCheck, Workflow, type LucideIcon } from "lucide-react";
import type { MessageKey } from "@/i18n";

export type EscalationState = Notification["escalation"][number]["state"];
export type NotificationStatus = Notification["status"];
export type NotificationCategory = Notification["category"];

export const PRIORITIES: readonly Priority[] = ["P0", "P1", "P2", "P3", "P4"];
export const ACTIVE_STATUSES: NotificationStatus[] = ["open", "acknowledged", "snoozed"];
export const CATEGORIES: readonly NotificationCategory[] = ["system", "task", "approval", "mail", "calendar", "automation", "security", "voice", "adapter"];

/** P0/P1 are visually dominant through border, tint and a static icon: never through blinking (PLAN §39.3). */
export const PRIORITY_TONE: Record<Priority, Tone> = { P0: "red", P1: "amber", P2: "cyan", P3: "teal", P4: "muted" };
export const PRIORITY_ICON: Record<Priority, LucideIcon> = { P0: AlertOctagon, P1: AlertTriangle, P2: ShieldAlert, P3: Bell, P4: Info };

export const priorityKey = (priority: Priority): MessageKey => `alerts.priority.${priority}` as MessageKey;
export const statusKey = (status: NotificationStatus): MessageKey => `alerts.status.${status}` as MessageKey;
export const categoryKey = (category: NotificationCategory): MessageKey => `alerts.category.${category}` as MessageKey;
export const escalationStateKey = (state: EscalationState): MessageKey => `alerts.escalation.state.${state}` as MessageKey;

export const STATUS_TONE: Record<NotificationStatus, Tone> = { open: "red", acknowledged: "cyan", snoozed: "blue", resolved: "green" };
export const ESCALATION_TONE: Record<EscalationState, Tone> = { pending: "muted", sent: "amber", acknowledged: "green", failed: "red", skipped: "muted" };

export const CATEGORY_ICON: Record<NotificationCategory, LucideIcon> = {
  system: Cpu,
  task: Workflow,
  approval: ShieldCheck,
  mail: Mail,
  calendar: CalendarDays,
  automation: Workflow,
  security: ShieldAlert,
  voice: Mic,
  adapter: Plug,
};

export const priorityRank = (priority: Priority): number => PRIORITIES.indexOf(priority);

/** Most urgent first, newest first inside one priority. */
export function compareNotifications(a: Notification, b: Notification): number {
  return priorityRank(a.priority) - priorityRank(b.priority) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
}

/** Alerts that still need a decision (open) vs. handled ones. P0/P1 that are open are "prominent". */
export const isProminent = (notification: Notification): boolean => (notification.priority === "P0" || notification.priority === "P1") && notification.status === "open";
