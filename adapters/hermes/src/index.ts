import type { AdapterFactory } from "@jarvis/adapter-core";
import { HermesActivityAdapter } from "./activity-adapter";
import { HermesAgentsAdapter } from "./agents-adapter";
import type { HermesAdapterOptions } from "./base";
import { adapterIdFor, configSchemaFor, type HermesCategory } from "./manifest";
import { HermesTasksAdapter } from "./tasks-adapter";

export { HermesActivityAdapter } from "./activity-adapter";
export { HermesAgentsAdapter } from "./agents-adapter";
export { HermesTasksAdapter, taskEventType } from "./tasks-adapter";
export type { HermesAdapterOptions } from "./base";
export {
  HERMES_CATEGORIES,
  PROVIDER_SYSTEM,
  adapterIdFor,
  configSchemaFor,
  configSchemaIdFor,
  manifestFor,
  type HermesCategory,
} from "./manifest";
export { readSettings, type HermesSettings } from "./config";
export { externalTaskId, parseExternalTaskId, createTaskIds } from "./ids";
export { toAgentStatus, toHermesPriority, toPriority, toTaskStatus } from "./status";
export { WebSocketKanbanTransport, type KanbanEventTransport } from "./kanban-feed";

/** Registry allowlist entries: `hermes-tasks`, `hermes-activity`, `hermes-agents` (same ids as the placeholders). */
function createFactory<C extends HermesCategory>(
  category: C,
  create: (
    options?: HermesAdapterOptions,
  ) => HermesTasksAdapter | HermesActivityAdapter | HermesAgentsAdapter,
): AdapterFactory<C> {
  return {
    providerId: adapterIdFor(category),
    category,
    configSchema: configSchemaFor(category),
    create: () => create(),
  };
}

export const hermesTasksFactory = createFactory("tasks", (options) => new HermesTasksAdapter(options));
export const hermesActivityFactory = createFactory(
  "activity",
  (options) => new HermesActivityAdapter(options),
);
export const hermesAgentsFactory = createFactory("agents", (options) => new HermesAgentsAdapter(options));

/** All Hermes provider factories; register each under its `providerId` (allowlist). */
export const hermesFactories: readonly AdapterFactory<HermesCategory>[] = [
  hermesTasksFactory,
  hermesActivityFactory,
  hermesAgentsFactory,
];
