import type { operations } from "@friday/sdk";
import { validationFailed } from "../../core/errors";
import { paginate, clone, type Page, type PageQuery } from "../../core/util";

/** Query parameters of an OpenAPI operation (typed from the generated SDK). */
export type Query<K extends keyof operations> = NonNullable<operations[K]["parameters"]["query"]>;

/** Cursor pagination returning detached copies of the page items. */
export function pageOf<T>(items: readonly T[], query: PageQuery): Page<T> {
  const page = paginate(items, query);
  return { items: clone(page.items), pageInfo: page.pageInfo };
}

/** Rejects values that are not part of an enum filter (VALIDATION_FAILED). */
export function checkEnum(name: string, values: readonly string[], allowed: readonly string[]): void {
  const invalid = values.filter((value) => !allowed.includes(value));
  if (invalid.length > 0) {
    throw validationFailed(`Ungültiger Wert für ${name}: ${invalid.join(", ")}.`, [{ path: name, message: `erlaubt: ${allowed.join(", ")}` }]);
  }
}

export const TASK_STATUSES = ["triage", "todo", "ready", "running", "waiting", "review", "done", "failed", "cancelled"] as const;
export const PRIORITIES = ["P0", "P1", "P2", "P3", "P4"] as const;
export const AGENT_STATUSES = ["idle", "starting", "working", "waiting", "paused", "error", "offline"] as const;
export const MEMORY_TYPES = ["profile", "preference", "fact", "person", "company", "project", "relationship", "instruction", "episode", "decision"] as const;
export const SENSITIVITIES = ["normal", "sensitive", "restricted"] as const;
export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "expired", "cancelled", "executed", "failed"] as const;
export const APPROVAL_TYPES = ["send_email", "change_event", "send_message", "delete_file", "order", "payment", "contract", "system_change"] as const;
export const FILE_CATEGORIES = ["generated", "uploaded", "reports", "presentations", "invoices", "research", "exports", "temporary"] as const;
export const ACTIVITY_KINDS = ["user_request", "task", "agent", "tool_call", "source_read", "result", "artifact", "adapter", "system"] as const;
export const SEVERITIES = ["info", "warning", "error", "critical"] as const;
export const NOTIFICATION_STATUSES = ["open", "acknowledged", "snoozed", "resolved"] as const;
export const THREAD_STATUSES = ["open", "waiting", "replied", "archived"] as const;
