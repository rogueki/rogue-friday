/* eslint-disable @typescript-eslint/no-explicit-any -- test code reads untyped event frames that the hub already validated */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderAdaptersExample } from "../../../scripts/fake-upstreams/example-config";
import { startFakeUpstreams, type FakeUpstreams } from "../../../scripts/fake-upstreams/lib";
import { makeVoiceStatus } from "../../../adapters/voice-http/test/fake/voice-status-server";
import { startTestApi, type TestApi } from "./helpers";
import { WsProbe } from "./support/ws";

const PASSWORD = "integration-test-password";

/**
 * End-to-end event path: the (fake) voice service reports phases -> voice-http adapter polls -> friday.voice.* events ->
 * orb derivation -> friday.orb.status_changed. This is the real wiring of the hybrid mode, not the mock world.
 */
describe("voice pipeline phases reach the orb (hybrid, real adapter path)", () => {
  let upstreams: FakeUpstreams;
  let keyDir: string;
  let api: TestApi;
  let probe: WsProbe;

  beforeAll(async () => {
    keyDir = mkdtempSync(join(tmpdir(), "friday-voice-orb-"));
    const keyFile = join(keyDir, "hermes_api.key");
    upstreams = await startFakeUpstreams({ ports: { hermesApi: 0, hermesDashboard: 0, voice: 0, llama: 0, control: 0 }, keyFile });
    api = await startTestApi({
      dataMode: "live",
      authMode: "local",
      ownerPassword: PASSWORD,
      adaptersYaml: renderAdaptersExample({ ports: upstreams.ports, breaker: { failureThreshold: 3, resetAfterMs: 1000 } }),
      env: { HERMES_API_KEY_FILE: keyFile, FRIDAY_STORAGE_PATH: "/" },
      healthIntervalMs: 200,
      listen: true,
    });
    const owner = api.client();
    expect((await owner.loginOwner(PASSWORD)).statusCode).toBe(200);
    probe = await WsProbe.connect(api, owner);
  });
  afterAll(async () => {
    probe?.close();
    await api.close();
    await upstreams.close();
    rmSync(keyDir, { recursive: true, force: true });
  });

  const orbModes = (): string[] => probe.events().filter((e) => e.type === "friday.orb.status_changed").map((e) => e.data.status.mode);
  const voiceModes = (): string[] => probe.events().filter((e) => e.type === "friday.voice.state_changed").map((e) => e.data.mode);
  const ofType = (type: string): any[] => probe.events().filter((e) => e.type === type);
  const setPhase = async (patch: Parameters<typeof makeVoiceStatus>[0], mode: string): Promise<void> => {
    upstreams.voice.setStatus(makeVoiceStatus(patch));
    await probe.waitFor(() => orbModes().at(-1) === mode, 5_000, `Orb ${mode}`);
  };

  it("listening -> transcribing -> thinking -> speaking -> idle, with tts events and directional levels", { timeout: 40_000 }, async () => {
    await setPhase({ state: "command", phase: "listening", input_level: 0.5, input_audio: { level: 0.5, peak: 0.7, low: 0.4, mid: 0.3, high: 0.1 } }, "listening");
    await probe.waitFor(() => ofType("friday.voice.audio_level").some((e) => e.data.direction === "input" && e.data.level === 0.5), 5_000, "Input-Pegel");
    await setPhase({ state: "command", phase: "transcribing" }, "transcribing");
    await setPhase({ state: "command", phase: "thinking" }, "thinking");
    await setPhase({ state: "speaking", speaking: true, tts_active: true, phase: "speaking", output_level: 0.7, output_audio: { level: 0.7, peak: 0.9, low: 0.8, mid: 0.3, high: 0.2 } }, "speaking");
    await probe.waitFor(() => ofType("friday.voice.audio_level").some((e) => e.data.direction === "output" && e.data.low === 0.8), 5_000, "Output-Baender");
    upstreams.voice.setStatus(makeVoiceStatus({ state: "listening", phase: "idle" }));
    // Hermes (fake) has running tasks, so the orb falls back to `working`, not `idle`: the voice layer is what ends.
    await probe.waitFor(() => orbModes().at(-1) !== "speaking" && voiceModes().at(-1) === "idle", 5_000, "Orb verlaesst speaking");

    expect(voiceModes()).toEqual(["listening", "transcribing", "thinking", "speaking", "idle"]);
    const modes = orbModes();
    for (const mode of ["listening", "transcribing", "thinking", "speaking"]) expect(modes).toContain(mode);
    expect(modes.indexOf("listening")).toBeLessThan(modes.indexOf("transcribing"));
    expect(modes.indexOf("transcribing")).toBeLessThan(modes.indexOf("thinking"));
    expect(modes.indexOf("thinking")).toBeLessThan(modes.indexOf("speaking"));

    const started = ofType("friday.voice.tts_started");
    expect(started).toHaveLength(1);
    await probe.waitFor(() => ofType("friday.voice.tts_ended").length === 1, 5_000, "tts_ended");
    expect(ofType("friday.voice.tts_ended")[0].data).toMatchObject({ utteranceId: started[0].data.utteranceId, interrupted: false });
    expect(ofType("friday.voice.transcript_final")).toHaveLength(0); // privacy: no text on the real path
    // the orb read the REAL levels of the active direction
    const speakingOrb = probe.events().filter((e) => e.type === "friday.orb.status_changed" && e.data.status.mode === "speaking").at(-1);
    expect(speakingOrb.data.layers.voice).toBe("speaking");
  });
});
