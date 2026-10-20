import { afterEach, describe, expect, it, vi } from "vitest";
import type { Runtime } from "../runtime/types";
import { applyVoiceSettings, type RuntimeVoiceSettings } from "./voice-settings";

const requested: RuntimeVoiceSettings = {
  wakeWordEnabled: false, wakeWord: "Hey Friday", pushToTalkKey: "Ctrl+Space",
  speakerVerificationRequired: true, storeRawRecordings: false, voiceHistoryEnabled: false, ttsRate: 1.25,
};
const runtime = {
  config: { adapters: { voice: { provider: "friday-voice-http", config: { baseUrl: "http://127.0.0.1:43794" } } } },
  voiceBridgeKey: Buffer.from("synthetic-key"),
} as unknown as Runtime;

afterEach(() => vi.restoreAllMocks());

describe("voice settings bridge", () => {
  it("requires a matching ACK and a fresh same-process runtime readback", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ applied: true, settings: requested, serviceStartedAt: "process-A" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ service_started_at: "process-A", runtime_settings: requested })));
    await expect(applyVoiceSettings(runtime, requested)).resolves.toBe("process-A");
    expect(fetcher.mock.calls[0]?.[0].toString()).toBe("http://127.0.0.1:43794/control/settings");
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual(requested);
  });

  it("rejects a success-shaped ACK from another process or mismatched policy", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ applied: true, settings: requested, serviceStartedAt: "process-A" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ service_started_at: "process-B", runtime_settings: requested })));
    await expect(applyVoiceSettings(runtime, requested)).rejects.toThrow("Aktive Spracheinstellung");
  });

  it("reports a policy rejection without claiming persistence", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 422 }));
    await expect(applyVoiceSettings(runtime, { ...requested, speakerVerificationRequired: false })).rejects.toThrow();
  });
});
