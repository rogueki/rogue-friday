import type { AgentStatus, Priority, TaskStatus } from "@jarvis/sdk";
import { AdapterError } from "@jarvis/adapter-core";

/** `tasks.status` values of Hermes' default workflow (kanban_workflow.DEFAULT_STATUSES, mapping doc §6.4). */
export const HERMES_STATUSES = [
  "triage",
  "todo",
  "scheduled",
  "ready",
  "running",
  "blocked",
  "review",
  "done",
  "archived",
] as const;
export type HermesStatus = (typeof HERMES_STATUSES)[number];

const BASE_STATUS: Readonly<Record<HermesStatus, TaskStatus>> = {
  triage: "triage",
  todo: "todo",
  scheduled: "waiting",
  ready: "ready",
  running: "running",
  blocked: "waiting",
  review: "review",
  done: "done",
  archived: "cancelled",
};

export function isHermesStatus(value: string): value is HermesStatus {
  return (HERMES_STATUSES as readonly string[]).includes(value);
}

/**
 * Hermes status -> canonical `TaskStatus` (mapping doc §6.4). `failed` has no Hermes status: it is derived from
 * `last_failure_error` on a task that is back in `ready`/`blocked` (assumption 9.4, not live-verified). An unknown
 * status is rejected instead of being filed under a wrong column.
 */
export function toTaskStatus(status: string, lastFailureError: string | null): TaskStatus {
  if (!isHermesStatus(status)) {
    throw new AdapterError({
      code: "VALIDATION_FAILED",
      message: `Unbekannter Hermes-Status '${status.slice(0, 40)}'.`,
      retryable: false,
      details: { status: status.slice(0, 40) },
    });
  }
  if ((status === "ready" || status === "blocked") && lastFailureError !== null && lastFailureError !== "") {
    return "failed";
  }
  return BASE_STATUS[status];
}

/**
 * Canonical status -> value for `PATCH /tasks/{id}`. Only transitions that Hermes lets a human trigger are offered;
 * `running` (dispatcher only), `failed` (derived) and `cancelled` (archiving is not live-verified) are rejected.
 */
export function toHermesPatchStatus(status: TaskStatus): string {
  switch (status) {
    case "triage":
    case "todo":
    case "ready":
    case "review":
    case "done":
      return status;
    case "waiting":
      return "blocked";
    case "running":
      throw unsupported("Der Status 'running' setzt nur der Hermes-Dispatcher.");
    case "failed":
      throw unsupported("Der Status 'failed' wird aus Hermes abgeleitet und kann nicht gesetzt werden.");
    case "cancelled":
      throw unsupported(
        "Abbrechen (Archivieren) ist für Hermes nicht live verifiziert und deshalb nicht freigeschaltet.",
      );
  }
}

/** Hermes statuses a canonical status filter has to fetch (client side filtering refines the result). */
export function wantsArchived(statuses: readonly TaskStatus[] | undefined): boolean {
  return statuses?.includes("cancelled") === true;
}

export function unsupported(message: string): AdapterError {
  return new AdapterError({ code: "VALIDATION_FAILED", message, retryable: false });
}

/**
 * Priority proposal (mapping doc §6.1, assumption 9.3): Hermes uses an integer tiebreaker (higher first), so
 * `4..0 -> P0..P4`; out-of-range values clamp (`>= 4 -> P0`, `<= 0 -> P4`).
 */
export function toPriority(value: number): Priority {
  if (value >= 4) return "P0";
  if (value === 3) return "P1";
  if (value === 2) return "P2";
  if (value === 1) return "P3";
  return "P4";
}

const PRIORITY_VALUE: Readonly<Record<Priority, number>> = { P0: 4, P1: 3, P2: 2, P3: 1, P4: 0 };
export const toHermesPriority = (priority: Priority): number => PRIORITY_VALUE[priority];

/** Priority order for sorting: P0 first. */
export const priorityRank = (priority: Priority): number => 4 - PRIORITY_VALUE[priority];

export interface AgentStatusInput {
  gatewayRunning: boolean | null;
  hasWorker: boolean;
  waitingForInput: boolean;
}

/** `AgentStatus` per mapping doc §6.4; `starting`/`paused`/`error` have no verified Hermes source. */
export function toAgentStatus(input: AgentStatusInput): AgentStatus {
  if (input.gatewayRunning === false) return "offline";
  if (input.hasWorker) return "working";
  if (input.waitingForInput) return "waiting";
  return "idle";
}
