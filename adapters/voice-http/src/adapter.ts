import type { VoiceDevice, VoiceMetrics, VoiceProfile, VoiceStatus } from "@friday/sdk";
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
  type FridayAdapter,
  type Page,
  type PageParams,
  type Single,
  type VoicePort,
} from "@friday/adapter-core";
import { DEFAULT_BASE_URL, DEFAULT_LOCAL_MODEL_URL, PROVIDER_SYSTEM, manifest } from "./manifest";
import {
  emptyVoiceMetricsMapper,
  parseRawVoiceStatus,
  toVoicePhase,
  voiceStatusMapper,
  type LocalModelProbe,
  type VoiceSettings,
} from "./mapping";
import type { RawAudioLevels, RawVoiceStatus } from "./provider-types";

interface AdapterSettings extends VoiceSettings {
  baseUrl: string;
  localModelUrl: string;
  timeoutMs: number;
  maxAttempts: number;
  retryBaseDelayMs: number;
  /** Poll interval while the service is in a command/followup/speaking state (phase and audio level events). 0 = off. */
  levelPollIntervalMs: number;
  /** Poll interval in every other state; detects the switch into an active state (phase events only on change). */
  idlePollIntervalMs: number;
}

const DEFAULT_LEVEL_POLL_MS = 250;
const DEFAULT_IDLE_POLL_MS = 500;
const AUDIO_LEVEL_SUBJECT = "voice/audio";
const STATE_SUBJECT = "voice/status";
const TTS_SUBJECT = "voice/tts";

type LevelDirection = "input" | "output";

const numberOr = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const stringOr = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.length > 0 ? value : fallback;

function readSettings(config: Readonly<Record<string, unknown>>): AdapterSettings {
  const cloudMode = config.cloudMode === true;
  return {
    cloudMode,
    baseUrl: stringOr(config.baseUrl, DEFAULT_BASE_URL),
    localModelUrl: stringOr(config.localModelUrl, DEFAULT_LOCAL_MODEL_URL),
    localModelName: cloudMode ? "Cloud-Routing (Provider ungeprueft)" : stringOr(config.localModelName, "qwen3-router"),
    wakePhrase: stringOr(config.wakePhrase, "Hey Friday"),
    sttEngine: stringOr(config.sttEngine, cloudMode ? "ElevenLabs Scribe" : "faster-whisper"),
    ttsEngine: stringOr(config.ttsEngine, cloudMode ? "ElevenLabs" : "piper"),
    timeoutMs: numberOr(config.timeoutMs, 2_000),
    maxAttempts: numberOr(config.maxAttempts, 2),
    retryBaseDelayMs: numberOr(config.retryBaseDelayMs, 200),
    levelPollIntervalMs: numberOr(config.levelPollIntervalMs, DEFAULT_LEVEL_POLL_MS),
    idlePollIntervalMs: numberOr(config.idlePollIntervalMs, DEFAULT_IDLE_POLL_MS),
  };
}

/**
 * Why the port is closed is not knowable from outside: the service opens it only after all models are loaded
 * (friday_voice.py `run()` after `__init__`, up to ~3 min), and it is also closed when the service is stopped.
 */
const UNREACHABLE_MESSAGE =
  "Voice-Dienst nicht erreichbar (lädt noch Modelle, bis ca. 3 Minuten, oder gestoppt)";

/**
 * Voice adapter over the status endpoint of the installed Friday voice service. The authenticated manual-start
 * endpoint is used by the Control API command intent; this adapter only exposes `voice.read`.
 */
export class FridayVoiceHttpAdapter implements VoicePort, FridayAdapter {
  readonly manifest = manifest;

  private context: AdapterContext | undefined;
  private settings: AdapterSettings | undefined;
  private voiceHttp: HttpClient | undefined;
  private modelHttp: HttpClient | undefined;
  private abort = new AbortController();
  private stopped = true;
  private cancelLevelTimer: (() => void) | undefined;
  /** Directions that currently show a non-zero level, so a final 0 is emitted when the service goes quiet. */
  private activeDirections = new Set<LevelDirection>();
  /** Last reported voice mode; the adapter assumes `idle` at start so a quiet service emits nothing. */
  private lastMode: VoiceStatus["mode"] = "idle";
  /** The TTS utterance currently reported as started (`friday.voice.tts_started`), if any. */
  private utterance: { id: string; startedAtMs: number } | undefined;
  private utteranceCounter = 0;
  /** Reachability of the router model as last seen by `getVoiceStatus`; state events reuse it without a new probe. */
  private lastLocalModel: LocalModelProbe = { state: "ready" };

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
    this.activeDirections.clear();
    this.lastMode = "idle";
    this.utterance = undefined;
    if (settings.levelPollIntervalMs > 0) this.scheduleLevelPoll(settings.idlePollIntervalMs);
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
    this.cancelLevelTimer?.();
    this.cancelLevelTimer = undefined;
    this.abort.abort(new DOMException("Adapter shutdown", "AbortError"));
    this.context = undefined;
    this.voiceHttp = undefined;
    this.modelHttp = undefined;
  }

  // ---- VoicePort ------------------------------------------------------------------------------------------------

  async getVoiceStatus(_params: Record<string, never>, call: CallContext): Promise<Single<VoiceStatus>> {
    const { voiceHttp, context, settings } = this.ready();
    // A refused/closed port throws ADAPTER_UNAVAILABLE here: no status is invented while the service is loading or off.
    const [raw, probedModel] = await Promise.all([
      this.fetchRawStatus(voiceHttp, true, call),
      settings.cloudMode ? Promise.resolve(null) : this.probeLocalModel(call),
    ]);
    // The contract requires localModel even when no local model exists. "ready" reflects the
    // running voice service and configured cloud route; it does not assert remote provider health.
    const localModel = probedModel ?? { state: raw.state === "starting" ? "busy" as const : "ready" as const };
    if (probedModel) this.lastLocalModel = probedModel;
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

  // ---- events (voice phases, TTS, audio level) ----------------------------------------------------------------------

  /**
   * One poll cycle over the status endpoint. Every cycle emits, in this order and only when there is something to say:
   * - `friday.voice.state_changed` (full `VoiceStatus`) when the pipeline mode changed (listening, transcribing,
   *   thinking, speaking, idle). The mode comes from the service `phase` key; services without it only yield
   *   listening/speaking/idle.
   * - `friday.voice.tts_started` / `friday.voice.tts_ended` around TTS playback (`speaking`); the utterance id is
   *   generated here, `interrupted` is true when the service left `speaking` for a new command (barge-in) or paused.
   * - `friday.voice.audio_level` while the user is recorded (`listening`, direction `input`) or the assistant speaks
   *   (direction `output`), with peak and low/mid/high bands when the service reports them; one final 0 per
   *   direction when it ends. No input level during `transcribing`/`thinking` (the microphone is not being "used").
   * Transcript text is never emitted: the status endpoint does not expose it (privacy by design), so
   * `friday.voice.transcript_partial/final` stay reserved for sources that may legitimately carry text.
   * With `audio_transport: "browser"` (Linux) audio levels and TTS events come from the browser audio gateway, which sees
   * the real PCM frames; this adapter then only reports the phases.
   * The adapter cannot know whether a WebSocket client is connected, so the state gate keeps the load low (idle:
   * one local GET per `idlePollIntervalMs`).
   */
  async pollEvents(): Promise<number> {
    if (this.stopped || !this.voiceHttp || !this.context || !this.settings) return 0;
    const context = this.context;
    const settings = this.settings;
    const raw = await this.fetchRawStatus(this.voiceHttp, false);
    const phase = toVoicePhase(raw);
    const browserTransport = raw.audio_transport === "browser";
    const nowMs = context.clock.now();
    const now = new Date(nowMs).toISOString();
    let emitted = 0;

    if (phase !== this.lastMode) {
      const mapContext = createMapContext({ adapterId: manifest.id, system: PROVIDER_SYSTEM, clock: context.clock });
      context.emit({
        type: "friday.voice.state_changed",
        subject: STATE_SUBJECT,
        data: voiceStatusMapper.map({ raw, settings, localModel: this.lastLocalModel }, mapContext),
      });
      emitted += 1;
      this.lastMode = phase;
    }

    if (!browserTransport) {
      const speaking = phase === "speaking";
      if (speaking && !this.utterance) {
        this.utteranceCounter += 1;
        this.utterance = { id: `utt_${nowMs.toString(36)}_${this.utteranceCounter}`, startedAtMs: nowMs };
        context.emit({
          type: "friday.voice.tts_started",
          subject: TTS_SUBJECT,
          data: { utteranceId: this.utterance.id, engine: settings.ttsEngine },
        });
        emitted += 1;
      } else if (!speaking && this.utterance) {
        context.emit({
          type: "friday.voice.tts_ended",
          subject: TTS_SUBJECT,
          data: {
            utteranceId: this.utterance.id,
            durationMs: Math.max(0, Math.round(nowMs - this.utterance.startedAtMs)),
            // `command` right after speaking = barge-in (wake word during playback); `paused` = stop/pause control.
            interrupted: raw.state === "command" || raw.state === "paused",
          },
        });
        emitted += 1;
        this.utterance = undefined;
      }
    }

    const levels: Array<[LevelDirection, RawAudioLevels]> = [];
    if (!browserTransport) {
      if (phase === "listening") levels.push(["input", raw.input_audio ?? { level: raw.input_level ?? 0 }]);
      if (phase === "speaking") levels.push(["output", raw.output_audio ?? { level: raw.output_level ?? 0 }]);
    }
    const current = new Set<LevelDirection>();
    const emit = (direction: LevelDirection, levels: RawAudioLevels | null): void => {
      context.emit({
        type: "friday.voice.audio_level",
        subject: AUDIO_LEVEL_SUBJECT,
        data: {
          direction,
          level: levels?.level ?? 0,
          ...(levels?.peak !== undefined ? { peak: levels.peak } : {}),
          ...(levels?.low !== undefined ? { low: levels.low } : {}),
          ...(levels?.mid !== undefined ? { mid: levels.mid } : {}),
          ...(levels?.high !== undefined ? { high: levels.high } : {}),
          at: now,
        },
      });
      emitted += 1;
    };
    for (const [direction, measured] of levels) {
      current.add(direction);
      emit(direction, measured);
    }
    for (const direction of this.activeDirections) if (!current.has(direction)) emit(direction, null);
    this.activeDirections = current;
    return emitted;
  }

  /** Closes a reported TTS utterance when the service becomes unreachable, so no `tts_started` stays open. */
  private endUtterance(interrupted: boolean): void {
    const context = this.context;
    const utterance = this.utterance;
    this.utterance = undefined;
    if (!context || !utterance) return;
    context.emit({
      type: "friday.voice.tts_ended",
      subject: TTS_SUBJECT,
      data: {
        utteranceId: utterance.id,
        durationMs: Math.max(0, Math.round(context.clock.now() - utterance.startedAtMs)),
        interrupted,
      },
    });
  }

  private scheduleLevelPoll(delayMs: number): void {
    const context = this.context;
    const settings = this.settings;
    if (!context || !settings || this.stopped) return;
    this.cancelLevelTimer = context.clock.setTimeout(() => {
      if (this.stopped) return;
      this.pollEvents()
        .then(
          () => (this.lastMode !== "idle" || this.activeDirections.size > 0 ? settings.levelPollIntervalMs : settings.idlePollIntervalMs),
          () => {
            // Unreachable or malformed: the health monitor reports it; stay quiet and fall back to the slow rate.
            // The next successful poll reports whatever the service says then (state_changed on any difference to idle).
            this.activeDirections.clear();
            this.lastMode = "idle";
            this.endUtterance(true);
            return settings.idlePollIntervalMs;
          },
        )
        .then((next) => this.scheduleLevelPoll(next));
    }, delayMs);
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
