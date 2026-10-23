import { CONTRACT_VERSION, type CodingRunRequest, type OnboardingUpdate, type SkillActivationRequest } from "@friday/sdk";
import type { Handler } from "../http/context";
import type { OperationId } from "../http/route-types";
import { ApiError, forbidden, validationFailed } from "../util/errors";
import type { PowerPointRequest } from "../services/powerpoint";

const single = <T>(data: T) => ({ contractVersion: CONTRACT_VERSION, data, freshness: { state: "fresh" as const, asOf: new Date().toISOString() } });

async function requirePowerPoint(ctx: Parameters<Handler>[0]): Promise<void> {
  const observed = await ctx.runtime.skills.list();
  const powerpoint = observed.skills.find((skill) => skill.id === "hermes:powerpoint");
  if (!observed.fresh || !powerpoint?.discovered || powerpoint.enabled !== true) {
    throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Hermes PowerPoint ist nicht aktuell als aktiviert und verfügbar bestätigt." });
  }
}

async function mutateSkill(ctx: Parameters<Handler>[0]) {
  const name = typeof ctx.pathParams.name === "string" ? ctx.pathParams.name : "";
  const body = ctx.body as { action?: unknown; identifier?: unknown; force?: unknown } | undefined;
  const action = body?.action;
  if (action !== "install" && action !== "update" && action !== "uninstall")
    throw validationFailed("Unbekannte Skill-Aenderung.");
  const identifier = typeof body?.identifier === "string" ? body.identifier : undefined;
  const force = body?.force === true;
  const result = await ctx.runtime.hermesConfig.mutateSkill(action, name, identifier, force);
  ctx.audit.action = `skills.${action}ed`;
  ctx.audit.after = { name: result.name, installed: result.installed, enabled: result.enabled,
    snapshot: result.snapshot, force };
  return { status: 200 as const, body: single(result) };
}

async function skillReport(ctx: Parameters<Handler>[0], action: "inspect" | "audit" | "diff",
  auditAction: string) {
  const name = typeof ctx.pathParams.name === "string" ? ctx.pathParams.name : "";
  const result = await ctx.runtime.hermesConfig.skillReport(action, name);
  ctx.audit.action = auditAction;
  ctx.audit.after = { name: result.name, bytes: result.bytes, truncated: result.truncated };
  return { status: 200 as const, body: single({ action: result.action, name: result.name, text: result.text,
    bytes: result.bytes, truncated: result.truncated, observedAt: result.observedAt }) };
}

export const skillsHandlers: Partial<Record<OperationId, Handler>> = {
  mutateSkill,

  async searchSkillHub(ctx) {
    const query = typeof ctx.query.query === "string" ? ctx.query.query : "";
    const source = typeof ctx.query.source === "string" ? ctx.query.source : undefined;
    const limit = typeof ctx.query.limit === "number" ? ctx.query.limit : 10;
    const result = await ctx.runtime.hermesConfig.hubSearch(query, source, limit);
    ctx.audit.action = "skills.hub_searched";
    ctx.audit.after = { query: result.query, source: result.source, hits: result.results.length };
    return { status: 200, body: single(result) };
  },
  async getSkillInspection(ctx) { return skillReport(ctx, "inspect", "skills.inspected"); },
  async getSkillAudit(ctx) { return skillReport(ctx, "audit", "skills.audited"); },
  async getSkillDiff(ctx) { return skillReport(ctx, "diff", "skills.diffed"); },
  async listModifiedSkills(ctx) {
    const result = await ctx.runtime.hermesConfig.modifiedSkills();
    ctx.audit.action = "skills.modified_listed";
    ctx.audit.after = { count: result.names.length };
    return { status: 200, body: single({ names: result.names, observedAt: result.at }) };
  },
  async getSkillMarkdown(ctx) {
    const id = ctx.pathParams.id ?? "";
    const result = await ctx.runtime.hermesConfig.skillMarkdown(id);
    ctx.audit.action = "skills.markdown_read";
    ctx.audit.after = { id, bytes: result.bytes };
    return { status: 200, body: single(result) };
  },
  async createPowerPointDeck(ctx) {
    await requirePowerPoint(ctx);
    const deck = await ctx.runtime.powerpoint.create(ctx.body as PowerPointRequest);
    ctx.audit.action = "skills.powerpoint_created";
    ctx.audit.after = { deckId: deck.id, slideCount: deck.slideCount };
    return { status: 201, body: single(deck) };
  },
  async createVoicePowerPointDeck(ctx) {
    if (!ctx.voiceBridgeAuthorized || !ctx.runtime.auth.ownerPasswordConfigured() ||
      ctx.runtime.auth.devMode && ctx.runtime.config.server.allowRemote) {
      throw forbidden("PowerPoint-Sprachaktionen erfordern den lokalen Voice-Dienst und ein eingerichtetes Besitzerkonto.");
    }
    if (!ctx.idempotencyKey) throw validationFailed("Ein Idempotency-Key ist für den Sprachauftrag erforderlich.");
    const request = ctx.body as PowerPointRequest;
    if (request.slides.length !== 1 || request.slides[0]!.bullets.length < 1 || request.slides[0]!.bullets.length > 5) {
      throw validationFailed("Sprach-PowerPoint erlaubt genau eine Folie und ein bis fünf Stichpunkte.");
    }
    await requirePowerPoint(ctx);
    const { replayed, ...deck } = await ctx.runtime.powerpoint.createVoice(request, ctx.idempotencyKey);
    ctx.audit.action = "skills.voice_powerpoint_created";
    ctx.audit.after = { deckId: deck.id, slideCount: deck.slideCount };
    return { status: 201, body: single(deck), headers: { "Idempotent-Replayed": String(replayed) } };
  },
  async listPowerPointDecks(ctx) {
    return { status: 200, body: single(ctx.runtime.powerpoint.recent()) };
  },
  async downloadPowerPointDeck(ctx) {
    const id = ctx.pathParams.id as string;
    return { status: 200, raw: { contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      data: ctx.runtime.powerpoint.download(id), disposition: `attachment; filename="friday-${id}.pptx"` } };
  },
  async getCodingCliStatus(ctx) {
    return { status: 200, body: single(await ctx.runtime.codingRuns.cliStatus()) };
  },
  async getCodingVoiceRepository(ctx) {
    return { status: 200, body: single(ctx.runtime.codingVoiceRepository.get()) };
  },
  async putCodingVoiceRepository(ctx) {
    const saved = await ctx.runtime.codingVoiceRepository.put(ctx.body as { alias: string; repository: string }, ctx.mutation.ifMatchVersion);
    ctx.audit.action = "skills.coding_voice_repository_updated";
    ctx.audit.after = { alias: saved.alias, revision: saved.revision };
    return { status: 200, body: single(saved) };
  },
  async createVoiceCodingRun(ctx) {
    if (!ctx.mutation.idempotencyKey) throw validationFailed("Coding-Run erfordert einen Idempotency-Key.");
    const body = ctx.body as { alias: string; revision: number; cli: "auto" | "codex" | "opencode" | "claude-code"; task: string };
    const repository = ctx.runtime.codingVoiceRepository.resolve(body.alias, body.revision);
    const run = await ctx.runtime.codingRuns.start({ cli: body.cli, repository, task: body.task }, ctx.mutation.idempotencyKey);
    ctx.audit.action = "skills.voice_coding_run_started";
    ctx.audit.after = { runId: run.runId, requestedCli: run.requestedCli, alias: body.alias };
    return { status: 202, body: single(run) };
  },
  async createCodingRun(ctx) {
    if (!ctx.mutation.idempotencyKey) throw validationFailed("Coding-Run erfordert einen Idempotency-Key.");
    const run = await ctx.runtime.codingRuns.start(ctx.body as CodingRunRequest, ctx.mutation.idempotencyKey ?? "");
    ctx.audit.action = "skills.coding_run_started";
    ctx.audit.after = { runId: run.runId, requestedCli: run.requestedCli };
    return { status: 202, body: single(run) };
  },
  async getCodingRun(ctx) {
    return { status: 200, body: single(await ctx.runtime.codingRuns.status(ctx.pathParams.runId as string)) };
  },
  async listSkills(ctx) {
    const result = await ctx.runtime.skills.list();
    return { status: 200, body: { contractVersion: CONTRACT_VERSION, data: result.skills, catalogError: result.catalogError, hermesError: result.hermesError,
      freshness: { state: result.fresh ? "fresh" : "unknown", asOf: result.fresh ? new Date().toISOString() : null } } };
  },
  async setSkillActivation(ctx) {
    const skill = await ctx.runtime.skills.toggle(ctx.pathParams.id as string, (ctx.body as SkillActivationRequest).enabled);
    ctx.audit.action = "skills.activation_changed";
    ctx.audit.after = { skillId: skill.id, enabled: skill.enabled };
    return { status: 200, body: single(skill) };
  },
  async getOnboarding(ctx) {
    return { status: 200, body: single(ctx.runtime.onboarding.get()) };
  },
  async putOnboarding(ctx) {
    const previousPreferredName = ctx.runtime.onboarding.get().preferredName?.trim();
    const state = ctx.runtime.onboarding.put(ctx.body as OnboardingUpdate, ctx.mutation.ifMatchVersion);
    // The owner nickname is also the live dashboard/session display name. Keep the existing settings version check.
    const preferredName = state.preferredName?.trim();
    if (preferredName && preferredName !== previousPreferredName && preferredName !== ctx.runtime.settings.area("profile").displayName) {
      ctx.runtime.settings.patch({ profile: { ...ctx.runtime.settings.area("profile"), displayName: preferredName } }, ctx.runtime.settings.version());
      ctx.runtime.world?.refresh();
    }
    ctx.audit.action = "onboarding.updated";
    ctx.audit.after = { revision: state.revision, completed: Boolean(state.completedAt) };
    return { status: 200, body: single(state) };
  },
};
