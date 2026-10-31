import { CONTRACT_VERSION, type DashboardNavigation, type Task, type VoiceDomainTask, type VoiceDomainTaskReplyRequest, type VoiceDomainTaskRequest } from "@friday/sdk";
import type { Handler } from "../http/context";
import type { OperationId } from "../http/route-types";
import { routeAgentTask } from "../services/task-model-routing";
import { DOMAIN_RESULT_HINT, DOMAINS, domainTaskTitle, resolveDomainAgent } from "../services/domain-routing";
import { ApiError, forbidden, validationFailed } from "../util/errors";

type Ctx = Parameters<Handler>[0];

const single = <T>(data: T) => ({ contractVersion: CONTRACT_VERSION, data, freshness: { state: "fresh" as const, asOf: new Date().toISOString() } });

const DOMAIN_TENANT_PREFIX = "tenant:voice-";

function requireVoiceBridge(ctx: Ctx): void {
  if (!ctx.voiceBridgeAuthorized || !ctx.runtime.auth.ownerPasswordConfigured() ||
    ctx.runtime.auth.devMode && ctx.runtime.config.server.allowRemote) {
    throw forbidden("Sprachauftraege an Domain-Agenten erfordern den lokalen Voice-Dienst und ein eingerichtetes Besitzerkonto.");
  }
}

function lastErrorMessage(task: Task): string | null {
  const message = task.errors.at(-1)?.message;
  return message?.trim() ? message.slice(0, 500) : null;
}

function taskQuestion(task: Task): string | null {
  if (task.status !== "waiting") return null;
  const blocker = (task.blockers ?? []).find((entry) => entry.kind === "input_needed");
  const description = blocker?.description?.trim();
  return description ? description.slice(0, 1000) : null;
}

function voiceTaskView(task: Task, domain: VoiceDomainTask["domain"]): VoiceDomainTask {
  return { taskId: task.id, domain, agentName: task.agentName ?? null, status: task.status,
    resultSummary: task.resultSummary ?? null, error: lastErrorMessage(task), question: taskQuestion(task) };
}

function domainOf(task: Task): VoiceDomainTask["domain"] | null {
  for (const label of task.labels ?? []) {
    if (!label.startsWith(DOMAIN_TENANT_PREFIX)) continue;
    const rest = label.slice(DOMAIN_TENANT_PREFIX.length);
    if (DOMAINS.includes(rest as VoiceDomainTask["domain"])) return rest as VoiceDomainTask["domain"];
  }
  return null;
}

export const voiceTaskHandlers: Partial<Record<OperationId, Handler>> = {
  async requestDashboardNavigation(ctx) {
    requireVoiceBridge(ctx);
    const request = ctx.body as DashboardNavigation;
    ctx.runtime.hub.publish("control-api://voice-navigation", { type: "friday.ui.navigation_requested", subject: `ui/${request.area}`, data: request });
    ctx.audit.action = "ui.navigation_requested";
    ctx.audit.after = { area: request.area, tour: request.tour };
    return { status: 200, body: { contractVersion: CONTRACT_VERSION, accepted: true, status: "completed", correlationId: ctx.correlationId,
      message: request.tour ? "Tour gestartet." : "Bereich geöffnet." } };
  },
  async createVoiceDomainTask(ctx) {
    requireVoiceBridge(ctx);
    if (!ctx.mutation.idempotencyKey) throw validationFailed("Ein Idempotency-Key ist fuer den Sprachauftrag erforderlich.");
    const create = ctx.runtime.registry.getPort("tasks").createTask;
    if (!create) throw new ApiError({ code: "CAPABILITY_MISSING", message: "Aufgaben koennen derzeit nicht angelegt werden." });
    const request = ctx.body as VoiceDomainTaskRequest;
    const agent = await resolveDomainAgent(ctx, request.domain);
    const body = routeAgentTask({
      title: domainTaskTitle(request.text),
      description: `${request.text}\n\n${DOMAIN_RESULT_HINT}`,
      priority: "P2",
      agentId: agent.id,
      labels: [`${DOMAIN_TENANT_PREFIX}${request.domain}`],
    }, ctx.runtime.settings.area("modelsRouting"));
    const created = await create({ body }, ctx.mutation);
    ctx.audit.action = "tasks.voice_domain_task_created";
    ctx.audit.after = { taskId: created.data.id, domain: request.domain, agentId: agent.id };
    return { status: 201, body: single(voiceTaskView(created.data, request.domain)) };
  },
  async getVoiceDomainTask(ctx) {
    requireVoiceBridge(ctx);
    const task = (await ctx.runtime.registry.getPort("tasks").getTask({ id: ctx.pathParams.taskId as string }, ctx.call)).data;
    const domain = domainOf(task);
    if (!domain) throw new ApiError({ code: "NOT_FOUND", message: "Diese Aufgabe stammt nicht aus einem Sprachauftrag." });
    return { status: 200, body: single(voiceTaskView(task, domain)) };
  },
  async cancelVoiceDomainTask(ctx) {
    requireVoiceBridge(ctx);
    const task = (await ctx.runtime.registry.getPort("tasks").getTask({ id: ctx.pathParams.taskId as string }, ctx.call)).data;
    const domain = domainOf(task);
    if (!domain) throw new ApiError({ code: "NOT_FOUND", message: "Diese Aufgabe stammt nicht aus einem Sprachauftrag." });
    if (task.status === "done" || task.status === "failed" || task.status === "cancelled") {
      return { status: 200, body: single(voiceTaskView(task, domain)) };
    }
    const cancel = ctx.runtime.registry.getPort("tasks").cancelTask;
    if (!cancel) throw new ApiError({ code: "CAPABILITY_MISSING", message: "Aufgaben koennen derzeit nicht abgebrochen werden." });
    const cancelled = await cancel({ id: task.id, body: { reason: "Per Sprache abgebrochen." } }, ctx.mutation);
    ctx.audit.action = "tasks.voice_domain_task_cancelled";
    ctx.audit.after = { taskId: task.id, domain };
    return { status: 200, body: single(voiceTaskView(cancelled.data, domain)) };
  },
  async replyVoiceDomainTask(ctx) {
    requireVoiceBridge(ctx);
    if (!ctx.mutation.idempotencyKey) throw validationFailed("Ein Idempotency-Key ist fuer die Sprachantwort erforderlich.");
    const task = (await ctx.runtime.registry.getPort("tasks").getTask({ id: ctx.pathParams.taskId as string }, ctx.call)).data;
    const domain = domainOf(task);
    if (!domain) throw new ApiError({ code: "NOT_FOUND", message: "Diese Aufgabe stammt nicht aus einem Sprachauftrag." });
    const blocker = (task.blockers ?? []).find((entry) => entry.kind === "input_needed");
    if (task.status !== "waiting" || !blocker) {
      throw new ApiError({ code: "CONFLICT", message: "Diese Aufgabe wartet gerade auf keine Antwort." });
    }
    const provide = ctx.runtime.registry.getPort("tasks").provideTaskInput;
    if (!provide) throw new ApiError({ code: "CAPABILITY_MISSING", message: "Antworten an Agenten sind mit diesem Aufgabenanbieter nicht moeglich." });
    const request = ctx.body as VoiceDomainTaskReplyRequest;
    const answered = await provide({ id: task.id, body: { input: request.answer, blockerId: blocker.id } }, ctx.mutation);
    ctx.audit.action = "tasks.voice_task_reply";
    ctx.audit.after = { taskId: task.id, domain };
    return { status: 200, body: single(voiceTaskView(answered.data, domain)) };
  },
};
