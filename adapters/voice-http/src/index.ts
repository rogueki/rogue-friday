import type { AdapterFactory } from "@friday/adapter-core";
import { FridayVoiceHttpAdapter } from "./adapter";
import { PROVIDER_ID, configSchema } from "./manifest";

export { FridayVoiceHttpAdapter } from "./adapter";
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
export { emptyVoiceMetricsMapper, parseRawVoiceStatus, toVoiceMode, toVoicePhase, voiceMetricsMapper, voiceStatusMapper } from "./mapping";
export type { LocalModelProbe, VoiceSettings, VoiceStatusInput } from "./mapping";
export { RAW_VOICE_PHASES, RAW_VOICE_STATES } from "./provider-types";
export type { RawAudioLevels, RawVoicePhase, RawVoiceState, RawVoiceStatus } from "./provider-types";

/** Register under `PROVIDER_ID` in the registry allowlist (config/adapters.yaml: `provider: friday-voice-http`). */
export const voiceHttpFactory: AdapterFactory<"voice"> = {
  providerId: PROVIDER_ID,
  category: "voice",
  configSchema,
  create: () => new FridayVoiceHttpAdapter(),
};
