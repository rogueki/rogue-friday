import type { AdapterFactory } from "@friday/adapter-core";
import { LocalSystemAdapter } from "./adapter";
import { PROVIDER_ID, configSchema } from "./manifest";

export { LocalSystemAdapter } from "./adapter";
export { nodeHost } from "./host";
export type { CpuTimes, FsStats, HostApi } from "./host";
export {
  ADAPTER_ID,
  CONFIG_SCHEMA_ID,
  DEFAULT_URLS,
  PROVIDER_ID,
  PROVIDER_SYSTEM,
  configSchema,
  manifest,
} from "./manifest";
export {
  cpuUsagePercent,
  decodeCommandOutput,
  parseModelIds,
  parseNetstatEthernet,
  parseNvidiaSmi,
  parseProcNetDev,
  parseWslList,
  sampleCpu,
} from "./parsers";

/** Register under `PROVIDER_ID` in the registry allowlist (config/adapters.yaml: `provider: local-system`). */
export const localSystemFactory: AdapterFactory<"system"> = {
  providerId: PROVIDER_ID,
  category: "system",
  configSchema,
  create: () => new LocalSystemAdapter(),
};
