import type { Settings } from "@friday/sdk";
import type { Runtime } from "../runtime/types";
import { ApiError, validationFailed } from "../util/errors";
import { voiceRuntimeStatus } from "./voice-audio";

export type RuntimeVoiceSettings = Pick<Settings["voice"], "wakeWordEnabled" | "wakeWord" | "pushToTalkKey" |
  "speakerVerificationRequired" | "storeRawRecordings" | "voiceHistoryEnabled" | "ttsRate">;

export const runtimeVoiceFields = ["wakeWordEnabled", "wakeWord", "pushToTalkKey", "speakerVerificationRequired",
  "storeRawRecordings", "voiceHistoryEnabled", "ttsRate"] as const;

export function runtimeVoiceSettings(voice: Settings["voice"]): RuntimeVoiceSettings {
  return Object.fromEntries(runtimeVoiceFields.map((field) => [field, voice[field]])) as unknown as RuntimeVoiceSettings;
}

export async function readRuntimeVoiceSettings(runtime: Runtime): Promise<{ settings: RuntimeVoiceSettings; serviceStartedAt: string }> {
  const status = await voiceRuntimeStatus(runtime);
  const value = status.runtime_settings as Record<string, unknown> | undefined;
  if (!value || typeof status.service_started_at !== "string" ||
      runtimeVoiceFields.some((field) => value[field] === undefined) ||
      typeof value.wakeWord !== "string" || typeof value.pushToTalkKey !== "string" ||
      typeof value.wakeWordEnabled !== "boolean" || typeof value.speakerVerificationRequired !== "boolean" ||
      typeof value.storeRawRecordings !== "boolean" || typeof value.voiceHistoryEnabled !== "boolean" ||
      typeof value.ttsRate !== "number" || !Number.isFinite(value.ttsRate))
    throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Sprachdienst meldet keine vollständigen Laufzeiteinstellungen." });
  return { settings: value as RuntimeVoiceSettings, serviceStartedAt: status.service_started_at };
}

export async function applyVoiceSettings(runtime: Runtime, requested: RuntimeVoiceSettings): Promise<string> {
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
    }, body: JSON.stringify(requested), signal: AbortSignal.timeout(8_000), redirect: "error" });
  } catch {
    throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Sprachdienst nicht erreichbar." });
  }
  if (response.status === 422) throw validationFailed("Sprachdienst kann diese Einstellung nicht sicher anwenden.");
  if (response.status === 423) throw new ApiError({ code: "CONFLICT", message: "Friday ist beschäftigt. Nach der Antwort erneut speichern." });
  if (!response.ok) throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Sprachdienst hat die Einstellung nicht übernommen." });
  const ack: unknown = await response.json().catch(() => null);
  const data = ack as { applied?: unknown; settings?: unknown; serviceStartedAt?: unknown } | null;
  if (data?.applied !== true || typeof data.serviceStartedAt !== "string" || JSON.stringify(data.settings) !== JSON.stringify(requested))
    throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Sprachdienst hat die Einstellung nicht bestätigt." });
  const status = await voiceRuntimeStatus(runtime);
  if (status.service_started_at !== data.serviceStartedAt || JSON.stringify(status.runtime_settings) !== JSON.stringify(requested))
    throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Aktive Spracheinstellung stimmt nicht mit der Auswahl überein." });
  return data.serviceStartedAt;
}
