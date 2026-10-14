import type { AdapterFactory } from "@jarvis/adapter-core";
import { ExampleTasksAdapter } from "./adapter";
import { PROVIDER_ID, configSchema } from "./manifest";

export { ExampleTasksAdapter } from "./adapter";
export {
  ADAPTER_ID,
  CONFIG_SCHEMA_ID,
  PROVIDER_ID,
  PROVIDER_SYSTEM,
  configSchema,
  manifest,
} from "./manifest";
export { createTaskMapping, toRawState, toTaskStatus } from "./mapping";
export type { RawEvent, RawItem } from "./provider-types";

/** Register under `PROVIDER_ID` in the registry allowlist (config/adapters.yaml: `provider: example-tasks-http`). */
export const exampleTasksFactory: AdapterFactory<"tasks"> = {
  providerId: PROVIDER_ID,
  category: "tasks",
  configSchema,
  create: () => new ExampleTasksAdapter(),
};
