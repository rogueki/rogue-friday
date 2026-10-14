import { afterEach, describe, expect, it } from "vitest";
import { createCorrelationId } from "@jarvis/sdk";
import { AdapterError } from "@jarvis/adapter-core";
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

describe("JarvisVoiceHttpAdapter against the wire-level fake of jarvis_voice.py", () => {
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

  describe("what the service does not expose", () => {
    it("devices and profiles: empty pages with unknown freshness", async () => {
      rig = await createRig();
      for (const result of [
        await rig.adapter.listVoiceDevices({}, call()),
        await rig.adapter.listVoiceProfiles({}, call()),
      ]) {
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

  it("config schema defaults equal the installer configuration (voice.md §0.3)", () => {
    expect(configSchema.properties.baseUrl.default).toBe("http://127.0.0.1:43694");
    expect(configSchema.properties.localModelUrl.default).toBe("http://127.0.0.1:43692");
    expect(configSchema.properties.localModelName.default).toBe("qwen3-router");
    expect(configSchema.properties.wakePhrase.default).toBe("Hey Friday");
    expect(configSchema.properties.ttsEngine.default).toBe("piper");
  });
});
