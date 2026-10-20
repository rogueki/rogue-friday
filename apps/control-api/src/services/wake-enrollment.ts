import type { Runtime } from "../runtime/types";
import { ApiError, validationFailed } from "../util/errors";
import { readRuntimeVoiceSettings } from "./voice-settings";

export type WakeEnrollmentStatus = {
  state: "idle" | "capturing" | "training" | "ready" | "failed" | "cancelled";
  jobId: string | null;
  phrase: string | null;
  shortPhrase: string | null;
  required: Record<"wake" | "short" | "negatives" | "speech", number>;
  counts: Record<"wake" | "short" | "negatives" | "speech", number>;
  quality: string | null;
  error: string | null;
};

function endpoint(runtime: Runtime, path: string): URL {
  const adapter = runtime.config.adapters.voice;
  const configured = adapter.config.baseUrl;
  if (adapter.provider !== "friday-voice-http" || typeof configured !== "string")
    throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Lokaler Sprachdienst fehlt." });
  try {
    const url = new URL(configured);
    if (url.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(url.hostname) || !url.port || url.username || url.password)
      throw new Error("not local");
    url.pathname = path; url.search = ""; url.hash = "";
    return url;
  } catch { throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Ungültige Sprachdienst-Adresse." }); }
}

export async function wakeEnrollmentRequest(runtime: Runtime, path: string, body?: object): Promise<WakeEnrollmentStatus> {
  const url = endpoint(runtime, `/control/wake-enrollment${path}`);
  let response: Response;
  try {
    response = await fetch(url, { method: body === undefined ? "GET" : "POST", headers: {
      Authorization: `Bearer ${runtime.voiceBridgeKey.toString("base64")}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(8_000), redirect: "error" });
  } catch { throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Sprachdienst nicht erreichbar." }); }
  if (response.status === 409) throw new ApiError({ code: "CONFLICT", message: "Sprachkonfiguration wurde inzwischen geändert. Bitte neu laden." });
  if (response.status === 423) throw new ApiError({ code: "CONFLICT", message: "Friday ist beschäftigt. Bitte später erneut versuchen." });
  if (response.status === 422) throw validationFailed("Aufnahme oder Trainingszustand ist ungültig. Bitte Status prüfen.");
  if (!response.ok) throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Sprachdienst konnte die Aufnahme nicht übernehmen." });
  const result: unknown = await response.json().catch(() => null);
  if (!result || typeof result !== "object" || Array.isArray(result) ||
      typeof (result as WakeEnrollmentStatus).state !== "string" ||
      !["idle", "capturing", "training", "ready", "failed", "cancelled"].includes((result as WakeEnrollmentStatus).state))
    throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Sprachdienst meldet keinen gültigen Trainingszustand." });
  return result as WakeEnrollmentStatus;
}

export async function startWakeEnrollment(runtime: Runtime, phrase: string): Promise<WakeEnrollmentStatus> {
  const revision = await readRuntimeVoiceSettings(runtime);
  return wakeEnrollmentRequest(runtime, "/start", { phrase, expectedConfigRevision: revision.configRevision,
    expectedServiceStartedAt: revision.serviceStartedAt });
}
