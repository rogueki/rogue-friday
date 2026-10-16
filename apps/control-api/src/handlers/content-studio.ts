import { CONTRACT_VERSION, type ElevenSpeechRequest, type KieTaskRequest } from "@friday/sdk";
import type { Handler } from "../http/context";
import type { OperationId } from "../http/route-types";
import { forbidden } from "../util/errors";

const single = <T>(data: T) => ({ contractVersion: CONTRACT_VERSION, data, freshness: { state: "fresh" as const, asOf: new Date().toISOString() } });

export const contentStudioHandlers: Partial<Record<OperationId, Handler>> = {
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
