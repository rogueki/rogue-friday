import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, chmodSync, statSync, copyFileSync, renameSync } from "node:fs";
import { join } from "node:path";

const REQUIRED = { wake: 12, short: 8, negatives: 8, speech: 8 } as const;
type Kind = keyof typeof REQUIRED;
type EnrollmentState = "pending" | "training" | "activating" | "complete" | "failed";
let state: EnrollmentState = "pending";
let error: string | null = null;
let busy = false;
const RETENTION_MS = 7 * 24 * 60 * 60_000;

function paths() {
  if (process.platform !== "linux" || !process.env.FRIDAY_STATE_ROOT || !process.env.FRIDAY_INSTALL_ROOT || !process.env.FRIDAY_CONFIG_DIR) return null;
  const stateRoot = process.env.FRIDAY_STATE_ROOT;
  const config = JSON.parse(readFileSync(join(process.env.FRIDAY_CONFIG_DIR, "voice.json"), "utf8")) as { voice_mode?: string; wake_phrase?: string };
  if (config.voice_mode !== "elevenlabs" || !config.wake_phrase) return null;
  const phrase = config.wake_phrase.trim();
  const words = phrase.split(/\s+/);
  const slug = (text: string) => text.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const short = words.length > 1 && /^(hey|hi|hallo|ok|okay|hej)$/i.test(words[0]!) ? words.slice(1).join(" ") : null;
  return { stateRoot, installRoot: process.env.FRIDAY_INSTALL_ROOT, configDir: process.env.FRIDAY_CONFIG_DIR, phrase, short,
    blocks: { wake: `wake_${slug(phrase)}`, short: short ? `wake_${slug(short)}` : null, negatives: "negatives", speech: "speech" },
    raw: join(stateRoot, "voice/profiles/owner/raw"),
    profile: join(stateRoot, "voice/profiles/owner/embeddings/owner_ecapa.npy"),
    model: join(stateRoot, "models/openwakeword/personal_wake.npz"),
    meta: join(stateRoot, "models/openwakeword/personal_wake.json"),
    marker: join(stateRoot, "voice/enrollment/activate"),
    active: join(stateRoot, "voice/enrollment/active"),
    journal: join(stateRoot, "voice/enrollment/training.json"),
  };
}

function count(dir: string): number {
  try { return readdirSync(dir).filter((name) => /^sample-\d{2}\.wav$/.test(name)).length; } catch { return 0; }
}

function pruneOldSamples(): void {
  try {
    const p = paths();
    if (!p || busy) return;
    for (const block of Object.values(p.blocks)) {
      if (!block) continue;
      const dir = join(p.raw, block);
      for (const name of readdirSync(dir)) {
        if (!/^sample-\d{2}\.wav$/.test(name)) continue;
        const file = join(dir, name);
        if (Date.now() - statSync(file).mtimeMs > RETENTION_MS) rmSync(file, { force: true });
      }
    }
  } catch { /* No Linux enrollment directory yet. */ }
}
setInterval(pruneOldSamples, 60 * 60_000).unref();

type EnrollmentPaths = NonNullable<ReturnType<typeof paths>>;

/** Puts the files saved before training back and removes anything a training created where nothing existed. */
function restorePrevious(p: EnrollmentPaths, kept: string[]): void {
  for (const file of [p.profile, p.model, p.meta, p.active]) {
    if (kept.includes(file) && existsSync(`${file}.prev`)) renameSync(`${file}.prev`, file);
    else if (!kept.includes(file)) rmSync(file, { force: true });
  }
  rmSync(p.journal, { force: true });
}

/**
 * A training interrupted by a restart leaves its journal behind: the previous profile is restored instead of keeping
 * a half-written, deactivated one (DASH-12.05). The recorded samples stay, so the owner can start training again.
 */
function recoverInterruptedTraining(p: EnrollmentPaths): void {
  if (busy || !existsSync(p.journal)) return;
  const known = [p.profile, p.model, p.meta, p.active];
  let kept: string[];
  try {
    const saved = (JSON.parse(readFileSync(p.journal, "utf8")) as { kept?: unknown }).kept;
    kept = Array.isArray(saved) ? saved.filter((file): file is string => typeof file === "string" && known.includes(file)) : [];
  } catch { kept = known.filter((file) => existsSync(`${file}.prev`)); }
  restorePrevious(p, kept);
  state = "failed";
  error = kept.length > 0
    ? "Training wurde unterbrochen; das bisherige Profil bleibt aktiv. Training bitte erneut starten."
    : "Training wurde unterbrochen. Training bitte erneut starten.";
}

export function enrollmentStatus() {
  let p: ReturnType<typeof paths>;
  try { p = paths(); } catch { p = null; }
  if (!p) return { available: false, state: "pending", phrase: "", shortPhrase: null, required: REQUIRED, counts: { wake: 0, short: 0, negatives: 0, speech: 0 }, error: null };
  recoverInterruptedTraining(p);
  const counts = Object.fromEntries((Object.keys(REQUIRED) as Kind[]).map((kind) => [kind, p.blocks[kind] ? count(join(p.raw, p.blocks[kind])) : 0])) as Record<Kind, number>;
  let trained = existsSync(p.profile) && existsSync(p.model) && existsSync(p.meta);
  if (trained) {
    try { trained = (JSON.parse(readFileSync(p.meta, "utf8")) as { wake_phrase?: string }).wake_phrase === p.phrase; }
    catch { trained = false; }
  }
  if (trained) for (const kind of Object.keys(REQUIRED) as Kind[]) counts[kind] = p.blocks[kind] ? REQUIRED[kind] : 0;
  const phase = trained ? existsSync(p.active) ? "complete" : "activating" : state;
  return { available: true, state: phase, phrase: p.phrase, shortPhrase: p.short,
    required: { ...REQUIRED, short: p.short ? REQUIRED.short : 0 }, counts, error };
}

export function addEnrollmentSample(kind: Kind, pcmBase64: string) {
  const p = paths();
  if (!p || !p.blocks[kind] || busy || ["complete", "activating"].includes(enrollmentStatus().state)) throw new Error("Enrollment ist nicht verfuegbar.");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(pcmBase64) || pcmBase64.length > 256_000) throw new Error("Ungueltige Audiodaten.");
  const pcm = Buffer.from(pcmBase64, "base64");
  if (pcm.length < 16_000 || pcm.length > 192_000 || pcm.length % 2 || pcmBase64 !== pcm.toString("base64")) throw new Error("Aufnahme muss 0,5 bis 6 Sekunden PCM16 bei 16 kHz enthalten.");
  pruneOldSamples();
  const block = p.blocks[kind]!;
  const dir = join(p.raw, block);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const existing = new Set(readdirSync(dir));
  const index = Array.from({ length: REQUIRED[kind] }, (_, i) => i + 1).find((i) => !existing.has(`sample-${String(i).padStart(2, "0")}.wav`));
  if (!index) throw new Error("Alle Proben dieser Kategorie sind bereits aufgenommen.");
  const wave = Buffer.alloc(44 + pcm.length);
  wave.write("RIFF", 0); wave.writeUInt32LE(wave.length - 8, 4); wave.write("WAVEfmt ", 8);
  wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(16_000, 24); wave.writeUInt32LE(32_000, 28); wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34);
  wave.write("data", 36); wave.writeUInt32LE(pcm.length, 40); pcm.copy(wave, 44);
  writeFileSync(join(dir, `sample-${String(index).padStart(2, "0")}.wav`), wave, { flag: "wx", mode: 0o600 });
  return enrollmentStatus();
}

async function run(python: string, script: string, root: string, config: string, stateRoot: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(python, [script], { cwd: root, env: { ...process.env, HOME: stateRoot, HF_HOME: join(stateRoot, "cache/huggingface"), FRIDAY_STATE_ROOT: stateRoot, FRIDAY_CONFIG_DIR: config }, stdio: "ignore" });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Training hat das Zeitlimit erreicht.")); }, 15 * 60_000);
    child.once("error", (reason) => { clearTimeout(timer); reject(reason); });
    child.once("exit", (code) => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error("Training fehlgeschlagen; pruefe die Aufnahmequalitaet.")); });
  });
}

export function startEnrollmentTraining() {
  const p = paths();
  if (!p || busy || enrollmentStatus().state === "complete") throw new Error("Enrollment ist nicht verfuegbar.");
  if (enrollmentStatus().state === "activating") {
    for (const file of [p.profile, p.model, p.meta]) chmodSync(file, 0o600);
    writeFileSync(p.marker, "ready\n", { flag: "w", mode: 0o600 });
    return enrollmentStatus();
  }
  const status = enrollmentStatus();
  for (const kind of Object.keys(REQUIRED) as Kind[]) if (status.counts[kind] < status.required[kind]) throw new Error(`Es fehlen Proben: ${kind}.`);
  busy = true; state = "training"; error = null;
  // Keep the last working profile until the new one is complete; a failed retrain restores it (DASH-12.05).
  const kept = [p.profile, p.model, p.meta, p.active].filter((file) => existsSync(file));
  for (const file of kept) copyFileSync(file, `${file}.prev`);
  // The journal is written after the copies, so a restart never restores from an incomplete backup.
  mkdirSync(join(p.stateRoot, "voice/enrollment"), { recursive: true, mode: 0o700 });
  writeFileSync(`${p.journal}.tmp`, JSON.stringify({ kept }), { mode: 0o600 });
  renameSync(`${p.journal}.tmp`, p.journal);
  rmSync(p.active, { force: true });
  const python = join(p.stateRoot, "voice/.venv/bin/python");
  const source = join(p.installRoot, "installer/voice");
  void (async () => {
    try {
      await run(python, join(source, "build_speaker_profile.py"), p.installRoot, p.configDir, p.stateRoot);
      await run(python, join(source, "build_personal_wake.py"), p.installRoot, p.configDir, p.stateRoot);
      for (const file of [p.profile, p.model, p.meta]) chmodSync(file, 0o600);
      state = "activating";
      mkdirSync(join(p.stateRoot, "voice/enrollment"), { recursive: true, mode: 0o700 });
      writeFileSync(p.marker, "ready\n", { flag: "w", mode: 0o600 });
      for (const file of kept) rmSync(`${file}.prev`, { force: true });
      rmSync(p.journal, { force: true });
      for (const block of Object.values(p.blocks)) if (block) rmSync(join(p.raw, block), { recursive: true, force: true });
      state = "activating";
    } catch {
      state = "failed";
      restorePrevious(p, kept);
      error = kept.length > 0
        ? "Training fehlgeschlagen; das bisherige Profil bleibt aktiv. Bitte Proben erneut aufnehmen."
        : "Training fehlgeschlagen. Bitte Proben erneut aufnehmen.";
      for (const block of Object.values(p.blocks)) if (block) rmSync(join(p.raw, block), { recursive: true, force: true });
    } finally { busy = false; }
  })();
  return enrollmentStatus();
}
