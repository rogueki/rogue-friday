import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { backup, DatabaseSync } from "node:sqlite";
import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, closeSync, fsyncSync,
  readFileSync, readdirSync, realpathSync, renameSync, rmSync, statfsSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Db } from "../db/database";
import { kvGet, kvSet } from "../db/database";
import { AuditAnchor } from "../db/audit-anchor";
import { AuditStore } from "../db/audit-store";
import { AuditArchive } from "../db/audit-archive";
import { deriveKey } from "@friday/auth";
import type { DurableMemoryService } from "./durable-memory";

interface Manifest {
  version: 1;
  createdAt: string;
  sourceInstallRoot?: string;
  sourceVaultPath?: string;
  files: Record<string, string>;
  memoryEventCount: number;
  wslIncluded: boolean;
  voiceSources: Record<string, string>;
}

interface WslTarget { distro: string; user: string; script: string }
interface WslResult { count: number; bytes: number }

const ownPrefix = "friday-system-";
const registryKey = "system_backup.created_paths";
const temporaryKey = "system_backup.temporary_paths";
interface TemporaryEntry { path: string; id: string; createdAt: string; kind: "backup" | "restore" }
const sha = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
const within = (child: string, parent: string): boolean => child.startsWith(parent + sep);

function ordinary(path: string): void {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Backup source must be an ordinary file");
}

function flushFile(path: string): void {
  const fd = openSync(path, "r+");
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function privateStaging(parent: string, prefix: string): string {
  const path = mkdtempSync(join(parent, prefix));
  try {
    if (process.platform === "win32") {
      const user = process.env.USERNAME;
      if (!user) throw new Error("Backup owner is unknown");
      const principal = process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${user}` : user;
      execFileSync("icacls", [path, "/inheritance:r", "/grant:r", `${principal}:(OI)(CI)(F)`],
        { stdio: "ignore", windowsHide: true, timeout: 10_000 });
    } else if ((statSync(path).mode & 0o077) !== 0) {
      throw new Error("Backup staging is not private");
    }
    return path;
  } catch (error) {
    rmSync(path, { recursive: true, force: true });
    throw new Error("Private backup staging could not be created", { cause: error });
  }
}

/** A complete system snapshot is immutable. Restore always creates a separate, inert directory. */
export class SystemBackupService {
  private readonly dataDir: string;
  private readonly installRoot: string;
  private readonly vaultPath: string;
  private busy = false;

  private temporary(): TemporaryEntry[] {
    try {
      const stored = JSON.parse(kvGet(this.db, temporaryKey) ?? "[]") as unknown;
      return Array.isArray(stored) ? stored.filter((item): item is TemporaryEntry =>
        item && typeof item === "object" && typeof item.path === "string" && typeof item.id === "string" &&
        typeof item.createdAt === "string" && (item.kind === "backup" || item.kind === "restore")) : [];
    } catch { return []; }
  }

  private registerTemporary(path: string, kind: TemporaryEntry["kind"]): void {
    const entry: TemporaryEntry = { path, kind, id: randomUUID(), createdAt: new Date().toISOString() };
    writeFileSync(join(path, ".friday-temporary.json"), JSON.stringify({ id: entry.id }),
      { flag: "wx", mode: 0o600, flush: true });
    kvSet(this.db, temporaryKey, JSON.stringify([...this.temporary(), entry]));
  }

  private clearTemporary(path: string): void {
    kvSet(this.db, temporaryKey, JSON.stringify(this.temporary().filter((item) => item.path !== path)));
  }

  temporaryCandidates(cutoffIso: string): string[] {
    return this.temporary().filter((entry) => {
      if (entry.createdAt >= cutoffIso || Number.isNaN(Date.parse(entry.createdAt)) || !existsSync(entry.path) ||
          lstatSync(entry.path).isSymbolicLink() || !lstatSync(entry.path).isDirectory()) return false;
      if (entry.kind === "restore") {
        if (!basename(entry.path).startsWith(".friday-system-restore-") ||
            !within(entry.path, this.dataDir)) return false;
      } else {
        if (!basename(entry.path).startsWith(`.${ownPrefix}`)) return false;
        try { this.destination(dirname(entry.path)); } catch { return false; }
      }
      try { return (JSON.parse(readFileSync(join(entry.path, ".friday-temporary.json"), "utf8")) as { id: string }).id === entry.id; }
      catch { return false; }
    }).map((entry) => entry.path);
  }

  cleanupTemporary(cutoffIso: string): number {
    const candidates = this.temporaryCandidates(cutoffIso);
    for (const path of candidates) rmSync(path, { recursive: true, force: true });
    kvSet(this.db, temporaryKey, JSON.stringify(this.temporary().filter((entry) => existsSync(entry.path))));
    return candidates.length;
  }

  constructor(dataDir: string, private readonly db: Db, private readonly memory: DurableMemoryService) {
    this.dataDir = realpathSync(resolve(dataDir));
    this.installRoot = resolve(this.dataDir, "..", "..");
    this.vaultPath = resolve(memory.vaultPath);
  }

  private windowsToWsl(path: string): string {
    const match = path.match(/^([A-Za-z]):\\(.*)$/);
    if (!match) throw new Error("WSL backup requires a Windows drive path");
    return `/mnt/${match[1]!.toLowerCase()}/${match[2]!.replaceAll("\\", "/")}`;
  }

  private wslTarget(): WslTarget | null {
    const statePath = join(this.installRoot, "config", "install-state.json");
    if (!existsSync(statePath)) return null;
    ordinary(statePath);
    const state = JSON.parse(readFileSync(statePath, "utf8").replace(/^\uFEFF/, "")) as
      { distro_name?: string; linux_user?: string };
    if (!state.distro_name || !state.linux_user || !/^[A-Za-z0-9_.-]+$/.test(state.distro_name) ||
        !/^[A-Za-z0-9_-]+$/.test(state.linux_user)) throw new Error("WSL backup target is not configured");
    const script = join(this.installRoot, "dashboard", "scripts", "wsl-system-backup.py");
    ordinary(script);
    return { distro: state.distro_name, user: state.linux_user, script: this.windowsToWsl(script) };
  }

  coverage(): "windows-and-memory" | "windows-wsl-and-memory" {
    return this.wslTarget() ? "windows-wsl-and-memory" : "windows-and-memory";
  }

  private async wsl(action: "plan" | "export", target?: string): Promise<WslResult | null> {
    const wsl = this.wslTarget();
    if (!wsl) return null;
    const command = process.platform === "win32"
      ? { file: "wsl.exe", args: ["-d", wsl.distro, "-u", wsl.user, "--exec", "python3", wsl.script] }
      : { file: "python3", args: [wsl.script] };
    const request = JSON.stringify({ action, ...(target ? { target: this.windowsToWsl(target) } : {}) });
    return new Promise((resolveResult, reject) => {
      const child = spawn(command.file, command.args, { windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] });
      let output = "";
      const timer = setTimeout(() => child.kill(), 300_000);
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => { output += chunk; if (output.length > 16_000) child.kill(); });
      child.on("error", () => { clearTimeout(timer); reject(new Error("WSL backup source is unavailable")); });
      child.on("close", (code) => {
        clearTimeout(timer);
        let result: Partial<WslResult> = {};
        try { result = JSON.parse(output) as Partial<WslResult>; } catch { /* invalid helper response */ }
        if (code !== 0 || !Number.isSafeInteger(result.count) || !Number.isSafeInteger(result.bytes) ||
            result.count! < 0 || result.bytes! < 0) reject(new Error("WSL backup snapshot failed"));
        else resolveResult(result as WslResult);
      });
      child.stdin.end(request);
    });
  }

  private destination(path: string): string {
    if (!isAbsolute(path) || !existsSync(path)) throw new Error("Backup destination must be an existing absolute directory");
    const target = realpathSync(path);
    if (!statSync(target).isDirectory() || within(target, this.dataDir) || within(this.dataDir, target) ||
        target === this.dataDir || within(target, this.vaultPath) || within(this.vaultPath, target) || target === this.vaultPath)
      throw new Error("Backup destination overlaps a live data source");
    if (lstatSync(path).isSymbolicLink()) throw new Error("Backup destination is a link");
    return target;
  }

  private sourceFiles(): Array<{ from: string; to: string }> {
    const names: Array<[string, string]> = [
      [join(this.dataDir, "auth.key"), "keys/auth.key"],
      [join(this.dataDir, "voice-bridge", "auth.key"), "keys/voice-bridge.key"],
      [join(this.dataDir, "calendar-bridge", "auth.key"), "keys/calendar-bridge.key"],
      [join(this.dataDir, "mail-bridge", "auth.key"), "keys/mail-bridge.key"],
      [join(this.dataDir, "hermes-memory-bridge", "auth.key"), "keys/hermes-memory-bridge.key"],
      [join(this.dataDir, "hermes-messenger-bridge", "auth.key"), "keys/hermes-messenger-bridge.key"],
      [join(this.installRoot, "config", "voice.json"), "config/voice.json"],
      [join(this.installRoot, "config", "persona.json"), "config/persona.json"],
      [join(this.installRoot, "config", "install-state.json"), "config/install-state.json"],
      [join(this.installRoot, "config", "hermes_api.key"), "keys/hermes_api.key"],
      [join(this.installRoot, "config", "elevenlabs_api.key.dpapi"), "keys/elevenlabs_api.key.dpapi"],
      [join(this.installRoot, "config", "dashboard_owner.hash"), "config/dashboard_owner.hash"],
      [join(this.installRoot, "dashboard", "config", "dashboard.yaml"), "config/dashboard.yaml"],
      [join(this.installRoot, "dashboard", "config", "adapters.yaml"), "config/adapters.yaml"],
    ];
    if (!existsSync(names[0]![0])) throw new Error("System backup authentication key is missing");
    const references = join(this.installRoot, "config", "voice-references");
    if (existsSync(references)) {
      if (lstatSync(references).isSymbolicLink() || !lstatSync(references).isDirectory())
        throw new Error("Voice reference directory is unsafe");
      const walk = (folder: string): void => {
        for (const item of readdirSync(folder, { withFileTypes: true })) {
          const path = join(folder, item.name);
          if (item.isSymbolicLink()) throw new Error("Voice reference contains a link");
          if (item.isDirectory()) walk(path);
          else if (item.isFile()) names.push([path, `config/voice-references/${relative(references, path).replaceAll("\\", "/")}`]);
          else throw new Error("Voice reference contains a non-file entry");
        }
      };
      walk(references);
    }
    const enrollment = join(this.installRoot, "voice", "profiles", "owner");
    if (existsSync(enrollment)) {
      if (lstatSync(enrollment).isSymbolicLink() || !lstatSync(enrollment).isDirectory())
        throw new Error("Voice enrollment directory is unsafe");
      const walk = (folder: string): void => {
        for (const item of readdirSync(folder, { withFileTypes: true })) {
          const path = join(folder, item.name);
          if (item.isSymbolicLink()) throw new Error("Voice enrollment contains a link");
          if (item.isDirectory()) walk(path);
          else if (item.isFile()) names.push([path, `voice/profiles/owner/${relative(enrollment, path).replaceAll("\\", "/")}`]);
          else throw new Error("Voice enrollment contains a non-file entry");
        }
      };
      walk(enrollment);
    }
    const archives = join(this.dataDir, "audit-archive");
    if (existsSync(archives)) {
      if (lstatSync(archives).isSymbolicLink() || !lstatSync(archives).isDirectory())
        throw new Error("Audit archive directory is unsafe");
      const registered = this.db.prepare("SELECT filename FROM audit_archive_segments").all() as Array<{ filename: string }>;
      for (const { filename } of registered) {
        if (!/^audit-[a-f0-9-]{36}\.json$/.test(filename)) throw new Error("Audit archive registry is invalid");
        names.push([join(archives, filename), `audit-archive/${filename}`]);
      }
    }
    for (const item of this.selectedVoiceFiles()) names.push([item.from, item.to]);
    return names.filter(([from]) => existsSync(from)).map(([from, to]) => { ordinary(from); return { from, to }; });
  }

  private selectedVoiceFiles(): Array<{ from: string; to: string }> {
    const selected = new Set<string>();
    for (const [name, keys] of [["voice.json", ["tts_reference", "tts_reference_text_file", "speaker_profile", "personal_wake_model", "wake_verifier"]],
      ["install-state.json", ["voice_reference", "voice_reference_classic", "voice_reference_male", "voice_reference_female"]]] as const) {
      const file = join(this.installRoot, "config", name);
      if (!existsSync(file)) continue;
      ordinary(file);
      const config = JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, "")) as Record<string, unknown>;
      for (const key of keys) {
        const value = config[key];
        if (typeof value === "string" && value.trim()) selected.add(isAbsolute(value) ? resolve(value) : resolve(this.installRoot, value));
      }
    }
    return [...selected].map((from) => {
      if (!existsSync(from)) throw new Error("Configured voice reference is missing");
      ordinary(from);
      return { from, to: `voice-selected/${sha(Buffer.from(from, "utf8")).slice(0, 20)}-${basename(from)}` };
    });
  }

  private auxiliaryDatabases(): Array<{ from: string; to: string }> {
    const names: Array<[string, string]> = [[join(this.dataDir, "voice-memory.sqlite"), "state/voice-memory.sqlite"],
      [join(this.dataDir, "memory", "outbox.sqlite"), "state/memory-outbox.sqlite"]];
    return names
      .filter(([from]) => existsSync(from)).map(([from, to]) => { ordinary(from); return { from, to }; });
  }

  async preview(targetPath: string): Promise<{ destination: string; estimatedBytes: number }> {
    const destination = this.destination(targetPath);
    const files = this.sourceFiles();
    const auxiliary = this.auxiliaryDatabases();
    const databaseSize = statSync(join(this.dataDir, "dashboard.sqlite")).size;
    const walPath = join(this.dataDir, "dashboard.sqlite-wal");
    const walSize = existsSync(walPath) ? statSync(walPath).size : 0;
    let memoryBytes = 0;
    const measure = (dir: string): void => {
      for (const item of readdirSync(dir, { withFileTypes: true })) {
        if (item.isSymbolicLink()) throw new Error("Memory Vault contains a link");
        const path = join(dir, item.name);
        if (item.isDirectory()) measure(path);
        else if (item.isFile()) memoryBytes += statSync(path).size;
      }
    };
    measure(this.vaultPath);
    const wsl = await this.wsl("plan");
    const estimatedBytes = (databaseSize + walSize) * 2 + memoryBytes + (wsl?.bytes ?? 0) * 2 +
      files.reduce((n, item) => n + statSync(item.from).size, 0) +
      auxiliary.reduce((n, item) => n + statSync(item.from).size * 2 + (existsSync(`${item.from}-wal`) ? statSync(`${item.from}-wal`).size : 0), 0) +
      16 * 1024 * 1024;
    const targetSpace = statfsSync(destination);
    const sourceSpace = statfsSync(this.dataDir);
    if (targetSpace.bavail * targetSpace.bsize < estimatedBytes * 2 ||
        sourceSpace.bavail * sourceSpace.bsize < memoryBytes * 2 + walSize + 16 * 1024 * 1024)
      throw new Error("Backup source or destination has insufficient free space");
    return { destination, estimatedBytes };
  }

  async create(targetPath: string, retentionCount: number): Promise<{ path: string; createdAt: string; fileCount: number; verified: boolean }> {
    if (this.busy) throw new Error("System backup is already running");
    if (!Number.isSafeInteger(retentionCount) || retentionCount < 1) throw new Error("Invalid backup retention count");
    this.busy = true;
    let staging: string | null = null;
    try {
      const { destination } = await this.preview(targetPath);
      const files = this.sourceFiles();
      const auxiliary = this.auxiliaryDatabases();
      staging = privateStaging(destination, `.${ownPrefix}`);
      this.registerTemporary(staging, "backup");
      const hashes: Record<string, string> = {};
      const put = (from: string, name: string): void => {
        ordinary(from);
        const dest = join(staging!, name);
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(from, dest, constants.COPYFILE_EXCL);
        flushFile(dest);
        hashes[name] = sha(readFileSync(dest));
      };
      const dbPath = join(staging, "dashboard.sqlite");
      await backup(this.db, dbPath);
      const normalizedDb = new DatabaseSync(dbPath);
      try {
        normalizedDb.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;");
      } finally { normalizedDb.close(); }
      flushFile(dbPath);
      hashes["dashboard.sqlite"] = sha(readFileSync(dbPath));
      for (const file of files) put(file.from, file.to);
      for (const item of auxiliary) {
        const dest = join(staging, item.to);
        mkdirSync(dirname(dest), { recursive: true });
        const source = new DatabaseSync(item.from, { readOnly: true });
        try { await backup(source, dest); } finally { source.close(); }
        const normalized = new DatabaseSync(dest);
        try { normalized.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;"); }
        finally { normalized.close(); }
        flushFile(dest);
        hashes[item.to] = sha(readFileSync(dest));
      }
      const wsl = await this.wsl("export", join(staging, "wsl"));
      if (wsl) {
        const walkWsl = (folder: string): void => {
          for (const item of readdirSync(folder, { withFileTypes: true })) {
            const path = join(folder, item.name);
            if (item.isSymbolicLink()) throw new Error("WSL backup contains a link");
            if (item.isDirectory()) walkWsl(path);
            else { ordinary(path); hashes[relative(staging!, path).replaceAll("\\", "/")] = sha(readFileSync(path)); }
          }
        };
        walkWsl(join(staging, "wsl"));
      }
      const backedDb = new DatabaseSync(dbPath, { readOnly: true });
      try {
        const anchor = kvGet(backedDb, "audit.head");
        if (anchor !== undefined) {
          const sidecar = join(staging, "state", "audit-head.json");
          mkdirSync(dirname(sidecar), { recursive: true });
          writeFileSync(sidecar, anchor, { flag: "wx", mode: 0o600, flush: true });
          hashes["state/audit-head.json"] = sha(readFileSync(sidecar));
        }
      } finally { backedDb.close(); }
      const memorySnapshot = this.memory.backup();
      const walk = (folder: string): void => {
        for (const item of readdirSync(folder, { withFileTypes: true })) {
          const path = join(folder, item.name);
          if (item.isSymbolicLink()) throw new Error("Memory backup contains a link");
          if (item.isDirectory()) walk(path);
          else put(path, join("memory", relative(memorySnapshot.path, path)).replaceAll("\\", "/"));
        }
      };
      walk(memorySnapshot.path);
      const createdAt = new Date().toISOString();
      const manifest: Manifest = { version: 1, createdAt, files: hashes,
        sourceInstallRoot: this.installRoot, sourceVaultPath: this.vaultPath,
        memoryEventCount: memorySnapshot.eventCount, wslIncluded: wsl !== null,
        voiceSources: Object.fromEntries(this.selectedVoiceFiles().map((item) => [item.from, item.to])) };
      writeFileSync(join(staging, "manifest.json"), JSON.stringify(manifest), { flag: "wx", mode: 0o600, flush: true });
      rmSync(join(staging, ".friday-temporary.json"));
      this.verify(staging);
      const published = join(destination, `${ownPrefix}${createdAt.replaceAll(/[:.]/g, "-")}-${randomUUID()}`);
      renameSync(staging, published);
      this.clearTemporary(staging);
      staging = null;
      const registered = this.registered();
      registered.push(published);
      kvSet(this.db, registryKey, JSON.stringify(registered));
      this.prune(destination, retentionCount);
      return { path: published, createdAt, fileCount: Object.keys(hashes).length, verified: true };
    } finally {
      if (staging) this.clearTemporary(staging);
      if (staging) rmSync(staging, { recursive: true, force: true });
      this.busy = false;
    }
  }

  verify(path: string): { fileCount: number; memoryEventCount: number; createdAt: string } {
    const root = realpathSync(path);
    ordinary(join(root, "manifest.json"));
    const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")) as Manifest;
    if (manifest.version !== 1 || !manifest.files || typeof manifest.files !== "object" ||
        (manifest.sourceInstallRoot !== undefined && !isAbsolute(manifest.sourceInstallRoot)) ||
        (manifest.sourceVaultPath !== undefined && !isAbsolute(manifest.sourceVaultPath)) ||
        !Number.isSafeInteger(manifest.memoryEventCount) || manifest.memoryEventCount < 0 ||
        typeof manifest.wslIncluded !== "boolean" || manifest.wslIncluded !== Boolean(manifest.files["wsl/manifest.json"]) ||
        !manifest.voiceSources || typeof manifest.voiceSources !== "object" ||
        Number.isNaN(Date.parse(manifest.createdAt)) || !manifest.files["dashboard.sqlite"] ||
        !manifest.files["keys/auth.key"] || !manifest.files["memory/manifest.json"])
      throw new Error("System backup manifest is invalid");
    const found: string[] = [];
    const walk = (dir: string): void => {
      for (const item of readdirSync(dir, { withFileTypes: true })) {
        if (item.isSymbolicLink()) throw new Error("System backup contains a link");
        const file = join(dir, item.name);
        if (item.isDirectory()) walk(file);
        else if (item.isFile()) found.push(relative(root, file).replaceAll("\\", "/"));
        else throw new Error("System backup contains a non-file entry");
      }
    };
    walk(root);
    const expectedFiles = [...Object.keys(manifest.files), "manifest.json"].sort();
    if (JSON.stringify(found.sort()) !== JSON.stringify(expectedFiles))
      throw new Error(`System backup inventory mismatch: ${found.filter((name) => !expectedFiles.includes(name)).join(",")}`);
    for (const [name, expected] of Object.entries(manifest.files)) {
      const file = resolve(root, name);
      if (!within(file, root) || !/^[a-f0-9]{64}$/.test(expected)) throw new Error("System backup path is invalid");
      let component = root;
      for (const segment of relative(root, file).split(sep)) {
        component = join(component, segment);
        if (lstatSync(component).isSymbolicLink()) throw new Error("System backup contains a link");
      }
      ordinary(file);
      if (sha(readFileSync(file)) !== expected) throw new Error("System backup checksum mismatch");
    }
    const selectedNames = Object.values(manifest.voiceSources).sort();
    const includedNames = Object.keys(manifest.files).filter((name) => name.startsWith("voice-selected/")).sort();
    if (JSON.stringify(selectedNames) !== JSON.stringify(includedNames) ||
        Object.entries(manifest.voiceSources).some(([source, name]) =>
          typeof source !== "string" || !isAbsolute(source) || !/^voice-selected\/[a-f0-9]{20}-[^/]+$/.test(name)))
      throw new Error("System backup voice source inventory is invalid");
    const database = new DatabaseSync(join(root, "dashboard.sqlite"), { readOnly: true });
    try {
      if ((database.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check !== "ok")
        throw new Error("System backup database failed integrity check");
      const key = Buffer.from(readFileSync(join(root, "keys", "auth.key"), "utf8").trim(), "base64");
      if (key.length !== 32) throw new Error("System backup auth key is invalid");
      const auditHead = kvGet(database, "audit.head");
      if (Boolean(auditHead) !== Boolean(manifest.files["state/audit-head.json"]))
        throw new Error("System backup audit anchor is missing");
      const audit = new AuditStore(database, undefined,
        new AuditAnchor({ db: database, key: deriveKey(key, "audit-head"),
          ...(auditHead ? { file: join(root, "state", "audit-head.json") } : {}) }),
        new AuditArchive(database, join(root, "audit-archive")));
      if (!audit.verify().valid) throw new Error("System backup audit chain or anchor is invalid");
    } finally { database.close(); }
    for (const name of ["state/voice-memory.sqlite", "state/memory-outbox.sqlite"]) {
      if (!manifest.files[name]) continue;
      const auxiliary = new DatabaseSync(join(root, name), { readOnly: true });
      try {
        if ((auxiliary.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check !== "ok")
          throw new Error("System backup auxiliary database failed integrity check");
      } finally { auxiliary.close(); }
    }
    if (manifest.wslIncluded) {
      const wsl = JSON.parse(readFileSync(join(root, "wsl", "manifest.json"), "utf8")) as
        { version: number; files: Record<string, string>; sqlite: string[]; excludedRebuildable: string[];
          hermesRevision: string };
      if (wsl.version !== 1 || !wsl.files || typeof wsl.files !== "object" || !Array.isArray(wsl.sqlite) ||
          JSON.stringify(wsl.excludedRebuildable) !== JSON.stringify(["cache", "hermes-agent", "installs", "tools"]) ||
          !/^[a-f0-9]{40}$/.test(wsl.hermesRevision))
        throw new Error("System backup WSL manifest is invalid");
      const wslNames = Object.keys(manifest.files).filter((name) => name.startsWith("wsl/") && name !== "wsl/manifest.json");
      if (JSON.stringify(wslNames.sort()) !== JSON.stringify(Object.keys(wsl.files).map((name) => `wsl/${name}`).sort()))
        throw new Error("System backup WSL inventory mismatch");
      const databases = new Set<string>();
      for (const [name, hash] of Object.entries(wsl.files)) {
        const file = resolve(root, "wsl", name);
        if (!within(file, join(root, "wsl")) || !/^[a-f0-9]{64}$/.test(hash) ||
            sha(readFileSync(file)) !== hash) throw new Error("System backup WSL checksum mismatch");
        if (readFileSync(file).subarray(0, 16).equals(Buffer.from("SQLite format 3\0"))) databases.add(name);
      }
      if (wsl.sqlite.length !== new Set(wsl.sqlite).size ||
          JSON.stringify([...databases].sort()) !== JSON.stringify([...new Set(wsl.sqlite)].sort()))
        throw new Error("System backup WSL database inventory mismatch");
      for (const name of databases) {
        const database = new DatabaseSync(join(root, "wsl", name), { readOnly: true });
        try {
          if ((database.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check !== "ok")
            throw new Error("System backup WSL database failed integrity check");
        } finally { database.close(); }
      }
    }
    const memory = JSON.parse(readFileSync(join(root, "memory", "manifest.json"), "utf8")) as
      { version: number; eventCount: number; tombstones: Array<{ id: string; deleted_at: string }>; hashes: Record<string, string> };
    if (memory.version !== 1 || memory.eventCount !== manifest.memoryEventCount || !Array.isArray(memory.tombstones) ||
        !memory.hashes || typeof memory.hashes !== "object" || Object.keys(memory.hashes).length !== memory.eventCount)
      throw new Error("System backup memory manifest is invalid");
    const memoryFiles = Object.keys(manifest.files).filter((name) => name.startsWith("memory/") && name !== "memory/manifest.json").sort();
    const memoryExpected = Object.keys(memory.hashes).map((name) => `memory/${name}`).sort();
    if (JSON.stringify(memoryFiles) !== JSON.stringify(memoryExpected)) throw new Error("System backup memory inventory mismatch");
    const tombstoneIds = new Set<string>();
    for (const row of memory.tombstones) {
      if (!row || typeof row.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(row.id) ||
          Number.isNaN(Date.parse(row.deleted_at)) || tombstoneIds.has(row.id))
        throw new Error("System backup memory tombstone is invalid");
      tombstoneIds.add(row.id);
    }
    for (const [name, hash] of Object.entries(memory.hashes)) {
      if (!name.startsWith("Conversations/") || !name.endsWith(".md") ||
          tombstoneIds.has(basename(name, ".md")) || manifest.files[`memory/${name}`] !== hash)
        throw new Error("System backup memory checksum or tombstone mismatch");
    }
    if (manifest.wslIncluded) {
      const wsl = JSON.parse(readFileSync(join(root, "wsl", "manifest.json"), "utf8")) as
        { version: number; files: Record<string, string> };
      if (wsl.version !== 1 || !wsl.files || typeof wsl.files !== "object") throw new Error("WSL backup manifest is invalid");
      const actual = Object.keys(manifest.files).filter((name) => name.startsWith("wsl/") && name !== "wsl/manifest.json").sort();
      const expected = Object.keys(wsl.files).map((name) => `wsl/${name}`).sort();
      if (JSON.stringify(actual) !== JSON.stringify(expected) ||
          Object.entries(wsl.files).some(([name, hash]) => manifest.files[`wsl/${name}`] !== hash))
        throw new Error("WSL backup inventory is invalid");
    }
    return { fileCount: Object.keys(manifest.files).length, memoryEventCount: manifest.memoryEventCount, createdAt: manifest.createdAt };
  }

  verifyPublished(path: string): { fileCount: number; memoryEventCount: number; createdAt: string } {
    const selected = resolve(path);
    if (!this.registered().includes(selected) || !basename(selected).startsWith(ownPrefix))
      throw new Error("Backup was not created by this installation");
    return this.verify(selected);
  }

  restoreIsolated(sourcePath: string, targetPath: string): { path: string; fileCount: number } {
    const source = realpathSync(sourcePath);
    const result = this.verifyPublished(source);
    const target = resolve(targetPath);
    if (existsSync(target) || !within(target, this.dataDir) || within(target, this.vaultPath))
      throw new Error("Restore target must be new and isolated inside Friday data");
    const parent = realpathSync(dirname(target));
    if (parent !== this.dataDir && !within(parent, this.dataDir)) throw new Error("Restore target escapes Friday data");
    const requiredBytes = Object.keys((JSON.parse(readFileSync(join(source, "manifest.json"), "utf8")) as Manifest).files)
      .reduce((total, name) => total + statSync(join(source, name)).size, 0) * 2 + 16 * 1024 * 1024;
    const free = statfsSync(parent);
    if (free.bavail * free.bsize < requiredBytes) throw new Error("Restore target has insufficient free space");
    const staging = privateStaging(parent, ".friday-system-restore-");
    try {
      this.registerTemporary(staging, "restore");
      const manifest = JSON.parse(readFileSync(join(source, "manifest.json"), "utf8")) as Manifest;
      for (const name of Object.keys(manifest.files)) {
        const dest = resolve(staging, name);
        if (!within(dest, staging)) throw new Error("Invalid restore entry");
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(join(source, name), dest, constants.COPYFILE_EXCL);
      }
      copyFileSync(join(source, "manifest.json"), join(staging, "manifest.json"), constants.COPYFILE_EXCL);
      rmSync(join(staging, ".friday-temporary.json"));
      this.verify(staging);
      if (existsSync(target)) throw new Error("Restore target appeared during verification");
      renameSync(staging, target);
      return { path: target, fileCount: result.fileCount };
    } finally {
      this.clearTemporary(staging);
      if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
    }
  }

  private prune(destination: string, keep: number): void {
    const completed = this.registered().filter((path) => dirname(path) === destination &&
      basename(path).startsWith(ownPrefix) && existsSync(path)).sort().reverse();
    for (const path of completed.slice(keep)) {
      try { this.verify(path); } catch { continue; }
      rmSync(path, { recursive: true, force: true });
    }
    kvSet(this.db, registryKey, JSON.stringify(this.registered().filter((path) => existsSync(path))));
  }

  private registered(): string[] {
    try {
      const value = JSON.parse(kvGet(this.db, registryKey) ?? "[]") as unknown;
      return Array.isArray(value) ? value.filter((path): path is string => typeof path === "string") : [];
    } catch { return []; }
  }
}
