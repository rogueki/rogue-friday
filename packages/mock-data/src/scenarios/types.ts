import type { AdapterCategory, ApprovalType, FridayEventType, OrbMode, Priority, Task } from "@friday/sdk";
import type { ProfileName, AdapterMode } from "../world/state";
import type { AudioFixture } from "./fixtures";
import type { VoiceMode } from "../world/services/voice";

/** Declarative world actions; scenario steps are plain data so they can be documented, diffed and replayed. */
export type ScenarioAction =
  | { kind: "world.quiesce" }
  | { kind: "orb.force"; mode: OrbMode | null; activityText?: string; audioLevel?: number; progress?: number | null }
  | { kind: "orb.transient"; mode: OrbMode; durationMs: number; text: string; detail?: string }
  | { kind: "voice.mode"; mode: VoiceMode; text?: string }
  | { kind: "voice.audio"; fixture: AudioFixture; durationMs: number; direction: "input" | "output" }
  | { kind: "voice.transcript"; text: string; final: boolean }
  | { kind: "agent.status"; agent: string; status: "idle" | "working" | "waiting" | "paused" | "error" | "offline"; task?: string; error?: string }
  | { kind: "task.spawn"; ref: string; title: string; agent?: string; status?: Task["status"]; priority?: Priority; progress?: number | null; steps?: string[] }
  | { kind: "task.progress"; ref: string; value: number | null; message?: string }
  | { kind: "task.complete"; ref: string }
  | { kind: "task.fail"; ref: string; message: string }
  | { kind: "sync.start"; ref: string; source: "mail" | "calendar" | "hermes" | "files" | "memory" | "other"; label: string }
  | { kind: "sync.finish"; ref: string }
  | { kind: "approval.draft"; ref: string; threadKey: "becker" | "albrecht"; agent?: string }
  | { kind: "approval.raise"; ref: string; type: ApprovalType; action: string; riskTier: 1 | 2 | 3; agent?: string; rationale: string; previewTitle: string; previewBody: string }
  | { kind: "notification.raise"; ref: string; priority: Priority; category: "system" | "task" | "approval" | "mail" | "calendar" | "automation" | "security" | "voice" | "adapter"; title: string; body: string; chain?: ("dashboard" | "telegram" | "whatsapp" | "sms" | "phone" | "email")[]; stepSeconds?: number[] }
  | { kind: "notification.ack"; ref: string }
  | { kind: "adapter.state"; category: AdapterCategory; mode: AdapterMode; reason?: string }
  | { kind: "service.status"; name: string; status: "online" | "degraded" | "offline"; detail?: string }
  | { kind: "ui.hint"; key: "forceOrbFallback2D" | "reducedMotion"; value: boolean }
  | { kind: "mail.receive"; subject: string; from: { name: string; address: string }; body: string; priority?: Priority; summary?: string }
  | { kind: "activity.log"; title: string; activityKind?: "adapter" | "system" | "tool_call" | "source_read"; adapterId?: string; severity?: "info" | "warning" | "error" }
  | { kind: "activity.burst"; count: number; intervalMs: number; title: string }
  | { kind: "system.metrics" }
  | { kind: "event.emit"; type: FridayEventType; subject?: string; data: unknown };

export interface ScenarioStepDef {
  /** Offset in ms from the start of the scenario on the mock clock. */
  at: number;
  label: string;
  description?: string;
  /** Orb mode expected after this step's actions have run (checked by the test suite). */
  orbMode?: OrbMode;
  actions: ScenarioAction[];
}

export interface ScenarioDefinition {
  id: string;
  name: string;
  description: string;
  profile: ProfileName;
  /** `quiet` removes pending approvals, alerts and running work first; `seeded` keeps the profile as generated. */
  baseline: "quiet" | "seeded";
  steps: ScenarioStepDef[];
  /** Orb mode sequence the scenario must produce (consecutive duplicates collapsed, initial mode included). */
  expectedOrbModes: OrbMode[];
  /** What the UI is expected to show; rendered into docs/MOCK_SCENARIOS.md. */
  uiExpectations: string[];
  uiHints?: { forceOrbFallback2D?: boolean; reducedMotion?: boolean };
  notes?: string[];
}
