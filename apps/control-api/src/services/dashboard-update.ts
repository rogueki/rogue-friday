import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import type { FridayConfig } from "@friday/config";

const exec = promisify(execFile);
const REPOSITORY = "https://github.com/rogueki/rogue-friday.git";
const SHA = /^[0-9a-f]{40}$/;
const RUN_ID = /^[0-9a-f]{32}$/;
const SCRIPT_PATH = "installer/scripts/update-dashboard-github.ps1";
const PHASES = ["starting", "download", "verify", "dependencies", "build", "backup", "install", "health", "rollback", "success", "failed"] as const;
type Phase = typeof PHASES[number];

export interface DashboardUpdateProgress {
  runId: string;
  targetCommit: string;
  state: "running" | "success" | "failed";
  phase: Phase;
  step: number;
  totalSteps: number;
  message: string;
  startedAt: string;
  updatedAt: string;
  pid?: number;
  processStartedAt?: string;
}

export interface DashboardUpdateStatus {
  installed: string | null;
  latest: string | null;
  available: boolean;
  checking: boolean;
  installing: boolean;
  error: string | null;
  progress: DashboardUpdateProgress | null;
  lastResult: { commit: string; status: "success" | "failed"; time: string; message?: string } | null;
}

export function parseDashboardProgress(value: unknown): DashboardUpdateProgress | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (item.schema !== 1 || typeof item.runId !== "string" || !RUN_ID.test(item.runId) ||
      typeof item.targetCommit !== "string" || !SHA.test(item.targetCommit) ||
      !["running", "success", "failed"].includes(String(item.state)) ||
      !PHASES.includes(item.phase as Phase) || typeof item.message !== "string" ||
      typeof item.startedAt !== "string" || !Number.isFinite(Date.parse(item.startedAt)) ||
      typeof item.updatedAt !== "string" || !Number.isFinite(Date.parse(item.updatedAt)) ||
      !Number.isInteger(item.step) || !Number.isInteger(item.totalSteps) ||
      (item.step as number) < 0 || (item.step as number) > 8 || item.totalSteps !== 8) return null;
  return { runId: item.runId, targetCommit: item.targetCommit,
    state: item.state as DashboardUpdateProgress["state"], phase: item.phase as Phase,
    step: item.step as number, totalSteps: 8, message: item.message.slice(0, 200),
    startedAt: item.startedAt, updatedAt: item.updatedAt,
    ...(Number.isInteger(item.pid) && (item.pid as number) > 0 ? { pid: item.pid as number } : {}),
    ...(typeof item.processStartedAt === "string" ? { processStartedAt: item.processStartedAt } : {}) };
}

/** The installed dashboard has no .git directory. Its provenance is recorded after a successful installer build. */
export class DashboardUpdateService {
  private cache: { time: number; latest: string } | null = null;
  private inflight: Promise<string> | null = null;
  private starting = false;
  constructor(private readonly config: FridayConfig, private readonly launch: typeof spawn = spawn,
    private readonly startAckTimeoutMs = 10_000) {}

  private get root(): string { return resolve(this.config.paths.dataDir, "..", ".."); }
  private get marker(): string { return join(this.config.paths.dataDir, "dashboard-revision.json"); }
  private get lock(): string { return join(this.root, "updates", "dashboard-update.lock"); }
  private get guard(): string { return join(this.root, "updates", "dashboard-update-start.guard"); }
  private get progressFile(): string { return join(this.config.paths.dataDir, "dashboard-update-progress.json"); }

  private async progress(): Promise<DashboardUpdateProgress | null> {
    try { return parseDashboardProgress(JSON.parse(await readFile(this.progressFile, "utf8"))); }
    catch { return null; }
  }

  private async writeProgress(progress: DashboardUpdateProgress): Promise<void> {
    const temporary = `${this.progressFile}.${progress.runId}.tmp`;
    await writeFile(temporary, JSON.stringify({ schema: 1, ...progress }), { flag: "wx" });
    await rename(temporary, this.progressFile);
  }

  private async lastResult(): Promise<DashboardUpdateStatus["lastResult"]> {
    try {
      const value = JSON.parse(await readFile(join(this.config.paths.dataDir, "dashboard-update-result.json"), "utf8"));
      if (!SHA.test(value.commit) || !["success", "failed"].includes(value.status) || typeof value.time !== "string") return null;
      return { commit: value.commit, status: value.status, time: value.time,
        ...(typeof value.message === "string" ? { message: value.message.slice(0, 300) } : {}) };
    } catch { return null; }
  }

  private async installed(): Promise<string | null> {
    try {
      const value = JSON.parse(await readFile(this.marker, "utf8")) as { commit?: unknown };
      return typeof value.commit === "string" && SHA.test(value.commit) ? value.commit : null;
    } catch { return null; }
  }

  private async latest(force = false): Promise<string> {
    if (!force && this.cache && Date.now() - this.cache.time < 5 * 60_000) return this.cache.latest;
    this.inflight ??= (async () => {
      const { stdout } = await exec("git", ["ls-remote", REPOSITORY, "refs/heads/main"], {
        timeout: 20_000, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
      const latest = stdout.trim().split(/\s+/)[0] ?? "";
      if (!SHA.test(latest)) throw new Error("GitHub meldet keinen gültigen main-Commit.");
      this.cache = { time: Date.now(), latest };
      return latest;
    })().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  private async processMatches(progress: { pid?: number; processStartedAt?: string }): Promise<"alive" | "dead" | "unknown"> {
    if (!progress.pid || !progress.processStartedAt) return "unknown";
    if (process.platform !== "win32") {
      try { process.kill(progress.pid, 0); return "alive"; } catch { return "dead"; }
    }
    try {
      const command = `$p=Get-Process -Id ${progress.pid} -ErrorAction SilentlyContinue; if($p){$p.StartTime.ToUniversalTime().ToString('o')}`;
      const { stdout } = await exec("powershell.exe", ["-NoProfile", "-Command", command], { timeout: 5000, windowsHide: true });
      if (!stdout.trim()) return "dead";
      return Math.abs(Date.parse(stdout.trim()) - Date.parse(progress.processStartedAt)) < 2000 ? "alive" : "dead";
    } catch { return "unknown"; }
  }

  private async guardBusy(): Promise<boolean> {
    if (!existsSync(this.guard)) return false;
    try {
      const age = Date.now() - (await stat(this.guard)).mtimeMs;
      if (age < 150_000) return true;
      const guard = JSON.parse(await readFile(this.guard, "utf8")) as { pid?: number; processStartedAt?: string };
      if (await this.processMatches(guard) !== "dead") return true;
    } catch { /* A stale or invalid guard is removed after its startup window. */ }
    await rm(this.guard, { force: true });
    return false;
  }

  private async effectiveProgress(): Promise<DashboardUpdateProgress | null> {
    const progress = await this.progress();
    if (!progress || progress.state !== "running") return progress;
    const age = Date.now() - Date.parse(progress.updatedAt);
    if (this.starting || existsSync(this.guard) && age < 90_000) return progress;
    if (existsSync(this.lock) && await this.processMatches(progress) !== "dead") return progress;
    if (!existsSync(this.lock) && age < 15_000) return progress;
    const result = await this.lastResult();
    if (result?.commit === progress.targetCommit && Date.parse(result.time) >= Date.parse(progress.startedAt)) {
      if (result.status === "success" && await this.installed() === progress.targetCommit) {
        return { ...progress, state: "success", phase: "success", step: 8, message: "Update installiert und Dashboard erreichbar." };
      }
      if (result.status === "failed") {
        return { ...progress, state: "failed", phase: "failed", message: result.message ?? "Update fehlgeschlagen." };
      }
    }
    return { ...progress, state: "failed", phase: "failed", message: "Update-Prozess wurde unterbrochen. Bitte den letzten Stand prüfen." };
  }

  async status(force = false): Promise<DashboardUpdateStatus> {
    const progress = await this.effectiveProgress();
    const legacyLock = progress?.state !== "running" && await this.legacyLockActive();
    const installing = progress?.state === "running" || legacyLock;
    const installed = await this.installed();
    const useLocal = progress?.state === "running" || Boolean(progress && Date.now() - Date.parse(progress.updatedAt) < 60_000);
    let latest: string | null = useLocal && progress ? progress.targetCommit : this.cache?.latest ?? null;
    let error: string | null = installed ? null : "Installierter Git-Stand unbekannt. Dashboard einmal mit dem aktuellen Installer aktualisieren.";
    if (!useLocal && !legacyLock) {
      try { latest = await this.latest(force); }
      catch { error = "GitHub ist nicht erreichbar oder der Zugriff auf das Repository fehlt."; }
    }
    return { installed, latest, available: Boolean(installed && latest && installed !== latest),
      checking: false, installing, error, progress, lastResult: await this.lastResult() };
  }

  private async legacyLockActive(): Promise<boolean> {
    if (!existsSync(this.lock)) return false;
    if (process.platform !== "win32") return true;
    const path = this.lock.replaceAll("'", "''");
    const command = `try {$h=[IO.File]::Open('${path}',[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None);$h.Dispose();'free'} catch [IO.IOException] {'held'} catch {'unknown'}`;
    try {
      const { stdout } = await exec("powershell.exe", ["-NoProfile", "-Command", command], { timeout: 5000, windowsHide: true });
      if (stdout.trim() === "free") { await rm(this.lock, { force: true }); return false; }
      return true;
    } catch { return true; }
  }

  private async stageUpdater(expectedCommit: string): Promise<string> {
    const updates = join(this.root, "updates");
    const repositoryCache = join(updates, "updater-script.git");
    await mkdir(updates, { recursive: true });
    if (!existsSync(join(repositoryCache, "HEAD"))) {
      await exec("git", ["init", "--bare", repositoryCache], { timeout: 20_000, windowsHide: true });
    }
    const git = async (args: string[]) => exec("git", ["--git-dir", repositoryCache, ...args], {
      timeout: 120_000, windowsHide: true, maxBuffer: 2_000_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    await git(["fetch", "--depth=1", "--no-tags", REPOSITORY, "refs/heads/main"]);
    const { stdout: fetched } = await git(["rev-parse", "FETCH_HEAD"]);
    if (fetched.trim() !== expectedCommit) throw new Error("GitHub main hat sich geändert. Bitte Update erneut prüfen.");
    const { stdout: listing } = await git(["ls-tree", expectedCommit, "--", SCRIPT_PATH]);
    const match = listing.trim().match(/^100644 blob ([0-9a-f]{40})\s+installer\/scripts\/update-dashboard-github\.ps1$/);
    if (!match) throw new Error("Verifiziertes Update-Skript fehlt im GitHub-Stand.");
    const { stdout: source } = await git(["show", `${expectedCommit}:${SCRIPT_PATH}`]);
    const script = join(updates, `update-dashboard-${expectedCommit}-${randomUUID()}.ps1`);
    await writeFile(script, source, { flag: "wx" });
    const { stdout: actual } = await git(["hash-object", script]);
    if (actual.trim() !== match[1]) { await rm(script, { force: true }); throw new Error("Update-Skript stimmt nicht mit dem GitHub-Commit überein."); }
    return script;
  }

  async install(expectedCommit: string): Promise<void> {
    if (!SHA.test(expectedCommit)) throw new Error("Ungültige Commit-ID.");
    if (this.starting) throw new Error("Ein Dashboard-Update läuft bereits.");
    const status = await this.status(true);
    if (status.installing || existsSync(this.lock) || await this.guardBusy()) throw new Error("Ein Dashboard-Update läuft bereits.");
    if (!status.installed) throw new Error("Installierter Git-Stand unbekannt. Dashboard einmal mit dem aktuellen Installer aktualisieren.");
    if (!status.available || status.latest !== expectedCommit) throw new Error("Update-Stand geändert. Bitte erneut prüfen.");
    await mkdir(join(this.root, "updates"), { recursive: true });
    const guard = await open(this.guard, "wx").catch(() => { throw new Error("Ein Dashboard-Update läuft bereits."); });
    this.starting = true;
    const runId = randomUUID().replaceAll("-", "");
    const now = new Date().toISOString();
    const starting: DashboardUpdateProgress = { runId, targetCommit: expectedCommit, state: "running", phase: "starting",
      step: 0, totalSteps: 8, message: "Update wird vorbereitet.", startedAt: now, updatedAt: now };
    try {
      await guard.writeFile(JSON.stringify({ pid: process.pid, processStartedAt: new Date(Date.now() - process.uptime() * 1000).toISOString() }));
      await this.writeProgress(starting);
      const script = await this.stageUpdater(expectedCommit);
      const child = this.launch("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script,
        "-InstallRoot", this.root, "-ExpectedCommit", expectedCommit, "-RunId", runId], {
        cwd: this.root, detached: true, stdio: "ignore", windowsHide: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
      await new Promise<void>((resolveSpawn, rejectSpawn) => {
        child.once("spawn", () => resolveSpawn());
        child.once("error", rejectSpawn);
      });
      let exitCode: number | null = null;
      child.once("exit", (code) => { exitCode = code ?? 1; });
      let acknowledged = false;
      const deadline = Date.now() + this.startAckTimeoutMs;
      while (Date.now() < deadline) {
        const current = await this.progress();
        if (current?.runId === runId && current.phase !== "starting" && current.pid && current.processStartedAt) {
          if (current.state === "failed") throw new Error(current.message);
          acknowledged = true;
          break;
        }
        if (exitCode !== null) throw new Error("PowerShell-Update wurde vor dem ersten Arbeitsschritt beendet.");
        await delay(250);
      }
      if (!acknowledged) {
        child.kill();
        throw new Error("PowerShell-Update hat den Start nicht bestätigt.");
      }
      child.unref();
    } catch (error) {
      await this.writeProgress({ ...starting, state: "failed", phase: "failed", updatedAt: new Date().toISOString(),
        message: error instanceof Error ? error.message.slice(0, 200) : "Update konnte nicht gestartet werden." }).catch(() => {});
      throw error;
    } finally {
      this.starting = false;
      await guard.close();
      await rm(this.guard, { force: true });
    }
  }
}
