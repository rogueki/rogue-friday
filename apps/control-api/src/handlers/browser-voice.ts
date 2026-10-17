import { CONTRACT_VERSION } from "@friday/sdk";
import type { Handler } from "../http/context";
import type { OperationId } from "../http/route-types";
import { addEnrollmentSample, enrollmentStatus, startEnrollmentTraining } from "../services/linux-voice-enrollment";
import { ApiError } from "../util/errors";

export const browserVoiceHandlers: Partial<Record<OperationId, Handler>> = {
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
