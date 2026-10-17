import type { OrbMode, OrbSnapshot } from "../contract-types";

export type { OrbMode };
import type { OrbEventBridge } from "../bridge/OrbEventBridge";

/**
 * Client runtime model of the orb (owner order sections 6 and 7). The wire form (`OrbStatus` of `@friday/sdk`) stays
 * untouched; the controller is the ephemeral, typed state the scene and the HTML layer are driven from.
 */
export type OrbProgressMode = "none" | "determinate" | "indeterminate";
export type OrbSeverity = "none" | "info" | "warning" | "critical";

/** Client runtime form of the status (wire form = contract OrbStatus). Ephemeral, never put into React state. */
export interface OrbRuntimeStatus {
  mode: OrbMode;
  activityText?: string;
  detailText?: string;
  inputAudioLevel: number; // 0..1, smoothed, gated (value at the last low-rate publication)
  outputAudioLevel: number; // 0..1, smoothed (value at the last low-rate publication)
  progress?: number | null; // 0..1, only meaningful for progressMode "determinate"
  progressMode: OrbProgressMode;
  activeAgentCount?: number;
  currentAgentName?: string;
  currentTaskId?: string;
  severity?: OrbSeverity;
  since: number; // epoch ms of the last mode change
  /** True when the current primary phase was derived heuristically (not reported by a real event). */
  derived?: boolean;
}

export type PrimaryInteraction = "idle" | "listening" | "transcribing" | "thinking" | "speaking";
export type BackgroundWork = "idle" | "syncing" | "working";
export interface SystemHealthState {
  connectivity: "booting" | "online" | "offline" | "paused";
  health: "online" | "degraded" | "offline" | "unknown";
  attention: "none" | "warning" | "error" | "success";
  message?: string;
}
export interface ApprovalState {
  pending: boolean;
  count: number;
  approvalId?: string;
}
export interface OrbLayerState {
  primaryInteraction: PrimaryInteraction;
  backgroundWork: BackgroundWork;
  systemHealth: SystemHealthState;
  approval: ApprovalState;
}

export type OrbAudioSourceKind = "none" | "analyser" | "service-level" | "synthetic";
/** One analysed audio frame; the object is owned by the caller and refilled in place (no per-frame allocation). */
export interface OrbAudioFrame {
  rms: number;
  peak: number;
  low: number;
  mid: number;
  high: number; // all 0..1, normalised + noise-gated
  gateOpen: boolean; // voice present (hysteresis)
  source: OrbAudioSourceKind;
  /** True when low/mid/high were derived from a scalar level (service level without bands). */
  bandsDerived?: boolean;
}
export interface OrbAudioFrameSource {
  /** Called at most once per rendered frame from the orb's animation loop. Must not allocate or throw. */
  sample(nowMs: number, out: OrbAudioFrame): void;
  dispose(): void;
}

/**
 * Level facts as they arrive from services: a bare scalar or an object with optional band fields
 * (`friday.voice.audio_level` with `level` and optional `low/mid/high/peak`). `OrbAudioFrame` is assignable.
 */
export interface OrbAudioLevels {
  rms?: number;
  level?: number;
  peak?: number;
  low?: number;
  mid?: number;
  high?: number;
}

export interface OrbControllerState {
  readonly version: number; // increments on every low-rate state change
  readonly status: OrbRuntimeStatus; // audio levels here are the last published values (<= 10 Hz), not per-frame
  readonly layers: OrbLayerState;
  readonly overrideMode: OrbMode | null; // set by setMode (debug/demo), cleared by reset()
}

/** What the scene reads each frame; one preallocated instance per orb. */
export interface OrbFrameInputs {
  input: OrbAudioFrame;
  output: OrbAudioFrame;
  speechEnvelopeActive: boolean;
}

export interface OrbController {
  getState(): OrbControllerState; // stable reference between changes
  subscribe(listener: (state: OrbControllerState) => void): () => void; // low-rate only (useSyncExternalStore)
  /** Per-frame read for the scene (no React): fills `inputs` in place. */
  readFrame(nowMs: number, inputs: OrbFrameInputs): void;

  setMode(mode: OrbMode, options?: { activityText?: string; detailText?: string }): void; // explicit override (debug, demo, tests)
  setInputAudioLevel(level: number): void; // scalar convenience; becomes a "service-level" frame
  setOutputAudioLevel(level: number): void;
  setInputAudioSource(source: OrbAudioFrameSource | null): void; // analyser or synthetic source (replaces scalar)
  setOutputAudioSource(source: OrbAudioFrameSource | null): void;
  setProgress(progress: number | null, mode?: OrbProgressMode): void;
  setActivity(activityText?: string, detailText?: string): void;
  setAgentCount(count: number, names?: readonly string[]): void;
  setApproval(approval: { approvalId?: string; count?: number } | null): void;
  setSystemHealth(patch: Partial<SystemHealthState>): void;
  applySnapshot(snapshot: OrbSnapshot): void; // server truth for work/approval/health/attention
  reset(): void;
  dispose(): void;
  readonly bridge: OrbEventBridge;
}

export interface CreateOrbControllerOptions {
  now?: () => number; // test clock (monotonic ms, same base as `readFrame(nowMs)`)
  seed?: number; // deterministic envelopes / demo
  leaseMs?: number; // default 1500: local voice facts expire without refresh
  /** Epoch clock for `status.since` (default Date.now). */
  epochNow?: () => number;
  /** Initial connectivity (default "online"; "booting" plays the boot reveal until a snapshot arrives). */
  initialConnectivity?: "booting" | "online";
}
