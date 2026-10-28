import type { Runtime } from "../runtime/types";
import { ApiError, validationFailed } from "../util/errors";

export type VoicePersona = "friday-female" | "classic" | "custom";
export const VOICE_PERSONAS: readonly VoicePersona[] = ["friday-female", "classic", "custom"];

export async function applyVoicePersona(runtime: Runtime, choice: VoicePersona): Promise<void> {
  const adapter = runtime.config.adapters.voice;
  const configured = adapter.config.baseUrl;
  if (adapter.provider !== "friday-voice-http" || typeof configured !== "string") {
    throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Der lokale Sprachdienst ist nicht eingerichtet." });
  }
  let endpoint: URL;
  try {
    endpoint = new URL(configured);
    if (endpoint.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(endpoint.hostname) ||
        !endpoint.port || endpoint.username || endpoint.password) throw new Error("not local");
  } catch {
    throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Die lokale Adresse des Sprachdiensts ist ungültig." });
  }
  endpoint.pathname = "/control/voice";
  endpoint.search = "";
  endpoint.hash = "";
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${runtime.voiceBridgeKey.toString("base64")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ voice: choice }),
      signal: AbortSignal.timeout(5_000),
      redirect: "error",
    });
  } catch {
    throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Der Sprachdienst ist derzeit nicht erreichbar." });
  }
  if (response.status === 404) {
    throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Der Sprachdienst benötigt das Stimmen-Update aus dem Installer." });
  }
  if (response.status === 423) {
    throw new ApiError({ code: "CONFLICT", message: "Friday spricht gerade. Bitte die Stimme nach der Antwort erneut speichern." });
  }
  if (response.status === 409) {
    const body = await response.json().catch(() => null) as { message?: unknown } | null;
    const message = typeof body?.message === "string" ? body.message : "Diese Stimme ist noch nicht eingerichtet.";
    throw validationFailed(message, [{ path: "voice.ttsVoice", message }]);
  }
  if (!response.ok) {
    throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Der Sprachdienst konnte die Stimme nicht umschalten." });
  }
  const body = await response.json().catch(() => null) as { applied?: unknown; voice?: unknown } | null;
  if (body?.applied !== true || body.voice !== choice) {
    throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Die neue Stimme wurde vom Sprachdienst nicht bestätigt." });
  }
}
