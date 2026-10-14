import type { AdapterFactory } from "@jarvis/adapter-core";
import { JarvisVoiceHttpAdapter } from "./adapter";
import { PROVIDER_ID, configSchema } from "./manifest";

export { JarvisVoiceHttpAdapter } from "./adapter";
export {
  ADAPTER_ID,
  CONFIG_SCHEMA_ID,
  DEFAULT_BASE_URL,
  DEFAULT_LOCAL_MODEL_URL,
  PROVIDER_ID,
  PROVIDER_SYSTEM,
  configSchema,
  manifest,
} from "./manifest";
export { emptyVoiceMetricsMapper, parseRawVoiceStatus, toVoiceMode, voiceStatusMapper } from "./mapping";
export type { LocalModelProbe, VoiceSettings, VoiceStatusInput } from "./mapping";
export { RAW_VOICE_STATES } from "./provider-types";
export type { RawVoiceState, RawVoiceStatus } from "./provider-types";

/** Register under `PROVIDER_ID` in the registry allowlist (config/adapters.yaml: `provider: jarvis-voice-http`). */
export const voiceHttpFactory: AdapterFactory<"voice"> = {
  providerId: PROVIDER_ID,
  category: "voice",
  configSchema,
  create: () => new JarvisVoiceHttpAdapter(),
};
