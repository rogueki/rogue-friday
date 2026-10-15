import { assign, createActor, setup, type SnapshotFrom } from "xstate";
import type { OrbHealth, OrbLayers, OrbMode, OrbSnapshot, OrbStatus } from "../contract-types";

export const SUCCESS_FLASH_MS = 1500;

export interface OrbMachineContext {
  /** Mirror of the active state node of every region; written by state entry actions. */
  layers: OrbInternalLayers;
  flashSuccess: boolean;
  healthReported: "online" | "degraded";
  activeTaskIds: string[];
  voiceActive: boolean;
  syncPending: boolean;
  approvalId?: string;
  warningActive: boolean;
  errorActive: boolean;
  activityText?: string;
  detailText?: string;
  progress: number | null;
  progressMode: "determinate" | "indeterminate" | "none";
  audioLevel: number;
  urgency: "none" | "info" | "warning" | "critical";
  currentAgentId?: string;
  taskId?: string;
  since: string;
  sourceEventId?: string;
}

export type OrbMachineEvent =
  | { type: "SYSTEM_BOOT" }
  | { type: "SYSTEM_READY" }
  | { type: "MIC_OPENED" }
  | { type: "MIC_CLOSED" }
  | { type: "VOICE_ACTIVITY_STARTED" }
  | { type: "VOICE_ACTIVITY_ENDED" }
  | { type: "TRANSCRIPTION_STARTED" }
  | { type: "TRANSCRIPTION_FINISHED" }
  | { type: "THINKING_STARTED"; activityText?: string }
  | { type: "THINKING_ENDED" }
  | { type: "SYNC_STARTED"; source?: string; activityText?: string }
  | { type: "SYNC_FINISHED" }
  | {
      type: "TASK_STARTED";
      taskId?: string;
      agentId?: string;
      activityText?: string;
      detailText?: string;
      progressMode?: "determinate" | "indeterminate" | "none";
    }
  | {
      type: "TASK_PROGRESS";
      progress?: number | null;
      progressMode?: "determinate" | "indeterminate" | "none";
      activityText?: string;
    }
  | { type: "TASK_COMPLETED"; taskId?: string; agentId?: string }
  | { type: "TTS_STARTED" }
  | { type: "TTS_ENDED" }
  | { type: "AUDIO_LEVEL"; level: number }
  | { type: "APPROVAL_REQUIRED"; approvalId?: string; activityText?: string }
  | { type: "APPROVAL_RESOLVED" }
  | { type: "WARNING_RAISED"; detailText?: string }
  | { type: "WARNING_CLEARED" }
  | { type: "ERROR_RAISED"; detailText?: string }
  | { type: "ERROR_CLEARED" }
  | { type: "HEALTH_CHANGED"; health: "online" | "degraded" }
  | { type: "SYSTEM_OFFLINE" }
  | { type: "SYSTEM_ONLINE" }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  /** Snap every region to a backend-provided snapshot (GET /orb/status, friday.orb.status_changed). */
  | { type: "SYNC_STATUS"; snapshot: OrbSnapshot };

/**
 * Richer internal layer model of the machine. The wire contract (`OrbLayers`) folds `thinking` into the work layer,
 * `paused` into the work layer, `offline` into health and `success`/`approval` into attention; `toOrbLayers` and
 * `toInternalLayers` convert in both directions.
 */
export interface OrbInternalLayers {
  voice: "idle" | "listening" | "transcribing" | "thinking" | "speaking";
  work: "idle" | "syncing" | "working";
  attention: "none" | "approval" | "warning" | "error";
  health: OrbHealth;
  connectivity: "booting" | "online" | "offline" | "paused";
  activeAgentIds: string[];
}

type Region = "connectivity" | "voice" | "work" | "attention";

/** Progress is a 0..1 fraction. Values > 1 are interpreted as percent (62 -> 0.62). */
export function normalizeProgress(p: number | null | undefined): number | null {
  if (p == null || Number.isNaN(p)) return null;
  const f = p > 1 ? p / 100 : p;
  return Math.min(1, Math.max(0, f));
}

/**
 * Primary mode by PLAN §18.3. Layers are never dropped, only ranked.
 * Deviations (documented in ORB_SPECIFICATION): booting outranks everything; `paused` outranks the activity
 * tiers 3-5 because pausing is an explicit operator override; `warning` sits just above idle so it never hides
 * listening/working labels (the warning overlay stays visible through the layers).
 */
export function arbitrateOrbState(context: { layers: OrbInternalLayers; flashSuccess?: boolean }): OrbMode {
  const { layers, flashSuccess } = context;
  if (layers.connectivity === "booting") return "booting";
  if (layers.connectivity === "offline") return "offline";
  if (layers.attention === "error") return "error";
  if (layers.attention === "approval") return "waiting_approval";
  if (layers.connectivity === "paused") return "paused";
  if (flashSuccess) return "success";
  if (layers.voice === "listening") return "listening";
  if (layers.voice === "speaking") return "speaking";
  if (layers.voice === "transcribing") return "transcribing";
  if (layers.voice === "thinking") return "thinking";
  if (layers.work === "working") return "working";
  if (layers.work === "syncing") return "syncing";
  if (layers.attention === "warning") return "warning";
  return "idle";
}

/** Wire layers (`OrbLayers`) for a status that carries no explicit layers. */
export function layersFromStatus(status: OrbStatus, activeAgentIds?: string[]): OrbLayers {
  const mode = status.mode;
  const count = status.activeAgentCount ?? 0;
  const ids =
    activeAgentIds ??
    Array.from({ length: count }, (_, i) => (i === 0 && status.currentAgentId) || `agent_${i + 1}`);
  return {
    voice: mode === "listening" || mode === "transcribing" || mode === "speaking" ? mode : "idle",
    work:
      mode === "working" || mode === "syncing" || mode === "thinking" ? mode : mode === "paused" ? "paused" : "idle",
    attention:
      mode === "waiting_approval" || mode === "success" || mode === "warning" || mode === "error" ? mode : "none",
    health: mode === "offline" ? "offline" : (status.health ?? "online"),
    activeAgentIds: ids,
  };
}

/** Wire snapshot -> internal layers (+ whether the success flash is showing). `status.mode` supplies booting/offline/paused. */
export function toInternalLayers(snapshot: OrbSnapshot): { layers: OrbInternalLayers; flashSuccess: boolean } {
  const { status, layers: l } = snapshot;
  const connectivity: OrbInternalLayers["connectivity"] =
    status.mode === "booting"
      ? "booting"
      : status.mode === "offline" || l.health === "offline"
        ? "offline"
        : status.mode === "paused" || l.work === "paused"
          ? "paused"
          : "online";
  return {
    flashSuccess: l.attention === "success" || status.mode === "success",
    layers: {
      connectivity,
      health: l.health,
      voice: l.voice === "idle" && l.work === "thinking" ? "thinking" : l.voice,
      work: l.work === "working" || l.work === "syncing" ? l.work : "idle",
      attention: l.attention === "waiting_approval" ? "approval" : l.attention === "success" ? "none" : l.attention,
      activeAgentIds: l.activeAgentIds,
    },
  };
}

/** Internal layers -> wire layers. */
export function toOrbLayers(context: { layers: OrbInternalLayers; flashSuccess?: boolean }): OrbLayers {
  const l = context.layers;
  return {
    voice: l.voice === "thinking" ? "idle" : l.voice,
    work: l.connectivity === "paused" ? "paused" : l.work === "idle" && l.voice === "thinking" ? "thinking" : l.work,
    attention:
      l.attention === "approval" ? "waiting_approval" : l.attention === "none" && context.flashSuccess ? "success" : l.attention,
    health: l.connectivity === "offline" ? "offline" : l.health,
    activeAgentIds: l.activeAgentIds,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function remainingAfterCompletion(
  context: OrbMachineContext,
  event: { taskId?: string; agentId?: string },
): { tasks: string[]; agents: string[] } {
  if (!event.taskId && !event.agentId) return { tasks: [], agents: [] };
  return {
    tasks: context.activeTaskIds.filter((t) => t !== event.taskId),
    agents: context.layers.activeAgentIds.filter((a) => a !== event.agentId),
  };
}

function withLayers(context: OrbMachineContext, patch: Partial<OrbInternalLayers>): Partial<OrbMachineContext> {
  const layers = { ...context.layers, ...patch };
  const next: Partial<OrbMachineContext> = { layers };
  if (arbitrateOrbState({ layers, flashSuccess: context.flashSuccess }) !== arbitrateOrbState(context)) {
    next.since = nowIso();
  }
  return next;
}

const initialLayers: OrbInternalLayers = {
  voice: "idle",
  work: "idle",
  attention: "none",
  health: "online",
  connectivity: "booting",
  activeAgentIds: [],
};

function snapTransitions<R extends Region>(region: R, values: readonly OrbInternalLayers[R][]) {
  return values.map((value) => ({
    guard: ({ event }: { event: OrbMachineEvent }) =>
      event.type === "SYNC_STATUS" && toInternalLayers(event.snapshot).layers[region] === value,
    target: `.${value}`,
    // The snapshot (texts, progress, agents ...) is applied exactly once, by the connectivity region.
    ...(region === "connectivity" ? { actions: "applySnapshot" as const } : {}),
  }));
}

export const orbMachine = setup({
  types: {
    context: {} as OrbMachineContext,
    events: {} as OrbMachineEvent,
  },
  guards: {
    noWorkRemaining: ({ context, event }) => {
      if (event.type !== "TASK_COMPLETED") return false;
      const { tasks, agents } = remainingAfterCompletion(context, event);
      return tasks.length === 0 && agents.length === 0;
    },
    workRemaining: ({ context, event }) => {
      if (event.type !== "TASK_COMPLETED") return false;
      const { tasks, agents } = remainingAfterCompletion(context, event);
      return tasks.length > 0 || agents.length > 0;
    },
    errorActive: ({ context }) => context.errorActive,
    approvalActive: ({ context }) => context.approvalId !== undefined,
    warningActive: ({ context }) => context.warningActive,
    syncPending: ({ context }) => context.syncPending,
    voiceIsIdle: ({ context }) => context.layers.voice === "idle",
  },
  actions: {
    setConnectivity: assign(({ context }, params: { value: OrbInternalLayers["connectivity"] }) =>
      withLayers(context, {
        connectivity: params.value,
        health: params.value === "offline" ? "offline" : context.healthReported,
      }),
    ),
    setVoice: assign(({ context }, params: { value: OrbInternalLayers["voice"] }) => ({
      ...withLayers(context, { voice: params.value }),
      ...(params.value === "listening" || params.value === "speaking" ? {} : { voiceActive: false }),
    })),
    setWork: assign(({ context }, params: { value: OrbInternalLayers["work"] }) =>
      withLayers(context, { work: params.value }),
    ),
    setAttention: assign(({ context }, params: { value: OrbInternalLayers["attention"] }) =>
      withLayers(context, { attention: params.value }),
    ),
    setFlash: assign(({ context }, params: { value: boolean }) => {
      const next: Partial<OrbMachineContext> = { flashSuccess: params.value };
      if (arbitrateOrbState({ layers: context.layers, flashSuccess: params.value }) !== arbitrateOrbState(context)) {
        next.since = nowIso();
      }
      return next;
    }),
    clearFinishedProgress: assign(({ context }) =>
      context.layers.work === "working"
        ? {}
        : { progress: null, progressMode: "none" as const, activityText: undefined, detailText: undefined },
    ),
    setHealth: assign(({ context, event }) => {
      if (event.type !== "HEALTH_CHANGED") return {};
      return {
        healthReported: event.health,
        layers: {
          ...context.layers,
          health: context.layers.connectivity === "offline" ? ("offline" as const) : event.health,
        },
      };
    }),
    voiceActivity: assign(({ event }) => ({ voiceActive: event.type === "VOICE_ACTIVITY_STARTED" })),
    setAudioLevel: assign(({ event }) =>
      event.type === "AUDIO_LEVEL" ? { audioLevel: Math.min(1, Math.max(0, event.level)) } : {},
    ),
    beginTask: assign(({ context, event }) => {
      if (event.type !== "TASK_STARTED") return {};
      const agentIds =
        event.agentId && !context.layers.activeAgentIds.includes(event.agentId)
          ? [...context.layers.activeAgentIds, event.agentId]
          : context.layers.activeAgentIds;
      const taskIds =
        event.taskId && !context.activeTaskIds.includes(event.taskId)
          ? [...context.activeTaskIds, event.taskId]
          : context.activeTaskIds;
      return {
        activeTaskIds: taskIds,
        layers: { ...context.layers, activeAgentIds: agentIds },
        taskId: event.taskId ?? context.taskId,
        currentAgentId: event.agentId ?? context.currentAgentId,
        activityText: event.activityText ?? context.activityText,
        detailText: event.detailText ?? context.detailText,
        progressMode:
          event.progressMode ?? (context.progressMode === "none" ? ("indeterminate" as const) : context.progressMode),
      };
    }),
    updateProgress: assign(({ context, event }) => {
      if (event.type !== "TASK_PROGRESS") return {};
      const progress = event.progress === undefined ? context.progress : normalizeProgress(event.progress);
      const mode = event.progressMode ?? (progress === null ? "indeterminate" : "determinate");
      return { progress, progressMode: mode, activityText: event.activityText ?? context.activityText };
    }),
    finishTask: assign(({ context, event }) => {
      if (event.type !== "TASK_COMPLETED") return {};
      const { tasks, agents } = remainingAfterCompletion(context, event);
      const done = tasks.length === 0 && agents.length === 0;
      return {
        activeTaskIds: tasks,
        layers: { ...context.layers, activeAgentIds: agents },
        taskId: tasks.at(-1),
        currentAgentId: agents.at(-1),
        // The progress orbit closes for the duration of the success flash (PLAN §19.10).
        ...(done ? { progress: 1, progressMode: "determinate" as const } : {}),
      };
    }),
    beginSync: assign(({ context, event }) => {
      if (event.type !== "SYNC_STARTED") return {};
      return { activityText: event.activityText ?? event.source ?? context.activityText };
    }),
    markSyncPending: assign({ syncPending: true }),
    endSync: assign({ syncPending: false }),
    setThinkingText: assign(({ context, event }) =>
      event.type === "THINKING_STARTED" ? { activityText: event.activityText ?? context.activityText } : {},
    ),
    raiseApproval: assign(({ event }) =>
      event.type === "APPROVAL_REQUIRED"
        ? { approvalId: event.approvalId ?? "approval", ...(event.activityText ? { activityText: event.activityText } : {}) }
        : {},
    ),
    resolveApproval: assign({ approvalId: undefined }),
    raiseWarning: assign(({ event }) =>
      event.type === "WARNING_RAISED" ? { warningActive: true, detailText: event.detailText } : { warningActive: true },
    ),
    clearWarning: assign({ warningActive: false }),
    raiseError: assign(({ event }) =>
      event.type === "ERROR_RAISED" ? { errorActive: true, detailText: event.detailText } : { errorActive: true },
    ),
    clearError: assign({ errorActive: false }),
    applySnapshot: assign(({ context, event }) => {
      if (event.type !== "SYNC_STATUS") return {};
      const { status } = event.snapshot;
      const { layers, flashSuccess } = toInternalLayers(event.snapshot);
      const healthReported: "online" | "degraded" = layers.health === "degraded" ? "degraded" : "online";
      return {
        layers,
        flashSuccess,
        healthReported,
        activeTaskIds: status.taskId ? [status.taskId] : [],
        syncPending: false,
        voiceActive: layers.voice === "listening" && (status.audioLevel ?? 0) > 0.05,
        approvalId: layers.attention === "approval" ? (status.approvalId ?? "approval") : undefined,
        warningActive: layers.attention === "warning",
        errorActive: layers.attention === "error",
        activityText: status.activityText,
        detailText: status.detailText,
        progress: normalizeProgress(status.progress),
        progressMode: status.progressMode ?? (status.progress == null ? ("none" as const) : ("determinate" as const)),
        audioLevel: status.audioLevel ?? 0,
        urgency: status.urgency ?? "none",
        currentAgentId: status.currentAgentId,
        taskId: status.taskId,
        since: status.since || context.since,
        sourceEventId: status.sourceEventId,
      };
    }),
  },
  delays: { successFlash: SUCCESS_FLASH_MS },
}).createMachine({
  id: "orb",
  type: "parallel",
  context: () => ({
    layers: initialLayers,
    flashSuccess: false,
    healthReported: "online",
    activeTaskIds: [],
    voiceActive: false,
    syncPending: false,
    warningActive: false,
    errorActive: false,
    progress: null,
    progressMode: "none",
    audioLevel: 0,
    urgency: "none",
    since: nowIso(),
  }),
  on: {
    AUDIO_LEVEL: { actions: "setAudioLevel" },
    HEALTH_CHANGED: { actions: "setHealth" },
  },
  states: {
    connectivity: {
      initial: "booting",
      on: {
        SYSTEM_BOOT: { target: ".booting", reenter: true },
        SYSTEM_OFFLINE: { target: ".offline" },
        SYNC_STATUS: snapTransitions("connectivity", ["booting", "online", "offline", "paused"]),
      },
      states: {
        booting: {
          entry: { type: "setConnectivity", params: { value: "booting" } },
          on: { SYSTEM_READY: "online" },
        },
        online: {
          entry: { type: "setConnectivity", params: { value: "online" } },
          on: { PAUSE: "paused" },
        },
        offline: {
          entry: { type: "setConnectivity", params: { value: "offline" } },
          on: { SYSTEM_ONLINE: "online" },
        },
        paused: {
          entry: { type: "setConnectivity", params: { value: "paused" } },
          on: { RESUME: "online", SYSTEM_ONLINE: "online" },
        },
      },
    },
    voice: {
      initial: "idle",
      on: {
        MIC_OPENED: { target: ".listening" },
        TRANSCRIPTION_STARTED: { target: ".transcribing" },
        THINKING_STARTED: { target: ".thinking", actions: "setThinkingText" },
        TTS_STARTED: { target: ".speaking" },
        VOICE_ACTIVITY_STARTED: [
          { guard: "voiceIsIdle", target: ".listening", actions: "voiceActivity" },
          { actions: "voiceActivity" },
        ],
        VOICE_ACTIVITY_ENDED: { actions: "voiceActivity" },
        SYNC_STATUS: snapTransitions("voice", ["idle", "listening", "transcribing", "thinking", "speaking"]),
      },
      states: {
        idle: { entry: { type: "setVoice", params: { value: "idle" } } },
        listening: {
          entry: { type: "setVoice", params: { value: "listening" } },
          on: { MIC_CLOSED: "idle" },
        },
        transcribing: {
          entry: { type: "setVoice", params: { value: "transcribing" } },
          on: { TRANSCRIPTION_FINISHED: "idle" },
        },
        thinking: {
          entry: { type: "setVoice", params: { value: "thinking" } },
          on: { THINKING_ENDED: "idle", TASK_STARTED: "idle" },
        },
        speaking: {
          entry: { type: "setVoice", params: { value: "speaking" } },
          on: { TTS_ENDED: "idle" },
        },
      },
    },
    work: {
      initial: "idle",
      on: {
        TASK_PROGRESS: { actions: "updateProgress" },
        SYNC_STATUS: snapTransitions("work", ["idle", "syncing", "working"]),
      },
      states: {
        idle: {
          entry: { type: "setWork", params: { value: "idle" } },
          on: {
            SYNC_STARTED: { target: "syncing", actions: "beginSync" },
            TASK_STARTED: { target: "working", actions: "beginTask" },
          },
        },
        syncing: {
          entry: { type: "setWork", params: { value: "syncing" } },
          on: {
            SYNC_FINISHED: { target: "idle", actions: "endSync" },
            TASK_STARTED: { target: "working", actions: "beginTask" },
          },
        },
        working: {
          entry: { type: "setWork", params: { value: "working" } },
          on: {
            TASK_STARTED: { actions: "beginTask" },
            SYNC_STARTED: { actions: "markSyncPending" },
            SYNC_FINISHED: { actions: "endSync" },
            TASK_COMPLETED: [
              { guard: "workRemaining", actions: "finishTask" },
              { guard: "syncPending", target: "syncing", actions: ["finishTask", "endSync"] },
              { target: "idle", actions: "finishTask" },
            ],
          },
        },
      },
    },
    attention: {
      initial: "none",
      on: {
        APPROVAL_REQUIRED: { target: ".route", actions: "raiseApproval" },
        APPROVAL_RESOLVED: { target: ".route", actions: "resolveApproval" },
        WARNING_RAISED: { target: ".route", actions: "raiseWarning" },
        WARNING_CLEARED: { target: ".route", actions: "clearWarning" },
        ERROR_RAISED: { target: ".route", actions: "raiseError" },
        ERROR_CLEARED: { target: ".route", actions: "clearError" },
        SYNC_STATUS: snapTransitions("attention", ["none", "warning", "approval", "error"]),
      },
      states: {
        /** Transient router: the highest-priority active flag wins, so overlapping attention items are never lost. */
        route: {
          always: [
            { guard: "errorActive", target: "error" },
            { guard: "approvalActive", target: "approval" },
            { guard: "warningActive", target: "warning" },
            { target: "none" },
          ],
        },
        none: { entry: { type: "setAttention", params: { value: "none" } } },
        warning: { entry: { type: "setAttention", params: { value: "warning" } } },
        approval: { entry: { type: "setAttention", params: { value: "approval" } } },
        error: { entry: { type: "setAttention", params: { value: "error" } } },
      },
    },
    flash: {
      initial: "none",
      on: {
        SYNC_STATUS: [
          { guard: ({ event }) => event.type === "SYNC_STATUS" && toInternalLayers(event.snapshot).flashSuccess, target: ".success" },
          { target: ".none" },
        ],
      },
      states: {
        none: {
          entry: { type: "setFlash", params: { value: false } },
          on: { TASK_COMPLETED: { guard: "noWorkRemaining", target: "success" } },
        },
        success: {
          entry: { type: "setFlash", params: { value: true } },
          exit: "clearFinishedProgress",
          after: { successFlash: "none" },
          on: { TASK_COMPLETED: { guard: "noWorkRemaining", target: "success", reenter: true } },
        },
      },
    },
  },
});

export type OrbMachineSnapshot = SnapshotFrom<typeof orbMachine>;

export function selectOrbLayers(snapshot: OrbMachineSnapshot): OrbLayers {
  return toOrbLayers(snapshot.context);
}

/** Wire snapshot (what `<FridayOrb snapshot>` and the API carry). */
export function selectOrbSnapshot(snapshot: OrbMachineSnapshot): OrbSnapshot {
  return { status: selectOrbStatus(snapshot), layers: selectOrbLayers(snapshot) };
}

export function selectOrbMode(snapshot: OrbMachineSnapshot): OrbMode {
  return arbitrateOrbState(snapshot.context);
}

export function selectOrbStatus(snapshot: OrbMachineSnapshot): OrbStatus {
  const c = snapshot.context;
  return {
    mode: arbitrateOrbState(c),
    activityText: c.activityText,
    detailText: c.detailText,
    progress: c.progress,
    progressMode: c.progressMode,
    audioLevel: c.audioLevel,
    urgency: c.errorActive ? "critical" : c.approvalId || c.warningActive ? "warning" : c.urgency,
    health: c.layers.health,
    activeAgentCount: c.layers.activeAgentIds.length,
    currentAgentId: c.currentAgentId,
    taskId: c.taskId,
    approvalId: c.approvalId,
    since: c.since,
    sourceEventId: c.sourceEventId,
  };
}

export function createOrbActor() {
  return createActor(orbMachine);
}
