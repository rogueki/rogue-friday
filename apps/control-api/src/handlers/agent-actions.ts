import { CONTRACT_VERSION, type Agent, type AgentResponse, type TaskAssignRequest, type TaskResponse } from "@friday/sdk";
import { isAdapterError } from "@friday/adapter-core";
import type { Handler, RequestContext } from "../http/context";
import type { OperationId } from "../http/route-types";
import type { NativeExecutableAction } from "../services/native-approval-requests";
import { ApiError, conflict, validationFailed } from "../util/errors";

const single = <T>(data: T) => ({ contractVersion: CONTRACT_VERSION, data, freshness: { state: "fresh" as const, asOf: new Date().toISOString() } });

const PREVIEW_ID = /^corr_[0-9A-Za-z]{26}$/;
/** Mirrors the lifecycle rules of the agents port: pausing needs live work, resuming a paused agent, stopping an active one. */
const PAUSEABLE = ["idle", "starting", "working", "waiting"];
const STOPPABLE = ["starting", "working", "waiting", "paused", "error"];
const TASK_FINAL = ["done", "failed", "cancelled"];
/** Terminal states of the native coding runner (installer/wsl/coding_runner.py). */
export const CODING_RUN_TERMINAL = ["completed", "failed", "cancelled", "interrupted", "timed_out"];

export const AGENT_LIFECYCLE_VERB = { pause: "pausieren", resume: "fortsetzen", stop: "stoppen" } as const;

/**
 * The lifecycle rules of the agents port, checked before staging: pausing needs live work, resuming needs a paused
 * agent, stopping needs active work. The port re-checks the same rules at dispatch.
 */
export function assertAgentTransition(agent: Agent, capability: "pause" | "resume" | "stop"): void {
  if (capability === "pause" && !PAUSEABLE.includes(agent.status)) {
    throw conflict(`Agent ${agent.name} kann im Status ${agent.status} nicht pausiert werden.`, { status: agent.status });
  }
  if (capability === "resume" && agent.status !== "paused") {
    throw conflict(`Agent ${agent.name} ist nicht pausiert.`, { status: agent.status });
  }
  if (capability === "stop" && !STOPPABLE.includes(agent.status)) {
    throw conflict(`Agent ${agent.name} führt keine Arbeit aus.`, { status: agent.status });
  }
}

export function agentLifecyclePreviewText(capability: "pause" | "resume" | "stop", name: string): string {
  return capability === "stop"
    ? `Agent „${name}“ stoppen? Laufende Arbeit wird beendet, Verlauf bleibt erhalten.`
    : `Agent „${name}“ ${AGENT_LIFECYCLE_VERB[capability]}?`;
}

interface AgentWrite {
  capability: "pause" | "resume" | "stop" | "assignTask";
  unavailable: string;
  action: NativeExecutableAction;
  actionText: string;
  previewTitle: string;
  previewText: string;
}

/** The port method must exist and the capability module must offer the flag before anything is staged. */
function checkCapability(ctx: RequestContext, write: AgentWrite): void {
  const agents = ctx.runtime.registry.getPort("agents");
  const method = write.capability === "assignTask" ? agents.assignTask
    : write.capability === "pause" ? agents.pauseAgent
    : write.capability === "resume" ? agents.resumeAgent : agents.stopAgent;
  if (!method || !ctx.runtime.capabilities().modules.agents[write.capability]) {
    throw new ApiError({ code: "CAPABILITY_MISSING", message: write.unavailable,
      details: { capability: `agents.${write.capability}` } });
  }
}

/**
 * Stages the exact agent write as a draft, binds confirmation to the unchanged action and either hands it to the
 * tier-2 approval flow or lets the caller execute it once. Throws for every non-executable stage.
 */
function enforceAgentWrite(ctx: RequestContext, ownerId: string, write: AgentWrite): string {
  const confirmedPreviewId = ctx.headers["x-action-preview-id"];
  if (confirmedPreviewId !== undefined && !PREVIEW_ID.test(confirmedPreviewId)) {
    throw validationFailed("Die Vorschaukennung ist ungueltig.", [{ path: "X-Action-Preview-Id", message: "ungueltig" }]);
  }
  if (!confirmedPreviewId) {
    const previewId = ctx.correlationId;
    ctx.runtime.nativeApprovals.propose({ ownerId, requestKey: previewId, correlationId: ctx.correlationId,
      riskTier: 2, type: "system_change", action: write.actionText,
      rationale: "Agentenaktion aus bestaetigter API-Anfrage", preview: { kind: "text", title: write.previewTitle,
        body: JSON.stringify(write.action) }, impacts: [], execution: write.action });
    throw new ApiError({ code: "APPROVAL_REQUIRED", message: "Aktion zuerst mit unveraenderter Vorschau bestaetigen.",
      details: { stage: "preview", previewId, previewText: write.previewText } });
  }
  const policy = ctx.runtime.nativeApprovals.confirm(ownerId, confirmedPreviewId, write.action);
  if (policy.approval) {
    throw new ApiError({ code: "APPROVAL_REQUIRED", message: "Aktion wartet auf Freigabe.",
      details: { stage: "approval", approvalId: policy.approval.id,
        targetRoute: `/approvals?approval=${policy.approval.id}` } });
  }
  return confirmedPreviewId;
}

/** Dispatches the stored agent write once; the port call carries the pipeline idempotency key. */
async function executeAgentWrite(ctx: RequestContext, ownerId: string, previewId: string): Promise<string> {
  const agents = ctx.runtime.registry.getPort("agents");
  return ctx.runtime.nativeApprovals.executeWithoutApproval(ownerId, previewId,
    async (savedAction, idempotencyKey) => {
      const call = { ...ctx.mutation, idempotencyKey };
      if (savedAction.kind === "agent.pause") return (await agents.pauseAgent!({ id: savedAction.id }, call)).data.id;
      if (savedAction.kind === "agent.resume") return (await agents.resumeAgent!({ id: savedAction.id }, call)).data.id;
      if (savedAction.kind === "agent.stop") return (await agents.stopAgent!({ id: savedAction.id }, call)).data.id;
      if (savedAction.kind === "agent.assign") {
        return (await agents.assignTask!({ id: savedAction.id, body: savedAction.body }, call)).data.id;
      }
      if (savedAction.kind === "codingrun.stop") {
        return (await ctx.runtime.codingRuns.stop(savedAction.id)).runId;
      }
      throw conflict("Die Bestaetigung passt nicht zum gespeicherten Entwurf.");
    });
}

async function agentResponse(ctx: RequestContext, agentId: string) {
  const agent = await ctx.runtime.registry.getPort("agents").getAgent({ id: agentId }, ctx.call);
  const response: AgentResponse = { contractVersion: CONTRACT_VERSION, data: agent.data, freshness: agent.freshness };
  ctx.audit.agentId = agentId;
  return { status: 200, body: response };
}

/**
 * A lifecycle action on one agent: unknown agents fail 404 and a status that forbids the transition fails 409 before
 * any preview is staged; the port re-checks the same rules at dispatch, so a drifted state can never apply twice.
 */
async function lifecycle(ctx: RequestContext, ownerId: string, capability: "pause" | "resume" | "stop",
  id: string): Promise<{ status: number; body: unknown }> {
  const verb = capability === "pause" ? "pausieren" : capability === "resume" ? "fortsetzen" : "stoppen";
  const action: NativeExecutableAction = capability === "pause" ? { kind: "agent.pause", id }
    : capability === "resume" ? { kind: "agent.resume", id } : { kind: "agent.stop", id };
  const write: AgentWrite = { capability,
    unavailable: `Agenten koennen derzeit nicht ${capability === "pause" ? "pausiert" : capability === "resume" ? "fortgesetzt" : "gestoppt"} werden.`,
    action, actionText: "", previewTitle: `Agent ${verb}`, previewText: "" };
  checkCapability(ctx, write);
  if (!ctx.headers["x-action-preview-id"]) {
    const current = (await ctx.runtime.registry.getPort("agents").getAgent({ id }, ctx.call)).data;
    assertAgentTransition(current, capability);
    write.actionText = `Agent ${verb}: ${current.name}`;
    write.previewText = agentLifecyclePreviewText(capability, current.name);
  }
  const previewId = enforceAgentWrite(ctx, ownerId, write);
  return agentResponse(ctx, await executeAgentWrite(ctx, ownerId, previewId));
}

/** Direct API agent writes share the same saved draft, approval decision and port receipt as command writes. */
export const agentActionHandlers: Partial<Record<OperationId, Handler>> = {
  async pauseAgent(ctx) {
    const ownerId = ctx.principal?.userId;
    if (!ownerId) throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung erforderlich." });
    ctx.audit.action = "agent.paused";
    ctx.audit.severity = "warning";
    return lifecycle(ctx, ownerId, "pause", ctx.pathParams.id as string);
  },
  async resumeAgent(ctx) {
    const ownerId = ctx.principal?.userId;
    if (!ownerId) throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung erforderlich." });
    ctx.audit.action = "agent.resumed";
    return lifecycle(ctx, ownerId, "resume", ctx.pathParams.id as string);
  },
  async stopAgent(ctx) {
    const ownerId = ctx.principal?.userId;
    if (!ownerId) throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung erforderlich." });
    ctx.audit.action = "agent.stopped";
    ctx.audit.severity = "warning";
    return lifecycle(ctx, ownerId, "stop", ctx.pathParams.id as string);
  },
  async assignTask(ctx) {
    const ownerId = ctx.principal?.userId;
    if (!ownerId) throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung erforderlich." });
    const tasks = ctx.runtime.registry.getPort("tasks");
    const id = ctx.pathParams.id as string;
    const body = ctx.body as TaskAssignRequest;
    const write: AgentWrite = { capability: "assignTask",
      unavailable: "Aufgaben koennen derzeit keinem Agenten zugewiesen werden.",
      action: { kind: "agent.assign", id, body }, actionText: "", previewTitle: "Aufgabe zuweisen", previewText: "" };
    checkCapability(ctx, write);
    // Unknown task or agent and finished tasks fail before any preview is staged.
    if (!ctx.headers["x-action-preview-id"]) {
      const current = (await tasks.getTask({ id }, ctx.call)).data;
      if (TASK_FINAL.includes(current.status)) {
        throw conflict(`Beendete Aufgaben (${current.status}) können nicht neu zugewiesen werden.`, { status: current.status });
      }
      let agent: Agent | null = null;
      if (body.agentId !== null) {
        // The wire contract answers an unknown agent as a validation error, exactly like the port does at dispatch.
        try {
          agent = (await ctx.runtime.registry.getPort("agents").getAgent({ id: body.agentId }, ctx.call)).data;
        } catch (error) {
          if (isAdapterError(error) && error.code === "NOT_FOUND") {
            throw validationFailed("Der angegebene Agent existiert nicht.", [{ path: "agentId", message: "unbekannt" }]);
          }
          throw error;
        }
      }
      write.actionText = agent ? `Aufgabe zuweisen: ${current.title} an ${agent.name}` : `Aufgabe freigeben: ${current.title}`;
      write.previewText = agent
        ? `Aufgabe „${current.title}“ an ${agent.name} zuweisen?`
        : `Aufgabe „${current.title}“ freigeben (kein Agent)?`;
    }
    const previewId = enforceAgentWrite(ctx, ownerId, write);
    const taskId = await executeAgentWrite(ctx, ownerId, previewId);
    const task = await tasks.getTask({ id: taskId }, ctx.call);
    const response: TaskResponse = { contractVersion: CONTRACT_VERSION, data: task.data, freshness: task.freshness };
    ctx.audit.action = "task.assigned";
    ctx.audit.taskId = taskId;
    ctx.audit.agentId = body.agentId;
    return { status: 200, body: response };
  },
  async stopCodingRun(ctx) {
    const ownerId = ctx.principal?.userId;
    if (!ownerId) throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung erforderlich." });
    const runId = ctx.pathParams.runId as string;
    const write: AgentWrite = { capability: "stop",
      unavailable: "",
      action: { kind: "codingrun.stop", id: runId }, actionText: `Coding-Lauf abbrechen: ${runId}`,
      previewTitle: "Coding-Lauf abbrechen", previewText: `Coding-Lauf ${runId} abbrechen? Laufende Arbeit wird beendet.` };
    if (!ctx.headers["x-action-preview-id"]) {
      // An unknown run id answers 404 and a terminal run 409 before anything is staged.
      const current = await ctx.runtime.codingRuns.status(runId);
      if (CODING_RUN_TERMINAL.includes(current.status)) {
        throw conflict(`Coding-Lauf ${runId} ist bereits beendet (${current.status}).`, { status: current.status });
      }
    }
    const previewId = enforceAgentWrite(ctx, ownerId, write);
    const stoppedId = await executeAgentWrite(ctx, ownerId, previewId);
    const run = await ctx.runtime.codingRuns.status(stoppedId);
    ctx.audit.action = "skills.coding_run_stopped";
    ctx.audit.severity = "warning";
    ctx.audit.after = { runId: run.runId };
    return { status: 200, body: single(run) };
  },
};
