import { CONTRACT_VERSION, type CodingRunRequest, type OnboardingUpdate, type SkillActivationRequest } from "@friday/sdk";
import type { Handler } from "../http/context";
import type { OperationId } from "../http/route-types";
import { ApiError, validationFailed } from "../util/errors";
import type { PowerPointRequest } from "../services/powerpoint";

const single = <T>(data: T) => ({ contractVersion: CONTRACT_VERSION, data, freshness: { state: "fresh" as const, asOf: new Date().toISOString() } });

export const skillsHandlers: Partial<Record<OperationId, Handler>> = {
  async createPowerPointDeck(ctx) {
    const observed = await ctx.runtime.skills.list();
    const powerpoint = observed.skills.find((skill) => skill.id === "hermes:powerpoint");
    if (!observed.fresh || !powerpoint?.discovered || powerpoint.enabled !== true) {
      throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Hermes PowerPoint ist nicht aktuell als aktiviert und verfügbar bestätigt." });
    }
    const deck = await ctx.runtime.powerpoint.create(ctx.body as PowerPointRequest);
    ctx.audit.action = "skills.powerpoint_created";
    ctx.audit.after = { deckId: deck.id, slideCount: deck.slideCount };
    return { status: 201, body: single(deck) };
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
  async stopCodingRun(ctx) {
    const run = await ctx.runtime.codingRuns.stop(ctx.pathParams.runId as string);
    ctx.audit.action = "skills.coding_run_stopped";
    ctx.audit.after = { runId: run.runId };
    return { status: 200, body: single(run) };
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
