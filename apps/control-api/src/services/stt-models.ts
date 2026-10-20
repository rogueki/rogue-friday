import type { Runtime } from "../runtime/types";
import { ApiError, validationFailed } from "../util/errors";
import { readRuntimeVoiceSettings } from "./voice-settings";

export type SttModelsStatus = {
  localMode: boolean;
  models: Array<{ id: string; cached: boolean; downloadable: boolean }>;
  job: { id: string; model: string; state: "downloading" | "cancelling" | "ready" | "failed" | "cancelled"; error: string | null } | null;
};

export async function sttModelsRequest(runtime: Runtime, action: "status" | "download" | "cancel",
  body?: object): Promise<SttModelsStatus> {
  const adapter = runtime.config.adapters.voice;
  if (adapter.provider !== "friday-voice-http" || typeof adapter.config.baseUrl !== "string")
    throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Lokaler Sprachdienst fehlt." });
  let url: URL;
  try {
    url = new URL(adapter.config.baseUrl);
    if (url.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(url.hostname) || !url.port || url.username || url.password)
      throw new Error("not local");
  } catch { throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Ungültige Sprachdienst-Adresse." }); }
  url.pathname = `/control/stt-models${action === "status" ? "" : `/${action}`}`;
  url.search = ""; url.hash = "";
  let response: Response;
  try {
    response = await fetch(url, { method: action === "status" ? "GET" : "POST", headers: {
      Authorization: `Bearer ${runtime.voiceBridgeKey.toString("base64")}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(action === "cancel" ? 15_000 : 8_000), redirect: "error" });
  } catch { throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Sprachdienst nicht erreichbar." }); }
  if (response.status === 422) throw validationFailed("STT-Modell oder Downloadauftrag ist ungültig.");
  if (response.status === 423) throw new ApiError({ code: "CONFLICT", message: "Ein Modelldownload läuft bereits." });
  if (!response.ok) throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "STT-Modellbestand nicht erreichbar." });
  const data: unknown = await response.json().catch(() => null);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Ungültiger STT-Modellstatus." });
  const state = data as SttModelsStatus;
  if (typeof state.localMode !== "boolean" || !Array.isArray(state.models) ||
      state.models.length > 32 || !state.models.every((model) => model && typeof model.id === "string" && /^[a-z0-9][a-z0-9.-]{0,63}$/.test(model.id) && typeof model.cached === "boolean" && typeof model.downloadable === "boolean") ||
      !(state.job === null || state.job && /^[0-9a-f]{32}$/.test(state.job.id) &&
        typeof state.job.model === "string" && /^[a-z0-9][a-z0-9.-]{0,63}$/.test(state.job.model) &&
        ["downloading", "cancelling", "ready", "failed", "cancelled"].includes(state.job.state) &&
        (state.job.error === null || typeof state.job.error === "string")))
    throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Ungültiger STT-Modellstatus." });
  return state;
}

export async function startSttModelDownload(runtime: Runtime, model: string): Promise<SttModelsStatus> {
  if (!/^[a-z0-9][a-z0-9.-]{0,63}$/.test(model)) throw validationFailed("Unbekanntes Whisper-Modell.");
  const inventory = await sttModelsRequest(runtime, "status");
  if (!inventory.models.some((entry) => entry.id === model && entry.downloadable))
    throw validationFailed("Dieses Whisper-Modell kann nicht heruntergeladen werden.");
  const revision = await readRuntimeVoiceSettings(runtime);
  return sttModelsRequest(runtime, "download", { model, expectedServiceStartedAt: revision.serviceStartedAt });
}
