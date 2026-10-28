import { CONTRACT_VERSION, type ContentProductionRequest, type ElevenSpeechRequest, type KieTaskRequest, type SkillContentProductionRequest } from "@friday/sdk";
import type { Handler } from "../http/context";
import type { OperationId } from "../http/route-types";
import { forbidden } from "../util/errors";

const single = <T>(data: T) => ({ contractVersion: CONTRACT_VERSION, data, freshness: { state: "fresh" as const, asOf: new Date().toISOString() } });

export const contentStudioHandlers: Partial<Record<OperationId, Handler>> = {
  async createContentProductionJob(ctx) {
    if (ctx.runtime.settings.area("dashboard").contentStudioEnabled !== true) throw forbidden("Content Studio ist deaktiviert.");
    const job = ctx.runtime.contentStudioProduction.create(ctx.body as ContentProductionRequest, ctx.mutation.idempotencyKey ?? "");
    ctx.audit.action = "content_studio.production_started";
    ctx.audit.after = { jobId: job.id, ideaId: job.ideaId, kind: job.kind };
    return { status: 202, body: single(job) };
  },
  async createSkillContentProductionJob(ctx) {
    if (ctx.runtime.settings.area("dashboard").contentStudioEnabled !== true) throw forbidden("Content Studio ist deaktiviert.");
    const body = ctx.body as SkillContentProductionRequest;
    const job = ctx.runtime.contentStudioProduction.create(
      { ideaId: body.ideaId, planRevision: body.planRevision, confirmed: body.confirmed,
        ...(body.voiceId === undefined ? {} : { voiceId: body.voiceId }) },
      `skill:${body.skillId}:${ctx.mutation.idempotencyKey ?? ""}`,
    );
    ctx.audit.action = "content_studio.skill_production_started";
    ctx.audit.after = { jobId: job.id, ideaId: job.ideaId, skillId: body.skillId };
    return { status: 202, body: single(job) };
  },
  async getContentProductionJob(ctx) {
    if (ctx.runtime.settings.area("dashboard").contentStudioEnabled !== true) throw forbidden("Content Studio ist deaktiviert.");
    return { status: 200, body: single(ctx.runtime.contentStudioProduction.get(ctx.pathParams.id as string)) };
  },
  async getContentProductionArtifact(ctx) {
    if (ctx.runtime.settings.area("dashboard").contentStudioEnabled !== true) throw forbidden("Content Studio ist deaktiviert.");
    const id = ctx.pathParams.id as string;
    return { status: 200, raw: { contentType: "video/mp4", data: ctx.runtime.contentStudioProduction.artifact(id), disposition: `attachment; filename="friday-${id}.mp4"` } };
  },
  async cancelContentProductionJob(ctx) {
    const job = ctx.runtime.contentStudioProduction.cancel(ctx.pathParams.id as string);
    ctx.audit.action = "content_studio.production_cancelled";
    ctx.audit.after = { jobId: job.id, state: job.state };
    return { status: 200, body: single(job) };
  },
  async getContentStudioPlan(ctx) {
    if (ctx.runtime.settings.area("dashboard").contentStudioEnabled !== true) throw forbidden("Content Studio ist deaktiviert.");
    return { status: 200, body: single(ctx.runtime.contentStudioPlan.get()) };
  },

  async putContentStudioPlan(ctx) {
    if (ctx.runtime.settings.area("dashboard").contentStudioEnabled !== true) throw forbidden("Content Studio ist deaktiviert.");
    const state = ctx.runtime.contentStudioPlan.put(ctx.body, ctx.mutation.ifMatchVersion);
    ctx.audit.action = "content_studio.plan_updated";
    ctx.audit.after = { revision: state.revision, ideas: state.plan?.content.length ?? 0, postings: state.plan?.postings.length ?? 0 };
    return { status: 200, body: single(state) };
  },
  async createKieTask(ctx) {
    if (ctx.runtime.settings.area("dashboard").contentStudioEnabled !== true) throw forbidden("Content Studio ist deaktiviert.");
    const body = ctx.body as KieTaskRequest;
    const task = await ctx.runtime.contentStudioProviders.createKie(body, ctx.mutation.idempotencyKey ?? "");
    ctx.audit.action = "content_studio.kie_task_created";
    ctx.audit.after = { taskId: task.taskId, kind: task.kind };
    return { status: 202, body: single(task) };
  },

  async getKieTask(ctx) {
    if (ctx.runtime.settings.area("dashboard").contentStudioEnabled !== true) throw forbidden("Content Studio ist deaktiviert.");
    const task = await ctx.runtime.contentStudioProviders.getKie(ctx.pathParams.id as string);
    return { status: 200, body: single(task) };
  },

  async createElevenSpeech(ctx) {
    if (ctx.runtime.settings.area("dashboard").contentStudioEnabled !== true) throw forbidden("Content Studio ist deaktiviert.");
    const audio = await ctx.runtime.contentStudioProviders.createSpeech(ctx.body as ElevenSpeechRequest, ctx.mutation.idempotencyKey ?? "");
    ctx.audit.action = "content_studio.speech_generated";
    ctx.audit.after = { provider: "elevenlabs", bytes: audio.byteLength };
    return { status: 200, raw: { contentType: "audio/mpeg", data: Buffer.from(audio), disposition: 'attachment; filename="friday-speech.mp3"' } };
  },
};
