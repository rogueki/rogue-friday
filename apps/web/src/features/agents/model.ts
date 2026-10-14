import type { Agent, AgentStatus, ReasoningLevel } from "@jarvis/sdk";
import type { Tone } from "@jarvis/ui";

export const AGENT_STATUSES: readonly AgentStatus[] = ["working", "starting", "waiting", "idle", "paused", "error", "offline"];
export const REASONING_LEVELS: readonly ReasoningLevel[] = ["none", "low", "medium", "high", "max"];

export const AGENT_STATUS_TONE: Record<AgentStatus, Tone> = {
  working: "green",
  starting: "cyan",
  waiting: "amber",
  idle: "cyan",
  paused: "blue",
  error: "red",
  offline: "muted",
};

/** Heartbeat older than this on a live agent counts as delayed (the server pings far more often). */
export const HEARTBEAT_WARN_MS = 90_000;

export type AgentActionId = "pause" | "resume" | "stop" | "assignTask";

/** Statuses in which an action makes sense; the button stays visible and names the reason otherwise. */
export const ACTION_STATUSES: Record<Exclude<AgentActionId, "assignTask">, readonly AgentStatus[]> = {
  pause: ["working", "starting", "waiting"],
  resume: ["paused"],
  stop: ["working", "starting", "waiting", "paused", "error"],
};

export function heartbeatDelayed(agent: Pick<Agent, "heartbeatAt" | "status">, now: Date): boolean {
  if (agent.status === "offline" || agent.status === "idle" || agent.status === "paused") return false;
  if (!agent.heartbeatAt) return true;
  const at = Date.parse(agent.heartbeatAt);
  return Number.isNaN(at) || now.getTime() - at > HEARTBEAT_WARN_MS;
}

/** Success rate in percent, or `null` when the adapter reports none (never invented from the counters). */
export function successPercent(agent: Pick<Agent, "successRate">): number | null {
  if (agent.successRate === null || !Number.isFinite(agent.successRate)) return null;
  return Math.min(100, Math.max(0, Math.round(agent.successRate * 100)));
}

const SECRET_KEY = /(secret|token|password|passwd|credential|api[-_]?key|private[-_]?key|authorization)/i;

/** Configuration values for display; anything that looks like a credential is masked (PLAN §49.6: no secrets in the browser). */
export function displayConfiguration(configuration: Agent["configuration"]): { key: string; value: string; masked: boolean }[] {
  return Object.entries(configuration ?? {}).map(([key, value]) => {
    if (SECRET_KEY.test(key)) return { key, value: "••••••••", masked: true };
    return { key, value: typeof value === "string" ? value : JSON.stringify(value), masked: false };
  });
}
