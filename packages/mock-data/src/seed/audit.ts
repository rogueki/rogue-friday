import type { Actor, Agent, Approval, AuditEvent, Task } from "@friday/sdk";
import { createAuditEvent, type AuditDraft } from "../core/audit-chain";
import { DAY, HOUR, MIN, type SeedContext } from "./context";

interface Template {
  category: AuditEvent["category"];
  action: string;
  severity: AuditEvent["severity"];
  result: AuditEvent["result"];
  tool?: string;
  adapterId?: string;
  actorKind: "user" | "agent" | "system";
  errorCode?: AuditEvent["errorCode"];
}

const TEMPLATES: Template[] = [
  { category: "user_action", action: "task.created", severity: "info", result: "success", actorKind: "user", adapterId: "mock-tasks" },
  { category: "user_action", action: "settings.updated", severity: "info", result: "success", actorKind: "user", adapterId: "mock-system" },
  { category: "agent_action", action: "agent.task_started", severity: "info", result: "success", actorKind: "agent", adapterId: "mock-agents" },
  { category: "tool_call", action: "tool.web.fetch", severity: "info", result: "success", actorKind: "agent", tool: "web.fetch", adapterId: "mock-research" },
  { category: "tool_call", action: "tool.mail.draft", severity: "info", result: "success", actorKind: "agent", tool: "mail.draft", adapterId: "mock-communication" },
  { category: "tool_call", action: "tool.calendar.read", severity: "info", result: "success", actorKind: "agent", tool: "calendar.read", adapterId: "mock-calendar" },
  { category: "tool_call", action: "tool.system.service", severity: "error", result: "failure", actorKind: "agent", tool: "system.service", adapterId: "mock-system", errorCode: "ADAPTER_TIMEOUT" },
  { category: "approval", action: "approval.requested", severity: "info", result: "pending", actorKind: "agent", adapterId: "mock-approvals" },
  { category: "system", action: "adapter.health_changed", severity: "warning", result: "success", actorKind: "system", adapterId: "mock-system" },
  { category: "system", action: "backup.verified", severity: "info", result: "success", actorKind: "system", adapterId: "mock-system" },
  { category: "security", action: "auth.login", severity: "info", result: "success", actorKind: "user", adapterId: "mock-audit" },
  { category: "security", action: "csrf.rejected", severity: "warning", result: "denied", actorKind: "system", adapterId: "mock-audit", errorCode: "CSRF_INVALID" },
];

export interface AuditBuildOptions {
  tasks: Task[];
  agents: Agent[];
  approvals: Approval[];
  target: number;
}

function actorFor(ctx: SeedContext, kind: Template["actorKind"], agent: Agent | undefined): Actor {
  if (kind === "user") return ctx.owner;
  if (kind === "agent" && agent) return { type: "agent", id: agent.id, name: agent.name };
  return { type: "system", id: "control-api", name: "Control API" };
}

/** Chronologically ordered, hash-chained audit trail derived from approvals plus templated background events. */
export function buildAudit(ctx: SeedContext, options: AuditBuildOptions): { events: AuditEvent[]; sequence: number } {
  const drafts: AuditDraft[] = [];
  const agentById = new Map(options.agents.map((agent) => [agent.id, agent]));
  const make = (partial: Partial<AuditDraft> & Pick<AuditDraft, "occurredAt" | "actor" | "category" | "action" | "severity" | "result">): void => {
    drafts.push({
      durationMs: partial.durationMs ?? ctx.rng.int(5, 900),
      correlationId: partial.correlationId ?? ctx.id("corr"),
      before: null,
      after: null,
      artifactIds: [],
      childEventIds: [],
      ...partial,
    });
  };

  for (const approval of options.approvals) {
    const agent = approval.agentId ? agentById.get(approval.agentId) : undefined;
    make({
      occurredAt: approval.createdAt,
      actor: actorFor(ctx, "agent", agent),
      category: "approval",
      action: "approval.requested",
      severity: approval.riskTier === 3 ? "warning" : "info",
      result: "pending",
      agentId: approval.agentId,
      taskId: approval.taskId,
      approvalId: approval.id,
      adapterId: "mock-approvals",
      correlationId: approval.correlationId,
      context: { riskTier: approval.riskTier, type: approval.type },
      after: { status: "pending" },
    });
    if (approval.decidedAt && approval.decidedBy) {
      const action =
        approval.status === "rejected" ? "approval.rejected" : approval.status === "cancelled" ? "approval.cancelled" : "approval.approved";
      make({
        occurredAt: approval.decidedAt,
        actor: approval.decidedBy,
        category: "approval",
        action,
        severity: "info",
        result: "success",
        agentId: approval.agentId,
        taskId: approval.taskId,
        approvalId: approval.id,
        adapterId: "mock-approvals",
        correlationId: approval.correlationId,
        context: { riskTier: approval.riskTier, comment: approval.decisionComment ?? null },
        before: { status: "pending" },
        after: { status: approval.status === "rejected" ? "rejected" : "approved" },
      });
      if (approval.status === "executed" || approval.status === "failed") {
        make({
          occurredAt: new Date(Date.parse(approval.decidedAt) + 4_000).toISOString(),
          actor: { type: "system", id: "control-api", name: "Control API" },
          category: "system",
          action: approval.status === "executed" ? "approval.executed" : "approval.execution_failed",
          severity: approval.status === "executed" ? "info" : "error",
          result: approval.status === "executed" ? "success" : "failure",
          errorCode: approval.status === "failed" ? "ADAPTER_TIMEOUT" : null,
          approvalId: approval.id,
          taskId: approval.taskId,
          adapterId: "mock-approvals",
          correlationId: approval.correlationId,
          after: { status: approval.status },
        });
      }
    }
  }

  const taskIds = options.tasks.map((task) => task.id);
  let counter = 0;
  while (drafts.length < options.target) {
    const template = TEMPLATES[counter % TEMPLATES.length] as Template;
    const agent = options.agents.length ? ctx.rng.pick(options.agents) : undefined;
    const occurredAt = new Date(ctx.now - ctx.rng.int(1, 5 * 24 * 60) * MIN).toISOString();
    make({
      occurredAt,
      actor: actorFor(ctx, template.actorKind, agent),
      category: template.category,
      action: template.action,
      severity: template.severity,
      result: template.result,
      errorCode: template.errorCode ?? null,
      agentId: template.actorKind === "agent" ? (agent?.id ?? null) : null,
      taskId: taskIds.length ? ctx.rng.pick(taskIds) : null,
      tool: template.tool ?? null,
      adapterId: template.adapterId ?? null,
      model: template.actorKind === "agent" ? (agent?.model ?? null) : null,
      reasoningLevel: template.actorKind === "agent" ? (agent?.reasoningLevel ?? null) : null,
      context: { note: "Mock-Ereignis" },
    });
    counter++;
  }

  const capped = drafts.slice(0, Math.max(options.target, drafts.length));
  capped.sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  const events: AuditEvent[] = [];
  let prevHash: string | null = null;
  capped.forEach((draft, index) => {
    const event = createAuditEvent(draft, {
      id: ctx.id("aud"),
      sequence: index + 1,
      source: ctx.src("audit"),
      prevHash,
    });
    events.push(event);
    prevHash = event.hash;
  });
  return { events, sequence: events.length };
}

export const AUDIT_WINDOW_MS = 5 * DAY + HOUR;
