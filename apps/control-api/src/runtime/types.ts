import type { AdapterRegistry } from "@friday/adapter-core";
import type { ApprovalTokenService } from "@friday/auth";
import type { FridayConfig } from "@friday/config";
import type { MockWorld, ScenarioEngine } from "@friday/mock-data";
import type { FridayMetrics, Logger } from "@friday/observability";
import type { Capabilities, SchemaValidator } from "@friday/sdk";
import type { AuditStore, AuditDraft, AuditVerification } from "../db/audit-store";
import type { Db } from "../db/database";
import type { AdapterOverrideStore, CommandHistoryStore, IdempotencyStore, LibraryStore } from "../db/stores";
import type { EventHub } from "../realtime/hub";
import type { AuthService } from "../security/auth-service";
import type { AdapterSettingsService } from "../services/adapter-settings";
import type { LogBuffer } from "../services/log-buffer";
import type { OrbService, OverviewService, StatusService } from "../services/core-views";
import type { SettingsService } from "../services/settings";
import type { NativeApprovalRequests } from "../services/native-approval-requests";
import type { PendingCommandClarifications } from "../services/pending-command-clarifications";
import type { RecentCommandListings } from "../services/recent-command-listings";
import type { EncryptedClarifiedMailDrafts } from "../services/encrypted-clarified-mail-drafts";
import type { ContentStudioKeysService } from "../services/content-studio-keys";
import type { ContentStudioProviderService } from "../services/content-studio-providers";
import type { ContentStudioPlanService } from "../services/content-studio-plan";
import type { ContentStudioProductionService } from "../services/content-studio-production";
import type { SkillsService } from "../services/skills";
import type { PowerPointService } from "../services/powerpoint";
import type { OnboardingService } from "../services/onboarding";
import type { ObsidianVaultService } from "../services/obsidian-vault";
import type { DurableMemoryService } from "../services/durable-memory";
import type { BackupJobsService } from "../services/backup-jobs";
import type { InstallationInfoService } from "../services/installation-info";
import type { DashboardUpdateService } from "../services/dashboard-update";
import type { RetentionService } from "../services/retention";
import type { WikiPathService } from "../services/wiki-path";
import type { HimalayaAccountService } from "../services/himalaya-account";
import type { TelegramGatewayService } from "../services/telegram-gateway";
import type { MessagingGatewayService } from "../services/messaging-gateways";
import type { HimalayaSendService } from "../services/himalaya-send";
import type { MailAccountsService } from "../services/mail-accounts";
import type { CalendarAccountsService } from "../services/calendar-accounts";
import type { MailSendService } from "../services/mail-send";
import type { MessengerSendService } from "../services/messenger-send";
import type { NotificationStore } from "../services/notification-store";
import type { MessengerCatalogService } from "../services/messenger-catalog";
import type { MessengerProviderService } from "../services/messenger-provider";
import type { MessengerInboundService } from "../services/messenger-inbound";
import type { CalDavCreateService } from "../services/caldav-create";
import type { HermesSkillKeysService } from "../services/hermes-skill-keys";
import type { HermesConfigService } from "../services/hermes-config";
import type { CodingRunsService } from "../services/coding-runs";
import type { CodingVoiceRepositoryService } from "../services/coding-voice-repository";
import type { ResearchService } from "../services/research";
import type { ResearchSetupService } from "../services/research-setup";
import type { TelephonyService } from "../services/telephony";
import type { CloudTalkService } from "../services/cloudtalk";
import type { FrontendTelemetryService } from "../services/telemetry";
import type { AdapterWiring } from "./adapter-wiring";
import type { RuntimeSimulation } from "./simulation";

export type ResponseValidationMode = "off" | "log" | "throw";

/** Appends to the hash-chained audit log and announces the entry on the event stream. */
export interface AuditRecorder {
  record(draft: AuditDraft): void;
  verification(): AuditVerification;
  verifyNow(): AuditVerification;
}

export interface Runtime {
  config: FridayConfig;
  env: NodeJS.ProcessEnv;
  logger: Logger;
  /** Redacted adapter log lines behind `GET /adapters/{id}/logs`; `logger` already mirrors into it. */
  logBuffer: LogBuffer;
  metrics: FridayMetrics;
  db: Db;
  validator: SchemaValidator;
  hub: EventHub;
  wiring: AdapterWiring;
  registry: AdapterRegistry;
  world: MockWorld | undefined;
  engine: ScenarioEngine | undefined;
  simulation: RuntimeSimulation | undefined;
  stores: {
    audit: AuditStore;
    idempotency: IdempotencyStore;
    commands: CommandHistoryStore;
    library: LibraryStore;
    adapterOverrides: AdapterOverrideStore;
  };
  auth: AuthService;
  /** Separate local credential for the verified Windows voice service; never exposed to browser clients. */
  voiceBridgeKey: Buffer;
  /** Read-only local Hermes calendar bridge; independent of the voice credential. */
  calendarBridgeKey: Buffer;
  /** Read-only local Hermes mail bridge; independent of owner, voice and calendar credentials. */
  mailBridgeKey: Buffer;
  hermesMemoryBridgeKey: Buffer;
  /** Local Hermes Content Studio plan bridge: plan read and revision-checked save only. */
  contentStudioBridgeKey: Buffer;
  messengerInboundBridgeKey: Buffer;
  approvalTokens: ApprovalTokenService;
  settings: SettingsService;
  nativeApprovals: NativeApprovalRequests;
  pendingCommandClarifications: PendingCommandClarifications;
  recentCommandListings: RecentCommandListings;
  encryptedClarifiedMailDrafts: EncryptedClarifiedMailDrafts;
  contentStudioKeys: ContentStudioKeysService;
  contentStudioProviders: ContentStudioProviderService;
  contentStudioPlan: ContentStudioPlanService;
  contentStudioProduction: ContentStudioProductionService;
  skills: SkillsService;
  powerpoint: PowerPointService;
  onboarding: OnboardingService;
  obsidianVault: ObsidianVaultService;
  durableMemory: DurableMemoryService;
  backupJobs: BackupJobsService;
  installation: InstallationInfoService;
  dashboardUpdates: DashboardUpdateService;
  retention: RetentionService;
  wikiPath: WikiPathService;
  himalayaAccount: HimalayaAccountService;
  telegramGateway: TelegramGatewayService;
  discordGateway: MessagingGatewayService;
  whatsappGateway: MessagingGatewayService;
  telephony: TelephonyService;
  cloudtalk: CloudTalkService;
  himalayaSend: HimalayaSendService;
  mailAccounts: MailAccountsService;
  calendarAccounts: CalendarAccountsService;
  mailSend: MailSendService;
  messengerSend: MessengerSendService;
  notifications: NotificationStore;
  messengerCatalog: MessengerCatalogService;
  messengerProvider: MessengerProviderService;
  messengerInbound: MessengerInboundService;
  caldavCreate: CalDavCreateService;
  hermesSkillKeys: HermesSkillKeysService;
  hermesConfig: HermesConfigService;
  codingRuns: CodingRunsService;
  codingVoiceRepository: CodingVoiceRepositoryService;
  research: ResearchService;
  researchSetup: ResearchSetupService;
  adapterSettings: AdapterSettingsService;
  status: StatusService;
  orb: OrbService;
  overview: OverviewService;
  telemetry: FrontendTelemetryService;
  audit: AuditRecorder;
  buildVersion: string;
  startedAt: Date;
  responseValidation: ResponseValidationMode;
  /** Forces an immediate health check of every adapter (after dev controls, settings changes, capability toggles). */
  refreshAdapters(): Promise<void>;
  /** Current time in epoch ms on the clock the data lives on (the mock world's clock in mock mode, wall time otherwise). */
  nowMs(): number;
  /** Prometheus text exposition of all metrics; refreshes the adapter-health and derived gauges first. */
  renderMetrics(): string;
  capabilities(): Capabilities;
  /** True when the capability (`tasks.create`) is currently offered; capability strings outside the document are allowed. */
  capabilityEnabled(capability: string): boolean;
  start(): Promise<void>;
  close(): Promise<void>;
}
