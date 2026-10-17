import type { VoiceAudioLevel, VoiceTtsEnded, VoiceTtsStarted } from "@friday/sdk";
import { analyzePcm16, LevelSmoother, SILENCE, type AudioLevels } from "./audio-analysis";

/** Subset of `EventHub.publish` the telemetry needs; keeps the class testable without a hub. */
export type TelemetryEvent =
  | { type: "friday.voice.audio_level"; subject: string; data: VoiceAudioLevel }
  | { type: "friday.voice.tts_started"; subject: string; data: VoiceTtsStarted }
  | { type: "friday.voice.tts_ended"; subject: string; data: VoiceTtsEnded };
export type TelemetryPublish = (event: TelemetryEvent) => void;

export interface TelemetryOptions {
  publish: TelemetryPublish;
  now: () => number;
  /** Name of the TTS engine reported in `friday.voice.tts_started`. */
  ttsEngine: string;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/** Minimum time between two audio level events of one direction (frames arrive every 80 ms). */
export const LEVEL_INTERVAL_MS = 150;
/** Frames without an `audio_end` marker: the utterance counts as ended after this silence. */
export const TTS_IDLE_END_MS = 700;

const SUBJECT_LEVEL = "voice/audio";
const SUBJECT_TTS = "voice/tts";

/**
 * Real audio telemetry of the Linux browser-audio proxy. The Control API sees every PCM frame of both directions:
 * microphone frames from the browser (analysed only while the voice service reports `listening`, so an armed but
 * idle microphone stays silent on the event bus) and TTS frames from the voice service (always). The voice service's
 * text control messages mark the TTS boundaries (`audio_start`, `audio_end`, `clear` = interrupted). Pipeline phases
 * (listening, transcribing, thinking) are NOT derived here: only the voice service knows them, the adapter reports them.
 * Nothing but numbers is published; samples are analysed and dropped.
 */
export class BrowserVoiceTelemetry {
  private voiceMode = "idle";
  private readonly input = new LevelSmoother();
  private readonly output = new LevelSmoother();
  private lastInputAt = Number.NEGATIVE_INFINITY;
  private lastOutputAt = Number.NEGATIVE_INFINITY;
  private inputActive = false;
  private utterance: { id: string; startedAt: number } | undefined;
  private idleTimer: unknown;
  private counter = 0;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(private readonly options: TelemetryOptions) {
    this.setTimer = options.setTimer ?? ((callback, ms) => {
      const handle = setTimeout(callback, ms);
      handle.unref?.();
      return handle;
    });
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));
  }

  /** Latest pipeline mode from `friday.voice.state_changed`; gates the microphone level. */
  setVoiceMode(mode: string): void {
    this.voiceMode = mode;
    if (mode !== "listening") this.endInput();
  }

  /** One 80 ms microphone frame from the browser (PCM16, 16 kHz). */
  onInputFrame(frame: Uint8Array): void {
    if (this.voiceMode !== "listening") return;
    const now = this.options.now();
    const levels = this.input.push(analyzePcm16(frame));
    if (now - this.lastInputAt < LEVEL_INTERVAL_MS) return;
    this.lastInputAt = now;
    this.inputActive = true;
    this.emitLevel("input", levels);
  }

  /** One TTS frame from the voice service (PCM16, 16 kHz). */
  onOutputFrame(frame: Uint8Array): void {
    const now = this.options.now();
    this.startUtterance(now);
    const levels = this.output.push(analyzePcm16(frame));
    this.armIdleEnd();
    if (now - this.lastOutputAt < LEVEL_INTERVAL_MS) return;
    this.lastOutputAt = now;
    this.emitLevel("output", levels);
  }

  /** Text control message of the voice service (`audio_start`, `audio_end`, `clear`); anything else is ignored. */
  onVoiceControl(text: string): void {
    let type: unknown;
    try {
      type = (JSON.parse(text) as { type?: unknown }).type;
    } catch {
      return;
    }
    if (type === "audio_start") this.startUtterance(this.options.now());
    else if (type === "audio_end") this.endUtterance(false);
    else if (type === "clear") this.endUtterance(true);
  }

  /** The session ended: close what is open so no `tts_started` or non-zero level stays behind. */
  close(): void {
    this.endUtterance(true);
    this.endInput();
  }

  private startUtterance(now: number): void {
    if (this.utterance) return;
    this.counter += 1;
    this.utterance = { id: `utt_${now.toString(36)}_${this.counter}`, startedAt: now };
    this.output.reset();
    this.lastOutputAt = Number.NEGATIVE_INFINITY;
    this.options.publish({
      type: "friday.voice.tts_started",
      subject: SUBJECT_TTS,
      data: { utteranceId: this.utterance.id, engine: this.options.ttsEngine },
    });
  }

  private endUtterance(interrupted: boolean): void {
    this.clearIdleTimer();
    const utterance = this.utterance;
    if (!utterance) return;
    this.utterance = undefined;
    this.emitLevel("output", SILENCE);
    this.output.reset();
    this.options.publish({
      type: "friday.voice.tts_ended",
      subject: SUBJECT_TTS,
      data: { utteranceId: utterance.id, durationMs: Math.max(0, Math.round(this.options.now() - utterance.startedAt)), interrupted },
    });
  }

  private endInput(): void {
    if (this.inputActive) {
      this.inputActive = false;
      this.emitLevel("input", SILENCE);
    }
    this.input.reset();
    this.lastInputAt = Number.NEGATIVE_INFINITY;
  }

  private armIdleEnd(): void {
    this.clearIdleTimer();
    this.idleTimer = this.setTimer(() => {
      this.idleTimer = undefined;
      this.endUtterance(false);
    }, TTS_IDLE_END_MS);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== undefined) this.clearTimer(this.idleTimer);
    this.idleTimer = undefined;
  }

  private emitLevel(direction: "input" | "output", levels: Readonly<AudioLevels>): void {
    this.options.publish({
      type: "friday.voice.audio_level",
      subject: SUBJECT_LEVEL,
      data: { direction, ...levels, at: new Date(this.options.now()).toISOString() },
    });
  }
}
