import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { ContentProductionJob, ContentProductionRequest } from "@friday/sdk";
import type { Db } from "../db/database";
import { ApiError, conflict, notFound, validationFailed } from "../util/errors";
import type { ContentStudioKeysService } from "./content-studio-keys";
import type { ContentStudioPlanService } from "./content-studio-plan";
import type { ContentStudioProviderService } from "./content-studio-providers";
import { downloadPublicMedia, mediaLooksValid, renderContentVideo } from "./content-studio-media";

type Kind = "image" | "video";
type State = ContentProductionJob["state"];
interface Specification { kind: Kind; prompt: string; speech: string; voiceId: string | null; aspectRatio: "1:1" | "16:9" | "9:16" }
interface Row {
  id: string; request_key: string; request_hash: string; idea_id: string; specification_json: string; state: State;
  provider_task_id: string | null; result_url: string | null; error_code: string | null;
  created_at: string; updated_at: string;
}
export interface ProductionOptions {
  download?: (url: string) => Promise<Uint8Array>;
  render?: typeof renderContentVideo;
  ffmpegPath?: string;
  ffmpegAvailable?: () => boolean;
  enabled?: () => boolean;
}

/** One approved idea produces one durable MP4. Paid steps are journaled before dispatch and never replayed after uncertainty. */
export class ContentStudioProductionService {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | null = null;
  private active = false;
  private readonly root: string;
  private readonly download: (url: string) => Promise<Uint8Array>;
  private readonly render: typeof renderContentVideo;
  private readonly ffmpegPath: string;
  private readonly ffmpegAvailable: () => boolean;
  private readonly enabled: () => boolean;

  constructor(private readonly db: Db, private readonly plan: ContentStudioPlanService,
    private readonly keys: ContentStudioKeysService, private readonly providers: ContentStudioProviderService,
    dataDir: string, options: ProductionOptions = {}) {
    this.root = join(dataDir, "content-studio", "jobs");
    this.download = options.download ?? downloadPublicMedia;
    this.render = options.render ?? renderContentVideo;
    this.ffmpegPath = options.ffmpegPath || "ffmpeg";
    this.ffmpegAvailable = options.ffmpegAvailable ?? (() => spawnSync(this.ffmpegPath, ["-version"], { windowsHide: true, timeout: 5000 }).status === 0);
    this.enabled = options.enabled ?? (() => true);
  }

  create(request: ContentProductionRequest, requestKey: string): ContentProductionJob {
    if (!requestKey) throw validationFailed("Idempotency-Key ist für einen Produktionsauftrag erforderlich.");
    if (request.confirmed !== true) throw validationFailed("Der Produktionsauftrag muss einmalig freigegeben werden.");
    const requestHash = createHash("sha256").update(JSON.stringify({ ideaId: request.ideaId, planRevision: request.planRevision,
      voiceId: request.voiceId ?? null, confirmed: true })).digest("hex");
    const existing = this.db.prepare("SELECT * FROM content_studio_jobs WHERE request_key = ?").get(requestKey) as Row | undefined;
    if (existing) {
      if (existing.request_hash !== requestHash) throw conflict("Dieser Idempotency-Key gehört zu einem anderen Produktionsauftrag.");
      return this.publicJob(existing);
    }
    if (!this.keys.get("kie") || !this.keys.get("elevenlabs")) {
      throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "kie.ai und ElevenLabs müssen in den Einstellungen verbunden sein." });
    }
    if (!this.ffmpegAvailable()) throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "FFmpeg fehlt auf dem Windows-Host." });
    const plan = this.plan.get();
    if (plan.revision !== request.planRevision) throw conflict("Der Content-Plan wurde seit der Freigabe geändert. Bitte Vorschau erneut prüfen.", { currentRevision: plan.revision });
    const idea = plan.plan?.content.find((item) => item.id === request.ideaId);
    if (!idea) throw notFound("Content-Idee", request.ideaId);
    let kind: Kind;
    let aspectRatio: Specification["aspectRatio"];
    if (idea.format === "Feed-Post") { kind = "image"; aspectRatio = "1:1"; }
    else if (idea.format === "LinkedIn-Video" || idea.format === "YouTube-Video") { kind = "video"; aspectRatio = "16:9"; }
    else if (["Story", "Reel", "TikTok-Video", "YouTube-Short"].includes(idea.format)) { kind = "video"; aspectRatio = "9:16"; }
    else throw validationFailed("Dieses Format hat noch kein verifiziertes automatisches Produktionsprofil.");
    const speech = (idea.beschreibung.trim() || idea.titel).slice(0, 2500);
    const prompt = `${idea.titel}. ${idea.beschreibung}`.trim().slice(0, 2000);
    if (!speech || !prompt) throw validationFailed("Die Idee braucht einen Titel oder eine Beschreibung.");
    const specification: Specification = { kind, prompt, speech, voiceId: request.voiceId ?? null, aspectRatio };
    const id = randomUUID();
    const now = new Date().toISOString();
    mkdirSync(join(this.root, id), { recursive: true });
    this.db.prepare(`INSERT INTO content_studio_jobs
      (id, request_key, request_hash, idea_id, specification_json, state, provider_task_id, result_url, error_code, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'queued', NULL, NULL, NULL, ?, ?)`)
      .run(id, requestKey, requestHash, idea.id, JSON.stringify(specification), now, now);
    this.kick();
    return this.get(id);
  }

  get(id: string): ContentProductionJob {
    return this.publicJob(this.row(id));
  }

  cancel(id: string): ContentProductionJob {
    this.row(id);
    this.db.prepare(`UPDATE content_studio_jobs SET state = 'cancelled', updated_at = ? WHERE id = ?
      AND state NOT IN ('completed', 'cancelled')`).run(new Date().toISOString(), id);
    return this.get(id);
  }

  artifact(id: string): Buffer {
    const job = this.get(id);
    const path = this.file(id, "artifact.mp4");
    if (job.state !== "completed" || !existsSync(path) || statSync(path).size === 0) throw notFound("Produktionsartefakt", id);
    return readFileSync(path);
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.timer = setInterval(() => this.kick(), 10_000);
    this.timer.unref?.();
    this.kick();
  }

  async stop(): Promise<void> {
    this.active = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.running) await this.running;
  }

  /** Also exposed for deterministic provider fakes in tests; production drives it on a timer. */
  async processPending(): Promise<void> {
    if (!this.enabled()) return;
    const rows = this.db.prepare("SELECT id FROM content_studio_jobs WHERE state NOT IN ('completed', 'failed', 'provider_unknown', 'speech_unknown', 'cancelled') ORDER BY updated_at ASC, id ASC LIMIT 32")
      .all() as Array<{ id: string }>;
    for (const { id } of rows) {
      try { await this.processOne(id); }
      catch {
        const state = this.row(id).state;
        if (state === "provider_pending") this.transition(id, state, { errorCode: "provider_poll_unavailable" });
        else if (state === "downloading") this.transition(id, "provider_pending", { errorCode: "media_download_unavailable" });
        else if (state === "queued") this.transition(id, state, { errorCode: "voice_lookup_unavailable" });
        else if (state === "submitting") this.transition(id, "provider_unknown", { errorCode: "provider_outcome_unknown" });
        else if (state === "speech_submitting") this.transition(id, "speech_unknown", { errorCode: "speech_outcome_unknown" });
      }
    }
  }

  private kick(): void {
    if (!this.active || this.running) return;
    this.running = this.processPending().finally(() => { this.running = null; });
  }

  private row(id: string): Row {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound("Produktionsauftrag");
    const value = this.db.prepare("SELECT * FROM content_studio_jobs WHERE id = ?").get(id) as Row | undefined;
    if (!value) throw notFound("Produktionsauftrag", id);
    return value;
  }

  private publicJob(row: Row): ContentProductionJob {
    const spec = JSON.parse(row.specification_json) as Specification;
    return { id: row.id, ideaId: row.idea_id, kind: spec.kind, state: row.state,
      providerTaskId: row.provider_task_id, artifactReady: row.state === "completed", errorCode: row.error_code,
      createdAt: row.created_at, updatedAt: row.updated_at };
  }

  private file(id: string, name: string): string { return join(this.root, id, name); }

  private transition(id: string, state: State, details: { providerTaskId?: string; resultUrl?: string; errorCode?: string | null } = {}): void {
    this.db.prepare(`UPDATE content_studio_jobs SET state = ?, provider_task_id = COALESCE(?, provider_task_id),
      result_url = COALESCE(?, result_url), error_code = ?, updated_at = ? WHERE id = ? AND state != 'cancelled'`)
      .run(state, details.providerTaskId ?? null, details.resultUrl ?? null, details.errorCode ?? null, new Date().toISOString(), id);
  }

  private async save(id: string, name: string, bytes: Uint8Array): Promise<void> {
    const partial = this.file(id, `${name}.partial`);
    await writeFile(partial, bytes, { flag: "w", mode: 0o600 });
    await rename(partial, this.file(id, name));
  }

  private async processOne(id: string): Promise<void> {
    for (let stage = 0; stage < 5; stage += 1) {
      if (!this.enabled()) return;
      const row = this.row(id);
      const spec = JSON.parse(row.specification_json) as Specification;
      if (row.state === "queued") {
        if (!spec.voiceId) {
          try {
            spec.voiceId = await this.providers.chooseElevenVoice();
            this.db.prepare("UPDATE content_studio_jobs SET specification_json = ?, updated_at = ? WHERE id = ?")
              .run(JSON.stringify(spec), new Date().toISOString(), id);
          } catch { this.transition(id, "queued", { errorCode: "voice_lookup_unavailable" }); return; }
        }
        this.transition(id, "submitting");
        if (this.row(id).state === "cancelled") return;
        try {
          const task = await this.providers.createKie({ kind: spec.kind, prompt: spec.prompt, aspectRatio: spec.aspectRatio, confirmed: true }, `production-${id}`);
          this.transition(id, "provider_pending", { providerTaskId: task.taskId });
        } catch { this.transition(id, "provider_unknown", { errorCode: "provider_outcome_unknown" }); return; }
      } else if (row.state === "submitting") {
        const submission = this.providers.kieSubmission(`production-${id}`);
        if (submission?.state === "accepted" && submission.taskId) {
          this.providers.registerKieTask(submission.taskId, spec.kind);
          this.transition(id, "provider_pending", { providerTaskId: submission.taskId });
        } else { this.transition(id, "provider_unknown", { errorCode: "provider_outcome_unknown" }); return; }
      } else if (row.state === "provider_pending") {
        if (!row.provider_task_id) { this.transition(id, "provider_unknown", { errorCode: "missing_provider_task" }); return; }
        const task = await this.providers.getKie(row.provider_task_id);
        if (task.state === "fail") { this.transition(id, "failed", { errorCode: "provider_failed" }); return; }
        if (task.state !== "success") { this.transition(id, "provider_pending"); return; }
        if (!task.resultUrls[0]) { this.transition(id, "failed", { errorCode: "provider_result_missing" }); return; }
        this.transition(id, "downloading", { resultUrl: task.resultUrls[0] });
      } else if (row.state === "downloading") {
        if (!row.result_url) { this.transition(id, "failed", { errorCode: "provider_result_missing" }); return; }
        const downloadUrl = await this.providers.kieDownloadUrl(row.result_url);
        const visual = await this.download(downloadUrl);
        if (!mediaLooksValid(spec.kind, visual)) { this.transition(id, "failed", { errorCode: "invalid_provider_media" }); return; }
        await this.save(id, "visual.bin", visual);
        this.transition(id, "speech_submitting");
        if (this.row(id).state === "cancelled") return;
        try {
          if (!spec.voiceId) throw new Error("Voice selection missing");
          const audio = await this.providers.createSpeech({ text: spec.speech, voiceId: spec.voiceId, confirmed: true }, `production-${id}`);
          if (audio.length < 3 || !(Buffer.from(audio.subarray(0, 3)).toString("ascii") === "ID3" ||
            (audio[0] === 0xff && ((audio[1] ?? 0) & 0xe0) === 0xe0))) {
            this.transition(id, "speech_unknown", { errorCode: "invalid_speech_media" }); return;
          }
          await this.save(id, "voice.mp3", audio);
          this.transition(id, "editing");
        } catch { this.transition(id, "speech_unknown", { errorCode: "speech_outcome_unknown" }); return; }
      } else if (row.state === "speech_submitting") {
        if (existsSync(this.file(id, "voice.mp3"))) this.transition(id, "editing");
        else { this.transition(id, "speech_unknown", { errorCode: "speech_outcome_unknown" }); return; }
      } else if (row.state === "editing") {
        try {
          await this.render({ kind: spec.kind, aspectRatio: spec.aspectRatio, visualPath: this.file(id, "visual.bin"), voicePath: this.file(id, "voice.mp3"),
            outputPath: this.file(id, "artifact.mp4"), ffmpegPath: this.ffmpegPath });
          if (!existsSync(this.file(id, "artifact.mp4")) || statSync(this.file(id, "artifact.mp4")).size === 0) throw new Error("Empty render");
          this.transition(id, "completed");
        } catch { this.transition(id, "failed", { errorCode: "render_failed" }); }
        return;
      } else return;
    }
  }
}
