import type { OrbAudioFrame, OrbAudioFrameSource, OrbAudioLevels, OrbController, ServiceLevelSource } from "../orbApi";

/**
 * Chooses which audio source feeds each controller channel (docs/ORB_REWORK_ANALYSIS.md §4/§8 (d)):
 *
 *   input  : local analyser (browser microphone)  >  service level (`friday.voice.audio_level`, ~4 Hz)
 *   output : local analyser (browser TTS playback) >  speech envelope scaled by the service level  >  service level
 *
 * The orb scene pulls frames from the installed source itself, so nothing here runs per frame. Time arguments are on
 * the monotonic clock (`performance.now()`), the same base the scene samples with.
 */
export interface SpeechEnvelopeSource extends OrbAudioFrameSource {
  start(nowMs?: number): void;
  stop(interrupted?: boolean): void;
}
export interface AudioSourceFactories {
  createServiceLevelSource: () => ServiceLevelSource;
  createSpeechEnvelopeSource: (options?: { seed?: number; intensity?: number }) => SpeechEnvelopeSource;
}

/** A service level is considered fresh this long; the service emits at ~4 Hz, so a few missed ticks still count. */
export const SERVICE_LEVEL_FRESH_MS = 900;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * Speech envelope (irregular syllables and pauses) scaled by the service output level when the service reports one:
 * silence in the real signal darkens the envelope, loud passages lift it, so the orb follows the real TTS without the
 * 4 Hz staircase. Without fresh service levels the envelope runs on its own.
 */
class ScaledEnvelopeSource implements OrbAudioFrameSource {
  private readonly scratch: OrbAudioFrame = { rms: 0, peak: 0, low: 0, mid: 0, high: 0, gateOpen: false, source: "none" };

  constructor(
    private readonly envelope: SpeechEnvelopeSource,
    private readonly service: ServiceLevelSource,
  ) {}

  sample(nowMs: number, out: OrbAudioFrame): void {
    this.envelope.sample(nowMs, out);
    if (nowMs - this.service.lastPushAt > SERVICE_LEVEL_FRESH_MS) return;
    this.service.sample(nowMs, this.scratch);
    const level = this.scratch.rms;
    const gain = level < 0.03 ? 0.2 : 0.4 + 0.6 * Math.min(1, level * 1.6);
    out.rms = clamp01(out.rms * gain);
    out.peak = clamp01(out.peak * gain);
    out.low = clamp01(out.low * gain);
    out.mid = clamp01(out.mid * gain);
    out.high = clamp01(out.high * gain);
    out.gateOpen = out.gateOpen && level >= 0.03;
  }

  dispose(): void {
    this.envelope.dispose();
  }
}

export interface OrbAudioSources {
  readonly hasLocalInput: boolean;
  readonly hasLocalOutput: boolean;
  readonly speechFallbackActive: boolean;
  setLocalInput(source: OrbAudioFrameSource | null): void;
  setLocalOutput(source: OrbAudioFrameSource | null): void;
  pushServiceInput(levels: number | OrbAudioLevels): void;
  pushServiceOutput(levels: number | OrbAudioLevels): void;
  /** TTS started. `hasAudioAnalysis` false (or no local output analyser) switches on the speech-envelope fallback. */
  beginSpeech(options?: { hasAudioAnalysis?: boolean; seed?: number }): void;
  endSpeech(interrupted?: boolean): void;
  /** Forget everything transient (resync, reconnect). Local analysers stay installed. */
  reset(): void;
  dispose(): void;
}

export function createOrbAudioSources(controller: OrbController, factories: AudioSourceFactories): OrbAudioSources {
  const serviceInput = factories.createServiceLevelSource();
  const serviceOutput = factories.createServiceLevelSource();
  let localInput: OrbAudioFrameSource | null = null;
  let localOutput: OrbAudioFrameSource | null = null;
  let envelope: SpeechEnvelopeSource | null = null;
  let scaled: ScaledEnvelopeSource | null = null;
  let inputInstalled: OrbAudioFrameSource | null | undefined;
  let outputInstalled: OrbAudioFrameSource | null | undefined;
  let serviceInputSeen = false;
  let serviceOutputSeen = false;

  const install = (): void => {
    const input = localInput ?? (serviceInputSeen ? serviceInput : null);
    if (input !== inputInstalled) {
      inputInstalled = input;
      controller.setInputAudioSource(input);
    }
    const output = localOutput ?? scaled ?? (serviceOutputSeen ? serviceOutput : null);
    if (output !== outputInstalled) {
      outputInstalled = output;
      controller.setOutputAudioSource(output);
    }
  };

  const stopEnvelope = (interrupted: boolean): void => {
    if (!envelope) return;
    envelope.stop(interrupted);
    envelope.dispose();
    envelope = null;
    scaled = null;
  };

  return {
    get hasLocalInput() {
      return localInput !== null;
    },
    get hasLocalOutput() {
      return localOutput !== null;
    },
    get speechFallbackActive() {
      return envelope !== null;
    },
    setLocalInput(source) {
      localInput = source;
      install();
    },
    setLocalOutput(source) {
      localOutput = source;
      if (source) stopEnvelope(true); // a real signal replaces the simulated one immediately
      install();
    },
    pushServiceInput(levels) {
      serviceInput.push(levels);
      serviceInputSeen = true;
      install();
    },
    pushServiceOutput(levels) {
      serviceOutput.push(levels);
      serviceOutputSeen = true;
      install();
    },
    beginSpeech(options = {}) {
      stopEnvelope(true);
      if (localOutput && options.hasAudioAnalysis !== false) {
        install();
        return;
      }
      envelope = factories.createSpeechEnvelopeSource(options.seed === undefined ? undefined : { seed: options.seed });
      envelope.start();
      scaled = new ScaledEnvelopeSource(envelope, serviceOutput);
      install();
    },
    endSpeech(interrupted = false) {
      stopEnvelope(interrupted);
      install();
    },
    reset() {
      stopEnvelope(true);
      serviceInputSeen = false;
      serviceOutputSeen = false;
      install();
    },
    dispose() {
      stopEnvelope(true);
      serviceInput.dispose();
      serviceOutput.dispose();
      controller.setInputAudioSource(null);
      controller.setOutputAudioSource(null);
    },
  };
}
