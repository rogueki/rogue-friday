// GENERATED — do not edit. Source of truth: packages/contracts (run `pnpm contracts:generate`).
/* eslint-disable */
/**
 * Semantic version of the wire contract, e.g. 1.0.0.
 */
export type ContractVersion = string;
export type ActivityKind =
  | "user_request"
  | "task"
  | "agent"
  | "tool_call"
  | "source_read"
  | "result"
  | "artifact"
  | "adapter"
  | "system";
export type Severity = "info" | "warning" | "error" | "critical";
export type ErrorCode =
  | "ADAPTER_UNAVAILABLE"
  | "ADAPTER_TIMEOUT"
  | "CAPABILITY_MISSING"
  | "VALIDATION_FAILED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "CSRF_INVALID"
  | "APPROVAL_REQUIRED"
  | "IDEMPOTENCY_CONFLICT"
  | "RATE_LIMITED"
  | "REAUTH_REQUIRED"
  | "INTERNAL";
export type FreshnessState = "fresh" | "stale" | "unknown" | "offline-cache";
export type AdapterCategory =
  | "tasks"
  | "activity"
  | "memory"
  | "agents"
  | "approvals"
  | "communication"
  | "calendar"
  | "automations"
  | "research"
  | "files"
  | "voice"
  | "notifications"
  | "system"
  | "audit"
  | "commands";
export type HealthStatus = "online" | "degraded" | "offline" | "unknown" | "paused";
/**
 * Adapter lifecycle (PLAN 10.6). RECOVERING = health checks are succeeding again after OFFLINE but the adapter is not yet confirmed ONLINE (PLAN 45.9).
 */
export type AdapterLifecycle =
  "UNREGISTERED" | "INITIALIZING" | "ONLINE" | "DEGRADED" | "OFFLINE" | "RECOVERING" | "STOPPING" | "STOPPED";
export type AgentStatus = "idle" | "starting" | "working" | "waiting" | "paused" | "error" | "offline";
export type ReasoningLevel = "none" | "low" | "medium" | "high" | "max";
export type ApprovalType =
  | "send_email"
  | "change_event"
  | "send_message"
  | "delete_file"
  | "order"
  | "payment"
  | "contract"
  | "system_change";
/**
 * Tier 1 low, Tier 2 confirm, Tier 3 re-authentication; Tier 3 is never approvable by voice alone.
 */
export type RiskTier = 1 | 2 | 3;
export type RequiredAuth = "none" | "confirm" | "reauth";
export type ApprovalStatus =
  "pending" | "approved" | "rejected" | "expired" | "cancelled" | "executed" | "failed";
export type CalendarProposalType = "create" | "reschedule" | "cancel" | "invite" | "respond";
export type ChannelKind = "email" | "telegram" | "whatsapp" | "sms" | "phone" | "other";
export type ChannelStatus = "online" | "degraded" | "offline" | "read_only" | "not_configured";
export type DraftStatus = "draft" | "pending_approval" | "approved" | "sent" | "failed" | "discarded";
export type FileCategory =
  "generated" | "uploaded" | "reports" | "presentations" | "invoices" | "research" | "exports" | "temporary";
export type FilePreviewKind = "none" | "text" | "markdown" | "image" | "pdf" | "html";
export type OrbMode =
  | "booting"
  | "idle"
  | "listening"
  | "transcribing"
  | "thinking"
  | "syncing"
  | "working"
  | "speaking"
  | "waiting_approval"
  | "success"
  | "warning"
  | "error"
  | "offline"
  | "paused";
export type MemoryType =
  | "profile"
  | "preference"
  | "fact"
  | "person"
  | "company"
  | "project"
  | "relationship"
  | "instruction"
  | "episode"
  | "decision";
export type MemorySensitivity = "normal" | "sensitive" | "restricted";
/**
 * P0 critical, P1 urgent, P2 important, P3 normal, P4 informational.
 */
export type Priority = "P0" | "P1" | "P2" | "P3" | "P4";
export type OrbHealth = "online" | "degraded" | "offline";
export type OrbProgressMode = "determinate" | "indeterminate" | "none";
export type OrbUrgency = "none" | "info" | "warning" | "critical";
export type TaskStatus =
  "triage" | "todo" | "ready" | "running" | "waiting" | "review" | "done" | "failed" | "cancelled";
export type Role = "owner" | "operator" | "viewer";
/**
 * Mock control actions of the scenario console (PLAN §44.6). Discriminated by action.
 */
export type ScenarioControlRequest =
  | ScenarioClockAdvance
  | ScenarioAdapterOffline
  | ScenarioLatency
  | ScenarioErrorRate
  | ScenarioCapabilityToggle
  | ScenarioForceOrbState
  | ScenarioReleaseOrbState
  | ScenarioPlayEvent
  | ScenarioReset;
export type VoiceTestKind = "wake_word" | "speaker" | "stt" | "tts" | "full_pipeline";

/**
 * Maps every contract schema title to its generated type.
 */
export interface JarvisModelMap {
  ActionResult: ActionResult;
  ActivityEvent: ActivityEvent;
  ActivityEventListResponse: ActivityEventListResponse;
  ActivityEventResponse: ActivityEventResponse;
  ActivityKind: ActivityKind;
  Actor: Actor;
  AdapterCategory: AdapterCategory;
  AdapterConfigPatch: AdapterConfigPatch;
  AdapterConfigSettings: AdapterConfigSettings;
  AdapterConfigSettingsListResponse: AdapterConfigSettingsListResponse;
  AdapterConfigSettingsResponse: AdapterConfigSettingsResponse;
  AdapterHealth: AdapterHealth;
  AdapterHealthResponse: AdapterHealthResponse;
  AdapterInfo: AdapterInfo;
  AdapterInfoListResponse: AdapterInfoListResponse;
  AdapterLifecycle: AdapterLifecycle;
  AdapterLogEntry: AdapterLogEntry;
  AdapterLogListResponse: AdapterLogListResponse;
  AdapterManifest: AdapterManifest;
  AdapterTestResult: AdapterTestResult;
  AdapterTestResultResponse: AdapterTestResultResponse;
  Agent: Agent;
  AgentHeartbeat: AgentHeartbeat;
  AgentListResponse: AgentListResponse;
  AgentPerformance: AgentPerformance;
  AgentResponse: AgentResponse;
  AgentStatus: AgentStatus;
  Approval: Approval;
  ApprovalContextRequest: ApprovalContextRequest;
  ApprovalDecisionRequest: ApprovalDecisionRequest;
  ApprovalImpact: ApprovalImpact;
  ApprovalListResponse: ApprovalListResponse;
  ApprovalPreview: ApprovalPreview;
  ApprovalResponse: ApprovalResponse;
  ApprovalSettings: ApprovalSettings;
  ApprovalStatus: ApprovalStatus;
  ApprovalType: ApprovalType;
  ArtifactRef: ArtifactRef;
  Attachment: Attachment;
  Attendee: Attendee;
  AttentionItem: AttentionItem;
  AuditEvent: AuditEvent;
  AuditEventListResponse: AuditEventListResponse;
  AuditEventResponse: AuditEventResponse;
  Automation: Automation;
  AutomationAction: AutomationAction;
  AutomationCondition: AutomationCondition;
  AutomationCreateRequest: AutomationCreateRequest;
  AutomationListResponse: AutomationListResponse;
  AutomationPauseAllRequest: AutomationPauseAllRequest;
  AutomationPauseAllResponse: AutomationPauseAllResponse;
  AutomationPauseAllResult: AutomationPauseAllResult;
  AutomationResponse: AutomationResponse;
  AutomationRun: AutomationRun;
  AutomationRunListResponse: AutomationRunListResponse;
  AutomationRunResponse: AutomationRunResponse;
  AutomationTestRequest: AutomationTestRequest;
  AutomationTrigger: AutomationTrigger;
  AutomationUpdateRequest: AutomationUpdateRequest;
  AutomationVersion: AutomationVersion;
  AutomationVersionListResponse: AutomationVersionListResponse;
  BackupSettings: BackupSettings;
  CalendarBriefing: CalendarBriefing;
  CalendarBriefingListResponse: CalendarBriefingListResponse;
  CalendarBriefingResponse: CalendarBriefingResponse;
  CalendarConflict: CalendarConflict;
  CalendarConflictListResponse: CalendarConflictListResponse;
  CalendarConflictResponse: CalendarConflictResponse;
  CalendarEvent: CalendarEvent;
  CalendarEventListResponse: CalendarEventListResponse;
  CalendarEventResponse: CalendarEventResponse;
  CalendarProposal: CalendarProposal;
  CalendarProposalRequest: CalendarProposalRequest;
  CalendarProposalResponse: CalendarProposalResponse;
  CalendarProposalType: CalendarProposalType;
  CanonicalResource: CanonicalResource;
  Capabilities: Capabilities;
  Channel: Channel;
  ChannelKind: ChannelKind;
  ChannelListResponse: ChannelListResponse;
  ChannelResponse: ChannelResponse;
  ChannelStatus: ChannelStatus;
  CommandControlRequest: CommandControlRequest;
  CommandHistoryEntry: CommandHistoryEntry;
  CommandHistoryEntryListResponse: CommandHistoryEntryListResponse;
  CommandRequest: CommandRequest;
  CommandResponse: CommandResponse;
  ContractVersion: ContractVersion;
  ControlFrame: ControlFrame;
  DashboardSettings: DashboardSettings;
  DataRetentionSettings: DataRetentionSettings;
  DeveloperSettings: DeveloperSettings;
  Draft: Draft;
  DraftCreateRequest: DraftCreateRequest;
  DraftListResponse: DraftListResponse;
  DraftResponse: DraftResponse;
  DraftSendRequest: DraftSendRequest;
  DraftStatus: DraftStatus;
  DraftUpdateRequest: DraftUpdateRequest;
  EntityRef: EntityRef;
  ErrorCode: ErrorCode;
  ErrorDetail: ErrorDetail;
  ErrorResponse: ErrorResponse;
  EscalationStep: EscalationStep;
  EventEnvelope: EventEnvelope;
  FileCategory: FileCategory;
  FileItem: FileItem;
  FileItemListResponse: FileItemListResponse;
  FileItemResponse: FileItemResponse;
  FileLineageEntry: FileLineageEntry;
  FilePreview: FilePreview;
  FilePreviewKind: FilePreviewKind;
  FilePreviewResponse: FilePreviewResponse;
  FileRenameRequest: FileRenameRequest;
  FileVersion: FileVersion;
  Freshness: Freshness;
  FreshnessState: FreshnessState;
  FrontendErrorReport: FrontendErrorReport;
  FrontendTelemetryBatch: FrontendTelemetryBatch;
  FrontendTelemetryReceipt: FrontendTelemetryReceipt;
  FrontendTelemetryReceiptResponse: FrontendTelemetryReceiptResponse;
  Health: Health;
  HealthcheckResult: HealthcheckResult;
  HealthcheckResultResponse: HealthcheckResultResponse;
  HealthStatus: HealthStatus;
  JarvisStatus: JarvisStatus;
  JarvisStatusResponse: JarvisStatusResponse;
  JsonSchemaObject: JsonSchemaObject;
  LatencyStat: LatencyStat;
  Layout: Layout;
  LayoutImportRequest: LayoutImportRequest;
  LayoutListResponse: LayoutListResponse;
  LayoutResponse: LayoutResponse;
  LayoutWidget: LayoutWidget;
  ListEnvelope: ListEnvelope;
  LoginRequest: LoginRequest;
  Memory: Memory;
  MemoryConflict: MemoryConflict;
  MemoryConflictResolveRequest: MemoryConflictResolveRequest;
  MemoryCreateRequest: MemoryCreateRequest;
  MemoryEntity: MemoryEntity;
  MemoryExport: MemoryExport;
  MemoryHistoryEntry: MemoryHistoryEntry;
  MemoryListResponse: MemoryListResponse;
  MemoryProvenance: MemoryProvenance;
  MemoryResponse: MemoryResponse;
  MemorySearchHit: MemorySearchHit;
  MemorySearchRequest: MemorySearchRequest;
  MemorySearchResponse: MemorySearchResponse;
  MemorySensitivity: MemorySensitivity;
  MemoryType: MemoryType;
  MemoryUpdateRequest: MemoryUpdateRequest;
  Message: Message;
  MessageListResponse: MessageListResponse;
  MessageResponse: MessageResponse;
  Meta: Meta;
  ModelProvider: ModelProvider;
  ModelProviderListResponse: ModelProviderListResponse;
  ModelsRoutingSettings: ModelsRoutingSettings;
  NavigationSettings: NavigationSettings;
  Notification: Notification;
  NotificationActionRequest: NotificationActionRequest;
  NotificationListResponse: NotificationListResponse;
  NotificationResponse: NotificationResponse;
  NotificationSettings: NotificationSettings;
  NotificationSnoozeRequest: NotificationSnoozeRequest;
  OrbHealth: OrbHealth;
  OrbLayers: OrbLayers;
  OrbMode: OrbMode;
  OrbPerformanceSample: OrbPerformanceSample;
  OrbProgressMode: OrbProgressMode;
  OrbSettings: OrbSettings;
  OrbSnapshot: OrbSnapshot;
  OrbSnapshotResponse: OrbSnapshotResponse;
  OrbStatus: OrbStatus;
  OrbUrgency: OrbUrgency;
  Overview: Overview;
  OverviewResponse: OverviewResponse;
  PageInfo: PageInfo;
  Participant: Participant;
  Priority: Priority;
  ProfileSettings: ProfileSettings;
  Progress: Progress;
  QuickCommand: QuickCommand;
  ReasoningLevel: ReasoningLevel;
  ReauthRequest: ReauthRequest;
  ReauthResponse: ReauthResponse;
  RequiredAuth: RequiredAuth;
  ResearchArtifact: ResearchArtifact;
  ResearchArtifactListResponse: ResearchArtifactListResponse;
  ResearchArtifactResponse: ResearchArtifactResponse;
  ResearchFinding: ResearchFinding;
  ResearchFindingListResponse: ResearchFindingListResponse;
  ResearchFindingResponse: ResearchFindingResponse;
  ResearchProject: ResearchProject;
  ResearchProjectListResponse: ResearchProjectListResponse;
  ResearchProjectResponse: ResearchProjectResponse;
  ResearchSource: ResearchSource;
  ResearchSourceListResponse: ResearchSourceListResponse;
  ResearchSourceResponse: ResearchSourceResponse;
  ResourceDeleted: ResourceDeleted;
  ResyncRequired: ResyncRequired;
  RiskTier: RiskTier;
  Role: Role;
  Scenario: Scenario;
  ScenarioControlRequest: ScenarioControlRequest;
  ScenarioListResponse: ScenarioListResponse;
  ScenarioResponse: ScenarioResponse;
  ScenarioState: ScenarioState;
  ScenarioStateResponse: ScenarioStateResponse;
  SecretStatus: SecretStatus;
  SecuritySettings: SecuritySettings;
  Service: Service;
  ServiceListResponse: ServiceListResponse;
  ServiceResponse: ServiceResponse;
  Session: Session;
  SessionResponse: SessionResponse;
  Settings: Settings;
  SettingsExport: SettingsExport;
  SettingsPatch: SettingsPatch;
  SettingsResponse: SettingsResponse;
  SettingsSchema: SettingsSchema;
  SettingsSchemaResponse: SettingsSchemaResponse;
  Severity: Severity;
  SingleEnvelope: SingleEnvelope;
  SourceDescriptor: SourceDescriptor;
  StorageVolume: StorageVolume;
  StorageVolumeListResponse: StorageVolumeListResponse;
  SystemMetrics: SystemMetrics;
  SystemMetricsResponse: SystemMetricsResponse;
  Task: Task;
  TaskActionRequest: TaskActionRequest;
  TaskAssignRequest: TaskAssignRequest;
  TaskBlocker: TaskBlocker;
  TaskCreateRequest: TaskCreateRequest;
  TaskInputRequest: TaskInputRequest;
  TaskListResponse: TaskListResponse;
  TaskProgressEvent: TaskProgressEvent;
  TaskResponse: TaskResponse;
  TaskStatus: TaskStatus;
  TaskStep: TaskStep;
  TaskToolCall: TaskToolCall;
  TaskUpdateRequest: TaskUpdateRequest;
  Theme: Theme;
  ThemeImportRequest: ThemeImportRequest;
  ThemeListResponse: ThemeListResponse;
  ThemeResponse: ThemeResponse;
  ThemeSettings: ThemeSettings;
  Thread: Thread;
  ThreadListResponse: ThreadListResponse;
  ThreadResponse: ThreadResponse;
  User: User;
  VoiceAudioLevel: VoiceAudioLevel;
  VoiceDevice: VoiceDevice;
  VoiceDeviceListResponse: VoiceDeviceListResponse;
  VoiceEnrollment: VoiceEnrollment;
  VoiceEnrollmentResponse: VoiceEnrollmentResponse;
  VoiceEnrollRequest: VoiceEnrollRequest;
  VoiceMetrics: VoiceMetrics;
  VoiceMetricsResponse: VoiceMetricsResponse;
  VoiceProfile: VoiceProfile;
  VoiceProfileListResponse: VoiceProfileListResponse;
  VoiceSettings: VoiceSettings;
  VoiceStatus: VoiceStatus;
  VoiceStatusResponse: VoiceStatusResponse;
  VoiceTestKind: VoiceTestKind;
  VoiceTestRequest: VoiceTestRequest;
  VoiceTestResult: VoiceTestResult;
  VoiceTestResultResponse: VoiceTestResultResponse;
  VoiceTranscript: VoiceTranscript;
  VoiceTtsEnded: VoiceTtsEnded;
  VoiceTtsStarted: VoiceTtsStarted;
}
/**
 * Result of an action that returns no resource (delete, stop, ...).
 */
export interface ActionResult {
  contractVersion: ContractVersion;
  accepted: boolean;
  status: "completed" | "queued" | "rejected";
  correlationId: string;
  message?: string;
  resourceId?: string;
  auditEventId?: string;
}
/**
 * Immutable event in the activity tree (PLAN §29). parentId links children to their parent.
 */
export interface ActivityEvent {
  id: string;
  /**
   * Monotonic revision used for optimistic concurrency (If-Match).
   */
  version: number;
  createdAt: string;
  updatedAt: string;
  labels?: string[];
  source: SourceDescriptor;
  /**
   * Global monotonic event sequence; backfill via GET /activity?sinceSequence=.
   */
  sequence: number;
  kind: ActivityKind;
  severity: Severity;
  title: string;
  summary?: string;
  status: "started" | "running" | "succeeded" | "failed" | "cancelled" | "info";
  parentId: string | null;
  correlationId: string;
  agentId?: string | null;
  taskId?: string | null;
  tool?: string | null;
  adapterId?: string | null;
  model?: string | null;
  occurredAt: string;
  endedAt?: string | null;
  durationMs: number | null;
  result?: string | null;
  error?: ErrorDetail;
  actor?: Actor;
  /**
   * Redacted structured context; raw payloads only in debug/admin views.
   */
  details?: {
    [k: string]: unknown;
  };
}
/**
 * Provenance of a canonical resource: which adapter delivered it.
 */
export interface SourceDescriptor {
  adapterId: string;
  /**
   * Backing system family, e.g. mock, hermes, gmx.
   */
  system: string;
  /**
   * Opaque id in the backing system. Never interpreted by the UI.
   */
  externalId?: string;
  lastSyncedAt: string;
}
/**
 * Normalized error. Provider-specific errors are mapped to this shape by adapters.
 */
export interface ErrorDetail {
  code: ErrorCode;
  message: string;
  severity: Severity;
  retryable: boolean;
  correlationId: string;
  /**
   * Structured context, e.g. { fieldErrors: [...] }. May be empty.
   */
  details: {
    [k: string]: unknown;
  };
}
export interface Actor {
  type: "user" | "agent" | "system" | "adapter";
  id: string;
  name?: string;
}
/**
 * Cursor-paginated list envelope for ActivityEvent.
 */
export interface ActivityEventListResponse {
  contractVersion: ContractVersion;
  items: ActivityEvent[];
  pageInfo: PageInfo;
  freshness: Freshness;
  sources: SourceDescriptor[];
}
export interface PageInfo {
  nextCursor: string | null;
  hasNextPage: boolean;
  totalCount?: number;
}
/**
 * Data age marker; stale data must never be rendered as live.
 */
export interface Freshness {
  state: FreshnessState;
  asOf: string | null;
}
/**
 * Single-resource envelope for ActivityEvent.
 */
export interface ActivityEventResponse {
  contractVersion: ContractVersion;
  data: ActivityEvent;
  freshness: Freshness;
}
export interface AdapterConfigPatch {
  provider?: string;
  enabled?: boolean;
  config?: {
    [k: string]: unknown;
  };
  /**
   * Write-only secret values by field name.
   */
  secrets?: {
    [k: string]: string;
  };
}
/**
 * Per-adapter configuration. The UI renders the form from configSchema; secrets are write-only.
 */
export interface AdapterConfigSettings {
  adapterId: string;
  category: AdapterCategory;
  provider: string;
  enabled: boolean;
  /**
   * Optimistic-concurrency token of this configuration; send it as If-Match on PATCH /settings/adapters/{id}. Increases with every change.
   */
  version?: number;
  config: {
    [k: string]: unknown;
  };
  configSchema: JsonSchemaObject;
  secretFields: {
    [k: string]: SecretStatus;
  };
  lastTestAt?: string | null;
  lastTestResult?: "success" | "failure";
}
/**
 * An embedded JSON Schema document (e.g. an adapter configSchema).
 */
export interface JsonSchemaObject {
  [k: string]: unknown;
}
/**
 * Secrets never leave the server; the browser only learns whether one is configured.
 */
export interface SecretStatus {
  configured: boolean;
  maskedHint?: string;
}
/**
 * Cursor-paginated list envelope for AdapterConfigSettings.
 */
export interface AdapterConfigSettingsListResponse {
  contractVersion: ContractVersion;
  items: AdapterConfigSettings[];
  pageInfo: PageInfo;
  freshness: Freshness;
  sources: SourceDescriptor[];
}
/**
 * Single-resource envelope for AdapterConfigSettings.
 */
export interface AdapterConfigSettingsResponse {
  contractVersion: ContractVersion;
  data: AdapterConfigSettings;
  freshness: Freshness;
}
/**
 * Runtime health of an adapter (PLAN §10.7) including circuit breaker state.
 */
export interface AdapterHealth {
  adapterId: string;
  status: HealthStatus;
  lifecycle: AdapterLifecycle;
  latencyMs: number | null;
  lastSuccessAt: string | null;
  lastError: {
    code: string;
    message: string;
  } | null;
  checkedAt: string;
  consecutiveFailures: number;
  circuit: "closed" | "open" | "half_open";
}
/**
 * Single-resource envelope for AdapterHealth.
 */
export interface AdapterHealthResponse {
  contractVersion: ContractVersion;
  data: AdapterHealth;
  freshness: Freshness;
}
export interface AdapterInfo {
  manifest: AdapterManifest;
  health: AdapterHealth;
  enabled: boolean;
  provider: string;
  mode: "mock" | "live";
}
/**
 * Static description of an adapter package (PLAN §10.4).
 */
export interface AdapterManifest {
  id: string;
  name: string;
  adapterVersion: string;
  contractVersion: ContractVersion;
  apiVersion: string;
  category: AdapterCategory;
  capabilities: string[];
  configSchemaRef: string;
  secretFields: string[];
}
/**
 * Cursor-paginated list envelope for AdapterInfo.
 */
export interface AdapterInfoListResponse {
  contractVersion: ContractVersion;
  items: AdapterInfo[];
  pageInfo: PageInfo;
  freshness: Freshness;
  sources: SourceDescriptor[];
}
/**
 * One redacted log line of an adapter from the Control API's log buffer (PLAN §40.4 Open Logs). Secrets, tokens and personal data never appear.
 */
export interface AdapterLogEntry {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  adapterId: string;
  correlationId: string | null;
  /**
   * Redacted scalar fields of the log call.
   */
  context: {
    [k: string]: string | number | boolean | null;
  };
}
/**
 * Recent log lines of one adapter, newest last. Not paginated: the buffer is bounded and limit caps the result.
 */
export interface AdapterLogListResponse {
  contractVersion: ContractVersion;
  items: AdapterLogEntry[];
  freshness: Freshness;
  sources: SourceDescriptor[];
}
export interface AdapterTestResult {
  adapterId: string;
  success: boolean;
  latencyMs: number | null;
  message: string;
  testedAt: string;
  correlationId: string;
}
/**
 * Single-resource envelope for AdapterTestResult.
 */
export interface AdapterTestResultResponse {
  contractVersion: ContractVersion;
  data: AdapterTestResult;
  freshness: Freshness;
}
/**
 * Worker agent (PLAN §31).
 */
export interface Agent {
  id: string;
  /**
   * Monotonic revision used for optimistic concurrency (If-Match).
   */
  version: number;
  createdAt: string;
  updatedAt: string;
  labels?: string[];
  source: SourceDescriptor;
  name: string;
  role: string;
  description?: string;
  status: AgentStatus;
  currentTaskId: string | null;
  model: string | null;
  reasoningLevel: ReasoningLevel;
  capabilities: string[];
  activeTools: string[];
  startedAt: string | null;
  runtimeMs: number | null;
  heartbeatAt: string | null;
  successRate: number | null;
  performance: AgentPerformance;
  lastActivityAt: string | null;
  lastError: ErrorDetail | null;
  /**
   * Icon accent color for the agent card.
   */
  accent?: string;
  /**
   * Redacted, read-only agent configuration for the Configuration tab.
   */
  configuration?: {
    [k: string]: unknown;
  };
}
export interface AgentPerformance {
  avgTaskDurationMs: number | null;
  tasksCompleted: number;
  tasksFailed: number;
  tokensUsed?: number;
  costEur?: number;
}
export interface AgentHeartbeat {
  agentId: string;
  heartbeatAt: string;
  status: AgentStatus;
  currentTaskId: string | null;
}
/**
 * Cursor-paginated list envelope for Agent.
 */
export interface AgentListResponse {
  contractVersion: ContractVersion;
  items: Agent[];
  pageInfo: PageInfo;
  freshness: Freshness;
  sources: SourceDescriptor[];
}
/**
 * Single-resource envelope for Agent.
 */
export interface AgentResponse {
  contractVersion: ContractVersion;
  data: Agent;
  freshness: Freshness;
}
/**
 * Human approval gate (PLAN §32). Decisions are checked again server-side before execution.
 */
export interface Approval {
  id: string;
  /**
   * Monotonic revision used for optimistic concurrency (If-Match).
   */
  version: number;
  createdAt: string;
  updatedAt: string;
  labels?: string[];
  source: SourceDescriptor;
  type: ApprovalType;
  /**
   * Short imperative description, e.g. "E-Mail an Frau Becker senden".
   */
  action: string;
  riskTier: RiskTier;
  agentId: string | null;
  taskId: string | null;
  rationale: string;
  impacts: ApprovalImpact[];
  preview: ApprovalPreview;
  expiresAt: string | null;
  requiredAuth: RequiredAuth;
  status: ApprovalStatus;
  decidedAt?: string | null;
  decidedBy?: Actor | null;
  decisionComment?: string | null;
  sourceRef: EntityRef | null;
  editable: boolean;
  executionResult?: string | null;
  correlationId: string;
}
export interface ApprovalImpact {
  kind: "data" | "money" | "communication" | "schedule" | "system" | "legal" | "other";
  description: string;
  severity?: Severity;
}
export interface ApprovalPreview {
  kind: "email" | "message" | "calendar" | "file" | "order" | "payment" | "contract" | "command" | "text";
  title: string;
  body: string;
  fields?: {
    label: string;
    value: string;
  }[];
}
/**
 * Typed link to another resource, used for navigation ("jump to task").
 */
export interface EntityRef {
  type:
    | "task"
    | "agent"
    | "approval"
    | "memory"
    | "thread"
    | "message"
    | "draft"
    | "calendar_event"
    | "automation"
    | "automation_run"
    | "research_project"
    | "file"
    | "notification"
    | "service"
    | "adapter"
    | "audit_event"
    | "activity_event";
  id: string;
  label?: string;
}
export interface ApprovalContextRequest {
  question: string;
}
export interface ApprovalDecisionRequest {
  comment?: string;
  /**
   * Short-lived token from POST /auth/reauth; required when requiredAuth is reauth.
   */
  reauthToken?: string;
  editedPreview?: ApprovalPreview;
  inputChannel?: "dashboard" | "voice" | "api";
}
/**
 * Cursor-paginated list envelope for Approval.
 */
export interface ApprovalListResponse {
  contractVersion: ContractVersion;
  items: Approval[];
  pageInfo: PageInfo;
  freshness: Freshness;
  sources: SourceDescriptor[];
}
/**
 * Single-resource envelope for Approval.
 */
export interface ApprovalResponse {
  contractVersion: ContractVersion;
  data: Approval;
  freshness: Freshness;
}
export interface ApprovalSettings {
  defaultExpiryMinutes: number;
  draftOnlyByDefault: boolean;
  confirmTier2: boolean;
  reauthTier3: boolean;
  notifyOnRequest: boolean;
}
export interface ArtifactRef {
  id: string;
  name: string;
  kind: "file" | "report" | "presentation" | "dataset" | "link" | "other";
  fileId?: string;
  sizeBytes?: number;
}
export interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  fileId?: string;
}
export interface Attendee {
  name: string;
  email?: string;
  response: "accepted" | "declined" | "tentative" | "needs_action";
}
export interface AttentionItem {
  id: string;
  kind: "alert" | "approval" | "mail" | "blocked_task" | "overdue_task" | "system";
  title: string;
  summary: string;
  severity: Severity;
  occurredAt: string;
  targetRoute: string;
  ref: EntityRef | null;
}
/**
 * Append-only audit record with hash chain (PLAN §41).
 */
export interface AuditEvent {
  id: string;
  /**
   * Monotonic revision used for optimistic concurrency (If-Match).
   */
  version: number;
  createdAt: string;
  updatedAt: string;
  labels?: string[];
  source: SourceDescriptor;
  sequence: number;
  occurredAt: string;
  actor: Actor;
  category: "user_action" | "agent_action" | "tool_call" | "approval" | "system" | "security";
  /**
   * Dotted action name, e.g. approval.approved.
   */
  action: string;
  severity: Severity;
  result: "success" | "failure" | "denied" | "pending";
  errorCode?: ErrorCode | null;
  agentId?: string | null;
  taskId?: string | null;
  tool?: string | null;
  adapterId?: string | null;
  model?: string | null;
  reasoningLevel?: ReasoningLevel | null;
  approvalId?: string | null;
  durationMs: number | null;
  correlationId: string;
  /**
   * Redacted context.
   */
  context?: {
    [k: string]: unknown;
  };
  before: {
    [k: string]: unknown;
  } | null;
  after: {
    [k: string]: unknown;
  } | null;
  artifactIds: string[];
  childEventIds: string[];
  hash: string;
  prevHash: string | null;
}
/**
 * Cursor-paginated list envelope for AuditEvent.
 */
export interface AuditEventListResponse {
  contractVersion: ContractVersion;
  items: AuditEvent[];
  pageInfo: PageInfo;
  freshness: Freshness;
  sources: SourceDescriptor[];
}
/**
 * Single-resource envelope for AuditEvent.
 */
export interface AuditEventResponse {
  contractVersion: ContractVersion;
  data: AuditEvent;
  freshness: Freshness;
}
/**
 * Rule: trigger, conditions, actions, escalation (PLAN §35). version increments on every definition change.
 */
export interface Automation {
  id: string;
  /**
   * Monotonic revision used for optimistic concurrency (If-Match).
   */
  version: number;
  createdAt: string;
  updatedAt: string;
  labels?: string[];
  source: SourceDescriptor;
  name: string;
  description?: string;
  enabled: boolean;
  paused: boolean;
  trigger: AutomationTrigger;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  escalation: EscalationStep[];
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastSuccess: {
    at: string;
    runId: string;
  } | null;
  lastError: {
    at: string;
    message: string;
    runId: string;
  } | null;
  runCount: number;
}
export interface AutomationTrigger {
  type: "event" | "schedule" | "manual" | "condition";
  /**
   * Event type, e.g. jarvis.communication.thread_updated.
   */
  event?: string;
  /**
   * Cron expression.
   */
  schedule?: string;
  timeZone?: string;
  description: string;
}
export interface AutomationCondition {
  id: string;
  field: string;
  operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "in" | "matches";
  /**
   * Comparison value (any JSON).
   */
  value: {
    [k: string]: unknown;
  };
  description: string;
}
export interface AutomationAction {
  id: string;
  type: "notify" | "create_task" | "draft_message" | "call" | "run_agent" | "set_priority" | "webhook";
  channel?: "dashboard" | "telegram" | "whatsapp" | "sms" | "phone" | "email";
  params?: {
    [k: string]: unknown;
  };
  requiresApproval: boolean;
  description: string;
}
export interface EscalationStep {
  afterSeconds: number;
  channel: "dashboard" | "telegram" | "whatsapp" | "sms" | "phone" | "email";
  description: string;
  stopOnAcknowledge?: boolean;
}
export interface AutomationCreateRequest {
  name: string;
  enabled?: boolean;
  trigger: AutomationTrigger;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  escalation?: EscalationStep[];
  description?: string;
}
/**
 * Cursor-paginated list envelope for Automation.
 */
export interface AutomationListResponse {
  contractVersion: ContractVersion;
  items: Automation[];
  pageInfo: PageInfo;
  freshness: Freshness;
  sources: SourceDescriptor[];
}
/**
 * Optional body of the bulk pause (PLAN §35.3 Pause All).
 */
export interface AutomationPauseAllRequest {
  reason?: string;
}
/**
 * Single-resource envelope for AutomationPauseAllResult.
 */
export interface AutomationPauseAllResponse {
  contractVersion: ContractVersion;
  data: AutomationPauseAllResult;
  freshness: Freshness;
}
/**
 * Per-automation outcome of the bulk pause. Automations that are already paused or disabled stay untouched.
 */
export interface AutomationPauseAllResult {
  results: {
    automationId: string;
    name: string;
    outcome: "paused" | "already_paused" | "skipped" | "failed";
    /**
     * Version after the operation (null when the automation could not be read).
     */
    version: number | null;
    message?: string;
  }[];
  pausedCount: number;
  unchangedCount: number;
  failedCount: number;
}
/**
 * Single-resource envelope for Automation.
 */
export interface AutomationResponse {
  contractVersion: ContractVersion;
  data: Automation;
  freshness: Freshness;
}
/**
 * Execution record; answers why it fired, which conditions held, what ran and the result (PLAN §35.4).
 */
export interface AutomationRun {
  id: string;
  /**
   * Monotonic revision used for optimistic concurrency (If-Match).
   */
  version: number;
  createdAt: string;
  updatedAt: string;
  labels?: string[];
  source: SourceDescriptor;
  automationId: string;
  automationVersion: number;
  status: "running" | "succeeded" | "failed" | "skipped" | "dry_run";
  dryRun: boolean;
  triggeredAt: string;
  finishedAt: string | null;
  triggerReason: string;
  conditionsEvaluated: {
    conditionId: string;
    met: boolean;
    detail: string;
  }[];
  actionsExecuted: {
    actionId: string;
    status: "succeeded" | "failed" | "skipped" | "simulated";
    executedAt: string;
    resultSummary: string;
  }[];
  result: string;
  error?: ErrorDetail;
  correlationId: string;
}
/**
 * Cursor-paginated list envelope for AutomationRun.
 */
export interface AutomationRunListResponse {
  contractVersion: ContractVersion;
  items: AutomationRun[];
  pageInfo: PageInfo;
  freshness: Freshness;
  sources: SourceDescriptor[];
}
/**
 * Single-resource envelope for AutomationRun.
 */
export interface AutomationRunResponse {
  contractVersion: ContractVersion;
  data: AutomationRun;
  freshness: Freshness;
}
export interface AutomationTestRequest {
  dryRun?: boolean;
  /**
   * Mock input to evaluate the trigger against.
   */
  sampleData?: {
    [k: string]: unknown;
  };
}
export interface AutomationUpdateRequest {
  name?: string;
  enabled?: boolean;
  paused?: boolean;
  description?: string;
  trigger?: AutomationTrigger;
  conditions?: AutomationCondition[];
  actions?: AutomationAction[];
  escalation?: EscalationStep[];
}
/**
 * One entry of the version history of an automation (PLAN §35.3 Versionierung). Newest version first.
 */
export interface AutomationVersion {
  automationId: string;
  version: number;
  createdAt: string;
  changedBy: Actor;
  /**
   * What changed compared to the previous version.
   */
  summary: string;
  /**
   * True for the version that is live now.
   */
  current: boolean;
  /**
   * Definition of the automation at this version.
   */
  snapshot: {
    name: string;
    description?: string;
    enabled: boolean;
    paused: boolean;
    trigger: AutomationTrigger;
    conditions: AutomationCondition[];
    actions: AutomationAction[];
    escalation: EscalationStep[];
  };
  source: SourceDescriptor;
}
/**
 * Cursor-paginated list envelope for AutomationVersion.
 */
export interface AutomationVersionListResponse {
  contractVersion: ContractVersion;
  items: AutomationVersion[];
  pageInfo: PageInfo;
  freshness: Freshness;
  sources: SourceDescriptor[];
}
export interface BackupSettings {
  enabled: boolean;
  /**
   * Cron expression.
   */
  schedule: string;
  targetPath: string;
  retentionCount: number;
  lastBackupAt: string | null;
  lastBackupStatus: "success" | "failed" | "never";
}
export interface CalendarBriefing {
  id: string;
  /**
   * Monotonic revision used for optimistic concurrency (If-Match).
   */
  version: number;
  createdAt: string;
  updatedAt: string;
  labels?: string[];
  source: SourceDescriptor;
  eventId: string;
  summary: string;
  attendeeContext: {
    name: string;
    notes: string;
  }[];
  linkedThreadIds: string[];
  talkingPoints: string[];
  generatedAt: string;
}
/**
 * Cursor-paginated list envelope for CalendarBriefing.
 */
export interface CalendarBriefingListResponse {
  contractVersion: ContractVersion;
  items: CalendarBriefing[];
  pageInfo: PageInfo;
  freshness: Freshness;
  sources: SourceDescriptor[];
}
/**
 * Single-resource envelope for CalendarBriefing.
 */
export interface CalendarBriefingResponse {
  contractVersion: ContractVersion;
  data: CalendarBriefing;
  freshness: Freshness;
}
export interface CalendarConflict {
  id: string;
  /**
   * Monotonic revision used for optimistic concurrency (If-Match).
   */
  version: number;
  createdAt: string;
  updatedAt: string;
  labels?: string[];
  source: SourceDescriptor;
  eventIds: string[];
  kind: "overlap" | "double_booking" | "travel_time" | "no_focus_time";
  severity: Severity;
  description: string;
  detectedAt: string;
  suggestedResolution?: string;
}
/**
 * Cursor-paginated list envelope for CalendarConflict.
 */
export interface CalendarConflictListResponse {
  contractVersion: ContractVersion;
  items: CalendarConflict[];
  pageInfo: PageInfo;
  freshness: Freshness;
  sources: SourceDescriptor[];
}
/**
 * Single-resource envelope for CalendarConflict.
 */
export interface CalendarConflictResponse {
  contractVersion: ContractVersion;
  data: CalendarConflict;
  freshness: Freshness;
}
/**
 * Calendar entry (PLAN §34). All times UTC; timeZone is the display zone of the event.
 */
export interface CalendarEvent {
  id: string;
  /**
   * Monotonic revision used for optimistic concurrency (If-Match).
   */
  version: number;
  createdAt: string;
  updatedAt: string;
  labels?: string[];
  source: SourceDescriptor;
  title: string;
  description?: string;
  start: string;
  end: string;
  allDay: boolean;
  /**
   * IANA zone, e.g. Europe/Berlin.
   */
  timeZone: string;
  location?: string;
  attendees: Attendee[];
  status: "confirmed" | "tentative" | "cancelled";
  reminderMinutes: number[];
  linkedTaskIds: string[];
  linkedThreadIds: string[];
  conflictIds: string[];
  briefingId: string | null;
}
/**
 * Cursor-paginated list envelope for CalendarEvent.
 */
export interface CalendarEventListResponse {
  contractVersion: ContractVersion;
  items: CalendarEvent[];
  pageInfo: PageInfo;
  freshness: Freshness;
  sources: SourceDescriptor[];
}
/**
 * Single-resource envelope for CalendarEvent.
 */
export interface CalendarEventResponse {
  contractVersion: ContractVersion;
  data: CalendarEvent;
  freshness: Freshness;
}
/**
 * Write actions on the calendar are proposals that go through approval.
 */
export interface CalendarProposal {
  id: string;
  /**
   * Monotonic revision used for optimistic concurrency (If-Match).
   */
  version: number;
  createdAt: string;
  updatedAt: string;
  labels?: string[];
  source: SourceDescriptor;
  type: CalendarProposalType;
  eventId: string | null;
  title: string | null;
  proposedStart: string | null;
  proposedEnd: string | null;
  attendees: Attendee[];
  reason: string;
  status: "pending_approval" | "approved" | "rejected" | "applied" | "failed";
  approvalId: string | null;
}
export interface CalendarProposalRequest {
  type: CalendarProposalType;
  eventId?: string | null;
  title?: string;
  start?: string;
  end?: string;
  attendees?: Attendee[];
  reason: string;
}
/**
 * Single-resource envelope for CalendarProposal.
 */
export interface CalendarProposalResponse {
  contractVersion: ContractVersion;
  data: CalendarProposal;
  freshness: Freshness;
}
/**
 * Base fields every canonical resource carries (inlined into each resource schema).
 */
export interface CanonicalResource {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  labels?: string[];
  source: SourceDescriptor;
}
/**
 * Per-module capability flags (PLAN §9). The UI derives enabled/disabled actions from this document.
 */
export interface Capabilities {
  contractVersion: ContractVersion;
  modules: {
    tasks: TasksCapability;
    activity: ActivityCapability;
    memory: MemoryCapability;
    agents: AgentsCapability;
    approvals: ApprovalsCapability;
    mail: MailCapability;
    communication: CommunicationCapability;
    calendar: CalendarCapability;
    automations: AutomationsCapability;
    research: ResearchCapability;
    files: FilesCapability;
    voice: VoiceCapability;
    notifications: NotificationsCapability;
    system: SystemCapability;
    audit: AuditCapability;
    commands: CommandsCapability;
    telephony: TelephonyCapability;
  };
}
export interface TasksCapability {
  read: boolean;
  create: boolean;
  update: boolean;
  cancel: boolean;
  retry: boolean;
  pause: boolean;
  resume: boolean;
  stream: boolean;
  /**
   * Answer tasks that wait for input (POST /tasks/{id}/input).
   */
  input?: boolean;
  sources: string[];
}
export interface ActivityCapability {
  read: boolean;
  stream: boolean;
  backfill: boolean;
  sources: string[];
}
export interface MemoryCapability {
  read: boolean;
  write: boolean;
  delete: boolean;
  search: boolean;
  lock: boolean;
  /**
   * Export the memory store as JSON.
   */
  export?: boolean;
  /**
   * Resolve memory conflicts.
   */
  resolveConflict?: boolean;
  sources: string[];
}
export interface AgentsCapability {
  read: boolean;
  pause: boolean;
  resume: boolean;
  stop: boolean;
  assignTask: boolean;
  sources: string[];
}
export interface ApprovalsCapability {
  read: boolean;
  decide: boolean;
  requestContext: boolean;
  editBeforeApprove: boolean;
  sources: string[];
}
export interface MailCapability {
  read: boolean;
  draft: boolean;
  send: boolean;
  sources: string[];
}
export interface CommunicationCapability {
  read: boolean;
  draft: boolean;
  send: boolean;
  multiChannel: boolean;
  sources: string[];
}
export interface CalendarCapability {
  read: boolean;
  create: boolean;
  reschedule: boolean;
  cancel: boolean;
  invite: boolean;
  respond: boolean;
  propose: boolean;
  sources: string[];
}
export interface AutomationsCapability {
  read: boolean;
  create: boolean;
  update: boolean;
  test: boolean;
  enable: boolean;
  disable: boolean;
  pauseAll: boolean;
  /**
   * Read the version history of an automation.
   */
  versions?: boolean;
  sources: string[];
}
export interface ResearchCapability {
  read: boolean;
  create: boolean;
  export: boolean;
  sources: string[];
}
export interface FilesCapability {
  read: boolean;
  preview: boolean;
  download: boolean;
  delete: boolean;
  upload: boolean;
  /**
   * Rename files (PATCH /files/{id}).
   */
  rename?: boolean;
  sources: string[];
}
export interface VoiceCapability {
  read: boolean;
  test: boolean;
  stop: boolean;
  enroll: boolean;
  /**
   * Delete the voice history (DELETE /voice/history).
   */
  deleteHistory?: boolean;
  sources: string[];
}
export interface NotificationsCapability {
  read: boolean;
  acknowledge: boolean;
  snooze: boolean;
  resolve: boolean;
  sources: string[];
}
export interface SystemCapability {
  read: boolean;
  healthcheck: boolean;
  restartAdapter: boolean;
  openLogs: boolean;
  sources: string[];
}
export interface AuditCapability {
  read: boolean;
  export: boolean;
  hashChain: boolean;
  sources: string[];
}
export interface CommandsCapability {
  execute: boolean;
  stop: boolean;
  pause: boolean;
  resume: boolean;
  history: boolean;
  sources: string[];
}
export interface TelephonyCapability {
  read: boolean;
  call: boolean;
  sources: string[];
}
/**
 * Communication channel (PLAN §33.1). Address is an account hint, never a credential.
 */
export interface Channel {
  id: string;
  /**
   * Monotonic revision used for optimistic concurrency (If-Match).
   */
  version: number;
  createdAt: string;
  updatedAt: string;
  labels?: string[];
  source: SourceDescriptor;
  kind: ChannelKind;
  name: string;
  status: ChannelStatus;
  address?: string;
  capabilities: {
    read: boolean;
    draft: boolean;
    send: boolean;
  };
  unreadCount: number;
  lastSyncAt: string | null;
}
/**
 * Cursor-paginated list envelope for Channel.
 */
export interface ChannelListResponse {
  contractVersion: ContractVersion;
  items: Channel[];
  pageInfo: PageInfo;
  freshness: Freshness;
  sources: SourceDescriptor[];
}
/**
 * Single-resource envelope for Channel.
 */
export interface ChannelResponse {
  contractVersion: ContractVersion;
  data: Channel;
  freshness: Freshness;
}
/**
 * Body of stop/pause/resume.
 */
export interface CommandControlRequest {
  scope: "all" | "task" | "agent" | "voice" | "automations";
  targetId?: string;
  reason?: string;
}
/**
 * Sensitive commands are stored redacted.
 */
export interface CommandHistoryEntry {
  id: string;
  /**
   * Monotonic revision used for optimistic concurrency (If-Match).
   */
  version: number;
  createdAt: string;
  updatedAt: string;
  labels?: string[];
  source: SourceDescriptor;
  text: string;
  redacted: boolean;
  origin: "text" | "voice" | "palette" | "quick_command";
  status: "executed" | "accepted" | "requires_confirmation" | "requires_approval" | "rejected" | "failed";
  riskTier: RiskTier | null;
  executedAt: string;
  correlationId: string;
  repeatable: boolean;
}
/**
 * Cursor-paginated list envelope for CommandHistoryEntry.
 */
export interface CommandHistoryEntryListResponse {
  contractVersion: ContractVersion;
  items: CommandHistoryEntry[];
  pageInfo: PageInfo;
  freshness: Freshness;
  sources: SourceDescriptor[];
}
export interface CommandRequest {
  text: string;
  source: "text" | "voice" | "palette" | "quick_command";
  context?: {
    route: string;
    selectedIds?: string[];
  };
  /**
   * Set after the user saw previewText of a previous requires_confirmation response.
   */
  confirm?: boolean;
  /**
   * Echo of CommandResponse.previewId to bind confirmation to the preview.
   */
  previewId?: string;
}
/**
 * Write/critical actions first return a preview (PLAN §43.4); only a confirmed repeat executes.
 */
export interface CommandResponse {
  contractVersion: ContractVersion;
  commandId: string;
  status: "executed" | "accepted" | "requires_confirmation" | "requires_approval" | "rejected" | "failed";
  requiresConfirmation: boolean;
  /**
   * e.g. "Du bist dabei, eine E-Mail an Frau Becker zu senden."
   */
  previewText: string | null;
  previewId?: string;
  riskTier: RiskTier | null;
  approvalId: string | null;
  result: {
    message: string;
    taskId?: string;
    targetRoute?: string;
  } | null;
  correlationId: string;
}
/**
 * Heartbeat frames (conventions §4). Not an envelope, no sequence.
 */
export interface ControlFrame {
  kind: "ping" | "pong";
  /**
   * Sender clock, epoch milliseconds.
   */
  ts: number;
}
export interface DashboardSettings {
  activeLayoutId: string;
  fontScale: number;
  backgroundGrid: boolean;
  soundEffects: boolean;
  autoRefreshSeconds: number;
  compact: boolean;
}
export interface DataRetentionSettings {
  activityDays: number;
  auditDays: number;
  voiceHistoryDays: number;
  notificationDays: number;
  temporaryFileDays: number;
  memoryDefaultTtlDays: number | null;
}
export interface DeveloperSettings {
  debugMode: boolean;
  showRawJson: boolean;
  scenarioConsole: boolean;
  orbPerfOverlay: boolean;
  logLevel: "error" | "warn" | "info" | "debug";
}
/**
 * Drafts are created automatically; sending always requires approval (PLAN §33.5).
 */
export interface Draft {
  id: string;
  /**
   * Monotonic revision used for optimistic concurrency (If-Match).
   */
  version: number;
  createdAt: string;
  updatedAt: string;
  labels?: string[];
  source: SourceDescriptor;
  channelId: string;
  threadId: string | null;
  to: Participant[];
  cc?: Participant[];
  subject: string;
  body: string;
  status: DraftStatus;
  approvalId: string | null;
  generatedByAgentId: string | null;
  replyToMessageId?: string | null;
}
export interface Participant {
  name: string;
  address: string;
  role?: string;
}
export interface DraftCreateRequest {
  channelId: string;
  threadId?: string | null;
  to: Participant[];
  cc?: Participant[];
  subject: string;
  body: string;
  replyToMessageId?: string | null;
}
/**
 * Cursor-paginated list envelope for Draft.
 */
export interface DraftListResponse {
  contractVersion: ContractVersion;
  items: Draft[];
  pageInfo: PageInfo;
  freshness: Freshness;
  sources: SourceDescriptor[];
}
/**
 * Single-resource envelope for Draft.
 */
export interface DraftResponse {
  contractVersion: ContractVersion;
  data: Draft;
  freshness: Freshness;
}
export interface DraftSendRequest {
  comment?: string;
}
export interface DraftUpdateRequest {
  to?: Participant[];
  cc?: Participant[];
  subject?: string;
  body?: string;
  status?: "draft" | "discarded";
}
/**
 * Error envelope returned for every non-2xx REST response.
 */
export interface ErrorResponse {
  error: ErrorDetail;
}
/**
 * CloudEvents-inspired envelope (PLAN §12.3). sequence is global and strictly increasing.
 */
export interface EventEnvelope {
  specversion: "1.0";
  id: string;
  type: string;
  /**
   * e.g. adapter://mock-tasks or control-api://core.
   */
  source: string;
  /**
   * e.g. task/task_01J...
   */
  subject: string;
  time: string;
  sequence: number;
  correlationId: string;
  causationId?: string;
  contractVersion: ContractVersion;
  /**
   * Typed per event type; see the AsyncAPI document.
   */
  data: {
    [k: string]: unknown;
  };
}
/**
 * Generated or uploaded document (PLAN §37). Untrusted content is only previewed in a sandbox.
 */
export interface FileItem {
  id: string;
  /**
   * Monotonic revision used for optimistic concurrency (If-Match).
   */
  version: number;
  createdAt: string;
  updatedAt: string;
  labels?: string[];
  source: SourceDescriptor;
  name: string;
  mimeType: string;
  sizeBytes: number;
  category: FileCategory;
  currentVersion: number;
  versions: FileVersion[];
  createdBy: Actor;
  taskId: string | null;
  /**
   * Logical location, e.g. D:\Jarvis\Dateien\Berichte.
   */
  location: string;
  tags: string[];
  previewKind: FilePreviewKind;
  lineage: FileLineageEntry[];
  checksum: string | null;
}
export interface FileVersion {
  version: number;
  createdAt: string;
  sizeBytes: number;
  createdBy: Actor;
  checksum?: string;
}
export interface FileLineageEntry {
  relation: "derived_from" | "input_of" | "output_of" | "replaces";
  fileId?: string;
  taskId?: string;
  description: string;
}
/**
 * Cursor-paginated list envelope for FileItem.
 */
export interface FileItemListResponse {
  contractVersion: ContractVersion;
  items: FileItem[];
  pageInfo: PageInfo;
  freshness: Freshness;
  sources: SourceDescriptor[];
}
/**
 * Single-resource envelope for FileItem.
 */
export interface FileItemResponse {
  contractVersion: ContractVersion;
  data: FileItem;
  freshness: Freshness;
}
export interface FilePreview {
  fileId: string;
  kind: FilePreviewKind;
  contentType: string;
  text?: string;
  /**
   * Same-origin sandboxed preview URL.
   */
  url?: string;
  truncated: boolean;
  sandboxed: boolean;
}
/**
 * Single-resource envelope for FilePreview.
 */
export interface FilePreviewResponse {
  contractVersion: ContractVersion;
  data: FilePreview;
  freshness: Freshness;
}
/**
 * Renames a file (PLAN §37.3). The location and the content stay unchanged; the name must not contain path separators or reserved characters.
 */
export interface FileRenameRequest {
  /**
   * New file name including extension.
   */
  name: string;
}
/**
 * One aggregated browser error (PLAN §50.3). Contains no user data: no stack traces, no URLs with query strings, no identifiers. The server additionally redacts the message.
 */
export interface FrontendErrorReport {
  kind:
    | "js_error"
    | "unhandled_rejection"
    | "render_error"
    | "network_error"
    | "webgl_context_lost"
    | "resource_error";
  /**
   * Short technical message (for example the error class and the failing module).
   */
  message: string;
  /**
   * Dashboard route path without query or fragment.
   */
  route?: string;
  /**
   * Occurrences of this error since the last batch (1 when absent).
   */
  count?: number;
  occurredAt?: string;
}
/**
 * Batch of frontend errors and orb performance samples (PLAN §50.3). Limited to 20 errors and 60 samples per request; the server also caps the body size (32 KiB) and the request rate. Must not contain personal data.
 */
export interface FrontendTelemetryBatch {
  errors?: FrontendErrorReport[];
  orbSamples?: OrbPerformanceSample[];
}
/**
 * One orb render performance sample of the browser (PLAN §50.3): frames per second, frame time and WebGL memory.
 */
export interface OrbPerformanceSample {
  fps: number;
  /**
   * Mean frame time of the sampling window.
   */
  frameTimeMs: number;
  /**
   * Estimated GPU memory held by the orb scene (textures plus geometries).
   */
  webglMemoryBytes?: number;
  occurredAt?: string;
}
/**
 * How much of a telemetry batch the server recorded.
 */
export interface FrontendTelemetryReceipt {
  acceptedErrors: number;
  acceptedOrbSamples: number;
}
/**
 * Single-resource envelope for FrontendTelemetryReceipt.
 */
export interface FrontendTelemetryReceiptResponse {
  contractVersion: ContractVersion;
  data: FrontendTelemetryReceipt;
  freshness: Freshness;
}
/**
 * Liveness/readiness summary of the control API and its components.
 */
export interface Health {
  contractVersion: ContractVersion;
  status: HealthStatus;
  checkedAt: string;
  components: {
    id: string;
    name: string;
    status: HealthStatus;
    latencyMs: number | null;
  }[];
}
export interface HealthcheckResult {
  serviceId: string;
  status: HealthStatus;
  latencyMs: number | null;
  checkedAt: string;
  message: string;
  correlationId: string;
}
/**
 * Single-resource envelope for HealthcheckResult.
 */
export interface HealthcheckResultResponse {
  contractVersion: ContractVersion;
  data: HealthcheckResult;
  freshness: Freshness;
}
/**
 * Compact overall status (top bar).
 */
export interface JarvisStatus {
  status: HealthStatus;
  label: string;
  mode: OrbMode;
  dataMode: "mock" | "hybrid" | "live";
  uptimeSeconds: number;
  since: string;
  version: string;
  eventStream: {
    state: "online" | "degraded" | "offline" | "connecting";
    roundtripMs: number | null;
    lastEventAt: string | null;
  };
  adapterSummary: {
    online: number;
    degraded: number;
    offline: number;
  };
}
/**
 * Single-resource envelope for JarvisStatus.
 */
export interface JarvisStatusResponse {
  contractVersion: ContractVersion;
  data: JarvisStatus;
  freshness: Freshness;
}
export interface LatencyStat {
  currentMs: number | null;
  avgMs: number | null;
  p95Ms: number | null;
  sampleCount: number;
}
/**
 * Overview layout file (PLAN §25.4) on a 12-column grid.
 */
export interface Layout {
  layoutId: string;
  name?: string;
  columns?: number;
  widgets: LayoutWidget[];
}
export interface LayoutWidget {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  visible: boolean;
}
export interface LayoutImportRequest {
  layout: Layout;
  activate?: boolean;
}
/**
 * Cursor-paginated list envelope for Layout.
 */
export interface LayoutListResponse {
  contractVersion: ContractVersion;
  items: Layout[];
  pageInfo: PageInfo;
  freshness: Freshness;
  sources: SourceDescriptor[];
}
/**
 * Single-resource envelope for Layout.
 */
export interface LayoutResponse {
  contractVersion: ContractVersion;
  data: Layout;
  freshness: Freshness;
}
/**
 * Generic cursor-paginated list envelope.
 */
export interface ListEnvelope {
  contractVersion: ContractVersion;
  items: unknown[];
  pageInfo: PageInfo;
  freshness: Freshness;
  sources: SourceDescriptor[];
}
export interface LoginRequest {
  username: string;
  password: string;
}
/**
 * Stored knowledge item (PLAN §30). Nothing is hidden: provenance, usage and history are visible.
 */
export interface Memory {
  id: string;
  /**
   * Monotonic revision used for optimistic concurrency (If-Match).
   */
  version: number;
  createdAt: string;
  updatedAt: string;
  labels?: string[];
  source: SourceDescriptor;
  type: MemoryType;
  title?: string;
  content: string;
  confidence: number;
  confirmedAt: string | null;
  expiresAt: string | null;
  ttlSeconds?: number | null;
  tags: string[];
  entities: MemoryEntity[];
  locked: boolean;
  pinned: boolean;
  sensitivity: MemorySensitivity;
  provenance: MemoryProvenance;
  usageCount: number;
  lastUsedAt: string | null;
  conflicts: MemoryConflict[];
  history: MemoryHistoryEntry[];
}
export interface MemoryEntity {
  kind: "person" | "company" | "project" | "place" | "other";
  id: string;
  label: string;
}
export interface MemoryProvenance {
  kind: "conversation" | "import" | "manual" | "inference" | "sync";
  referenceId?: string;
  description?: string;
}
export interface MemoryConflict {
  memoryId: string;
  reason: string;
  detectedAt: string;
  resolution: "pending" | "keep_both" | "replaced" | "dismissed";
}
export interface MemoryHistoryEntry {
  version: number;
  changedAt: string;
  actor: Actor;
  change: "created" | "updated" | "confirmed" | "locked" | "unlocked" | "pinned" | "deleted" | "expired";
  summary: string;
  before: string | null;
  after: string | null;
}
/**
 * Resolution of one memory conflict (PLAN §30.3). The conflict is addressed by the id of the conflicting memory (MemoryConflict.memoryId). keep_both keeps both entries, replace lets the addressed memory replace the conflicting one (the conflicting entry is forgotten, locked entries refuse with 409), dismiss marks the hint as irrelevant.
 */
export interface MemoryConflictResolveRequest {
  resolution: "keep_both" | "replace" | "dismiss";
  /**
   * Optional reason that is stored in the memory history.
   */
  note?: string;
}
export interface MemoryCreateRequest {
  type: MemoryType;
  content: string;
  title?: string;
  confidence?: number;
  tags?: string[];
  entities?: MemoryEntity[];
  sensitivity?: MemorySensitivity;
  pinned?: boolean;
  expiresAt?: string | null;
}
/**
 * JSON export of the memory store (PLAN §30.3). Never contains secrets: restricted memories are omitted and only counted.
 */
export interface MemoryExport {
  contractVersion: ContractVersion;
  exportedAt: string;
  /**
   * Number of exported memories (items.length).
   */
  count: number;
  /**
   * Memories with sensitivity restricted that were left out.
   */
  omittedRestricted: number;
  items: Memory[];
}
/**
 * Cursor-paginated list envelope for Memory.
 */
export interface MemoryListResponse {
  contractVersion: ContractVersion;
  items: Memory[];
  pageInfo: PageInfo;
  freshness: Freshness;
  sources: SourceDescriptor[];
}
/**
 * Single-resource envelope for Memory.
 */
export interface MemoryResponse {
  contractVersion: ContractVersion;
  data: Memory;
  freshness: Freshness;
}
export interface MemorySearchHit {
  memory: Memory;
  score: number;
  highlights?: string[];
}
export interface MemorySearchRequest {
  query: string;
  types?: MemoryType[];
  tags?: string[];
  sensitivity?: MemorySensitivity[];
  minConfidence?: number;
  semantic?: boolean;
  includeExpired?: boolean;
  limit?: number;
}
export interface MemorySearchResponse {
  contractVersion: ContractVersion;
  items: MemorySearchHit[];
  freshness: Freshness;
  sources: SourceDescriptor[];
}
export interface MemoryUpdateRequest {
  type?: MemoryType;
  content?: string;
  title?: string;
  confidence?: number;
  /**
   * Marks the memory as confirmed now.
   */
  confirm?: boolean;
  tags?: string[];
  entities?: MemoryEntity[];
  sensitivity?: MemorySensitivity;
  locked?: boolean;
  pinned?: boolean;
  expiresAt?: string | null;
}
export interface Message {
  id: string;
  /**
   * Monotonic revision used for optimistic concurrency (If-Match).
   */
  version: number;
  createdAt: string;
  updatedAt: string;
  labels?: string[];
  source: SourceDescriptor;
  threadId: string;
  direction: "inbound" | "outbound";
  from: Participant;
  to: Participant[];
  cc?: Participant[];
  sentAt: string;
  bodyText: string;
  aiSummary: string | null;
  attachments: Attachment[];
  /**
   * Opaque reference to the original in the source system.
   */
  originalRef?: string;
}
/**
 * Cursor-paginated list envelope for Message.
 */
export interface MessageListResponse {
  contractVersion: ContractVersion;
  items: Message[];
  pageInfo: PageInfo;
  freshness: Freshness;
  sources: SourceDescriptor[];
}
/**
 * Single-resource envelope for Message.
 */
export interface MessageResponse {
  contractVersion: ContractVersion;
  data: Message;
  freshness: Freshness;
}
/**
 * Bootstrap document: tells the client how to reach the event stream and which mode the server runs in.
 */
export interface Meta {
  contractVersion: ContractVersion;
  apiVersion: string;
  dataMode: "mock" | "hybrid" | "live";
  /**
   * WebSocket path, relative to the API origin.
   */
  eventsPath: string;
  /**
   * Overrides the origin of the WebSocket (dev setups).
   */
  eventsOrigin?: string;
  buildVersion: string;
  /**
   * Boolean feature flags, e.g. devScenarios.
   */
  features: {
    [k: string]: boolean;
  };
  serverTime?: string;
  defaultLocale?: "de" | "en";
}
/**
 * LLM provider shown under Models & Services.
 */
export interface ModelProvider {
  id: string;
  /**
   * Monotonic revision used for optimistic concurrency (If-Match).
   */
  version: number;
  createdAt: string;
  updatedAt: string;
  labels?: string[];
  source: SourceDescriptor;
  name: string;
  providerKind: "local" | "cloud";
  status: HealthStatus;
  models: string[];
  latencyMs: number | null;
  activeRequests: number;
  contextWindow?: number;
}
/**
 * Cursor-paginated list envelope for ModelProvider.
 */
export interface ModelProviderListResponse {
  contractVersion: ContractVersion;
  items: ModelProvider[];
  pageInfo: PageInfo;
  freshness: Freshness;
  sources: SourceDescriptor[];
}
export interface ModelsRoutingSettings {
  defaultModel: string;
  localFirst: boolean;
  routes: {
    taskKind: string;
    model: string;
    reasoningLevel: ReasoningLevel;
    fallbackModel: string | null;
  }[];
  monthlyBudgetEur: number | null;
}
export interface NavigationSettings {
  order: string[];
  hidden: string[];
  defaultPage: string;
  mode: "compact" | "expanded";
}
/**
 * Alert with escalation chain (PLAN §39).
 */
export interface Notification {
  id: string;
  /**
   * Monotonic revision used for optimistic concurrency (If-Match).
   */
  version: number;
  createdAt: string;
  updatedAt: string;
  labels?: string[];
  source: SourceDescriptor;
  priority: Priority;
  category:
    "system" | "task" | "approval" | "mail" | "calendar" | "automation" | "security" | "voice" | "adapter";
  title: string;
  body: string;
  status: "open" | "acknowledged" | "snoozed" | "resolved";
  acknowledged: boolean;
  acknowledgedAt?: string | null;
  snoozedUntil: string | null;
  resolved: boolean;
  resolvedAt?: string | null;
  escalation: {
    step: number;
    channel: "dashboard" | "telegram" | "whatsapp" | "sms" | "phone" | "email";
    state: "pending" | "sent" | "acknowledged" | "failed" | "skipped";
    scheduledAt: string;
    sentAt: string | null;
    acknowledgedAt: string | null;
  }[];
  sourceRef: EntityRef | null;
  /**
   * Dashboard route for "Open source", e.g. /approvals?approval=appr_...
   */
  targetRoute: string | null;
}
export interface NotificationActionRequest {
  comment?: string;
}
/**
 * Cursor-paginated list envelope for Notification.
 */
export interface NotificationListResponse {
  contractVersion: ContractVersion;
  items: Notification[];
  pageInfo: PageInfo;
  freshness: Freshness;
  sources: SourceDescriptor[];
}
/**
 * Single-resource envelope for Notification.
 */
export interface NotificationResponse {
  contractVersion: ContractVersion;
  data: Notification;
  freshness: Freshness;
}
export interface NotificationSettings {
  channels: {
    kind: "dashboard" | "telegram" | "whatsapp" | "sms" | "phone" | "email";
    enabled: boolean;
    minPriority: Priority;
  }[];
  quietHours: {
    enabled: boolean;
    from: string;
    to: string;
  };
  defaultEscalation: EscalationStep[];
  snoozeDefaultMinutes: number;
}
export interface NotificationSnoozeRequest {
  until?: string;
  durationMinutes?: number;
}
/**
 * Parallel activity layers (PLAN §18.2): the orb can speak while agents work and health is shown on the telemetry ring.
 */
export interface OrbLayers {
  voice: "idle" | "listening" | "transcribing" | "speaking";
  work: "idle" | "thinking" | "working" | "syncing" | "paused";
  attention: "none" | "waiting_approval" | "success" | "warning" | "error";
  health: OrbHealth;
  activeAgentIds: string[];
}
/**
 * User-tunable orb behaviour (PLAN §23.2, §42.3). Never contains shader parameters of the backend.
 */
export interface OrbSettings {
  preset: string;
  size: number;
  intensity: number;
  speed: number;
  particleDensity: number;
  audioReactive: boolean;
  mouseParallax: boolean;
  bloom: boolean;
  animations: "full" | "reduced" | "off";
  quality: "auto" | "low" | "medium" | "high" | "ultra";
  renderMode: "auto" | "2d" | "3d";
  /**
   * Secondary accent color per orb mode; the gold core is invariant.
   */
  statusColors: {
    [k: string]: string;
  };
}
/**
 * Dominant orb status plus the parallel layers. Payload of GET /orb/status and jarvis.orb.status_changed.
 */
export interface OrbSnapshot {
  status: OrbStatus;
  layers: OrbLayers;
}
/**
 * Semantic orb state (PLAN §17). Backends emit semantics only, never shader parameters.
 */
export interface OrbStatus {
  mode: OrbMode;
  activityText?: string;
  detailText?: string;
  progress?: number | null;
  progressMode?: OrbProgressMode;
  audioLevel?: number;
  urgency?: OrbUrgency;
  health?: OrbHealth;
  activeAgentCount?: number;
  currentAgentId?: string;
  taskId?: string;
  approvalId?: string;
  since: string;
  sourceEventId?: string;
}
/**
 * Single-resource envelope for OrbSnapshot.
 */
export interface OrbSnapshotResponse {
  contractVersion: ContractVersion;
  data: OrbSnapshot;
  freshness: Freshness;
}
/**
 * Aggregated home payload (PLAN §27.14). Sections of failed adapters are listed in degradedSections instead of failing the call.
 */
export interface Overview {
  jarvis: JarvisStatus;
  orb: OrbSnapshot;
  currentActivity: {
    text: string;
    agentId: string | null;
    taskId: string | null;
    since: string;
  } | null;
  activeAgents: Agent[];
  runningTasks: Task[];
  openApprovals: Approval[];
  criticalAlerts: Notification[];
  attention: AttentionItem[];
  importantMailCount: number;
  nextEvents: CalendarEvent[];
  systemSummary: {
    cpuPercent: number | null;
    ramPercent: number | null;
    gpuPercent: number | null;
    vramPercent: number | null;
    storageUsedPercent: number | null;
    services: {
      id: string;
      name: string;
      status: HealthStatus;
    }[];
  };
  models: ModelProvider[];
  voice: VoiceStatus | null;
  memoryInsights: {
    total: number;
    newToday: number;
    lastUpdatedAt: string | null;
  } | null;
  counters: {
    tasks: number;
    approvals: number;
    mail: number;
    alerts: number;
  };
  quickCommands: QuickCommand[];
  degradedSections: {
    section: string;
    adapterId: string;
    status: HealthStatus;
    reason: string;
  }[];
  lastUpdatedAt: string;
}
/**
 * Unit of work processed by an agent (PLAN §28.3).
 */
export interface Task {
  id: string;
  /**
   * Monotonic revision used for optimistic concurrency (If-Match).
   */
  version: number;
  createdAt: string;
  updatedAt: string;
  labels?: string[];
  source: SourceDescriptor;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: Priority;
  agentId: string | null;
  agentName?: string;
  model: string | null;
  progress: Progress;
  startedAt: string | null;
  runtimeMs: number | null;
  dueAt: string | null;
  estimatedCompletionAt: string | null;
  blockers: TaskBlocker[];
  lastActivityAt: string | null;
  artifactCount: number;
  artifacts: ArtifactRef[];
  steps: TaskStep[];
  toolCalls: TaskToolCall[];
  sourceRefs: EntityRef[];
  approvalIds: string[];
  errors: ErrorDetail[];
  createdBy: Actor;
  parentTaskId?: string | null;
}
/**
 * Unknown progress is indeterminate; never fake a percentage. value is a fraction 0..1.
 */
export interface Progress {
  mode: "determinate" | "indeterminate" | "none";
  value: number | null;
}
export interface TaskBlocker {
  id: string;
  kind: "approval" | "dependency" | "input_needed" | "adapter_unavailable" | "other";
  description: string;
  since?: string;
  refId?: string;
}
export interface TaskStep {
  id: string;
  index: number;
  title: string;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  startedAt?: string;
  finishedAt?: string;
  detail?: string;
}
export interface TaskToolCall {
  id: string;
  tool: string;
  status: "running" | "succeeded" | "failed";
  startedAt: string;
  durationMs?: number;
  summary?: string;
  adapterId?: string;
  error?: ErrorDetail;
}
/**
 * Live voice pipeline status (PLAN §38.1). Microphone activity is always visible.
 */
export interface VoiceStatus {
  updatedAt: string;
  source: SourceDescriptor;
  mode: "idle" | "listening" | "transcribing" | "thinking" | "speaking" | "error";
  microphone: {
    state: "off" | "muted" | "idle" | "listening";
    active: boolean;
    deviceId: string | null;
    inputLevel: number;
  };
  wakeWord: {
    enabled: boolean;
    state: "disabled" | "armed" | "triggered" | "error";
    phrase: string;
  };
  speakerVerification: {
    enabled: boolean;
    state: "disabled" | "idle" | "verifying" | "verified" | "rejected";
    recognizedSpeaker: string | null;
    confidence: number | null;
  };
  trustedSession: {
    active: boolean;
    expiresAt: string | null;
  };
  stt: {
    engine: string;
    state: "ready" | "busy" | "error" | "offline";
    latencyMs: number | null;
  };
  tts: {
    engine: string;
    state: "ready" | "busy" | "error" | "offline";
    latencyMs: number | null;
  };
  localModel: {
    name: string | null;
    state: "ready" | "busy" | "error" | "offline";
    latencyMs: number | null;
  };
  audioInputDeviceId: string | null;
  audioOutputDeviceId: string | null;
  pushToTalk: {
    enabled: boolean;
    active: boolean;
  };
  focusMode: boolean;
  rawRecordingEnabled: boolean;
  voiceHistoryEnabled: boolean;
}
/**
 * Capability-aware quick action shown on the overview (PLAN §27.8).
 */
export interface QuickCommand {
  id: string;
  label: string;
  icon: string;
  commandText: string | null;
  targetRoute: string | null;
  enabled: boolean;
  disabledReason?: string;
  /**
   * Capability path such as tasks.create.
   */
  requiredCapability: string;
  requiresConfirmation: boolean;
}
/**
 * Single-resource envelope for Overview.
 */
export interface OverviewResponse {
  contractVersion: ContractVersion;
  data: Overview;
  freshness: Freshness;
}
export interface ProfileSettings {
  displayName: string;
  /**
   * Visible brand name of the assistant (UI, orb labels, voice copy). Optional; clients fall back to "F.R.I.D.A.Y.".
   */
  assistantName?: string;
  locale: "de" | "en";
  timeZone: string;
  dateFormat: "dd.MM.yyyy" | "yyyy-MM-dd" | "MM/dd/yyyy";
  timeFormat: "24h" | "12h";
  firstDayOfWeek: "monday" | "sunday";
}
export interface ReauthRequest {
  password: string;
}
export interface ReauthResponse {
  contractVersion: ContractVersion;
  reauthToken: string;
  expiresAt: string;
}
export interface ResearchArtifact {
  id: string;
  /**
   * Monotonic revision used for optimistic concurrency (If-Match).
   */
  version: number;
  createdAt: string;
  updatedAt: string;
  labels?: string[];
  source: SourceDescriptor;
  projectId: string;
  name: string;
  format: "markdown" | "json" | "pdf" | "docx" | "pptx";
  fileId: string | null;
  sizeBytes: number | null;
}
/**
 * Cursor-paginated list envelope for ResearchArtifact.
 */
export interface ResearchArtifactListResponse {
  contractVersion: ContractVersion;
  items: ResearchArtifact[];
  pageInfo: PageInfo;
  freshness: Freshness;
  sources: SourceDescriptor[];
}
/**
 * Single-resource envelope for ResearchArtifact.
 */
export interface ResearchArtifactResponse {
  contractVersion: ContractVersion;
  data: ResearchArtifact;
  freshness: Freshness;
}
/**
 * A statement together with the sources that support it and known contradictions.
 */
export interface ResearchFinding {
  id: string;
  /**
   * Monotonic revision used for optimistic concurrency (If-Match).
   */
  version: number;
  createdAt: string;
  updatedAt: string;
  labels?: string[];
  source: SourceDescriptor;
  projectId: string;
  statement: string;
  confidence: number;
  supportingSourceIds: string[];
  contradictions: {
    sourceId: string | null;
    findingId: string | null;
    description: string;
  }[];
  status: "draft" | "verified" | "disputed" | "rejected";
}
/**
 * Cursor-paginated list envelope for ResearchFinding.
 */
export interface ResearchFindingListResponse {
  contractVersion: ContractVersion;
  items: ResearchFinding[];
  pageInfo: PageInfo;
  freshness: Freshness;
  sources: SourceDescriptor[];
}
/**
 * Single-resource envelope for ResearchFinding.
 */
export interface ResearchFindingResponse {
  contractVersion: ContractVersion;
  data: ResearchFinding;
  freshness: Freshness;
}
/**
 * Research mission with sources, findings and artifacts (PLAN §36).
 */
export interface ResearchProject {
  id: string;
  /**
   * Monotonic revision used for optimistic concurrency (If-Match).
   */
  version: number;
  createdAt: string;
  updatedAt: string;
  labels?: string[];
  source: SourceDescriptor;
  topic: string;
  mission: string;
  status: "planning" | "running" | "review" | "done" | "failed" | "cancelled";
  agentIds: string[];
  progress: Progress;
  sourceCount: number;
  findingCount: number;
  contradictionCount: number;
  artifactCount: number;
  resultSummary?: string | null;
  runtimeMs: number | null;
  costEur?: number | null;
}
/**
 * Cursor-paginated list envelope for ResearchProject.
 */
export interface ResearchProjectListResponse {
  contractVersion: ContractVersion;
  items: ResearchProject[];
  pageInfo: PageInfo;
  freshness: Freshness;
  sources: SourceDescriptor[];
}
/**
 * Single-resource envelope for ResearchProject.
 */
export interface ResearchProjectResponse {
  contractVersion: ContractVersion;
  data: ResearchProject;
  freshness: Freshness;
}
export interface ResearchSource {
  id: string;
  /**
   * Monotonic revision used for optimistic concurrency (If-Match).
   */
  version: number;
  createdAt: string;
  updatedAt: string;
  labels?: string[];
  source: SourceDescriptor;
  projectId: string;
  title: string;
  domain: string;
  url?: string;
  retrievedAt: string | null;
  relevance: number;
  reliability: number;
  supportsStatement: string | null;
  excerpt: string | null;
  status: "queued" | "retrieved" | "failed" | "excluded";
}
/**
 * Cursor-paginated list envelope for ResearchSource.
 */
export interface ResearchSourceListResponse {
  contractVersion: ContractVersion;
  items: ResearchSource[];
  pageInfo: PageInfo;
  freshness: Freshness;
  sources: SourceDescriptor[];
}
/**
 * Single-resource envelope for ResearchSource.
 */
export interface ResearchSourceResponse {
  contractVersion: ContractVersion;
  data: ResearchSource;
  freshness: Freshness;
}
export interface ResourceDeleted {
  id: string;
  deletedAt: string;
  deletedBy?: Actor;
}
export interface ResyncRequired {
  reason: "sequence_too_old" | "buffer_overflow" | "server_restart" | "unknown";
  requestedSince: number | null;
  oldestAvailableSequence: number | null;
  latestSequence: number;
}
/**
 * Deterministic mock scenario (PLAN §45).
 */
export interface Scenario {
  id: string;
  name: string;
  description: string;
  steps: {
    index: number;
    label: string;
    delayMs: number;
    orbMode?: OrbMode;
    description?: string;
  }[];
}
export interface ScenarioClockAdvance {
  action: "clock_advance";
  ms: number;
}
export interface ScenarioAdapterOffline {
  action: "adapter_offline";
  adapterId: string;
  offline: boolean;
}
export interface ScenarioLatency {
  action: "latency";
  adapterId?: string;
  ms: number;
}
export interface ScenarioErrorRate {
  action: "error_rate";
  adapterId?: string;
  rate: number;
}
export interface ScenarioCapabilityToggle {
  action: "capability_toggle";
  module: string;
  capability: string;
  enabled: boolean;
}
export interface ScenarioForceOrbState {
  action: "force_orb_state";
  mode: OrbMode;
  activityText?: string;
  audioLevel?: number;
  progress?: number | null;
}
/**
 * Releases a forced orb state (force_orb_state) so the orb follows the derived state again.
 */
export interface ScenarioReleaseOrbState {
  action: "release_orb_state";
}
/**
 * Plays one event of the AsyncAPI event list on the event stream. The optional payload (data) is validated against the payload schema of the event type (AsyncAPI). Without a payload the mock derives one from its current state for event types that mirror state (orb, overall status, system metrics, voice state); every other type needs a payload (422).
 */
export interface ScenarioPlayEvent {
  action: "play_event";
  eventType: string;
  subject?: string;
  payload?: {
    [k: string]: unknown;
  };
}
export interface ScenarioReset {
  action: "reset";
}
/**
 * Cursor-paginated list envelope for Scenario.
 */
export interface ScenarioListResponse {
  contractVersion: ContractVersion;
  items: Scenario[];
  pageInfo: PageInfo;
  freshness: Freshness;
  sources: SourceDescriptor[];
}
/**
 * Single-resource envelope for Scenario.
 */
export interface ScenarioResponse {
  contractVersion: ContractVersion;
  data: Scenario;
  freshness: Freshness;
}
export interface ScenarioState {
  activeScenarioId: string | null;
  running: boolean;
  stepIndex: number;
  seed: number;
  simulatedTime: string;
  clockOffsetMs: number;
  adapterOverrides: {
    adapterId: string;
    offline: boolean;
    latencyMs?: number;
    errorRate?: number;
  }[];
  capabilityOverrides: {
    module: string;
    capability: string;
    enabled: boolean;
  }[];
  forcedOrbMode: OrbMode | null;
}
/**
 * Single-resource envelope for ScenarioState.
 */
export interface ScenarioStateResponse {
  contractVersion: ContractVersion;
  data: ScenarioState;
  freshness: Freshness;
}
export interface SecuritySettings {
  sessionTimeoutMinutes: number;
  reauthWindowMinutes: number;
  allowRemoteAccess: boolean;
  auditHashChain: boolean;
  trustedOrigins: string[];
}
/**
 * Monitored system component (PLAN §40.2): Hermes, Kimi API, Local Qwen, Voice, WSL, ...
 */
export interface Service {
  id: string;
  version: string;
  createdAt: string;
  updatedAt: string;
  labels?: string[];
  source: SourceDescriptor;
  name: string;
  kind: "hermes" | "llm" | "voice" | "wsl" | "api" | "stream" | "adapter" | "worker" | "other";
  status: HealthStatus;
  latencyMs: number | null;
  lastCheckAt: string | null;
  lastSuccessAt: string | null;
  detail?: string;
}
/**
 * Cursor-paginated list envelope for Service.
 */
export interface ServiceListResponse {
  contractVersion: ContractVersion;
  items: Service[];
  pageInfo: PageInfo;
  freshness: Freshness;
  sources: SourceDescriptor[];
}
/**
 * Single-resource envelope for Service.
 */
export interface ServiceResponse {
  contractVersion: ContractVersion;
  data: Service;
  freshness: Freshness;
}
/**
 * Current session. csrfToken must be echoed in X-CSRF-Token on mutating requests.
 */
export interface Session {
  authenticated: boolean;
  user: User | null;
  role: Role | null;
  csrfToken: string | null;
  expiresAt: string | null;
  reauthUntil: string | null;
}
export interface User {
  id: string;
  displayName: string;
  role: Role;
}
/**
 * Single-resource envelope for Session.
 */
export interface SessionResponse {
  contractVersion: ContractVersion;
  data: Session;
  freshness: Freshness;
}
/**
 * All 14 settings areas (PLAN §42.1). adapters lists configuration state; secrets only as { configured }.
 */
export interface Settings {
  version: number;
  updatedAt: string;
  profile: ProfileSettings;
  dashboard: DashboardSettings;
  theme: ThemeSettings;
  orb: OrbSettings;
  navigation: NavigationSettings;
  modelsRouting: ModelsRoutingSettings;
  voice: VoiceSettings;
  notifications: NotificationSettings;
  security: SecuritySettings;
  approvals: ApprovalSettings;
  dataRetention: DataRetentionSettings;
  backups: BackupSettings;
  developer: DeveloperSettings;
  adapters: AdapterConfigSettings[];
}
export interface ThemeSettings {
  activeThemeId: string;
  cyanIntensity: number;
  panelOpacity: number;
  goldIntensity: number;
  overrides?: {
    [k: string]: string;
  };
}
export interface VoiceSettings {
  wakeWordEnabled: boolean;
  wakeWord: string;
  pushToTalkKey: string;
  speakerVerificationRequired: boolean;
  storeRawRecordings: boolean;
  voiceHistoryEnabled: boolean;
  ttsVoice: string;
  ttsRate: number;
  inputDeviceId: string | null;
  outputDeviceId: string | null;
}
/**
 * Portable export. Secrets are never included.
 */
export interface SettingsExport {
  contractVersion: ContractVersion;
  exportedAt: string;
  settings: SettingsPatch;
  themes: Theme[];
  layouts: Layout[];
}
/**
 * PATCH body: every supplied area replaces the stored area as a whole. Adapters are patched via /settings/adapters/{id}.
 */
export interface SettingsPatch {
  profile?: ProfileSettings;
  dashboard?: DashboardSettings;
  theme?: ThemeSettings;
  orb?: OrbSettings;
  navigation?: NavigationSettings;
  modelsRouting?: ModelsRoutingSettings;
  voice?: VoiceSettings;
  notifications?: NotificationSettings;
  security?: SecuritySettings;
  approvals?: ApprovalSettings;
  dataRetention?: DataRetentionSettings;
  backups?: BackupSettings;
  developer?: DeveloperSettings;
}
/**
 * Theme file (PLAN §25.3). Switchable at runtime without rebuild.
 */
export interface Theme {
  id: string;
  name: string;
  description?: string;
  builtIn: boolean;
  /**
   * Design tokens as dotted keys, e.g. color.primary.
   */
  tokens: {
    [k: string]: string;
  };
  orb: {
    preset: string;
    particleDensity: number;
    fragmentDensity: number;
    glowIntensity: number;
    motionSpeed: number;
    mouseParallax: boolean;
  };
  panels: {
    cornerStyle: "technical-cut" | "rounded" | "square";
    borderIntensity: number;
    backgroundOpacity: number;
  };
}
/**
 * Single-resource envelope for Settings.
 */
export interface SettingsResponse {
  contractVersion: ContractVersion;
  data: Settings;
  freshness: Freshness;
}
export interface SettingsSchema {
  schema: JsonSchemaObject;
  areas: string[];
}
/**
 * Single-resource envelope for SettingsSchema.
 */
export interface SettingsSchemaResponse {
  contractVersion: ContractVersion;
  data: SettingsSchema;
  freshness: Freshness;
}
/**
 * Generic single-resource envelope.
 */
export interface SingleEnvelope {
  contractVersion: ContractVersion;
  data: unknown;
  freshness: Freshness;
}
export interface StorageVolume {
  id: string;
  /**
   * Monotonic revision used for optimistic concurrency (If-Match).
   */
  version: number;
  createdAt: string;
  updatedAt: string;
  labels?: string[];
  source: SourceDescriptor;
  /**
   * Drive or mount, e.g. D:\.
   */
  mount: string;
  label: string;
  fileSystem?: string;
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  usagePercent: number;
}
/**
 * Cursor-paginated list envelope for StorageVolume.
 */
export interface StorageVolumeListResponse {
  contractVersion: ContractVersion;
  items: StorageVolume[];
  pageInfo: PageInfo;
  freshness: Freshness;
  sources: SourceDescriptor[];
}
/**
 * Hardware snapshot (PLAN §40.1). Optional sensors are null when unavailable.
 */
export interface SystemMetrics {
  sampledAt: string;
  source: SourceDescriptor;
  cpu: {
    usagePercent: number;
    cores: number;
    temperatureC?: number | null;
  };
  ram: {
    usedBytes: number;
    totalBytes: number;
    usagePercent: number;
  };
  gpu: {
    name: string;
    usagePercent: number;
    temperatureC?: number | null;
  } | null;
  vram: {
    usedBytes: number;
    totalBytes: number;
    usagePercent: number;
  } | null;
  temperatures?: {
    sensor: string;
    celsius: number;
  }[];
  storage: StorageVolume[];
  network: {
    rxBytesPerSec: number;
    txBytesPerSec: number;
    latencyMs?: number | null;
  };
}
/**
 * Single-resource envelope for SystemMetrics.
 */
export interface SystemMetricsResponse {
  contractVersion: ContractVersion;
  data: SystemMetrics;
  freshness: Freshness;
}
/**
 * Optional body for cancel/retry/pause/resume.
 */
export interface TaskActionRequest {
  reason?: string;
  confirm?: boolean;
}
/**
 * Assigns a task to an agent or releases it (agentId null).
 */
export interface TaskAssignRequest {
  agentId: string | null;
  reason?: string;
}
export interface TaskCreateRequest {
  title: string;
  description?: string;
  priority?: Priority;
  agentId?: string | null;
  model?: string | null;
  dueAt?: string | null;
  labels?: string[];
}
/**
 * Answer to a task that waits for input (blocker kind input_needed). The text is forwarded to the agent; it resolves the blocker.
 */
export interface TaskInputRequest {
  input: string;
  /**
   * Blocker to resolve; defaults to the first input_needed blocker.
   */
  blockerId?: string;
}
/**
 * Cursor-paginated list envelope for Task.
 */
export interface TaskListResponse {
  contractVersion: ContractVersion;
  items: Task[];
  pageInfo: PageInfo;
  freshness: Freshness;
  sources: SourceDescriptor[];
}
export interface TaskProgressEvent {
  taskId: string;
  progress: Progress;
  currentStep?: string | null;
  message?: string;
  agentId?: string | null;
}
/**
 * Single-resource envelope for Task.
 */
export interface TaskResponse {
  contractVersion: ContractVersion;
  data: Task;
  freshness: Freshness;
}
/**
 * Partial update (also used for Kanban moves via status). Requires If-Match.
 */
export interface TaskUpdateRequest {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: Priority;
  agentId?: string | null;
  dueAt?: string | null;
  labels?: string[];
}
export interface ThemeImportRequest {
  theme: Theme;
  activate?: boolean;
}
/**
 * Cursor-paginated list envelope for Theme.
 */
export interface ThemeListResponse {
  contractVersion: ContractVersion;
  items: Theme[];
  pageInfo: PageInfo;
  freshness: Freshness;
  sources: SourceDescriptor[];
}
/**
 * Single-resource envelope for Theme.
 */
export interface ThemeResponse {
  contractVersion: ContractVersion;
  data: Theme;
  freshness: Freshness;
}
/**
 * Unified inbox thread (PLAN §33.2). messages is populated in the detail view only.
 */
export interface Thread {
  id: string;
  /**
   * Monotonic revision used for optimistic concurrency (If-Match).
   */
  version: number;
  createdAt: string;
  updatedAt: string;
  labels?: string[];
  source: SourceDescriptor;
  channelId: string;
  channelKind: ChannelKind;
  subject: string;
  participants: Participant[];
  priority: Priority;
  summary: string | null;
  needsReply: boolean;
  deadline: string | null;
  status: "open" | "waiting" | "replied" | "archived";
  linkedTaskId: string | null;
  lastMessageAt: string;
  messageCount: number;
  unreadCount: number;
  hasDraft: boolean;
  draftIds: string[];
  extractedEvents: {
    title: string;
    start: string;
    end?: string;
  }[];
  extractedTasks: {
    title: string;
    dueAt: string | null;
  }[];
  suggestedReply: string | null;
  messages?: Message[];
}
/**
 * Cursor-paginated list envelope for Thread.
 */
export interface ThreadListResponse {
  contractVersion: ContractVersion;
  items: Thread[];
  pageInfo: PageInfo;
  freshness: Freshness;
  sources: SourceDescriptor[];
}
/**
 * Single-resource envelope for Thread.
 */
export interface ThreadResponse {
  contractVersion: ContractVersion;
  data: Thread;
  freshness: Freshness;
}
export interface VoiceAudioLevel {
  direction: "input" | "output";
  level: number;
  peak?: number;
  at: string;
}
export interface VoiceDevice {
  id: string;
  /**
   * Monotonic revision used for optimistic concurrency (If-Match).
   */
  version: number;
  createdAt: string;
  updatedAt: string;
  labels?: string[];
  source: SourceDescriptor;
  name: string;
  kind: "input" | "output";
  isDefault: boolean;
  status: HealthStatus;
  channels?: number;
  sampleRateHz?: number;
}
/**
 * Cursor-paginated list envelope for VoiceDevice.
 */
export interface VoiceDeviceListResponse {
  contractVersion: ContractVersion;
  items: VoiceDevice[];
  pageInfo: PageInfo;
  freshness: Freshness;
  sources: SourceDescriptor[];
}
/**
 * Status of one enrollment job.
 */
export interface VoiceEnrollment {
  id: string;
  profileId: string;
  status: "queued" | "capturing" | "calibrating" | "completed" | "failed" | "cancelled";
  samplesCaptured: number;
  samplesRequired: number;
  progress: Progress;
  /**
   * Quality of the profile after the job (null until known).
   */
  quality: number | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  /**
   * Human readable hint, e.g. the next sentence to read or the failure reason.
   */
  message: string | null;
  source: SourceDescriptor;
}
/**
 * Single-resource envelope for VoiceEnrollment.
 */
export interface VoiceEnrollmentResponse {
  contractVersion: ContractVersion;
  data: VoiceEnrollment;
  freshness: Freshness;
}
/**
 * Starts (or repeats) the enrollment of a voice profile (PLAN §38.3). The audio itself is captured by the voice service, never uploaded through this API.
 */
export interface VoiceEnrollRequest {
  /**
   * Number of samples to capture; the adapter chooses its default when omitted.
   */
  sampleTarget?: number;
  /**
   * Re-run the calibration of the threshold after the samples are captured.
   */
  recalibrate?: boolean;
}
/**
 * Pipeline latencies (PLAN §38.2).
 */
export interface VoiceMetrics {
  sampledAt: string;
  source: SourceDescriptor;
  wakeWordLatency: LatencyStat;
  speakerVerificationLatency: LatencyStat;
  sttLatency: LatencyStat;
  routerLatency: LatencyStat;
  firstToken: LatencyStat;
  ttsFirstAudio: LatencyStat;
}
/**
 * Single-resource envelope for VoiceMetrics.
 */
export interface VoiceMetricsResponse {
  contractVersion: ContractVersion;
  data: VoiceMetrics;
  freshness: Freshness;
}
/**
 * Voice enrollment profile (PLAN §38.3).
 */
export interface VoiceProfile {
  id: string;
  /**
   * Monotonic revision used for optimistic concurrency (If-Match).
   */
  version: number;
  createdAt: string;
  updatedAt: string;
  labels?: string[];
  source: SourceDescriptor;
  displayName: string;
  owner: boolean;
  sampleCount: number;
  quality: number;
  calibratedAt: string | null;
  threshold: number;
  lastTestAt: string | null;
  lastTestResult: "pass" | "fail" | "unknown";
}
/**
 * Cursor-paginated list envelope for VoiceProfile.
 */
export interface VoiceProfileListResponse {
  contractVersion: ContractVersion;
  items: VoiceProfile[];
  pageInfo: PageInfo;
  freshness: Freshness;
  sources: SourceDescriptor[];
}
/**
 * Single-resource envelope for VoiceStatus.
 */
export interface VoiceStatusResponse {
  contractVersion: ContractVersion;
  data: VoiceStatus;
  freshness: Freshness;
}
export interface VoiceTestRequest {
  kind: VoiceTestKind;
  text?: string;
  durationMs?: number;
}
export interface VoiceTestResult {
  kind: VoiceTestKind;
  success: boolean;
  startedAt: string;
  durationMs: number;
  stages: {
    name: string;
    ok: boolean;
    latencyMs: number | null;
    detail: string | null;
  }[];
  message: string;
  correlationId: string;
}
/**
 * Single-resource envelope for VoiceTestResult.
 */
export interface VoiceTestResultResponse {
  contractVersion: ContractVersion;
  data: VoiceTestResult;
  freshness: Freshness;
}
export interface VoiceTranscript {
  utteranceId: string;
  text: string;
  final: boolean;
  confidence?: number | null;
  language: string;
  speaker?: string | null;
  startedAt: string;
}
export interface VoiceTtsEnded {
  utteranceId: string;
  durationMs: number;
  interrupted: boolean;
}
export interface VoiceTtsStarted {
  utteranceId: string;
  engine: string;
  voice?: string;
  text?: string;
}
