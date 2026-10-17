import type { OrbSnapshot } from "../contract-types";
import type { OrbAudioLevels } from "../controller/types";

export interface OrbTaskInfo {
  taskId: string;
  title?: string;
  agentName?: string;
  /** 0..1 or null when unknown (then progressMode is indeterminate; percentages are never invented). */
  progress?: number | null;
}
export interface OrbErrorInfo {
  message: string;
  code?: string;
  critical?: boolean;
}

/** Marks a phase that was inferred from other facts instead of being reported (shown as "derived" in debug UIs). */
export interface OrbDerivedInfo {
  derived?: boolean;
}

/**
 * Exchangeable event surface (owner order section 18). Sources (realtime events, browser microphone, TTS player) call
 * only this interface; nothing here knows Hermes, Kimi or a voice framework. Every call is idempotent and tolerant to
 * out-of-order delivery (for example `onTtsEnded` without a start is a no-op).
 */
export interface OrbEventBridge {
  onMicrophoneOpened(info?: { source: "browser" | "service"; passive?: boolean }): void; // passive = wake-word armed, no command yet
  onVoiceActivity(level: number | OrbAudioLevels): void; // 0..1 or analysed/banded levels; refreshes the lease
  onMicrophoneClosed(): void;
  onTranscriptionStarted(info?: OrbDerivedInfo): void;
  onTranscriptionCompleted(): void;
  onThinkingStarted(activityText?: string, info?: OrbDerivedInfo): void;
  onThinkingCompleted(): void;
  onTaskStarted(task: OrbTaskInfo): void;
  onTaskProgress(progress: number | null): void;
  onTaskCompleted(result?: { taskId?: string; success?: boolean }): void; // success -> 1.5 s success flash
  onTtsStarted(info?: { utteranceId?: string; engine?: string; hasAudioAnalysis?: boolean; derived?: boolean }): void;
  onTtsAudioLevel(level: number | OrbAudioLevels): void;
  onTtsEnded(info?: { interrupted?: boolean }): void; // interrupted = barge-in
  onApprovalRequired(approvalId: string): void;
  onWarning(message: string): void;
  onError(error: OrbErrorInfo | Error | string): void;
  // additions (needed for the acceptance tests and the server-truth layers; not in the order's list but required):
  onApprovalResolved(approvalId?: string): void;
  onWarningCleared(): void;
  onErrorCleared(): void;
  onSyncStarted(source?: string): void;
  onSyncFinished(): void;
  onAgentActivity(count: number, names?: readonly string[]): void;
  onOnline(): void;
  onOffline(): void;
  onPaused(): void;
  onResumed(): void;
  onSnapshot(snapshot: OrbSnapshot): void; // friday.orb.status_changed
  dispose(): void;
}
