import { afterEach, describe, expect, it, vi } from "vitest";
import type { Runtime } from "../runtime/types";
import { applyVoiceSettings, readRuntimeVoiceSettings, type RuntimeVoiceSettings } from "./voice-settings";

const requested: RuntimeVoiceSettings = {
  wakeWordEnabled: false, wakeWord: "Hey Friday", pushToTalkKey: "Ctrl+Space",
  speakerVerificationRequired: true, storeRawRecordings: false, voiceHistoryEnabled: false, sttLanguage: "de", sttModel: "small", conversationBackend: "local", conversationConsent: false, conversationSilenceSeconds: 20, proactiveAnnouncements: true, conversationRegion: "ap-southeast-1", ttsRate: 1.25,
};
const runtime = {
  config: { adapters: { voice: { provider: "friday-voice-http", config: { baseUrl: "http://127.0.0.1:43794" } } } },
  voiceBridgeKey: Buffer.from("synthetic-key"),
} as unknown as Runtime;
const before = { serviceStartedAt: "process-A", configRevision: "rev-A" };

afterEach(() => vi.restoreAllMocks());

describe("voice settings bridge", () => {
  it("requires a matching ACK and a fresh same-process runtime readback", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ applied: true, settings: Object.fromEntries(Object.entries(requested).reverse()), serviceStartedAt: "process-A", configRevision: "rev-B" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ service_started_at: "process-A", config_revision: "rev-B", runtime_settings: requested })));
    await expect(applyVoiceSettings(runtime, requested, before)).resolves.toEqual({ serviceStartedAt: "process-A", configRevision: "rev-B" });
    expect(fetcher.mock.calls[0]?.[0].toString()).toBe("http://127.0.0.1:43794/control/settings");
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({ settings: requested,
      expectedConfigRevision: "rev-A", expectedServiceStartedAt: "process-A" });
  });

  it("rejects a success-shaped ACK from another process or mismatched policy", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ applied: true, settings: requested, serviceStartedAt: "process-A", configRevision: "rev-B" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ service_started_at: "process-B", config_revision: "rev-B", runtime_settings: requested })));
    await expect(applyVoiceSettings(runtime, requested, before)).rejects.toThrow("Aktive Spracheinstellung");
  });

  it("reports a policy rejection without claiming persistence", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 422 }));
    await expect(applyVoiceSettings(runtime, { ...requested, speakerVerificationRequired: false }, before)).rejects.toThrow();
  });

  it("does not treat a changed voice revision as an applied setting", async () => {
    const send = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 409 }));
    await expect(applyVoiceSettings(runtime, requested, before)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(send).toHaveBeenCalledOnce();
  });

  it("reports a stuck model loader with an explicit service restart path", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 423 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ stt_preflight_busy: true })));
    await expect(applyVoiceSettings(runtime, requested, before)).rejects.toThrow("Sprachdienst neu starten");
  });

  it("rejects a runtime readback with an unknown conversation backend", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      service_started_at: "process-A", config_revision: "rev-A",
      runtime_settings: { ...requested, conversationBackend: "cloud" },
    })));
    await expect(readRuntimeVoiceSettings(runtime)).rejects.toMatchObject({ code: "ADAPTER_UNAVAILABLE" });
  });

  it("rejects a runtime readback without conversation consent", async () => {
    const { conversationConsent: _consent, ...withoutConsent } = requested;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      service_started_at: "process-A", config_revision: "rev-A",
      runtime_settings: withoutConsent,
    })));
    await expect(readRuntimeVoiceSettings(runtime)).rejects.toMatchObject({ code: "ADAPTER_UNAVAILABLE" });
  });
});
