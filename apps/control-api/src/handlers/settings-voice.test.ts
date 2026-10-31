import { afterEach, describe, expect, it, vi } from "vitest";
import { settingsHandlers } from "./settings";

afterEach(() => vi.restoreAllMocks());

function context(version: () => number, patch: (expected?: number) => never) {
  const settings = {
    area: () => ({ ttsVoice: "friday-female", inputDeviceId: null, outputDeviceId: null }),
    version,
    validateAreas: vi.fn(),
    patch: (_value: unknown, expected?: number) => patch(expected),
  };
  return {
    body: { voice: { ttsVoice: "classic" } },
    mutation: { ifMatchVersion: 1 },
    runtime: {
      settings,
      config: { adapters: { voice: { provider: "friday-voice-http", config: { baseUrl: "http://127.0.0.1:43794" } } } },
      voiceBridgeKey: Buffer.from("fixture-key"),
    },
    audit: {},
  } as unknown as Parameters<NonNullable<typeof settingsHandlers.updateSettings>>[0];
}

describe("voice settings commit", () => {
  it("rejects a concurrent policy write between snapshot and apply", async () => {
    const stored = { ttsVoice: "friday-female", inputDeviceId: null, outputDeviceId: null,
      wakeWordEnabled: true, wakeWord: "Hey Friday", pushToTalkKey: "Ctrl+Space",
      speakerVerificationRequired: true, storeRawRecordings: false, voiceHistoryEnabled: true, sttLanguage: "de", sttModel: "small", conversationBackend: "local", conversationConsent: false, conversationSilenceSeconds: 20, proactiveAnnouncements: true, conversationRegion: "ap-southeast-1", ttsRate: 1 };
    const { ttsVoice: _ttsVoice, inputDeviceId: _inputDeviceId, outputDeviceId: _outputDeviceId, ...live } = stored;
    const ctx = context(() => 1, () => { throw new Error("must not persist"); });
    ctx.runtime.settings.area = vi.fn(() => stored) as never;
    ctx.body = { voice: { ...stored, voiceHistoryEnabled: false } };
    const send = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ service_started_at: "process-A" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ service_started_at: "process-A", config_revision: "rev-A", runtime_settings: live })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ service_started_at: "process-A", config_revision: "rev-B",
        runtime_settings: { ...live, storeRawRecordings: true } })));
    await expect(settingsHandlers.updateSettings!(ctx)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("rolls back only against the revision produced by its own settings apply", async () => {
    const stored = { ttsVoice: "friday-female", inputDeviceId: null, outputDeviceId: null,
      wakeWordEnabled: true, wakeWord: "Hey Friday", pushToTalkKey: "Ctrl+Space",
      speakerVerificationRequired: true, storeRawRecordings: false, voiceHistoryEnabled: true, sttLanguage: "de", sttModel: "small", conversationBackend: "local", conversationConsent: false, conversationSilenceSeconds: 20, proactiveAnnouncements: true, conversationRegion: "ap-southeast-1", ttsRate: 1 };
    const { ttsVoice: _ttsVoice, inputDeviceId: _inputDeviceId, outputDeviceId: _outputDeviceId, ...live } = stored;
    const target = { ...live, voiceHistoryEnabled: false };
    const ctx = context(() => 1, () => { throw new Error("synthetic persistence failure"); });
    ctx.runtime.settings.area = vi.fn(() => stored) as never;
    ctx.body = { voice: { ...stored, voiceHistoryEnabled: false } };
    const send = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ service_started_at: "process-A" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ service_started_at: "process-A", config_revision: "rev-A", runtime_settings: live })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ service_started_at: "process-A", config_revision: "rev-A", runtime_settings: live })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ applied: true, serviceStartedAt: "process-A", configRevision: "rev-B", settings: target })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ service_started_at: "process-A", config_revision: "rev-B", runtime_settings: target })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ service_started_at: "process-A", config_revision: "rev-B" })))
      .mockResolvedValueOnce(new Response(null, { status: 409 }));
    await expect(settingsHandlers.updateSettings!(ctx)).rejects.toMatchObject({ code: "ADAPTER_UNAVAILABLE" });
    expect(JSON.parse(String(send.mock.calls[6]?.[1]?.body))).toEqual({ settings: live,
      expectedConfigRevision: "rev-B", expectedServiceStartedAt: "process-A" });
  });

  it("imports the voice settings through runtime apply and keeps the acknowledged legacy phrase", async () => {
    const stored = { ttsVoice: "friday-female", inputDeviceId: null, outputDeviceId: null,
      wakeWordEnabled: true, wakeWord: "Hey Friday", pushToTalkKey: "Ctrl+Space",
      speakerVerificationRequired: true, storeRawRecordings: false, voiceHistoryEnabled: true, sttLanguage: "de", sttModel: "small", conversationBackend: "local", conversationConsent: false, conversationSilenceSeconds: 20, proactiveAnnouncements: true, conversationRegion: "ap-southeast-1", ttsRate: 1 };
    const live = { wakeWordEnabled: true, wakeWord: "Hey Jarvis", pushToTalkKey: "Ctrl+Space",
      speakerVerificationRequired: true, storeRawRecordings: false, voiceHistoryEnabled: true, sttLanguage: "de", sttModel: "small", conversationBackend: "local", conversationConsent: false, conversationSilenceSeconds: 20, proactiveAnnouncements: true, conversationRegion: "ap-southeast-1", ttsRate: 1 };
    const expected = { ...stored, wakeWord: "Hey Jarvis", ttsVoice: "classic" };
    const ctx = context(() => 1, () => { throw new Error("unused"); });
    ctx.runtime.settings.area = vi.fn(() => stored) as never;
    ctx.runtime.settings.patch = vi.fn(() => ({ changed: ["voice"], settings: { version: 2, voice: expected } })) as never;
    const importMock = vi.fn((_document: unknown) => ({ settings: { version: 3, voice: expected }, repairs: [] }));
    ctx.runtime.settings.import = importMock as never;
    const { sttLanguage: _language, sttModel: _model, conversationBackend: _backend, conversationConsent: _consent,
      conversationSilenceSeconds: _silence, proactiveAnnouncements: _proactive, conversationRegion: _region, ...legacyVoice } = stored;
    ctx.body = { settings: { voice: { ...legacyVoice, ttsVoice: "classic" } }, themes: [], layouts: [] } as never;
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ service_started_at: "process-A", tts_voice_choice: "friday-female" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ service_started_at: "process-A", config_revision: "rev-A", runtime_settings: live })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ service_started_at: "process-A", tts_voice_choice: "friday-female" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ applied: true, voice: "classic" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ service_started_at: "process-A", tts_voice_choice: "classic" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ service_started_at: "process-A", tts_voice_choice: "classic", input_device_id: null, output_device_id: null })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ service_started_at: "process-A", tts_voice_choice: "classic", input_device_id: null, output_device_id: null })));
    await settingsHandlers.importSettings!(ctx);
    expect((importMock.mock.calls[0]?.[0] as { settings: { voice: typeof expected } }).settings.voice).toEqual(expected);
  });

  it("preserves live legacy wake phrase when a different voice field changes", async () => {
    const stored = { ttsVoice: "friday-female", inputDeviceId: null, outputDeviceId: null,
      wakeWordEnabled: true, wakeWord: "Hey Friday", pushToTalkKey: "Ctrl+Space",
      speakerVerificationRequired: true, storeRawRecordings: false, voiceHistoryEnabled: true, sttLanguage: "de", sttModel: "small", conversationBackend: "local", conversationConsent: false, conversationSilenceSeconds: 20, proactiveAnnouncements: true, conversationRegion: "ap-southeast-1", ttsRate: 1 };
    const live = { wakeWordEnabled: true, wakeWord: "Hey Jarvis", pushToTalkKey: "Ctrl+Space",
      speakerVerificationRequired: true, storeRawRecordings: false, voiceHistoryEnabled: true, sttLanguage: "de", sttModel: "small", conversationBackend: "local", conversationConsent: false, conversationSilenceSeconds: 20, proactiveAnnouncements: true, conversationRegion: "ap-southeast-1", ttsRate: 1 };
    const desired = { ...live, voiceHistoryEnabled: false };
    const write = vi.fn((patch: { voice: typeof stored }, version: number) => ({
      changed: ["voice"], settings: { version: version + 1, voice: patch.voice },
    }));
    const ctx = context(() => 1, () => { throw new Error("unused"); });
    ctx.runtime.settings.area = vi.fn(() => stored) as never;
    ctx.runtime.settings.patch = write as never;
    ctx.body = { voice: { ...stored, voiceHistoryEnabled: false } };
    const fetcher = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ service_started_at: "process-A", tts_voice_choice: "friday-female" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ service_started_at: "process-A", config_revision: "rev-A", runtime_settings: live })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ service_started_at: "process-A", config_revision: "rev-A", runtime_settings: live })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ applied: true, serviceStartedAt: "process-A", configRevision: "rev-B", settings: desired })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ service_started_at: "process-A", config_revision: "rev-B", runtime_settings: desired })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ service_started_at: "process-A", runtime_settings: desired })));
    await settingsHandlers.updateSettings!(ctx);
    expect(JSON.parse(String(fetcher.mock.calls[3]?.[1]?.body))).toEqual({ settings: desired,
      expectedConfigRevision: "rev-A", expectedServiceStartedAt: "process-A" });
    expect(write.mock.calls[0]?.[0].voice.wakeWord).toBe("Hey Jarvis");
  });

  it("does not persist or roll back a policy rejected with 422", async () => {
    const stored = { ttsVoice: "friday-female", inputDeviceId: null, outputDeviceId: null,
      wakeWordEnabled: true, wakeWord: "Hey Friday", pushToTalkKey: "Ctrl+Space",
      speakerVerificationRequired: true, storeRawRecordings: false, voiceHistoryEnabled: true, sttLanguage: "de", sttModel: "small", conversationBackend: "local", conversationConsent: false, conversationSilenceSeconds: 20, proactiveAnnouncements: true, conversationRegion: "ap-southeast-1", ttsRate: 1 };
    const ctx = context(() => 1, () => { throw new Error("persisted"); });
    ctx.runtime.settings.area = vi.fn(() => stored) as never;
    ctx.body = { voice: { ...stored, wakeWord: "Hey 123" } };
    const fetcher = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ service_started_at: "process-A", tts_voice_choice: "friday-female" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ service_started_at: "process-A", config_revision: "rev-A", runtime_settings: stored })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ service_started_at: "process-A", config_revision: "rev-A", runtime_settings: stored })))
      .mockResolvedValueOnce(new Response(null, { status: 422 }));
    await expect(settingsHandlers.updateSettings!(ctx)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("uses the captured settings version after the voice acknowledgement and restores on conflict", async () => {
    let release: ((response: Response) => void) | undefined;
    const first = new Promise<Response>((resolve) => { release = resolve; });
    const send = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ service_started_at: "process-A", tts_voice_choice: "friday-female" })))
      .mockImplementationOnce(() => first)
      .mockResolvedValueOnce(new Response(JSON.stringify({ service_started_at: "process-A", tts_voice_choice: "classic" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ applied: true, voice: "friday-female" }), { status: 200 }));
    let current = 1;
    const patch = vi.fn((expected?: number): never => { expect(expected).toBe(1); throw new Error("concurrent version"); });
    const ctx = context(() => current, patch);
    const pending = settingsHandlers.updateSettings!(ctx);
    current = 2;
    release!(new Response(JSON.stringify({ applied: true, voice: "classic" }), { status: 200 }));
    await expect(pending).rejects.toThrow("concurrent version");
    expect(patch).toHaveBeenCalledOnce();
    expect(send.mock.calls.filter(([, options]) => options?.body).map(([, options]) => JSON.parse(String(options?.body)).voice)).toEqual(["classic", "friday-female"]);
  });

  it("reports unconfirmed recovery when the storage write and switchback fail", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ service_started_at: "process-A", tts_voice_choice: "friday-female" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ applied: true, voice: "classic" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ service_started_at: "process-A", tts_voice_choice: "classic" }), { status: 200 }))
      .mockRejectedValueOnce(new Error("bridge offline"));
    const ctx = context(() => 1, () => { throw new Error("disk failed"); });
    await expect(settingsHandlers.updateSettings!(ctx)).rejects.toThrow("Rückkehr zur vorherigen Konfiguration konnten nicht bestätigt");
  });

  it("restores the observed persona after an uncertain apply timeout", async () => {
    const send = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ service_started_at: "process-A", tts_voice_choice: "classic" })))
      .mockRejectedValueOnce(new Error("timeout after possible apply"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ applied: true, voice: "classic" }), { status: 200 }));
    const ctx = context(() => 1, () => { throw new Error("must not persist"); });
    await expect(settingsHandlers.updateSettings!(ctx)).rejects.toThrow();
    expect(send.mock.calls.filter(([, options]) => options?.body).map(([, options]) => JSON.parse(String(options?.body)).voice)).toEqual(["classic", "classic"]);
  });

  it("attempts persona restoration even when audio restoration fails", async () => {
    const input = `vdev_${"a".repeat(26)}`;
    const send = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ service_started_at: "process-A", tts_voice_choice: "friday-female", input_device_id: null, output_device_id: null })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ applied: true, voice: "classic" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ applied: true, inputDeviceId: input, outputDeviceId: null,
        serviceStartedAt: "process-A" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ input_device_id: input, output_device_id: null,
        service_started_at: "process-A" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ tts_voice_choice: "classic", service_started_at: "process-A" }), { status: 200 }))
      .mockRejectedValueOnce(new Error("audio rollback offline"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ applied: true, voice: "friday-female" }), { status: 200 }));
    const ctx = context(() => 1, () => { throw new Error("storage failed"); });
    ctx.body = { voice: { ttsVoice: "classic", inputDeviceId: input, outputDeviceId: null } };
    await expect(settingsHandlers.updateSettings!(ctx)).rejects.toThrow("Rückkehr zur vorherigen Konfiguration");
    expect(send.mock.calls.filter(([, options]) => options?.body).map(([, options]) => JSON.parse(String(options?.body)))).toEqual([
      { voice: "classic" }, { inputDeviceId: input, outputDeviceId: null },
      { inputDeviceId: null, outputDeviceId: null }, { voice: "friday-female" },
    ]);
  });
});
