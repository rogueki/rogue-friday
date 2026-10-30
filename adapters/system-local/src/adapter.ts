import type { HealthcheckResult, ModelProvider, Service, StorageVolume, SystemMetrics } from "@friday/sdk";
import {
  AdapterError,
  createHttpClient,
  createMapContext,
  createRedactor,
  normalizeError,
  sleep,
  toIso,
  type AdapterContext,
  type AdapterHealthReport,
  type CallContext,
  type CapabilitySet,
  type HttpClient,
  type IdParam,
  type FridayAdapter,
  type MapContext,
  type MutationContext,
  type Page,
  type PageParams,
  type Single,
  type SystemPort,
} from "@friday/adapter-core";
import { nodeHost, type HostApi } from "./host";
import { DEFAULT_URLS, PROVIDER_SYSTEM, manifest } from "./manifest";
import {
  healthcheckMapper,
  modelProviderMapper,
  serviceIdFor,
  serviceMapper,
  storageVolumeMapper,
  systemMetricsMapper,
  type ProviderKey,
  type ServiceKey,
} from "./mapping";
import {
  NVIDIA_SMI_ARGS,
  cpuUsagePercent,
  decodeCommandOutput,
  parseNetstatEthernet,
  parseNvidiaSmi,
  parseProcNetDev,
  sampleCpu,
  type CpuSample,
  type GpuReading,
  type NetCounters,
} from "./parsers";
import {
  describeUptime,
  probeHermesApi,
  probeHermesDashboard,
  probeHermesModels,
  probeQwen,
  probeVoice,
  probeWsl,
  type ProbeEnv,
  type ProbeResult,
} from "./probes";

interface AdapterSettings {
  cloudMode: boolean;
  qwenUrl: string;
  hermesApiUrl: string;
  hermesDashboardUrl: string;
  voiceUrl: string;
  hermesApiKeyFile: string | undefined;
  storagePaths: string[];
  enableGpuProbe: boolean;
  nvidiaSmiPath: string;
  enableWsl: boolean;
  wslDistro: string;
  timeoutMs: number;
}

const stringOr = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.length > 0 ? value : fallback;
const boolOr = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

function readSettings(config: Readonly<Record<string, unknown>>, host: HostApi): AdapterSettings {
  const paths = Array.isArray(config.storagePaths)
    ? config.storagePaths.filter((p): p is string => typeof p === "string" && p.length > 0)
    : [];
  return {
    cloudMode: boolOr(config.cloudMode, false),
    qwenUrl: stringOr(config.qwenUrl, DEFAULT_URLS.qwenUrl),
    hermesApiUrl: stringOr(config.hermesApiUrl, DEFAULT_URLS.hermesApiUrl),
    hermesDashboardUrl: stringOr(config.hermesDashboardUrl, DEFAULT_URLS.hermesDashboardUrl),
    voiceUrl: stringOr(config.voiceUrl, DEFAULT_URLS.voiceUrl),
    hermesApiKeyFile:
      typeof config.hermesApiKeyFile === "string" && config.hermesApiKeyFile
        ? config.hermesApiKeyFile
        : undefined,
    // Windows installs live on C:\ (C:\Friday); everything else has one root.
    storagePaths: paths.length > 0 ? paths : [host.platform === "win32" ? "C:\\" : "/"],
    enableGpuProbe: boolOr(config.enableGpuProbe, true),
    nvidiaSmiPath: stringOr(config.nvidiaSmiPath, "nvidia-smi"),
    enableWsl: boolOr(config.enableWsl, true),
    wslDistro: stringOr(config.wslDistro, "Ubuntu"),
    timeoutMs:
      typeof config.timeoutMs === "number" && Number.isFinite(config.timeoutMs) ? config.timeoutMs : 2_000,
  };
}

interface ServiceDef {
  key: ServiceKey;
  name: string;
  kind: Service["kind"];
  /** host:port of the probed listener; absent for checks without a network endpoint. */
  endpoint?: string;
  probe(env: ProbeEnv): Promise<ProbeResult>;
}

interface ProviderDef {
  key: ProviderKey;
  name: string;
  providerKind: ModelProvider["providerKind"];
  probe(env: ProbeEnv): Promise<ProbeResult>;
}

const PROVIDERS: readonly ProviderDef[] = [
  { key: "qwen", name: "Qwen (lokal, llama.cpp)", providerKind: "local", probe: probeQwen },
  // Hermes is the local gateway; which cloud model (e.g. Kimi) it routes to is not exposed by /v1/models, so none is claimed.
  { key: "hermes", name: "Hermes (API-Server)", providerKind: "local", probe: probeHermesModels },
];

const CPU_BASELINE_MAX_AGE_MS = 30_000;
const CPU_SETTLE_MS = 150;
const GPU_CACHE_MS = 2_000;
const GPU_RETRY_AFTER_FAILURE_MS = 30_000;
const GPU_MIN_TIMEOUT_MS = 5_000;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

const unavailable = (): AdapterError =>
  new AdapterError({
    code: "ADAPTER_UNAVAILABLE",
    message: "Der Adapter ist nicht aktiv.",
    retryable: false,
  });

/**
 * System adapter for the machine the Control API runs on: hardware from `node:os` / `statfs` / `nvidia-smi`, service
 * health by probing the installer's loopback ports, model lists from llama-server and Hermes. Read-only; the only
 * action is `system.healthcheck` (re-probe of one service).
 */
export class LocalSystemAdapter implements SystemPort, FridayAdapter {
  readonly manifest = manifest;

  private context: AdapterContext | undefined;
  private settings: AdapterSettings | undefined;
  private env: ProbeEnv | undefined;
  private services: ServiceDef[] = [];
  private abort = new AbortController();
  private stopped = true;
  private startedAt = "";
  private lastSuccess = new Map<string, string>();
  private cpuBaseline: { sample: CpuSample; at: number } | undefined;
  private netBaseline: { counters: NetCounters; at: number } | undefined;
  private gpuCache: { at: number; value: GpuReading | null } | undefined;
  private lastFileKey: string | undefined;

  constructor(private readonly host: HostApi = nodeHost) {}

  async initialize(context: AdapterContext): Promise<void> {
    const settings = readSettings(context.config, this.host);
    this.context = context;
    this.settings = settings;
    this.abort = new AbortController();
    this.stopped = false;
    this.startedAt = toIso(context.clock);
    this.lastSuccess = new Map();
    this.cpuBaseline = undefined;
    this.netBaseline = undefined;
    this.gpuCache = undefined;
    this.lastFileKey = undefined;

    const redact = createRedactor(() => [context.getSecret("hermesApiKey"), this.lastFileKey]);
    const client = (baseUrl: string): HttpClient =>
      createHttpClient({
        baseUrl,
        timeoutMs: settings.timeoutMs,
        retry: false,
        // A probe must show the real, current state; a breaker would report old failures.
        circuitBreaker: false,
        clock: context.clock,
        logger: context.logger,
        redact,
        signal: this.abort.signal,
      });
    this.env = {
      clock: context.clock,
      host: this.host,
      signal: this.abort.signal,
      timeoutMs: settings.timeoutMs,
      qwen: client(settings.qwenUrl),
      hermesApi: client(settings.hermesApiUrl),
      hermesDashboard: client(settings.hermesDashboardUrl),
      voice: client(settings.voiceUrl),
      wslDistro: settings.wslDistro,
      hermesKey: () => this.resolveHermesKey(),
    };
    this.services = this.buildServices(settings);
    context.signal.addEventListener("abort", () => this.abort.abort(context.signal.reason), { once: true });
  }

  async getCapabilities(): Promise<CapabilitySet> {
    return { capabilities: [...manifest.capabilities] };
  }

  /**
   * The adapter reads the local machine; it is healthy whenever it is active. An unreachable *service* is data
   * (Service.status = offline), not an adapter failure (docs/MAPPING/system.md, "Fehler").
   */
  async healthCheck(): Promise<AdapterHealthReport> {
    if (this.stopped || !this.context) {
      return {
        status: "offline",
        latencyMs: null,
        message: "Adapter ist nicht aktiv",
        errorCode: "ADAPTER_UNAVAILABLE",
      };
    }
    const started = this.context.clock.now();
    try {
      this.host.cpuTimes();
      return { status: "online", latencyMs: Math.max(0, Math.round(this.context.clock.now() - started)) };
    } catch (raw) {
      const error = normalizeError(raw, { operation: "healthCheck" });
      return {
        status: "offline",
        latencyMs: null,
        message: "Systemdaten sind nicht lesbar",
        errorCode: error.code,
      };
    }
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    this.abort.abort(new DOMException("Adapter shutdown", "AbortError"));
    this.context = undefined;
    this.env = undefined;
    this.settings = undefined;
    this.services = [];
  }

  // ---- SystemPort ---------------------------------------------------------------------------------------------------

  async getSystemMetrics(_params: Record<string, never>, _call: CallContext): Promise<Single<SystemMetrics>> {
    const { context, settings } = this.ready();
    const [cpu, network, gpu, storage] = await Promise.all([
      this.measureCpu(),
      this.measureNetwork(),
      this.readGpu(),
      this.readVolumes(),
    ]);
    const total = this.host.totalMemoryBytes();
    const mapContext = this.mapContext(context);
    const data = systemMetricsMapper.map(
      {
        sampledAt: mapContext.syncedAt,
        cpu,
        ram: { totalBytes: total, usedBytes: Math.max(0, total - this.host.freeMemoryBytes()) },
        gpu: settings.enableGpuProbe ? gpu : null,
        storage,
        network,
      },
      mapContext,
    );
    return { data, freshness: { state: "fresh", asOf: mapContext.syncedAt } };
  }

  async listServices(params: PageParams, _call: CallContext): Promise<Page<Service>> {
    const { context, env } = this.ready();
    const results = await Promise.all(this.services.map((def) => this.probeService(def, env, context)));
    const mapContext = this.mapContext(context);
    return paginate(
      results.map((result) => serviceMapper.map(result, mapContext)),
      params,
      mapContext,
    );
  }

  async listStorageVolumes(params: PageParams, _call: CallContext): Promise<Page<StorageVolume>> {
    const { context } = this.ready();
    const volumes = await this.readVolumes();
    return paginate(volumes, params, this.mapContext(context));
  }

  async listModelProviders(params: PageParams, _call: CallContext): Promise<Page<ModelProvider>> {
    const { context, env, settings } = this.ready();
    const providers = settings.cloudMode ? PROVIDERS.filter((def) => def.key !== "qwen") : PROVIDERS;
    const results = await Promise.all(providers.map(async (def) => ({ def, probe: await def.probe(env) })));
    const mapContext = this.mapContext(context);
    return paginate(
      results.map(({ def, probe }) =>
        modelProviderMapper.map(
          {
            key: def.key,
            name: def.name,
            providerKind: def.providerKind,
            probe,
            createdAt: this.startedAt,
            checkedAt: mapContext.syncedAt,
          },
          mapContext,
        ),
      ),
      params,
      mapContext,
    );
  }

  /** Re-probes exactly one configured service. Unknown ids (also WSL on non-Windows hosts) are NOT_FOUND. */
  async runServiceHealthcheck(params: IdParam, call: MutationContext): Promise<Single<HealthcheckResult>> {
    const { context, env } = this.ready();
    const def = this.services.find((entry) => serviceIdFor(entry.key) === params.id);
    if (!def) {
      throw new AdapterError({
        code: "NOT_FOUND",
        message: "Unbekannter Dienst.",
        retryable: false,
        details: { id: params.id },
      });
    }
    const probe = await this.runProbe(def, env, context);
    const mapContext = this.mapContext(context);
    return {
      data: healthcheckMapper.map(
        { key: def.key, probe, checkedAt: mapContext.syncedAt, correlationId: call.correlationId },
        mapContext,
      ),
      freshness: { state: "fresh", asOf: mapContext.syncedAt },
    };
  }

  // ---- services -----------------------------------------------------------------------------------------------------

  private buildServices(settings: AdapterSettings): ServiceDef[] {
    const defs: ServiceDef[] = [
      { key: "hermes-api", name: "Hermes API", kind: "hermes", endpoint: endpointOf(settings.hermesApiUrl), probe: probeHermesApi },
      { key: "hermes-dashboard", name: "Hermes Dashboard", kind: "hermes", endpoint: endpointOf(settings.hermesDashboardUrl), probe: probeHermesDashboard },
      { key: "voice", name: "Voice-Dienst", kind: "voice", endpoint: endpointOf(settings.voiceUrl), probe: probeVoice },
    ];
    if (!settings.cloudMode)
      defs.unshift({ key: "qwen", name: "Qwen lokal (llama-server)", kind: "llm", endpoint: endpointOf(settings.qwenUrl), probe: probeQwen });
    if (this.host.platform === "win32" && settings.enableWsl)
      defs.push({ key: "wsl", name: "WSL", kind: "wsl", probe: probeWsl });
    defs.push({
      key: "control-api",
      name: "Control API",
      kind: "api",
      // This code runs inside the Control API process, so the answer needs no network probe.
      probe: async () => ({
        status: "online",
        latencyMs: null,
        detail: `Prozess läuft seit ${describeUptime(this.host.processUptimeSeconds())}`,
      }),
    });
    return defs;
  }

  private async runProbe(def: ServiceDef, env: ProbeEnv, context: AdapterContext): Promise<ProbeResult> {
    let result: ProbeResult;
    try {
      result = await def.probe(env);
    } catch (raw) {
      // Probes are written not to throw; a defect must not take the whole list down and must stay visible.
      const error = normalizeError(raw, { operation: `probe ${def.key}` });
      if (this.stopped) throw error;
      context.logger.error("Probe fehlgeschlagen", { service: def.key, code: error.code });
      result = { status: "unknown", latencyMs: null, detail: "Prüfung fehlgeschlagen" };
    }
    if (this.stopped) throw unavailable();
    if (result.status === "online") this.lastSuccess.set(def.key, toIso(context.clock));
    return result;
  }

  private async probeService(def: ServiceDef, env: ProbeEnv, context: AdapterContext) {
    const probe = await this.runProbe(def, env, context);
    return {
      key: def.key,
      name: def.name,
      kind: def.kind,
      probe,
      checkedAt: toIso(context.clock),
      createdAt: this.startedAt,
      lastSuccessAt: this.lastSuccess.get(def.key) ?? null,
      ...(def.endpoint ? { endpoint: def.endpoint } : {}),
    };
  }

  private async resolveHermesKey(): Promise<string | undefined> {
    const { context, settings } = this.ready();
    const secret = context.getSecret("hermesApiKey");
    if (secret) return secret;
    if (!settings.hermesApiKeyFile) return undefined;
    try {
      const key = (await this.host.readTextFile(settings.hermesApiKeyFile)).trim();
      this.lastFileKey = key.length > 0 ? key : undefined;
      return this.lastFileKey;
    } catch (raw) {
      // Never log the path content or the error text of the OS; the code is enough to diagnose.
      context.logger.warn("Hermes-Key-Datei nicht lesbar", {
        code: (raw as { code?: unknown } | null)?.code,
      });
      return undefined;
    }
  }

  // ---- hardware -----------------------------------------------------------------------------------------------------

  /** Average CPU load since the previous call; the first call (or a stale baseline) measures over a short window. */
  private async measureCpu(): Promise<{ usagePercent: number; cores: number }> {
    const { context } = this.ready();
    const now = context.clock.now();
    const times = this.host.cpuTimes();
    const current = sampleCpu(times);
    const baseline = this.cpuBaseline;
    if (baseline && now - baseline.at <= CPU_BASELINE_MAX_AGE_MS) {
      const usage = cpuUsagePercent(baseline.sample, current);
      if (usage !== null) {
        this.cpuBaseline = { sample: current, at: now };
        return { usagePercent: usage, cores: times.length };
      }
    }
    await sleep(context.clock, CPU_SETTLE_MS, this.abort.signal).catch(() => {
      throw unavailable();
    });
    const later = sampleCpu(this.host.cpuTimes());
    this.cpuBaseline = { sample: later, at: context.clock.now() };
    // Counters that did not move in 150 ms are a frozen virtual host; 0 is the neutral reading.
    return { usagePercent: cpuUsagePercent(current, later) ?? 0, cores: times.length };
  }

  private async readNetCounters(): Promise<NetCounters | null> {
    try {
      if (this.host.platform === "linux")
        return parseProcNetDev(await this.host.readTextFile("/proc/net/dev"));
      if (this.host.platform === "win32") {
        const output = await this.host.run("netstat", ["-e"], {
          timeoutMs: this.ready().settings.timeoutMs,
          signal: this.abort.signal,
        });
        return parseNetstatEthernet(decodeCommandOutput(output));
      }
    } catch (raw) {
      this.context?.logger.debug("Netzwerkzähler nicht lesbar", {
        code: (raw as { code?: unknown } | null)?.code,
      });
    }
    return null;
  }

  /**
   * Throughput from cumulative byte counters. Without a readable counter the rates are 0 and the log says why:
   * SystemMetrics.network has no "unknown" (contract gap, see README).
   */
  private async measureNetwork(): Promise<{ rxBytesPerSec: number; txBytesPerSec: number }> {
    const { context } = this.ready();
    const none = { rxBytesPerSec: 0, txBytesPerSec: 0 };
    const current = await this.readNetCounters();
    const at = context.clock.now();
    if (!current) {
      this.netBaseline = undefined;
      return none;
    }
    const baseline = this.netBaseline;
    this.netBaseline = { counters: current, at };
    if (!baseline || at <= baseline.at) return none;
    const seconds = (at - baseline.at) / 1000;
    const rate = (now: number, before: number): number => Math.max(0, Math.floor((now - before) / seconds));
    return {
      rxBytesPerSec: rate(current.rxBytes, baseline.counters.rxBytes),
      txBytesPerSec: rate(current.txBytes, baseline.counters.txBytes),
    };
  }

  /** `nvidia-smi` when present; absent or failing means `null` (the reason is logged, cached and retried later). */
  private async readGpu(): Promise<GpuReading | null> {
    const { context, settings } = this.ready();
    if (!settings.enableGpuProbe) return null;
    const now = context.clock.now();
    const cached = this.gpuCache;
    if (cached && now - cached.at < (cached.value ? GPU_CACHE_MS : GPU_RETRY_AFTER_FAILURE_MS))
      return cached.value;
    let value: GpuReading | null = null;
    try {
      const output = await this.host.run(settings.nvidiaSmiPath, NVIDIA_SMI_ARGS, {
        timeoutMs: Math.max(settings.timeoutMs, GPU_MIN_TIMEOUT_MS),
        signal: this.abort.signal,
      });
      value = parseNvidiaSmi(decodeCommandOutput(output));
      if (!value) context.logger.warn("nvidia-smi: Ausgabe nicht auswertbar, GPU-Werte entfallen");
    } catch (raw) {
      if (this.stopped) throw unavailable();
      const code = (raw as { code?: unknown } | null)?.code;
      context.logger.debug(
        code === "ENOENT"
          ? "nvidia-smi nicht gefunden: keine NVIDIA-GPU oder Treiber fehlt, GPU/VRAM entfallen"
          : "nvidia-smi fehlgeschlagen, GPU/VRAM entfallen",
        { code },
      );
    }
    this.gpuCache = { at: now, value };
    return value;
  }

  private async readVolumes(): Promise<StorageVolume[]> {
    const { context, settings } = this.ready();
    const mapContext = this.mapContext(context);
    const volumes: StorageVolume[] = [];
    for (const mount of settings.storagePaths) {
      try {
        const stats = await this.host.statfs(mount);
        volumes.push(
          storageVolumeMapper.map(
            { mount, stats, createdAt: this.startedAt, sampledAt: mapContext.syncedAt },
            mapContext,
          ),
        );
      } catch (raw) {
        // One missing drive must not hide the others; the volume is simply not listed.
        context.logger.warn("Speicherpfad nicht lesbar, wird übersprungen", {
          path: mount,
          code: (raw as { code?: unknown } | null)?.code,
        });
      }
    }
    return volumes;
  }

  // ---- helpers ------------------------------------------------------------------------------------------------------

  private mapContext(context: AdapterContext): MapContext {
    return createMapContext({ adapterId: manifest.id, system: PROVIDER_SYSTEM, clock: context.clock });
  }

  private ready(): { context: AdapterContext; settings: AdapterSettings; env: ProbeEnv } {
    if (this.stopped || !this.context || !this.settings || !this.env) throw unavailable();
    return { context: this.context, settings: this.settings, env: this.env };
  }
}

/** host:port of a configured URL; an unparsable value yields no endpoint rather than a wrong one. */
function endpointOf(url: string): string | undefined {
  try {
    return new URL(url).host || undefined;
  } catch {
    return undefined;
  }
}

function paginate<T>(items: T[], params: PageParams, context: MapContext): Page<T> {
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(params.limit ?? DEFAULT_PAGE_SIZE)));
  const offset = decodeCursor(params.cursor);
  const next = offset + limit;
  return {
    items: items.slice(offset, next),
    pageInfo:
      next < items.length
        ? { nextCursor: Buffer.from(`o:${next}`).toString("base64url"), hasNextPage: true }
        : { nextCursor: null, hasNextPage: false },
    freshness: { state: "fresh", asOf: context.syncedAt },
  };
}

function decodeCursor(cursor: string | null | undefined): number {
  if (cursor === undefined || cursor === null || cursor === "") return 0;
  const match = /^o:(\d+)$/.exec(Buffer.from(cursor, "base64url").toString("utf8"));
  if (!match) {
    throw new AdapterError({ code: "VALIDATION_FAILED", message: "Ungültiger Cursor.", retryable: false });
  }
  return Number(match[1]);
}
