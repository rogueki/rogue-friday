import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ApiError, conflict, notFound, validationFailed } from "../util/errors";
import { invokeCodingRunner, type RunnerInvoker } from "./coding-runs";

export interface PowerPointRequest { title: string; slides: Array<{ title: string; bullets: string[] }> }
export interface RecentPowerPointDeck { id: string; title: string; slideCount: number; createdAt: string; downloadUrl: string }
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FILES = 50;
const MAX_BYTES = 100_000_000;
// Retry keys remain reserved for 30 days. An uncertain 90-second voice confirmation
// cannot launch a second renderer during that horizon, even after an API restart.
const VOICE_JOURNAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_VOICE_JOURNALS = 256;
const VOICE_JOURNAL = /^voice-[a-f0-9]{64}\.json$/;
const unavailable = () => new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Hermes PowerPoint ist in Friday-Ubuntu nicht bereit." });

export class PowerPointService {
  private readonly artifacts: string;
  constructor(private readonly dataDir: string, private readonly invoke: RunnerInvoker = invokeCodingRunner) {
    this.artifacts = join(dataDir, "private", "powerpoint");
  }

  private target() {
    let root = resolve(this.dataDir);
    for (let depth = 0; depth < 5 && !existsSync(join(root, "config", "install-state.json")); depth += 1) root = resolve(root, "..");
    let state: { distro_name?: string; linux_user?: string };
    try { state = JSON.parse(readFileSync(join(root, "config", "install-state.json"), "utf8").replace(/^\uFEFF/, "")) as typeof state; }
    catch { throw unavailable(); }
    if (!state.distro_name || !state.linux_user || !/^[a-zA-Z0-9_.-]+$/.test(state.distro_name) || !/^[a-zA-Z0-9_-]+$/.test(state.linux_user)) throw unavailable();
    const drive = root.match(/^([a-zA-Z]):\\(.*)$/);
    if (!drive) throw unavailable();
    return { distro: state.distro_name, user: state.linux_user,
      script: `/mnt/${drive[1]?.toLowerCase()}/${drive[2]?.replaceAll("\\", "/")}/installer/wsl/powerpoint_runner.py` };
  }

  /** Only generated regular PPTX files in this dedicated directory are eligible for pruning. */
  private makeRoom(incomingBytes: number): void {
    const now = Date.now();
    const files = readdirSync(this.artifacts, { withFileTypes: true })
      .filter((entry) => entry.isFile() && ID.test(entry.name.slice(0, -5)) && entry.name.endsWith(".pptx"))
      .map((entry) => {
        const path = join(this.artifacts, entry.name);
        const stat = lstatSync(path);
        return { path, size: stat.size, mtime: stat.mtimeMs };
      }).sort((a, b) => a.mtime - b.mtime);
    let bytes = files.reduce((total, file) => total + file.size, 0);
    let count = files.length;
    for (const file of files) {
      if (now - file.mtime <= RETENTION_MS && count < MAX_FILES && bytes + incomingBytes <= MAX_BYTES) break;
      unlinkSync(file.path);
      const metadata = file.path.slice(0, -5) + ".json";
      if (existsSync(metadata)) unlinkSync(metadata);
      bytes -= file.size;
      count -= 1;
    }
  }

  private paths(id: string) { return { deck: join(this.artifacts, `${id}.pptx`), meta: join(this.artifacts, `${id}.json`) }; }

  private reserveVoiceJournalSpace(): void {
    const now = Date.now();
    let retained = 0;
    for (const entry of readdirSync(this.artifacts, { withFileTypes: true })) {
      if (!entry.isFile() || !VOICE_JOURNAL.test(entry.name)) continue;
      const path = join(this.artifacts, entry.name);
      const stat = lstatSync(path);
      if (!stat.isFile()) continue;
      if (now - stat.mtimeMs > VOICE_JOURNAL_RETENTION_MS) unlinkSync(path);
      else retained += 1;
    }
    if (retained >= MAX_VOICE_JOURNALS) throw new ApiError({ code: "ADAPTER_UNAVAILABLE",
      message: "Das lokale PowerPoint-Sprachjournal ist voll. Neue Sprachaufträge sind vorübergehend gesperrt." });
  }

  private metadata(id: string): RecentPowerPointDeck | null {
    if (!ID.test(id)) return null;
    try {
      const { deck, meta } = this.paths(id);
      const deckStat = lstatSync(deck);
      const metaStat = lstatSync(meta);
      if (!deckStat.isFile() || !metaStat.isFile() || Date.now() - deckStat.mtimeMs > RETENTION_MS || deckStat.size > 4_000_000) return null;
      const stored = JSON.parse(readFileSync(meta, "utf8")) as RecentPowerPointDeck;
      if (stored.id !== id || typeof stored.title !== "string" || !stored.title || stored.title.length > 120 ||
        !Number.isInteger(stored.slideCount) || stored.slideCount < 2 || stored.slideCount > 13 ||
        typeof stored.createdAt !== "string" || !Number.isFinite(Date.parse(stored.createdAt))) return null;
      return { id, title: stored.title, slideCount: stored.slideCount, createdAt: stored.createdAt,
        downloadUrl: `/api/v1/skills/powerpoint/decks/${id}/download` };
    } catch { return null; }
  }

  recent(): RecentPowerPointDeck[] {
    if (!existsSync(this.artifacts)) return [];
    return readdirSync(this.artifacts, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".pptx") && ID.test(entry.name.slice(0, -5)))
      .map((entry) => this.metadata(entry.name.slice(0, -5)))
      .filter((entry): entry is RecentPowerPointDeck => entry !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 20);
  }

  async create(input: PowerPointRequest): Promise<RecentPowerPointDeck> {
    return this.createWithId(input, randomUUID());
  }

  async createVoice(input: PowerPointRequest, key: string): Promise<RecentPowerPointDeck & { replayed: boolean }> {
    if (!key || key.length < 8 || key.length > 128) throw validationFailed("Ein gültiger Idempotency-Key ist erforderlich.");
    mkdirSync(this.artifacts, { recursive: true, mode: 0o700 });
    const hash = createHash("sha256").update(key).digest("hex");
    const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const journalPath = join(this.artifacts, `voice-${hash}.json`);
    let journal: { id: string; fingerprint: string };
    try {
      journal = JSON.parse(readFileSync(journalPath, "utf8")) as typeof journal;
      if (journal.fingerprint !== fingerprint || !ID.test(journal.id)) throw conflict("Der Sprachauftragsschlüssel gehört zu einer anderen Präsentation.");
      const completed = this.metadata(journal.id);
      if (completed) return { ...completed, replayed: true };
      throw conflict("Der Ausgang dieses Sprachauftrags ist unklar. Prüfe die zuletzt erstellten Präsentationen.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    this.reserveVoiceJournalSpace();
    journal = { id: randomUUID(), fingerprint };
    try { writeFileSync(journalPath, JSON.stringify(journal), { flag: "wx", mode: 0o600 }); }
    catch { throw conflict("Dieser Sprachauftrag wird bereits verarbeitet. Bitte kurz warten und denselben Auftrag erneut bestätigen."); }
    return { ...await this.createWithId(input, journal.id), replayed: false };
  }

  private async createWithId(input: PowerPointRequest, id: string): Promise<RecentPowerPointDeck> {
    if (!input || typeof input.title !== "string" || !input.title.trim() || input.title.length > 120 ||
      !Array.isArray(input.slides) || input.slides.length < 1 || input.slides.length > 12 ||
      input.slides.some((slide) => !slide || typeof slide.title !== "string" || !slide.title.trim() || slide.title.length > 120 ||
        !Array.isArray(slide.bullets) || slide.bullets.length > 8 || slide.bullets.some((line) => typeof line !== "string" || !line.trim() || line.length > 240))) {
      throw validationFailed("Titel und 1 bis 12 Folien mit jeweils höchstens 8 kurzen Stichpunkten eingeben.");
    }
    const target = this.target();
    let result: Record<string, unknown>;
    try {
      result = await this.invoke(target.script, target.distro, target.user, [], JSON.stringify({ slide_size: "16:9", slides: [
        { layout: "title", title: input.title.trim() },
        ...input.slides.map((slide) => ({ layout: "title_content", title: slide.title.trim(), bullets: slide.bullets.map((line) => line.trim()) })),
      ] }), 30_000, 5_500_000);
    } catch { throw unavailable(); }
    if (typeof result.pptx !== "string" || result.pptx.length > 5_400_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(result.pptx)) throw unavailable();
    const deck = Buffer.from(result.pptx, "base64");
    if (deck.length < 100 || deck.length > 4_000_000 || deck.subarray(0, 2).toString() !== "PK") throw unavailable();
    mkdirSync(this.artifacts, { recursive: true, mode: 0o700 });
    this.makeRoom(deck.length);
    const meta = { id, title: input.title.trim(), slideCount: input.slides.length + 1,
      createdAt: new Date().toISOString(), downloadUrl: `/api/v1/skills/powerpoint/decks/${id}/download` };
    const paths = this.paths(id);
    writeFileSync(paths.meta, JSON.stringify(meta), { flag: "wx", mode: 0o600 });
    writeFileSync(paths.deck, deck, { flag: "wx", mode: 0o600 });
    return meta;
  }

  download(id: string): Buffer {
    if (!ID.test(id)) throw notFound("Präsentation");
    try {
      const path = join(this.artifacts, `${id}.pptx`);
      const stat = lstatSync(path);
      if (!stat.isFile()) throw notFound("Präsentation");
      if (Date.now() - stat.mtimeMs > RETENTION_MS) {
        unlinkSync(path);
        throw notFound("Präsentation");
      }
      return readFileSync(path);
    }
    catch { throw notFound("Präsentation"); }
  }
}
