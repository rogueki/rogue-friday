import { afterEach, describe, expect, it } from "vitest";
import { createCorrelationId } from "@friday/sdk";
import { AdapterError, assertCanonicalEvent } from "@friday/adapter-core";
import { configSchema, manifest } from "../src";
import { makeVoiceStatus } from "./fake/voice-status-server";
import { assertValidResult, expectCode } from "./support/conformance-kit";
import { createRig, FAST, type Rig } from "./support/setup";

const call = () => ({ correlationId: createCorrelationId() });
let rig: Rig | undefined;
afterEach(async () => {
  await rig?.close();
  rig = undefined;
});

describe("FridayVoiceHttpAdapter against the wire-level fake of friday_voice.py", () => {
  it("shows configured cloud routing without contacting local Qwen", async () => {
    rig = await createRig({ cloudMode: true });
    await rig.llama.setOffline(true);
    const status = await rig.adapter.getVoiceStatus({}, call());
    expect(status.data.localModel).toEqual({
      name: "Cloud-Routing (Provider ungeprueft)", state: "ready", latencyMs: null,
    });
    expect(status.data.stt.engine).toBe("ElevenLabs Scribe");
    expect(status.data.tts.engine).toBe("ElevenLabs");
    expect(rig.llama.requests).toHaveLength(0);
    assertValidResult("voice", "getVoiceStatus", status);
  });

  it("declares only voice.read and implements neither test, stop nor enroll", async () => {
    rig = await createRig();
    expect(manifest.capabilities).toEqual(["voice.read"]);
    expect((await rig.adapter.getCapabilities()).capabilities).toEqual(["voice.read"]);
    expect("runVoiceTest" in rig.adapter).toBe(false);
    expect("stopVoice" in rig.adapter).toBe(false);
  });

  it("reads the HTTP/1.0 answer without Content-Length and sends a single GET", async () => {
    rig = await createRig();
    rig.voice.setStatus(makeVoiceStatus({ state: "command", wake_count: 3, trusted: true }));
    const result = await rig.adapter.getVoiceStatus({}, call());
    expect(result.data.mode).toBe("listening");
    expect(result.data.trustedSession.active).toBe(true);
    expect(result.freshness.state).toBe("fresh");
    assertValidResult("voice", "getVoiceStatus", result);
    expect(rig.voice.requestLines).toHaveLength(1);
    expect(rig.voice.requestLines[0]).toMatch(/^GET \/ HTTP\/1\.1$/);
  });

  it("tracks the service state changes", async () => {
    rig = await createRig();
    const modes: string[] = [];
    for (const patch of [
      { state: "listening" as const },
      { state: "command" as const },
      { state: "speaking" as const, speaking: true },
      { state: "followup" as const, speaking: false },
      { state: "listening" as const },
    ]) {
      rig.voice.patchStatus(patch);
      modes.push((await rig.adapter.getVoiceStatus({}, call())).data.mode);
    }
    expect(modes).toEqual(["idle", "listening", "speaking", "listening", "idle"]);
  });

  it("closed port (models still loading or service stopped): ADAPTER_UNAVAILABLE and health offline, no invented status", async () => {
    rig = await createRig();
    await rig.voice.setOffline(true);
    const error = await expectCode(rig.adapter.getVoiceStatus({}, call()), "ADAPTER_UNAVAILABLE", true);
    expect(error.message).toBeTruthy();
    const health = await rig.adapter.healthCheck();
    expect(health.status).toBe("offline");
    expect(health.latencyMs).toBeNull();
    expect(health.message).toContain("lädt noch Modelle");
    await rig.voice.setOffline(false);
    expect((await rig.adapter.healthCheck()).status).toBe("online");
    expect((await rig.adapter.getVoiceStatus({}, call())).data.mode).toBe("idle");
  });

  it("state 'starting' in the JSON: health degraded, microphone off", async () => {
    rig = await createRig();
    rig.voice.patchStatus({ state: "starting" });
    const health = await rig.adapter.healthCheck();
    expect(health.status).toBe("degraded");
    expect(health.errorCode).toBe("STARTING");
    expect(health.latencyMs).toBeGreaterThanOrEqual(0);
    expect((await rig.adapter.getVoiceStatus({}, call())).data.microphone).toMatchObject({
      state: "off",
      active: false,
    });
  });

  it("silent service: ADAPTER_TIMEOUT within the retry policy, health offline", async () => {
    rig = await createRig();
    rig.voice.setFault("silent");
    const started = Date.now();
    await expectCode(rig.adapter.getVoiceStatus({}, call()), "ADAPTER_TIMEOUT", true);
    expect(Date.now() - started).toBeLessThan(FAST.timeoutMs * FAST.maxAttempts + 2_000);
    const health = await rig.adapter.healthCheck();
    expect(health.status).toBe("offline");
    expect(health.errorCode).toBe("ADAPTER_TIMEOUT");
  });

  it.each(["invalid-json", "invalid-shape"] as const)(
    "%s: VALIDATION_FAILED, not retried, health degraded",
    async (fault) => {
      rig = await createRig();
      rig.voice.setFault(fault);
      const error = await expectCode(rig.adapter.getVoiceStatus({}, call()), "VALIDATION_FAILED", false);
      expect(error).toBeInstanceOf(AdapterError);
      expect(rig.voice.requestLines).toHaveLength(1);
      expect((await rig.adapter.healthCheck()).status).toBe("degraded");
    },
  );

  it("transient failures are retried (GET), permanent 500 stays bounded", async () => {
    rig = await createRig();
    rig.voice.failNext(["http-500", "drop"]);
    expect((await rig.adapter.getVoiceStatus({}, call())).data.mode).toBe("idle");
    expect(rig.voice.requestLines).toHaveLength(3);

    rig.voice.requestLines.length = 0;
    rig.voice.setFault("http-500");
    await expectCode(rig.adapter.getVoiceStatus({}, call()), "ADAPTER_UNAVAILABLE", true);
    expect(rig.voice.requestLines.length).toBe(FAST.maxAttempts);
    const health = await rig.adapter.healthCheck();
    expect(health.status).toBe("degraded");
  });

  it("health check uses a single attempt", async () => {
    rig = await createRig();
    rig.voice.setFault("http-500");
    await rig.adapter.healthCheck();
    expect(rig.voice.requestLines).toHaveLength(1);
  });

  describe("router model probe (GET /v1/models, never fails the status)", () => {
    it("ready when llama-server answers", async () => {
      rig = await createRig();
      const result = await rig.adapter.getVoiceStatus({}, call());
      expect(result.data.localModel).toEqual({ name: "qwen3-router", state: "ready", latencyMs: null });
      expect(rig.llama.requests.map((r) => r.path)).toEqual(["/v1/models"]);
    });

    it("offline when the port is closed, status still delivered", async () => {
      rig = await createRig();
      await rig.llama.setOffline(true);
      const result = await rig.adapter.getVoiceStatus({}, call());
      expect(result.data.localModel.state).toBe("offline");
      expect(result.data.mode).toBe("idle");
    });

    it("busy on 503 (model loading, Annahme (unbelegt)), error on 4xx or invalid JSON, offline on timeout", async () => {
      rig = await createRig();
      const probe = async () => (await rig!.adapter.getVoiceStatus({}, call())).data.localModel.state;
      rig.llama.fault("GET", "/v1/models", { status: 503 });
      expect(await probe()).toBe("busy");
      rig.llama.clearFaults();
      rig.llama.fault("GET", "/v1/models", { status: 401 });
      expect(await probe()).toBe("error");
      rig.llama.clearFaults();
      rig.llama.fault("GET", "/v1/models", { raw: "<html>", status: 200 });
      expect(await probe()).toBe("error");
      rig.llama.clearFaults();
      rig.llama.fault("GET", "/v1/models", { latencyMs: FAST.timeoutMs * 3 });
      expect(await probe()).toBe("offline");
    });

    it("probes with one attempt only", async () => {
      rig = await createRig();
      rig.llama.fault("GET", "/v1/models", { status: 500 });
      await rig.adapter.getVoiceStatus({}, call());
      expect(rig.llama.requests).toHaveLength(1);
    });
  });

  describe("optional voice resources", () => {
    it("devices are fresh from the host while profiles remain unknown", async () => {
      rig = await createRig();
      const deviceResult = await rig.adapter.listVoiceDevices({}, call());
      expect(deviceResult.items).toEqual([]);
      expect(deviceResult.freshness.state).toBe("fresh");
      for (const result of [await rig.adapter.listVoiceProfiles({}, call())]) {
        expect(result.items).toEqual([]);
        expect(result.pageInfo).toEqual({ nextCursor: null, hasNextPage: false });
        expect(result.freshness.state).toBe("unknown");
      }
      assertValidResult("voice", "listVoiceDevices", await rig.adapter.listVoiceDevices({}, call()));
      assertValidResult("voice", "listVoiceProfiles", await rig.adapter.listVoiceProfiles({}, call()));
    });

    it("metrics: empty statistics, no request to the service", async () => {
      rig = await createRig();
      const metrics = await rig.adapter.getVoiceMetrics({}, call());
      expect(metrics.freshness.state).toBe("unknown");
      expect(metrics.data.sttLatency.sampleCount).toBe(0);
      assertValidResult("voice", "getVoiceMetrics", metrics);
      expect(rig.voice.requestLines).toHaveLength(0);
    });
  });

  describe("audio level (friday.voice.audio_level)", () => {
    const LEVELS = { levelPollIntervalMs: 20, idlePollIntervalMs: 20 } as const;
    const levelEvents = (r: Rig) =>
      r.session.emitted.filter((event) => event.type === "friday.voice.audio_level");
    const waitFor = async (check: () => boolean, ms = 2_000): Promise<void> => {
      const end = Date.now() + ms;
      while (!check()) {
        if (Date.now() > end) throw new Error("timeout waiting for condition");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    };

    it("maps input_level to microphone.inputLevel and clamps out-of-range values", async () => {
      rig = await createRig();
      rig.voice.setStatus(makeVoiceStatus({ state: "command", input_level: 0.42 }));
      const status = await rig.adapter.getVoiceStatus({}, call());
      expect(status.data.microphone.inputLevel).toBe(0.42);
      assertValidResult("voice", "getVoiceStatus", status);
      rig.voice.patchStatus({ input_level: 7 });
      expect((await rig.adapter.getVoiceStatus({}, call())).data.microphone.inputLevel).toBe(1);
    });

    it("emits input levels while recording, output levels while speaking, and a final 0 afterwards", async () => {
      rig = await createRig(LEVELS);
      const r = rig;
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(levelEvents(r)).toHaveLength(0); // listening for the wake word: nothing is emitted

      r.voice.setStatus(makeVoiceStatus({ state: "command", input_level: 0.5, output_level: 0.9 }));
      await waitFor(() => levelEvents(r).length >= 2);
      for (const event of levelEvents(r)) {
        expect(event.data).toMatchObject({ direction: "input", level: 0.5 });
        assertCanonicalEvent(event, "voice-http audio level");
      }

      r.voice.setStatus(makeVoiceStatus({ state: "speaking", speaking: true, input_level: 0.1, output_level: 0.7 }));
      await waitFor(() => levelEvents(r).some((e) => (e.data as { direction: string }).direction === "output"));
      const output = levelEvents(r).filter((e) => (e.data as { direction: string }).direction === "output");
      expect(output[0]?.data).toMatchObject({ level: 0.7 });
      // the input direction ends with a single 0 once recording stops
      expect(levelEvents(r).some((e) => (e.data as { direction: string; level: number }).direction === "input" && (e.data as { level: number }).level === 0)).toBe(true);

      r.voice.setStatus(makeVoiceStatus({ state: "listening" }));
      await waitFor(() => levelEvents(r).some((e) => (e.data as { direction: string; level: number }).direction === "output" && (e.data as { level: number }).level === 0));
      const settled = levelEvents(r).length;
      await new Promise((resolve) => setTimeout(resolve, 120));
      expect(levelEvents(r)).toHaveLength(settled); // quiet again: no more events
    });

    it("treats a service without the meter as level 0 and keeps working", async () => {
      rig = await createRig(LEVELS);
      const r = rig;
      r.voice.setStatus(makeVoiceStatus({ state: "followup" }));
      await waitFor(() => levelEvents(r).length >= 1);
      expect(levelEvents(r)[0]?.data).toMatchObject({ direction: "input", level: 0 });
    });

    it("is off with levelPollIntervalMs 0 and sends no request on its own", async () => {
      rig = await createRig({ levelPollIntervalMs: 0 });
      rig.voice.setStatus(makeVoiceStatus({ state: "command", input_level: 0.5 }));
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(rig.voice.requestLines).toHaveLength(0);
      expect(levelEvents(rig)).toHaveLength(0);
    });

    it("level polling neither masks nor delays the outage state: health offline while down, online again right after, no events while down", async () => {
      rig = await createRig(LEVELS);
      const r = rig;
      r.voice.setStatus(makeVoiceStatus({ state: "command", input_level: 0.3 }));
      await waitFor(() => levelEvents(r).length >= 1);
      await r.voice.setOffline(true);
      await new Promise((resolve) => setTimeout(resolve, 100)); // several failed polls
      const during = levelEvents(r).length;
      for (let i = 0; i < 3; i += 1) {
        const health = await r.adapter.healthCheck();
        expect(health).toMatchObject({ status: "offline", errorCode: "ADAPTER_UNAVAILABLE", latencyMs: null });
        await expectCode(r.adapter.getVoiceStatus({}, call()), "ADAPTER_UNAVAILABLE", true);
      }
      expect(levelEvents(r)).toHaveLength(during); // an unreachable service emits no (stale) level
      await r.voice.setOffline(false);
      expect((await r.adapter.healthCheck()).status).toBe("online"); // first probe after the restart, not after the next poll tick
      expect((await r.adapter.getVoiceStatus({}, call())).data.mode).toBe("listening");
      await waitFor(() => levelEvents(r).length > during, 4_000);
    });

    it("survives an outage, resumes afterwards and stops after shutdown", async () => {
      rig = await createRig(LEVELS);
      const r = rig;
      r.voice.setStatus(makeVoiceStatus({ state: "command", input_level: 0.3 }));
      await waitFor(() => levelEvents(r).length >= 1);
      await r.voice.setOffline(true);
      await new Promise((resolve) => setTimeout(resolve, 100));
      await r.voice.setOffline(false);
      const before = levelEvents(r).length;
      await waitFor(() => levelEvents(r).length > before, 4_000);
      await r.adapter.shutdown();
      const afterShutdown = levelEvents(r).length;
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(levelEvents(r)).toHaveLength(afterShutdown);
    });
  });

  describe("voice phases, TTS and bands (friday.voice.state_changed / tts_started / tts_ended)", () => {
    const events = (r: Rig) => r.session.emitted.map((event) => ({ type: event.type, data: event.data as unknown as Record<string, unknown> }));
    const of = (r: Rig, type: string) => events(r).filter((event) => event.type === type);

    it("walks listening -> transcribing -> thinking -> speaking -> idle and reports each change exactly once", async () => {
      rig = await createRig();
      const r = rig;
      const steps = [
        makeVoiceStatus({ state: "command", phase: "listening", input_level: 0.6 }),
        makeVoiceStatus({ state: "command", phase: "listening", input_level: 0.5 }), // no change: no state event
        makeVoiceStatus({ state: "command", phase: "transcribing" }),
        makeVoiceStatus({ state: "command", phase: "thinking" }),
        makeVoiceStatus({ state: "speaking", speaking: true, tts_active: true, phase: "speaking", output_level: 0.7 }),
        makeVoiceStatus({ state: "followup", phase: "listening" }),
        makeVoiceStatus({ state: "listening", phase: "idle" }),
      ];
      for (const status of steps) {
        r.voice.setStatus(status);
        await r.adapter.pollEvents();
      }
      const modes = of(r, "friday.voice.state_changed").map((event) => event.data.mode);
      expect(modes).toEqual(["listening", "transcribing", "thinking", "speaking", "listening", "idle"]);
      for (const event of r.session.emitted) assertCanonicalEvent(event, "voice-http event");
    });

    it("carries the full VoiceStatus in state_changed (stt busy while transcribing)", async () => {
      rig = await createRig();
      const r = rig;
      r.voice.setStatus(makeVoiceStatus({ state: "command", phase: "transcribing" }));
      await r.adapter.pollEvents();
      expect(of(r, "friday.voice.state_changed")[0]?.data).toMatchObject({
        mode: "transcribing",
        stt: { state: "busy" },
        microphone: { state: "idle", active: true },
      });
    });

    it("emits tts_started once and tts_ended with duration; barge-in is flagged interrupted", async () => {
      rig = await createRig();
      const r = rig;
      r.voice.setStatus(makeVoiceStatus({ state: "speaking", speaking: true, phase: "speaking" }));
      await r.adapter.pollEvents();
      await r.adapter.pollEvents();
      expect(of(r, "friday.voice.tts_started")).toHaveLength(1);
      expect(of(r, "friday.voice.tts_started")[0]?.data).toMatchObject({ engine: "piper" });
      r.voice.setStatus(makeVoiceStatus({ state: "followup", phase: "listening" }));
      await r.adapter.pollEvents();
      const ended = of(r, "friday.voice.tts_ended");
      expect(ended).toHaveLength(1);
      expect(ended[0]?.data).toMatchObject({ interrupted: false });
      expect(ended[0]?.data.utteranceId).toBe(of(r, "friday.voice.tts_started")[0]?.data.utteranceId);
      expect(ended[0]?.data.durationMs).toBeGreaterThanOrEqual(0);

      r.voice.setStatus(makeVoiceStatus({ state: "speaking", speaking: true, phase: "speaking" }));
      await r.adapter.pollEvents();
      r.voice.setStatus(makeVoiceStatus({ state: "command", phase: "listening" })); // wake word during playback
      await r.adapter.pollEvents();
      expect(of(r, "friday.voice.tts_ended")[1]?.data).toMatchObject({ interrupted: true });
      expect(of(r, "friday.voice.tts_started")[1]?.data.utteranceId).not.toBe(of(r, "friday.voice.tts_started")[0]?.data.utteranceId);
    });

    it("sends peak and bands with the audio level and no input level while transcribing or thinking", async () => {
      rig = await createRig();
      const r = rig;
      r.voice.setStatus(makeVoiceStatus({ state: "command", phase: "listening", input_level: 0.5, input_audio: { level: 0.5, peak: 0.8, low: 0.6, mid: 0.4, high: 0.1 } }));
      await r.adapter.pollEvents();
      expect(of(r, "friday.voice.audio_level")[0]?.data).toMatchObject({ direction: "input", level: 0.5, peak: 0.8, low: 0.6, mid: 0.4, high: 0.1 });
      r.voice.setStatus(makeVoiceStatus({ state: "command", phase: "transcribing", input_level: 0.5 }));
      await r.adapter.pollEvents();
      const levels = of(r, "friday.voice.audio_level");
      expect(levels).toHaveLength(2);
      expect(levels[1]?.data).toMatchObject({ direction: "input", level: 0 }); // single final 0, then silence
      await r.adapter.pollEvents();
      expect(of(r, "friday.voice.audio_level")).toHaveLength(2);
      r.voice.setStatus(makeVoiceStatus({ state: "speaking", speaking: true, phase: "speaking", output_audio: { level: 0.7, peak: 0.9, low: 0.8, mid: 0.3, high: 0.2 } }));
      await r.adapter.pollEvents();
      expect(of(r, "friday.voice.audio_level").at(-1)?.data).toMatchObject({ direction: "output", level: 0.7, low: 0.8, mid: 0.3, high: 0.2 });
    });

    it("browser transport: only phases here; audio levels and TTS events belong to the browser audio gateway", async () => {
      rig = await createRig();
      const r = rig;
      r.voice.setStatus(makeVoiceStatus({ state: "speaking", speaking: true, phase: "speaking", audio_transport: "browser", output_level: 0.7 }));
      await r.adapter.pollEvents();
      expect(events(r).map((event) => event.type)).toEqual(["friday.voice.state_changed"]);
    });

    it("never publishes transcript text", async () => {
      rig = await createRig();
      const r = rig;
      for (const phase of ["listening", "transcribing", "thinking"] as const) {
        r.voice.setStatus(makeVoiceStatus({ state: "command", phase }));
        await r.adapter.pollEvents();
      }
      expect(events(r).some((event) => event.type.startsWith("friday.voice.transcript"))).toBe(false);
    });

    it("an unreachable service closes an open utterance (interrupted) and a restart is reported again", async () => {
      rig = await createRig({ levelPollIntervalMs: 20, idlePollIntervalMs: 20 });
      const r = rig;
      const waitFor = async (check: () => boolean): Promise<void> => {
        const end = Date.now() + 3_000;
        while (!check()) {
          if (Date.now() > end) throw new Error("timeout waiting for condition");
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      };
      r.voice.setStatus(makeVoiceStatus({ state: "speaking", speaking: true, phase: "speaking" }));
      await waitFor(() => of(r, "friday.voice.tts_started").length === 1);
      await r.voice.setOffline(true);
      await waitFor(() => of(r, "friday.voice.tts_ended").length === 1);
      expect(of(r, "friday.voice.tts_ended")[0]?.data).toMatchObject({ interrupted: true });
      await r.voice.setOffline(false);
      await waitFor(() => of(r, "friday.voice.tts_started").length === 2);
    });
  });

  it("config schema defaults equal the installer configuration (voice.md §0.3)", () => {
    expect(configSchema.properties.baseUrl.default).toBe("http://127.0.0.1:43694");
    expect(configSchema.properties.localModelUrl.default).toBe("http://127.0.0.1:43692");
    expect(configSchema.properties.localModelName.default).toBe("qwen3-router");
    expect(configSchema.properties.wakePhrase.default).toBe("Hey Friday");
    expect(configSchema.properties.ttsEngine.default).toBe("piper");
  });
});
