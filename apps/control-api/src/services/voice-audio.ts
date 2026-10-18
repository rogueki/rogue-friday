import type { Runtime } from "../runtime/types";
import { ApiError, validationFailed } from "../util/errors";

function endpoint(runtime: Runtime, path: string): URL {
  const adapter = runtime.config.adapters.voice;
  const configured = adapter.config.baseUrl;
  if (adapter.provider !== "friday-voice-http" || typeof configured !== "string")
    throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Lokaler Sprachdienst fehlt." });
  let url: URL;
  try {
    url = new URL(configured);
    if (url.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(url.hostname) ||
        !url.port || url.username || url.password) throw new Error("not local");
  } catch {
    throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Ungültige Sprachdienst-Adresse." });
  }
  url.pathname = path;
  url.search = "";
  url.hash = "";
  return url;
}

export async function voiceRuntimeStatus(runtime: Runtime): Promise<Record<string, unknown>> {
  let response: Response;
  try { response = await fetch(endpoint(runtime, "/"), { signal: AbortSignal.timeout(5_000), redirect: "error" }); }
  catch { throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Sprachdienst nicht erreichbar." }); }
  if (!response.ok) throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Sprachdienststatus nicht verfügbar." });
  const data: unknown = await response.json().catch(() => null);
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Ungültiger Sprachdienststatus." });
  return data as Record<string, unknown>;
}

export async function applyVoiceAudio(runtime: Runtime, input: string | null, output: string | null): Promise<string> {
  let response: Response;
  const url = endpoint(runtime, "/control/audio");
  try {
    response = await fetch(url, {
      method: "POST", headers: { Authorization: `Bearer ${runtime.voiceBridgeKey.toString("base64")}`,
        "Content-Type": "application/json" },
      body: JSON.stringify({ inputDeviceId: input, outputDeviceId: output }),
      signal: AbortSignal.timeout(8_000), redirect: "error",
    });
  } catch {
    throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Audiogerät konnte nicht umgeschaltet werden. Aktiven Dienst prüfen." });
  }
  if (response.status === 409) throw validationFailed("Ausgewähltes Audiogerät ist nicht verfügbar. Bitte Gerät neu suchen.");
  if (response.status === 423) throw new ApiError({ code: "CONFLICT", message: "Friday ist gerade beschäftigt. Nach der Antwort erneut speichern." });
  if (!response.ok) throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Audiogerät wurde nicht bestätigt." });
  const acknowledgement: unknown = await response.json().catch(() => null);
  const ack = acknowledgement as Record<string, unknown> | null;
  if (ack?.applied !== true || ack.inputDeviceId !== input || ack.outputDeviceId !== output || typeof ack.serviceStartedAt !== "string")
    throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Audiogerät wurde nicht bestätigt." });
  const status = await voiceRuntimeStatus(runtime);
  if (status.service_started_at !== ack.serviceStartedAt || status.input_device_id !== input || status.output_device_id !== output)
    throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Aktives Audiogerät stimmt nicht mit der Auswahl überein." });
  return ack.serviceStartedAt;
}
