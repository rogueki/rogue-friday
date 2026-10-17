import type { OrbAudioFrameSource, OrbEventBridge } from "../orbApi";
import type { OrbAudioSink } from "../orbHub";

/**
 * Browser voice path -> orb (docs/ORB_REWORK_ANALYSIS.md §8 (c)/(d)): the microphone MediaStream and the TTS playback
 * bus are tapped with analysers (the tap never sits in the signal path, playback is not blocked) and the lifecycle
 * facts go through the OrbEventBridge. All orb work is best effort: a missing analyser must never break voice.
 */
export interface AnalyzerRuntime {
  createAnalyzer(context: BaseAudioContext, source: AudioNode, kind: "input" | "output"): OrbAudioFrameSource;
}

export interface BrowserVoiceBridgeDeps {
  bridge: OrbEventBridge;
  audio: OrbAudioSink;
  /** Resolves the analyser factory (dynamic import of the orb chunk). Rejection is reported through `onError`. */
  loadRuntime(): Promise<AnalyzerRuntime>;
  onError?(error: unknown): void;
  setTimer?(callback: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
}

export interface BrowserVoiceBridge {
  /** Microphone stream opened by an explicit user action (`passive`: wake word armed, nothing said yet). */
  microphoneOpened(context: BaseAudioContext, source: AudioNode, options: { passive: boolean }): void;
  /** Microphone closed or muted. The input analyser is released. */
  microphoneClosed(): void;
  /** Playback bus every TTS buffer goes through (analyser reads it). */
  attachOutput(context: BaseAudioContext, bus: AudioNode): void;
  /** TTS audio begins (first frame announced). */
  ttsStarted(info?: { utteranceId?: string }): void;
  /** The server finished sending; the orb keeps speaking until the already scheduled audio has played. */
  ttsFinished(remainingPlaybackMs: number): void;
  /** Barge-in, clear, pause or stop: speaking ends now. */
  ttsInterrupted(): void;
  readonly speaking: boolean;
  /** Release everything (mic, output, timers). */
  dispose(): void;
}

export function createBrowserVoiceBridge(deps: BrowserVoiceBridgeDeps): BrowserVoiceBridge {
  const setTimer = deps.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const report = (error: unknown): void => (deps.onError ?? ((e) => console.error("Orb audio tap failed", e)))(error);

  let inputTap: OrbAudioFrameSource | null = null;
  let outputTap: OrbAudioFrameSource | null = null;
  let inputGeneration = 0;
  let outputGeneration = 0;
  let speaking = false;
  let outputAnalysis = false;
  let endTimer: unknown;

  const releaseInput = (): void => {
    inputGeneration += 1;
    deps.audio.setLocalInput(null);
    inputTap?.dispose();
    inputTap = null;
  };
  const releaseOutput = (): void => {
    outputGeneration += 1;
    deps.audio.setLocalOutput(null);
    outputTap?.dispose();
    outputTap = null;
    outputAnalysis = false;
  };
  const cancelEnd = (): void => {
    if (endTimer !== undefined) clearTimer(endTimer);
    endTimer = undefined;
  };
  const finishSpeech = (interrupted: boolean): void => {
    cancelEnd();
    if (!speaking) return;
    speaking = false;
    deps.audio.endSpeech(interrupted);
    deps.bridge.onTtsEnded({ interrupted });
  };

  return {
    microphoneOpened(context, source, options) {
      releaseInput();
      const generation = inputGeneration;
      deps.bridge.onMicrophoneOpened({ source: "browser", passive: options.passive });
      deps.loadRuntime().then(
        (runtime) => {
          if (generation !== inputGeneration) return; // closed while the chunk was loading
          try {
            inputTap = runtime.createAnalyzer(context, source, "input");
            deps.audio.setLocalInput(inputTap);
          } catch (error) {
            report(error);
          }
        },
        report,
      );
    },
    microphoneClosed() {
      releaseInput();
      deps.bridge.onMicrophoneClosed();
    },
    attachOutput(context, bus) {
      releaseOutput();
      const generation = outputGeneration;
      deps.loadRuntime().then(
        (runtime) => {
          if (generation !== outputGeneration) return;
          try {
            outputTap = runtime.createAnalyzer(context, bus, "output");
            outputAnalysis = true;
            deps.audio.setLocalOutput(outputTap);
          } catch (error) {
            report(error);
          }
        },
        report,
      );
    },
    ttsStarted(info) {
      cancelEnd();
      if (speaking) return;
      speaking = true;
      // Without a working analyser the orb falls back to the simulated speech envelope.
      deps.audio.beginSpeech({ hasAudioAnalysis: outputAnalysis });
      deps.bridge.onTtsStarted({ ...info, engine: "browser", hasAudioAnalysis: outputAnalysis });
    },
    ttsFinished(remainingPlaybackMs) {
      if (!speaking) return;
      cancelEnd();
      if (remainingPlaybackMs <= 30) finishSpeech(false);
      else endTimer = setTimer(() => finishSpeech(false), remainingPlaybackMs);
    },
    ttsInterrupted() {
      finishSpeech(true);
    },
    get speaking() {
      return speaking;
    },
    dispose() {
      finishSpeech(true);
      releaseInput();
      releaseOutput();
    },
  };
}
