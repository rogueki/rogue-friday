import type { Settings } from "@friday/sdk";
import type { Runtime } from "../runtime/types";
import { ApiError, validationFailed } from "../util/errors";
import { voiceRuntimeStatus } from "./voice-audio";

export type RuntimeVoiceSettings = Pick<Settings["voice"], "wakeWordEnabled" | "wakeWord" | "pushToTalkKey" |
  "speakerVerificationRequired" | "storeRawRecordings" | "voiceHistoryEnabled" | "sttLanguage" | "sttModel" | "ttsRate">;

export const runtimeVoiceFields = ["wakeWordEnabled", "wakeWord", "pushToTalkKey", "speakerVerificationRequired",
  "storeRawRecordings", "voiceHistoryEnabled", "sttLanguage", "sttModel", "ttsRate"] as const;

export function runtimeVoiceSettings(voice: Settings["voice"]): RuntimeVoiceSettings {
  return Object.fromEntries(runtimeVoiceFields.map((field) => [field, voice[field]])) as unknown as RuntimeVoiceSettings;
}

export type VoiceRevision = { serviceStartedAt: string; configRevision: string };

function sameSettings(value: unknown, requested: RuntimeVoiceSettings): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const fields = value as Record<string, unknown>;
  return runtimeVoiceFields.every((field) => fields[field] === requested[field]);
}

export async function readRuntimeVoiceSettings(runtime: Runtime): Promise<{ settings: RuntimeVoiceSettings } & VoiceRevision> {
  const status = await voiceRuntimeStatus(runtime);
  const value = status.runtime_settings as Record<string, unknown> | undefined;
  if (!value || typeof status.service_started_at !== "string" || typeof status.config_revision !== "string" ||
      runtimeVoiceFields.some((field) => value[field] === undefined) ||
      typeof value.wakeWord !== "string" || typeof value.pushToTalkKey !== "string" ||
      typeof value.wakeWordEnabled !== "boolean" || typeof value.speakerVerificationRequired !== "boolean" ||
      typeof value.storeRawRecordings !== "boolean" || typeof value.voiceHistoryEnabled !== "boolean" ||
      !["de", "en"].includes(String(value.sttLanguage)) ||
      !(value.sttModel === null || typeof value.sttModel === "string" && /^[a-z0-9][a-z0-9.-]{0,63}$/.test(value.sttModel)) ||
      typeof value.ttsRate !== "number" || !Number.isFinite(value.ttsRate))
    throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Sprachdienst meldet keine vollständigen Laufzeiteinstellungen." });
  return { settings: value as RuntimeVoiceSettings, serviceStartedAt: status.service_started_at,
    configRevision: status.config_revision };
}

export async function applyVoiceSettings(runtime: Runtime, requested: RuntimeVoiceSettings, expected: VoiceRevision,
  timeoutMs = 8_000): Promise<VoiceRevision> {
  const adapter = runtime.config.adapters.voice;
  const configured = adapter.config.baseUrl;
  if (adapter.provider !== "friday-voice-http" || typeof configured !== "string")
    throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Lokaler Sprachdienst fehlt." });
  let url: URL;
  try {
    url = new URL(configured);
    if (url.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(url.hostname) || !url.port || url.username || url.password) throw new Error("not local");
  } catch {
    throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Ungültige Sprachdienst-Adresse." });
  }
  url.pathname = "/control/settings";
  url.search = "";
  url.hash = "";
  let response: Response;
  try {
    response = await fetch(url, { method: "POST", headers: {
      Authorization: `Bearer ${runtime.voiceBridgeKey.toString("base64")}`, "Content-Type": "application/json",
    }, body: JSON.stringify({ settings: requested, expectedConfigRevision: expected.configRevision,
      expectedServiceStartedAt: expected.serviceStartedAt }), signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
  } catch {
    throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Sprachdienst nicht erreichbar." });
  }
  if (response.status === 422) throw validationFailed("Sprachdienst kann diese Einstellung nicht sicher anwenden.");
  if (response.status === 409) throw new ApiError({ code: "CONFLICT", message: "Sprachkonfiguration wurde inzwischen geändert. Bitte neu laden." });
  if (response.status === 423) throw new ApiError({ code: "CONFLICT", message: "Friday ist beschäftigt. Nach der Antwort erneut speichern." });
  if (!response.ok) throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Sprachdienst hat die Einstellung nicht übernommen." });
  const ack: unknown = await response.json().catch(() => null);
  const data = ack as { applied?: unknown; settings?: unknown; serviceStartedAt?: unknown; configRevision?: unknown } | null;
  if (data?.applied !== true || data.serviceStartedAt !== expected.serviceStartedAt ||
      typeof data.configRevision !== "string" || !sameSettings(data.settings, requested))
    throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Sprachdienst hat die Einstellung nicht bestätigt." });
  const status = await voiceRuntimeStatus(runtime);
  if (status.service_started_at !== data.serviceStartedAt || status.config_revision !== data.configRevision ||
      !sameSettings(status.runtime_settings, requested))
    throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Aktive Spracheinstellung stimmt nicht mit der Auswahl überein." });
  return { serviceStartedAt: data.serviceStartedAt, configRevision: data.configRevision };
}
