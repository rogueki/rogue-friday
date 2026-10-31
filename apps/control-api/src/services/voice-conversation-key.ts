import type { Runtime } from "../runtime/types";
import { ApiError, validationFailed } from "../util/errors";
import { readRuntimeVoiceSettings } from "./voice-settings";

const REGION_LABEL = { "ap-southeast-1": "International (Singapur)", "cn-beijing": "Festlandchina (Peking)" } as const;

function voiceUrl(runtime: Runtime, path: string): URL {
  const adapter = runtime.config.adapters.voice;
  if (adapter.provider !== "friday-voice-http" || typeof adapter.config.baseUrl !== "string")
    throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Lokaler Sprachdienst fehlt." });
  let url: URL;
  try {
    url = new URL(adapter.config.baseUrl);
    if (url.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(url.hostname) || !url.port || url.username || url.password)
      throw new Error("not local");
  } catch { throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Ungültige Sprachdienst-Adresse." }); }
  url.pathname = path;
  url.search = ""; url.hash = "";
  return url;
}

export async function setConversationKey(runtime: Runtime, apiKey: string): Promise<{ keyConfigured: boolean }> {
  const url = voiceUrl(runtime, "/control/conversation-key");
  let response: Response;
  try {
    response = await fetch(url, { method: "POST", headers: {
      Authorization: `Bearer ${runtime.voiceBridgeKey.toString("base64")}`,
      "Content-Type": "application/json",
    }, body: JSON.stringify({ apiKey }), signal: AbortSignal.timeout(30_000), redirect: "error" });
  } catch { throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Sprachdienst nicht erreichbar." }); }
  if (response.status === 422) {
    const reason = response.statusText;
    if (reason.includes("rejected the key")) throw validationFailed("Qwen Audio hat den Schlüssel abgelehnt. Bitte den Token-Plan-Schlüssel und die Qwen-Region prüfen.");
    if (reason.includes("check failed: quota")) throw validationFailed("Kontingent des Token Plans aufgebraucht; der Schlüssel wurde nicht gespeichert.");
    if (reason.includes("check failed: network")) throw validationFailed("Qwen Audio ist gerade nicht erreichbar; der Schlüssel wurde nicht gespeichert.");
    if (reason.includes("check failed: model")) throw validationFailed("Qwen Audio ist in diesem Token Plan nicht freigeschaltet.");
    if (reason.includes("RuntimeError")) throw validationFailed("Der Schlüssel kann auf dieser Installation nur über den Installer gespeichert werden.");
    throw validationFailed("Der Schlüssel wurde nicht gespeichert.");
  }
  if (!response.ok) throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Sprachdienst hat den Schlüssel nicht gespeichert." });
  const data: unknown = await response.json().catch(() => null);
  if (!data || typeof data !== "object" || Array.isArray(data) || (data as { keyConfigured?: unknown }).keyConfigured !== true)
    throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Sprachdienst hat den Schlüssel nicht bestätigt." });
  return { keyConfigured: true };
}

const CHECK_REASONS = ["missing", "auth", "quota", "rate", "idle", "model", "network", "protocol"] as const;
type CheckReason = typeof CHECK_REASONS[number];

export async function checkConversationKey(runtime: Runtime): Promise<{ ok: boolean; reason: CheckReason | null }> {
  const url = voiceUrl(runtime, "/control/conversation-key/check");
  let response: Response;
  try {
    response = await fetch(url, { method: "POST", headers: {
      Authorization: `Bearer ${runtime.voiceBridgeKey.toString("base64")}`,
      "Content-Type": "application/json",
    }, body: "{}", signal: AbortSignal.timeout(30_000), redirect: "error" });
  } catch { throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Sprachdienst nicht erreichbar." }); }
  if (!response.ok) throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Sprachdienst kann den Schlüssel nicht prüfen." });
  const data: unknown = await response.json().catch(() => null);
  const record = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : null;
  if (!record || typeof record.ok !== "boolean" ||
      !(record.ok ? record.reason === null : CHECK_REASONS.includes(record.reason as CheckReason)))
    throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Sprachdienst hat kein gültiges Prüfergebnis geliefert." });
  return { ok: record.ok, reason: record.ok ? null : record.reason as CheckReason };
}

export async function adoptBrainConversationKey(runtime: Runtime): Promise<{ keyConfigured: boolean }> {
  const brain = await runtime.hermesConfig.brainQwenKey();
  const { settings } = await readRuntimeVoiceSettings(runtime);
  // The voice service checks the key against its saved region; a mismatch would look like a rejected key.
  if (settings.conversationRegion !== brain.region)
    throw validationFailed(`Das Denkmodell nutzt die Region ${REGION_LABEL[brain.region]}. Zuerst unter Gespräch die Qwen-Region darauf stellen und speichern.`);
  return setConversationKey(runtime, brain.key);
}
