// Deterministic foundations
export { Rng, hashString, mixInts, mulberry32Step } from "./core/prng";
export { MockClock } from "./core/clock";
export type { TimerHandle, RealTimeOptions } from "./core/clock";
export { IdFactory, ID_PREFIXES } from "./core/ids";
export { sha256Hex } from "./core/sha256";
export { computeAuditHash, createAuditEvent, verifyAuditChain } from "./core/audit-chain";
export type { ChainVerification } from "./core/audit-chain";
export { nextCronRun, isValidCron, berlinOffsetMinutes } from "./core/cron";
export { MockApiError, MockAdapterError, HTTP_STATUS_BY_CODE, isMockApiError } from "./core/errors";
export {
  ADAPTER_CATEGORIES,
  CATEGORY_LABEL,
  MODULE_CATEGORY,
  OPERATION_CAPABILITY,
  adapterIdFor,
  categoryForAdapterId,
  defaultCapabilities,
} from "./core/constants";
export type { CapabilityModule, GuardedOperation } from "./core/constants";
export { paginate } from "./core/util";
export type { Page, PageQuery } from "./core/util";

// World
export { MockWorld, DEFAULT_SEED, DEFAULT_START_TIME } from "./world/world";
export type { MockWorldOptions, WorldSnapshot, ActivityInput, AuditInput } from "./world/world";
export type { AdapterMode, AdapterRuntime, ProfileName, WorldState } from "./world/state";
export type { OpContext, WorldEvent, WorldEventListener, DeleteOutcome } from "./world/types";
export { WorldEventBus } from "./world/event-bus";
export { deriveOrbSnapshot, computeHealth, orbText, ORB_TEXT, DEFAULT_ASSISTANT_NAME } from "./world/orb";
export { sizesFor } from "./seed/profiles";
export { evaluateCondition } from "./world/services/automations";
export type { AuditExport, AuditExportFormat } from "./world/services/audit";
export type { RaiseApprovalInput } from "./world/services/approvals";
export type { RaiseNotificationInput } from "./world/services/notifications";

// Scenarios
export { ScenarioEngine } from "./scenarios/engine";
export type { PlayOptions, ScenarioEngineEvent } from "./scenarios/engine";
export { SCENARIO_DEFINITIONS, scenarioDuration } from "./scenarios/definitions";
export { AUDIO_FIXTURES, AUDIO_HZ, AUDIO_INTERVAL_MS, audioFixtureSample } from "./scenarios/fixtures";
export type { AudioFixture, AudioSample } from "./scenarios/fixtures";
export type { ScenarioAction, ScenarioDefinition, ScenarioStepDef } from "./scenarios/types";

// Transports
export { ROUTES } from "./api/routes";
export type { RouteDef, RouteInput, RouteResult } from "./api/routes";
export { handleApiRequest, matchRoute, API_PREFIX } from "./api/handler";
export type { ApiHandlerOptions } from "./api/handler";
export { MockEventHub } from "./stream/hub";
export { createMockEventSource, MockEventSocket, EVENTS_PATH } from "./stream/socket";
export type { MockEventSourceHandle, MockEventSourceOptions } from "./stream/socket";
export { createMswHandlers } from "./msw/handlers";
export type { MswHandlerOptions } from "./msw/handlers";
export { setupBrowserMocks, setupNodeMocks } from "./msw/setup";
export type { BrowserMocks, NodeMocks, MockPlatform, MockPlatformOptions } from "./msw/setup";
