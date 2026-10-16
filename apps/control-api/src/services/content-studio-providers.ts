import type { ElevenSpeechRequest, KieTask, KieTaskRequest } from "@friday/sdk";
import { kvGet, kvSet, type Db } from "../db/database";
import { ApiError, conflict, notFound, validationFailed } from "../util/errors";
import type { ContentStudioKeysService } from "./content-studio-keys";

const KIE_ORIGIN = "https://api.kie.ai";
const ELEVEN_ORIGIN = "https://api.elevenlabs.io";
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const idPattern = /^[A-Za-z0-9_-]{1,128}$/;

interface KieReply { code?: unknown; data?: { taskId?: unknown; model?: unknown; state?: unknown; resultJson?: unknown; creditsConsumed?: unknown } }

/** Fixed-host provider transport. No browser key access, arbitrary URLs, model strings or automatic retries. */
export class ContentStudioProviderService {
  constructor(private readonly db: Db, private readonly keys: ContentStudioKeysService, private readonly fetcher: typeof fetch = fetch) {}

  private key(provider: "kie" | "elevenlabs"): string {
    const value = this.keys.get(provider);
    if (!value) throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: `${provider} ist nicht konfiguriert.` });
    return value;
  }

  private async request(url: string, options: RequestInit): Promise<Response> {
    try { return await this.fetcher(url, { ...options, signal: AbortSignal.timeout(30_000) }); }
    catch { throw new ApiError({ code: "ADAPTER_TIMEOUT", message: "Der Medienanbieter hat nicht rechtzeitig geantwortet. Der Auftragsausgang ist unbekannt; nicht automatisch wiederholen." }); }
  }

  private checkStatus(response: Response, provider: string): void {
    if (response.status === 429) throw new ApiError({ code: "RATE_LIMITED", message: `${provider} begrenzt derzeit Anfragen.` });
    if (!response.ok) throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: `${provider} hat den Auftrag nicht bestätigt (${response.status}).` });
  }

  private async kieJson(response: Response): Promise<KieReply> {
    let parsed: unknown;
    try { parsed = await response.json(); }
    catch { throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "kie.ai hat keine gültige JSON-Antwort geliefert." }); }
    if (!parsed || typeof parsed !== "object") throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "kie.ai hat keine gültige Antwort geliefert." });
    const reply = parsed as KieReply;
    if (reply.code !== 200) throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "kie.ai hat den Auftrag nicht bestätigt." });
    return reply;
  }

  async createKie(request: KieTaskRequest, idempotencyKey: string): Promise<KieTask> {
    if (request.confirmed !== true) throw validationFailed("Bezahlte Medienerzeugung muss ausdrücklich bestätigt werden.");
    if (!idempotencyKey) throw validationFailed("Ein Idempotency-Key ist für bezahlte Medienaufträge erforderlich.");
    const key = this.key("kie");
    const marker = `content-studio.kie.request.${idempotencyKey}`;
    if (kvGet(this.db, marker)) throw conflict("Dieser Medienauftrag wurde bereits übermittelt oder sein Ausgang ist unbekannt. Status prüfen, nicht erneut senden.");
    const model = request.kind === "image" ? "grok-imagine/text-to-image" : "kling-2.6/text-to-video";
    const input = request.kind === "image"
      ? { prompt: request.prompt, aspect_ratio: request.aspectRatio }
      : { prompt: request.prompt, aspect_ratio: request.aspectRatio, duration: "5", sound: false };
    // Mark before the external side effect. A timeout must never invite an automatic second paid request.
    kvSet(this.db, marker, JSON.stringify({ state: "unknown", kind: request.kind }));
    const response = await this.request(`${KIE_ORIGIN}/api/v1/jobs/createTask`, {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, input }),
    });
    this.checkStatus(response, "kie.ai");
    const reply = await this.kieJson(response);
    const taskId = reply.data?.taskId;
    if (typeof taskId !== "string" || !idPattern.test(taskId)) throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "kie.ai hat keine gültige Auftrags-ID geliefert. Der Auftragsausgang ist unbekannt." });
    kvSet(this.db, marker, JSON.stringify({ state: "accepted", kind: request.kind, taskId }));
    kvSet(this.db, `content-studio.kie.task.${taskId}`, request.kind);
    return { taskId, kind: request.kind, state: "waiting", resultUrls: [], creditsConsumed: null };
  }

  async getKie(taskId: string): Promise<KieTask> {
    if (!idPattern.test(taskId)) throw notFound("Medienauftrag");
    const kind = kvGet(this.db, `content-studio.kie.task.${taskId}`);
    if (kind !== "image" && kind !== "video") throw notFound("Medienauftrag", taskId);
    const response = await this.request(`${KIE_ORIGIN}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
      method: "GET", headers: { Authorization: `Bearer ${this.key("kie")}` },
    });
    this.checkStatus(response, "kie.ai");
    const reply = await this.kieJson(response);
    const data = reply.data;
    const states = ["waiting", "queuing", "generating", "success", "fail"] as const;
    const state = data?.state;
    if (!states.some((candidate) => candidate === state)) throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "kie.ai hat einen unbekannten Auftragsstatus geliefert." });
    let resultUrls: string[] = [];
    if (state === "success" && typeof data?.resultJson === "string") {
      try {
        const result = JSON.parse(data.resultJson) as { resultUrls?: unknown };
        if (Array.isArray(result.resultUrls)) resultUrls = result.resultUrls.filter((url): url is string => typeof url === "string" && /^https:\/\//.test(url)).slice(0, 20);
      } catch { /* Provider completed without a parseable result; report success with no URLs. */ }
    }
    const credits = data?.creditsConsumed;
    return { taskId, kind, state: state as KieTask["state"], resultUrls, creditsConsumed: typeof credits === "number" && Number.isInteger(credits) && credits >= 0 ? credits : null };
  }

  async createSpeech(request: ElevenSpeechRequest, idempotencyKey: string): Promise<Uint8Array> {
    if (request.confirmed !== true) throw validationFailed("Bezahlte Sprachausgabe muss ausdrücklich bestätigt werden.");
    if (!idempotencyKey) throw validationFailed("Ein Idempotency-Key ist für bezahlte Sprachausgabe erforderlich.");
    const key = this.key("elevenlabs");
    const marker = `content-studio.eleven.request.${idempotencyKey}`;
    if (kvGet(this.db, marker)) throw conflict("Diese Sprachausgabe wurde bereits angefordert oder ihr Ausgang ist unbekannt. Nicht automatisch wiederholen.");
    kvSet(this.db, marker, "unknown");
    const response = await this.request(`${ELEVEN_ORIGIN}/v1/text-to-speech/${encodeURIComponent(request.voiceId)}?output_format=mp3_44100_128`, {
      method: "POST", headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text: request.text, model_id: "eleven_multilingual_v2" }),
    });
    this.checkStatus(response, "ElevenLabs");
    if (Number(response.headers.get("content-length")) > MAX_AUDIO_BYTES) throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Die Audiodatei überschreitet das Größenlimit." });
    if (!response.headers.get("content-type")?.toLowerCase().includes("audio/")) throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "ElevenLabs hat keine Audiodatei geliefert." });
    const audio = new Uint8Array(await response.arrayBuffer());
    if (audio.length === 0 || audio.length > MAX_AUDIO_BYTES) throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Die Audiodatei ist leer oder zu groß." });
    kvSet(this.db, marker, "completed");
    return audio;
  }
}
