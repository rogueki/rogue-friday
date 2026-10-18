import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { backup, DatabaseSync } from "node:sqlite";
import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync,
  renameSync, rmSync, statfsSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Db } from "../db/database";
import type { DurableMemoryService } from "./durable-memory";

interface Manifest {
  version: 1;
  createdAt: string;
  files: Record<string, string>;
  memoryEventCount: number;
}

const ownPrefix = "friday-system-";
const sha = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
const within = (child: string, parent: string): boolean => child.startsWith(parent + sep);

function ordinary(path: string): void {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Backup source must be an ordinary file");
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

  constructor(dataDir: string, private readonly db: Db, private readonly memory: DurableMemoryService) {
    this.dataDir = realpathSync(resolve(dataDir));
    this.installRoot = resolve(this.dataDir, "..", "..");
    this.vaultPath = resolve(memory.vaultPath);
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
      [join(this.installRoot, "config", "voice.json"), "config/voice.json"],
      [join(this.installRoot, "config", "install-state.json"), "config/install-state.json"],
      [join(this.installRoot, "config", "dashboard_owner.hash"), "config/dashboard_owner.hash"],
      [join(this.installRoot, "dashboard", "config", "dashboard.yaml"), "config/dashboard.yaml"],
      [join(this.installRoot, "dashboard", "config", "adapters.yaml"), "config/adapters.yaml"],
      [join(this.dataDir, "audit-head.json"), "state/audit-head.json"],
    ];
    return names.filter(([from]) => existsSync(from)).map(([from, to]) => { ordinary(from); return { from, to }; });
  }

  preview(targetPath: string): { destination: string; estimatedBytes: number } {
    const destination = this.destination(targetPath);
    const files = this.sourceFiles();
    const databaseSize = statSync(join(this.dataDir, "dashboard.sqlite")).size;
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
    const estimatedBytes = databaseSize * 2 + memoryBytes + files.reduce((n, item) => n + statSync(item.from).size, 0) + 16 * 1024 * 1024;
    const freeBytes = statfsSync(destination).bavail * statfsSync(destination).bsize;
    if (freeBytes < estimatedBytes * 2) throw new Error("Backup destination has insufficient free space");
    return { destination, estimatedBytes };
  }

  async create(targetPath: string, retentionCount: number): Promise<{ path: string; createdAt: string; fileCount: number; verified: boolean }> {
    if (this.busy) throw new Error("System backup is already running");
    if (!Number.isSafeInteger(retentionCount) || retentionCount < 1) throw new Error("Invalid backup retention count");
    this.busy = true;
    let staging: string | null = null;
    try {
      const { destination } = this.preview(targetPath);
      const files = this.sourceFiles();
      staging = privateStaging(destination, `.${ownPrefix}`);
      const hashes: Record<string, string> = {};
      const put = (from: string, name: string): void => {
        ordinary(from);
        const dest = join(staging!, name);
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(from, dest, constants.COPYFILE_EXCL);
        hashes[name] = sha(readFileSync(dest));
      };
      const dbPath = join(staging, "dashboard.sqlite");
      await backup(this.db, dbPath);
      hashes["dashboard.sqlite"] = sha(readFileSync(dbPath));
      for (const file of files) put(file.from, file.to);
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
      const manifest: Manifest = { version: 1, createdAt, files: hashes, memoryEventCount: memorySnapshot.eventCount };
      writeFileSync(join(staging, "manifest.json"), JSON.stringify(manifest), { flag: "wx", mode: 0o600, flush: true });
      this.verify(staging);
      const published = join(destination, `${ownPrefix}${createdAt.replaceAll(/[:.]/g, "-")}-${randomUUID()}`);
      renameSync(staging, published);
      staging = null;
      this.prune(destination, retentionCount);
      return { path: published, createdAt, fileCount: Object.keys(hashes).length, verified: true };
    } finally {
      if (staging) rmSync(staging, { recursive: true, force: true });
      this.busy = false;
    }
  }

  verify(path: string): { fileCount: number; memoryEventCount: number; createdAt: string } {
    const root = realpathSync(path);
    const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")) as Manifest;
    if (manifest.version !== 1 || !manifest.files || !Number.isSafeInteger(manifest.memoryEventCount))
      throw new Error("System backup manifest is invalid");
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
    const database = new DatabaseSync(join(root, "dashboard.sqlite"), { readOnly: true });
    try {
      if ((database.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check !== "ok")
        throw new Error("System backup database failed integrity check");
    } finally { database.close(); }
    return { fileCount: Object.keys(manifest.files).length, memoryEventCount: manifest.memoryEventCount, createdAt: manifest.createdAt };
  }

  restoreIsolated(sourcePath: string, targetPath: string): { path: string; fileCount: number } {
    const source = realpathSync(sourcePath);
    if (!basename(source).startsWith(ownPrefix)) throw new Error("Unknown system backup");
    const result = this.verify(source);
    const target = resolve(targetPath);
    if (existsSync(target) || !within(target, this.dataDir) || within(target, this.vaultPath))
      throw new Error("Restore target must be new and isolated inside Friday data");
    const parent = realpathSync(dirname(target));
    if (parent !== this.dataDir && !within(parent, this.dataDir)) throw new Error("Restore target escapes Friday data");
    const staging = privateStaging(parent, ".friday-system-restore-");
    try {
      const manifest = JSON.parse(readFileSync(join(source, "manifest.json"), "utf8")) as Manifest;
      for (const name of Object.keys(manifest.files)) {
        const dest = resolve(staging, name);
        if (!within(dest, staging)) throw new Error("Invalid restore entry");
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(join(source, name), dest, constants.COPYFILE_EXCL);
      }
      copyFileSync(join(source, "manifest.json"), join(staging, "manifest.json"), constants.COPYFILE_EXCL);
      this.verify(staging);
      if (existsSync(target)) throw new Error("Restore target appeared during verification");
      renameSync(staging, target);
      return { path: target, fileCount: result.fileCount };
    } finally { if (existsSync(staging)) rmSync(staging, { recursive: true, force: true }); }
  }

  private prune(destination: string, keep: number): void {
    const completed = readdirSync(destination, { withFileTypes: true })
      .filter((item) => item.isDirectory() && !item.isSymbolicLink() && item.name.startsWith(ownPrefix))
      .map((item) => join(destination, item.name)).sort().reverse();
    for (const path of completed.slice(keep)) {
      try { this.verify(path); } catch { continue; }
      rmSync(path, { recursive: true, force: true });
    }
  }
}
