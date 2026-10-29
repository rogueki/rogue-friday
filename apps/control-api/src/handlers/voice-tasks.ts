import { CONTRACT_VERSION, type Agent, type Task, type VoiceDomainTask, type VoiceDomainTaskRequest } from "@friday/sdk";
import type { Handler } from "../http/context";
import type { OperationId } from "../http/route-types";
import { routeAgentTask } from "../services/task-model-routing";
import { ApiError, forbidden, validationFailed } from "../util/errors";

type Ctx = Parameters<Handler>[0];

const single = <T>(data: T) => ({ contractVersion: CONTRACT_VERSION, data, freshness: { state: "fresh" as const, asOf: new Date().toISOString() } });

const DOMAIN_TENANT_PREFIX = "tenant:voice-";
const RESULT_HINT = "Schliesse mit einer kurzen, vorlesbaren Zusammenfassung des Ergebnisses ab (hoechstens fuenf Saetze, keine Tabellen).";
// Hermes profiles carry the domain as profile name; the mock world only has display names.
const DOMAIN_NAME: Record<VoiceDomainTask["domain"], RegExp> = {
  research: /^recherche/i, tasks: /^(task|aufgaben)/i, alerts: /^(alert|alarm|warn)/i, audit: /^(audit|pr(ue|ü)f)/i,
};
const DOMAINS: ReadonlyArray<VoiceDomainTask["domain"]> = ["research", "tasks", "alerts", "audit"];

function requireVoiceBridge(ctx: Ctx): void {
  if (!ctx.voiceBridgeAuthorized || !ctx.runtime.auth.ownerPasswordConfigured() ||
    ctx.runtime.auth.devMode && ctx.runtime.config.server.allowRemote) {
    throw forbidden("Sprachauftraege an Domain-Agenten erfordern den lokalen Voice-Dienst und ein eingerichtetes Besitzerkonto.");
  }
}

async function resolveDomainAgent(ctx: Ctx, domain: VoiceDomainTask["domain"]): Promise<Agent> {
  const agents = (await ctx.runtime.registry.getPort("agents").listAgents({ limit: 200 }, ctx.call)).items;
  const agent = agents.find((entry) => entry.source.externalId === domain) ??
    agents.find((entry) => DOMAIN_NAME[domain].test(entry.name));
  if (!agent) throw new ApiError({ code: "CAPABILITY_MISSING", message: `Fuer den Bereich ${domain} ist kein Agent eingerichtet.` });
  return agent;
}

function lastErrorMessage(task: Task): string | null {
  const message = task.errors.at(-1)?.message;
  return message?.trim() ? message.slice(0, 500) : null;
}

function voiceTaskView(task: Task, domain: VoiceDomainTask["domain"]): VoiceDomainTask {
  return { taskId: task.id, domain, agentName: task.agentName ?? null, status: task.status,
    resultSummary: task.resultSummary ?? null, error: lastErrorMessage(task) };
}

function domainOf(task: Task): VoiceDomainTask["domain"] | null {
  for (const label of task.labels ?? []) {
    if (!label.startsWith(DOMAIN_TENANT_PREFIX)) continue;
    const rest = label.slice(DOMAIN_TENANT_PREFIX.length);
    if (DOMAINS.includes(rest as VoiceDomainTask["domain"])) return rest as VoiceDomainTask["domain"];
  }
  return null;
}

function taskTitle(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > 120 ? `${collapsed.slice(0, 119)}…` : collapsed;
}

export const voiceTaskHandlers: Partial<Record<OperationId, Handler>> = {
  async createVoiceDomainTask(ctx) {
    requireVoiceBridge(ctx);
    if (!ctx.mutation.idempotencyKey) throw validationFailed("Ein Idempotency-Key ist fuer den Sprachauftrag erforderlich.");
    const create = ctx.runtime.registry.getPort("tasks").createTask;
    if (!create) throw new ApiError({ code: "CAPABILITY_MISSING", message: "Aufgaben koennen derzeit nicht angelegt werden." });
    const request = ctx.body as VoiceDomainTaskRequest;
    const agent = await resolveDomainAgent(ctx, request.domain);
    const body = routeAgentTask({
      title: taskTitle(request.text),
      description: `${request.text}\n\n${RESULT_HINT}`,
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
};
