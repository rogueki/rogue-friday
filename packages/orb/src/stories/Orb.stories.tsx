import type { ComponentType, ReactNode } from "react";
import type { OrbLayers, OrbMode, OrbSnapshot, OrbStatus } from "../contract-types";
import { JarvisOrb } from "../JarvisOrb";
import { layersFromStatus } from "../machine/orbMachine";
import type { OrbSettings } from "../settings";

/**
 * Local CSF3 shapes. `@storybook/react` is installed in `apps/storybook`, not in this package, so the types are
 * declared structurally here; they are assignable to Storybook's `Meta` / `StoryObj`.
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

interface OrbStoryArgs {
  snapshot: OrbSnapshot;
  settings?: Partial<OrbSettings>;
  width: number;
  height: number;
  showPerf?: boolean;
}

const SINCE = "2026-06-15T10:00:00.000Z";

function snap(mode: OrbMode, extra: Partial<OrbStatus> = {}, layers?: Partial<OrbLayers>): OrbSnapshot {
  const status: OrbStatus = { mode, since: SINCE, health: "online", sourceEventId: "evt_story", ...extra };
  return { status, layers: { ...layersFromStatus(status), ...layers } };
}

const meta: Meta<OrbStoryArgs> = {
  title: "Orb/JarvisOrb",
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

function render({ snapshot, settings, width, height, showPerf }: OrbStoryArgs): ReactNode {
  return (
    <div
      style={{
        width,
        height,
        background: "radial-gradient(ellipse at 50% 45%, #06233a 0%, #03111d 55%, #020a12 100%)",
        border: "1px solid rgba(40,190,230,.4)",
      }}
    >
      <JarvisOrb
        snapshot={snapshot}
        settings={settings}
        showPerf={showPerf}
        onActivate={(t) => console.info("orb activate", t)}
        onVoiceToggle={() => console.info("orb voice toggle")}
      />
    </div>
  );
}

const base = { width: 560, height: 380 } as const;
type Story = StoryObj<OrbStoryArgs>;

const story = (name: string, args: Partial<OrbStoryArgs>): Story => ({ name, args: { ...base, ...args }, render: (a) => render(a as OrbStoryArgs) });

export const Booting = story("Booting", { snapshot: snap("booting", { activityText: "F.R.I.D.A.Y. WIRD INITIALISIERT" }) });
export const Idle = story("Idle", { snapshot: snap("idle") });
export const ListeningLowAudio = story("Listening low audio", {
  snapshot: snap("listening", { audioLevel: 0.15 }),
});
export const ListeningHighAudio = story("Listening high audio", {
  snapshot: snap("listening", { audioLevel: 0.9 }),
  settings: { audioFixture: "loud" },
});
export const Transcribing = story("Transcribing", { snapshot: snap("transcribing") });
export const Thinking = story("Thinking", { snapshot: snap("thinking", { activityText: "ANALYSE LÄUFT" }) });
export const Syncing = story("Syncing", { snapshot: snap("syncing", { activityText: "KALENDER WIRD SYNCHRONISIERT" }) });
export const WorkingIndeterminate = story("Working indeterminate", {
  snapshot: snap("working", { activityText: "RECHERCHE LÄUFT", progressMode: "indeterminate", progress: null, activeAgentCount: 2, taskId: "task_01JZ8Q3N4K" }),
});
export const Working62Percent = story("Working 62 percent", {
  snapshot: snap("working", { activityText: "WETTBEWERBSANALYSE", progressMode: "determinate", progress: 0.62, activeAgentCount: 3, taskId: "task_01JZ8Q3N4K" }),
});
export const Speaking = story("Speaking", { snapshot: snap("speaking", { audioLevel: 0.55 }), settings: { audioFixture: "tts" } });
export const SpeakingWithThreeAgentsWorking = story("Speaking + 3 agents working", {
  snapshot: snap(
    "speaking",
    { audioLevel: 0.55, activityText: "3 AGENTEN AKTIV", progressMode: "determinate", progress: 0.62 },
    { work: "working", activeAgentIds: ["agent_1", "agent_2", "agent_3"] },
  ),
  settings: { audioFixture: "tts" },
});
export const WaitingApproval = story("Waiting Approval", {
  snapshot: snap("waiting_approval", { activityText: "E-MAIL-ENTWURF FREIGEBEN", approvalId: "appr_01JZ8Q3N4K", urgency: "warning" }),
});
export const Success = story("Success", { snapshot: snap("success", { progress: 1, progressMode: "determinate" }) });
export const Warning = story("Warning", { snapshot: snap("warning", { activityText: "EINZELNE QUELLEN VERZÖGERT", urgency: "warning", health: "degraded" }, { health: "degraded" }) });
export const ErrorState = story("Error", { snapshot: snap("error", { activityText: "ADAPTER NICHT ERREICHBAR", urgency: "critical" }) });
export const Offline = story("Offline", { snapshot: snap("offline") });
export const Paused = story("Paused", { snapshot: snap("paused") });
export const ReducedMotion = story("Reduced Motion", {
  snapshot: snap("working", { activityText: "RECHERCHE LÄUFT", progressMode: "determinate", progress: 0.62, activeAgentCount: 3 }),
  settings: { animations: "reduced" },
});
export const LowQuality = story("Low Quality", {
  snapshot: snap("working", { activityText: "RECHERCHE LÄUFT", progressMode: "indeterminate", activeAgentCount: 2 }),
  settings: { quality: "low" },
});
export const Fallback2D = story("2D Fallback", {
  snapshot: snap("working", { activityText: "RECHERCHE LÄUFT", progressMode: "determinate", progress: 0.62, activeAgentCount: 3 }),
  settings: { renderer: "2d" },
});
export const LargeWithPerfOverlay = story("Large + perf overlay (dev)", {
  snapshot: snap("working", { activityText: "RECHERCHE LÄUFT", progressMode: "determinate", progress: 0.62, activeAgentCount: 3 }),
  width: 900,
  height: 700,
  showPerf: true,
});
