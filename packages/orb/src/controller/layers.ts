import type { OrbHealth, OrbLayers, OrbSnapshot, OrbStatus } from "../contract-types";
import { arbitrateOrbState, type OrbInternalLayers } from "../machine/orbMachine";
import type { OrbLayerState, OrbMode, OrbProgressMode, OrbRuntimeStatus, PrimaryInteraction } from "./types";

/** Attention items that can be active at the same time (the machine's single `attention` value ranks them). */
export interface AttentionFlags {
  approval: boolean;
  warning: boolean;
  error: boolean;
}

export const EMPTY_LAYERS: OrbLayerState = {
  primaryInteraction: "idle",
  backgroundWork: "idle",
  systemHealth: { connectivity: "online", health: "online", attention: "none" },
  approval: { pending: false, count: 0 },
};

export function attentionFlags(layers: OrbLayerState): AttentionFlags {
  const sys = layers.systemHealth;
  return {
    approval: layers.approval.pending,
    error: sys.attention === "error",
    warning: sys.attention === "warning" || sys.health === "degraded",
  };
}

/** Synthetic ids so the machine-style layer model can carry an agent count (ids are never shown). */
export function agentIds(count: number): string[] {
  return Array.from({ length: Math.max(0, Math.round(count)) }, (_, i) => `agent_${i + 1}`);
}

/** Controller layers -> the machine's internal layer model (only used for arbitration and the visual derivation). */
export function toMachineLayers(layers: OrbLayerState, agentCount: number): { layers: OrbInternalLayers; flashSuccess: boolean } {
  const flags = attentionFlags(layers);
  const sys = layers.systemHealth;
  return {
    flashSuccess: sys.attention === "success",
    layers: {
      connectivity: sys.connectivity,
      health: sys.health === "unknown" ? "online" : sys.health,
      voice: layers.primaryInteraction,
      work: layers.backgroundWork,
      attention: flags.error ? "error" : flags.approval ? "approval" : flags.warning ? "warning" : "none",
      activeAgentIds: agentIds(agentCount),
    },
  };
}

/**
 * Owner priority (order section 7): critical error > offline > waiting approval > listening > speaking > transcribing >
 * thinking > working > syncing > idle. `booting`, `paused`, `success` and `warning` rank as documented in ORB_SPECIFICATION §4.
 */
export function arbitrateLayers(layers: OrbLayerState, agentCount: number): OrbMode {
  return arbitrateOrbState(toMachineLayers(layers, agentCount));
}

/** The layer model that renders exactly `mode` (explicit override from the debug panel, demos and tests). */
export function layersForMode(mode: OrbMode, agentCount = 0): OrbLayerState {
  const base: OrbLayerState = {
    primaryInteraction: "idle",
    backgroundWork: "idle",
    systemHealth: { connectivity: "online", health: "online", attention: "none" },
    approval: { pending: false, count: 0 },
  };
  const parallelWork = agentCount > 0 ? "working" : "idle";
  switch (mode) {
    case "booting":
      return { ...base, systemHealth: { ...base.systemHealth, connectivity: "booting" } };
    case "offline":
      return { ...base, systemHealth: { connectivity: "offline", health: "offline", attention: "none" } };
    case "paused":
      return { ...base, systemHealth: { ...base.systemHealth, connectivity: "paused" } };
    case "listening":
    case "transcribing":
    case "thinking":
    case "speaking":
      return { ...base, primaryInteraction: mode, backgroundWork: parallelWork };
    case "syncing":
      return { ...base, backgroundWork: "syncing" };
    case "working":
      return { ...base, backgroundWork: "working" };
    case "waiting_approval":
      return { ...base, approval: { pending: true, count: 1 } };
    case "success":
      return { ...base, systemHealth: { ...base.systemHealth, attention: "success" } };
    case "warning":
      return { ...base, systemHealth: { connectivity: "online", health: "degraded", attention: "warning" } };
    case "error":
      return { ...base, systemHealth: { ...base.systemHealth, attention: "error" } };
    case "idle":
      return base;
  }
}

/** Wire-shaped layers for the HTML layer (labels, aria sentence). `thinking`/`paused` fold into `work` like the contract. */
export function toWireLayers(layers: OrbLayerState, agentCount: number): OrbLayers {
  const p: PrimaryInteraction = layers.primaryInteraction;
  const sys = layers.systemHealth;
  const flags = attentionFlags(layers);
  const health: OrbHealth = sys.connectivity === "offline" || sys.health === "offline" ? "offline" : flags.warning && sys.health !== "degraded" ? "degraded" : sys.health === "degraded" ? "degraded" : "online";
  return {
    voice: p === "listening" || p === "transcribing" || p === "speaking" ? p : "idle",
    work: sys.connectivity === "paused" ? "paused" : p === "thinking" && layers.backgroundWork === "idle" ? "thinking" : layers.backgroundWork,
    attention: flags.error ? "error" : flags.approval ? "waiting_approval" : sys.attention === "success" ? "success" : flags.warning ? "warning" : "none",
    health,
    activeAgentIds: agentIds(agentCount),
  };
}

/** Wire status for the HTML layer / tooltip / activation target. `since` is an ISO string on the wire. */
export function toWireStatus(status: OrbRuntimeStatus, extra: { approvalId?: string; health: OrbHealth }): OrbStatus {
  const out: OrbStatus = {
    mode: status.mode,
    progressMode: status.progressMode as OrbProgressMode,
    audioLevel: Math.max(status.inputAudioLevel, status.outputAudioLevel),
    health: extra.health,
    activeAgentCount: status.activeAgentCount ?? 0,
    since: new Date(status.since).toISOString(),
  };
  if (status.activityText !== undefined) out.activityText = status.activityText;
  if (status.detailText !== undefined) out.detailText = status.detailText;
  if (status.progress !== undefined) out.progress = status.progress;
  if (status.currentAgentName !== undefined) out.currentAgentId = status.currentAgentName;
  if (status.currentTaskId !== undefined) out.taskId = status.currentTaskId;
  if (extra.approvalId !== undefined) out.approvalId = extra.approvalId;
  if (status.severity === "critical" || status.severity === "warning") out.urgency = status.severity;
  return out;
}

export type { OrbSnapshot };
