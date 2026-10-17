import { afterEach, describe, expect, it } from "vitest";
import { assertCanonicalEvent } from "@friday/adapter-core";
import { createFakeUpstream, type FakeUpstream } from "@friday/adapter-testkit";
import { FridayVoiceHttpAdapter, configSchema } from "../src";
import { installLlamaServer } from "./fake/llama-server";
import { makeVoiceStatus } from "./fake/voice-status-server";
import {
  assertCapabilitiesMatchMethods,
  assertContractVersionCompatible,
  assertFailsCleanlyAfterShutdown,
  assertManifestValid,
  assertNoForbiddenKeys,
  assertNoSecretLeak,
  assertValidResult,
  closeSession,
  expectCode,
  invoke,
  openSession,
  settle,
  type Session,
} from "./support/conformance-kit";

/**
 * Conformance (PLAN §11.1) for the voice status adapter. Same check names and rules as `runConformanceSuite`; the
 * generic suite cannot be used as-is because it seeds N paged list items upstream, while the voice service exposes a
 * single status document and no devices/profiles (README, "Conformance"). Upstreams are the testkit's fake HTTP server
 * (fault injection) - the byte-exact friday_voice.py replica is exercised in adapter.test.ts.
 */
const CATEGORY = "voice" as const;
const TIMING = { timeoutMs: 250, maxAttempts: 3, retryBaseDelayMs: 5 } as const;
const PROVIDER_KEYS = ["wake_count", "rejected_speaker", "last_event", "game_mode", "commands", "started"];

interface Rig {
  upstream: FakeUpstream;
  llama: FakeUpstream;
  session: Session;
}
const rigs: Rig[] = [];
const sessions: Session[] = [];

async function open(initialize = true): Promise<Rig> {
  const upstream = await createFakeUpstream();
  const llama = await createFakeUpstream();
  installLlamaServer(llama);
  upstream.route("GET", "/", { body: makeVoiceStatus() });
  const session = await openSession(
    new FridayVoiceHttpAdapter(),
    { baseUrl: upstream.url, localModelUrl: llama.url, ...TIMING },
    { initialize },
  );
  const rig = { upstream, llama, session };
  rigs.push(rig);
  sessions.push(session);
  return rig;
}

afterEach(async () => {
  for (const session of sessions.splice(0)) await closeSession(session).catch(() => undefined);
  for (const rig of rigs.splice(0)) {
    await rig.upstream.close();
    await rig.llama.close();
  }
});

const READS = ["getVoiceStatus", "listVoiceDevices", "getVoiceMetrics", "listVoiceProfiles"] as const;

describe(`Conformance: friday-voice-http [${CATEGORY}, single-resource]`, () => {
  it("manifest valid", async () => {
    const { session } = await open(false);
    assertManifestValid(session.adapter, CATEGORY, configSchema);
  });

  it("contract version compatible", async () => {
    const { session } = await open(false);
    assertContractVersionCompatible(session.adapter);
  });

  it("capabilities match the implemented port methods", async () => {
    const { session } = await open();
    await assertCapabilitiesMatchMethods(session.adapter, CATEGORY);
  });

  it("healthCheck returns the contract shape with latency", async () => {
    const { session } = await open();
    const report = await session.adapter.healthCheck();
    expect(["online", "degraded", "offline", "unknown", "paused"]).toContain(report.status);
    expect(report.status).toBe("online");
    expect(Number.isInteger(report.latencyMs) && (report.latencyMs ?? -1) >= 0).toBe(true);
    session.observed.push(report);
  });

  it("offline behaviour: upstream down -> health offline without throwing, calls fail with ADAPTER_UNAVAILABLE", async () => {
    const { session, upstream } = await open();
    await upstream.setOffline(true);
    const report = await session.adapter.healthCheck();
    expect(report.status).toBe("offline");
    await expectCode(invoke(session, "getVoiceStatus"), "ADAPTER_UNAVAILABLE", true);
    await upstream.setOffline(false);
    expect((await session.adapter.healthCheck()).status, "nach Rückkehr wieder online").toBe("online");
    await invoke(session, "getVoiceStatus");
  });

  it("shutdown releases resources and later calls fail cleanly", async () => {
    const { session, upstream, llama } = await open();
    await closeSession(session);
    await closeSession(session); // idempotent
    const before = upstream.requests.length + llama.requests.length;
    await new Promise((resolve) => setTimeout(resolve, 100));
    await assertFailsCleanlyAfterShutdown(session, CATEGORY);
    await expectCode(invoke(session, "getVoiceStatus"), "ADAPTER_UNAVAILABLE");
    expect(upstream.requests.length + llama.requests.length, "Requests nach shutdown()").toBe(before);
  });

  it("no secret leaks in results, errors, events, health reports or logs", async () => {
    const { session, upstream } = await open();
    for (const status of [401, 403, 500, 429]) {
      upstream.clearFaults();
      upstream.fault("GET", "/", {
        status,
        body: (request) => ({ error: "rejected", echo: request.headers }),
      });
      await settle(invoke(session, "getVoiceStatus"));
    }
    upstream.clearFaults();
    for (const name of READS) await settle(invoke(session, name));
    session.observed.push(
      await session.adapter.healthCheck(),
      session.emitted,
      session.logs,
      await session.adapter.getCapabilities(),
    );
    await closeSession(session);
    expect(session.adapter.manifest.secretFields, "der Status-Endpunkt hat keine Authentifizierung").toEqual(
      [],
    );
    assertNoSecretLeak(session);
  });

  it("timeout handling: slow upstream -> ADAPTER_TIMEOUT within the retry policy", async () => {
    const { session, upstream } = await open();
    upstream.fault("GET", "/", { latencyMs: TIMING.timeoutMs * 4 });
    const started = Date.now();
    const error = await expectCode(invoke(session, "getVoiceStatus"), "ADAPTER_TIMEOUT", true);
    expect(Date.now() - started).toBeLessThan(TIMING.timeoutMs * TIMING.maxAttempts + 2_000);
    expect(error.message.length).toBeGreaterThan(0);
  });

  it("retry behaviour: transient 503 then success succeeds; permanent 4xx is not retried", async () => {
    const { session, upstream } = await open();
    upstream.fault("GET", "/", { statusSequence: [503, 503] });
    await invoke(session, "getVoiceStatus");
    expect(upstream.requestsFor("GET", "/").length, "2 Fehlversuche + 1 Erfolg erwartet").toBe(3);
    for (const [status, code] of [
      [400, "VALIDATION_FAILED"],
      [403, "FORBIDDEN"],
      [404, "NOT_FOUND"],
      [409, "CONFLICT"],
      [422, "VALIDATION_FAILED"],
    ] as const) {
      upstream.clearFaults();
      const before = upstream.requestsFor("GET", "/").length;
      upstream.fault("GET", "/", { status });
      await expectCode(invoke(session, "getVoiceStatus"), code, false);
      expect(
        upstream.requestsFor("GET", "/").length - before,
        `HTTP ${status} darf nicht wiederholt werden`,
      ).toBe(1);
    }
  });

  it("retries are bounded for permanent 5xx", async () => {
    const { session, upstream } = await open();
    upstream.fault("GET", "/", { status: 503 });
    await expectCode(invoke(session, "getVoiceStatus"), "ADAPTER_UNAVAILABLE", true);
    const count = upstream.requestsFor("GET", "/").length;
    expect(count).toBeGreaterThan(1);
    expect(count).toBeLessThanOrEqual(TIMING.maxAttempts);
  });

  it("empty response -> valid empty page (devices and profiles have no data source)", async () => {
    const { session } = await open();
    for (const name of ["listVoiceDevices", "listVoiceProfiles"] as const) {
      const page = (await invoke(session, name)) as {
        items: unknown[];
        pageInfo: { hasNextPage: boolean; nextCursor: string | null };
      };
      expect(page.items).toEqual([]);
      expect(page.pageInfo).toEqual({ hasNextPage: false, nextCursor: null });
      assertValidResult(CATEGORY, name, page);
    }
  });

  it("invalid foreign data is rejected with VALIDATION_FAILED and never forwarded", async () => {
    const { session, upstream } = await open();
    for (const body of [
      { state: "weird", started: 7 },
      { ...makeVoiceStatus(), wake_count: "viele" },
      [],
      "listening",
    ]) {
      upstream.route("GET", "/", { body });
      await expectCode(invoke(session, "getVoiceStatus"), "VALIDATION_FAILED", false);
    }
  });

  it("schema mapping: every returned object validates against its SDK schema", async () => {
    const { session } = await open();
    for (const name of READS) assertValidResult(CATEGORY, name, await invoke(session, name));
  });

  it("error normalization: every upstream failure kind maps to a canonical code", async () => {
    const { session, upstream } = await open();
    const table: Array<[string, Record<string, unknown>, string, boolean]> = [
      ["HTTP 400", { status: 400 }, "VALIDATION_FAILED", false],
      ["HTTP 401", { status: 401 }, "UNAUTHENTICATED", false],
      ["HTTP 403", { status: 403 }, "FORBIDDEN", false],
      ["HTTP 404", { status: 404 }, "NOT_FOUND", false],
      ["HTTP 409", { status: 409 }, "CONFLICT", false],
      ["HTTP 422", { status: 422 }, "VALIDATION_FAILED", false],
      ["HTTP 429", { status: 429, headers: { "retry-after": "0" } }, "RATE_LIMITED", true],
      ["HTTP 500", { status: 500 }, "ADAPTER_UNAVAILABLE", true],
      ["HTTP 502", { status: 502 }, "ADAPTER_UNAVAILABLE", true],
      ["HTTP 503", { status: 503 }, "ADAPTER_UNAVAILABLE", true],
      ["HTTP 504", { status: 504 }, "ADAPTER_TIMEOUT", true],
      ["dropped connection", { drop: true }, "ADAPTER_UNAVAILABLE", true],
      ["malformed JSON", { status: 200, raw: "{not json" }, "VALIDATION_FAILED", false],
    ];
    for (const [label, fault, code, retryable] of table) {
      upstream.clearFaults();
      upstream.fault("GET", "/", fault);
      const error = await expectCode(invoke(session, "getVoiceStatus"), code, retryable).catch(
        (cause: unknown) => {
          throw new Error(`${label}: ${cause instanceof Error ? cause.message : String(cause)}`);
        },
      );
      expect(error.severity).toMatch(/^(info|warning|error|critical)$/);
      expect(typeof error.details).toBe("object");
    }
    upstream.clearFaults();
    await upstream.setOffline(true);
    await expectCode(invoke(session, "getVoiceStatus"), "ADAPTER_UNAVAILABLE", true); // ECONNREFUSED
  });

  it("auth error (401) -> UNAUTHENTICATED, permission error (403) -> FORBIDDEN, neither retried", async () => {
    const { session, upstream } = await open();
    for (const [status, code] of [
      [401, "UNAUTHENTICATED"],
      [403, "FORBIDDEN"],
    ] as const) {
      upstream.clearFaults();
      const before = upstream.requestsFor("GET", "/").length;
      upstream.fault("GET", "/", { status });
      await expectCode(invoke(session, "getVoiceStatus"), code, false);
      expect(upstream.requestsFor("GET", "/").length - before).toBe(1);
    }
    upstream.clearFaults();
    upstream.fault("GET", "/", { status: 401 });
    expect(["offline", "degraded"], "healthCheck bei 401 darf nicht 'online' melden").toContain(
      (await session.adapter.healthCheck()).status,
    );
  });

  it("emits only phase, TTS and audio-level events, canonical, and none while the service idles", async () => {
    const { session, upstream } = await open();
    // The poll cycle on an idle service emits nothing.
    expect(await session.adapter.pollEvents?.()).toBe(0);
    expect(session.emitted).toEqual([]);
    upstream.route("GET", "/", { body: makeVoiceStatus({ state: "command", phase: "listening", input_level: 0.4 }) });
    expect(await session.adapter.pollEvents?.()).toBe(2);
    expect(session.emitted.map((event) => event.type)).toEqual(["friday.voice.state_changed", "friday.voice.audio_level"]);
    for (const event of session.emitted) assertCanonicalEvent(event, "voice-http event");
  });

  it("no provider-specific fields in canonical models", async () => {
    const { session, upstream } = await open();
    upstream.route("GET", "/", {
      body: makeVoiceStatus({ game_mode: "x", last_event: "2026-10-14T09:13:00", wake_count: 4 }),
    });
    for (const name of READS) assertNoForbiddenKeys(await invoke(session, name), PROVIDER_KEYS);
  });
});
