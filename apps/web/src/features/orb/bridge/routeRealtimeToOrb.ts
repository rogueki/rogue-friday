import type { FridayEvent, Task, VoiceStatus } from "@friday/sdk";
import type { OrbAudioLevels, OrbEventBridge } from "../orbApi";
import type { OrbAudioSources } from "./audioSources";

/**
 * Realtime events -> OrbEventBridge (docs/ORB_REWORK_ANALYSIS.md §8 (c)). The orb state is derived from events and
 * never from visible text. The router keeps only the minimum bookkeeping that the bridge cannot know itself: which
 * sources currently hold an error/warning, which tasks run, whether a TTS utterance is active and which microphone
 * facts were already announced (so repeated `state_changed` events do not repeat bridge calls).
 *
 * Events are routed AFTER the query cache was updated, so cache-backed truths (working agents, pending approvals) are
 * current when the router asks for them.
 */

export interface OrbRouterDeps {
  bridge: OrbEventBridge;
  audio: Pick<OrbAudioSources, "pushServiceInput" | "pushServiceOutput" | "beginSpeech" | "endSpeech" | "reset">;
  /** The browser voice path (local microphone analyser + real TTS playback) owns mic/TTS facts while it is active. */
  browserVoiceActive(): boolean;
  /** Agents with status working/starting according to the cache (names resolved there). */
  workingAgents(): readonly { id: string; name: string }[];
  pendingApprovalIds(): readonly string[];
  /** Timers are injectable for tests. */
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface OrbRealtimeRouter {
  route(event: FridayEvent): void;
  /** Transport state of the event stream: `offline` -> `onOffline`, back -> `onOnline`. */
  setConnection(state: "connecting" | "online" | "degraded" | "offline" | "polling"): void;
  /** Gap/resync: drop transient audio and service-owned microphone/TTS facts (server snapshot restores the rest). */
  resync(): void;
  dispose(): void;
}

/** How long a failed task keeps the orb in `error` before the router lets go (the server snapshot decides afterwards). */
export const TASK_ERROR_HOLD_MS = 8_000;

/** Wake-word armed and nothing said yet: the microphone is open but passive (orb stays idle). */
export function isMicrophonePassive(voice: VoiceStatus | undefined): boolean {
  if (!voice) return false;
  if (voice.mode === "listening" || voice.microphone.state === "listening") return false;
  if (voice.wakeWord.state === "triggered") return false;
  return voice.wakeWord.enabled && voice.wakeWord.state === "armed";
}

/** Level fact of a `friday.voice.audio_level` event; band fields are optional (not every source analyses the spectrum). */
function levelsOf(data: { level: number; peak?: number; low?: number; mid?: number; high?: number }): OrbAudioLevels {
  return {
    level: data.level,
    ...(typeof data.peak === "number" ? { peak: data.peak } : {}),
    ...(typeof data.low === "number" ? { low: data.low } : {}),
    ...(typeof data.mid === "number" ? { mid: data.mid } : {}),
    ...(typeof data.high === "number" ? { high: data.high } : {}),
  };
}

interface TrackedTask {
  title: string;
  agentName?: string;
}

export function createOrbRealtimeRouter(deps: OrbRouterDeps): OrbRealtimeRouter {
  const { bridge, audio } = deps;
  const setTimer = deps.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  const errorSources = new Set<string>();
  const warningSources = new Set<string>();
  const errorTimers = new Map<string, unknown>();
  const tasks = new Map<string, TrackedTask>();
  let currentTaskId: string | null = null;
  let voiceMode: VoiceStatus["mode"] | null = null;
  let micFact: string | null = null; // "service:open", "service:passive", "browser:passive", ...
  let ttsActive = false;
  let ttsFromState = false;
  let offline = false;

  const addError = (key: string, message: string, code: string): void => {
    errorSources.add(key);
    bridge.onError({ message, code, critical: true });
  };
  const removeError = (key: string): void => {
    if (!errorSources.delete(key)) return;
    const timer = errorTimers.get(key);
    if (timer !== undefined) {
      clearTimer(timer);
      errorTimers.delete(key);
    }
    if (errorSources.size === 0) bridge.onErrorCleared();
  };
  const addTimedError = (key: string, message: string, code: string, ms: number): void => {
    const previous = errorTimers.get(key);
    if (previous !== undefined) clearTimer(previous);
    addError(key, message, code);
    errorTimers.set(key, setTimer(() => removeError(key), ms));
  };
  const addWarning = (key: string, message: string): void => {
    warningSources.add(key);
    bridge.onWarning(message);
  };
  const removeWarning = (key: string): void => {
    if (warningSources.delete(key) && warningSources.size === 0) bridge.onWarningCleared();
  };

  const announceMicrophone = (source: "browser" | "service", open: boolean, passive: boolean): void => {
    const fact = open ? `${source}:${passive ? "passive" : "open"}` : "closed";
    if (fact === micFact) return;
    micFact = fact;
    if (open) bridge.onMicrophoneOpened({ source, passive });
    else bridge.onMicrophoneClosed();
  };

  const startTts = (info: { utteranceId?: string; engine?: string }, fromState: boolean): void => {
    ttsActive = true;
    ttsFromState = fromState;
    audio.beginSpeech({ hasAudioAnalysis: false });
    bridge.onTtsStarted({ ...info, hasAudioAnalysis: false });
  };
  const endTts = (interrupted: boolean): void => {
    if (!ttsActive) return;
    ttsActive = false;
    ttsFromState = false;
    audio.endSpeech(interrupted);
    bridge.onTtsEnded({ interrupted });
  };

  const onVoiceState = (voice: VoiceStatus): void => {
    const browser = deps.browserVoiceActive();
    const previous = voiceMode;
    voiceMode = voice.mode;

    // Microphone: the browser path announces open/close itself; here only the passive/active distinction is refined.
    if (browser) {
      announceMicrophone("browser", true, isMicrophonePassive(voice));
    } else if (!voice.microphone.active || voice.microphone.state === "off" || voice.microphone.state === "muted") {
      announceMicrophone("service", false, false);
    } else {
      const talking = voice.mode === "listening" || voice.microphone.state === "listening" || voice.wakeWord.state === "triggered";
      announceMicrophone("service", true, !talking);
    }

    if (voice.mode === "transcribing" && previous !== "transcribing") bridge.onTranscriptionStarted();
    else if (previous === "transcribing" && voice.mode !== "transcribing") bridge.onTranscriptionCompleted();
    if (voice.mode === "thinking" && previous !== "thinking") bridge.onThinkingStarted();
    else if (previous === "thinking" && voice.mode !== "thinking") bridge.onThinkingCompleted();

    // A voice service that only reports `speaking` (no tts events) still drives the speaking state.
    if (!browser) {
      if (voice.mode === "speaking" && !ttsActive) startTts({ engine: voice.tts.engine }, true);
      else if (voice.mode !== "speaking" && ttsActive && ttsFromState) endTts(false);
    }

    if (voice.mode === "error") {
      if (!errorSources.has("voice")) addError("voice", "Sprachdienst meldet einen Fehler", "voice_error");
    } else {
      removeError("voice");
    }
  };

  const onTask = (type: string, task: Task): void => {
    const progress = task.progress.mode === "determinate" ? task.progress.value : null;
    if (type === "friday.task.completed") {
      tasks.delete(task.id);
      if (currentTaskId === task.id) currentTaskId = null;
      bridge.onTaskCompleted({ taskId: task.id, success: true });
      return;
    }
    if (type === "friday.task.failed") {
      tasks.delete(task.id);
      if (currentTaskId === task.id) currentTaskId = null;
      bridge.onTaskCompleted({ taskId: task.id, success: false });
      addTimedError(`task:${task.id}`, `Aufgabe fehlgeschlagen: ${task.title}`, "task_failed", TASK_ERROR_HOLD_MS);
      return;
    }
    if (type === "friday.task.cancelled") {
      tasks.delete(task.id);
      if (currentTaskId === task.id) currentTaskId = null;
      bridge.onTaskCompleted({ taskId: task.id, success: false });
      return;
    }
    if (task.status !== "running") return;
    const known = tasks.has(task.id);
    tasks.set(task.id, { title: task.title, ...(task.agentName ? { agentName: task.agentName } : {}) });
    currentTaskId = task.id;
    if (!known) bridge.onTaskStarted({ taskId: task.id, title: task.title, ...(task.agentName ? { agentName: task.agentName } : {}), progress });
    else bridge.onTaskProgress(progress);
  };

  const syncAgents = (): void => {
    const agents = deps.workingAgents();
    bridge.onAgentActivity(agents.length, agents.map((agent) => agent.name));
  };

  return {
    route(event) {
      switch (event.type) {
        case "friday.orb.status_changed":
          bridge.onSnapshot(event.data);
          return;

        case "friday.voice.state_changed":
          onVoiceState(event.data);
          return;
        case "friday.voice.audio_level": {
          if (deps.browserVoiceActive()) return; // the local analysers are the real signal while the browser voice path runs
          const levels = levelsOf(event.data);
          if (event.data.direction === "input") {
            audio.pushServiceInput(levels);
            bridge.onVoiceActivity(levels);
          } else {
            audio.pushServiceOutput(levels);
            if (ttsActive) bridge.onTtsAudioLevel(levels);
          }
          return;
        }
        case "friday.voice.transcript_partial":
          bridge.onTranscriptionStarted(); // only the fact; the text is never stored here
          return;
        case "friday.voice.transcript_final":
          bridge.onTranscriptionCompleted();
          return;
        case "friday.voice.tts_started":
          if (deps.browserVoiceActive()) return; // real playback of the browser path decides start and end
          if (ttsActive) endTts(true);
          startTts({ utteranceId: event.data.utteranceId, engine: event.data.engine }, false);
          return;
        case "friday.voice.tts_ended":
          if (deps.browserVoiceActive()) return;
          endTts(event.data.interrupted);
          return;

        case "friday.task.created":
        case "friday.task.updated":
        case "friday.task.completed":
        case "friday.task.failed":
        case "friday.task.cancelled":
          onTask(event.type, event.data);
          return;
        case "friday.task.progress": {
          const { taskId, progress } = event.data;
          const value = progress.mode === "determinate" ? progress.value : null;
          if (!tasks.has(taskId)) {
            tasks.set(taskId, { title: taskId });
            currentTaskId = taskId;
            bridge.onTaskStarted({ taskId, progress: value });
          } else if (currentTaskId === taskId) {
            bridge.onTaskProgress(value);
          }
          return;
        }

        case "friday.agent.status_changed":
        case "friday.agent.heartbeat":
          syncAgents();
          return;

        case "friday.approval.requested":
          if (event.data.status === "pending") bridge.onApprovalRequired(event.data.id);
          return;
        case "friday.approval.resolved":
        case "friday.approval.expired": {
          bridge.onApprovalResolved(event.data.id);
          const [next] = deps.pendingApprovalIds().filter((id) => id !== event.data.id);
          if (next) bridge.onApprovalRequired(next);
          return;
        }

        case "friday.notification.created":
        case "friday.notification.updated": {
          const notification = event.data;
          const open = notification.status === "open";
          if (notification.priority === "P0") {
            if (open) addError(`notification:${notification.id}`, notification.title, `notification_${notification.category}`);
            else removeError(`notification:${notification.id}`);
          } else if (notification.priority === "P1") {
            if (open) addWarning(`notification:${notification.id}`, notification.title);
            else removeWarning(`notification:${notification.id}`);
          }
          return;
        }
        case "friday.adapter.health_changed": {
          const { adapterId, status } = event.data;
          if (status === "degraded" || status === "offline") addWarning(`adapter:${adapterId}`, `Adapter ${adapterId} eingeschränkt`);
          else removeWarning(`adapter:${adapterId}`);
          return;
        }
        default:
          return;
      }
    },

    setConnection(state) {
      if (state === "offline" && !offline) {
        offline = true;
        bridge.onOffline();
      } else if (state !== "offline" && offline) {
        offline = false;
        bridge.onOnline();
      }
    },

    resync() {
      audio.reset();
      if (ttsActive) endTts(true);
      if (!deps.browserVoiceActive() && micFact !== null && micFact !== "closed") announceMicrophone("service", false, false);
      voiceMode = null;
    },

    dispose() {
      for (const handle of errorTimers.values()) clearTimer(handle);
      errorTimers.clear();
      errorSources.clear();
      warningSources.clear();
      tasks.clear();
    },
  };
}
