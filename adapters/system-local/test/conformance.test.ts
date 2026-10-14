import { afterEach, describe, expect, it } from "vitest";
import { createCorrelationId } from "@jarvis/sdk";
import { configSchema } from "../src";
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
  settle,
} from "./support/conformance-kit";
import { createRig, type Rig } from "./support/setup";

/**
 * Conformance (PLAN §11.1) for the local system adapter. Same check names and rules as `runConformanceSuite`, adapted
 * to an adapter whose data comes from the local machine plus health probes: a down service is a *state* of that
 * service (never a thrown error), so "offline behaviour", "timeout" and "error normalization" assert the resulting
 * Service/ModelProvider status instead of an `AdapterError` (README, "Conformance").
 */
const CATEGORY = "system" as const;
const TIMEOUT_MS = 250;
const PROVIDER_KEYS = [
  "owned_by",
  "object",
  "permission",
  "root",
  "parent",
  "platform",
  "readiness",
  "wake_count",
  "rejected_speaker",
  "last_event",
  "game_mode",
  "created_at",
];

let rig: Rig | undefined;
const open = async (options: Parameters<typeof createRig>[0] = {}): Promise<Rig> => {
  rig = await createRig(options);
  return rig;
};
afterEach(async () => {
  await rig?.close();
  rig = undefined;
});

const call = () => ({ correlationId: createCorrelationId() });
const names = ["getSystemMetrics", "listServices", "listStorageVolumes", "listModelProviders"] as const;
const readAll = async (r: Rig) => {
  const pending = invoke(r.session, "getSystemMetrics");
  r.host.tick(1, 1);
  await pending;
  for (const name of names.slice(1)) await invoke(r.session, name);
};
const serviceStatus = async (r: Rig, name: string) =>
  (
    (await invoke(r.session, "listServices")) as {
      items: Array<{ name: string; status: string; detail?: string }>;
    }
  ).items.find((s) => s.name === name);

describe(`Conformance: local-system [${CATEGORY}, probes]`, () => {
  it("manifest valid", async () => {
    const { session } = await open();
    assertManifestValid(session.adapter, CATEGORY, configSchema);
  });

  it("contract version compatible", async () => {
    const { session } = await open();
    assertContractVersionCompatible(session.adapter);
  });

  it("capabilities match the implemented port methods", async () => {
    const { session } = await open();
    await assertCapabilitiesMatchMethods(session.adapter, CATEGORY);
  });

  it("healthCheck returns the contract shape with latency", async () => {
    const { session } = await open();
    const report = await session.adapter.healthCheck();
    expect(report.status).toBe("online");
    expect(Number.isInteger(report.latencyMs) && (report.latencyMs ?? -1) >= 0).toBe(true);
  });

  it("offline behaviour: services down -> adapter stays online, services report offline, nothing throws", async () => {
    const r = await open();
    await Promise.all([
      r.qwen.setOffline(true),
      r.hermes.setOffline(true),
      r.dashboard.setOffline(true),
      r.voice.setOffline(true),
    ]);
    expect((await r.session.adapter.healthCheck()).status).toBe("online");
    const items = (
      (await invoke(r.session, "listServices")) as { items: Array<{ name: string; status: string }> }
    ).items;
    expect(items.filter((s) => s.status === "offline").map((s) => s.name)).toEqual([
      "Qwen lokal (llama-server)",
      "Hermes API",
      "Hermes Dashboard",
      "Voice-Dienst",
    ]);
    expect(items.at(-1)).toMatchObject({ name: "Control API", status: "online" });
    const providers = (
      (await invoke(r.session, "listModelProviders")) as {
        items: Array<{ status: string; models: string[] }>;
      }
    ).items;
    expect(providers.every((p) => p.status === "offline" && p.models.length === 0)).toBe(true);
    await Promise.all([
      r.qwen.setOffline(false),
      r.hermes.setOffline(false),
      r.dashboard.setOffline(false),
      r.voice.setOffline(false),
    ]);
    expect((await serviceStatus(r, "Qwen lokal (llama-server)"))?.status, "nach Rückkehr wieder online").toBe(
      "online",
    );
  });

  it("shutdown releases resources and later calls fail cleanly", async () => {
    const r = await open();
    await closeSession(r.session);
    await closeSession(r.session); // idempotent
    const before =
      r.qwen.requests.length +
      r.hermes.requests.length +
      r.dashboard.requests.length +
      r.voice.requestLines.length;
    await new Promise((resolve) => setTimeout(resolve, 100));
    await assertFailsCleanlyAfterShutdown(r.session, CATEGORY);
    for (const name of names) await expectCode(invoke(r.session, name), "ADAPTER_UNAVAILABLE");
    await expectCode(
      invoke(r.session, "runServiceHealthcheck", { id: "svc_00000000000000000000000000" }),
      "ADAPTER_UNAVAILABLE",
    );
    expect(
      r.qwen.requests.length +
        r.hermes.requests.length +
        r.dashboard.requests.length +
        r.voice.requestLines.length,
    ).toBe(before);
    expect((await r.session.adapter.healthCheck()).status).toBe("offline");
  });

  it("no secret leaks in results, errors, events, health reports or logs", async () => {
    const r = await open();
    const echo = (request: { headers: Record<string, string> }) => ({
      error: "rejected",
      echo: request.headers,
    });
    await readAll(r);
    for (const status of [401, 403, 500, 429]) {
      r.hermes.clearFaults();
      r.hermes.fault("GET", "/v1/models", { status, body: echo });
      r.hermes.fault("GET", "/health", { status, body: echo });
      await settle(readAll(r));
    }
    r.hermes.clearFaults();
    r.hermes.fault("GET", "/v1/models", { raw: `{"broken": "${r.hermesKey}", `, status: 200 });
    await settle(invoke(r.session, "listModelProviders"));
    r.hermes.clearFaults();
    r.hermes.fault("GET", "/v1/models", { drop: true });
    await settle(invoke(r.session, "listModelProviders"));
    r.session.observed.push(
      await r.session.adapter.healthCheck(),
      r.session.emitted,
      r.session.logs,
      await r.session.adapter.getCapabilities(),
    );
    await closeSession(r.session);
    expect(Object.keys(r.session.secrets)).toEqual(["hermesApiKey"]);
    assertNoSecretLeak(r.session);
    // The key really was used: the leak check is not vacuous.
    expect(r.hermesState.acceptedKeys.length).toBeGreaterThan(0);
    expect(
      r.hermes.requests.some((request) => request.headers.authorization === `Bearer ${r.hermesKey}`),
    ).toBe(true);
  });

  it("timeout handling: hung upstream -> service degraded within the probe timeout, the list still answers", async () => {
    const r = await open();
    r.qwen.fault("GET", "/v1/models", { latencyMs: TIMEOUT_MS * 8 });
    const started = Date.now();
    const service = await serviceStatus(r, "Qwen lokal (llama-server)");
    expect(service?.status).toBe("degraded");
    expect(service?.detail).toContain("Zeitüberschreitung");
    expect(Date.now() - started).toBeLessThan(TIMEOUT_MS + 1_000);
  });

  it("retry behaviour: probes make exactly one attempt per call, also for 5xx and for the healthcheck action", async () => {
    const r = await open();
    r.hermes.fault("GET", "/health", { status: 503 });
    const list = (await invoke(r.session, "listServices")) as { items: Array<{ id: string; name: string }> };
    expect(r.hermes.requestsFor("GET", "/health")).toHaveLength(1);
    const id = list.items.find((s) => s.name === "Hermes API")!.id;
    await invoke(r.session, "runServiceHealthcheck", { id });
    expect(r.hermes.requestsFor("GET", "/health")).toHaveLength(2);
  });

  it("empty response -> valid empty page (no storage path readable)", async () => {
    const r = await open({ config: { storagePaths: ["/nicht/vorhanden"] } });
    const page = (await invoke(r.session, "listStorageVolumes")) as {
      items: unknown[];
      pageInfo: { hasNextPage: boolean; nextCursor: string | null };
    };
    expect(page.items).toEqual([]);
    expect(page.pageInfo).toEqual({ hasNextPage: false, nextCursor: null });
    assertValidResult(CATEGORY, "listStorageVolumes", page);
  });

  it("pagination: a cursor walk returns every item exactly once and hasNextPage is consistent", async () => {
    const r = await open({ platform: "win32" });
    r.host.onRun("wsl.exe", Buffer.from("  NAME STATE VERSION\r\n* Ubuntu Running 2\r\n", "utf16le"));
    const ids: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    for (; pages < 20; pages += 1) {
      const page = (await invoke(r.session, "listServices", { limit: 4, ...(cursor ? { cursor } : {}) })) as {
        items: Array<{ id: string }>;
        pageInfo: { hasNextPage: boolean; nextCursor: string | null };
      };
      ids.push(...page.items.map((item) => item.id));
      expect(page.pageInfo.hasNextPage, "hasNextPage muss zu nextCursor passen").toBe(
        page.pageInfo.nextCursor !== null,
      );
      if (!page.pageInfo.hasNextPage) break;
      expect(page.pageInfo.nextCursor).not.toBe(cursor);
      cursor = page.pageInfo.nextCursor;
    }
    expect(ids).toHaveLength(6); // Qwen, Hermes API, Hermes Dashboard, Voice, WSL, Control API
    expect(new Set(ids).size, "Doppelte Items im Cursor-Walk").toBe(6);
    expect(pages + 1).toBe(2);
  });

  it("invalid foreign data is rejected: garbage answers never become model data", async () => {
    const r = await open();
    r.qwen.route("GET", "/v1/models", { raw: "<html>nginx</html>" });
    r.hermes.route("GET", "/v1/models", { body: { data: [{ id: 42 }, null, "x"] } });
    r.hermes.route("GET", "/health", { raw: "{kaputt" });
    const services = (await invoke(r.session, "listServices")) as {
      items: Array<{ name: string; status: string }>;
    };
    expect(services.items.find((s) => s.name === "Qwen lokal (llama-server)")?.status).toBe("degraded");
    expect(services.items.find((s) => s.name === "Hermes API")?.status).toBe("degraded");
    const providers = (await invoke(r.session, "listModelProviders")) as {
      items: Array<{ name: string; models: string[] }>;
    };
    expect(providers.items.every((p) => p.models.length === 0)).toBe(true);
    expect(JSON.stringify(providers)).not.toContain("nginx");
  });

  it("schema mapping: every returned object validates against its SDK schema", async () => {
    const r = await open();
    r.host.onRun("nvidia-smi", "NVIDIA GeForce RTX 4070, 12, 45, 1024, 12282\n");
    const pending = invoke(r.session, "getSystemMetrics");
    r.host.tick(5, 5);
    assertValidResult(CATEGORY, "getSystemMetrics", await pending);
    for (const name of names.slice(1)) assertValidResult(CATEGORY, name, await invoke(r.session, name));
    const services = (await invoke(r.session, "listServices")) as { items: Array<{ id: string }> };
    const result = await r.adapter.runServiceHealthcheck({ id: services.items[0]!.id }, call());
    assertValidResult(CATEGORY, "runServiceHealthcheck", result);
  });

  it("error normalization: every upstream failure kind maps to a defined service status", async () => {
    const r = await open();
    const table: Array<[string, Record<string, unknown>, string]> = [
      ["HTTP 400", { status: 400 }, "degraded"],
      ["HTTP 401", { status: 401 }, "degraded"],
      ["HTTP 403", { status: 403 }, "degraded"],
      ["HTTP 404", { status: 404 }, "degraded"],
      ["HTTP 409", { status: 409 }, "degraded"],
      ["HTTP 422", { status: 422 }, "degraded"],
      ["HTTP 429", { status: 429, headers: { "retry-after": "0" } }, "degraded"],
      ["HTTP 500", { status: 500 }, "degraded"],
      ["HTTP 502", { status: 502 }, "degraded"],
      ["HTTP 503", { status: 503 }, "degraded"],
      ["HTTP 504", { status: 504 }, "degraded"],
      ["dropped connection", { drop: true }, "offline"],
      ["malformed JSON", { status: 200, raw: "{not json" }, "degraded"],
    ];
    for (const [label, fault, expected] of table) {
      r.hermes.clearFaults();
      r.hermes.fault("GET", "/health", fault);
      const service = await serviceStatus(r, "Hermes API");
      expect(service?.status, `${label}: Dienststatus`).toBe(expected);
      expect(service?.detail?.length, `${label}: Begründung`).toBeGreaterThan(0);
    }
    r.hermes.clearFaults();
    await r.hermes.setOffline(true);
    expect((await serviceStatus(r, "Hermes API"))?.status).toBe("offline"); // ECONNREFUSED
  });

  it("auth error (401) -> degraded provider without models, permission error (403) likewise, neither retried", async () => {
    const r = await open();
    for (const status of [401, 403]) {
      r.hermes.clearFaults();
      const before = r.hermes.requestsFor("GET", "/v1/models").length;
      r.hermes.fault("GET", "/v1/models", { status });
      const providers = (await invoke(r.session, "listModelProviders")) as {
        items: Array<{ name: string; status: string; models: string[] }>;
      };
      const hermes = providers.items.find((p) => p.name === "Hermes (API-Server)");
      expect(hermes).toMatchObject({ status: "degraded", models: [] });
      expect(r.hermes.requestsFor("GET", "/v1/models").length - before).toBe(1);
    }
    expect((await r.session.adapter.healthCheck()).status, "Lokale Hardwaredaten bleiben lesbar").toBe(
      "online",
    );
  });

  it("no events are declared: system.stream is not part of this adapter", async () => {
    const r = await open();
    expect(r.session.adapter.pollEvents).toBeUndefined();
    await readAll(r);
    expect(r.session.emitted).toEqual([]);
  });

  it("no provider-specific fields in canonical models; ids are contract ids", async () => {
    const r = await open();
    const pending = invoke(r.session, "getSystemMetrics");
    r.host.tick(1, 1);
    const metrics = await pending;
    assertNoForbiddenKeys(metrics, PROVIDER_KEYS);
    for (const name of names.slice(1)) {
      const page = (await invoke(r.session, name)) as { items: Array<{ id: string }> };
      assertNoForbiddenKeys(page, PROVIDER_KEYS);
      for (const item of page.items) expect(item.id).toMatch(/^(svc|vol|mdl)_[0-9A-Za-z]{26}$/);
    }
  });
});
