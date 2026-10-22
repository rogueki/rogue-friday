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
export type ChannelKind = "email" | "telegram" | "whatsapp" | "discord" | "sms" | "phone" | "other";
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
export type HermesConfigPatch =
  | {
      key: "model.provider";
      value: string;
    }
  | {
      key: "model.default";
      value: string;
    }
  | {
      key: "agent.reasoning_effort";
      value: "" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
    }
  | {
      key: "fallback.min_switch_reset_seconds";
      value: number;
    }
  | {
      key: "fallback_model";
      value: {
        provider: string;
        model: string;
      }[];
    }
  | {
      key: "agent.auto_recovery_cycles";
      value: number;
    }
  | {
      key: "agent.run_budget_seconds";
      value: number | null;
    }
  | {
      key: "agent.budget_warning_ratio";
      value: number | null;
    }
  | {
      key: "agent.agent_cache.max_size";
      value: number;
    }
  | {
      key: "max_concurrent_sessions";
      value: number;
    }
  | {
      key: "context_file_max_chars";
      value: number;
    }
  | {
      key: "compression.enabled";
      value: boolean;
    }
  | {
      key: "compression.threshold";
      value: number;
    }
  | {
      key: "compression.target_ratio";
      value: number;
    }
  | {
      key: "compression.tail_mode";
      value: "lean" | "legacy";
    }
  | {
      key: "compression.protect_last_n";
      value: number;
    }
  | {
      key: "agent.max_turns";
      value: number;
    }
  | {
      key: "agent.gateway_timeout";
      value: number;
    }
  | {
      key: "agent.api_max_retries";
      value: number;
    }
  | {
      key: "session.terminal_continue";
      value: boolean;
    }
  | {
      key: "max_live_sessions";
      value: number;
    }
  | {
      key: "terminal.timeout";
      value: number;
    }
  | {
      key: "terminal.container_cpu";
      value: number;
    }
  | {
      key: "terminal.container_memory";
      value: number;
    }
  | {
      key: "terminal.container_disk";
      value: number;
    }
  | {
      key: "terminal.container_persistent";
      value: boolean;
    }
  | {
      key: "terminal.backend";
      value: "local" | "docker";
    }
  | {
      key: "terminal.cwd";
      value: string;
    }
  | {
      key: "terminal.docker_network";
      value: boolean;
    }
  | {
      key: "terminal.docker_mount_cwd_to_workspace";
      value: boolean;
    }
  | {
      key: "terminal.docker_volumes";
      value: string[];
    }
  | {
      key: "browser.command_timeout";
      value: number;
    }
  | {
      key: "browser.snapshot_threshold";
      value: number;
    }
  | {
      key: "browser.inactivity_timeout";
      value: number;
    }
  | {
      key: "browser.engine";
      value: "auto" | "chrome" | "lightpanda";
    }
  | {
      key: "browser.headed" | "browser.auto_local_for_private_urls";
      value: boolean;
    }
  | {
      key: "browser.dialog_policy";
      value: "must_respond" | "auto_dismiss";
    }
  | {
      key: "browser.dialog_timeout_s";
      value: number;
    }
  | {
      key: "browser.allow_private_urls";
      value: boolean;
    }
  | {
      key: "browser.use_real_profile";
      value: boolean;
    }
  | {
      key: "browser.real_profile_pin";
      value: string;
    }
  | {
      key: "browser.restrict_evaluate";
      value: boolean;
    }
  | {
      key: "browser.allow_unsafe_evaluate";
      value: boolean;
    }
  | {
      key: "code_execution.mode";
      value: "project" | "strict";
    }
  | {
      key: "code_execution.kernel_idle_timeout";
      value: number;
    }
  | {
      key: "code_execution.max_session_kernels";
      value: number;
    }
  | {
      key: "computer_use.permission_mode";
      value: "standard" | "bounded";
    }
  | {
      key: "computer_use.capability_manifest";
      value: string;
    }
  | {
      key: "computer_use.max_image_dimension";
      value: number;
    }
  | {
      key: "computer_use.ax_max_elements";
      value: number;
    }
  | {
      key: "computer_use.capture_after_mode";
      value: "som" | "ax" | "vision";
    }
  | {
      key: "toolsets";
      value: string[];
    }
  | {
      key: "command_allowlist";
      value: string[];
    }
  | {
      key: "approvals.mode";
      value: "manual" | "smart" | "off";
    }
  | {
      key: "approvals.timeout";
      value: number;
    }
  | {
      key: "approvals.denial_breaker_threshold";
      value: number;
    }
  | {
      key: "approvals.deny";
      value: string[];
    }
  | {
      key: "approvals.destructive_slash_confirm" | "approvals.mcp_reload_confirm";
      value: boolean;
    }
  | {
      key: "approvals.single_query_mode";
      value: "deny" | "approve";
    }
  | {
      key: "approvals.unattended_mode";
      value: "deny" | "approve";
    }
  | {
      key: "security.protected_instruction_files";
      value: boolean;
    }
  | {
      key: "skills.disabled";
      value: string[];
    }
  | {
      key:
        | "cron.catch_up_missed"
        | "cron.allow_agent_scheduling"
        | "cron.preflight"
        | "cron.require_restart_safe_scope"
        | "gateway.loop_watchdog"
        | "gateway.startup_watchdog";
      value: boolean;
    }
  | {
      key: "cron.max_parallel_jobs";
      value: number | null;
    }
  | {
      key: "cron.output_retention";
      value: number;
    }
  | {
      key: "cron.script_timeout_seconds";
      value: number;
    }
  | {
      key: "cron.session_db_timeout_seconds";
      value: number;
    }
  | {
      key: "cron.failure_repeat_alert_hours";
      value: number;
    }
  | {
      key: "gateway.startup_watchdog_timeout_seconds";
      value: number;
    }
  | {
      key: "gateway.restart_loop_guard.max_restarts";
      value: number;
    }
  | {
      key: "gateway.respawn_storm.max_starts";
      value: number;
    }
  | {
      key: "gateway.signal_interrupt_grace_timeout";
      value: number;
    }
  | {
      key: "logging.level";
      value: "DEBUG" | "INFO" | "WARNING";
    }
  | {
      key: "logging.max_size_mb";
      value: number;
    }
  | {
      key: "logging.backup_count";
      value: number;
    }
  | {
      key: "plugin.activation";
      pluginId: string;
      enabled: boolean;
    }
  | {
      key: "mcp.httpServer";
      name: string;
      url: string | null;
      enabled: boolean;
    }
  | {
      key: "mcp.activation";
      name: string;
      enabled: boolean;
    }
  | {
      key: "mcp.bearerCredential";
      name: string;
      token: string | null;
    }
  | {
      key: "OPENROUTER_API_KEY" | "OPENAI_API_KEY" | "ANTHROPIC_API_KEY";
      value: string | null;
    };
export type HermesCronMutationRequest = HermesCronMutationRequest1;
export type HermesMcpOAuthRequest =
  | {
      action: "start";
      name: string;
    }
  | {
      action: "status" | "cancel";
      flowId: string;
    };
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
export type MessengerProviderUpdate =
  | {
      platform: "bluebubbles";
      revision: string;
      values: {
        BLUEBUBBLES_SERVER_URL?: string | null;
        BLUEBUBBLES_PASSWORD?: string | null;
      };
    }
  | {
      platform: "buzz";
      revision: string;
      values: {
        BUZZ_RELAY_URL?: string | null;
        BUZZ_PRIVATE_KEY?: string | null;
        BUZZ_TRANSPORT?: string | null;
        BUZZ_AUTH_TAG?: string | null;
        BUZZ_CHANNELS?: string | null;
        BUZZ_HOME_CHANNEL?: string | null;
        BUZZ_ALLOWED_USERS?: string | null;
        BUZZ_POLL_INTERVAL?: string | null;
        BUZZ_REPLY_IN_THREAD?: string | null;
      };
    }
  | {
      platform: "dingtalk";
      revision: string;
      values: {
        DINGTALK_CLIENT_ID?: string | null;
        DINGTALK_CLIENT_SECRET?: string | null;
        DINGTALK_WEBHOOK_URL?: string | null;
        DINGTALK_ALLOWED_USERS?: string | null;
        DINGTALK_HOME_CHANNEL?: string | null;
        DINGTALK_HOME_CHANNEL_NAME?: string | null;
      };
    }
  | {
      platform: "feishu";
      revision: string;
      values: {
        FEISHU_APP_ID?: string | null;
        FEISHU_APP_SECRET?: string | null;
        FEISHU_DOMAIN?: string | null;
        FEISHU_ALLOWED_USERS?: string | null;
        FEISHU_HOME_CHANNEL?: string | null;
        FEISHU_HOME_CHANNEL_NAME?: string | null;
      };
    }
  | {
      platform: "google_chat";
      revision: string;
      values: {
        GOOGLE_CHAT_SERVICE_ACCOUNT_JSON?: string | null;
        GOOGLE_CHAT_HTTP_EVENTS_URL?: string | null;
        GOOGLE_CHAT_HTTP_EVENTS_AUDIENCE?: string | null;
        GOOGLE_CHAT_HTTP_EVENTS_SERVICE_ACCOUNT_EMAIL?: string | null;
        GOOGLE_CHAT_PROJECT_ID?: string | null;
        GOOGLE_CHAT_SUBSCRIPTION_NAME?: string | null;
        GOOGLE_CHAT_ALLOWED_USERS?: string | null;
        GOOGLE_CHAT_HOME_CHANNEL?: string | null;
      };
    }
  | {
      platform: "irc";
      revision: string;
      values: {
        IRC_SERVER?: string | null;
        IRC_CHANNEL?: string | null;
        IRC_NICKNAME?: string | null;
        IRC_PORT?: string | null;
        IRC_USE_TLS?: string | null;
        IRC_SERVER_PASSWORD?: string | null;
        IRC_NICKSERV_PASSWORD?: string | null;
        IRC_ALLOWED_USERS?: string | null;
        IRC_HOME_CHANNEL?: string | null;
      };
    }
  | {
      platform: "line";
      revision: string;
      values: {
        LINE_CHANNEL_ACCESS_TOKEN?: string | null;
        LINE_CHANNEL_SECRET?: string | null;
        LINE_PORT?: string | null;
        LINE_HOST?: string | null;
        LINE_PUBLIC_URL?: string | null;
        LINE_ALLOWED_USERS?: string | null;
        LINE_ALLOWED_GROUPS?: string | null;
        LINE_ALLOWED_ROOMS?: string | null;
        LINE_HOME_CHANNEL?: string | null;
        LINE_SLOW_RESPONSE_THRESHOLD?: string | null;
      };
    }
  | {
      platform: "matrix";
      revision: string;
      values: {
        MATRIX_HOMESERVER?: string | null;
        MATRIX_ACCESS_TOKEN?: string | null;
        MATRIX_PASSWORD?: string | null;
        MATRIX_ALLOWED_USERS?: string | null;
        MATRIX_HOME_CHANNEL?: string | null;
        MATRIX_HOME_CHANNEL_NAME?: string | null;
      };
    }
  | {
      platform: "mattermost";
      revision: string;
      values: {
        MATTERMOST_URL?: string | null;
        MATTERMOST_TOKEN?: string | null;
        MATTERMOST_ALLOWED_USERS?: string | null;
        MATTERMOST_HOME_CHANNEL?: string | null;
        MATTERMOST_REPLY_MODE?: string | null;
        MATTERMOST_REQUIRE_MENTION?: string | null;
        MATTERMOST_FREE_RESPONSE_CHANNELS?: string | null;
        MATTERMOST_ALLOWED_CHANNELS?: string | null;
      };
    }
  | {
      platform: "ntfy";
      revision: string;
      values: {
        NTFY_TOPIC?: string | null;
        NTFY_SERVER_URL?: string | null;
        NTFY_TOKEN?: string | null;
        NTFY_PUBLISH_TOPIC?: string | null;
        NTFY_MARKDOWN?: string | null;
        NTFY_ALLOWED_USERS?: string | null;
        NTFY_HOME_CHANNEL?: string | null;
        NTFY_HOME_CHANNEL_NAME?: string | null;
      };
    }
  | {
      platform: "photon";
      revision: string;
      values: {
        PHOTON_PROJECT_ID?: string | null;
        PHOTON_PROJECT_SECRET?: string | null;
        PHOTON_SIDECAR_PORT?: string | null;
        PHOTON_SIDECAR_TOKEN?: string | null;
        PHOTON_SIDECAR_AUTOSTART?: string | null;
        PHOTON_NODE_BIN?: string | null;
        PHOTON_DASHBOARD_HOST?: string | null;
        PHOTON_SPECTRUM_HOST?: string | null;
        PHOTON_ALLOWED_USERS?: string | null;
        PHOTON_READ_RECEIPTS?: string | null;
        PHOTON_REQUIRE_MENTION?: string | null;
        PHOTON_MENTION_PATTERNS?: string | null;
        PHOTON_HOME_CHANNEL?: string | null;
        PHOTON_HOME_CHANNEL_NAME?: string | null;
        PHOTON_TELEMETRY?: string | null;
        PHOTON_MARKDOWN?: string | null;
        PHOTON_REACTIONS?: string | null;
      };
    }
  | {
      platform: "qqbot";
      revision: string;
      values: {
        QQ_APP_ID?: string | null;
        QQ_CLIENT_SECRET?: string | null;
      };
    }
  | {
      platform: "signal";
      revision: string;
      values: {
        SIGNAL_HTTP_URL?: string | null;
        SIGNAL_ACCOUNT?: string | null;
      };
    }
  | {
      platform: "simplex";
      revision: string;
      values: {
        SIMPLEX_WS_URL?: string | null;
        SIMPLEX_ALLOWED_USERS?: string | null;
        SIMPLEX_AUTO_ACCEPT?: string | null;
        SIMPLEX_GROUP_ALLOWED?: string | null;
        SIMPLEX_HOME_CHANNEL?: string | null;
        SIMPLEX_HOME_CHANNEL_NAME?: string | null;
      };
    }
  | {
      platform: "slack";
      revision: string;
      values: {
        SLACK_BOT_TOKEN?: string | null;
        SLACK_APP_TOKEN?: string | null;
        SLACK_ALLOWED_USERS?: string | null;
        SLACK_HOME_CHANNEL?: string | null;
        SLACK_HOME_CHANNEL_NAME?: string | null;
        SLACK_THREAD_REQUIRE_MENTION?: string | null;
      };
    }
  | {
      platform: "sms";
      revision: string;
      values: {
        TWILIO_ACCOUNT_SID?: string | null;
        TWILIO_AUTH_TOKEN?: string | null;
        TWILIO_PHONE_NUMBER?: string | null;
        SMS_ALLOWED_USERS?: string | null;
        SMS_HOME_CHANNEL?: string | null;
      };
    }
  | {
      platform: "teams";
      revision: string;
      values: {
        TEAMS_CLIENT_ID?: string | null;
        TEAMS_CLIENT_SECRET?: string | null;
        TEAMS_TENANT_ID?: string | null;
        TEAMS_PORT?: string | null;
        TEAMS_HOST?: string | null;
        TEAMS_ALLOWED_USERS?: string | null;
        TEAMS_REQUIRE_MENTION?: string | null;
        TEAMS_HOME_CHANNEL?: string | null;
        TEAMS_HOME_CHANNEL_NAME?: string | null;
        TEAMS_INCOMING_WEBHOOK_URL?: string | null;
        TEAMS_GRAPH_ACCESS_TOKEN?: string | null;
      };
    }
  | {
      platform: "wecom";
      revision: string;
      values: {
        WECOM_BOT_ID?: string | null;
        WECOM_SECRET?: string | null;
        WECOM_WEBSOCKET_URL?: string | null;
        WECOM_HOME_CHANNEL?: string | null;
        WECOM_ALLOWED_USERS?: string | null;
        WECOM_CALLBACK_CORP_ID?: string | null;
        WECOM_CALLBACK_CORP_SECRET?: string | null;
        WECOM_CALLBACK_AGENT_ID?: string | null;
        WECOM_CALLBACK_TOKEN?: string | null;
        WECOM_CALLBACK_ENCODING_AES_KEY?: string | null;
      };
    }
  | {
      platform: "weixin";
      revision: string;
      values: {
        WEIXIN_TOKEN?: string | null;
        WEIXIN_ACCOUNT_ID?: string | null;
      };
    }
  | {
      platform: "whatsapp_cloud";
      revision: string;
      values: {
        WHATSAPP_CLOUD_PHONE_NUMBER_ID?: string | null;
        WHATSAPP_CLOUD_ACCESS_TOKEN?: string | null;
      };
    }
  | {
      platform: "yuanbao";
      revision: string;
      values: {
        YUANBAO_APP_ID?: string | null;
        YUANBAO_APP_SECRET?: string | null;
      };
    };
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
export interface FridayModelMap {
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
  ApplyResult: ApplyResult;
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
  BrowserAudioAvailability: BrowserAudioAvailability;
  CalDavEventCreateRequest: CalDavEventCreateRequest;
  CalDavEventCreateResponse: CalDavEventCreateResponse;
  CalDavEventPreviewRequest: CalDavEventPreviewRequest;
  CalDavEventPreviewResponse: CalDavEventPreviewResponse;
  CalendarAccountAction: CalendarAccountAction;
  CalendarAccountActionResponse: CalendarAccountActionResponse;
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
  CapabilityCatalogResponse: CapabilityCatalogResponse;
  CapabilityDescriptor: CapabilityDescriptor;
  Channel: Channel;
  ChannelKind: ChannelKind;
  ChannelListResponse: ChannelListResponse;
  ChannelResponse: ChannelResponse;
  ChannelStatus: ChannelStatus;
  CloudTalkCallRequest: CloudTalkCallRequest;
  CloudTalkCallResponse: CloudTalkCallResponse;
  CloudTalkPreviewRequest: CloudTalkPreviewRequest;
  CloudTalkPreviewResponse: CloudTalkPreviewResponse;
  CloudTalkProfilePatch: CloudTalkProfilePatch;
  CloudTalkStatusResponse: CloudTalkStatusResponse;
  CodingCliStatus: CodingCliStatus;
  CodingCliStatusResponse: CodingCliStatusResponse;
  CodingRun: CodingRun;
  CodingRunRequest: CodingRunRequest;
  CodingRunResponse: CodingRunResponse;
  CodingVoiceRepository: CodingVoiceRepository;
  CodingVoiceRepositoryPatch: CodingVoiceRepositoryPatch;
  CodingVoiceRepositoryResponse: CodingVoiceRepositoryResponse;
  CommandControlRequest: CommandControlRequest;
  CommandHistoryEntry: CommandHistoryEntry;
  CommandHistoryEntryListResponse: CommandHistoryEntryListResponse;
  CommandRequest: CommandRequest;
  CommandResponse: CommandResponse;
  ContentPlanDocument: ContentPlanDocument;
  ContentPlanState: ContentPlanState;
  ContentPlanStateResponse: ContentPlanStateResponse;
  ContentProductionJob: ContentProductionJob;
  ContentProductionJobResponse: ContentProductionJobResponse;
  ContentProductionRequest: ContentProductionRequest;
  ContentStudioKeyPatch: ContentStudioKeyPatch;
  ContentStudioKeys: ContentStudioKeys;
  ContentStudioKeysResponse: ContentStudioKeysResponse;
  ContractVersion: ContractVersion;
  ControlFrame: ControlFrame;
  CurrentWeatherResponse: CurrentWeatherResponse;
  DashboardSettings: DashboardSettings;
  DataRetentionActionRequest: DataRetentionActionRequest;
  DataRetentionActionResponse: DataRetentionActionResponse;
  DataRetentionSettings: DataRetentionSettings;
  DataRetentionStatusResponse: DataRetentionStatusResponse;
  DeveloperSettings: DeveloperSettings;
  DiscordGateway: DiscordGateway;
  DiscordGatewayPatch: DiscordGatewayPatch;
  DiscordGatewayResponse: DiscordGatewayResponse;
  Draft: Draft;
  DraftCreateRequest: DraftCreateRequest;
  DraftListResponse: DraftListResponse;
  DraftResponse: DraftResponse;
  DraftSendRequest: DraftSendRequest;
  DraftStatus: DraftStatus;
  DraftUpdateRequest: DraftUpdateRequest;
  DurableMemoryBackupResponse: DurableMemoryBackupResponse;
  DurableMemoryCaptureResponse: DurableMemoryCaptureResponse;
  DurableMemoryCorrectRequest: DurableMemoryCorrectRequest;
  DurableMemoryCorrectResponse: DurableMemoryCorrectResponse;
  DurableMemoryForgetResponse: DurableMemoryForgetResponse;
  DurableMemoryRestoreRequest: DurableMemoryRestoreRequest;
  DurableMemoryRestoreResponse: DurableMemoryRestoreResponse;
  DurableMemorySearchResponse: DurableMemorySearchResponse;
  DurableMemorySettings: DurableMemorySettings;
  DurableMemorySettingsPatch: DurableMemorySettingsPatch;
  DurableMemorySettingsResponse: DurableMemorySettingsResponse;
  DurableMemoryStatus: DurableMemoryStatus;
  DurableMemoryStatusResponse: DurableMemoryStatusResponse;
  ElevenSpeechRequest: ElevenSpeechRequest;
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
  FridayStatus: FridayStatus;
  FridayStatusResponse: FridayStatusResponse;
  FrontendErrorReport: FrontendErrorReport;
  FrontendTelemetryBatch: FrontendTelemetryBatch;
  FrontendTelemetryReceipt: FrontendTelemetryReceipt;
  FrontendTelemetryReceiptResponse: FrontendTelemetryReceiptResponse;
  Health: Health;
  HealthcheckResult: HealthcheckResult;
  HealthcheckResultResponse: HealthcheckResultResponse;
  HealthStatus: HealthStatus;
  HermesApprovalTestRequest: HermesApprovalTestRequest;
  HermesApprovalTestResponse: HermesApprovalTestResponse;
  HermesConfigPatch: HermesConfigPatch;
  HermesConfigStatus: HermesConfigStatus;
  HermesConfigStatusResponse: HermesConfigStatusResponse;
  HermesCronJobs: HermesCronJobs;
  HermesCronJobsResponse: HermesCronJobsResponse;
  HermesCronMutationReceipt: HermesCronMutationReceipt;
  HermesCronMutationRequest: HermesCronMutationRequest;
  HermesCronMutationResponse: HermesCronMutationResponse;
  HermesMcpOAuthRequest: HermesMcpOAuthRequest;
  HermesMcpOAuthResponse: HermesMcpOAuthResponse;
  HermesMcpProbeRequest: HermesMcpProbeRequest;
  HermesMcpProbeResponse: HermesMcpProbeResponse;
  HermesModelCatalog: HermesModelCatalog;
  HermesModelCatalogResponse: HermesModelCatalogResponse;
  HermesSkillKeyCheck: HermesSkillKeyCheck;
  HermesSkillKeyCheckResponse: HermesSkillKeyCheckResponse;
  HermesSkillKeyPatch: HermesSkillKeyPatch;
  HermesSkillKeys: HermesSkillKeys;
  HermesSkillKeysResponse: HermesSkillKeysResponse;
  HimalayaAccount: HimalayaAccount;
  HimalayaAccountPatch: HimalayaAccountPatch;
  HimalayaAccountResponse: HimalayaAccountResponse;
  HimalayaEnvelopeListResponse: HimalayaEnvelopeListResponse;
  HimalayaMailboxListResponse: HimalayaMailboxListResponse;
  HimalayaMessageResponse: HimalayaMessageResponse;
  HimalayaSendRequest: HimalayaSendRequest;
  HimalayaSendResponse: HimalayaSendResponse;
  HimalayaSmtpCheckResponse: HimalayaSmtpCheckResponse;
  IntegrationAccount: IntegrationAccount;
  IntegrationActionRequest: IntegrationActionRequest;
  IntegrationActionResult: IntegrationActionResult;
  IntegrationEvent: IntegrationEvent;
  IntegrationStatus: IntegrationStatus;
  IntegrationStatusResponse: IntegrationStatusResponse;
  JsonSchemaObject: JsonSchemaObject;
  KieTask: KieTask;
  KieTaskRequest: KieTaskRequest;
  KieTaskResponse: KieTaskResponse;
  LatencyStat: LatencyStat;
  Layout: Layout;
  LayoutImportRequest: LayoutImportRequest;
  LayoutListResponse: LayoutListResponse;
  LayoutResponse: LayoutResponse;
  LayoutWidget: LayoutWidget;
  LinuxEnrollmentSample: LinuxEnrollmentSample;
  LinuxEnrollmentStatus: LinuxEnrollmentStatus;
  ListEnvelope: ListEnvelope;
  LocalEventRequest: LocalEventRequest;
  LocationCandidate: LocationCandidate;
  LocationSearchResponse: LocationSearchResponse;
  LoginRequest: LoginRequest;
  MailAccount: MailAccount;
  MailAccountResponse: MailAccountResponse;
  MailAccountsResponse: MailAccountsResponse;
  MailAccountWrite: MailAccountWrite;
  MailAttachmentResponse: MailAttachmentResponse;
  MailChangeRequest: MailChangeRequest;
  MailCheckResponse: MailCheckResponse;
  MailConnectionTestRequest: MailConnectionTestRequest;
  MailConnectionTestResponse: MailConnectionTestResponse;
  MailDraftRequest: MailDraftRequest;
  MailDraftResponse: MailDraftResponse;
  MailEnvelopesResponse: MailEnvelopesResponse;
  MailFolderResponse: MailFolderResponse;
  MailMessageResponse: MailMessageResponse;
  MailOAuthPoll: MailOAuthPoll;
  MailOAuthResultResponse: MailOAuthResultResponse;
  MailOAuthStartResponse: MailOAuthStartResponse;
  MailReceipt: MailReceipt;
  MailReceiptResponse: MailReceiptResponse;
  MailReceiptsResponse: MailReceiptsResponse;
  MailResultResponse: MailResultResponse;
  MailSendRequest: MailSendRequest;
  MailSendResponse: MailSendResponse;
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
  MessengerCatalogResponse: MessengerCatalogResponse;
  MessengerConfirmRequest: MessengerConfirmRequest;
  MessengerDraft: MessengerDraft;
  MessengerInboundEvent: MessengerInboundEvent;
  MessengerInboundResponse: MessengerInboundResponse;
  MessengerPreviewResponse: MessengerPreviewResponse;
  MessengerProviderApply: MessengerProviderApply;
  MessengerProviderResponse: MessengerProviderResponse;
  MessengerProviderUpdate: MessengerProviderUpdate;
  MessengerReceipt: MessengerReceipt;
  MessengerReceiptResponse: MessengerReceiptResponse;
  MessengerReceiptsResponse: MessengerReceiptsResponse;
  MessengerSender: MessengerSender;
  MessengerSenderResponse: MessengerSenderResponse;
  MessengerSendersResponse: MessengerSendersResponse;
  MessengerTarget: MessengerTarget;
  MessengerTargetRequest: MessengerTargetRequest;
  MessengerTargetResponse: MessengerTargetResponse;
  MessengerTargetsResponse: MessengerTargetsResponse;
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
  ObsidianVault: ObsidianVault;
  ObsidianVaultPatch: ObsidianVaultPatch;
  ObsidianVaultResponse: ObsidianVaultResponse;
  OnboardingResponse: OnboardingResponse;
  OnboardingState: OnboardingState;
  OnboardingUpdate: OnboardingUpdate;
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
  PowerPointDeck: PowerPointDeck;
  PowerPointDeckListResponse: PowerPointDeckListResponse;
  PowerPointDeckRequest: PowerPointDeckRequest;
  PowerPointDeckResponse: PowerPointDeckResponse;
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
  ResearchCreateRequest: ResearchCreateRequest;
  ResearchFinding: ResearchFinding;
  ResearchFindingListResponse: ResearchFindingListResponse;
  ResearchFindingResponse: ResearchFindingResponse;
  ResearchProject: ResearchProject;
  ResearchProjectListResponse: ResearchProjectListResponse;
  ResearchProjectResponse: ResearchProjectResponse;
  ResearchProvider: ResearchProvider;
  ResearchProviderResponse: ResearchProviderResponse;
  ResearchProviderUpdateRequest: ResearchProviderUpdateRequest;
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
  SkillActivationRequest: SkillActivationRequest;
  SkillCatalogEntry: SkillCatalogEntry;
  SkillCatalogResponse: SkillCatalogResponse;
  SkillResponse: SkillResponse;
  SourceDescriptor: SourceDescriptor;
  StorageVolume: StorageVolume;
  StorageVolumeListResponse: StorageVolumeListResponse;
  SttModelCancelRequest: SttModelCancelRequest;
  SttModelDownloadRequest: SttModelDownloadRequest;
  SttModelsStatus: SttModelsStatus;
  SystemBackupActionRequest: SystemBackupActionRequest;
  SystemBackupActionResponse: SystemBackupActionResponse;
  SystemBackupStatusResponse: SystemBackupStatusResponse;
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
  TelegramGateway: TelegramGateway;
  TelegramGatewayPatch: TelegramGatewayPatch;
  TelegramGatewayResponse: TelegramGatewayResponse;
  TelephonyCallRequest: TelephonyCallRequest;
  TelephonyCallResponse: TelephonyCallResponse;
  TelephonyPreviewRequest: TelephonyPreviewRequest;
  TelephonyPreviewResponse: TelephonyPreviewResponse;
  TelephonyProfilePatch: TelephonyProfilePatch;
  TelephonyStatus: TelephonyStatus;
  TelephonyStatusResponse: TelephonyStatusResponse;
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
  VoiceCodingRunRequest: VoiceCodingRunRequest;
  VoiceConnectedCalendarConfirm: VoiceConnectedCalendarConfirm;
  VoiceConnectedCalendarRequest: VoiceConnectedCalendarRequest;
  VoiceDevice: VoiceDevice;
  VoiceDeviceListResponse: VoiceDeviceListResponse;
  VoiceEnrollment: VoiceEnrollment;
  VoiceEnrollmentResponse: VoiceEnrollmentResponse;
  VoiceEnrollRequest: VoiceEnrollRequest;
  VoiceLocalConfirmRequest: VoiceLocalConfirmRequest;
  VoiceLocalPreviewResponse: VoiceLocalPreviewResponse;
  VoiceLocalRequest: VoiceLocalRequest;
  VoiceMailConfirmRequest: VoiceMailConfirmRequest;
  VoiceMailConfirmResponse: VoiceMailConfirmResponse;
  VoiceMailPreviewResponse: VoiceMailPreviewResponse;
  VoiceMailRequest: VoiceMailRequest;
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
  WakeEnrollmentJob: WakeEnrollmentJob;
  WakeEnrollmentSample: WakeEnrollmentSample;
  WakeEnrollmentStart: WakeEnrollmentStart;
  WakeEnrollmentStatus: WakeEnrollmentStatus;
  WhatsappGateway: WhatsappGateway;
  WhatsappGatewayPatch: WhatsappGatewayPatch;
  WhatsappGatewayResponse: WhatsappGatewayResponse;
  WhatsappPairing: WhatsappPairing;
  WhatsappPairingResponse: WhatsappPairingResponse;
  WhatsappPairingStart: WhatsappPairingStart;
  WikiPath: WikiPath;
  WikiPathPatch: WikiPathPatch;
  WikiPathResponse: WikiPathResponse;
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
export interface ApplyResult {
  persisted: boolean;
  applied: boolean;
  verified: boolean;
  requiresRestart: boolean;
  errorCode: string | null;
  compensation: "not_needed" | "restored" | "failed";
  persistedRevision: number | null;
  appliedRevision: number | null;
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
   * Event type, e.g. friday.communication.thread_updated.
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
/**
 * Whether the local Linux browser voice bridge is ready for one owner session.
 */
export interface BrowserAudioAvailability {
  contractVersion: ContractVersion;
  available: boolean;
}
export interface CalDavEventCreateRequest {
  title: string;
  start: string;
  end: string;
  confirmationToken: string;
}
export interface CalDavEventCreateResponse {
  contractVersion: ContractVersion;
  data: {
    state: "created" | "unknown";
    replayed: boolean;
  };
  freshness: Freshness;
}
export interface CalDavEventPreviewRequest {
  title: string;
  start: string;
  end: string;
}
export interface CalDavEventPreviewResponse {
  contractVersion: ContractVersion;
  data: {
    title: string;
    start: string;
    end: string;
    confirmationToken: string;
    expiresAt: string;
  };
  freshness: Freshness;
}
export interface CalendarAccountAction {
  action:
    | "upsert"
    | "delete"
    | "discover"
    | "select"
    | "default"
    | "check"
    | "events"
    | "create"
    | "update"
    | "delete-event";
  accountId?: string;
  calendarId?: string;
  expectedRevision?: number | null;
  account?: {
    id?: string;
    kind: "caldav" | "ics";
    displayName: string;
    baseUrl: string;
    username: string;
    syncMinutes: number;
  };
  password?: string;
  selectedIds?: string[];
  defaultCalendarId?: string | null;
  from?: string;
  to?: string;
  eventId?: string;
  etag?: string;
  scope?: "single" | "series" | "occurrence";
  recurrenceId?: string;
  event?: {
    title: string;
    start: string;
    end: string;
    allDay?: boolean;
    description?: string;
    location?: string;
    rrule?: string;
  };
}
export interface CalendarAccountActionResponse {
  contractVersion: ContractVersion;
  data: {
    [k: string]: unknown;
  };
  freshness: Freshness;
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
  integrations?: CapabilityDescriptor[];
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
export interface CapabilityDescriptor {
  id: string;
  contractVersion: ContractVersion;
  actions: string[];
  settingsArea: string;
  requires: string[];
  roles: ("viewer" | "operator" | "owner")[];
  availability: "available" | "needs_setup" | "unsupported" | "offline";
  reasonCode: string | null;
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
export interface CapabilityCatalogResponse {
  contractVersion: ContractVersion;
  data: {
    items: CapabilityDescriptor[];
  };
  freshness: Freshness;
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
export interface CloudTalkCallRequest {
  destination: string;
  previewToken: string;
}
export interface CloudTalkCallResponse {
  contractVersion: ContractVersion;
  data: {
    id: string;
    destination: string;
    state: "pending" | "requested" | "rejected" | "unknown";
    providerStatus: number | null;
    createdAt: string;
    updatedAt: string;
    replayed?: boolean;
    note: string;
  };
  freshness: Freshness;
}
export interface CloudTalkPreviewRequest {
  destination: string;
}
export interface CloudTalkPreviewResponse {
  contractVersion: ContractVersion;
  data: {
    destination: string;
    agentId: number;
    expiresAt: string;
    token: string;
    note: string;
  };
  freshness: Freshness;
}
export interface CloudTalkProfilePatch {
  agentId?: number;
  accessKeyId?: string;
  accessKeySecret?: string;
  ownerPhone?: string;
  ownerPhoneConfirmed?: boolean;
  voiceAgentId?: string;
  remindersEnabled?: boolean;
  reminderMinutes?: number;
}
export interface CloudTalkStatusResponse {
  contractVersion: ContractVersion;
  data: {
    configured: boolean;
    agentId: number | null;
    revision: number;
    note: string;
    ownerPhone: string | null;
    ownerPhoneConfirmed: boolean;
    voiceAgentId: string | null;
    remindersEnabled: boolean;
    reminderMinutes: number;
    lastReminderState: "pending" | "requested" | "rejected" | "unknown" | null;
    lastReminderAt: string | null;
  };
  freshness: Freshness;
}
export interface CodingCliStatus {
  cli: "codex" | "opencode" | "claude-code";
  installed: boolean;
  version: string | null;
  authState: "signed_in" | "signed_out" | "stored_credentials" | "unknown";
}
export interface CodingCliStatusResponse {
  contractVersion: ContractVersion;
  data: CodingCliStatus[];
  freshness: Freshness;
}
export interface CodingRun {
  runId: string;
  status: string;
  requestedCli: "codex" | "opencode" | "claude-code" | null;
  requestedWorkdir: string | null;
  preflightVersion: string | null;
  executionVerified: boolean;
  output: string | null;
  error: string | null;
  updatedAt: number | null;
}
export interface CodingRunRequest {
  cli: "auto" | "codex" | "opencode" | "claude-code";
  repository: string;
  task: string;
}
export interface CodingRunResponse {
  contractVersion: ContractVersion;
  data: CodingRun;
  freshness: Freshness;
}
export interface CodingVoiceRepository {
  alias: string;
  repository: string;
  revision: number;
}
export interface CodingVoiceRepositoryPatch {
  alias: string;
  repository: string;
}
export interface CodingVoiceRepositoryResponse {
  contractVersion: ContractVersion;
  data: CodingVoiceRepository;
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
export interface ContentPlanDocument {
  version: 1;
  exportiert_am?: string;
  content: {
    id: string;
    titel: string;
    plattform: "LinkedIn" | "Instagram" | "Facebook" | "TikTok" | "YouTube" | "Beide";
    ziele?: ("LinkedIn" | "Instagram" | "Facebook" | "TikTok" | "YouTube")[];
    format:
      | "Reel"
      | "Feed-Post"
      | "Story"
      | "Karussell"
      | "LinkedIn-Video"
      | "LinkedIn-Karussell"
      | "TikTok-Video"
      | "YouTube-Video"
      | "YouTube-Short";
    beschreibung: string;
    zieldatum: string;
    status: "idee" | "in-arbeit" | "fertig";
  }[];
  postings: {
    id: string;
    datum: string;
    uhrzeit: string;
    plattform: "LinkedIn" | "Instagram" | "Facebook" | "TikTok" | "YouTube";
    ziele?: ("LinkedIn" | "Instagram" | "Facebook" | "TikTok" | "YouTube")[];
    format:
      | "Reel"
      | "Feed-Post"
      | "Story"
      | "Karussell"
      | "LinkedIn-Video"
      | "LinkedIn-Karussell"
      | "TikTok-Video"
      | "YouTube-Video"
      | "YouTube-Short";
    titel: string;
    status: "geplant" | "gepostet" | "verpasst";
  }[];
}
export interface ContentPlanState {
  revision: number;
  plan: ContentPlanDocument | null;
  updatedAt: string | null;
}
export interface ContentPlanStateResponse {
  contractVersion: ContractVersion;
  data: ContentPlanState;
  freshness: Freshness;
}
export interface ContentProductionJob {
  id: string;
  ideaId: string;
  kind: "image" | "video";
  state:
    | "queued"
    | "submitting"
    | "provider_pending"
    | "downloading"
    | "speech_submitting"
    | "editing"
    | "completed"
    | "provider_unknown"
    | "speech_unknown"
    | "failed"
    | "cancelled";
  providerTaskId: string | null;
  artifactReady: boolean;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface ContentProductionJobResponse {
  contractVersion: ContractVersion;
  data: ContentProductionJob;
  freshness: Freshness;
}
export interface ContentProductionRequest {
  ideaId: string;
  planRevision: number;
  voiceId?: string;
  confirmed: true;
}
export interface ContentStudioKeyPatch {
  provider: "kie" | "elevenlabs" | "capcut";
  key: string;
}
export interface ContentStudioKeys {
  kie: boolean;
  elevenlabs: boolean;
  capcut: boolean;
}
export interface ContentStudioKeysResponse {
  contractVersion: ContractVersion;
  data: ContentStudioKeys;
  freshness: Freshness;
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
export interface CurrentWeatherResponse {
  contractVersion: ContractVersion;
  data: null | {
    location: {
      label: string;
      countryCode?: string;
      latitude: number;
      longitude: number;
    };
    temperatureC: number;
    weatherCode: number;
    observedAt: string;
    fetchedAt: string;
    stale: boolean;
    provider: "Open-Meteo";
  };
  freshness: Freshness;
}
export interface DashboardSettings {
  activeLayoutId: string;
  fontScale: number;
  backgroundGrid: boolean;
  soundEffects: boolean;
  autoRefreshSeconds: number;
  compact: boolean;
  /**
   * Enables the optional Content Studio module. Missing on older settings means disabled.
   */
  contentStudioEnabled?: boolean;
  /**
   * Confirmed coarse dashboard location; absent or null means no location was chosen.
   */
  location?: null | {
    label: string;
    latitude: number;
    longitude: number;
    countryCode?: string;
  };
}
export interface DataRetentionActionRequest {
  action: "preview" | "run" | "activate" | "deactivate";
}
export interface DataRetentionActionResponse {
  contractVersion: string;
  data:
    | {
        action: "preview" | "run";
        cutoffs: {
          activity: string;
          voiceHistory: string;
          auditToArchive: string;
          notifications: string;
          temporaryFiles: string;
        };
        eligible: {
          activity: number;
          voiceHistory: number;
          auditToArchive: number;
          notifications: number;
          temporaryFiles: number;
        };
        removed?: {
          activity: number;
          voiceHistory: number;
          auditToArchive: number;
          notifications: number;
          temporaryFiles: number;
        };
        archivedAuditRows: number;
        memoryPolicy: "unlimited";
        auditPolicy: "archive-local-indefinitely";
        at?: string;
      }
    | {
        action: "activate" | "deactivate";
        automaticEnabled: boolean;
      };
  freshness: Freshness;
}
export interface DataRetentionSettings {
  activityDays: number;
  auditDays: number;
  voiceHistoryDays: number;
  notificationDays: number;
  temporaryFileDays: number;
  memoryDefaultTtlDays: number | null;
}
export interface DataRetentionStatusResponse {
  contractVersion: string;
  data: {
    running: boolean;
    last: null | {
      at: string;
      status: "success" | "failed";
      counts: null | {
        activity: number;
        voiceHistory: number;
        auditToArchive: number;
        notifications: number;
        temporaryFiles: number;
      };
      confirmedPartial: {
        activity?: number;
        voiceHistory?: number;
        auditToArchive?: number;
        notifications?: number;
        temporaryFiles?: number;
      };
      error: string | null;
    };
    automaticEnabled: boolean;
  };
  freshness: Freshness;
}
export interface DeveloperSettings {
  debugMode: boolean;
  showRawJson: boolean;
  scenarioConsole: boolean;
  orbPerfOverlay: boolean;
  logLevel: "error" | "warn" | "info" | "debug";
}
export interface DiscordGateway {
  setupUrl: string;
  tokenConfigured: boolean;
  allowedUserIds: string[];
  allowedChannelIds: string[];
  enabled: boolean | null;
  gatewayRunning: boolean | null;
  connectionState: "connected" | "disconnected" | "unknown";
  applied: boolean | null;
  revision: number;
}
export interface DiscordGatewayPatch {
  token: string;
  clearToken: boolean;
  allowedUserIds: string[];
  allowedChannelIds: string[];
  enabled: boolean;
}
export interface DiscordGatewayResponse {
  contractVersion: ContractVersion;
  data: DiscordGateway;
  freshness: Freshness;
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
export interface DurableMemoryBackupResponse {
  contractVersion: ContractVersion;
  data: {
    path: string;
    eventCount: number;
    createdAt: string;
  };
  freshness: Freshness;
}
export interface DurableMemoryCaptureResponse {
  contractVersion: ContractVersion;
  data: {
    eventId: string;
    accepted: boolean;
    pending: boolean;
  };
  freshness: Freshness;
}
export interface DurableMemoryCorrectRequest {
  text: string;
}
export interface DurableMemoryCorrectResponse {
  contractVersion: ContractVersion;
  data: {
    eventId: string;
    replacementEventId: string;
    corrected: boolean;
  };
  freshness: Freshness;
}
export interface DurableMemoryForgetResponse {
  contractVersion: ContractVersion;
  data: {
    eventId: string;
    deleted: boolean;
  };
  freshness: Freshness;
}
export interface DurableMemoryRestoreRequest {
  backupPath: string;
  targetVaultPath: string;
}
export interface DurableMemoryRestoreResponse {
  contractVersion: ContractVersion;
  data: {
    targetVaultPath: string;
    eventCount: number;
    restoredAt: string;
  };
  freshness: Freshness;
}
export interface DurableMemorySearchResponse {
  contractVersion: ContractVersion;
  data: {
    items: {
      eventId: string;
      text: string;
      occurredAt: string;
      source: string;
      channel: string;
      identityId: string | null;
      sessionId: string | null;
      score: number;
    }[];
  };
  freshness: Freshness;
}
export interface DurableMemorySettings {
  enabled: boolean;
  privateMode: boolean;
  channels: {
    dashboard: boolean;
    voice: boolean;
    hermes: boolean;
    messenger?: boolean;
  };
  retention: "unlimited";
  exclusions: string[];
}
export interface DurableMemorySettingsPatch {
  enabled: boolean;
  privateMode: boolean;
  channels: {
    dashboard: boolean;
    voice: boolean;
    hermes: boolean;
  };
}
export interface DurableMemorySettingsResponse {
  contractVersion: ContractVersion;
  data: DurableMemorySettings;
  freshness: Freshness;
}
export interface DurableMemoryStatus {
  vaultPath: string;
  ready: boolean;
  pending: number;
  lastWrittenAt: string | null;
  lastRestoreTestAt: string | null;
  lastError: string | null;
  indexState: "ready" | "unavailable" | "error";
  settings?: DurableMemorySettings;
}
export interface DurableMemoryStatusResponse {
  contractVersion: ContractVersion;
  data: DurableMemoryStatus;
  freshness: Freshness;
}
export interface ElevenSpeechRequest {
  text: string;
  voiceId: string;
  confirmed: true;
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
   * Logical location, e.g. D:\Friday\Dateien\Berichte.
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
 * Compact overall status (top bar).
 */
export interface FridayStatus {
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
 * Single-resource envelope for FridayStatus.
 */
export interface FridayStatusResponse {
  contractVersion: ContractVersion;
  data: FridayStatus;
  freshness: Freshness;
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
export interface HermesApprovalTestRequest {
  command: string;
}
export interface HermesApprovalTestResponse {
  contractVersion: ContractVersion;
  data: {
    revision: number;
    checkedAt: string;
    backend: "local" | "docker";
    verdict: "allow" | "ask-approval" | "hardline-deny" | "user-deny";
    rule: string | null;
    detail: string;
    runtimeApplied: null;
  };
  freshness: Freshness;
}
export interface HermesConfigStatus {
  installed: boolean;
  sourceRevision: string | null;
  revision: number | null;
  checkedAt: string;
  fields: {
    key:
      | "model.provider"
      | "model.default"
      | "agent.reasoning_effort"
      | "fallback.min_switch_reset_seconds"
      | "fallback_model"
      | "agent.auto_recovery_cycles"
      | "agent.run_budget_seconds"
      | "agent.budget_warning_ratio"
      | "agent.agent_cache.max_size"
      | "max_concurrent_sessions"
      | "context_file_max_chars"
      | "compression.enabled"
      | "compression.threshold"
      | "compression.target_ratio"
      | "compression.tail_mode"
      | "compression.protect_last_n"
      | "agent.max_turns"
      | "agent.gateway_timeout"
      | "agent.api_max_retries"
      | "session.terminal_continue"
      | "max_live_sessions"
      | "terminal.timeout"
      | "terminal.container_cpu"
      | "terminal.container_memory"
      | "terminal.container_disk"
      | "terminal.container_persistent"
      | "terminal.backend"
      | "terminal.cwd"
      | "terminal.docker_network"
      | "terminal.docker_mount_cwd_to_workspace"
      | "terminal.docker_volumes"
      | "browser.command_timeout"
      | "browser.snapshot_threshold"
      | "browser.inactivity_timeout"
      | "browser.engine"
      | "browser.headed"
      | "browser.auto_local_for_private_urls"
      | "browser.dialog_policy"
      | "browser.dialog_timeout_s"
      | "browser.allow_private_urls"
      | "browser.use_real_profile"
      | "browser.real_profile_pin"
      | "browser.restrict_evaluate"
      | "browser.allow_unsafe_evaluate"
      | "code_execution.mode"
      | "code_execution.kernel_idle_timeout"
      | "code_execution.max_session_kernels"
      | "computer_use.permission_mode"
      | "computer_use.capability_manifest"
      | "computer_use.max_image_dimension"
      | "computer_use.ax_max_elements"
      | "computer_use.capture_after_mode"
      | "toolsets"
      | "command_allowlist"
      | "approvals.mode"
      | "approvals.timeout"
      | "approvals.denial_breaker_threshold"
      | "approvals.deny"
      | "approvals.destructive_slash_confirm"
      | "approvals.mcp_reload_confirm"
      | "approvals.single_query_mode"
      | "approvals.unattended_mode"
      | "security.protected_instruction_files"
      | "skills.disabled"
      | "cron.catch_up_missed"
      | "cron.allow_agent_scheduling"
      | "cron.preflight"
      | "cron.max_parallel_jobs"
      | "cron.output_retention"
      | "cron.script_timeout_seconds"
      | "cron.session_db_timeout_seconds"
      | "cron.failure_repeat_alert_hours"
      | "cron.require_restart_safe_scope"
      | "gateway.loop_watchdog"
      | "gateway.startup_watchdog"
      | "gateway.startup_watchdog_timeout_seconds"
      | "gateway.restart_loop_guard.max_restarts"
      | "gateway.respawn_storm.max_starts"
      | "gateway.signal_interrupt_grace_timeout"
      | "logging.level"
      | "logging.max_size_mb"
      | "logging.backup_count";
    type:
      | "integer"
      | "optionalInteger"
      | "number"
      | "optionalNumber"
      | "boolean"
      | "string"
      | "fallback"
      | "skillNames"
      | "textList";
    family: "agent" | "models" | "execution" | "extensions" | "operations";
    consumer: string;
    value:
      | (number | boolean | string | null)
      | {
          provider: string;
          model: string;
        }[]
      | string[];
    explicit: boolean;
    writable: boolean;
    verification: "unverified";
    reasonCode: "runtime_receipt_unavailable";
  }[];
  secretStates: {
    key: "model.api_key" | "OPENROUTER_API_KEY" | "OPENAI_API_KEY" | "ANTHROPIC_API_KEY";
    configFileSet: boolean;
    effectiveConfigured: boolean | null;
  }[];
  families: {
    id: "models" | "agent" | "execution" | "extensions" | "operations";
    roots: string[];
    followup: string;
    installed: boolean | null;
    enabled: boolean | null;
    configFileSet: boolean;
    configured: boolean | null;
    authenticated: boolean | null;
    available: boolean | null;
    needsSetup: boolean | null;
    unsupported: boolean | null;
    coverage: "followup";
  }[];
  inventory: {
    scope: "profile";
    skillsComplete: boolean;
    pluginsComplete: boolean;
    modelProvidersComplete: boolean;
    reasons: string[];
  };
  skills: Extension[];
  modelProviders: {
    id: string;
    configFileSet: boolean;
    authenticated: boolean | null;
    available: boolean | null;
  }[];
  plugins: Extension[];
  mcpComplete: boolean;
  mcpServers: {
    id: string;
    transport: "http" | "stdio" | "unknown";
    enabled: boolean | null;
    endpoint: string | null;
    editable: boolean;
    authMode: "none" | "bearer" | "oauth" | "unknown";
    credentialConfigured: boolean | null;
  }[];
  write: null | {
    key: string;
    persisted: boolean;
    applied: boolean | null;
    verification: "unverified";
    reasonCode: "runtime_receipt_unavailable" | "readback_mismatch";
  };
}
export interface Extension {
  id: string;
  installed: true;
  enabled: boolean | null;
  configured: boolean | null;
  authenticated: boolean | null;
  available: boolean | null;
  needsSetup: boolean | null;
  unsupported: boolean | null;
}
export interface HermesConfigStatusResponse {
  contractVersion: ContractVersion;
  data: HermesConfigStatus;
  freshness: Freshness;
}
export interface HermesCronJobs {
  sourceRevision: string;
  profile: string;
  profileTimezone: string | null;
  storeRevision: string;
  count: number;
  truncated: boolean;
  /**
   * The store alone cannot prove scheduler process liveness.
   */
  schedulerRunning: null;
  jobs: {
    id: string;
    name: string;
    schedule: string;
    timezone: string | null;
    enabled: boolean;
    state: string;
    nextRunAt: string | null;
    lastRunAt: string | null;
  }[];
}
export interface HermesCronJobsResponse {
  contractVersion: ContractVersion;
  data: HermesCronJobs;
  freshness: Freshness;
}
export interface HermesCronMutationReceipt {
  action: "create" | "update" | "pause" | "resume" | "run" | "remove";
  jobId: string;
  profile: string;
  profileTimezone: string | null;
  storeRevision: string;
  state: string;
  accepted: true;
  executionVerified: false;
}
export interface HermesCronMutationRequest1 {
  action: "create" | "update" | "pause" | "resume" | "run" | "remove";
  expectedStoreRevision: string;
  profile: string;
  profileTimezone: string | null;
  jobId?: string;
  name?: string;
  schedule?: string;
  prompt?: string;
}
export interface HermesCronMutationResponse {
  contractVersion: ContractVersion;
  data: HermesCronMutationReceipt;
  freshness: Freshness;
}
export interface HermesMcpOAuthResponse {
  contractVersion: ContractVersion;
  data: {
    flowId: string;
    status: "starting" | "awaiting_approval" | "publishing" | "cancelling" | "configured" | "failed";
    authorizationUrl: string | null;
    revision: number | null;
    failureClass: string | null;
    runtimeApplied: null;
  };
  freshness: Freshness;
}
export interface HermesMcpProbeRequest {
  name: string;
}
export interface HermesMcpProbeResponse {
  contractVersion: ContractVersion;
  data: {
    name: string;
    revision: number;
    checkedAt: string;
    connected: boolean;
    toolCount: number | null;
    toolCountComplete: boolean;
    failureClass:
      | "auth_required"
      | "config_invalid"
      | "connect_failed"
      | "protocol_failed"
      | "protocol_unsupported"
      | "redirect_rejected"
      | "private_or_unresolved_address"
      | null;
    runtimeApplied: null;
  };
  freshness: Freshness;
}
export interface HermesModelCatalog {
  sourceRevision: string;
  checkedAt: string;
  /**
   * Pinned picker can silently omit plugin profiles whose discovery fails.
   */
  providerListComplete: boolean | null;
  providers: {
    id: string;
    label: string;
  }[];
  selected: null | {
    id: string;
    models: string[];
    origin: "curated" | "endpoint_confirmed_picker";
    probeStatus: "unsupported" | "succeeded" | "failed";
    modelAccess: boolean | null;
  };
}
export interface HermesModelCatalogResponse {
  contractVersion: ContractVersion;
  data: HermesModelCatalog;
  freshness: Freshness;
}
export interface HermesSkillKeyCheck {
  key: "AIRTABLE_API_KEY" | "NOTION_API_KEY";
  state: "verified" | "missing" | "rejected" | "permission-limited" | "unavailable";
  checkedAt: string;
}
export interface HermesSkillKeyCheckResponse {
  contractVersion: ContractVersion;
  data: HermesSkillKeyCheck;
  freshness: Freshness;
}
export interface HermesSkillKeyPatch {
  key:
    | "AIRTABLE_API_KEY"
    | "NOTION_API_KEY"
    | "TENOR_API_KEY"
    | "JINA_API_KEY"
    | "MSGRAPH_TENANT_ID"
    | "MSGRAPH_CLIENT_ID"
    | "MSGRAPH_CLIENT_SECRET";
  value: string;
}
export interface HermesSkillKeys {
  configured: {
    AIRTABLE_API_KEY: boolean;
    NOTION_API_KEY: boolean;
    TENOR_API_KEY: boolean;
    JINA_API_KEY: boolean;
    MSGRAPH_TENANT_ID: boolean;
    MSGRAPH_CLIENT_ID: boolean;
    MSGRAPH_CLIENT_SECRET: boolean;
  };
  applied: boolean | null;
}
export interface HermesSkillKeysResponse {
  contractVersion: ContractVersion;
  data: HermesSkillKeys;
  freshness: Freshness;
}
export interface HimalayaAccount {
  managed: boolean;
  configPresent: boolean;
  credentialsPresent: boolean;
  cliInstalled: boolean;
  readyForLocalUse: boolean;
  connectionChecked: boolean;
  revision: number;
}
export interface HimalayaAccountPatch {
  email: string;
  displayName: string;
  imapHost: string;
  imapPort: number;
  imapLogin: string;
  imapPassword: string;
  smtpHost: string;
  smtpPort: number;
  smtpLogin: string;
  smtpPassword: string;
  smtpEncryption: "tls" | "start-tls";
  sentFolder: string;
  draftsFolder: string;
  trashFolder: string;
}
export interface HimalayaAccountResponse {
  contractVersion: ContractVersion;
  data: HimalayaAccount;
  freshness: Freshness;
}
export interface HimalayaEnvelopeListResponse {
  contractVersion: ContractVersion;
  data: {
    mailbox: string;
    page: number;
    items: {
      id: string;
      subject: string | null;
      from:
        | {
            [k: string]: unknown;
          }[]
        | null;
      date: string | null;
      flags: unknown[] | null;
    }[];
  };
  freshness: Freshness;
}
export interface HimalayaMailboxListResponse {
  contractVersion: ContractVersion;
  data: {
    mailboxes: {
      id: string;
      name: string;
      role: string | null;
    }[];
  };
  freshness: Freshness;
}
export interface HimalayaMessageResponse {
  contractVersion: ContractVersion;
  data: {
    mailbox: string;
    id: string;
    subject: string;
    from: string;
    date: string;
    bodyText: string;
    replyTo?: string;
    messageId?: string;
    references?: string;
  };
  freshness: Freshness;
}
export interface HimalayaSendRequest {
  to: string[];
  subject: string;
  body: string;
}
export interface HimalayaSendResponse {
  contractVersion: ContractVersion;
  data: {
    state: "sent" | "unknown";
    replayed: boolean;
  };
  freshness: Freshness;
}
export interface HimalayaSmtpCheckResponse {
  contractVersion: ContractVersion;
  data: {
    ok: boolean;
  };
  freshness: Freshness;
}
export interface IntegrationAccount {
  id: string;
  kind: string;
  displayName: string;
  ownerId: string;
  configRevision: number;
  secretState: {
    [k: string]: boolean;
  };
}
/**
 * A later typed family endpoint must replace the bounded input schema for its own action; this common identity envelope is not a generic dispatch route.
 */
export interface IntegrationActionRequest {
  accountId: string | null;
  targetId: string | null;
  dialogId: string | null;
  cancellationGeneration: number | null;
}
export interface IntegrationActionResult {
  status: "completed" | "pending" | "rejected" | "uncertain";
  externalId: string | null;
  eventId: string | null;
  reasonCode: string | null;
}
/**
 * Capture candidate. A durable writer must enforce captureEligibility and redact sensitive text before storage.
 */
export interface IntegrationEvent {
  eventId: string;
  contractVersion: ContractVersion;
  eventType: "user_utterance" | "assistant_response" | "action_result";
  actor: {
    type: "user" | "assistant" | "system" | "provider";
    id: string;
    role: string | null;
  };
  identityId: string | null;
  channel: string;
  sessionId: string | null;
  dialogId: string | null;
  correlationId: string | null;
  source: string;
  occurredAt: string;
  outcome: "completed" | "aborted" | "uncertain";
  captureEligibility: "eligible" | "private" | "do_not_store";
  redaction: "complete" | "required";
  payload:
    | {
        kind: "text";
        text: string;
      }
    | {
        kind: "action";
        actionId: string;
        targetId: string | null;
        externalId: string | null;
      };
}
export interface IntegrationStatus {
  kind: string;
  id: string | null;
  installed: boolean;
  configured: boolean;
  authenticated: boolean | null;
  connected: boolean | null;
  canRead: boolean | null;
  canWrite: boolean | null;
  checkedAt: string;
  errorCode: string | null;
  persistedRevision: number;
  appliedRevision: number | null;
  verification: "verified" | "unverified" | "failed" | "requires_restart";
  settings: {
    [k: string]: {
      verification: "verified" | "unverified" | "failed" | "requires_restart";
      reasonCode: string | null;
    };
  };
}
export interface IntegrationStatusResponse {
  contractVersion: ContractVersion;
  data: IntegrationStatus;
  freshness: Freshness;
}
export interface KieTask {
  taskId: string;
  kind: "image" | "video";
  state: "waiting" | "queuing" | "generating" | "success" | "fail";
  resultUrls: string[];
  creditsConsumed: number | null;
}
export interface KieTaskRequest {
  kind: "image" | "video";
  prompt: string;
  aspectRatio: "1:1" | "16:9" | "9:16";
  confirmed: true;
}
export interface KieTaskResponse {
  contractVersion: ContractVersion;
  data: KieTask;
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
export interface LinuxEnrollmentSample {
  kind: "wake" | "short" | "negatives" | "speech";
  pcmBase64: string;
}
export interface LinuxEnrollmentStatus {
  contractVersion: ContractVersion;
  available: boolean;
  state: "pending" | "training" | "activating" | "complete" | "failed";
  phrase: string;
  shortPhrase: string | null;
  required: {
    wake: number;
    short: number;
    negatives: number;
    speech: number;
  };
  counts: {
    wake: number;
    short: number;
    negatives: number;
    speech: number;
  };
  error: string | null;
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
export interface LocalEventRequest {
  title: string;
  start: string;
  end: string;
  timeZone: string;
}
export interface LocationCandidate {
  label: string;
  region?: string;
  country: string;
  countryCode: string;
  latitude: number;
  longitude: number;
}
export interface LocationSearchResponse {
  contractVersion: ContractVersion;
  data: {
    items: LocationCandidate[];
    provider: "Open-Meteo";
  };
  freshness: Freshness;
}
export interface LoginRequest {
  username: string;
  password: string;
  rememberMe?: boolean;
  displayName?: string;
}
export interface MailAccount {
  id: string;
  displayName: string;
  email: string;
  senderName: string;
  aliases: string[];
  signature: string;
  imapHost: string;
  imapPort: number;
  imapSecurity: "tls" | "start-tls";
  imapLogin: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: "tls" | "start-tls";
  smtpLogin: string;
  sentFolder: string;
  draftsFolder: string;
  trashFolder: string;
  archiveFolder: string;
  spamFolder: string;
  authMode: "password" | "google-oauth" | "microsoft-oauth";
  oauthClientId: string;
  oauthTenant: string;
  revision: number;
  secretState: {
    imapPassword: boolean;
    smtpPassword: boolean;
    oauthRefreshToken: boolean;
  };
}
export interface MailAccountResponse {
  contractVersion: ContractVersion;
  data: MailAccount;
  freshness: Freshness;
}
export interface MailAccountsResponse {
  contractVersion: ContractVersion;
  data: {
    revision: number;
    defaultAccountId: string | null;
    accounts: MailAccount[];
  };
  freshness: Freshness;
}
export interface MailAccountWrite {
  displayName: string;
  email: string;
  senderName: string;
  aliases: string[];
  signature: string;
  imapHost: string;
  imapPort: number;
  imapSecurity: "tls" | "start-tls";
  imapLogin: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: "tls" | "start-tls";
  smtpLogin: string;
  sentFolder: string;
  draftsFolder: string;
  trashFolder: string;
  archiveFolder: string;
  spamFolder: string;
  authMode?: "password" | "google-oauth" | "microsoft-oauth";
  oauthClientId?: string;
  oauthTenant?: string;
  secrets?: {
    imapPassword?: string | null;
    smtpPassword?: string | null;
  };
}
export interface MailAttachmentResponse {
  contractVersion: ContractVersion;
  data: {
    filename: string;
    contentType: string;
    size: number;
    data: string;
  };
  freshness: Freshness;
}
export interface MailChangeRequest {
  mailbox: string;
  uid: string;
  uidValidity: string;
  kind: "move" | "flag";
  destination?: string;
}
export interface MailCheckResponse {
  contractVersion: ContractVersion;
  data: {
    ok: boolean;
    folders?: {
      id: string;
      name: string;
      role: string | null;
    }[];
  };
  freshness: Freshness;
}
/**
 * Verbindungstest fuer einen noch nicht gespeicherten Postfach-Entwurf. Der Server verbindet sich einmalig, meldet Erfolg oder einen erklaerbaren Grund und speichert nichts.
 */
export interface MailConnectionTestRequest {
  protocol: "imap" | "smtp";
  host: string;
  port: number;
  security: "tls" | "start-tls";
  username: string;
  password: string;
}
export interface MailConnectionTestResponse {
  contractVersion: ContractVersion;
  data: {
    ok: boolean;
    reason: "ok" | "auth" | "tls" | "network" | "protocol";
  };
  freshness: Freshness;
}
export interface MailDraftRequest {
  to?: string[];
  from?: string;
  subject?: string;
  body?: string;
  inReplyTo?: string;
  references?: string;
  attachments?: {
    filename: string;
    data: string;
  }[];
}
export interface MailDraftResponse {
  contractVersion: ContractVersion;
  data: {
    state: "drafted";
    messageId: string;
    alreadyPresent: boolean;
  };
  freshness: Freshness;
}
export interface MailEnvelopesResponse {
  contractVersion: ContractVersion;
  data: {
    mailbox: string;
    uidValidity: string | null;
    page: number;
    items: {
      id: string;
      subject: string;
      from: string;
      date: string;
      flags: string[];
    }[];
  };
  freshness: Freshness;
}
export interface MailFolderResponse {
  contractVersion: ContractVersion;
  data: {
    folders: {
      id: string;
      name: string;
      role: string | null;
    }[];
  };
  freshness: Freshness;
}
export interface MailMessageResponse {
  contractVersion: ContractVersion;
  data: {
    mailbox: string;
    uid: string;
    uidValidity: string | null;
    subject: string;
    from: string;
    to: string;
    date: string;
    messageId: string;
    replyTo: string;
    references: string;
    bodyText: string;
    attachments: {
      filename: string;
      contentType: string;
      size: number;
    }[];
  };
  freshness: Freshness;
}
export interface MailOAuthPoll {
  flowId: string;
}
export interface MailOAuthResultResponse {
  contractVersion: ContractVersion;
  data: {
    authorized: boolean;
    pending: boolean;
    accountId: string;
  };
  freshness: Freshness;
}
export interface MailOAuthStartResponse {
  contractVersion: ContractVersion;
  data: {
    flowId: string;
    authorizationUrl: string | null;
    verificationUri: string | null;
    userCode: string | null;
    expiresAt: string;
  };
  freshness: Freshness;
}
export interface MailReceipt {
  receiptId: string;
  accountId: string;
  state: "pending" | "sent" | "uncertain";
  archivePending: boolean;
  createdAt: string;
}
export interface MailReceiptResponse {
  contractVersion: ContractVersion;
  data: MailReceipt;
  freshness: Freshness;
}
export interface MailReceiptsResponse {
  contractVersion: ContractVersion;
  data: {
    items: MailReceipt[];
  };
  freshness: Freshness;
}
export interface MailResultResponse {
  contractVersion: ContractVersion;
  data: {
    deleted?: boolean;
    changed?: boolean;
    revision?: number;
    defaultAccountId?: string;
  };
  freshness: Freshness;
}
export interface MailSendRequest {
  to: string[];
  from?: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
  attachments?: {
    filename: string;
    data: string;
  }[];
}
export interface MailSendResponse {
  contractVersion: ContractVersion;
  data: {
    state: "sent" | "uncertain";
    archivePending: boolean;
    replayed: boolean;
    receiptId: string;
    memoryCapture: "written" | "pending" | "skipped" | "error";
  };
  freshness: Freshness;
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
export interface MessengerCatalogResponse {
  contractVersion: ContractVersion;
  data: {
    pin: "d923a5eb";
    items: {
      platform: string;
      source: "builtin" | "bundled_plugin";
      fields: {
        name: string;
        secret: boolean;
        required: boolean;
        present: boolean;
      }[];
      configured: boolean;
      gatewayRunning: boolean;
      connectionState: "connected" | "disconnected" | "unknown";
      exactSendSupported: boolean;
      nativeSetupAvailable: boolean;
    }[];
  };
  freshness: Freshness;
}
export interface MessengerConfirmRequest {
  draft: MessengerDraft;
  token: string;
}
export interface MessengerDraft {
  accountId: "default";
  platform:
    | "telegram"
    | "discord"
    | "whatsapp"
    | "slack"
    | "signal"
    | "matrix"
    | "mattermost"
    | "sms"
    | "irc"
    | "line"
    | "feishu"
    | "wecom"
    | "photon"
    | "buzz"
    | "ntfy"
    | "teams"
    | "google_chat"
    | "simplex"
    | "weixin"
    | "bluebubbles"
    | "dingtalk"
    | "whatsapp_cloud"
    | "qqbot"
    | "yuanbao";
  recipient: string;
  text: string;
  notificationId?: string;
  notificationStep?: number;
}
export interface MessengerInboundEvent {
  platform:
    | "telegram"
    | "discord"
    | "whatsapp"
    | "whatsapp_cloud"
    | "slack"
    | "signal"
    | "mattermost"
    | "matrix"
    | "sms"
    | "dingtalk"
    | "feishu"
    | "wecom"
    | "weixin"
    | "bluebubbles"
    | "qqbot"
    | "yuanbao"
    | "teams"
    | "buzz"
    | "google_chat"
    | "irc"
    | "line"
    | "ntfy"
    | "photon"
    | "simplex";
  accountId: "default";
  accountEpoch: string;
  senderId: string;
  chatId: string;
  chatType: string;
  messageId: string;
  text: string;
  suppressionReason?:
    | "private"
    | "policy_disabled"
    | "not_private_dm"
    | "unsupported_profile"
    | "multi_profile_unknown"
    | "account_changed";
  eventType?: "assistant_response" | "action_result";
  admissionEventId?: string;
  turnId?: string;
  actionId?: string;
  outcome?: "completed" | "aborted" | "uncertain";
}
export interface MessengerInboundResponse {
  contractVersion: ContractVersion;
  data: {
    reason:
      | "captured"
      | "pending"
      | "unlinked"
      | "policy_disabled"
      | "private"
      | "not_private_dm"
      | "unsupported_profile"
      | "multi_profile_unknown"
      | "account_changed"
      | "invalid";
    eventId: string | null;
    context?: {
      source: string;
      occurredAt: string;
      text: string;
    }[];
  };
  freshness: Freshness;
}
export interface MessengerPreviewResponse {
  contractVersion: ContractVersion;
  data: {
    token: string;
    expiresAt: string;
    fingerprint: string;
    draft: MessengerDraft;
    idempotencyKey?: string;
  };
  freshness: Freshness;
}
export interface MessengerProviderApply {
  revision: string;
}
export interface MessengerProviderResponse {
  contractVersion: ContractVersion;
  data: {
    state: "available" | "saved" | "partial" | "uncertain" | "applied";
    platform: string;
    revision: string;
    gatewayRestarted?: boolean;
    connectionState?: "connected" | "disconnected" | "unknown";
  };
  freshness: Freshness;
}
export interface MessengerReceipt {
  receiptId: string;
  accountId: string;
  platform: string;
  recipient: string;
  state: "pending" | "sent" | "uncertain";
  externalId: string | null;
  createdAt: string;
  replayed: boolean;
  memoryCapture?: "written" | "pending" | "skipped" | "error";
}
export interface MessengerReceiptResponse {
  contractVersion: ContractVersion;
  data: MessengerReceipt;
  freshness: Freshness;
}
export interface MessengerReceiptsResponse {
  contractVersion: ContractVersion;
  data: {
    items: MessengerReceipt[];
  };
  freshness: Freshness;
}
export interface MessengerSender {
  id: string;
  platform: string;
  accountId: "default";
  senderId: string;
  chatId: string;
  lastSeenAt: string;
  linked: boolean;
}
export interface MessengerSenderResponse {
  contractVersion: ContractVersion;
  data: MessengerSender;
  freshness: Freshness;
}
export interface MessengerSendersResponse {
  contractVersion: ContractVersion;
  data: {
    items: MessengerSender[];
  };
  freshness: Freshness;
}
export interface MessengerTarget {
  id: string;
  accountId: "default";
  platform: string;
  recipient: string;
  createdAt: string;
}
export interface MessengerTargetRequest {
  accountId: "default";
  platform:
    | "telegram"
    | "discord"
    | "whatsapp"
    | "slack"
    | "signal"
    | "matrix"
    | "mattermost"
    | "sms"
    | "irc"
    | "line"
    | "feishu"
    | "wecom"
    | "photon"
    | "buzz"
    | "ntfy"
    | "teams"
    | "google_chat"
    | "simplex"
    | "weixin"
    | "bluebubbles"
    | "dingtalk"
    | "whatsapp_cloud"
    | "qqbot"
    | "yuanbao";
  recipient: string;
}
export interface MessengerTargetResponse {
  contractVersion: ContractVersion;
  data: MessengerTarget;
  freshness: Freshness;
}
export interface MessengerTargetsResponse {
  contractVersion: ContractVersion;
  data: {
    items: MessengerTarget[];
  };
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
    state: "pending" | "awaiting_approval" | "sent" | "uncertain" | "acknowledged" | "failed" | "skipped";
    scheduledAt: string;
    sentAt: string | null;
    acknowledgedAt: string | null;
    stopOnAcknowledge?: boolean;
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
    /**
     * Configured provider account used for owner-reviewed sends.
     */
    accountId?: string;
    /**
     * Exact owner-approved destination. Empty means external delivery is not configured.
     */
    recipient?: string;
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
export interface ObsidianVault {
  path: string;
  revision: number;
  configured: boolean;
  readable: boolean;
  applied: boolean;
}
export interface ObsidianVaultPatch {
  path: string;
}
export interface ObsidianVaultResponse {
  contractVersion: ContractVersion;
  data: ObsidianVault;
  freshness: Freshness;
}
export interface OnboardingResponse {
  contractVersion: ContractVersion;
  data: OnboardingState;
  freshness: Freshness;
}
export interface OnboardingState {
  preferredName?: string;
  revision: number;
  steps: {
    intro: "pending" | "completed" | "skipped";
    profile: "pending" | "completed" | "skipped";
    skills: "pending" | "completed" | "skipped";
    accounts: "pending" | "completed" | "skipped";
    finish: "pending" | "completed" | "skipped";
  };
  goals: string[];
  selectedSkillIds: string[];
  completedAt: string | null;
  updatedAt: string | null;
}
export interface OnboardingUpdate {
  preferredName?: string;
  steps: {
    intro: "pending" | "completed" | "skipped";
    profile: "pending" | "completed" | "skipped";
    skills: "pending" | "completed" | "skipped";
    accounts: "pending" | "completed" | "skipped";
    finish: "pending" | "completed" | "skipped";
  };
  goals: string[];
  selectedSkillIds: string[];
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
 * Dominant orb status plus the parallel layers. Payload of GET /orb/status and friday.orb.status_changed.
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
  /**
   * Display name of the agent behind currentAgentId (optional; absent when unknown).
   */
  currentAgentName?: string;
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
  friday: FridayStatus;
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
  reasoningLevel?: ReasoningLevel;
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
  ttsVoiceChoice?: string | null;
  serviceStartedAt?: string | null;
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
export interface PowerPointDeck {
  id: string;
  title: string;
  slideCount: number;
  createdAt: string;
  downloadUrl: string;
}
export interface PowerPointDeckListResponse {
  contractVersion: ContractVersion;
  data: PowerPointDeck[];
  freshness: Freshness;
}
export interface PowerPointDeckRequest {
  title: string;
  slides: {
    title: string;
    bullets: string[];
  }[];
}
export interface PowerPointDeckResponse {
  contractVersion: ContractVersion;
  data: PowerPointDeck;
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
export interface ResearchCreateRequest {
  topic: string;
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
export interface ResearchProvider {
  provider: "searxng" | "wikipedia";
  endpoint: string | null;
  configured: boolean;
  version: number;
  maxSources: number;
  timeoutMs: number;
  setup: {
    available: boolean;
    state: "ready" | "stopped" | "unavailable";
    endpoint: string;
    image: string | null;
    reason: string | null;
  };
  sourceVerification: "unverified";
}
export interface ResearchProviderResponse {
  contractVersion: string;
  data: ResearchProvider;
  freshness: Freshness;
}
export interface ResearchProviderUpdateRequest {
  endpoint: string;
  /**
   * Provision the pinned local SearXNG service before selecting its fixed endpoint.
   */
  installLocal?: boolean;
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
  /**
   * Bounded plain-text extraction from a fetched page. Missing on legacy or mock sources.
   */
  contentText?: string | null;
  contentHash?: string | null;
  fetchError?: string | null;
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
  loginRequired?: boolean;
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
  setupRequired?: boolean;
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
  sttLanguage?: "de" | "en";
  sttModel?: string | null;
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
export interface SkillActivationRequest {
  enabled: boolean;
}
export interface SkillCatalogEntry {
  id: string;
  source: "friday" | "hermes";
  name: string;
  category: string;
  description: string;
  version: string | null;
  packaged: boolean;
  discovered: boolean | null;
  enabled: boolean | null;
  observedAt: string | null;
  observationSource: string;
  observationError: string | null;
  accounts: string[];
  setupRefs: string[];
  integrationRefs: string[];
  requiredCapabilities: string[];
  conditionalCapabilities: string[];
  integrationDetails: {
    id: string;
    account: "none" | "required" | "conditional";
    required: boolean;
    setupDe: string;
    reference: string;
    settingsTarget: string;
    permissions?: {
      required_prerequisites: Prerequisite[];
      optional_prerequisites: Prerequisite[];
      scope_status: "unknown" | "not_required";
      scope_notice: string;
    };
    cost?: {
      model: "host_resources" | "provider_usage" | "subscription_license" | "none" | "unknown";
      notice: string;
    };
    configured: boolean | null;
    connectionChecked: boolean | null;
  }[];
}
export interface Prerequisite {
  kind: string;
  status: "required" | "optional";
  notice: string;
}
export interface SkillCatalogResponse {
  contractVersion: ContractVersion;
  data: SkillCatalogEntry[];
  catalogError: string | null;
  hermesError: string | null;
  freshness: Freshness;
}
export interface SkillResponse {
  contractVersion: ContractVersion;
  data: SkillCatalogEntry;
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
export interface SttModelCancelRequest {
  jobId: string;
}
export interface SttModelDownloadRequest {
  model: string;
}
export interface SttModelsStatus {
  contractVersion: ContractVersion;
  localMode: boolean;
  models: {
    id: string;
    cached: boolean;
    downloadable: boolean;
  }[];
  job: null | {
    id: string;
    model: string;
    state: "downloading" | "cancelling" | "ready" | "failed" | "cancelled";
    error: string | null;
  };
}
export interface SystemBackupActionRequest {
  action: "preview" | "run" | "verify" | "restore-test";
  path?: string;
  targetPath?: string;
}
export interface SystemBackupActionResponse {
  contractVersion: string;
  data: {
    action: "preview" | "run" | "verify" | "restore-test";
    destination?: string;
    estimatedBytes?: number;
    path?: string;
    createdAt?: string;
    fileCount?: number;
    memoryEventCount?: number;
    verified?: boolean;
  };
  freshness: Freshness;
}
export interface SystemBackupStatusResponse {
  contractVersion: string;
  data: {
    enabled: boolean;
    schedule: string;
    timeZone: string;
    targetPath: string;
    running: boolean;
    coverage: "windows-and-memory" | "windows-wsl-and-memory";
    restoreMode: "isolated-verification-only";
    reprovisionRequired: true;
    last: null | {
      at: string;
      status: "success" | "failed";
      path: string | null;
      error: string | null;
    };
  };
  freshness: Freshness;
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
  provider?: string | null;
  reasoningLevel?: ReasoningLevel;
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
export interface TelegramGateway {
  tokenConfigured: boolean;
  botAuthentication: "missing" | "verified" | "invalid" | "unknown";
  botId: string | null;
  botUsername: string | null;
  receiveMode: "polling" | "webhook" | "unknown";
  allowedUserIds: string[];
  enabled: boolean | null;
  gatewayRunning: boolean | null;
  connectionState: "connected" | "disconnected" | "unknown";
  applied: boolean | null;
  revision: number;
}
export interface TelegramGatewayPatch {
  token: string;
  clearToken: boolean;
  allowedUserIds: string[];
  enabled: boolean;
}
export interface TelegramGatewayResponse {
  contractVersion: ContractVersion;
  data: TelegramGateway;
  freshness: Freshness;
}
export interface TelephonyCallRequest {
  destination: string;
  previewToken: string;
}
export interface TelephonyCallResponse {
  contractVersion: ContractVersion;
  data: {
    id: string;
    destination: string;
    state: "pending" | "requested" | "owner_answered" | "ended" | "failed" | "unknown";
    adapterStatus: number | null;
    createdAt: string;
    updatedAt: string;
    replayed?: boolean;
  };
  freshness: Freshness;
}
export interface TelephonyPreviewRequest {
  destination: string;
}
export interface TelephonyPreviewResponse {
  contractVersion: ContractVersion;
  data: {
    destination: string;
    callerId: string;
    mode: "local" | "trunk";
    expiresAt: string;
    token: string;
  };
  freshness: Freshness;
}
export interface TelephonyProfilePatch {
  mode: "local" | "trunk";
  ariUser: string;
  ariPassword: string;
  ariPort: number;
  ownerEndpoint: string;
  callerId: string;
  sipHost?: string;
  sipUser?: string;
  sipPassword?: string;
}
export interface TelephonyStatus {
  configured: boolean;
  mode: "local" | "trunk" | null;
  ariReachable: boolean;
  registration: "unavailable" | "unknown" | "unregistered" | "registered" | "not_required";
  ownerEndpoint: "unknown" | "online" | "offline";
  configurationApplied: boolean;
  dialplanLoaded: boolean;
  ready: boolean;
  revision: number;
  callerId: string | null;
}
export interface TelephonyStatusResponse {
  contractVersion: ContractVersion;
  data: TelephonyStatus;
  freshness: Freshness;
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
/**
 * Real audio level of one direction (input = microphone, output = TTS playback). Only numbers, never audio. level = smoothed RMS, peak = peak level, low/mid/high = frequency bands (< 250 Hz, 250-2000 Hz, > 2000 Hz), all normalized 0..1. Bands are optional because not every source can analyse the spectrum.
 */
export interface VoiceAudioLevel {
  direction: "input" | "output";
  level: number;
  peak?: number;
  low?: number;
  mid?: number;
  high?: number;
  at: string;
}
export interface VoiceCodingRunRequest {
  alias: string;
  revision: number;
  cli: "auto" | "codex" | "opencode" | "claude-code";
  task: string;
}
export interface VoiceConnectedCalendarConfirm {
  request: VoiceConnectedCalendarRequest;
  token: string;
  accountId: string;
  calendarId: string;
  eventId: string;
  etag: string;
}
export interface VoiceConnectedCalendarRequest {
  action: "create" | "update" | "delete";
  calendarName: string;
  targetTitle?: string;
  title?: string;
  start?: string;
  end?: string;
  timeZone?: string;
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
export interface VoiceLocalConfirmRequest {
  request: VoiceLocalRequest;
  token: string;
  targetId: string;
  version: number;
}
export interface VoiceLocalRequest {
  action: "create" | "update" | "delete";
  targetTitle?: string;
  title?: string;
  start?: string;
  end?: string;
  timeZone?: string;
}
export interface VoiceLocalPreviewResponse {
  contractVersion: ContractVersion;
  data: {
    token: string;
    expiresAt: string;
    targetId: string;
    version: number;
    action: "create" | "update" | "delete";
    event: LocalEventRequest;
  };
  freshness: Freshness;
}
export interface VoiceMailConfirmRequest {
  request: VoiceMailRequest;
  token: string;
  fingerprint: string;
}
export interface VoiceMailRequest {
  action: "compose" | "reply" | "move" | "flag";
  accountId?: string;
  mailbox?: string;
  id?: string;
  uidValidity?: string;
  destination?: string;
  to?: string[];
  subject?: string;
  body?: string;
}
export interface VoiceMailConfirmResponse {
  contractVersion: ContractVersion;
  data: {
    state: "sent" | "changed" | "unknown";
    replayed: boolean;
  };
  freshness: Freshness;
}
export interface VoiceMailPreviewResponse {
  contractVersion: ContractVersion;
  data: {
    token: string;
    expiresAt: string;
    fingerprint: string;
    accountId: string;
    accountName: string;
    action: "compose" | "reply" | "move" | "flag";
    to: string[];
    subject: string;
    body: string;
    mailbox: string;
    id: string;
    destination: string;
  };
  freshness: Freshness;
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
export interface WakeEnrollmentJob {
  jobId: string;
}
export interface WakeEnrollmentSample {
  jobId: string;
  kind: "wake" | "short" | "negatives" | "speech";
  pcmBase64: string;
}
export interface WakeEnrollmentStart {
  phrase: string;
}
export interface WakeEnrollmentStatus {
  contractVersion: ContractVersion;
  state: "idle" | "capturing" | "training" | "ready" | "failed" | "cancelled";
  jobId: string | null;
  phrase: string | null;
  shortPhrase: string | null;
  required: {
    wake: number;
    short: number;
    negatives: number;
    speech: number;
  };
  counts: {
    wake: number;
    short: number;
    negatives: number;
    speech: number;
  };
  quality: string | null;
  error: string | null;
}
export interface WhatsappGateway {
  setupUrl: string;
  mode: "bot" | "self-chat" | null;
  sessionPresent: boolean;
  allowedUserIds: string[];
  enabled: boolean | null;
  gatewayRunning: boolean | null;
  connectionState: "connected" | "disconnected" | "unknown";
  applied: boolean | null;
  revision: number;
}
export interface WhatsappGatewayPatch {
  mode: "bot" | "self-chat";
  allowedUserIds: string[];
  enabled: boolean;
}
export interface WhatsappGatewayResponse {
  contractVersion: ContractVersion;
  data: WhatsappGateway;
  freshness: Freshness;
}
export interface WhatsappPairing {
  id: string | null;
  state:
    | "idle"
    | "starting"
    | "waiting"
    | "qr_expired"
    | "connected"
    | "unverified"
    | "expired"
    | "cancelled"
    | "error";
  mode?: "bot" | "self-chat";
  qr: string | null;
  expiresAt: number | null;
  linkedIdentity: string | null;
  connectionState: "connected" | "disconnected" | "unknown";
}
export interface WhatsappPairingResponse {
  contractVersion: ContractVersion;
  data: WhatsappPairing;
  freshness: Freshness;
}
export interface WhatsappPairingStart {
  mode: "bot" | "self-chat";
}
export interface WikiPath {
  path: string;
  revision: number;
  configured: boolean;
  customized: boolean;
  readable: boolean;
  applied: boolean | null;
}
export interface WikiPathPatch {
  path: string;
}
export interface WikiPathResponse {
  contractVersion: ContractVersion;
  data: WikiPath;
  freshness: Freshness;
}
