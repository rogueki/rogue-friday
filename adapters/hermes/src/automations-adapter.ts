import type { Automation, AutomationAction, AutomationRun, AutomationTrigger } from "@friday/sdk";
import {
  AdapterError,
  createId,
  toIso,
  validatePortResult,
  type AutomationPort,
  type CallContext,
  type IdParam,
  type ListAutomationsParams,
  type MutationContext,
  type Page,
  type PageParams,
  type Single,
} from "@friday/adapter-core";
import { HermesAdapterBase, type HealthProbeResult } from "./base";
import { CronApi, type CronJob, type CronRun } from "./cron-api";
import { manifestFor } from "./manifest";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
/** `local` means "save the output only"; every other value is a real delivery channel. */
const LOCAL_DELIVERY = "local";
const SCRIPT_MODE = "script";

const hash = (text: string): number => {
  let value = 0;
  for (let index = 0; index < text.length; index += 1) {
    value = (value * 31 + text.charCodeAt(index)) % 1_000_000_007;
  }
  return value;
};

const contractId = (prefix: "auto" | "run" | "corr", seed: string): string =>
  `${prefix}_${createId("src", `${prefix}:${seed}`).slice("src_".length)}`;

const epochIso = (value: number | null | undefined): string | null =>
  value === null || value === undefined ? null : new Date(value * 1000).toISOString();

/**
 * Automations on Hermes: the cron dashboard API (`/api/cron/jobs`). Hermes owns scheduling, the run history and the
 * delivery targets; F.R.I.D.A.Y. adds contract ids, the optimistic `version` and the role model in front of it.
 *
 * Hermes has no conditions and no version history, so `conditions` stays empty and `listAutomationVersions` is not
 * implemented — the capability is simply not advertised instead of faking a history.
 */
export class HermesAutomationsAdapter extends HermesAdapterBase implements AutomationPort {
  readonly manifest = manifestFor("automations");

  private api: CronApi | undefined;
  /** Contract id -> cron job id; filled from every read so mutations can address the right job. */
  private readonly jobIds = new Map<string, string>();

  protected override onInitialize(): void {
    const { clients } = this.ready();
    this.api = new CronApi(clients.dashboard);
    this.jobIds.clear();
  }

  protected override onShutdown(): void {
    this.api = undefined;
    this.jobIds.clear();
  }

  protected probe(): Promise<HealthProbeResult> {
    return this.probeDashboard();
  }

  /** No event stream: Hermes cron reports state through the job and run endpoints only. */
  protected async pollCycle(): Promise<number> {
    return 0;
  }

  private cron(): CronApi {
    const api = this.api;
    if (!api) throw new AdapterError({ code: "ADAPTER_UNAVAILABLE", message: "Adapter ist nicht initialisiert.", retryable: true });
    return api;
  }

  // ---- mapping -------------------------------------------------------------------------------------------------------

  private idOf(job: CronJob): string {
    const id = contractId("auto", job.id);
    this.jobIds.set(id, job.id);
    return id;
  }

  private versionOf(job: CronJob): number {
    return 1 + (hash(`${job.id}|${job.schedule?.expr ?? ""}|${job.name}|${job.enabled}|${job.repeat?.completed ?? 0}`) % 999_999);
  }

  private triggerOf(job: CronJob): AutomationTrigger {
    const schedule = job.schedule ?? { kind: "manual" };
    const display = job.schedule_display ?? schedule.display ?? schedule.expr ?? schedule.kind;
    if (schedule.kind === "cron" || schedule.kind === "interval") {
      return {
        type: "schedule",
        schedule: schedule.expr ?? schedule.display ?? display,
        description: `Hermes-Zeitplan (${schedule.kind}): ${display}`,
      };
    }
    return { type: "schedule", schedule: schedule.run_at ?? display, description: `Hermes-Zeitplan (${schedule.kind}): ${display}` };
  }

  private actionsOf(job: CronJob): AutomationAction[] {
    const params: Record<string, unknown> = {};
    if (job.prompt) params.prompt = job.prompt;
    if (job.script) params.script = job.script;
    if (job.skills && job.skills.length > 0) params.skills = [...job.skills];
    if (job.model) params.model = job.model;
    if (job.provider) params.provider = job.provider;
    if (job.workdir) params.workdir = job.workdir;
    if (job.no_agent || job.script) params.mode = SCRIPT_MODE;
    const actions: AutomationAction[] = [
      {
        id: contractId("auto", `${job.id}:run`),
        type: "run_agent",
        params,
        requiresApproval: false,
        description: job.script
          ? `Hermes fuehrt das Skript '${job.script}' ohne Modell aus.`
          : `Hermes fuehrt den Agentenlauf aus${job.skills?.length ? ` (Skills: ${job.skills.join(", ")})` : ""}.`,
      },
    ];
    const deliver = job.deliver && job.deliver !== LOCAL_DELIVERY ? job.deliver : undefined;
    if (deliver) {
      const channel = deliver === "telegram" || deliver === "whatsapp" || deliver === "sms" || deliver === "phone" || deliver === "email"
        ? deliver
        : undefined;
      actions.push({
        id: contractId("auto", `${job.id}:deliver`),
        type: "notify",
        ...(channel ? { channel } : {}),
        params: { deliver },
        requiresApproval: false,
        description: `Hermes stellt das Ergebnis an '${deliver}' zu.`,
      });
    }
    return actions;
  }

  private runStatus(job: CronJob): AutomationRun["status"] {
    const status = (job.last_status ?? "").toLowerCase();
    if (status === "ok" || status === "success" || status === "succeeded") return "succeeded";
    if (status === "error" || status === "failed") return "failed";
    if (status === "skipped") return "skipped";
    return "running";
  }

  private toAutomation(job: CronJob, nowIso: string): Automation {
    const updatedAt = job.next_run_at ?? job.last_run_at ?? job.created_at ?? nowIso;
    return {
      id: this.idOf(job),
      version: this.versionOf(job),
      createdAt: job.created_at ?? nowIso,
      updatedAt,
      labels: job.profile_name ? [`hermes:${job.profile_name}`] : [],
      source: {
        adapterId: this.manifest.id,
        system: "hermes",
        externalId: job.id,
        lastSyncedAt: nowIso,
      },
      name: job.name,
      ...(job.prompt ? { description: job.prompt } : job.script ? { description: `Skript: ${job.script}` } : {}),
      enabled: job.enabled,
      paused: !job.enabled,
      trigger: this.triggerOf(job),
      conditions: [],
      actions: this.actionsOf(job),
      escalation: [],
      nextRunAt: job.next_run_at ?? null,
      lastRunAt: job.last_run_at ?? null,
      lastSuccess: job.last_status === "ok" && job.last_run_at
        ? { at: job.last_run_at, runId: contractId("run", `${job.id}:last-ok`) }
        : null,
      lastError: job.last_error
        ? { at: job.last_run_at ?? nowIso, message: job.last_error, runId: contractId("run", `${job.id}:error`) }
        : null,
      runCount: job.repeat?.completed ?? 0,
    };
  }

  private runActionStatus(job: CronJob): AutomationRun["actionsExecuted"][number]["status"] {
    const status = this.runStatus(job);
    return status === "succeeded" ? "succeeded" : status === "failed" ? "failed" : status === "skipped" ? "skipped" : "succeeded";
  }

  private toRun(job: CronJob, wire: CronRun | undefined, nowIso: string): AutomationRun {
    const startedAt = epochIso(wire?.started_at) ?? job.last_run_at ?? nowIso;
    const finishedAt = epochIso(wire?.ended_at) ?? (job.last_run_at && this.runStatus(job) !== "running" ? job.last_run_at : null);
    const summary = wire?.preview ?? wire?.title ?? "";
    return {
      id: contractId("run", wire?.id ?? `${job.id}:${job.last_run_at ?? "pending"}`),
      version: this.versionOf(job),
      createdAt: startedAt,
      updatedAt: finishedAt ?? startedAt,
      labels: [],
      source: { adapterId: this.manifest.id, system: "hermes", externalId: wire?.id ?? job.id, lastSyncedAt: nowIso },
      automationId: this.idOf(job),
      automationVersion: this.versionOf(job),
      status: this.runStatus(job),
      dryRun: false,
      triggeredAt: startedAt,
      finishedAt,
      triggerReason: `Hermes-Cron hat Job '${job.name}' ausgeloest.`,
      conditionsEvaluated: [],
      actionsExecuted: this.actionsOf(job).map((action) => ({
        actionId: action.id,
        status: this.runActionStatus(job),
        executedAt: startedAt,
        resultSummary: summary.slice(0, 400) || "Hermes meldet keinen Ausgabetext.",
      })),
      result: summary.slice(0, 2_000),
      correlationId: contractId("corr", wire?.id ?? `${job.id}:${startedAt}`),
    };
  }

  private createBodyFor(body: Parameters<NonNullable<AutomationPort["createAutomation"]>>[0]["body"]) {
    const trigger = body.trigger;
    const schedule = trigger.type === "schedule" && trigger.schedule ? trigger.schedule : "manual-once";
    const runAction = body.actions.find((action) => action.type === "run_agent");
    const notifyAction = body.actions.find((action) => action.type === "notify");
    const params = (runAction?.params ?? {}) as Record<string, unknown>;
    const script = typeof params.script === "string" ? params.script : undefined;
    const prompt = typeof params.prompt === "string" ? params.prompt : undefined;
    return {
      schedule,
      name: body.name,
      prompt: prompt ?? (script ? "" : body.description ?? body.name),
      ...(script ? { script, no_agent: params.mode !== "agent" } : {}),
      ...(Array.isArray(params.skills) ? { skills: params.skills as string[] } : {}),
      ...(typeof params.model === "string" ? { model: params.model } : {}),
      ...(typeof params.provider === "string" ? { provider: params.provider } : {}),
      ...(typeof params.workdir === "string" ? { workdir: params.workdir } : {}),
      deliver: typeof notifyAction?.params?.deliver === "string" ? notifyAction.params.deliver : LOCAL_DELIVERY,
      // Hermes creates jobs paused for operator approval; an explicitly enabled automation is resumed right after.
      paused: true,
    };
  }

  // ---- port ----------------------------------------------------------------------------------------------------------

  async listAutomations(params: ListAutomationsParams, call: CallContext): Promise<Page<Automation>> {
    const { context } = this.ready();
    const nowIso = toIso(context.clock);
    let jobs = await this.cron().listJobs("all", call.signal);
    if (params.enabled !== undefined) jobs = jobs.filter((job) => job.enabled === params.enabled);
    if (params.q) {
      const needle = params.q.toLowerCase();
      jobs = jobs.filter((job) => `${job.name} ${job.prompt ?? ""}`.toLowerCase().includes(needle));
    }
    const limit = Math.min(MAX_LIMIT, Math.max(1, params.limit ?? DEFAULT_LIMIT));
    const offset = this.offsetOf(params.cursor);
    const nextCursor = offset + limit < jobs.length ? `o${offset + limit}` : null;
    // A single corrupt job must not take the other automations with it: map per job, keep what is readable and say
    // which ids were dropped. Only when nothing is readable does the adapter report the upstream defect.
    const items: Automation[] = [];
    const broken: Array<{ id: string; reason: string }> = [];
    for (const job of jobs.slice(offset, offset + limit)) {
      try {
        items.push(this.toAutomation(job, nowIso));
      } catch (error) {
        broken.push({ id: String(job?.id ?? "unbekannt"), reason: error instanceof Error ? error.message : "unbekannt" });
      }
    }
    if (broken.length > 0) {
      context.logger.warn("Hermes-Automation uebersprungen", { broken });
      if (items.length === 0) {
        throw new AdapterError({
          code: "INTERNAL",
          message: `Keine Hermes-Automation lesbar (${broken.map((entry) => entry.id).join(", ")}).`,
          retryable: false,
          details: { broken },
        });
      }
    }
    return {
      items,
      pageInfo: { nextCursor, hasNextPage: nextCursor !== null },
      freshness: { state: "fresh", asOf: nowIso },
    };
  }

  async getAutomation(params: IdParam, call: CallContext): Promise<Single<Automation>> {
    const { context } = this.ready();
    const nowIso = toIso(context.clock);
    const job = await this.resolve(params.id, call);
    return { data: this.toAutomation(job, nowIso), freshness: { state: "fresh", asOf: nowIso } };
  }

  async listAutomationRuns(params: IdParam & PageParams, call: CallContext): Promise<Page<AutomationRun>> {
    const { context } = this.ready();
    const nowIso = toIso(context.clock);
    const job = await this.resolve(params.id, call);
    const limit = Math.min(MAX_LIMIT, Math.max(1, params.limit ?? 20));
    const { runs } = await this.cron().listRuns(job.id, limit, call.signal);
    const items = runs.length > 0
      ? runs.map((run) => this.toRun(job, run, nowIso))
      : job.last_run_at
        ? [this.toRun(job, undefined, nowIso)]
        : [];
    return { items, pageInfo: { nextCursor: null, hasNextPage: false }, freshness: { state: "fresh", asOf: nowIso } };
  }

  async createAutomation(
    params: { body: Parameters<NonNullable<AutomationPort["createAutomation"]>>[0]["body"] },
    call: MutationContext,
  ): Promise<Single<Automation>> {
    const { context } = this.ready();
    const nowIso = toIso(context.clock);
    const body = this.createBodyFor(params.body);
    let job = await this.cron().createJob(body, call.signal);
    if (params.body.enabled) job = await this.cron().resume(job.id, call.signal);
    return { data: this.toAutomation(job, nowIso), freshness: { state: "fresh", asOf: nowIso } };
  }

  async updateAutomation(
    params: IdParam & { body: Parameters<NonNullable<AutomationPort["updateAutomation"]>>[0]["body"] },
    call: MutationContext,
  ): Promise<Single<Automation>> {
    const { context } = this.ready();
    const nowIso = toIso(context.clock);
    const job = await this.resolve(params.id, call);
    if (call.ifMatchVersion !== undefined && call.ifMatchVersion !== this.versionOf(job)) {
      throw new AdapterError({
        code: "CONFLICT",
        message: "Die Automation wurde inzwischen geaendert.",
        retryable: false,
        details: { expectedVersion: call.ifMatchVersion, currentVersion: this.versionOf(job) },
      });
    }
    const updates: Record<string, unknown> = {};
    if (params.body.name) updates.name = params.body.name;
    if (params.body.description !== undefined) updates.prompt = params.body.description;
    const runAction = params.body.actions?.find((action) => action.type === "run_agent");
    const script = runAction?.params && typeof runAction.params.script === "string" ? runAction.params.script : undefined;
    if (script) {
      updates.script = script;
      updates.no_agent = runAction?.params?.mode !== "agent";
    }
    const notify = params.body.actions?.find((action) => action.type === "notify");
    if (notify && typeof notify.params?.deliver === "string") updates.deliver = notify.params.deliver;
    if (params.body.trigger?.type === "schedule" && params.body.trigger.schedule) updates.schedule = params.body.trigger.schedule;
    const updated = Object.keys(updates).length > 0
      ? await this.cron().updateJob(job.id, updates, call.signal)
      : job;
    return { data: this.toAutomation(updated, nowIso), freshness: { state: "fresh", asOf: nowIso } };
  }

  async testAutomation(
    params: IdParam & { body?: Parameters<NonNullable<AutomationPort["testAutomation"]>>[0]["body"] },
    call: MutationContext,
  ): Promise<Single<AutomationRun>> {
    const { context } = this.ready();
    const nowIso = toIso(context.clock);
    const job = await this.resolve(params.id, call);
    const triggered = await this.cron().trigger(job.id, call.signal);
    const { runs } = await this.cron().listRuns(job.id, 1, call.signal);
    const run = this.toRun(triggered, runs[0], nowIso);
    return {
      data: {
        ...run,
        dryRun: params.body?.dryRun ?? false,
        triggerReason: `Manueller Testlauf ueber F.R.I.D.A.Y. (Job '${triggered.name}').`,
      },
      freshness: { state: "fresh", asOf: nowIso },
    };
  }

  async enableAutomation(params: IdParam, call: MutationContext): Promise<Single<Automation>> {
    const { context } = this.ready();
    const nowIso = toIso(context.clock);
    const job = await this.resolve(params.id, call);
    const resumed = await this.cron().resume(job.id, call.signal);
    return { data: this.toAutomation(resumed, nowIso), freshness: { state: "fresh", asOf: nowIso } };
  }

  async disableAutomation(params: IdParam, call: MutationContext): Promise<Single<Automation>> {
    const { context } = this.ready();
    const nowIso = toIso(context.clock);
    const job = await this.resolve(params.id, call);
    const paused = await this.cron().pause(job.id, call.signal);
    return { data: this.toAutomation(paused, nowIso), freshness: { state: "fresh", asOf: nowIso } };
  }

  /** Resolves a contract id to its cron job; refreshes the map once when the id is unknown (e.g. after a restart). */
  private async resolve(id: string, call: CallContext): Promise<CronJob> {
    const known = this.jobIds.get(id);
    if (known) return this.cron().getJob(known, call.signal);
    const jobs = await this.cron().listJobs("all", call.signal);
    for (const job of jobs) this.idOf(job);
    const mapped = this.jobIds.get(id);
    if (!mapped) {
      throw new AdapterError({ code: "NOT_FOUND", message: `Automation nicht gefunden: ${id}`, retryable: false });
    }
    return this.cron().getJob(mapped, call.signal);
  }

  private offsetOf(cursor: string | null | undefined): number {
    if (cursor === undefined || cursor === null || cursor === "") return 0;
    const match = /^o(\d+)$/.exec(cursor);
    if (!match) throw new AdapterError({ code: "VALIDATION_FAILED", message: "Ungueltiger Cursor.", retryable: false });
    return Number(match[1]);
  }
}

export { validatePortResult };