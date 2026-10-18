import { createBridge, type OrbFactsSink } from "../bridge/createOrbEventBridge";
import type { OrbTaskInfo } from "../bridge/OrbEventBridge";
import { SUCCESS_FLASH_MS, toInternalLayers, normalizeProgress } from "../machine/orbMachine";
import type { OrbSnapshot } from "../contract-types";
import { clearAudioFrame, createAudioFrame } from "../audio/frame";
import { createServiceLevelSource, type ServiceLevelSource } from "../audio/serviceLevelSource";
import { createSpeechEnvelopeSource, type SpeechEnvelopeSource } from "../audio/speechEnvelope";
import { arbitrateLayers, layersForMode } from "./layers";
import type {
  ApprovalState,
  BackgroundWork,
  CreateOrbControllerOptions,
  OrbAudioFrame,
  OrbAudioFrameSource,
  OrbController,
  OrbControllerState,
  OrbFrameInputs,
  OrbLayerState,
  OrbMode,
  OrbProgressMode,
  OrbRuntimeStatus,
  OrbSeverity,
  PrimaryInteraction,
  SystemHealthState,
} from "./types";

const DEFAULT_LEASE_MS = 1500;
const BROWSER_MIC_LEASE_MS = 15_000;
const TRANSCRIBING_LEASE_MS = 30_000;
const THINKING_LEASE_MS = 120_000;
const TTS_LEASE_MS = 60_000;
const SYNC_LEASE_MS = 300_000;
const WORK_LEASE_MS = 900_000;
/** After a local voice fact ended, a still-stale server voice layer of the same phase is ignored for this long. */
const SERVER_SUPPRESS_MS = 1500;
/** Local task facts older than this are dropped when a newer server snapshot says that no work is running. */
const SERVER_RECONCILE_GRACE_MS = 2000;
const ENVELOPE_START_DELAY_MS = 250;
const SERVICE_FRESH_MS = 600;
const VOICE_DETECTED_DWELL_MS = 250;

interface TaskFact {
  title?: string;
  agentName?: string;
  progress: number | null;
  startedAt: number;
  until: number;
}

interface ServerFacts {
  snapshot: OrbSnapshot;
  receivedAt: number;
  connectivity: SystemHealthState["connectivity"];
  health: SystemHealthState["health"];
  voice: PrimaryInteraction;
  work: BackgroundWork;
  attention: "none" | "approval" | "warning" | "error";
}

const SUPPRESS_PHASES: readonly PrimaryInteraction[] = ["listening", "transcribing", "thinking", "speaking"];

const SYNC_PHRASES: Record<string, string> = {
  calendar: "KALENDER WIRD SYNCHRONISIERT",
  kalender: "KALENDER WIRD SYNCHRONISIERT",
  mail: "MAILS WERDEN AKTUALISIERT",
  mails: "MAILS WERDEN AKTUALISIERT",
  email: "MAILS WERDEN AKTUALISIERT",
  memory: "MEMORY WIRD SYNCHRONISIERT",
};

function syncText(source: string | undefined): string | undefined {
  const key = source?.trim().toLowerCase();
  if (!key) return undefined;
  return SYNC_PHRASES[key] ?? `${key.toUpperCase()} WIRD SYNCHRONISIERT`;
}

const monotonicNow = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());
const trimText = (text: string, max = 96): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function severityOf(mode: OrbMode, layers: OrbLayerState): OrbSeverity {
  if (layers.systemHealth.attention === "error" || mode === "error") return "critical";
  if (layers.approval.pending || layers.systemHealth.attention === "warning" || layers.systemHealth.health === "degraded" || mode === "offline") return "warning";
  if (mode === "working" || mode === "syncing" || mode === "thinking") return "info";
  return "none";
}

/**
 * Deterministic orb state controller (framework agnostic, no React, no DOM). Local voice facts (microphone, VAD,
 * transcription, thinking, TTS) are leases that expire without refresh; the server snapshot is the truth for background
 * work, approvals, health and agent counts; an explicit `setMode` (debug, demo, tests) overrides everything until `reset()`.
 * The visible mode is always computed from the layers, never from texts.
 */
export function createOrbController(options: CreateOrbControllerOptions = {}): OrbController {
  const now = options.now ?? monotonicNow;
  const epochNow = options.epochNow ?? Date.now;
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  const seed = options.seed ?? 20260617;

  // ---- facts -----------------------------------------------------------------------------------------------------
  let micOpen = false;
  let micPassive = false;
  let micUntil = 0;
  let transcribing = false;
  let transcribingUntil = 0;
  let transcribingDerived = false;
  let thinking = false;
  let thinkingUntil = 0;
  let thinkingText: string | undefined;
  let thinkingDerived = false;
  let tts = false;
  let ttsUntil = 0;
  let ttsDerived = false;
  let ttsHasAnalysis: boolean | undefined;
  const tasks = new Map<string, TaskFact>();
  let lastTaskId: string | undefined;
  let orphanProgress: number | null | undefined;
  let localAgentCount = 0;
  let localAgentNames: readonly string[] = [];
  let agentsUntil = 0;
  let syncOn = false;
  let syncSource: string | undefined;
  let syncUntil = 0;
  const approvals = new Set<string>();
  let lastApprovalId: string | undefined;
  let manualApproval: { approvalId?: string; count: number } | null = null;
  let warningMessage: string | null = null;
  let errorInfo: { message: string; critical: boolean } | null = null;
  let localOffline = false;
  let localPaused = false;
  let booting = options.initialConnectivity === "booting";
  let healthPatch: Partial<SystemHealthState> = {};
  let successUntil = 0;
  let progressHold: number | null = null;
  let server: ServerFacts | null = null;
  const serverSuppress: Record<PrimaryInteraction, number> = { idle: 0, listening: 0, transcribing: 0, thinking: 0, speaking: 0 };

  // ---- explicit overrides ----------------------------------------------------------------------------------------
  let overrideMode: OrbMode | null = null;
  let overrideText: { activityText?: string; detailText?: string } = {};
  let explicitActivity: { activityText?: string; detailText?: string } | null = null;
  let explicitProgress: { progress: number | null; mode: OrbProgressMode } | null = null;
  let explicitAgents: { count: number; names: readonly string[] } | null = null;

  // ---- audio -----------------------------------------------------------------------------------------------------
  let inputSource: OrbAudioFrameSource | null = null;
  let outputSource: OrbAudioFrameSource | null = null;
  const serviceIn: ServiceLevelSource = createServiceLevelSource();
  const serviceOut: ServiceLevelSource = createServiceLevelSource();
  let manualIn: ServiceLevelSource | null = null;
  let manualOut: ServiceLevelSource | null = null;
  const envelope: SpeechEnvelopeSource = createSpeechEnvelopeSource({ seed });
  const scratch: OrbAudioFrame = createAudioFrame();
  let lastInputLevel = 0;
  let lastOutputLevel = 0;
  let speakingSince = -1;
  let voiceDetected = false;
  let voiceDetectedChangedAt = -Infinity;

  // ---- state -----------------------------------------------------------------------------------------------------
  let disposed = false;
  let version = 0;
  let lastSig = "";
  let modeSince = epochNow();
  let lastMode: OrbMode = "idle";
  let lastPrimary: PrimaryInteraction = "idle";
  let state: OrbControllerState = buildState();
  const listeners = new Set<(s: OrbControllerState) => void>();

  function agentSnapshot(): { count: number; names: readonly string[] } {
    if (explicitAgents) return explicitAgents;
    const taskAgents = new Set<string>();
    for (const t of tasks.values()) if (t.agentName) taskAgents.add(t.agentName);
    const serverCount = Math.max(server?.snapshot.layers.activeAgentIds.length ?? 0, server?.snapshot.status.activeAgentCount ?? 0);
    const count = Math.max(localAgentCount, taskAgents.size, serverCount);
    const serverName = server?.snapshot.status.currentAgentName ?? server?.snapshot.status.currentAgentId;
    const names = localAgentNames.length > 0 ? localAgentNames : taskAgents.size > 0 ? [...taskAgents] : serverName ? [serverName] : [];
    return { count, names };
  }

  function resolveLayers(agentCount: number): OrbLayerState {
    if (overrideMode) return layersForMode(overrideMode, agentCount);
    const t = now();

    // primary interaction: local lease facts win, then the server voice layer (minus recently ended phases)
    let primary: PrimaryInteraction | null = null;
    if (micOpen && !micPassive) primary = "listening";
    else if (tts) primary = "speaking";
    else if (transcribing) primary = "transcribing";
    else if (thinking) primary = "thinking";
    if (!primary && server && serverSuppress[server.voice] <= t) primary = server.voice;

    // background work: working outranks syncing
    const localWorking = tasks.size > 0 || localAgentCount > 0;
    // the server agent count only feeds the agent visuals, never the work layer
    const working = localWorking || server?.work === "working";
    const syncing = syncOn || server?.work === "syncing";
    const work: BackgroundWork = working ? "working" : syncing ? "syncing" : "idle";

    // system health
    const connectivity: SystemHealthState["connectivity"] =
      localOffline || server?.connectivity === "offline" || healthPatch.connectivity === "offline"
        ? "offline"
        : localPaused || server?.connectivity === "paused" || healthPatch.connectivity === "paused"
          ? "paused"
          : ((booting && server === null) || server?.connectivity === "booting") && healthPatch.connectivity !== "online"
            ? "booting"
            : "online";
    const serverHealth = server?.health ?? "unknown";
    const health: SystemHealthState["health"] =
      connectivity === "offline" || serverHealth === "offline" || healthPatch.health === "offline"
        ? "offline"
        : serverHealth === "degraded" || healthPatch.health === "degraded"
          ? "degraded"
          : server || healthPatch.health ? "online" : "unknown";
    const serverAttention = server?.attention ?? "none";
    const hasError = errorInfo?.critical === true || serverAttention === "error" || healthPatch.attention === "error";
    const hasWarning = warningMessage !== null || (errorInfo !== null && !errorInfo.critical) || serverAttention === "warning" || healthPatch.attention === "warning";
    const flash = successUntil > t || healthPatch.attention === "success";
    const attention: SystemHealthState["attention"] = hasError ? "error" : hasWarning ? "warning" : flash ? "success" : "none";
    const message = errorInfo?.message ?? warningMessage ?? healthPatch.message ?? server?.snapshot.status.detailText;

    const approval = resolveApproval();
    return {
      primaryInteraction: primary ?? "idle",
      backgroundWork: work,
      systemHealth: { connectivity, health, attention, ...(message !== undefined && (hasError || hasWarning) ? { message } : {}) },
      approval,
    };
  }

  function resolveApproval(): ApprovalState {
    const serverApproval = server?.attention === "approval";
    const count = Math.max(approvals.size, manualApproval?.count ?? 0, serverApproval ? 1 : 0);
    const pending = approvals.size > 0 || manualApproval !== null || serverApproval;
    const approvalId = lastApprovalId ?? manualApproval?.approvalId ?? (serverApproval ? server?.snapshot.status.approvalId : undefined);
    return { pending, count: pending ? Math.max(1, count) : 0, ...(approvalId !== undefined ? { approvalId } : {}) };
  }

  function resolveProgress(mode: OrbMode, layers: OrbLayerState): { progress: number | null; mode: OrbProgressMode } {
    if (explicitProgress) return explicitProgress.progress === null && explicitProgress.mode === "determinate" ? { progress: null, mode: "none" } : explicitProgress;
    if (progressHold !== null && successUntil > now()) return { progress: progressHold, mode: "determinate" };
    if (tasks.size > 0) {
      const values = [...tasks.values()].map((t) => t.progress);
      if (values.every((v): v is number => typeof v === "number")) {
        return { progress: values.reduce((a, b) => a + b, 0) / values.length, mode: "determinate" };
      }
      return { progress: null, mode: "indeterminate" };
    }
    if (orphanProgress !== undefined && layers.backgroundWork === "working") {
      return orphanProgress === null ? { progress: null, mode: "indeterminate" } : { progress: orphanProgress, mode: "determinate" };
    }
    const s = server?.snapshot.status;
    if (s && layers.backgroundWork === "working" && !overrideMode) {
      const p = normalizeProgress(s.progress);
      const m = s.progressMode ?? (p === null ? "none" : "determinate");
      if (m === "determinate" && p !== null) return { progress: p, mode: "determinate" };
      if (m === "indeterminate") return { progress: null, mode: "indeterminate" };
    }
    if (mode === "working" && layers.backgroundWork === "working") return { progress: null, mode: "indeterminate" };
    return { progress: null, mode: "none" };
  }

  function resolveActivity(mode: OrbMode, layers: OrbLayerState): { activityText?: string; detailText?: string } {
    if (overrideMode) {
      const o = { ...overrideText, ...(explicitActivity ?? {}) };
      return o;
    }
    if (explicitActivity) return explicitActivity;
    const serverStatus = server?.snapshot.status;
    const out: { activityText?: string; detailText?: string } = {};
    const message = layers.systemHealth.message;
    switch (mode) {
      case "listening":
        if (voiceDetected) out.activityText = "SPRACHE ERKANNT";
        break;
      case "transcribing":
        out.activityText = "SPRACHE WIRD VERARBEITET";
        break;
      case "thinking":
        out.activityText = thinkingText ?? serverStatus?.activityText ?? "ANFRAGE WIRD ANALYSIERT";
        break;
      case "syncing":
        out.activityText = syncText(syncSource) ?? serverStatus?.activityText;
        break;
      case "speaking":
        out.activityText = "ANTWORT WIRD GESPROCHEN";
        break;
      case "working": {
        const only = tasks.size === 1 ? [...tasks.values()][0] : undefined;
        out.activityText = only?.title ? only.title.toUpperCase() : serverStatus?.activityText;
        break;
      }
      case "warning":
      case "error":
        if (message) {
          out.activityText = trimText(message);
          out.detailText = message;
        } else {
          out.activityText = serverStatus?.activityText;
          out.detailText = serverStatus?.detailText;
        }
        break;
      default:
        out.activityText = serverStatus?.activityText;
        out.detailText = serverStatus?.detailText;
    }
    if (out.activityText === undefined) delete out.activityText;
    if (out.detailText === undefined) delete out.detailText;
    return out;
  }

  function buildState(): OrbControllerState {
    const agents = agentSnapshot();
    const layers = resolveLayers(agents.count);
    const mode: OrbMode = overrideMode ?? arbitrateLayers(layers, agents.count);
    const progress = resolveProgress(mode, layers);
    const text = resolveActivity(mode, layers);
    if (mode !== lastMode) {
      lastMode = mode;
      modeSince = epochNow();
    }
    if (layers.primaryInteraction !== lastPrimary) {
      speakingSince = layers.primaryInteraction === "speaking" ? now() : -1;
      lastPrimary = layers.primaryInteraction;
    }
    const currentTaskId = lastTaskId && tasks.has(lastTaskId) ? lastTaskId : server?.snapshot.status.taskId;
    const status: OrbRuntimeStatus = {
      mode,
      ...text,
      inputAudioLevel: Math.round(lastInputLevel * 100) / 100,
      outputAudioLevel: Math.round(lastOutputLevel * 100) / 100,
      progress: progress.progress,
      progressMode: progress.mode,
      activeAgentCount: agents.count,
      severity: severityOf(mode, layers),
      since: modeSince,
    };
    if (agents.names[0] !== undefined) status.currentAgentName = agents.names[0];
    if (currentTaskId !== undefined) status.currentTaskId = currentTaskId;
    const derivedPhase =
      (layers.primaryInteraction === "transcribing" && transcribingDerived) ||
      (layers.primaryInteraction === "thinking" && thinkingDerived) ||
      (layers.primaryInteraction === "speaking" && ttsDerived);
    if (derivedPhase) status.derived = true;
    return { version, status, layers, overrideMode };
  }

  /** Recomputes the state; publishes (new version, listeners) only when a low-rate field actually changed. */
  function refresh(): void {
    if (disposed) return;
    const next = buildState();
    // levels are included in the state only as of this publication; they must not trigger one by themselves
    const sig = JSON.stringify({ ...next.status, inputAudioLevel: 0, outputAudioLevel: 0, since: 0 }) + JSON.stringify(next.layers) + (next.overrideMode ?? "");
    if (sig === lastSig) return;
    lastSig = sig;
    version += 1;
    state = { ...next, version };
    for (const l of [...listeners]) l(state);
  }

  /** Clears expired lease facts. Called from `readFrame` (cheap comparisons) and from fact setters. */
  function expire(t: number): boolean {
    let changed = false;
    if (micOpen && t > micUntil) {
      micOpen = false;
      changed = true;
    }
    if (transcribing && t > transcribingUntil) {
      transcribing = false;
      changed = true;
    }
    if (thinking && t > thinkingUntil) {
      thinking = false;
      changed = true;
    }
    if (tts && t > ttsUntil) {
      endTts(false);
      changed = true;
    }
    if (syncOn && t > syncUntil) {
      syncOn = false;
      changed = true;
    }
    if (localAgentCount > 0 && t > agentsUntil) {
      localAgentCount = 0;
      localAgentNames = [];
      changed = true;
    }
    for (const [id, task] of tasks) {
      if (t > task.until) {
        tasks.delete(id);
        changed = true;
      }
    }
    for (const phase of SUPPRESS_PHASES) {
      const until = serverSuppress[phase];
      if (until > 0 && t > until) {
        serverSuppress[phase] = 0; // the hold-down ended: the server layer counts again
        changed = true;
      }
    }
    if (successUntil > 0 && t > successUntil) {
      successUntil = 0;
      progressHold = null;
      changed = true;
    }
    return changed;
  }

  function endTts(interrupted: boolean): void {
    if (!tts && !envelope.running) return;
    tts = false;
    ttsDerived = false;
    ttsHasAnalysis = undefined;
    envelope.stop(interrupted, now());
    if (interrupted) {
      serviceOut.push(0, now());
      manualOut?.push(0, now());
    }
    serverSuppress.speaking = now() + SERVER_SUPPRESS_MS;
  }

  // ---- facts sink (what the bridge calls) -------------------------------------------------------------------------
  const facts: OrbFactsSink = {
    micOpened({ source, passive }) {
      const t = now();
      micOpen = true;
      micPassive = passive;
      micUntil = t + (source === "browser" ? Math.max(leaseMs, BROWSER_MIC_LEASE_MS) : leaseMs);
      refresh();
    },
    micClosed() {
      if (!micOpen && serverSuppress.listening > now()) return;
      micOpen = false;
      serverSuppress.listening = now() + SERVER_SUPPRESS_MS;
      serviceIn.push(0, now());
      manualIn?.push(0, now());
      refresh();
    },
    voiceLevel(levels) {
      const t = now();
      serviceIn.push(levels, t);
      if (micOpen) micUntil = Math.max(micUntil, t + leaseMs);
    },
    transcribing(on, derived) {
      const t = now();
      if (on) {
        transcribing = true;
        transcribingUntil = t + TRANSCRIBING_LEASE_MS;
        transcribingDerived = derived;
        micPassive = true; // the active command capture is over; a passive (wake-word) mic does not count as listening
        serverSuppress.listening = t + SERVER_SUPPRESS_MS;
      } else {
        transcribing = false;
        transcribingDerived = false;
        serverSuppress.transcribing = t + SERVER_SUPPRESS_MS;
      }
      refresh();
    },
    thinking(on, text, derived) {
      const t = now();
      if (on) {
        thinking = true;
        thinkingUntil = t + THINKING_LEASE_MS;
        thinkingText = text;
        thinkingDerived = derived;
        transcribing = false;
        micPassive = true;
      } else {
        thinking = false;
        thinkingText = undefined;
        thinkingDerived = false;
        serverSuppress.thinking = t + SERVER_SUPPRESS_MS;
      }
      refresh();
    },
    taskStarted(task: OrbTaskInfo) {
      const t = now();
      const progress = task.progress === undefined || task.progress === null ? null : normalizeProgress(task.progress);
      const existing = tasks.get(task.taskId);
      tasks.set(task.taskId, {
        title: task.title ?? existing?.title,
        agentName: task.agentName ?? existing?.agentName,
        progress: progress ?? existing?.progress ?? null,
        startedAt: existing?.startedAt ?? t,
        until: t + WORK_LEASE_MS,
      });
      lastTaskId = task.taskId;
      thinking = false; // work began, so the analysis phase is over
      progressHold = null;
      successUntil = 0;
      refresh();
    },
    taskProgress(progress) {
      const t = now();
      const value = progress === null ? null : normalizeProgress(progress);
      const task = lastTaskId ? tasks.get(lastTaskId) : undefined;
      if (task) {
        task.progress = value;
        task.until = t + WORK_LEASE_MS;
      } else {
        orphanProgress = value;
      }
      refresh();
    },
    taskCompleted(taskId, success) {
      const t = now();
      const id = taskId ?? lastTaskId;
      const finished = id ? tasks.get(id) : undefined;
      if (id) tasks.delete(id);
      if (lastTaskId === id) lastTaskId = [...tasks.keys()].at(-1);
      orphanProgress = undefined;
      const remaining = tasks.size > 0 || localAgentCount > 0 || server?.work === "working";
      if (!remaining && success) {
        successUntil = t + SUCCESS_FLASH_MS;
        progressHold = typeof finished?.progress === "number" ? 1 : null; // the progress orbit closes for the flash
      }
      refresh();
    },
    tts(on, info) {
      const t = now();
      if (on) {
        if (!tts) envelope.stop(true, t);
        tts = true;
        ttsUntil = t + TTS_LEASE_MS;
        ttsDerived = info.derived;
        ttsHasAnalysis = info.hasAudioAnalysis;
        thinking = false;
        transcribing = false;
        micPassive = micPassive || micOpen;
      } else {
        if (!tts) return; // end without a start: no-op
        endTts(info.interrupted);
      }
      refresh();
    },
    ttsLevel(levels) {
      const t = now();
      serviceOut.push(levels, t);
      if (tts) ttsUntil = Math.max(ttsUntil, t + Math.max(leaseMs, 5000));
    },
    approval(change) {
      if ("requested" in change) {
        approvals.add(change.requested);
        lastApprovalId = change.requested;
      } else if (change.resolved === undefined) {
        approvals.clear();
        lastApprovalId = undefined;
      } else {
        approvals.delete(change.resolved);
        if (lastApprovalId === change.resolved) lastApprovalId = [...approvals].at(-1);
      }
      refresh();
    },
    warning(message) {
      warningMessage = message;
      refresh();
    },
    error(info) {
      errorInfo = info ? { message: info.message, critical: info.critical } : null;
      refresh();
    },
    sync(on, source) {
      const t = now();
      syncOn = on;
      syncSource = on ? source : undefined;
      syncUntil = t + SYNC_LEASE_MS;
      refresh();
    },
    agents(count, names) {
      const t = now();
      localAgentCount = Math.max(0, Math.round(count));
      localAgentNames = names ?? [];
      agentsUntil = t + SYNC_LEASE_MS;
      refresh();
    },
    connectivity(kind) {
      if (kind === "offline") localOffline = true;
      else if (kind === "online") {
        localOffline = false;
        booting = false;
        if (healthPatch.connectivity === "offline") healthPatch = { ...healthPatch, connectivity: undefined };
      } else if (kind === "paused") localPaused = true;
      else localPaused = false;
      refresh();
    },
    snapshot(snapshot) {
      applySnapshotInternal(snapshot);
    },
    dispose() {
      /* the controller owns the lifetime; nothing extra to release */
    },
  };

  function applySnapshotInternal(snapshot: OrbSnapshot): void {
    const t = now();
    const internal = toInternalLayers(snapshot);
    const prevFlash = server?.snapshot.status.mode === "success" || server?.snapshot.layers.attention === "success";
    server = {
      snapshot,
      receivedAt: t,
      connectivity: internal.layers.connectivity,
      health: snapshot.layers.health,
      voice: internal.layers.voice,
      work: internal.layers.work,
      attention: internal.layers.attention,
    };
    booting = false;
    if (internal.flashSuccess && !prevFlash) successUntil = t + SUCCESS_FLASH_MS;
    // A newer server truth that reports no work retires local task facts older than the grace period.
    if (internal.layers.work !== "working" && snapshot.layers.activeAgentIds.length === 0) {
      for (const [id, task] of tasks) if (t - task.startedAt > SERVER_RECONCILE_GRACE_MS) tasks.delete(id);
      if (tasks.size === 0) lastTaskId = undefined;
    }
    refresh();
  }

  const bridge = createBridge(facts);

  // ---- frame path ------------------------------------------------------------------------------------------------
  function fillInput(nowMs: number, out: OrbAudioFrame): void {
    if (inputSource) {
      if (micOpen) micUntil = Math.max(micUntil, nowMs + leaseMs);
      inputSource.sample(nowMs, out);
    } else if (manualIn) {
      manualIn.sample(nowMs, out);
    } else {
      serviceIn.sample(nowMs, out);
    }
  }

  function fillOutput(nowMs: number, out: OrbAudioFrame, inputs: OrbFrameInputs): void {
    inputs.speechEnvelopeActive = false;
    if (outputSource) {
      if (tts) ttsUntil = Math.max(ttsUntil, nowMs + TTS_LEASE_MS / 4);
      outputSource.sample(nowMs, out);
      return;
    }
    if (manualOut) {
      manualOut.sample(nowMs, out);
      return;
    }
    const speaking = lastPrimary === "speaking";
    const freshService = nowMs - serviceOut.lastPushAt <= SERVICE_FRESH_MS;
    const since = speakingSince >= 0 ? nowMs - speakingSince : 0;
    const needEnvelope = speaking && (ttsHasAnalysis === false || (!freshService && since > ENVELOPE_START_DELAY_MS));
    if (needEnvelope) {
      if (!envelope.running) envelope.start(nowMs);
      envelope.sample(nowMs, out);
      inputs.speechEnvelopeActive = true;
      if (freshService) {
        // the service level scales the envelope instead of being replaced by it (pauses stay visible)
        serviceOut.sample(nowMs, scratch);
        const k = 0.25 + 0.75 * Math.min(1, scratch.rms * 2.5);
        out.rms *= k;
        out.peak *= k;
        out.low *= k;
        out.mid *= k;
        out.high *= k;
      }
      return;
    }
    if (envelope.running) {
      envelope.sample(nowMs, out); // let a stopped envelope release instead of cutting
      if (out.rms > 0.001) {
        inputs.speechEnvelopeActive = true;
        return;
      }
    }
    serviceOut.sample(nowMs, out);
  }

  function readFrame(nowMs: number, inputs: OrbFrameInputs): void {
    if (disposed) {
      clearAudioFrame(inputs.input);
      clearAudioFrame(inputs.output);
      inputs.speechEnvelopeActive = false;
      return;
    }
    try {
      if (expire(nowMs)) refresh();
      fillInput(nowMs, inputs.input);
      fillOutput(nowMs, inputs.output, inputs);
      lastInputLevel = inputs.input.rms;
      lastOutputLevel = inputs.output.rms;
      if (lastPrimary === "listening" && !overrideMode) {
        const detected = inputs.input.gateOpen;
        if (detected !== voiceDetected && nowMs - voiceDetectedChangedAt > VOICE_DETECTED_DWELL_MS) {
          voiceDetected = detected;
          voiceDetectedChangedAt = nowMs;
          refresh();
        }
      } else if (voiceDetected) {
        voiceDetected = false;
        refresh();
      }
    } catch {
      // the frame path must never throw into the render loop: report silence
      clearAudioFrame(inputs.input);
      clearAudioFrame(inputs.output);
    }
  }

  // ---- public API ------------------------------------------------------------------------------------------------
  const controller: OrbController = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    readFrame,
    setMode(mode, opts) {
      overrideMode = mode;
      overrideText = { ...(opts?.activityText !== undefined ? { activityText: opts.activityText } : {}), ...(opts?.detailText !== undefined ? { detailText: opts.detailText } : {}) };
      if (mode === "success") successUntil = 0;
      refresh();
    },
    setInputAudioLevel(level) {
      manualIn ??= createServiceLevelSource({ staleMs: Infinity });
      manualIn.push(level, now());
    },
    setOutputAudioLevel(level) {
      manualOut ??= createServiceLevelSource({ staleMs: Infinity });
      manualOut.push(level, now());
    },
    setInputAudioSource(source) {
      inputSource = source;
    },
    setOutputAudioSource(source) {
      outputSource = source;
    },
    setProgress(progress, mode) {
      if (progress === null && mode === undefined) explicitProgress = { progress: null, mode: "indeterminate" };
      else if (progress === null) explicitProgress = { progress: null, mode: mode === "determinate" ? "none" : mode ?? "indeterminate" };
      else explicitProgress = { progress: normalizeProgress(progress), mode: mode ?? "determinate" };
      refresh();
    },
    setActivity(activityText, detailText) {
      explicitActivity = activityText === undefined && detailText === undefined ? null : { ...(activityText !== undefined ? { activityText } : {}), ...(detailText !== undefined ? { detailText } : {}) };
      refresh();
    },
    setAgentCount(count, names) {
      explicitAgents = { count: Math.max(0, Math.round(count)), names: names ?? [] };
      refresh();
    },
    setApproval(approval) {
      manualApproval = approval === null ? null : { count: approval.count ?? 1, ...(approval.approvalId !== undefined ? { approvalId: approval.approvalId } : {}) };
      refresh();
    },
    setSystemHealth(patch) {
      healthPatch = { ...healthPatch, ...patch };
      refresh();
    },
    applySnapshot: applySnapshotInternal,
    reset() {
      micOpen = false;
      micPassive = false;
      transcribing = false;
      thinking = false;
      thinkingText = undefined;
      if (tts) endTts(true);
      tts = false;
      tasks.clear();
      lastTaskId = undefined;
      orphanProgress = undefined;
      localAgentCount = 0;
      localAgentNames = [];
      syncOn = false;
      syncSource = undefined;
      approvals.clear();
      lastApprovalId = undefined;
      manualApproval = null;
      warningMessage = null;
      errorInfo = null;
      localOffline = false;
      localPaused = false;
      healthPatch = {};
      successUntil = 0;
      progressHold = null;
      overrideMode = null;
      overrideText = {};
      explicitActivity = null;
      explicitProgress = null;
      explicitAgents = null;
      manualIn = null;
      manualOut = null;
      serviceIn.push(0, now());
      serviceOut.push(0, now());
      refresh();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      serviceIn.dispose();
      serviceOut.dispose();
      envelope.dispose();
    },
    bridge,
  };

  lastSig = JSON.stringify({ ...state.status, inputAudioLevel: 0, outputAudioLevel: 0, since: 0 }) + JSON.stringify(state.layers) + (state.overrideMode ?? "");
  return controller;
}
