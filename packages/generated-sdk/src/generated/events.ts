// GENERATED — do not edit. Source of truth: packages/contracts (run `pnpm contracts:generate`).

/* eslint-disable */
import type { EventEnvelope, ActivityEvent, AdapterHealth, Agent, AgentHeartbeat, Approval, AuditEvent, Automation, AutomationRun, CalendarConflict, CalendarEvent, Capabilities, Draft, FileItem, JarvisStatus, Memory, Notification, OrbSnapshot, ResearchFinding, ResearchProject, ResearchSource, ResourceDeleted, ResyncRequired, Service, SystemMetrics, Task, TaskProgressEvent, Thread, VoiceAudioLevel, VoiceStatus, VoiceTranscript, VoiceTtsEnded, VoiceTtsStarted } from "./models";

export const JARVIS_EVENT_TYPES = [
  "jarvis.activity.appended",
  "jarvis.adapter.capabilities_changed",
  "jarvis.adapter.health_changed",
  "jarvis.agent.heartbeat",
  "jarvis.agent.status_changed",
  "jarvis.approval.expired",
  "jarvis.approval.requested",
  "jarvis.approval.resolved",
  "jarvis.audit.appended",
  "jarvis.automation.run_finished",
  "jarvis.automation.run_started",
  "jarvis.automation.updated",
  "jarvis.calendar.conflict_detected",
  "jarvis.calendar.event_updated",
  "jarvis.communication.draft_updated",
  "jarvis.communication.thread_updated",
  "jarvis.file.created",
  "jarvis.file.deleted",
  "jarvis.file.updated",
  "jarvis.memory.created",
  "jarvis.memory.deleted",
  "jarvis.memory.updated",
  "jarvis.notification.created",
  "jarvis.notification.updated",
  "jarvis.orb.status_changed",
  "jarvis.research.finding_added",
  "jarvis.research.source_added",
  "jarvis.research.updated",
  "jarvis.status.changed",
  "jarvis.status.resync_required",
  "jarvis.system.metrics",
  "jarvis.system.service_status_changed",
  "jarvis.task.cancelled",
  "jarvis.task.completed",
  "jarvis.task.created",
  "jarvis.task.failed",
  "jarvis.task.progress",
  "jarvis.task.updated",
  "jarvis.voice.audio_level",
  "jarvis.voice.state_changed",
  "jarvis.voice.transcript_final",
  "jarvis.voice.transcript_partial",
  "jarvis.voice.tts_ended",
  "jarvis.voice.tts_started",
] as const;

export type JarvisEventType = (typeof JARVIS_EVENT_TYPES)[number];

/** Event type -> payload type (`data` of the envelope). */
export interface JarvisEventMap {
  "jarvis.activity.appended": ActivityEvent;
  "jarvis.adapter.capabilities_changed": Capabilities;
  "jarvis.adapter.health_changed": AdapterHealth;
  "jarvis.agent.heartbeat": AgentHeartbeat;
  "jarvis.agent.status_changed": Agent;
  "jarvis.approval.expired": Approval;
  "jarvis.approval.requested": Approval;
  "jarvis.approval.resolved": Approval;
  "jarvis.audit.appended": AuditEvent;
  "jarvis.automation.run_finished": AutomationRun;
  "jarvis.automation.run_started": AutomationRun;
  "jarvis.automation.updated": Automation;
  "jarvis.calendar.conflict_detected": CalendarConflict;
  "jarvis.calendar.event_updated": CalendarEvent;
  "jarvis.communication.draft_updated": Draft;
  "jarvis.communication.thread_updated": Thread;
  "jarvis.file.created": FileItem;
  "jarvis.file.deleted": ResourceDeleted;
  "jarvis.file.updated": FileItem;
  "jarvis.memory.created": Memory;
  "jarvis.memory.deleted": ResourceDeleted;
  "jarvis.memory.updated": Memory;
  "jarvis.notification.created": Notification;
  "jarvis.notification.updated": Notification;
  "jarvis.orb.status_changed": OrbSnapshot;
  "jarvis.research.finding_added": ResearchFinding;
  "jarvis.research.source_added": ResearchSource;
  "jarvis.research.updated": ResearchProject;
  "jarvis.status.changed": JarvisStatus;
  "jarvis.status.resync_required": ResyncRequired;
  "jarvis.system.metrics": SystemMetrics;
  "jarvis.system.service_status_changed": Service;
  "jarvis.task.cancelled": Task;
  "jarvis.task.completed": Task;
  "jarvis.task.created": Task;
  "jarvis.task.failed": Task;
  "jarvis.task.progress": TaskProgressEvent;
  "jarvis.task.updated": Task;
  "jarvis.voice.audio_level": VoiceAudioLevel;
  "jarvis.voice.state_changed": VoiceStatus;
  "jarvis.voice.transcript_final": VoiceTranscript;
  "jarvis.voice.transcript_partial": VoiceTranscript;
  "jarvis.voice.tts_ended": VoiceTtsEnded;
  "jarvis.voice.tts_started": VoiceTtsStarted;
}

/** Event type -> $id of the JSON Schema that validates `data`. */
export const JARVIS_EVENT_DATA_SCHEMA_IDS: Readonly<Record<JarvisEventType, string>> = {
  "jarvis.activity.appended": "https://jarvis.local/schemas/activity/activity-event.schema.json",
  "jarvis.adapter.capabilities_changed": "https://jarvis.local/schemas/meta/capabilities.schema.json",
  "jarvis.adapter.health_changed": "https://jarvis.local/schemas/meta/adapter-health.schema.json",
  "jarvis.agent.heartbeat": "https://jarvis.local/schemas/events/agent-heartbeat.schema.json",
  "jarvis.agent.status_changed": "https://jarvis.local/schemas/agents/agent.schema.json",
  "jarvis.approval.expired": "https://jarvis.local/schemas/approvals/approval.schema.json",
  "jarvis.approval.requested": "https://jarvis.local/schemas/approvals/approval.schema.json",
  "jarvis.approval.resolved": "https://jarvis.local/schemas/approvals/approval.schema.json",
  "jarvis.audit.appended": "https://jarvis.local/schemas/audit/audit-event.schema.json",
  "jarvis.automation.run_finished": "https://jarvis.local/schemas/automations/automation-run.schema.json",
  "jarvis.automation.run_started": "https://jarvis.local/schemas/automations/automation-run.schema.json",
  "jarvis.automation.updated": "https://jarvis.local/schemas/automations/automation.schema.json",
  "jarvis.calendar.conflict_detected": "https://jarvis.local/schemas/calendar/calendar-conflict.schema.json",
  "jarvis.calendar.event_updated": "https://jarvis.local/schemas/calendar/calendar-event.schema.json",
  "jarvis.communication.draft_updated": "https://jarvis.local/schemas/communication/draft.schema.json",
  "jarvis.communication.thread_updated": "https://jarvis.local/schemas/communication/thread.schema.json",
  "jarvis.file.created": "https://jarvis.local/schemas/files/file-item.schema.json",
  "jarvis.file.deleted": "https://jarvis.local/schemas/common/resource-deleted.schema.json",
  "jarvis.file.updated": "https://jarvis.local/schemas/files/file-item.schema.json",
  "jarvis.memory.created": "https://jarvis.local/schemas/memory/memory.schema.json",
  "jarvis.memory.deleted": "https://jarvis.local/schemas/common/resource-deleted.schema.json",
  "jarvis.memory.updated": "https://jarvis.local/schemas/memory/memory.schema.json",
  "jarvis.notification.created": "https://jarvis.local/schemas/notifications/notification.schema.json",
  "jarvis.notification.updated": "https://jarvis.local/schemas/notifications/notification.schema.json",
  "jarvis.orb.status_changed": "https://jarvis.local/schemas/orb/orb-snapshot.schema.json",
  "jarvis.research.finding_added": "https://jarvis.local/schemas/research/research-finding.schema.json",
  "jarvis.research.source_added": "https://jarvis.local/schemas/research/research-source.schema.json",
  "jarvis.research.updated": "https://jarvis.local/schemas/research/research-project.schema.json",
  "jarvis.status.changed": "https://jarvis.local/schemas/meta/jarvis-status.schema.json",
  "jarvis.status.resync_required": "https://jarvis.local/schemas/events/resync-required.schema.json",
  "jarvis.system.metrics": "https://jarvis.local/schemas/system/system-metrics.schema.json",
  "jarvis.system.service_status_changed": "https://jarvis.local/schemas/system/service.schema.json",
  "jarvis.task.cancelled": "https://jarvis.local/schemas/tasks/task.schema.json",
  "jarvis.task.completed": "https://jarvis.local/schemas/tasks/task.schema.json",
  "jarvis.task.created": "https://jarvis.local/schemas/tasks/task.schema.json",
  "jarvis.task.failed": "https://jarvis.local/schemas/tasks/task.schema.json",
  "jarvis.task.progress": "https://jarvis.local/schemas/events/task-progress.schema.json",
  "jarvis.task.updated": "https://jarvis.local/schemas/tasks/task.schema.json",
  "jarvis.voice.audio_level": "https://jarvis.local/schemas/events/voice-audio-level.schema.json",
  "jarvis.voice.state_changed": "https://jarvis.local/schemas/voice/voice-status.schema.json",
  "jarvis.voice.transcript_final": "https://jarvis.local/schemas/events/voice-transcript.schema.json",
  "jarvis.voice.transcript_partial": "https://jarvis.local/schemas/events/voice-transcript.schema.json",
  "jarvis.voice.tts_ended": "https://jarvis.local/schemas/events/voice-tts-ended.schema.json",
  "jarvis.voice.tts_started": "https://jarvis.local/schemas/events/voice-tts-started.schema.json",
};

/** CloudEvents-inspired envelope; `data` is typed per event type. */
export type JarvisEventEnvelope<T = unknown> = Omit<EventEnvelope, "data"> & { data: T };

/** Discriminated union of all typed events (narrow on `type`). */
export type JarvisEvent<K extends JarvisEventType = JarvisEventType> = {
  [P in K]: JarvisEventEnvelope<JarvisEventMap[P]> & { type: P };
}[K];
