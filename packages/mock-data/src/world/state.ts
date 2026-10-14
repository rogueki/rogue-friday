import type {
  ActivityEvent,
  AdapterCategory,
  AdapterManifest,
  Agent,
  Approval,
  AuditEvent,
  Automation,
  AutomationRun,
  CalendarBriefing,
  CalendarConflict,
  CalendarEvent,
  CalendarProposal,
  Capabilities,
  Channel,
  CommandHistoryEntry,
  Draft,
  FileItem,
  Layout,
  Memory,
  Message,
  ModelProvider,
  Notification,
  OrbMode,
  QuickCommand,
  ResearchArtifact,
  ResearchFinding,
  ResearchProject,
  ResearchSource,
  Service,
  Settings,
  StorageVolume,
  SystemMetrics,
  Task,
  Theme,
  Thread,
  VoiceDevice,
  VoiceMetrics,
  VoiceProfile,
  VoiceStatus,
} from "@jarvis/sdk";

export type ProfileName = "default" | "empty" | "highLoad" | "longGerman";

/** `recovering` and `timeout` are transient phases used by the adapter-recovery scenario. */
export type AdapterMode = "online" | "degraded" | "offline" | "recovering" | "timeout";

export interface AdapterRuntime {
  category: AdapterCategory;
  manifest: AdapterManifest;
  enabled: boolean;
  provider: string;
  mode: AdapterMode;
  latencyMs: number | null;
  lastSuccessAt: string | null;
  lastSyncedAt: string;
  lastError: { code: string; message: string } | null;
  consecutiveFailures: number;
  circuit: "closed" | "open" | "half_open";
  /** Injected latency (ms) for operations of this adapter; null = use the global value. */
  latencyOverrideMs: number | null;
  /** Injected error rate 0..1; null = use the global value. */
  errorRateOverride: number | null;
}

export interface SyncJob {
  id: string;
  source: "mail" | "calendar" | "hermes" | "files" | "memory" | "other";
  label: string;
  startedAt: string;
}

export interface ForcedOrb {
  mode: OrbMode;
  activityText?: string;
  audioLevel?: number;
  progress?: number | null;
}

export interface OrbMemo {
  mode: OrbMode;
  since: string;
  /** JSON of the last emitted snapshot without volatile fields; change detection for jarvis.orb.status_changed. */
  signature: string;
  sourceEventId?: string;
}

export interface IdempotencyRecord {
  operation: string;
  fingerprint: string;
  response: unknown;
}

export interface ReauthToken {
  token: string;
  expiresAt: string;
}

export interface MockSession {
  authenticated: boolean;
  userId: string;
  displayName: string;
  role: "owner" | "operator" | "viewer";
  csrfToken: string;
  expiresAt: string;
  reauthUntil: string | null;
}

export interface UiHints {
  forceOrbFallback2D: boolean;
  reducedMotion: boolean;
  [key: string]: boolean;
}

export interface FileContent {
  text: string;
}

/** Complete, JSON-serializable state of the mock platform. */
export interface WorldState {
  tasks: Task[];
  activity: ActivityEvent[];
  memory: Memory[];
  agents: Agent[];
  approvals: Approval[];
  channels: Channel[];
  threads: Thread[];
  messages: Message[];
  drafts: Draft[];
  calendarEvents: CalendarEvent[];
  calendarConflicts: CalendarConflict[];
  calendarBriefings: CalendarBriefing[];
  calendarProposals: CalendarProposal[];
  automations: Automation[];
  automationRuns: AutomationRun[];
  researchProjects: ResearchProject[];
  researchSources: ResearchSource[];
  researchFindings: ResearchFinding[];
  researchArtifacts: ResearchArtifact[];
  files: FileItem[];
  fileContents: Record<string, FileContent>;
  voice: {
    status: VoiceStatus;
    devices: VoiceDevice[];
    metrics: VoiceMetrics;
    profiles: VoiceProfile[];
  };
  notifications: Notification[];
  system: {
    metrics: SystemMetrics;
    services: Service[];
    storage: StorageVolume[];
    models: ModelProvider[];
  };
  audit: AuditEvent[];
  settings: Settings;
  themes: Theme[];
  layouts: Layout[];
  commandHistory: CommandHistoryEntry[];
  commandPreviews: Record<string, { text: string; origin: string; createdAt: string; kind: string; payload: Record<string, unknown> }>;
  quickCommands: QuickCommand[];
  capabilities: Capabilities;
  adapters: AdapterRuntime[];
  sync: SyncJob[];
  orb: OrbMemo;
  forcedOrb: ForcedOrb | null;
  /** Orb mode forced for a short time (success pulse, thinking after a command). */
  transientOrb: { mode: OrbMode; until: number; activityText: string; detailText?: string } | null;
  globalPaused: boolean;
  idempotency: Record<string, IdempotencyRecord>;
  reauthTokens: ReauthToken[];
  session: MockSession;
  sequence: number;
  auditSequence: number;
  startedAt: string;
  control: { latencyMs: number; errorRate: number };
  uiHints: UiHints;
  /** Last simulated audio level 0..1 (mic while listening, TTS while speaking). */
  audioLevel: number;
  /** Set by the dev console: the Control API/hub should treat the event stream as degraded. */
  eventStreamState: "online" | "degraded" | "offline";
}
