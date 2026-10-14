import type { Agent, OrbHealth, OrbLayers, OrbMode, OrbSnapshot, OrbStatus, OrbUrgency, Task } from "@jarvis/sdk";
import { CATEGORY_LABEL } from "../core/constants";
import { priorityRank } from "../core/util";
import type { WorldState } from "./state";

export interface OrbSource {
  state: WorldState;
  clock: { now(): number };
}

/** Default German status line per mode (PLAN §19). */
export const ORB_TEXT: Readonly<Record<OrbMode, string>> = {
  booting: "JARVIS WIRD INITIALISIERT",
  idle: "BEREIT",
  listening: "ICH HÖRE ZU",
  transcribing: "SPRACHE WIRD VERARBEITET",
  thinking: "ANALYSE",
  syncing: "SYNCHRONISIERUNG LÄUFT",
  working: "ARBEIT LÄUFT",
  speaking: "JARVIS SPRICHT",
  waiting_approval: "FREIGABE ERFORDERLICH",
  success: "ABGESCHLOSSEN",
  warning: "EINGESCHRÄNKTER BETRIEB",
  error: "FEHLER",
  offline: "OFFLINE",
  paused: "PAUSIERT",
};

const SYNC_TEXT: Record<string, string> = {
  mail: "MAILS WERDEN AKTUALISIERT",
  calendar: "KALENDER WIRD SYNCHRONISIERT",
  hermes: "HERMES-STATUS WIRD GELADEN",
  files: "DATEIEN WERDEN INDIZIERT",
  memory: "GEDÄCHTNIS WIRD ABGEGLICHEN",
  other: "DATEN WERDEN SYNCHRONISIERT",
};

const MAX_LAYER_AGENTS = 24;

export function computeHealth(state: WorldState): OrbHealth {
  const adapters = state.adapters.filter((adapter) => adapter.enabled);
  if (adapters.length > 0 && adapters.every((adapter) => adapter.mode === "offline")) return "offline";
  if (adapters.some((adapter) => adapter.mode !== "online")) return "degraded";
  return "online";
}

function agentActivityText(agent: Agent | undefined, task: Task | undefined): string {
  if (task && /präsentation/i.test(task.title)) return "PRÄSENTATION WIRD ERSTELLT";
  const role = (agent?.role ?? "").toLowerCase();
  if (role.includes("recherche")) return "RECHERCHE LÄUFT";
  if (role.includes("softwareentwicklung")) return "CODE WIRD ERSTELLT";
  if (role.includes("mail")) return "NACHRICHTEN WERDEN BEARBEITET";
  if (role.includes("termin")) return "KALENDER WIRD OPTIMIERT";
  if (role.includes("system")) return "SYSTEMWARTUNG LÄUFT";
  if (role.includes("gedächtnis")) return "GEDÄCHTNIS WIRD GEPFLEGT";
  if (role.includes("browser")) return "BROWSER-AUFGABE LÄUFT";
  if (role.includes("planung")) return "AUFGABE WIRD GEPLANT";
  return task ? "AUFGABE LÄUFT" : ORB_TEXT.working;
}

function layersForForced(mode: OrbMode, health: OrbHealth, activeAgentIds: string[]): OrbLayers {
  const voice: OrbLayers["voice"] =
    mode === "listening" ? "listening" : mode === "transcribing" ? "transcribing" : mode === "speaking" ? "speaking" : "idle";
  const work: OrbLayers["work"] =
    mode === "thinking" ? "thinking" : mode === "working" ? "working" : mode === "syncing" ? "syncing" : mode === "paused" ? "paused" : "idle";
  const attention: OrbLayers["attention"] =
    mode === "waiting_approval" ? "waiting_approval" : mode === "success" ? "success" : mode === "warning" ? "warning" : mode === "error" ? "error" : "none";
  return { voice, work, attention, health: mode === "offline" ? "offline" : health, activeAgentIds };
}

/**
 * Derives the semantic orb state from the world (PLAN §17/§18.3). Priority:
 * error > offline > waiting_approval > listening/speaking > transcribing/thinking > success > working/syncing >
 * paused > warning > idle. Lower-priority context stays visible in `detailText` and the parallel `layers`.
 * Progress is only reported when a task really has it; otherwise the mode is indeterminate.
 */
export function deriveOrbSnapshot(source: OrbSource, since?: string): OrbSnapshot {
  const { state } = source;
  const now = source.clock.now();
  const nowIso = new Date(now).toISOString();
  const health = computeHealth(state);

  const workingAgents = state.agents.filter((agent) => agent.status === "working");
  const runningTasks = state.tasks.filter((task) => task.status === "running");
  const pendingApprovals = state.approvals
    .filter((approval) => approval.status === "pending" && (approval.expiresAt === null || Date.parse(approval.expiresAt) > now))
    .sort((a, b) => (a.expiresAt ?? "9").localeCompare(b.expiresAt ?? "9"));
  const criticalOpen = state.notifications.filter((n) => n.priority === "P0" && n.status === "open");
  const urgentOpen = state.notifications.filter((n) => n.priority === "P1" && n.status === "open");
  const voiceMode = state.voice.status.mode;
  const transient = state.transientOrb && state.transientOrb.until > now ? state.transientOrb : null;
  const degradedAdapters = state.adapters.filter((adapter) => adapter.mode !== "online");

  const focusTask = [...runningTasks].sort(
    (a, b) => priorityRank(a.priority) - priorityRank(b.priority) || (a.startedAt ?? "").localeCompare(b.startedAt ?? "") || a.id.localeCompare(b.id),
  )[0];
  const focusAgent = (focusTask?.agentId ? state.agents.find((agent) => agent.id === focusTask.agentId) : undefined) ?? workingAgents[0];
  const activeAgentIds = workingAgents.slice(0, MAX_LAYER_AGENTS).map((agent) => agent.id);

  const layers: OrbLayers = {
    voice: voiceMode === "listening" || voiceMode === "transcribing" || voiceMode === "speaking" ? voiceMode : "idle",
    work: state.globalPaused
      ? "paused"
      : voiceMode === "thinking" || transient?.mode === "thinking"
        ? "thinking"
        : workingAgents.length > 0 || runningTasks.length > 0
          ? "working"
          : state.sync.length > 0
            ? "syncing"
            : "idle",
    attention:
      criticalOpen.length > 0 || voiceMode === "error"
        ? "error"
        : pendingApprovals.length > 0
          ? "waiting_approval"
          : transient?.mode === "success"
            ? "success"
            : urgentOpen.length > 0 || health !== "online"
              ? "warning"
              : "none",
    health,
    activeAgentIds,
  };

  const status = (partial: Omit<OrbStatus, "since" | "health" | "activeAgentCount">): OrbStatus => ({
    ...partial,
    health,
    activeAgentCount: workingAgents.length,
    ...(focusAgent && partial.mode !== "idle" ? { currentAgentId: focusAgent.id } : {}),
    since: since ?? nowIso,
  });

  const contextBits: string[] = [];
  if (workingAgents.length > 0) contextBits.push(`${workingAgents.length} ${workingAgents.length === 1 ? "Agent arbeitet" : "Agenten arbeiten"}`);
  if (pendingApprovals.length > 0) contextBits.push(`${pendingApprovals.length} Freigabe${pendingApprovals.length === 1 ? "" : "n"} offen`);
  if (degradedAdapters.length > 0) {
    contextBits.push(degradedAdapters.map((adapter) => `${CATEGORY_LABEL[adapter.category]} ${adapter.mode === "offline" ? "offline" : "eingeschränkt"}`).join(", "));
  }

  // forced (dev) state wins over everything
  if (state.forcedOrb) {
    const forced = state.forcedOrb;
    const progress = forced.progress ?? null;
    return {
      status: status({
        mode: forced.mode,
        activityText: forced.activityText ?? ORB_TEXT[forced.mode],
        detailText: "Dev-Override aktiv",
        progress,
        progressMode: progress === null ? (forced.mode === "working" || forced.mode === "syncing" ? "indeterminate" : "none") : "determinate",
        ...(forced.audioLevel !== undefined ? { audioLevel: forced.audioLevel } : {}),
        urgency: forced.mode === "error" || forced.mode === "offline" ? "critical" : forced.mode === "warning" ? "warning" : forced.mode === "waiting_approval" ? "info" : "none",
      }),
      layers: layersForForced(forced.mode, health, activeAgentIds),
    };
  }

  const done = (mode: OrbMode, extra: Partial<OrbStatus> = {}): OrbSnapshot => ({
    status: status({
      mode,
      activityText: ORB_TEXT[mode],
      progress: null,
      progressMode: "none",
      urgency: "none",
      ...extra,
    }),
    layers,
  });

  if (transient?.mode === "booting") {
    return done("booting", { activityText: transient.activityText, progressMode: "indeterminate" });
  }
  if (criticalOpen.length > 0) {
    const top = criticalOpen[0]!;
    return done("error", { detailText: [top.title, ...contextBits].join(" · "), urgency: "critical" });
  }
  if (voiceMode === "error") {
    return done("error", { detailText: ["Sprachpipeline meldet einen Fehler", ...contextBits].join(" · "), urgency: "critical" });
  }
  if (health === "offline") {
    return done("offline", { detailText: "Alle Adapter nicht erreichbar, Daten stammen aus dem Cache", urgency: "critical" });
  }
  if (pendingApprovals.length > 0) {
    const top = pendingApprovals[0]!;
    const minutesLeft = top.expiresAt ? Math.max(0, Math.round((Date.parse(top.expiresAt) - now) / 60_000)) : null;
    const details = [top.action];
    if (minutesLeft !== null) details.push(`läuft in ${minutesLeft} Min. ab`);
    if (pendingApprovals.length > 1) details.push(`${pendingApprovals.length} Freigaben offen`);
    if (workingAgents.length > 0) details.push(`${workingAgents.length} ${workingAgents.length === 1 ? "Agent arbeitet" : "Agenten arbeiten"} weiter`);
    return done("waiting_approval", {
      detailText: details.join(" · "),
      approvalId: top.id,
      urgency: pendingApprovals.some((a) => a.riskTier === 3) || (minutesLeft !== null && minutesLeft < 15) ? "warning" : "info",
      ...(top.taskId ? { taskId: top.taskId } : {}),
    });
  }
  if (voiceMode === "listening" || voiceMode === "speaking") {
    return done(voiceMode, {
      audioLevel: state.audioLevel,
      ...(contextBits.length ? { detailText: contextBits.join(" · ") } : {}),
    });
  }
  if (voiceMode === "transcribing") return done("transcribing", contextBits.length ? { detailText: contextBits.join(" · ") } : {});
  if (voiceMode === "thinking" || transient?.mode === "thinking") {
    return done("thinking", {
      ...(transient?.detailText ? { detailText: transient.detailText } : contextBits.length ? { detailText: contextBits.join(" · ") } : {}),
    });
  }
  if (transient?.mode === "success") {
    return done("success", { activityText: transient.activityText, ...(transient.detailText ? { detailText: transient.detailText } : {}) });
  }
  if (workingAgents.length > 0 || runningTasks.length > 0) {
    const determinate = focusTask?.progress.mode === "determinate" && typeof focusTask.progress.value === "number";
    const text = workingAgents.length > 1 ? `${workingAgents.length} AGENTEN AKTIV` : agentActivityText(focusAgent, focusTask);
    const details = [focusTask ? `${focusTask.title}${focusAgent ? ` · ${focusAgent.name}` : ""}` : null, runningTasks.length > 1 ? `${runningTasks.length} Aufgaben laufen` : null].filter(Boolean);
    if (degradedAdapters.length > 0) details.push(contextBits[contextBits.length - 1] as string);
    return done("working", {
      activityText: text,
      detailText: details.join(" · "),
      progress: determinate ? (focusTask?.progress.value ?? null) : null,
      progressMode: determinate ? "determinate" : "indeterminate",
      urgency: degradedAdapters.length > 0 ? "warning" : "none",
      ...(focusTask ? { taskId: focusTask.id } : {}),
    });
  }
  if (state.sync.length > 0) {
    const first = state.sync[0]!;
    const text = state.sync.length === 1 ? (SYNC_TEXT[first.source] ?? SYNC_TEXT.other!) : `${state.sync.length} QUELLEN WERDEN SYNCHRONISIERT`;
    return done("syncing", {
      activityText: text,
      detailText: state.sync.map((job) => job.label).join(" · "),
      progressMode: "indeterminate",
      urgency: "none",
    });
  }
  if (state.globalPaused) return done("paused", { detailText: "Alle Agenten und Aufgaben wurden angehalten" });
  if (urgentOpen.length > 0 || health === "degraded") {
    const urgency: OrbUrgency = "warning";
    return done("warning", {
      urgency,
      detailText: [urgentOpen[0]?.title, degradedAdapters.length ? contextBits[contextBits.length - 1] : undefined].filter(Boolean).join(" · "),
    });
  }
  return done("idle", {});
}
