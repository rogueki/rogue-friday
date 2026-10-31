// GENERATED — do not edit. Source of truth: packages/contracts (run `pnpm contracts:generate`).

/* eslint-disable */
import type { EventEnvelope, ActivityEvent, AdapterHealth, Agent, AgentHeartbeat, Approval, AuditEvent, Automation, AutomationRun, CalendarConflict, CalendarEvent, Capabilities, DashboardNavigation, Draft, FileItem, FridayStatus, Memory, Notification, OrbSnapshot, ResearchFinding, ResearchProject, ResearchSource, ResourceDeleted, ResyncRequired, Service, SystemMetrics, Task, TaskProgressEvent, Thread, VoiceAudioLevel, VoiceStatus, VoiceTranscript, VoiceTtsEnded, VoiceTtsStarted } from "./models";

export const FRIDAY_EVENT_TYPES = [
  "friday.activity.appended",
  "friday.adapter.capabilities_changed",
  "friday.adapter.health_changed",
  "friday.agent.heartbeat",
  "friday.agent.status_changed",
  "friday.approval.expired",
  "friday.approval.requested",
  "friday.approval.resolved",
  "friday.audit.appended",
  "friday.automation.run_finished",
  "friday.automation.run_started",
  "friday.automation.updated",
  "friday.calendar.conflict_detected",
  "friday.calendar.event_updated",
  "friday.communication.draft_updated",
  "friday.communication.thread_updated",
  "friday.file.created",
  "friday.file.deleted",
  "friday.file.updated",
  "friday.memory.created",
  "friday.memory.deleted",
  "friday.memory.updated",
  "friday.notification.created",
  "friday.notification.updated",
  "friday.orb.status_changed",
  "friday.research.finding_added",
  "friday.research.source_added",
  "friday.research.updated",
  "friday.status.changed",
  "friday.status.resync_required",
  "friday.system.metrics",
  "friday.system.service_status_changed",
  "friday.task.cancelled",
  "friday.task.completed",
  "friday.task.created",
  "friday.task.failed",
  "friday.task.progress",
  "friday.task.updated",
  "friday.ui.navigation_requested",
  "friday.voice.audio_level",
  "friday.voice.state_changed",
  "friday.voice.transcript_final",
  "friday.voice.transcript_partial",
  "friday.voice.tts_ended",
  "friday.voice.tts_started",
] as const;

export type FridayEventType = (typeof FRIDAY_EVENT_TYPES)[number];

/** Event type -> payload type (`data` of the envelope). */
export interface FridayEventMap {
  "friday.activity.appended": ActivityEvent;
  "friday.adapter.capabilities_changed": Capabilities;
  "friday.adapter.health_changed": AdapterHealth;
  "friday.agent.heartbeat": AgentHeartbeat;
  "friday.agent.status_changed": Agent;
  "friday.approval.expired": Approval;
  "friday.approval.requested": Approval;
  "friday.approval.resolved": Approval;
  "friday.audit.appended": AuditEvent;
  "friday.automation.run_finished": AutomationRun;
  "friday.automation.run_started": AutomationRun;
  "friday.automation.updated": Automation;
  "friday.calendar.conflict_detected": CalendarConflict;
  "friday.calendar.event_updated": CalendarEvent;
  "friday.communication.draft_updated": Draft;
  "friday.communication.thread_updated": Thread;
  "friday.file.created": FileItem;
  "friday.file.deleted": ResourceDeleted;
  "friday.file.updated": FileItem;
  "friday.memory.created": Memory;
  "friday.memory.deleted": ResourceDeleted;
  "friday.memory.updated": Memory;
  "friday.notification.created": Notification;
  "friday.notification.updated": Notification;
  "friday.orb.status_changed": OrbSnapshot;
  "friday.research.finding_added": ResearchFinding;
  "friday.research.source_added": ResearchSource;
  "friday.research.updated": ResearchProject;
  "friday.status.changed": FridayStatus;
  "friday.status.resync_required": ResyncRequired;
  "friday.system.metrics": SystemMetrics;
  "friday.system.service_status_changed": Service;
  "friday.task.cancelled": Task;
  "friday.task.completed": Task;
  "friday.task.created": Task;
  "friday.task.failed": Task;
  "friday.task.progress": TaskProgressEvent;
  "friday.task.updated": Task;
  "friday.ui.navigation_requested": DashboardNavigation;
  "friday.voice.audio_level": VoiceAudioLevel;
  "friday.voice.state_changed": VoiceStatus;
  "friday.voice.transcript_final": VoiceTranscript;
  "friday.voice.transcript_partial": VoiceTranscript;
  "friday.voice.tts_ended": VoiceTtsEnded;
  "friday.voice.tts_started": VoiceTtsStarted;
}

/** Event type -> $id of the JSON Schema that validates `data`. */
export const FRIDAY_EVENT_DATA_SCHEMA_IDS: Readonly<Record<FridayEventType, string>> = {
  "friday.activity.appended": "https://friday.local/schemas/activity/activity-event.schema.json",
  "friday.adapter.capabilities_changed": "https://friday.local/schemas/meta/capabilities.schema.json",
  "friday.adapter.health_changed": "https://friday.local/schemas/meta/adapter-health.schema.json",
  "friday.agent.heartbeat": "https://friday.local/schemas/events/agent-heartbeat.schema.json",
  "friday.agent.status_changed": "https://friday.local/schemas/agents/agent.schema.json",
  "friday.approval.expired": "https://friday.local/schemas/approvals/approval.schema.json",
  "friday.approval.requested": "https://friday.local/schemas/approvals/approval.schema.json",
  "friday.approval.resolved": "https://friday.local/schemas/approvals/approval.schema.json",
  "friday.audit.appended": "https://friday.local/schemas/audit/audit-event.schema.json",
  "friday.automation.run_finished": "https://friday.local/schemas/automations/automation-run.schema.json",
  "friday.automation.run_started": "https://friday.local/schemas/automations/automation-run.schema.json",
  "friday.automation.updated": "https://friday.local/schemas/automations/automation.schema.json",
  "friday.calendar.conflict_detected": "https://friday.local/schemas/calendar/calendar-conflict.schema.json",
  "friday.calendar.event_updated": "https://friday.local/schemas/calendar/calendar-event.schema.json",
  "friday.communication.draft_updated": "https://friday.local/schemas/communication/draft.schema.json",
  "friday.communication.thread_updated": "https://friday.local/schemas/communication/thread.schema.json",
  "friday.file.created": "https://friday.local/schemas/files/file-item.schema.json",
  "friday.file.deleted": "https://friday.local/schemas/common/resource-deleted.schema.json",
  "friday.file.updated": "https://friday.local/schemas/files/file-item.schema.json",
  "friday.memory.created": "https://friday.local/schemas/memory/memory.schema.json",
  "friday.memory.deleted": "https://friday.local/schemas/common/resource-deleted.schema.json",
  "friday.memory.updated": "https://friday.local/schemas/memory/memory.schema.json",
  "friday.notification.created": "https://friday.local/schemas/notifications/notification.schema.json",
  "friday.notification.updated": "https://friday.local/schemas/notifications/notification.schema.json",
  "friday.orb.status_changed": "https://friday.local/schemas/orb/orb-snapshot.schema.json",
  "friday.research.finding_added": "https://friday.local/schemas/research/research-finding.schema.json",
  "friday.research.source_added": "https://friday.local/schemas/research/research-source.schema.json",
  "friday.research.updated": "https://friday.local/schemas/research/research-project.schema.json",
  "friday.status.changed": "https://friday.local/schemas/meta/friday-status.schema.json",
  "friday.status.resync_required": "https://friday.local/schemas/events/resync-required.schema.json",
  "friday.system.metrics": "https://friday.local/schemas/system/system-metrics.schema.json",
  "friday.system.service_status_changed": "https://friday.local/schemas/system/service.schema.json",
  "friday.task.cancelled": "https://friday.local/schemas/tasks/task.schema.json",
  "friday.task.completed": "https://friday.local/schemas/tasks/task.schema.json",
  "friday.task.created": "https://friday.local/schemas/tasks/task.schema.json",
  "friday.task.failed": "https://friday.local/schemas/tasks/task.schema.json",
  "friday.task.progress": "https://friday.local/schemas/events/task-progress.schema.json",
  "friday.task.updated": "https://friday.local/schemas/tasks/task.schema.json",
  "friday.ui.navigation_requested": "https://friday.local/schemas/ui/dashboard-navigation.schema.json",
  "friday.voice.audio_level": "https://friday.local/schemas/events/voice-audio-level.schema.json",
  "friday.voice.state_changed": "https://friday.local/schemas/voice/voice-status.schema.json",
  "friday.voice.transcript_final": "https://friday.local/schemas/events/voice-transcript.schema.json",
  "friday.voice.transcript_partial": "https://friday.local/schemas/events/voice-transcript.schema.json",
  "friday.voice.tts_ended": "https://friday.local/schemas/events/voice-tts-ended.schema.json",
  "friday.voice.tts_started": "https://friday.local/schemas/events/voice-tts-started.schema.json",
};

/** CloudEvents-inspired envelope; `data` is typed per event type. */
export type FridayEventEnvelope<T = unknown> = Omit<EventEnvelope, "data"> & { data: T };

/** Discriminated union of all typed events (narrow on `type`). */
export type FridayEvent<K extends FridayEventType = FridayEventType> = {
  [P in K]: FridayEventEnvelope<FridayEventMap[P]> & { type: P };
}[K];
