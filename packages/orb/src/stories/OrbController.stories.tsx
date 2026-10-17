import { useEffect, useMemo, type ComponentType, type ReactNode } from "react";
import { createSpeechEnvelopeSource } from "../audio/speechEnvelope";
import { createOrbController } from "../controller/createOrbController";
import { createOrbDemo, type OrbDemoName } from "../controller/demo";
import type { OrbController, OrbMode } from "../controller/types";
import { FridayOrb } from "../FridayOrb";
import type { AudioFixtureName, OrbSettings } from "../settings";

/**
 * Controller-driven stories: every mode, parallel layers, audio sources (speech envelope, service level, test-clock
 * fixtures) and the looping demo sequences. All of it runs without a backend, through the same bridge the product uses.
 */
interface Meta<TArgs> {
  title: string;
  component?: ComponentType<TArgs>;
  parameters?: Record<string, unknown>;
  decorators?: Array<(Story: ComponentType) => ReactNode>;
  tags?: string[];
}
interface StoryObj<TArgs> {
  name?: string;
  args?: Partial<TArgs>;
  render?: (args: TArgs) => ReactNode;
  parameters?: Record<string, unknown>;
}

interface ControllerStoryArgs {
  /** Applies the scene to the controller (bridge calls, overrides, audio sources). Runs once on mount. */
  setup?: (controller: OrbController) => void | (() => void);
  settings?: Partial<OrbSettings>;
  width: number;
  height: number;
  fillRatio?: number;
}

const meta: Meta<ControllerStoryArgs> = {
  title: "Orb/Controller",
  parameters: {
    layout: "centered",
    backgrounds: { default: "orb", values: [{ name: "orb", value: "#01060c" }] },
  },
  decorators: [
    (Story) => (
      <div style={{ background: "#01060c", padding: 12 }}>
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs"],
};
export default meta;

function ControllerOrb({ setup, settings, width, height, fillRatio }: ControllerStoryArgs) {
  const controller = useMemo(() => createOrbController({ seed: 20260617 }), []);
  useEffect(() => {
    const cleanup = setup?.(controller);
    return () => {
      if (typeof cleanup === "function") cleanup();
      controller.reset();
    };
  }, [controller, setup]);
  return (
    <div
      style={{
        width,
        height,
        background: "radial-gradient(ellipse at 50% 45%, #06233a 0%, #03111d 55%, #020a12 100%)",
        border: "1px solid rgba(40,190,230,.4)",
      }}
    >
      <FridayOrb controller={controller} settings={settings} fillRatio={fillRatio} onActivate={(t) => console.info("orb activate", t)} onVoiceToggle={() => console.info("orb voice toggle")} />
    </div>
  );
}

const base = { width: 560, height: 380 } as const;
type Story = StoryObj<ControllerStoryArgs>;

const story = (name: string, args: Partial<ControllerStoryArgs>): Story => ({ name, args: { ...base, ...args }, render: (a) => <ControllerOrb {...(a as ControllerStoryArgs)} /> });

/** Forces one mode through the explicit override (the same call the debug panel uses). */
const mode = (m: OrbMode, extra?: (c: OrbController) => void) => (c: OrbController) => {
  c.setMode(m);
  extra?.(c);
};

/** Syllable-modulated speech levels as a live audio source (stand-in for the microphone analyser). */
function withSpeechInput(c: OrbController, intensity: number): () => void {
  const env = createSpeechEnvelopeSource({ seed: 11, intensity });
  env.start();
  c.setInputAudioSource(env);
  return () => {
    c.setInputAudioSource(null);
    env.dispose();
  };
}

function withSpeechOutput(c: OrbController, intensity: number): () => void {
  const env = createSpeechEnvelopeSource({ seed: 23, intensity });
  env.start();
  c.setOutputAudioSource(env);
  return () => {
    c.setOutputAudioSource(null);
    env.dispose();
  };
}

export const Idle = story("Idle (lives)", { setup: mode("idle") });
export const Booting = story("Booting", { setup: mode("booting") });
export const Listening = story("Listening (speech input)", {
  setup: (c) => {
    c.bridge.onMicrophoneOpened({ source: "browser" });
    return withSpeechInput(c, 0.85);
  },
});
export const ListeningQuiet = story("Listening quiet (noise gate)", {
  setup: (c) => {
    c.bridge.onMicrophoneOpened({ source: "browser" });
    return withSpeechInput(c, 0.12);
  },
});
export const Transcribing = story("Transcribing", {
  setup: (c) => {
    c.bridge.onTranscriptionStarted();
  },
});
export const Thinking = story("Thinking", {
  setup: (c) => {
    c.bridge.onThinkingStarted();
  },
});
export const Syncing = story("Syncing (calendar)", {
  setup: (c) => {
    c.bridge.onSyncStarted("calendar");
  },
});
export const WorkingIndeterminate = story("Working, progress unknown", {
  setup: (c) => {
    c.bridge.onTaskStarted({ taskId: "task_story", title: "Recherche läuft", agentName: "Agent Atlas" });
    c.bridge.onAgentActivity(2, ["Agent Atlas", "Agent Nova"]);
  },
});
export const WorkingDeterminate = story("Working 62 percent, 3 agents", {
  setup: (c) => {
    c.bridge.onTaskStarted({ taskId: "task_story", title: "Wettbewerbsanalyse", agentName: "Agent Atlas", progress: 0.62 });
    c.bridge.onAgentActivity(3, ["Agent Atlas", "Agent Nova", "Agent Kepler"]);
  },
});
export const SpeakingAnalyser = story("Speaking (TTS level source)", {
  setup: (c) => {
    c.bridge.onTtsStarted({ hasAudioAnalysis: true });
    return withSpeechOutput(c, 0.9);
  },
});
export const SpeakingEnvelopeFallback = story("Speaking (speech envelope fallback)", {
  setup: (c) => {
    c.bridge.onTtsStarted({ hasAudioAnalysis: false });
  },
});
export const SpeakingServiceLevel = story("Speaking (4 Hz service level)", {
  setup: (c) => {
    c.bridge.onTtsStarted();
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      c.bridge.onTtsAudioLevel(0.15 + 0.7 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6)));
    }, 250);
    return () => window.clearInterval(id);
  },
});
export const SpeakingWithThreeAgents = story("Speaking + 3 agents working", {
  setup: (c) => {
    c.bridge.onTaskStarted({ taskId: "task_story", title: "Recherche läuft", progress: 0.62 });
    c.bridge.onAgentActivity(3, ["Agent Atlas", "Agent Nova", "Agent Kepler"]);
    c.bridge.onTtsStarted({ hasAudioAnalysis: true });
    return withSpeechOutput(c, 0.9);
  },
});
export const WaitingApproval = story("Waiting Approval", {
  setup: (c) => {
    c.bridge.onApprovalRequired("appr_story");
    c.setActivity("E-MAIL-ENTWURF FREIGEBEN");
  },
});
export const ApprovalWhileSpeaking = story("Approval while speaking (parallel)", {
  setup: (c) => {
    c.bridge.onAgentActivity(2);
    c.bridge.onTtsStarted({ hasAudioAnalysis: false });
    c.bridge.onApprovalRequired("appr_story");
  },
});
export const Success = story("Success", {
  setup: (c) => {
    c.bridge.onTaskStarted({ taskId: "task_story", progress: 0.9 });
    c.bridge.onTaskCompleted({ taskId: "task_story", success: true });
  },
});
export const Warning = story("Warning (degraded, still alive)", {
  setup: (c) => {
    c.bridge.onWarning("Eingeschränkter Betrieb: einzelne Quellen verzögert");
  },
});
export const ErrorState = story("Error", {
  setup: (c) => {
    c.bridge.onError({ message: "Adapter nicht erreichbar", code: "adapter_unreachable", critical: true });
  },
});
export const Offline = story("Offline", { setup: mode("offline") });
export const Paused = story("Paused", { setup: mode("paused") });
export const ReducedMotion = story("Reduced motion (calm ring)", {
  setup: (c) => {
    c.bridge.onTtsStarted({ hasAudioAnalysis: false });
    c.bridge.onAgentActivity(3);
  },
  settings: { animations: "reduced" },
});
export const Fallback2D = story("2D fallback (all layers)", {
  setup: (c) => {
    c.bridge.onTaskStarted({ taskId: "task_story", progress: 0.62 });
    c.bridge.onAgentActivity(3);
    c.bridge.onTtsStarted({ hasAudioAnalysis: false });
  },
  settings: { renderer: "2d" },
});
export const LowQuality = story("Low quality", { setup: mode("working"), settings: { quality: "low" } });
export const UltraQuality = story("Ultra quality", { setup: mode("idle"), settings: { quality: "ultra" } });
export const FillRatioLarge = story("Fill ratio 0.78 in a large panel", { setup: mode("idle"), fillRatio: 0.78, width: 900, height: 700 });

/** Test-clock audio fixtures (silence / normal / loud / tts / spike): the same level at every screenshot. */
const fixtureStory = (name: AudioFixtureName, asMode: "listening" | "speaking"): Story =>
  story(`Audio fixture: ${name} (${asMode})`, { setup: mode(asMode), settings: { audioFixture: name } });
export const FixtureSilence = fixtureStory("silence", "listening");
export const FixtureNormal = fixtureStory("normal", "listening");
export const FixtureLoud = fixtureStory("loud", "listening");
export const FixtureTts = fixtureStory("tts", "speaking");
export const FixtureSpike = fixtureStory("spike", "speaking");

/** The looping demo sequences (owner order section 19). */
function demoStory(name: string, which: OrbDemoName): Story {
  return story(`Demo: ${name}`, {
    setup: (c) => {
      const demo = createOrbDemo(c, { loop: true });
      demo.start(which);
      return () => demo.stop();
    },
  });
}
export const DemoAuto = demoStory("Auto (idle to success)", "auto");
export const DemoVoice = demoStory("Voice", "voice");
export const DemoWorking = demoStory("Working", "working");
export const DemoErrorRecovery = demoStory("Error recovery", "errorRecovery");
