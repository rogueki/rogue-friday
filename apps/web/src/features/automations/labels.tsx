import type { AutomationRun } from "@friday/sdk";
import type { AutomationDto as Automation } from "@/lib/api/domains/automations";
import type { Tone } from "@friday/ui";
import { Bell, CheckSquare, Cpu, FilePenLine, Flag, Globe, PhoneCall, type LucideIcon } from "lucide-react";
import type { MessageKey } from "@/i18n";
import type { ActionType, ChannelId, Operator, TriggerType } from "./wizardModel";

export type RunStatus = AutomationRun["status"];
export type ActionStatus = AutomationRun["actionsExecuted"][number]["status"];

export const triggerTypeKey = (type: TriggerType): MessageKey => `automations.trigger.${type}` as MessageKey;
export const operatorKey = (operator: Operator): MessageKey => `automations.operator.${operator}` as MessageKey;
export const actionTypeKey = (type: ActionType): MessageKey => `automations.action.${type}` as MessageKey;
export const channelKey = (channel: ChannelId): MessageKey => `communication.kind.${channel}` as MessageKey;
export const runStatusKey = (status: RunStatus): MessageKey => `automations.run.status.${status}` as MessageKey;
export const actionStatusKey = (status: ActionStatus): MessageKey => `automations.run.actionStatus.${status}` as MessageKey;

export const RUN_TONE: Record<RunStatus, Tone> = { running: "cyan", succeeded: "green", failed: "red", skipped: "muted", dry_run: "blue" };
export const ACTION_TONE: Record<ActionStatus, Tone> = { succeeded: "green", failed: "red", skipped: "muted", simulated: "blue" };

export const ACTION_ICON: Record<ActionType, LucideIcon> = {
  notify: Bell,
  create_task: CheckSquare,
  draft_message: FilePenLine,
  call: PhoneCall,
  run_agent: Cpu,
  set_priority: Flag,
  webhook: Globe,
};

export type AutomationState = "active" | "paused" | "inactive";

/** A disabled automation never runs; an enabled-but-paused one is held by "Pause All" and resumes without re-enabling. */
export function automationState(automation: Pick<Automation, "enabled" | "paused">): AutomationState {
  if (!automation.enabled) return "inactive";
  return automation.paused ? "paused" : "active";
}

export const STATE_TONE: Record<AutomationState, Tone> = { active: "green", paused: "amber", inactive: "muted" };
export const stateKey = (state: AutomationState): MessageKey => `automations.state.${state}` as MessageKey;

/** "Every" duration for escalation steps: 600 s -> "10 Min.". */
export function afterLabel(seconds: number, units: { minutes: string; hours: string }): string {
  const minutes = Math.round(seconds / 60);
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60} ${units.hours}`;
  return `${minutes} ${units.minutes}`;
}

export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  const seconds = ms / 1000;
  return seconds < 60 ? `${seconds.toFixed(1).replace(/\.0$/, "")} s` : `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
}
