import type { AdapterFactory, FridayAdapter, PortCategory } from "@friday/adapter-core";
import { PORT_CATEGORIES } from "@friday/adapter-core";
import { adapterIdFor } from "@friday/mock-data";
import {
  MockActivityAdapter,
  MockAgentsAdapter,
  MockApprovalsAdapter,
  MockAuditAdapter,
  MockCalendarAdapter,
  MockCommandsAdapter,
  MockCommunicationAdapter,
  MockAutomationsAdapter,
  MockFilesAdapter,
  MockMemoryAdapter,
  MockNotificationsAdapter,
  MockResearchAdapter,
  MockSystemAdapter,
  MockTasksAdapter,
  MockVoiceAdapter,
} from "./adapters";
import { mockConfigSchema, type MockAdapterOptions } from "./base";

export * from "./adapters";
export { MOCK_CONFIG_SCHEMA_ID, MockAdapterBase, mockConfigSchema, mockManifest, mockSecretFields, worldCapabilities } from "./base";
export type { MockAdapterOptions } from "./base";
export { httpTransport } from "./http-transport";
export type { HttpTransportConfig } from "./http-transport";
export { worldTransport } from "./transport";
export type { MockTransport, TransportCall } from "./transport";

const CONSTRUCTORS: Record<PortCategory, new (options: MockAdapterOptions) => FridayAdapter> = {
  tasks: MockTasksAdapter,
  activity: MockActivityAdapter,
  memory: MockMemoryAdapter,
  agents: MockAgentsAdapter,
  approvals: MockApprovalsAdapter,
  communication: MockCommunicationAdapter,
  calendar: MockCalendarAdapter,
  automations: MockAutomationsAdapter,
  research: MockResearchAdapter,
  files: MockFilesAdapter,
  voice: MockVoiceAdapter,
  notifications: MockNotificationsAdapter,
  system: MockSystemAdapter,
  audit: MockAuditAdapter,
  commands: MockCommandsAdapter,
};

/** Provider ids of the built-in mock adapters (`mock-tasks`, ...); they match the built-in allowlist of `@friday/config`. */
export const MOCK_PROVIDER_IDS = PORT_CATEGORIES.map((category) => adapterIdFor(category));

export function createMockAdapterFactory(category: PortCategory, options: MockAdapterOptions): AdapterFactory {
  const Adapter = CONSTRUCTORS[category];
  return {
    providerId: adapterIdFor(category),
    category,
    configSchema: mockConfigSchema(category),
    // `hybrid` runs the mock categories next to live ones; `live` refuses mock providers.
    modes: ["mock", "hybrid"],
    create: () => new Adapter(options),
  };
}

/** One factory per category, all wrapping the same world. */
export function createMockFactories(options: MockAdapterOptions): AdapterFactory[] {
  return PORT_CATEGORIES.map((category) => createMockAdapterFactory(category, options));
}
