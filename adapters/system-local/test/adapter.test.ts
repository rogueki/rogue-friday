import { afterEach, describe, expect, it } from "vitest";
import { createCorrelationId } from "@friday/sdk";
import type { CallContext, MutationContext } from "@friday/adapter-core";
import { LocalSystemAdapter, configSchema, manifest } from "../src";
import { installHermesApi } from "./fake/hermes-server";
import { makeVoiceStatus } from "./fake/voice-status-server";
import { assertValidResult, expectCode, openSession } from "./support/conformance-kit";
import { wslOutput } from "./support/fake-host";
import { createRig, startWithoutSecrets, type Rig } from "./support/setup";

const call = (): CallContext => ({ correlationId: createCorrelationId() });
const mutation = (): MutationContext => ({ correlationId: createCorrelationId() });
let rig: Rig | undefined;
afterEach(async () => {
  await rig?.close();
  rig = undefined;
});

const NVIDIA = "NVIDIA GeForce RTX 4070, 12, 45, 1024, 12282\n";

describe("system.read: hardware", () => {
  it("CPU load from tick deltas, cores, RAM from node:os values", async () => {
    rig = await createRig();
    rig.host.setMemory(16 * 1024 ** 3, 4 * 1024 ** 3);
    // First call has no baseline: it measures over a short window, so the counters must move meanwhile.
    const first = rig.adapter.getSystemMetrics({}, call());
    rig.host.tick(30, 70);
    const { data, freshness } = await first;
    expect(data.cpu.cores).toBe(2);
    expect(data.cpu.usagePercent).toBe(30);
    expect(data.cpu.temperatureC).toBeNull();
    expect(data.ram).toEqual({ totalBytes: 16 * 1024 ** 3, usedBytes: 12 * 1024 ** 3, usagePercent: 75 });
    expect(freshness.state).toBe("fresh");
    assertValidResult("system", "getSystemMetrics", { data, freshness });

    rig.host.tick(80, 20);
    expect((await rig.adapter.getSystemMetrics({}, call())).data.cpu.usagePercent).toBe(80);
  });

  it("a stale CPU baseline is not used (measures over a fresh window)", async () => {
    rig = await createRig();
    const pending = rig.adapter.getSystemMetrics({}, call());
    rig.host.tick(10, 90);
    await pending;
    const clock = rig.session.context.clock;
    const realNow = clock.now.bind(clock);
    (clock as { now: () => number }).now = () => realNow() + 120_000;
    try {
      const again = rig.adapter.getSystemMetrics({}, call());
      rig.host.tick(50, 50);
      expect((await again).data.cpu.usagePercent).toBe(50);
    } finally {
      (clock as { now: () => number }).now = realNow;
    }
  });

  it("GPU and VRAM from nvidia-smi, with the temperature as sensor", async () => {
    rig = await createRig();
    rig.host.onRun("nvidia-smi", NVIDIA);
    const pending = rig.adapter.getSystemMetrics({}, call());
    rig.host.tick(1, 1);
    const { data } = await pending;
    expect(data.gpu).toEqual({ name: "NVIDIA GeForce RTX 4070", usagePercent: 12, temperatureC: 45 });
    expect(data.vram).toEqual({
      usedBytes: 1024 * 1024 ** 2,
      totalBytes: 12282 * 1024 ** 2,
      usagePercent: 8.3,
    });
    expect(data.temperatures).toEqual([{ sensor: "GPU", celsius: 45 }]);
    expect(rig.host.calls.find((c) => c.file === "nvidia-smi")?.args).toEqual([
      "--query-gpu=name,utilization.gpu,temperature.gpu,memory.used,memory.total",
      "--format=csv,noheader,nounits",
    ]);
  });

  it("no nvidia-smi: gpu and vram are null (never 0), the rest is still delivered", async () => {
    rig = await createRig();
    const pending = rig.adapter.getSystemMetrics({}, call());
    rig.host.tick(1, 1);
    const { data } = await pending;
    expect(data.gpu).toBeNull();
    expect(data.vram).toBeNull();
    expect(data.temperatures).toEqual([]);
    expect(data.storage).toHaveLength(1);
  });

  it("garbage output from nvidia-smi yields null and a log entry", async () => {
    rig = await createRig();
    rig.host.onRun(
      "nvidia-smi",
      "NVIDIA-SMI has failed because it couldn't communicate with the NVIDIA driver.",
    );
    const pending = rig.adapter.getSystemMetrics({}, call());
    rig.host.tick(1, 1);
    expect((await pending).data.gpu).toBeNull();
    expect(rig.session.logs.some((r) => r.level === "warn" && r.message.includes("nvidia-smi"))).toBe(true);
  });

  it("GPU probe can be switched off and caches a failure so nvidia-smi is not spawned on every poll", async () => {
    rig = await createRig();
    const read = async () => {
      const pending = rig!.adapter.getSystemMetrics({}, call());
      rig!.host.tick(1, 1);
      await pending;
    };
    await read();
    await read();
    await read();
    expect(rig.host.calls.filter((c) => c.file === "nvidia-smi")).toHaveLength(1);
    await rig.close();

    rig = await createRig({ config: { enableGpuProbe: false } });
    rig.host.onRun("nvidia-smi", NVIDIA);
    const pending = rig.adapter.getSystemMetrics({}, call());
    rig.host.tick(1, 1);
    expect((await pending).data.gpu).toBeNull();
    expect(rig.host.calls.filter((c) => c.file === "nvidia-smi")).toHaveLength(0);
  });

  it("network rate from /proc/net/dev counters on Linux", async () => {
    rig = await createRig();
    let rx = 1_000;
    let tx = 4_000;
    rig.host.setFile("/proc/net/dev", "");
    const original = rig.host.readTextFile.bind(rig.host);
    rig.host.readTextFile = async (path) =>
      path === "/proc/net/dev"
        ? `Inter-|\n face |\n  eth0: ${rx} 1 0 0 0 0 0 0 ${tx} 1 0 0 0 0 0 0\n`
        : original(path);
    const first = rig.adapter.getSystemMetrics({}, call());
    rig.host.tick(1, 1);
    expect((await first).data.network).toMatchObject({ rxBytesPerSec: 0, txBytesPerSec: 0 }); // no baseline yet
    rx += 10_000;
    tx += 50_000;
    await new Promise((resolve) => setTimeout(resolve, 200));
    const second = rig.adapter.getSystemMetrics({}, call());
    rig.host.tick(1, 1);
    const network = (await second).data.network;
    expect(network.rxBytesPerSec).toBeGreaterThan(0);
    expect(network.txBytesPerSec).toBeGreaterThan(network.rxBytesPerSec);
    expect(network.latencyMs).toBeNull();
  });

  it("network on Windows from netstat -e", async () => {
    rig = await createRig({ platform: "win32", config: { storagePaths: ["C:\\"] } });
    rig.host.onRun("netstat", "Interface Statistics\r\n\r\nBytes   1000   2000\r\n");
    const pending = rig.adapter.getSystemMetrics({}, call());
    rig.host.tick(1, 1);
    await pending;
    expect(rig.host.calls.some((c) => c.file === "netstat" && c.args.join(" ") === "-e")).toBe(true);
  });
});

describe("system.read: storage", () => {
  it("lists the platform default (/ on Linux) with df-style numbers", async () => {
    rig = await createRig();
    const page = await rig.adapter.listStorageVolumes({}, call());
    expect(page.items).toHaveLength(1);
    const [volume] = page.items;
    const gib = 1024 ** 3;
    expect(volume).toMatchObject({
      mount: "/",
      label: "/",
      totalBytes: 100 * gib,
      usedBytes: 40 * gib,
      freeBytes: 55 * gib,
    });
    expect(volume?.usagePercent).toBeCloseTo(42.1, 1);
    expect(volume?.id).toMatch(/^vol_[0-9A-Za-z]{26}$/);
    assertValidResult("system", "listStorageVolumes", page);
  });

  it("defaults to C:\\ on Windows", async () => {
    rig = await createRig({ platform: "win32" });
    expect((await rig.adapter.listStorageVolumes({}, call())).items.map((v) => v.mount)).toEqual(["C:\\"]);
  });

  it("uses the configured paths; an unreadable one is skipped and logged, the others stay", async () => {
    rig = await createRig({ config: { storagePaths: ["/", "/nicht/vorhanden"] } });
    const page = await rig.adapter.listStorageVolumes({}, call());
    expect(page.items.map((v) => v.mount)).toEqual(["/"]);
    expect(rig.session.logs.some((r) => r.level === "warn" && r.message.includes("Speicherpfad"))).toBe(true);
  });

  it("metrics embed the same volumes", async () => {
    rig = await createRig();
    const pending = rig.adapter.getSystemMetrics({}, call());
    rig.host.tick(1, 1);
    expect((await pending).data.storage.map((v) => v.mount)).toEqual(["/"]);
  });
});

describe("system.read: services", () => {
  it("omits Qwen services and model providers in cloud mode", async () => {
    rig = await createRig({ config: { cloudMode: true } });
    const services = await rig.adapter.listServices({}, call());
    const providers = await rig.adapter.listModelProviders({}, call());
    expect(services.items.map((s) => s.name)).not.toContain("Qwen lokal (llama-server)");
    expect(providers.items.map((p) => p.name)).not.toContain("Qwen (lokal, llama.cpp)");
    expect(rig.qwen.requests).toHaveLength(0);
    await expectCode(rig.adapter.runServiceHealthcheck({ id: "svc_qwen" as never }, mutation()), "NOT_FOUND", false);
    assertValidResult("system", "listServices", services);
    assertValidResult("system", "listModelProviders", providers);
  });

  it("lists Qwen, Hermes API, Hermes dashboard, voice and the Control API - no WSL on Linux", async () => {
    rig = await createRig();
    const page = await rig.adapter.listServices({}, call());
    expect(page.items.map((s) => [s.name, s.kind, s.status])).toEqual([
      ["Qwen lokal (llama-server)", "llm", "online"],
      ["Hermes API", "hermes", "online"],
      ["Hermes Dashboard", "hermes", "online"],
      ["Voice-Dienst", "voice", "online"],
      ["Control API", "api", "online"],
    ]);
    for (const service of page.items) {
      expect(service.id).toMatch(/^svc_[0-9A-Za-z]{26}$/);
      expect(service.lastCheckAt).not.toBeNull();
    }
    expect(page.items[0]?.latencyMs).toBeGreaterThanOrEqual(0);
    expect(page.items.at(-1)?.detail).toBe("Prozess läuft seit 3 h 25 min");
    assertValidResult("system", "listServices", page);
  });

  it("probes exactly the documented endpoints without credentials", async () => {
    rig = await createRig();
    await rig.adapter.listServices({}, call());
    expect(rig.qwen.requests.map((r) => `${r.method} ${r.path}`)).toEqual(["GET /v1/models"]);
    expect(rig.hermes.requests.map((r) => `${r.method} ${r.path}`)).toEqual(["GET /health"]);
    expect(rig.dashboard.requests.map((r) => `${r.method} ${r.path}`)).toEqual(["GET /api/health"]);
    expect(rig.voice.requestLines).toEqual(["GET / HTTP/1.1"]);
    for (const request of [...rig.qwen.requests, ...rig.hermes.requests, ...rig.dashboard.requests])
      expect(request.headers.authorization).toBeUndefined();
  });

  it("each stopped service is offline with a reason, the others are unaffected", async () => {
    rig = await createRig();
    await Promise.all([rig.qwen.setOffline(true), rig.voice.setOffline(true)]);
    const items = (await rig.adapter.listServices({}, call())).items;
    const byName = Object.fromEntries(items.map((s) => [s.name, s]));
    expect(byName["Qwen lokal (llama-server)"]).toMatchObject({
      status: "offline",
      latencyMs: null,
      lastSuccessAt: null,
    });
    expect(byName["Qwen lokal (llama-server)"]?.detail).toContain("43692");
    expect(byName["Voice-Dienst"]).toMatchObject({ status: "offline" });
    expect(byName["Voice-Dienst"]?.detail).toContain("lädt noch Modelle");
    expect(byName["Hermes API"]?.status).toBe("online");
  });

  it("lastSuccessAt survives an outage", async () => {
    rig = await createRig();
    const online = (await rig.adapter.listServices({}, call())).items[0];
    await rig.qwen.setOffline(true);
    const offline = (await rig.adapter.listServices({}, call())).items[0];
    expect(offline?.status).toBe("offline");
    expect(offline?.lastSuccessAt).toBe(online?.lastSuccessAt);
    expect(offline?.lastCheckAt).not.toBeNull();
  });

  it("slow service is degraded, probes take one attempt only", async () => {
    rig = await createRig();
    rig.hermes.fault("GET", "/health", { latencyMs: 2_000 });
    const started = Date.now();
    const hermes = (await rig.adapter.listServices({}, call())).items.find((s) => s.name === "Hermes API");
    expect(hermes?.status).toBe("degraded");
    expect(hermes?.detail).toContain("Zeitüberschreitung");
    expect(Date.now() - started).toBeLessThan(1_900);
    expect(rig.hermes.requestsFor("GET", "/health")).toHaveLength(1);
  });

  it("invalid answers degrade the service instead of failing the list", async () => {
    rig = await createRig();
    rig.hermes.route("GET", "/health", { raw: "<html>proxy error</html>" });
    rig.voice.setFault("invalid-json");
    const items = (await rig.adapter.listServices({}, call())).items;
    expect(items.find((s) => s.name === "Hermes API")?.status).toBe("degraded");
    expect(items.find((s) => s.name === "Voice-Dienst")?.status).toBe("degraded");
    rig.hermes.route("GET", "/health", { body: { status: "starting" } });
    expect(
      (await rig.adapter.listServices({}, call())).items.find((s) => s.name === "Hermes API")?.status,
    ).toBe("degraded");
  });

  describe("Qwen: GET /v1/models, /health only as refinement (Annahme (unbelegt))", () => {
    const qwen = async (r: Rig) => (await r.adapter.listServices({}, call())).items[0]!;

    it("503 while loading: degraded, /health asked once", async () => {
      rig = await createRig();
      rig.qwen.fault("GET", "/v1/models", { status: 503 });
      rig.qwen.route("GET", "/health", { status: 503, body: { error: { message: "Loading model" } } });
      const service = await qwen(rig);
      expect(service.status).toBe("degraded");
      expect(service.detail).toContain("Modell wird geladen");
      expect(rig.qwen.requestsFor("GET", "/health")).toHaveLength(1);
    });

    it("a missing /health endpoint does not matter", async () => {
      rig = await createRig();
      rig.qwen.fault("GET", "/v1/models", { status: 500 });
      const service = await qwen(rig);
      expect(service.status).toBe("degraded");
      expect(service.detail).toContain("HTTP 500");
    });

    it("an answer without a model list is still online", async () => {
      rig = await createRig();
      rig.qwen.route("GET", "/v1/models", { body: { something: "else" } });
      expect(await qwen(rig)).toMatchObject({
        status: "online",
        detail: "Bereit (Antwort ohne Modellliste)",
      });
    });
  });

  describe("Hermes dashboard: path and authentication are unverified", () => {
    const dashboard = async (r: Rig) =>
      (await r.adapter.listServices({}, call())).items.find((s) => s.name === "Hermes Dashboard")!;

    it("401 proves a listening process", async () => {
      rig = await createRig();
      rig.dashboard.fault("GET", "/api/health", { status: 401 });
      const service = await dashboard(rig);
      expect(service.status).toBe("online");
      expect(service.detail).toContain("Annahme (unbelegt)");
    });

    it("404 means the path is wrong: unknown, not online", async () => {
      rig = await createRig();
      rig.dashboard.fault("GET", "/api/health", { status: 404 });
      expect((await dashboard(rig)).status).toBe("unknown");
    });

    it("closed port is offline", async () => {
      rig = await createRig();
      await rig.dashboard.setOffline(true);
      expect((await dashboard(rig)).status).toBe("offline");
    });
  });

  describe("voice service (exact friday_voice.py wire format)", () => {
    const voice = async (r: Rig) =>
      (await r.adapter.listServices({}, call())).items.find((s) => s.name === "Voice-Dienst")!;

    it.each([
      ["listening", "online", "Wartet auf das Wake Word"],
      ["command", "online", "Verarbeitet einen Befehl"],
      ["speaking", "online", "Spricht"],
      ["followup", "online", "Folgefrage-Fenster offen"],
      ["starting", "degraded", "Startet (Mikrofon noch nicht geöffnet)"],
    ] as const)("state %s -> %s", async (state, status, detail) => {
      rig = await createRig();
      rig.voice.setStatus(makeVoiceStatus({ state }));
      expect(await voice(rig)).toMatchObject({ status, detail });
    });

    it("unknown state values are degraded", async () => {
      rig = await createRig();
      rig.voice.setFault("invalid-shape");
      expect((await voice(rig)).status).toBe("degraded");
    });
  });

  describe("WSL (Windows only, best effort)", () => {
    const wsl = async (r: Rig) =>
      (await r.adapter.listServices({}, call())).items.find((s) => s.kind === "wsl");

    it("is not listed on Linux or when disabled", async () => {
      rig = await createRig();
      expect(await wsl(rig)).toBeUndefined();
      await rig.close();
      rig = await createRig({ platform: "win32", config: { enableWsl: false } });
      expect(await wsl(rig)).toBeUndefined();
    });

    it("running distribution is online and marked best effort", async () => {
      rig = await createRig({ platform: "win32" });
      rig.host.onRun("wsl.exe", wslOutput([{ name: "Ubuntu", state: "Running", isDefault: true }]));
      const service = await wsl(rig);
      expect(service).toMatchObject({ name: "WSL", kind: "wsl", status: "online" });
      expect(service?.detail).toContain("Best Effort");
      expect(rig.host.calls.find((c) => c.file === "wsl.exe")?.args).toEqual(["-l", "-v"]);
    });

    it("stopped, missing and unknown states", async () => {
      rig = await createRig({ platform: "win32" });
      rig.host.onRun("wsl.exe", wslOutput([{ name: "Ubuntu", state: "Stopped" }]));
      expect((await wsl(rig))?.status).toBe("offline");
      rig.host.onRun("wsl.exe", wslOutput([{ name: "Debian", state: "Running" }]));
      expect(await wsl(rig)).toMatchObject({ status: "offline" });
      rig.host.onRun("wsl.exe", wslOutput([{ name: "Ubuntu", state: "Installing" }]));
      expect((await wsl(rig))?.status).toBe("unknown");
    });

    it("wsl.exe missing or failing", async () => {
      rig = await createRig({ platform: "win32" });
      expect(await wsl(rig)).toMatchObject({
        status: "offline",
        detail: expect.stringContaining("nicht installiert"),
      });
      rig.host.onRun("wsl.exe", Object.assign(new Error("timeout"), { killed: true }));
      expect(await wsl(rig)).toMatchObject({
        status: "unknown",
        detail: expect.stringContaining("nicht rechtzeitig"),
      });
      rig.host.onRun("wsl.exe", Object.assign(new Error("exit 1"), { code: 1 }));
      expect((await wsl(rig))?.status).toBe("unknown");
    });

    it("honours a configured distribution", async () => {
      rig = await createRig({ platform: "win32", config: { wslDistro: "Debian" } });
      rig.host.onRun(
        "wsl.exe",
        wslOutput([
          { name: "Ubuntu", state: "Stopped" },
          { name: "Debian", state: "Running" },
        ]),
      );
      expect((await wsl(rig))?.status).toBe("online");
    });
  });

  it("paginates with an opaque cursor", async () => {
    rig = await createRig();
    const first = await rig.adapter.listServices({ limit: 2 }, call());
    expect(first.items).toHaveLength(2);
    expect(first.pageInfo.hasNextPage).toBe(true);
    const ids = [...first.items.map((s) => s.id)];
    let cursor = first.pageInfo.nextCursor;
    while (cursor) {
      const page = await rig.adapter.listServices({ limit: 2, cursor }, call());
      ids.push(...page.items.map((s) => s.id));
      expect(page.pageInfo.hasNextPage).toBe(page.pageInfo.nextCursor !== null);
      cursor = page.pageInfo.nextCursor;
    }
    expect(new Set(ids).size).toBe(5);
    await expectCode(rig.adapter.listServices({ cursor: "kaputt" }, call()), "VALIDATION_FAILED", false);
  });
});

describe("system.healthcheck", () => {
  it("re-probes exactly one service", async () => {
    rig = await createRig();
    const services = (await rig.adapter.listServices({}, call())).items;
    const hermes = services.find((s) => s.name === "Hermes API")!;
    rig.qwen.requests.length = 0;
    rig.hermes.requests.length = 0;
    const context = mutation();
    const result = await rig.adapter.runServiceHealthcheck({ id: hermes.id }, context);
    expect(result.data).toMatchObject({
      serviceId: hermes.id,
      status: "online",
      correlationId: context.correlationId,
    });
    expect(result.data.latencyMs).toBeGreaterThanOrEqual(0);
    expect(rig.hermes.requests).toHaveLength(1);
    expect(rig.qwen.requests).toHaveLength(0);
    assertValidResult("system", "runServiceHealthcheck", result);
  });

  it("reports the current state after a service went away and came back", async () => {
    rig = await createRig();
    const qwen = (await rig.adapter.listServices({}, call())).items[0]!;
    await rig.qwen.setOffline(true);
    expect((await rig.adapter.runServiceHealthcheck({ id: qwen.id }, mutation())).data.status).toBe(
      "offline",
    );
    await rig.qwen.setOffline(false);
    expect((await rig.adapter.runServiceHealthcheck({ id: qwen.id }, mutation())).data.status).toBe("online");
  });

  it("unknown ids (also WSL on Linux) are NOT_FOUND", async () => {
    rig = await createRig();
    await expectCode(
      rig.adapter.runServiceHealthcheck({ id: "svc_00000000000000000000000000" }, mutation()),
      "NOT_FOUND",
      false,
    );
  });
});

describe("system.read: model providers", () => {
  it("Qwen from /v1/models (alias qwen3-router), Hermes from /v1/models with the Bearer key", async () => {
    rig = await createRig();
    const page = await rig.adapter.listModelProviders({}, call());
    expect(page.items.map((p) => [p.name, p.providerKind, p.status, p.models])).toEqual([
      ["Qwen (lokal, llama.cpp)", "local", "online", ["qwen3-router"]],
      ["Hermes (API-Server)", "local", "online", ["friday"]],
    ]);
    expect(rig.hermesState.acceptedKeys).toEqual([rig.hermesKey]);
    for (const provider of page.items) {
      expect(provider.id).toMatch(/^mdl_[0-9A-Za-z]{26}$/);
      expect(provider.activeRequests).toBe(0);
    }
    assertValidResult("system", "listModelProviders", page);
  });

  it("no Kimi entry: that Hermes routes to Kimi is not provable from /v1/models", async () => {
    rig = await createRig();
    const names = (await rig.adapter.listModelProviders({}, call())).items.map((p) => p.name.toLowerCase());
    expect(names.some((n) => n.includes("kimi"))).toBe(false);
  });

  it("wrong key: Hermes degraded with no models, nothing about the key in the output", async () => {
    rig = await createRig({ withKey: false });
    const page = await rig.adapter.listModelProviders({}, call());
    const hermes = page.items[1]!;
    expect(hermes.status).toBe("degraded");
    expect(hermes.models).toEqual([]);
    expect(JSON.stringify(page)).not.toContain(rig.hermesKey);
  });

  it("without a key the status comes from /health and the model list stays empty", async () => {
    rig = await createRig();
    const { adapter } = await startWithoutSecrets(rig, {});
    const hermes = (await adapter.listModelProviders({}, call())).items[1]!;
    expect(hermes).toMatchObject({ status: "online", models: [] });
    expect(rig.hermes.requestsFor("GET", "/v1/models")).toHaveLength(0);
    await adapter.shutdown();
  });

  it("reads the installer's key file when no secret is set; the content never leaves the adapter", async () => {
    const fileKey = "file-key-0123456789abcdef";
    rig = await createRig({ withKey: false });
    const fileState = installHermesApi(rig.hermes, { apiKey: fileKey });
    rig.host.setFile("/srv/hermes_api.key", `\uFEFF${fileKey}\r\n`);
    const { adapter, logger } = await startWithoutSecrets(rig, { hermesApiKeyFile: "/srv/hermes_api.key" });

    const page = await adapter.listModelProviders({}, call());
    expect(page.items[1]?.models).toEqual(["friday"]);
    expect(fileState.acceptedKeys).toEqual([fileKey]);
    expect(JSON.stringify([page, logger.records])).not.toContain(fileKey);

    rig.host.setFile("/srv/hermes_api.key", new Error("EACCES"));
    expect((await adapter.listModelProviders({}, call())).items[1]?.models).toEqual([]);
    expect(logger.records.some((r) => r.level === "warn" && r.message.includes("Key-Datei"))).toBe(true);
    await adapter.shutdown();
  });
});

describe("manifest and defaults", () => {
  it("declares system.read and system.healthcheck only, one secret field", () => {
    expect(manifest.capabilities).toEqual(["system.read", "system.healthcheck"]);
    expect(manifest.secretFields).toEqual(["hermesApiKey"]);
    expect((configSchema.properties.hermesApiKey as { writeOnly: boolean }).writeOnly).toBe(true);
  });

  it("config schema defaults equal the installer ports", () => {
    expect(configSchema.properties.qwenUrl.default).toBe("http://127.0.0.1:43692");
    expect(configSchema.properties.hermesApiUrl.default).toBe("http://127.0.0.1:43693");
    expect(configSchema.properties.hermesDashboardUrl.default).toBe("http://127.0.0.1:43691");
    expect(configSchema.properties.voiceUrl.default).toBe("http://127.0.0.1:43694");
  });
});

describe("on the real machine (node:os, statfs)", () => {
  it("delivers contract-valid metrics with real values", async () => {
    const adapter = new LocalSystemAdapter();
    const session = await openSession(adapter, { enableGpuProbe: false, enableWsl: false });
    try {
      const { data } = await adapter.getSystemMetrics({}, call());
      expect(data.cpu.cores).toBeGreaterThanOrEqual(1);
      expect(data.ram.totalBytes).toBeGreaterThan(0);
      expect(data.ram.usedBytes).toBeLessThanOrEqual(data.ram.totalBytes);
      expect(data.storage.length).toBe(1);
      expect(data.storage[0]?.totalBytes).toBeGreaterThan(0);
      expect(data.gpu).toBeNull();
      assertValidResult("system", "getSystemMetrics", {
        data,
        freshness: { state: "fresh", asOf: data.sampledAt },
      });
    } finally {
      await adapter.shutdown();
      void session;
    }
  });
});
