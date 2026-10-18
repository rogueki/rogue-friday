import { describe, expect, it, vi } from "vitest";
import type { CallContext } from "@friday/adapter-core";
import type { Runtime } from "../runtime/types";
import { recordAudioAck, recordVoiceAck, voiceIntegrationStatus } from "./integration-status";

function fixture() {
  let version = 4;
  const status = vi.fn().mockResolvedValue({ data: { source: { system: "friday-voice" }, tts: { state: "ready" }, ttsVoiceChoice: "classic", serviceStartedAt: "2026-10-19T00:00:00.000Z", audioInputDeviceId: null, audioOutputDeviceId: null } });
  const runtime = {
    config: { adapters: { voice: { provider: "friday-voice-http", config: { baseUrl: "http://127.0.0.1:43794" } } } },
    settings: { version: () => version, area: () => ({ ttsVoice: "classic", inputDeviceId: null, outputDeviceId: null }) },
    registry: { getPort: () => ({ getVoiceStatus: status }) },
  } as unknown as Runtime;
  return { runtime, status, setVersion: (next: number) => { version = next; } };
}

const call = {} as CallContext;

describe("voice integration status", () => {
  it("keeps persisted voice unverified until an ACK, and loses proof after a version change", async () => {
    const { runtime, setVersion } = fixture();
    const initial = await voiceIntegrationStatus(runtime, call);
    expect(initial).toMatchObject({ persistedRevision: 4, appliedRevision: null, verification: "unverified" });
    expect(initial.settings.inputDeviceId).toMatchObject({ verification: "unverified" });
    recordVoiceAck(runtime, 4, "classic", "2026-10-19T00:00:00.000Z");
    expect((await voiceIntegrationStatus(runtime, call)).settings.ttsVoice).toMatchObject({ verification: "verified" });
    setVersion(5);
    expect(await voiceIntegrationStatus(runtime, call)).toMatchObject({ persistedRevision: 5, appliedRevision: null, verification: "unverified" });
  });

  it("does not report a saved ACK as applied when the real adapter is unavailable", async () => {
    const { runtime, status } = fixture();
    recordVoiceAck(runtime, 4, "classic");
    status.mockRejectedValueOnce(new Error("connection refused"));
    expect(await voiceIntegrationStatus(runtime, call)).toMatchObject({ connected: false, appliedRevision: null, verification: "failed", errorCode: "VOICE_OFFLINE" });
  });

  it("does not accept a mock response as real runtime verification", async () => {
    const { runtime, status } = fixture();
    recordVoiceAck(runtime, 4, "classic");
    status.mockResolvedValueOnce({ data: { source: { system: "mock" }, tts: { state: "ready" } } });
    expect(await voiceIntegrationStatus(runtime, call)).toMatchObject({ connected: false, appliedRevision: null, verification: "failed" });
  });

  it("requires both audio ACK and matching live read-back", async () => {
    const { runtime, status } = fixture();
    recordAudioAck(runtime, 4, null, null, "2026-10-19T00:00:00.000Z");
    expect((await voiceIntegrationStatus(runtime, call)).settings.inputDeviceId).toMatchObject({ verification: "verified" });
    status.mockResolvedValueOnce({ data: { source: { system: "friday-voice" }, tts: { state: "ready" }, ttsVoiceChoice: "classic", serviceStartedAt: "2026-10-19T00:00:00.000Z", audioInputDeviceId: "other", audioOutputDeviceId: null } });
    const mismatched = await voiceIntegrationStatus(runtime, call);
    expect(mismatched.settings.inputDeviceId).toMatchObject({ verification: "unverified" });
    expect(mismatched.settings.outputDeviceId).toMatchObject({ verification: "verified" });
  });

  it("invalidates a prior persona ACK after an external switch or service restart", async () => {
    const { runtime, status } = fixture();
    recordVoiceAck(runtime, 4, "classic", "2026-10-19T00:00:00.000Z");
    status.mockResolvedValueOnce({ data: { source: { system: "friday-voice" }, tts: { state: "ready" }, ttsVoiceChoice: "friday-female", serviceStartedAt: "2026-10-19T00:00:00.000Z" } });
    expect((await voiceIntegrationStatus(runtime, call)).settings.ttsVoice).toMatchObject({ verification: "unverified" });
    status.mockResolvedValueOnce({ data: { source: { system: "friday-voice" }, tts: { state: "ready" }, ttsVoiceChoice: "classic", serviceStartedAt: "2026-10-19T00:01:00.000Z" } });
    expect((await voiceIntegrationStatus(runtime, call)).settings.ttsVoice).toMatchObject({ verification: "unverified" });
  });
});
