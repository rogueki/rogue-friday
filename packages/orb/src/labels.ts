import type { OrbLayers, OrbMode, OrbStatus } from "./contract-types";

export interface OrbLabels {
  states: Record<OrbMode, string>;
  /** Tooltip field names (PLAN §21 hover). */
  tooltip: { state: string; action: string; runtime: string; agent: string; task: string; source: string; none: string };
  hitTarget: string;
  agentsActive: (n: number) => string;
  agentsShort: (n: number) => string;
  micActive: string;
  paused: string;
  approval: string;
  /** Sentence fragments for the aria-live announcement. */
  aria: {
    modes: Record<OrbMode, string>;
    task: string;
    agents: (n: number) => string;
    progress: (percent: number) => string;
    degraded: string;
    detail: string;
  };
}

const GERMAN_NUMBERS = ["Null", "Ein", "Zwei", "Drei", "Vier", "Fünf", "Sechs", "Sieben", "Acht", "Neun", "Zehn"];

export const ORB_LABELS_DE: OrbLabels = {
  states: {
    booting: "JARVIS WIRD INITIALISIERT",
    idle: "BEREIT",
    listening: "ICH HÖRE ZU",
    transcribing: "SPRACHE WIRD VERARBEITET",
    thinking: "ANALYSE",
    syncing: "SYNCHRONISIERUNG",
    working: "ARBEIT LÄUFT",
    speaking: "JARVIS SPRICHT",
    waiting_approval: "FREIGABE ERFORDERLICH",
    success: "ERLEDIGT",
    warning: "EINGESCHRÄNKTER BETRIEB",
    error: "FEHLER",
    offline: "OFFLINE",
    paused: "PAUSIERT",
  },
  tooltip: {
    state: "Zustand",
    action: "Aktion",
    runtime: "Laufzeit",
    agent: "Agent",
    task: "Task-ID",
    source: "Quelle",
    none: "–",
  },
  hitTarget: "Orb: Details öffnen",
  agentsActive: (n) => `${n} ${n === 1 ? "AGENT" : "AGENTEN"} AKTIV`,
  agentsShort: (n) => `${n} ${n === 1 ? "AGENT" : "AGENTEN"}`,
  micActive: "Mikrofon aktiv",
  paused: "Pausiert",
  approval: "Freigabe erforderlich",
  aria: {
    modes: {
      booting: "Jarvis wird initialisiert.",
      idle: "Jarvis ist bereit.",
      listening: "Jarvis hört zu.",
      transcribing: "Jarvis verarbeitet Sprache.",
      thinking: "Jarvis analysiert.",
      syncing: "Jarvis synchronisiert.",
      working: "Jarvis arbeitet.",
      speaking: "Jarvis spricht.",
      waiting_approval: "Freigabe erforderlich.",
      success: "Aufgabe abgeschlossen.",
      warning: "Eingeschränkter Betrieb.",
      error: "Fehler aufgetreten.",
      offline: "Jarvis ist offline.",
      paused: "Jarvis ist pausiert.",
    },
    task: "Aufgabe",
    agents: (n) => `${n === 1 ? "Ein Agent" : `${GERMAN_NUMBERS[n] ?? n} Agenten`} aktiv.`,
    progress: (p) => `Fortschritt ${p} Prozent.`,
    degraded: "Systemzustand eingeschränkt.",
    detail: "Details",
  },
};

export const ORB_LABELS_EN: OrbLabels = {
  states: {
    booting: "JARVIS INITIALISING",
    idle: "READY",
    listening: "LISTENING",
    transcribing: "PROCESSING SPEECH",
    thinking: "ANALYSING",
    syncing: "SYNCING",
    working: "WORKING",
    speaking: "JARVIS SPEAKING",
    waiting_approval: "APPROVAL REQUIRED",
    success: "DONE",
    warning: "DEGRADED OPERATION",
    error: "ERROR",
    offline: "OFFLINE",
    paused: "PAUSED",
  },
  tooltip: { state: "State", action: "Action", runtime: "Runtime", agent: "Agent", task: "Task ID", source: "Source", none: "–" },
  hitTarget: "Orb: open details",
  agentsActive: (n) => `${n} ${n === 1 ? "AGENT" : "AGENTS"} ACTIVE`,
  agentsShort: (n) => `${n} ${n === 1 ? "AGENT" : "AGENTS"}`,
  micActive: "Microphone active",
  paused: "Paused",
  approval: "Approval required",
  aria: {
    modes: {
      booting: "Jarvis is initialising.",
      idle: "Jarvis is ready.",
      listening: "Jarvis is listening.",
      transcribing: "Jarvis is processing speech.",
      thinking: "Jarvis is analysing.",
      syncing: "Jarvis is syncing.",
      working: "Jarvis is working.",
      speaking: "Jarvis is speaking.",
      waiting_approval: "Approval required.",
      success: "Task completed.",
      warning: "Degraded operation.",
      error: "An error occurred.",
      offline: "Jarvis is offline.",
      paused: "Jarvis is paused.",
    },
    task: "Task",
    agents: (n) => `${n} ${n === 1 ? "agent" : "agents"} active.`,
    progress: (p) => `Progress ${p} percent.`,
    degraded: "System health degraded.",
    detail: "Details",
  },
};

/** Normalises user supplied partial labels over the German defaults. */
export function resolveLabels(partial?: Partial<OrbLabels>): OrbLabels {
  if (!partial) return ORB_LABELS_DE;
  return {
    ...ORB_LABELS_DE,
    ...partial,
    states: { ...ORB_LABELS_DE.states, ...partial.states },
    tooltip: { ...ORB_LABELS_DE.tooltip, ...partial.tooltip },
    aria: { ...ORB_LABELS_DE.aria, ...partial.aria, modes: { ...ORB_LABELS_DE.aria.modes, ...partial.aria?.modes } },
  };
}

const TASK_MODES: readonly OrbMode[] = ["working", "syncing", "thinking"];

/** Screen reader sentence (PLAN §21): "Jarvis arbeitet. Aufgabe Wettbewerbsanalyse. Drei Agenten aktiv. Fortschritt 62 Prozent." */
export function buildAriaSentence(status: OrbStatus, layers: OrbLayers | undefined, labels: OrbLabels = ORB_LABELS_DE): string {
  const parts: string[] = [labels.aria.modes[status.mode]];
  const text = status.activityText?.trim();
  if (text) parts.push(TASK_MODES.includes(status.mode) ? `${labels.aria.task} ${text}.` : `${text}.`);
  const agents = layers?.activeAgentIds.length ?? status.activeAgentCount ?? 0;
  if (agents > 0) parts.push(labels.aria.agents(agents));
  const mode = status.progressMode ?? (status.progress == null ? "none" : "determinate");
  if (mode === "determinate" && status.progress != null) {
    const f = status.progress > 1 ? status.progress / 100 : status.progress;
    parts.push(labels.aria.progress(Math.round(Math.min(1, Math.max(0, f)) * 100)));
  }
  if ((layers?.health ?? status.health) === "degraded") parts.push(labels.aria.degraded);
  return parts.join(" ");
}

export type OrbActivationTarget =
  | { kind: "approval"; approvalId?: string }
  | { kind: "error" }
  | { kind: "task"; taskId: string }
  | { kind: "activity" }
  | { kind: "command" };

/** Click/Enter target by mode (PLAN §21): approval -> approval detail, error -> error detail, working -> task, idle -> command bar. */
export function activationTarget(status: OrbStatus): OrbActivationTarget {
  switch (status.mode) {
    case "waiting_approval":
      return { kind: "approval", approvalId: status.approvalId };
    case "error":
      return { kind: "error" };
    case "working":
      return status.taskId ? { kind: "task", taskId: status.taskId } : { kind: "activity" };
    case "idle":
      return { kind: "command" };
    default:
      return { kind: "activity" };
  }
}

/** "2m 14s" style runtime since an ISO timestamp. */
export function formatRuntime(sinceIso: string, now: number = Date.now()): string {
  const start = Date.parse(sinceIso);
  if (Number.isNaN(start)) return "";
  const s = Math.max(0, Math.floor((now - start) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
