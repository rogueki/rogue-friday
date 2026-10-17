import type { OrbSnapshot } from "../contract-types";
import type { OrbAudioLevels, OrbController } from "../controller/types";
import type { OrbErrorInfo, OrbEventBridge, OrbTaskInfo } from "./OrbEventBridge";

/** Normalised facts the controller understands; the bridge maps the order's event vocabulary onto them. */
export interface OrbFactsSink {
  micOpened(info: { source: "browser" | "service"; passive: boolean }): void;
  micClosed(): void;
  voiceLevel(levels: number | OrbAudioLevels): void;
  transcribing(on: boolean, derived: boolean): void;
  thinking(on: boolean, activityText: string | undefined, derived: boolean): void;
  taskStarted(task: OrbTaskInfo): void;
  taskProgress(progress: number | null): void;
  taskCompleted(taskId: string | undefined, success: boolean): void;
  tts(on: boolean, info: { interrupted: boolean; hasAudioAnalysis?: boolean; derived: boolean; utteranceId?: string }): void;
  ttsLevel(levels: number | OrbAudioLevels): void;
  approval(change: { requested: string } | { resolved: string | undefined }): void;
  warning(message: string | null): void;
  error(info: (OrbErrorInfo & { critical: boolean }) | null): void;
  sync(on: boolean, source: string | undefined): void;
  agents(count: number, names: readonly string[] | undefined): void;
  connectivity(kind: "online" | "offline" | "paused" | "resumed"): void;
  snapshot(snapshot: OrbSnapshot): void;
  dispose(): void;
}

function normaliseError(error: OrbErrorInfo | Error | string): OrbErrorInfo & { critical: boolean } {
  if (typeof error === "string") return { message: error, critical: true };
  if (error instanceof Error) return { message: error.message || error.name, critical: true };
  return { message: error.message, ...(error.code !== undefined ? { code: error.code } : {}), critical: error.critical ?? true };
}

/**
 * Builds the bridge on top of a facts sink. Every method is idempotent: it sets or clears a fact, so repeated or
 * out-of-order delivery (an end without a start, a start twice) cannot leave a stuck or doubled state.
 */
export function createBridge(facts: OrbFactsSink): OrbEventBridge {
  let disposed = false;
  const guard =
    <A extends unknown[]>(fn: (...args: A) => void) =>
    (...args: A): void => {
      if (!disposed) fn(...args);
    };
  return {
    onMicrophoneOpened: guard((info) => facts.micOpened({ source: info?.source ?? "browser", passive: info?.passive ?? false })),
    onVoiceActivity: guard((level) => facts.voiceLevel(level)),
    onMicrophoneClosed: guard(() => facts.micClosed()),
    onTranscriptionStarted: guard((info) => facts.transcribing(true, info?.derived ?? false)),
    onTranscriptionCompleted: guard(() => facts.transcribing(false, false)),
    onThinkingStarted: guard((text, info) => facts.thinking(true, text, info?.derived ?? false)),
    onThinkingCompleted: guard(() => facts.thinking(false, undefined, false)),
    onTaskStarted: guard((task) => facts.taskStarted(task)),
    onTaskProgress: guard((progress) => facts.taskProgress(progress)),
    onTaskCompleted: guard((result) => facts.taskCompleted(result?.taskId, result?.success ?? true)),
    onTtsStarted: guard((info) =>
      facts.tts(true, {
        interrupted: false,
        derived: info?.derived ?? false,
        ...(info?.hasAudioAnalysis !== undefined ? { hasAudioAnalysis: info.hasAudioAnalysis } : {}),
        ...(info?.utteranceId !== undefined ? { utteranceId: info.utteranceId } : {}),
      }),
    ),
    onTtsAudioLevel: guard((level) => facts.ttsLevel(level)),
    onTtsEnded: guard((info) => facts.tts(false, { interrupted: info?.interrupted ?? false, derived: false })),
    onApprovalRequired: guard((approvalId) => facts.approval({ requested: approvalId })),
    onApprovalResolved: guard((approvalId) => facts.approval({ resolved: approvalId })),
    onWarning: guard((message) => facts.warning(message)),
    onWarningCleared: guard(() => facts.warning(null)),
    onError: guard((error) => facts.error(normaliseError(error))),
    onErrorCleared: guard(() => facts.error(null)),
    onSyncStarted: guard((source) => facts.sync(true, source)),
    onSyncFinished: guard(() => facts.sync(false, undefined)),
    onAgentActivity: guard((count, names) => facts.agents(count, names)),
    onOnline: guard(() => facts.connectivity("online")),
    onOffline: guard(() => facts.connectivity("offline")),
    onPaused: guard(() => facts.connectivity("paused")),
    onResumed: guard(() => facts.connectivity("resumed")),
    onSnapshot: guard((snapshot) => facts.snapshot(snapshot)),
    dispose() {
      if (disposed) return;
      disposed = true;
      facts.dispose();
    },
  };
}

/**
 * The bridge of a controller. A controller owns exactly one bridge (it shares the controller's lifetime), so this returns
 * `controller.bridge`; it exists so sources depend on the bridge interface, not on how the controller builds it.
 */
export function createOrbEventBridge(controller: OrbController): OrbEventBridge {
  return controller.bridge;
}
