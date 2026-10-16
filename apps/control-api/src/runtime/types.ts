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
import type { ContentStudioKeysService } from "../services/content-studio-keys";
import type { ContentStudioProviderService } from "../services/content-studio-providers";
import type { ContentStudioPlanService } from "../services/content-studio-plan";
import type { ContentStudioProductionService } from "../services/content-studio-production";
import type { FrontendTelemetryService } from "../services/telemetry";
import type { AdapterWiring } from "./adapter-wiring";

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
  stores: {
    audit: AuditStore;
    idempotency: IdempotencyStore;
    commands: CommandHistoryStore;
    library: LibraryStore;
    adapterOverrides: AdapterOverrideStore;
  };
  auth: AuthService;
  approvalTokens: ApprovalTokenService;
  settings: SettingsService;
  contentStudioKeys: ContentStudioKeysService;
  contentStudioProviders: ContentStudioProviderService;
  contentStudioPlan: ContentStudioPlanService;
  contentStudioProduction: ContentStudioProductionService;
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
