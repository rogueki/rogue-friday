import { CONTRACT_VERSION } from "@friday/sdk";
import type { Handler } from "../http/context";
import type { OperationId } from "../http/route-types";
import { addEnrollmentSample, enrollmentStatus, startEnrollmentTraining } from "../services/linux-voice-enrollment";
import { ApiError } from "../util/errors";
import { startWakeEnrollment, wakeEnrollmentRequest } from "../services/wake-enrollment";
import { startSttModelDownload, sttModelsRequest } from "../services/stt-models";
import { setConversationKey } from "../services/voice-conversation-key";

export const browserVoiceHandlers: Partial<Record<OperationId, Handler>> = {
  async listVoiceSttModels(ctx) {
    return { status: 200, body: { contractVersion: CONTRACT_VERSION, ...await sttModelsRequest(ctx.runtime, "status") } };
  },
  async startVoiceSttModelDownload(ctx) {
    const { model } = ctx.body as { model: string };
    return { status: 200, body: { contractVersion: CONTRACT_VERSION, ...await startSttModelDownload(ctx.runtime, model) } };
  },
  async cancelVoiceSttModelDownload(ctx) {
    const { jobId } = ctx.body as { jobId: string };
    return { status: 200, body: { contractVersion: CONTRACT_VERSION,
      ...await sttModelsRequest(ctx.runtime, "cancel", { jobId }) } };
  },
  async setVoiceConversationKey(ctx) {
    const { apiKey } = ctx.body as { apiKey: string };
    return { status: 200, body: { contractVersion: CONTRACT_VERSION, ...await setConversationKey(ctx.runtime, apiKey) } };
  },
  async getWakeEnrollment(ctx) {
    return { status: 200, body: { contractVersion: CONTRACT_VERSION, ...await wakeEnrollmentRequest(ctx.runtime, "") } };
  },
  async startWakeEnrollment(ctx) {
    const { phrase } = ctx.body as { phrase: string };
    return { status: 200, body: { contractVersion: CONTRACT_VERSION, ...await startWakeEnrollment(ctx.runtime, phrase) } };
  },
  async addWakeEnrollmentSample(ctx) {
    return { status: 200, body: { contractVersion: CONTRACT_VERSION,
      ...await wakeEnrollmentRequest(ctx.runtime, "/sample", ctx.body as object) } };
  },
  async trainWakeEnrollment(ctx) {
    return { status: 200, body: { contractVersion: CONTRACT_VERSION,
      ...await wakeEnrollmentRequest(ctx.runtime, "/train", ctx.body as object) } };
  },
  async discardWakeEnrollment(ctx) {
    return { status: 200, body: { contractVersion: CONTRACT_VERSION,
      ...await wakeEnrollmentRequest(ctx.runtime, "/discard", ctx.body as object) } };
  },
  async getBrowserAudioAvailability(ctx) {
    return { status: 200, body: { contractVersion: CONTRACT_VERSION, available: await ctx.runtime.hub.browserAudioAvailable() } };
  },
  async getLinuxVoiceEnrollment() {
    return { status: 200, body: { contractVersion: CONTRACT_VERSION, ...enrollmentStatus() } };
  },
  async addLinuxVoiceSample(ctx) {
    const body = ctx.body as { kind: "wake" | "short" | "negatives" | "speech"; pcmBase64: string };
    try { return { status: 200, body: { contractVersion: CONTRACT_VERSION, ...addEnrollmentSample(body.kind, body.pcmBase64) } }; }
    catch (reason) { throw new ApiError({ code: "VALIDATION_FAILED", status: 400, message: reason instanceof Error ? reason.message : "Aufnahme ungueltig." }); }
  },
  async startLinuxVoiceTraining() {
    try { return { status: 200, body: { contractVersion: CONTRACT_VERSION, ...startEnrollmentTraining() } }; }
    catch (reason) { throw new ApiError({ code: "VALIDATION_FAILED", status: 400, message: reason instanceof Error ? reason.message : "Training nicht bereit." }); }
  },
};
