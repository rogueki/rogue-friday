import { createSpeechEnvelopeSource, type SpeechEnvelopeSource } from "../audio/speechEnvelope";
import type { OrbController } from "./types";

export type OrbDemoName = "auto" | "voice" | "working" | "errorRecovery";

export interface OrbDemo {
  start(name: OrbDemoName): void;
  stop(): void;
  readonly running: boolean;
  readonly name: OrbDemoName | null;
}

export interface OrbDemoOptions {
  /** Timer injection for tests: returns a cancel function. Defaults to `setTimeout`. */
  schedule?: (fn: () => void, delayMs: number) => () => void;
  /** Clock handed to the speech envelopes (default `performance.now`). */
  now?: () => number;
  seed?: number;
  /** Restart the sequence after it ended (the debug panel's continuous demo). */
  loop?: boolean;
  /** Called when a non-looping sequence finished. */
  onEnd?: () => void;
}

interface Step {
  at: number;
  run: (env: DemoEnv) => void;
}

interface DemoEnv {
  controller: OrbController;
  input: SpeechEnvelopeSource;
  output: SpeechEnvelopeSource;
  now: () => number;
}

const defaultSchedule = (fn: () => void, delayMs: number): (() => void) => {
  const id = setTimeout(fn, delayMs);
  return () => clearTimeout(id);
};

const monotonicNow = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

const micOn = (e: DemoEnv): void => {
  e.input.start(e.now());
  e.controller.setInputAudioSource(e.input);
  e.controller.bridge.onMicrophoneOpened({ source: "browser" });
};
const micOff = (e: DemoEnv): void => {
  e.controller.bridge.onMicrophoneClosed();
  e.input.stop(false, e.now());
};
const ttsOn = (e: DemoEnv): void => {
  e.output.start(e.now());
  e.controller.setOutputAudioSource(e.output);
  e.controller.bridge.onTtsStarted({ hasAudioAnalysis: true });
};
const ttsOff = (e: DemoEnv): void => {
  e.controller.bridge.onTtsEnded();
  e.output.stop(false, e.now());
};
const reset = (e: DemoEnv): void => {
  e.controller.reset();
  e.controller.setInputAudioSource(null);
  e.controller.setOutputAudioSource(null);
};

/** Idle -> Listening -> Transcribing -> Thinking -> Working -> Speaking -> Success -> Idle. */
const AUTO: Step[] = [
  { at: 0, run: reset },
  { at: 2500, run: micOn },
  { at: 7000, run: (e) => { micOff(e); e.controller.bridge.onTranscriptionStarted(); } },
  { at: 9200, run: (e) => { e.controller.bridge.onTranscriptionCompleted(); e.controller.bridge.onThinkingStarted(); } },
  { at: 12200, run: (e) => { e.controller.bridge.onThinkingCompleted(); e.controller.bridge.onTaskStarted({ taskId: "demo_task", title: "Recherche läuft", agentName: "Agent Atlas" }); e.controller.bridge.onAgentActivity(3, ["Agent Atlas", "Agent Nova", "Agent Kepler"]); } },
  { at: 14200, run: (e) => e.controller.bridge.onTaskProgress(0.25) },
  { at: 16200, run: (e) => e.controller.bridge.onTaskProgress(0.55) },
  { at: 18200, run: (e) => { ttsOn(e); e.controller.bridge.onTaskProgress(0.8); } },
  { at: 23200, run: ttsOff },
  { at: 23400, run: (e) => { e.controller.bridge.onAgentActivity(0); e.controller.bridge.onTaskCompleted({ taskId: "demo_task", success: true }); } },
  { at: 26500, run: reset },
];

const VOICE: Step[] = [
  { at: 0, run: reset },
  { at: 1000, run: micOn },
  { at: 6000, run: (e) => { micOff(e); e.controller.bridge.onTranscriptionStarted(); } },
  { at: 7800, run: (e) => { e.controller.bridge.onTranscriptionCompleted(); e.controller.bridge.onThinkingStarted(); } },
  { at: 9800, run: (e) => { e.controller.bridge.onThinkingCompleted(); ttsOn(e); } },
  { at: 16000, run: ttsOff },
  { at: 18000, run: reset },
];

const WORKING: Step[] = [
  { at: 0, run: reset },
  { at: 800, run: (e) => { e.controller.bridge.onTaskStarted({ taskId: "demo_task", title: "Recherche läuft" }); e.controller.bridge.onAgentActivity(3, ["Agent Atlas", "Agent Nova", "Agent Kepler"]); } },
  { at: 5000, run: (e) => e.controller.bridge.onTaskProgress(0.1) },
  { at: 7000, run: (e) => e.controller.bridge.onTaskProgress(0.35) },
  { at: 9000, run: (e) => e.controller.bridge.onTaskProgress(0.6) },
  { at: 11000, run: (e) => e.controller.bridge.onTaskProgress(0.85) },
  { at: 13000, run: (e) => { e.controller.bridge.onAgentActivity(0); e.controller.bridge.onTaskCompleted({ taskId: "demo_task", success: true }); } },
  { at: 16500, run: reset },
];

const ERROR_RECOVERY: Step[] = [
  { at: 0, run: reset },
  { at: 1500, run: (e) => e.controller.bridge.onWarning("Eingeschränkter Betrieb: Kalender-Adapter verzögert") },
  { at: 5500, run: (e) => e.controller.bridge.onWarningCleared() },
  { at: 7000, run: (e) => { e.controller.bridge.onTaskStarted({ taskId: "demo_task", title: "Postfach wird geprüft" }); } },
  { at: 9000, run: (e) => e.controller.bridge.onError({ message: "Adapter nicht erreichbar", code: "adapter_unreachable", critical: true }) },
  { at: 15000, run: (e) => e.controller.bridge.onErrorCleared() },
  { at: 17500, run: (e) => e.controller.bridge.onTaskCompleted({ taskId: "demo_task", success: true }) },
  { at: 21000, run: reset },
];

const SEQUENCES: Record<OrbDemoName, Step[]> = { auto: AUTO, voice: VOICE, working: WORKING, errorRecovery: ERROR_RECOVERY };

/**
 * Scripted demo sequences that drive the real bridge (so the whole event path is exercised without a backend). Voice and
 * TTS levels come from the seeded speech envelope; nothing here uses randomness or wall-clock state besides the timers.
 */
export function createOrbDemo(controller: OrbController, options: OrbDemoOptions = {}): OrbDemo {
  const schedule = options.schedule ?? defaultSchedule;
  const now = options.now ?? monotonicNow;
  const seed = options.seed ?? 20260617;
  let cancels: Array<() => void> = [];
  let active: OrbDemoName | null = null;
  let env: DemoEnv | null = null;

  const clear = (): void => {
    for (const c of cancels) c();
    cancels = [];
  };

  const run = (name: OrbDemoName): void => {
    const steps = SEQUENCES[name];
    const e: DemoEnv = {
      controller,
      input: createSpeechEnvelopeSource({ seed, intensity: 0.8 }),
      output: createSpeechEnvelopeSource({ seed: seed + 1, intensity: 0.9 }),
      now,
    };
    env = e;
    const last = steps[steps.length - 1]?.at ?? 0;
    for (const step of steps) cancels.push(schedule(() => step.run(e), step.at));
    cancels.push(
      schedule(() => {
        if (options.loop) {
          clear();
          run(name);
        } else {
          stopInternal(false);
          options.onEnd?.();
        }
      }, last + 50),
    );
  };

  const stopInternal = (resetController: boolean): void => {
    clear();
    if (env) {
      env.input.dispose();
      env.output.dispose();
      controller.setInputAudioSource(null);
      controller.setOutputAudioSource(null);
      env = null;
    }
    if (resetController) controller.reset();
    active = null;
  };

  return {
    start(name) {
      stopInternal(false);
      active = name;
      run(name);
    },
    stop() {
      stopInternal(true);
    },
    get running() {
      return active !== null;
    },
    get name() {
      return active;
    },
  };
}
