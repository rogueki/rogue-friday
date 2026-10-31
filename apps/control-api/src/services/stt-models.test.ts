import { afterEach, expect, it, vi } from "vitest";
import type { Runtime } from "../runtime/types";
import { browserVoiceHandlers } from "../handlers/browser-voice";

afterEach(() => vi.restoreAllMocks());

const runtime = {
  config: { adapters: { voice: { provider: "friday-voice-http", config: { baseUrl: "http://127.0.0.1:43794" } } } },
  voiceBridgeKey: Buffer.from("synthetic-key"),
} as unknown as Runtime;
const status = { localMode: true, models: [{ id: "base", cached: true, downloadable: true }, { id: "small", cached: false, downloadable: true },
  { id: "large-v3", cached: false, downloadable: true }], job: null };

it("routes owner STT inventory, explicit download and cancel to the local service", async () => {
  const calls: Array<{ path: string; body: unknown }> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const path = new URL(String(input)).pathname;
    calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) as unknown : null });
    if (path === "/") return new Response(JSON.stringify({ service_started_at: "process-A", config_revision: "rev-A",
      runtime_settings: { wakeWordEnabled: true, wakeWord: "Hey Friday", pushToTalkKey: "Ctrl+Space",
        speakerVerificationRequired: true, storeRawRecordings: false, voiceHistoryEnabled: true,
        sttLanguage: "de", sttModel: "base", conversationBackend: "local", conversationConsent: false, conversationSilenceSeconds: 20, proactiveAnnouncements: true, ttsRate: 1 } }));
    return new Response(JSON.stringify(status));
  });
  const context = (body?: object) => ({ runtime, body }) as Parameters<NonNullable<typeof browserVoiceHandlers.listVoiceSttModels>>[0];
  expect((await browserVoiceHandlers.listVoiceSttModels!(context())).body).toMatchObject(status);
  expect((await browserVoiceHandlers.startVoiceSttModelDownload!(context({ model: "small" }))).body).toMatchObject(status);
  expect((await browserVoiceHandlers.cancelVoiceSttModelDownload!(context({ jobId: "a".repeat(32) }))).body).toMatchObject(status);
  expect(calls.map((call) => call.path)).toEqual([
    "/control/stt-models", "/control/stt-models", "/", "/control/stt-models/download", "/control/stt-models/cancel",
  ]);
  expect(calls[3]?.body).toEqual({ model: "small", expectedServiceStartedAt: "process-A" });
  expect(calls[4]?.body).toEqual({ jobId: "a".repeat(32) });
});
