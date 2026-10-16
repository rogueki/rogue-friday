import type {
  ActionResult,
  Actor,
  ActivityEvent,
  ActivityKind,
  Agent,
  AgentStatus,
  Approval,
  ApprovalContextRequest,
  ApprovalDecisionRequest,
  ApprovalStatus,
  ApprovalType,
  AuditEvent,
  Automation,
  AutomationCreateRequest,
  AutomationPauseAllRequest,
  AutomationPauseAllResult,
  AutomationRun,
  AutomationTestRequest,
  AutomationUpdateRequest,
  AutomationVersion,
  CalendarBriefing,
  CalendarConflict,
  CalendarEvent,
  CalDavEventCreateResponse,
  CalendarProposal,
  CalendarProposalRequest,
  Channel,
  CommandControlRequest,
  CommandHistoryEntry,
  CommandRequest,
  CommandResponse,
  Draft,
  DraftCreateRequest,
  DraftSendRequest,
  DraftStatus,
  DraftUpdateRequest,
  FileCategory,
  FileItem,
  FilePreview,
  FileRenameRequest,
  Freshness,
  HealthcheckResult,
  Memory,
  MemoryConflictResolveRequest,
  MemoryCreateRequest,
  MemoryExport,
  MemorySearchHit,
  MemorySearchRequest,
  MemorySensitivity,
  MemoryType,
  MemoryUpdateRequest,
  ModelProvider,
  Notification,
  NotificationActionRequest,
  NotificationSnoozeRequest,
  OrbSnapshot,
  PageInfo,
  Priority,
  ResearchArtifact,
  ResearchFinding,
  ResearchProject,
  ResearchSource,
  RiskTier,
  Service,
  Severity,
  SourceDescriptor,
  StorageVolume,
  SystemMetrics,
  Task,
  TaskActionRequest,
  TaskAssignRequest,
  TaskCreateRequest,
  TaskInputRequest,
  TaskStatus,
  TaskUpdateRequest,
  Thread,
  VoiceDevice,
  VoiceEnrollRequest,
  VoiceEnrollment,
  VoiceMetrics,
  VoiceProfile,
  VoiceStatus,
  VoiceTestRequest,
  VoiceTestResult,
  AdapterCategory,
} from "@friday/sdk";

// ---------------------------------------------------------------------------------------------------------------------
// Shared call shapes
// ---------------------------------------------------------------------------------------------------------------------

/** Passed to every port method. The control API fills it from the request (headers, session). */
export interface CallContext {
  /** `corr_...` of the current user action; adapters forward it to the upstream and put it into results/errors. */
  correlationId: string;
  actor?: Actor;
  signal?: AbortSignal;
}

/** Mutating calls additionally carry optimistic-concurrency and idempotency information. */
export interface MutationContext extends CallContext {
  /** `If-Match` as integer `version` of the resource. A mismatch must surface as `CONFLICT`. */
  ifMatchVersion?: number;
  /** `Idempotency-Key`. Adapters forward it so that a repeated key causes exactly one side effect. */
  idempotencyKey?: string;
}

export interface PageParams {
  cursor?: string | null;
  limit?: number;
}

/** Result of a list call: items plus pagination and data age. `sources` is derived from the items when omitted. */
export interface Page<T> {
  items: T[];
  pageInfo: PageInfo;
  freshness: Freshness;
  sources?: SourceDescriptor[];
}

/** Result of a single-resource call. */
export interface Single<T> {
  data: T;
  freshness: Freshness;
}

/** Search results without pagination (`MemorySearchResponse`). */
export interface Hits<T> {
  items: T[];
  freshness: Freshness;
  sources?: SourceDescriptor[];
}

/** Result of an action without a resource (`ActionResult` without the contract version, which the API adds). */
export type ActionOutcome = Omit<ActionResult, "contractVersion">;

export interface IdParam {
  id: string;
}

export interface FileDownload {
  fileId: string;
  filename: string;
  contentType: string;
  sizeBytes: number | null;
  /** Complete content or a stream; the API pipes it to the client. */
  body: Uint8Array | ReadableStream<Uint8Array>;
}

// ---------------------------------------------------------------------------------------------------------------------
// Ports (PLAN §10.5). Method names equal the OpenAPI operationIds of the domain.
// `*.read` methods are mandatory for a configured adapter; all other methods are optional capabilities.
// ---------------------------------------------------------------------------------------------------------------------

export interface ListTasksParams extends PageParams {
  status?: TaskStatus[];
  priority?: Priority[];
  agentId?: string;
  label?: string;
  q?: string;
  dueBefore?: string;
  updatedSince?: string;
  sort?: "-updatedAt" | "updatedAt" | "priority" | "dueAt";
}

export interface TaskPort {
  listTasks(params: ListTasksParams, call: CallContext): Promise<Page<Task>>;
  getTask(params: IdParam, call: CallContext): Promise<Single<Task>>;
  createTask?(params: { body: TaskCreateRequest }, call: MutationContext): Promise<Single<Task>>;
  updateTask?(params: IdParam & { body: TaskUpdateRequest }, call: MutationContext): Promise<Single<Task>>;
  cancelTask?(params: IdParam & { body?: TaskActionRequest }, call: MutationContext): Promise<Single<Task>>;
  retryTask?(params: IdParam & { body?: TaskActionRequest }, call: MutationContext): Promise<Single<Task>>;
  pauseTask?(params: IdParam & { body?: TaskActionRequest }, call: MutationContext): Promise<Single<Task>>;
  resumeTask?(params: IdParam & { body?: TaskActionRequest }, call: MutationContext): Promise<Single<Task>>;
  /** Answers a task that waits for input (blocker `input_needed`); the adapter resolves the blocker and continues. */
  provideTaskInput?(
    params: IdParam & { body: TaskInputRequest },
    call: MutationContext,
  ): Promise<Single<Task>>;
}

export interface ListActivityParams extends PageParams {
  /** Backfill after an event gap: only entries with a hub sequence greater than this. */
  sinceSequence?: number;
  kind?: ActivityKind[];
  severity?: Severity[];
  agentId?: string;
  taskId?: string;
  tool?: string;
  adapterId?: string;
  model?: string;
  status?: string;
  correlationId?: string;
  parentId?: string;
  from?: string;
  to?: string;
}

export interface ActivityPort {
  listActivity(params: ListActivityParams, call: CallContext): Promise<Page<ActivityEvent>>;
  getActivityEvent(params: IdParam, call: CallContext): Promise<Single<ActivityEvent>>;
}

export interface ListMemoryParams extends PageParams {
  type?: MemoryType[];
  sensitivity?: MemorySensitivity[];
  tag?: string;
  q?: string;
  locked?: boolean;
  pinned?: boolean;
}

export interface MemoryPort {
  listMemory(params: ListMemoryParams, call: CallContext): Promise<Page<Memory>>;
  getMemory(params: IdParam, call: CallContext): Promise<Single<Memory>>;
  createMemory?(params: { body: MemoryCreateRequest }, call: MutationContext): Promise<Single<Memory>>;
  updateMemory?(
    params: IdParam & { body: MemoryUpdateRequest },
    call: MutationContext,
  ): Promise<Single<Memory>>;
  deleteMemory?(params: IdParam, call: MutationContext): Promise<ActionOutcome>;
  searchMemory?(params: { body: MemorySearchRequest }, call: CallContext): Promise<Hits<MemorySearchHit>>;
  /**
   * Complete export without the `contractVersion`. The Control API removes `restricted` memories again before the
   * document leaves the system, so an adapter must not rely on its own filtering.
   */
  exportMemory?(
    params: Record<string, never>,
    call: CallContext,
  ): Promise<Omit<MemoryExport, "contractVersion">>;
  /** `conflictId` is the id of the conflicting memory (`MemoryConflict.memoryId`) of memory `id`. */
  resolveMemoryConflict?(
    params: IdParam & { conflictId: string; body: MemoryConflictResolveRequest },
    call: MutationContext,
  ): Promise<Single<Memory>>;
}

export interface ListAgentsParams extends PageParams {
  status?: AgentStatus[];
  q?: string;
}

export interface AgentPort {
  listAgents(params: ListAgentsParams, call: CallContext): Promise<Page<Agent>>;
  getAgent(params: IdParam, call: CallContext): Promise<Single<Agent>>;
  pauseAgent?(params: IdParam, call: MutationContext): Promise<Single<Agent>>;
  resumeAgent?(params: IdParam, call: MutationContext): Promise<Single<Agent>>;
  stopAgent?(params: IdParam, call: MutationContext): Promise<Single<Agent>>;
  /** `id` is the task id (`POST /tasks/{id}/assign`); `agentId: null` releases the task. */
  assignTask?(params: IdParam & { body: TaskAssignRequest }, call: MutationContext): Promise<Single<Task>>;
}

export interface ListApprovalsParams extends PageParams {
  status?: ApprovalStatus[];
  type?: ApprovalType[];
  riskTier?: RiskTier[];
  agentId?: string;
  taskId?: string;
}

export interface ApprovalPort {
  listApprovals(params: ListApprovalsParams, call: CallContext): Promise<Page<Approval>>;
  getApproval(params: IdParam, call: CallContext): Promise<Single<Approval>>;
  approveApproval?(
    params: IdParam & { body?: ApprovalDecisionRequest },
    call: MutationContext,
  ): Promise<Single<Approval>>;
  rejectApproval?(
    params: IdParam & { body?: ApprovalDecisionRequest },
    call: MutationContext,
  ): Promise<Single<Approval>>;
  requestApprovalContext?(
    params: IdParam & { body: ApprovalContextRequest },
    call: MutationContext,
  ): Promise<Single<Approval>>;
}

export interface ListThreadsParams extends PageParams {
  channelId?: string;
  status?: Array<"open" | "waiting" | "replied" | "archived">;
  priority?: Priority[];
  needsReply?: boolean;
  hasDraft?: boolean;
  q?: string;
}

export interface ListDraftsParams extends PageParams {
  threadId?: string;
  status?: DraftStatus[];
}

export interface CommunicationPort {
  listChannels(params: PageParams, call: CallContext): Promise<Page<Channel>>;
  listThreads(params: ListThreadsParams, call: CallContext): Promise<Page<Thread>>;
  getThread(params: IdParam, call: CallContext): Promise<Single<Thread>>;
  listDrafts?(params: ListDraftsParams, call: CallContext): Promise<Page<Draft>>;
  createDraft?(params: { body: DraftCreateRequest }, call: MutationContext): Promise<Single<Draft>>;
  updateDraft?(params: IdParam & { body: DraftUpdateRequest }, call: MutationContext): Promise<Single<Draft>>;
  /** Never sends directly: yields an Approval (Tier 2/3) that has to be decided before anything leaves the system. */
  requestDraftSend?(
    params: IdParam & { body?: DraftSendRequest },
    call: MutationContext,
  ): Promise<Single<Approval>>;
}

export interface ListCalendarEventsParams extends PageParams {
  from?: string;
  to?: string;
  q?: string;
}

export interface ListCalendarConflictsParams extends PageParams {
  from?: string;
  to?: string;
}

export interface ListCalendarBriefingsParams extends PageParams {
  eventId?: string;
}

export interface CalendarPort {
  listCalendarEvents(params: ListCalendarEventsParams, call: CallContext): Promise<Page<CalendarEvent>>;
  getCalendarEvent(params: IdParam, call: CallContext): Promise<Single<CalendarEvent>>;
  listCalendarConflicts(
    params: ListCalendarConflictsParams,
    call: CallContext,
  ): Promise<Page<CalendarConflict>>;
  listCalendarBriefings(
    params: ListCalendarBriefingsParams,
    call: CallContext,
  ): Promise<Page<CalendarBriefing>>;
  createCalendarProposal?(
    params: { body: CalendarProposalRequest },
    call: MutationContext,
  ): Promise<Single<CalendarProposal>>;
  createCalendarEvent?(params: { body: { title: string; start: string; end: string; uid: string } }, call: MutationContext): Promise<Single<CalDavEventCreateResponse["data"]>>;
}

export interface ListAutomationsParams extends PageParams {
  enabled?: boolean;
  q?: string;
}

export interface AutomationPort {
  listAutomations(params: ListAutomationsParams, call: CallContext): Promise<Page<Automation>>;
  getAutomation(params: IdParam, call: CallContext): Promise<Single<Automation>>;
  listAutomationRuns(params: IdParam & PageParams, call: CallContext): Promise<Page<AutomationRun>>;
  createAutomation?(
    params: { body: AutomationCreateRequest },
    call: MutationContext,
  ): Promise<Single<Automation>>;
  updateAutomation?(
    params: IdParam & { body: AutomationUpdateRequest },
    call: MutationContext,
  ): Promise<Single<Automation>>;
  testAutomation?(
    params: IdParam & { body?: AutomationTestRequest },
    call: MutationContext,
  ): Promise<Single<AutomationRun>>;
  enableAutomation?(params: IdParam, call: MutationContext): Promise<Single<Automation>>;
  disableAutomation?(params: IdParam, call: MutationContext): Promise<Single<Automation>>;
  /** Version history, newest first. */
  listAutomationVersions?(params: IdParam & PageParams, call: CallContext): Promise<Page<AutomationVersion>>;
  /** Pauses every enabled automation and reports the outcome per automation. */
  pauseAllAutomations?(
    params: { body?: AutomationPauseAllRequest },
    call: MutationContext,
  ): Promise<Single<AutomationPauseAllResult>>;
}

export interface ListResearchProjectsParams extends PageParams {
  q?: string;
}

export interface ResearchPort {
  listResearchProjects(params: ListResearchProjectsParams, call: CallContext): Promise<Page<ResearchProject>>;
  getResearchProject(params: IdParam, call: CallContext): Promise<Single<ResearchProject>>;
  listResearchSources(params: IdParam & PageParams, call: CallContext): Promise<Page<ResearchSource>>;
  listResearchFindings(params: IdParam & PageParams, call: CallContext): Promise<Page<ResearchFinding>>;
  listResearchArtifacts(params: IdParam & PageParams, call: CallContext): Promise<Page<ResearchArtifact>>;
}

export interface ListFilesParams extends PageParams {
  category?: FileCategory[];
  taskId?: string;
  tag?: string;
  q?: string;
}

export type DeleteFileResult =
  | ({ kind: "deleted" } & ActionOutcome)
  /** Deleting needs a human decision first (Tier 2/3). Nothing has been deleted yet. */
  | { kind: "approval_required"; approval: Single<Approval> };

export interface FilePort {
  listFiles(params: ListFilesParams, call: CallContext): Promise<Page<FileItem>>;
  getFile(params: IdParam, call: CallContext): Promise<Single<FileItem>>;
  getFilePreview?(params: IdParam, call: CallContext): Promise<Single<FilePreview>>;
  downloadFile?(params: IdParam & { version?: number }, call: CallContext): Promise<FileDownload>;
  deleteFile?(params: IdParam, call: MutationContext): Promise<DeleteFileResult>;
  renameFile?(
    params: IdParam & { body: FileRenameRequest },
    call: MutationContext,
  ): Promise<Single<FileItem>>;
}

export interface VoicePort {
  getVoiceStatus(params: Record<string, never>, call: CallContext): Promise<Single<VoiceStatus>>;
  listVoiceDevices(params: PageParams, call: CallContext): Promise<Page<VoiceDevice>>;
  getVoiceMetrics(params: Record<string, never>, call: CallContext): Promise<Single<VoiceMetrics>>;
  listVoiceProfiles(params: PageParams, call: CallContext): Promise<Page<VoiceProfile>>;
  runVoiceTest?(params: { body: VoiceTestRequest }, call: MutationContext): Promise<Single<VoiceTestResult>>;
  stopVoice?(params: Record<string, never>, call: MutationContext): Promise<ActionOutcome>;
  /** Starts the enrollment job of profile `id`; the job runs asynchronously and is polled with `getVoiceEnrollment`. */
  enrollVoiceProfile?(
    params: IdParam & { body?: VoiceEnrollRequest },
    call: MutationContext,
  ): Promise<Single<VoiceEnrollment>>;
  getVoiceEnrollment?(params: IdParam, call: CallContext): Promise<Single<VoiceEnrollment>>;
  /** The Control API has already checked `confirm === true`; `before` limits the deletion to older entries. */
  deleteVoiceHistory?(
    params: { confirm: boolean; before?: string },
    call: MutationContext,
  ): Promise<ActionOutcome>;
}

export interface ListNotificationsParams extends PageParams {
  priority?: Priority[];
  status?: Array<"open" | "acknowledged" | "snoozed" | "resolved">;
  category?: string;
}

export interface NotificationPort {
  listNotifications(params: ListNotificationsParams, call: CallContext): Promise<Page<Notification>>;
  acknowledgeNotification?(
    params: IdParam & { body?: NotificationActionRequest },
    call: MutationContext,
  ): Promise<Single<Notification>>;
  snoozeNotification?(
    params: IdParam & { body: NotificationSnoozeRequest },
    call: MutationContext,
  ): Promise<Single<Notification>>;
  resolveNotification?(
    params: IdParam & { body?: NotificationActionRequest },
    call: MutationContext,
  ): Promise<Single<Notification>>;
}

export interface SystemPort {
  getSystemMetrics(params: Record<string, never>, call: CallContext): Promise<Single<SystemMetrics>>;
  listServices(params: PageParams, call: CallContext): Promise<Page<Service>>;
  listStorageVolumes(params: PageParams, call: CallContext): Promise<Page<StorageVolume>>;
  listModelProviders(params: PageParams, call: CallContext): Promise<Page<ModelProvider>>;
  runServiceHealthcheck?(params: IdParam, call: MutationContext): Promise<Single<HealthcheckResult>>;
}

export interface ListAuditEventsParams extends PageParams {
  from?: string;
  to?: string;
  actor?: string;
  agentId?: string;
  taskId?: string;
  tool?: string;
  adapterId?: string;
  action?: string;
  category?: Array<"user_action" | "agent_action" | "tool_call" | "approval" | "system" | "security">;
  severity?: Severity[];
  result?: Array<"success" | "failure" | "denied" | "pending">;
}

export interface ExportAuditParams {
  from?: string;
  to?: string;
  format?: "json" | "ndjson" | "csv";
}

export interface AuditPort {
  listAuditEvents(params: ListAuditEventsParams, call: CallContext): Promise<Page<AuditEvent>>;
  getAuditEvent(params: IdParam, call: CallContext): Promise<Single<AuditEvent>>;
  /** Exports the entries as a page; the API renders `format`. */
  exportAudit?(params: ExportAuditParams, call: CallContext): Promise<Page<AuditEvent>>;
}

export interface CommandPort {
  listCommandHistory(params: PageParams, call: CallContext): Promise<Page<CommandHistoryEntry>>;
  executeCommand?(
    params: { body: CommandRequest },
    call: MutationContext,
  ): Promise<Omit<CommandResponse, "contractVersion">>;
  stopCommand?(params: { body: CommandControlRequest }, call: MutationContext): Promise<ActionOutcome>;
  pauseCommand?(params: { body: CommandControlRequest }, call: MutationContext): Promise<ActionOutcome>;
  resumeCommand?(params: { body: CommandControlRequest }, call: MutationContext): Promise<ActionOutcome>;
}

/** Source for `GET /orb/status`. Adapters may provide it; otherwise the API derives the snapshot from other ports. */
export interface OrbPort {
  getOrbStatus(params: Record<string, never>, call: CallContext): Promise<Single<OrbSnapshot>>;
}

/** Category -> port. `orb` is not an AdapterCategory in the contract; it is an internal, optional extension. */
export interface PortMap {
  tasks: TaskPort;
  activity: ActivityPort;
  memory: MemoryPort;
  agents: AgentPort;
  approvals: ApprovalPort;
  communication: CommunicationPort;
  calendar: CalendarPort;
  automations: AutomationPort;
  research: ResearchPort;
  files: FilePort;
  voice: VoicePort;
  notifications: NotificationPort;
  system: SystemPort;
  audit: AuditPort;
  commands: CommandPort;
}

export type PortCategory = keyof PortMap & AdapterCategory;
export type PortFor<C extends PortCategory> = PortMap[C];

export const PORT_CATEGORIES = [
  "tasks",
  "activity",
  "memory",
  "agents",
  "approvals",
  "communication",
  "calendar",
  "automations",
  "research",
  "files",
  "voice",
  "notifications",
  "system",
  "audit",
  "commands",
] as const satisfies readonly PortCategory[];
