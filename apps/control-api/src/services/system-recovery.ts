import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { closeSync, constants, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync,
  readSync, readdirSync, realpathSync, renameSync, rmSync, statfsSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, parse as parsePath, resolve, sep } from "node:path";
import { parse, stringify } from "yaml";
import type { SystemBackupService } from "./system-backup";

interface SnapshotManifest {
  version: number;
  sourceInstallRoot?: string;
  sourceVaultPath?: string;
  wslIncluded: boolean;
  voiceSources: Record<string, string>;
  files: Record<string, string>;
}

interface FreshState {
  distro_name?: string;
  distro_location?: string;
  linux_user?: string;
  ports?: Record<string, number>;
  dashboard_hash?: string;
  dashboard_source?: string;
  dashboard_pnpm?: string;
  done?: string[];
  [key: string]: unknown;
}

interface RecoveryPlan {
  version: 1;
  backupPath: string;
  targetRoot: string;
  createdAt: string;
  files: Record<string, string>;
  replaced: Record<string, string | null>;
  sidecars: Record<string, string>;
  wslRevision: string;
  state: "prepared" | "applying" | "applied" | "rolled-back";
}

const hash = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
const comparable = (path: string): string => process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path);
const samePath = (left: string, right: string): boolean => comparable(left) === comparable(right);
const inside = (path: string, root: string): boolean => comparable(path).startsWith(comparable(root) + sep);

function noLinkedAncestors(path: string): void {
  let current = resolve(path);
  const volume = parsePath(current).root;
  while (current !== volume) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink())
      throw new Error("Recovery path contains a linked ancestor");
    current = dirname(current);
  }
}

function ordinary(path: string): void {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Recovery requires an ordinary file");
}

function sqliteSidecars(path: string): Array<{ suffix: string; hash: string }> {
  if (!existsSync(path)) return [];
  ordinary(path);
  const fd = openSync(path, "r");
  const header = Buffer.alloc(16);
  try { if (readSync(fd, header, 0, 16, 0) !== 16 || !header.equals(Buffer.from("SQLite format 3\0"))) return []; }
  finally { closeSync(fd); }
  const found: Array<{ suffix: string; hash: string }> = [];
  for (const suffix of ["-wal", "-shm"]) {
    const sidecar = `${path}${suffix}`;
    if (existsSync(sidecar)) {
      ordinary(sidecar);
      if (suffix === "-wal" && statSync(sidecar).size > 0)
        throw new Error("Recovery requires stopped services and checkpointed SQLite databases");
      found.push({ suffix, hash: hash(readFileSync(sidecar)) });
    }
  }
  return found;
}

function privateDirectory(parent: string): string {
  const path = mkdtempSync(join(parent, ".friday-recovery-"));
  try {
    if (process.platform === "win32") {
      const user = process.env.USERNAME;
      if (!user) throw new Error("Recovery owner is unknown");
      const principal = process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${user}` : user;
      execFileSync("icacls", [path, "/inheritance:r", "/grant:r", `${principal}:(OI)(CI)(F)`],
        { stdio: "ignore", windowsHide: true, timeout: 10_000 });
    } else if ((statSync(path).mode & 0o077) !== 0) throw new Error("Recovery staging is not private");
    return path;
  } catch (error) {
    rmSync(path, { recursive: true, force: true });
    throw new Error("Private recovery staging could not be created", { cause: error });
  }
}

/** Prepares an exact, reversible import for an already provisioned, separate Friday installation. */
export class SystemRecoveryService {
  constructor(private readonly backup: SystemBackupService) {}

  prepare(backupPath: string, targetPath: string): { path: string; fileCount: number; wslRevision: string } {
    const source = realpathSync(backupPath);
    this.backup.verify(source);
    const snapshot = JSON.parse(readFileSync(join(source, "manifest.json"), "utf8")) as SnapshotManifest;
    if (!snapshot.sourceInstallRoot || !snapshot.sourceVaultPath || !snapshot.wslIncluded ||
        !snapshot.files["keys/hermes_api.key"] || !snapshot.files["wsl/manifest.json"])
      throw new Error("Backup lacks operational recovery prerequisites");
    noLinkedAncestors(targetPath);
    const target = realpathSync(targetPath);
    if (!isAbsolute(targetPath) || lstatSync(targetPath).isSymbolicLink() || !statSync(target).isDirectory() ||
        samePath(target, source) || inside(target, source) || inside(source, target) ||
        samePath(target, snapshot.sourceInstallRoot) || inside(target, snapshot.sourceInstallRoot))
      throw new Error("Recovery target must be a separate fresh installation");
    const runtime = join(target, "dashboard", "apps", "control-api", "dist", "main.js");
    const statePath = join(target, "config", "install-state.json");
    const targetDbPath = join(target, "dashboard", "data", "dashboard.sqlite");
    const vault = join(target, "memory", "Friday");
    for (const file of [runtime, statePath, targetDbPath]) ordinary(file);
    if (!existsSync(join(vault, ".obsidian")) || lstatSync(vault).isSymbolicLink() ||
        lstatSync(join(vault, ".obsidian")).isSymbolicLink())
      throw new Error("Fresh target Obsidian Vault is unavailable");
    const fresh = JSON.parse(readFileSync(statePath, "utf8")) as FreshState;
    const original = JSON.parse(readFileSync(join(source, "config", "install-state.json"), "utf8")) as FreshState;
    if (!fresh.distro_name || !fresh.distro_location || !fresh.dashboard_hash ||
        !fresh.linux_user || fresh.linux_user !== original.linux_user ||
        !fresh.ports || !Array.isArray(fresh.done) || !fresh.done.includes("dashboard") ||
        fresh.distro_name === original.distro_name || fresh.dashboard_hash !== original.dashboard_hash)
      throw new Error("Recovery requires a completed, separate installation of the same Friday build");
    const freshDb = new DatabaseSync(targetDbPath, { readOnly: true });
    try {
      const tables = freshDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('sqlite_sequence','schema_migrations')")
        .all() as Array<{ name: string }>;
      for (const { name } of tables) {
        const quoted = name.replaceAll('"', '""');
        // A first boot installs built-in UI library rows and may advance the
        // event sequence. Neither belongs to the owner. Every other persisted
        // row makes this target ambiguous, so recovery refuses to overwrite it.
        const where = name === "library_items" ? " WHERE built_in = 0" :
          name === "kv" ? " WHERE key != 'hub.sequence'" : "";
        const count = (freshDb.prepare(`SELECT COUNT(*) AS count FROM "${quoted}"${where}`).get() as { count: number }).count;
        if (count !== 0) throw new Error("Recovery target already has application or owner data");
      }
    } finally { freshDb.close(); }
    sqliteSidecars(targetDbPath);
    const notes = join(vault, "Conversations");
    if (existsSync(notes) && readdirSync(notes, { recursive: true }).length > 0)
      throw new Error("Recovery target Vault already has user notes");
    const wslManifest = JSON.parse(readFileSync(join(source, "wsl", "manifest.json"), "utf8")) as { hermesRevision: string };
    const total = Object.keys(snapshot.files).reduce((sum, name) => sum + statSync(join(source, name)).size, 0);
    const space = statfsSync(target);
    if (space.bavail * space.bsize < total * 3 + 32 * 1024 * 1024)
      throw new Error("Recovery target has insufficient staging and rollback space");
    const backupDir = join(target, "backups");
    mkdirSync(backupDir, { recursive: true });
    if (lstatSync(backupDir).isSymbolicLink()) throw new Error("Recovery backup directory is linked");
    const staging = privateDirectory(backupDir);
    try {
      const entries = this.mapping(snapshot);
      const recoveredPaths: Record<string, string> = {};
      for (const [oldPath, name] of Object.entries(snapshot.voiceSources))
        recoveredPaths[oldPath] = join(target, "config", "voice-references", "recovered", basename(name));
      const transform = (value: unknown): unknown => {
        if (typeof value === "string") {
          let result = recoveredPaths[value] ?? value;
          result = result.replaceAll(snapshot.sourceVaultPath!, vault);
          for (const oldRoot of [snapshot.sourceInstallRoot!, snapshot.sourceInstallRoot!.replaceAll("\\", "/")])
            result = result.replaceAll(oldRoot, oldRoot.includes("/") ? target.replaceAll("\\", "/") : target);
          for (const [key, oldPort] of Object.entries(original.ports ?? {})) {
            const next = fresh.ports?.[key];
            if (next && next !== oldPort) result = result.replaceAll(`127.0.0.1:${oldPort}`, `127.0.0.1:${next}`);
          }
          return result;
        }
        if (Array.isArray(value)) return value.map(transform);
        if (value && typeof value === "object")
          return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, transform(item)]));
        return value;
      };
      const recoveredState = transform(original) as FreshState;
      for (const key of ["distro_name", "distro_location", "linux_user", "ports", "dashboard_hash", "dashboard_source", "dashboard_pnpm", "done"])
        recoveredState[key] = fresh[key];
      const contents: Record<string, Buffer> = {
        "config/install-state.json": Buffer.from(JSON.stringify(recoveredState)),
        "config/obsidian-vault-path.txt": Buffer.from(vault),
      };
      for (const name of ["config/voice.json", "config/persona.json"]) {
        if (!snapshot.files[name]) continue;
        contents[name] = Buffer.from(JSON.stringify(transform(JSON.parse(readFileSync(join(source, name), "utf8")))));
      }
      for (const name of ["config/dashboard.yaml", "config/adapters.yaml"]) {
        if (!snapshot.files[name]) continue;
        contents[name] = Buffer.from(stringify(transform(parse(readFileSync(join(source, name), "utf8")))));
      }
      const files: Record<string, string> = {};
      const replaced: Record<string, string | null> = {};
      const sidecars: Record<string, string> = {};
      for (const [from, destination] of entries) {
        const targetFile = resolve(target, destination);
        if (!inside(targetFile, target)) throw new Error("Recovery mapping escaped the new installation");
        const staged = join(staging, "new", destination);
        mkdirSync(dirname(staged), { recursive: true });
        if (contents[from]) writeFileSync(staged, contents[from], { flag: "wx", mode: 0o600, flush: true });
        else copyFileSync(join(source, from), staged, constants.COPYFILE_EXCL);
        files[destination] = hash(readFileSync(staged));
        if (existsSync(targetFile)) {
          ordinary(targetFile);
          for (const item of sqliteSidecars(targetFile)) {
            const saved = join(staging, "previous-sidecars", `${destination}${item.suffix}`);
            mkdirSync(dirname(saved), { recursive: true });
            copyFileSync(`${targetFile}${item.suffix}`, saved, constants.COPYFILE_EXCL);
            sidecars[`${destination}${item.suffix}`] = item.hash;
          }
          const rollback = join(staging, "previous", destination);
          mkdirSync(dirname(rollback), { recursive: true });
          copyFileSync(targetFile, rollback, constants.COPYFILE_EXCL);
          replaced[destination] = hash(readFileSync(rollback));
        } else replaced[destination] = null;
      }
      const wslSnapshot = join(staging, "wsl");
      for (const name of Object.keys(snapshot.files).filter((name) => name.startsWith("wsl/"))) {
        const destination = join(staging, name);
        mkdirSync(dirname(destination), { recursive: true });
        copyFileSync(join(source, name), destination, constants.COPYFILE_EXCL);
      }
      if (!existsSync(join(wslSnapshot, "manifest.json"))) throw new Error("WSL state was not staged");
      const plan: RecoveryPlan = { version: 1, backupPath: source, targetRoot: target,
        createdAt: new Date().toISOString(), files, replaced, sidecars, wslRevision: wslManifest.hermesRevision,
        state: "prepared" };
      writeFileSync(join(staging, "recovery-plan.json"), JSON.stringify(plan), { flag: "wx", mode: 0o600, flush: true });
      return { path: staging, fileCount: Object.keys(files).length, wslRevision: plan.wslRevision };
    } catch (error) {
      rmSync(staging, { recursive: true, force: true });
      throw error;
    }
  }

  /** Caller must stop the newly installed target services before this filesystem transaction. */
  apply(preparedPath: string): { path: string; fileCount: number; state: "applied" } {
    const { root, plan } = this.readPlan(preparedPath);
    if (plan.state !== "prepared") throw new Error("Recovery plan is not prepared");
    this.backup.verify(plan.backupPath);
    for (const [name, newHash] of Object.entries(plan.files)) {
      const target = this.targetFile(plan, name);
      const newFile = join(root, "new", name);
      ordinary(newFile);
      if (hash(readFileSync(newFile)) !== newHash) throw new Error("Prepared recovery file changed");
      const previous = plan.replaced[name];
      if (previous === null) {
        if (existsSync(target)) throw new Error("Fresh recovery target acquired new data");
      } else {
        ordinary(target);
        const current = sqliteSidecars(target);
        const expected = Object.entries(plan.sidecars).filter(([path]) => path === `${name}-wal` || path === `${name}-shm`);
        if (current.length !== expected.length || current.some((item) => plan.sidecars[`${name}${item.suffix}`] !== item.hash))
          throw new Error("Fresh recovery database sidecars changed after preparation");
        if (hash(readFileSync(target)) !== previous ||
            hash(readFileSync(join(root, "previous", name))) !== previous)
          throw new Error("Fresh recovery target changed after preparation");
      }
      this.safeParent(target, plan.targetRoot);
    }
    plan.state = "applying";
    this.writePlan(root, plan);
    try {
      for (const name of Object.keys(plan.files)) {
        const target = this.targetFile(plan, name);
        mkdirSync(dirname(target), { recursive: true });
        for (const suffix of ["-wal", "-shm"]) {
          const sidecarName = `${name}${suffix}`;
          if (plan.sidecars[sidecarName]) {
            const saved = join(root, "previous-active-sidecars", sidecarName);
            mkdirSync(dirname(saved), { recursive: true });
            renameSync(`${target}${suffix}`, saved);
          }
        }
        if (plan.replaced[name] !== null) {
          const saved = join(root, "previous-active", name);
          mkdirSync(dirname(saved), { recursive: true });
          renameSync(target, saved);
        }
        renameSync(join(root, "new", name), target);
      }
      plan.state = "applied";
      this.writePlan(root, plan);
      return { path: root, fileCount: Object.keys(plan.files).length, state: "applied" };
    } catch (error) {
      try { this.rollback(root); } catch (rollbackError) {
        throw new Error("Recovery apply failed and rollback requires attention", { cause: rollbackError });
      }
      throw error;
    }
  }

  rollback(preparedPath: string): { restoredFileCount: number; state: "rolled-back" } {
    const { root, plan } = this.readPlan(preparedPath);
    if (plan.state !== "applying" && plan.state !== "applied")
      throw new Error("Recovery has no applied files to roll back");
    const entries = Object.entries(plan.files);
    // Preflight the entire rollback before changing any file. User edits after
    // activation are never replaced by an old snapshot.
    for (const [name, newHash] of entries) {
      const target = this.targetFile(plan, name);
      this.safeParent(target, plan.targetRoot);
      for (const suffix of ["-wal", "-shm"]) {
        const sidecar = `${target}${suffix}`;
        if (existsSync(sidecar)) {
          ordinary(sidecar);
          const expected = plan.sidecars[`${name}${suffix}`];
          if (!expected || hash(readFileSync(sidecar)) !== expected || existsSync(join(root, "previous-active-sidecars", `${name}${suffix}`)))
            throw new Error("Recovered database sidecar changed; automatic rollback refused");
        }
      }
      if (existsSync(target)) {
        ordinary(target);
        const actual = hash(readFileSync(target));
        if (actual !== newHash && actual !== plan.replaced[name])
          throw new Error("Recovered data changed; automatic rollback refused");
      }
      const old = plan.replaced[name];
      if (old !== null && old !== undefined) {
        const moved = join(root, "previous-active", name);
        const copy = join(root, "previous", name);
        const saved = existsSync(moved) ? moved : copy;
        ordinary(saved);
        if (hash(readFileSync(saved)) !== old) throw new Error("Recovery rollback copy changed");
      }
    }
    for (const [name, newHash] of entries.reverse()) {
      const target = this.targetFile(plan, name);
      const old = plan.replaced[name];
      if (old === null) {
        if (existsSync(target) && hash(readFileSync(target)) === newHash) rmSync(target);
      } else if (old !== undefined) {
        const moved = join(root, "previous-active", name);
        if (existsSync(moved)) {
          if (existsSync(target)) rmSync(target);
          renameSync(moved, target);
        }
      }
      for (const suffix of ["-wal", "-shm"]) {
        const saved = join(root, "previous-active-sidecars", `${name}${suffix}`);
        if (existsSync(saved)) renameSync(saved, `${target}${suffix}`);
      }
    }
    plan.state = "rolled-back";
    this.writePlan(root, plan);
    return { restoredFileCount: entries.length, state: "rolled-back" };
  }

  private readPlan(path: string): { root: string; plan: RecoveryPlan } {
    const root = realpathSync(path);
    if (!basename(root).startsWith(".friday-recovery-") || lstatSync(path).isSymbolicLink())
      throw new Error("Recovery staging path is invalid");
    ordinary(join(root, "recovery-plan.json"));
    const plan = JSON.parse(readFileSync(join(root, "recovery-plan.json"), "utf8")) as RecoveryPlan;
    if (plan.version !== 1 || !plan.files || !plan.replaced || !plan.sidecars ||
        !["prepared", "applying", "applied", "rolled-back"].includes(plan.state) ||
        realpathSync(join(plan.targetRoot, "backups")) !== dirname(root))
      throw new Error("Recovery plan is invalid");
    return { root, plan };
  }

  private targetFile(plan: RecoveryPlan, name: string): string {
    const file = resolve(plan.targetRoot, name);
    if (!inside(file, plan.targetRoot)) throw new Error("Recovery path escaped target");
    return file;
  }

  private safeParent(path: string, root: string): void {
    let current = dirname(path);
    while (current !== root) {
      if (existsSync(current) && (lstatSync(current).isSymbolicLink() || !lstatSync(current).isDirectory()))
        throw new Error("Recovery target contains a linked or non-directory parent");
      current = dirname(current);
    }
  }

  private writePlan(root: string, plan: RecoveryPlan): void {
    const temp = join(root, `.recovery-plan-${randomUUID()}.tmp`);
    writeFileSync(temp, JSON.stringify(plan), { flag: "wx", mode: 0o600, flush: true });
    renameSync(temp, join(root, "recovery-plan.json"));
  }

  private mapping(snapshot: SnapshotManifest): Array<[string, string]> {
    const entries: Array<[string, string]> = [];
    for (const name of Object.keys(snapshot.files)) {
      let target: string | null = null;
      if (name === "dashboard.sqlite") target = "dashboard/data/dashboard.sqlite";
      else if (name === "state/audit-head.json") target = "dashboard/data/audit-head.json";
      else if (name === "state/voice-memory.sqlite") target = "dashboard/data/voice-memory.sqlite";
      else if (name === "state/memory-outbox.sqlite") target = "dashboard/data/memory/outbox.sqlite";
      else if (name === "keys/auth.key") target = "dashboard/data/auth.key";
      else if (name === "keys/hermes_api.key") target = "config/hermes_api.key";
      else if (name === "keys/elevenlabs_api.key.dpapi") target = "config/elevenlabs_api.key.dpapi";
      else if (name.startsWith("keys/") && name.endsWith(".key"))
        target = `dashboard/data/${basename(name, ".key")}/auth.key`;
      else if (name === "config/dashboard.yaml") target = "dashboard/config/dashboard.yaml";
      else if (name === "config/adapters.yaml") target = "dashboard/config/adapters.yaml";
      else if (name.startsWith("config/") && name !== "config/obsidian-vault-path.txt") target = name;
      else if (name.startsWith("audit-archive/")) target = `dashboard/data/${name}`;
      else if (name.startsWith("voice/profiles/owner/")) target = name;
      else if (name.startsWith("voice-selected/")) target = `config/voice-references/recovered/${basename(name)}`;
      else if (name.startsWith("memory/Conversations/")) target = `memory/Friday/${name.slice("memory/".length)}`;
      if (target) entries.push([name, target]);
    }
    entries.push(["config/obsidian-vault-path.txt", "config/obsidian-vault-path.txt"]);
    return entries;
  }
}
