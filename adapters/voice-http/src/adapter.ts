import type { VoiceDevice, VoiceMetrics, VoiceProfile, VoiceStatus } from "@jarvis/sdk";
import {
  AdapterError,
  createHttpClient,
  createMapContext,
  normalizeError,
  toIso,
  type AdapterContext,
  type AdapterHealthReport,
  type CallContext,
  type CapabilitySet,
  type HttpClient,
  type JarvisAdapter,
  type Page,
  type PageParams,
  type Single,
  type VoicePort,
} from "@jarvis/adapter-core";
import { DEFAULT_BASE_URL, DEFAULT_LOCAL_MODEL_URL, PROVIDER_SYSTEM, manifest } from "./manifest";
import {
  emptyVoiceMetricsMapper,
  parseRawVoiceStatus,
  voiceStatusMapper,
  type LocalModelProbe,
  type VoiceSettings,
} from "./mapping";
import type { RawVoiceStatus } from "./provider-types";

interface AdapterSettings extends VoiceSettings {
  baseUrl: string;
  localModelUrl: string;
  timeoutMs: number;
  maxAttempts: number;
  retryBaseDelayMs: number;
}

const numberOr = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const stringOr = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.length > 0 ? value : fallback;

function readSettings(config: Readonly<Record<string, unknown>>): AdapterSettings {
  return {
    baseUrl: stringOr(config.baseUrl, DEFAULT_BASE_URL),
    localModelUrl: stringOr(config.localModelUrl, DEFAULT_LOCAL_MODEL_URL),
    localModelName: stringOr(config.localModelName, "qwen3-router"),
    wakePhrase: stringOr(config.wakePhrase, "Hey Friday"),
    sttEngine: stringOr(config.sttEngine, "faster-whisper"),
    ttsEngine: stringOr(config.ttsEngine, "piper"),
    timeoutMs: numberOr(config.timeoutMs, 2_000),
    maxAttempts: numberOr(config.maxAttempts, 2),
    retryBaseDelayMs: numberOr(config.retryBaseDelayMs, 200),
  };
}

/**
 * Why the port is closed is not knowable from outside: the service opens it only after all models are loaded
 * (jarvis_voice.py `run()` after `__init__`, up to ~3 min), and it is also closed when the service is stopped.
 */
const UNREACHABLE_MESSAGE =
  "Voice-Dienst nicht erreichbar (lädt noch Modelle, bis ca. 3 Minuten, oder gestoppt)";

/**
 * Voice adapter over the status endpoint of the installed Jarvis voice service. Read-only: the service has exactly one
 * HTTP handler (`do_GET`, path ignored, no auth) and no control interface, so only `voice.read` is declared.
 */
export class JarvisVoiceHttpAdapter implements VoicePort, JarvisAdapter {
  readonly manifest = manifest;

  private context: AdapterContext | undefined;
  private settings: AdapterSettings | undefined;
  private voiceHttp: HttpClient | undefined;
  private modelHttp: HttpClient | undefined;
  private abort = new AbortController();
  private stopped = true;

  async initialize(context: AdapterContext): Promise<void> {
    const settings = readSettings(context.config);
    this.context = context;
    this.settings = settings;
    this.abort = new AbortController();
    this.stopped = false;
    const common = {
      timeoutMs: settings.timeoutMs,
      // The registry owns the circuit breaker; a second one here would hide recoveries from the status polling.
      circuitBreaker: false as const,
      clock: context.clock,
      logger: context.logger,
      signal: this.abort.signal,
    };
    this.voiceHttp = createHttpClient({
      ...common,
      baseUrl: settings.baseUrl,
      retry: {
        maxAttempts: settings.maxAttempts,
        baseDelayMs: settings.retryBaseDelayMs,
        maxDelayMs: Math.max(settings.retryBaseDelayMs, 2_000),
        factor: 2,
        jitter: "full",
      },
    });
    this.modelHttp = createHttpClient({ ...common, baseUrl: settings.localModelUrl, retry: false });
    context.signal.addEventListener("abort", () => this.abort.abort(context.signal.reason), { once: true });
  }

  async getCapabilities(): Promise<CapabilitySet> {
    return { capabilities: [...manifest.capabilities] };
  }

  async healthCheck(): Promise<AdapterHealthReport> {
    if (this.stopped || !this.voiceHttp || !this.context) {
      return {
        status: "offline",
        latencyMs: null,
        message: "Adapter ist nicht aktiv",
        errorCode: "ADAPTER_UNAVAILABLE",
      };
    }
    const clock = this.context.clock;
    const started = clock.now();
    try {
      const raw = await this.fetchRawStatus(this.voiceHttp, false);
      const latencyMs = Math.max(0, Math.round(clock.now() - started));
      if (raw.state === "starting") {
        return {
          status: "degraded",
          latencyMs,
          message: "Voice-Dienst startet (Mikrofon noch nicht geöffnet)",
          errorCode: "STARTING",
        };
      }
      return { status: "online", latencyMs };
    } catch (raw) {
      const error = normalizeError(raw, { operation: "healthCheck" });
      switch (error.code) {
        case "ADAPTER_TIMEOUT":
          return {
            status: "offline",
            latencyMs: null,
            message: "Zeitüberschreitung beim Zugriff auf den Voice-Dienst",
            errorCode: error.code,
          };
        case "VALIDATION_FAILED":
          return {
            status: "degraded",
            latencyMs: null,
            message: "Voice-Dienst antwortet mit unerwarteten Daten",
            errorCode: error.code,
          };
        case "ADAPTER_UNAVAILABLE":
          // A refused connection carries no HTTP status; a 5xx answer does and means "reachable but failing".
          return {
            status: error.details.upstreamStatus === undefined ? "offline" : "degraded",
            latencyMs: null,
            message:
              error.details.upstreamStatus === undefined
                ? UNREACHABLE_MESSAGE
                : "Voice-Dienst meldet einen Serverfehler",
            errorCode: error.code,
          };
        default:
          return {
            status: "offline",
            latencyMs: null,
            message: "Voice-Dienst ist nicht erreichbar",
            errorCode: error.code,
          };
      }
    }
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    this.abort.abort(new DOMException("Adapter shutdown", "AbortError"));
    this.context = undefined;
    this.voiceHttp = undefined;
    this.modelHttp = undefined;
  }

  // ---- VoicePort ------------------------------------------------------------------------------------------------

  async getVoiceStatus(_params: Record<string, never>, call: CallContext): Promise<Single<VoiceStatus>> {
    const { voiceHttp, context, settings } = this.ready();
    // A refused/closed port throws ADAPTER_UNAVAILABLE here: no status is invented while the service is loading or off.
    const [raw, localModel] = await Promise.all([
      this.fetchRawStatus(voiceHttp, true, call),
      this.probeLocalModel(call),
    ]);
    const mapContext = createMapContext({
      adapterId: manifest.id,
      system: PROVIDER_SYSTEM,
      clock: context.clock,
    });
    return {
      data: voiceStatusMapper.map({ raw, settings, localModel }, mapContext),
      freshness: { state: "fresh", asOf: mapContext.syncedAt },
    };
  }

  async listVoiceDevices(_params: PageParams, _call: CallContext): Promise<Page<VoiceDevice>> {
    // No data source: the service exposes no audio devices (`input_device` lives in voice.json, not in the status).
    return this.emptyPage<VoiceDevice>();
  }

  async listVoiceProfiles(_params: PageParams, _call: CallContext): Promise<Page<VoiceProfile>> {
    // No data source: the speaker profile is a local .npy embedding; sample count, quality and threshold are not exposed.
    return this.emptyPage<VoiceProfile>();
  }

  async getVoiceMetrics(_params: Record<string, never>, _call: CallContext): Promise<Single<VoiceMetrics>> {
    const { context } = this.ready();
    const mapContext = createMapContext({
      adapterId: manifest.id,
      system: PROVIDER_SYSTEM,
      clock: context.clock,
    });
    return {
      // No latency data source: all statistics are empty (sampleCount 0), freshness is "unknown".
      data: emptyVoiceMetricsMapper.map(null, mapContext),
      freshness: { state: "unknown", asOf: mapContext.syncedAt },
    };
  }

  // ---- helpers ----------------------------------------------------------------------------------------------------

  private async fetchRawStatus(
    http: HttpClient,
    retry: boolean,
    call?: CallContext,
  ): Promise<RawVoiceStatus> {
    const response = await http.request<unknown>({
      method: "GET",
      // The service ignores the path (single do_GET handler); "/" is the documented form.
      path: "/",
      operation: "getVoiceStatus",
      ...(retry ? {} : { retry: false as const }),
      ...(call ? { correlationId: call.correlationId } : {}),
      ...(call?.signal ? { signal: call.signal } : {}),
    });
    return parseRawVoiceStatus(response.body);
  }

  /** Reachability of the router model (`GET /v1/models`, qwen.md §2.1). Never throws: unreachable is a state. */
  private async probeLocalModel(call: CallContext): Promise<LocalModelProbe> {
    const { modelHttp } = this.ready();
    try {
      await modelHttp.request({
        method: "GET",
        path: "/v1/models",
        operation: "probeLocalModel",
        retry: false,
        correlationId: call.correlationId,
        ...(call.signal ? { signal: call.signal } : {}),
      });
      return { state: "ready" };
    } catch (raw) {
      const error = normalizeError(raw, { operation: "probeLocalModel" });
      if (this.stopped) throw error;
      const status = error.details.upstreamStatus;
      // 503 is what llama-server answers while the model loads (Annahme (unbelegt), qwen.md §2.2).
      if (status === 503) return { state: "busy" };
      if (typeof status === "number" && status < 500) return { state: "error" };
      if (error.code === "VALIDATION_FAILED") return { state: "error" };
      return { state: "offline" };
    }
  }

  private emptyPage<T>(): Page<T> {
    const { context } = this.ready();
    return {
      items: [],
      pageInfo: { nextCursor: null, hasNextPage: false },
      freshness: { state: "unknown", asOf: toIso(context.clock) },
    };
  }

  private ready(): {
    voiceHttp: HttpClient;
    modelHttp: HttpClient;
    context: AdapterContext;
    settings: AdapterSettings;
  } {
    if (this.stopped || !this.voiceHttp || !this.modelHttp || !this.context || !this.settings) {
      throw new AdapterError({
        code: "ADAPTER_UNAVAILABLE",
        message: "Der Adapter ist nicht aktiv.",
        retryable: false,
      });
    }
    return {
      voiceHttp: this.voiceHttp,
      modelHttp: this.modelHttp,
      context: this.context,
      settings: this.settings,
    };
  }
}
