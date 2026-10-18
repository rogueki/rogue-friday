import { execFile, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { FridayConfig } from "@friday/config";

const exec = promisify(execFile);
const REPOSITORY = "https://github.com/rogueki/rogue-friday.git";
const SHA = /^[0-9a-f]{40}$/;

export interface DashboardUpdateStatus {
  installed: string | null;
  latest: string | null;
  available: boolean;
  checking: boolean;
  installing: boolean;
  error: string | null;
  lastResult: { commit: string; status: "success" | "failed"; time: string; message?: string } | null;
}

/** The installed dashboard has no .git directory. Its provenance is recorded after a successful installer build. */
export class DashboardUpdateService {
  private cache: { time: number; latest: string } | null = null;
  private inflight: Promise<string> | null = null;
  constructor(private readonly config: FridayConfig) {}

  private get root(): string { return resolve(this.config.paths.dataDir, "..", ".."); }
  private get marker(): string { return join(this.config.paths.dataDir, "dashboard-revision.json"); }
  private get lock(): string { return join(this.root, "updates", "dashboard-update.lock"); }

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

  async status(force = false): Promise<DashboardUpdateStatus> {
    const installed = await this.installed();
    let latest: string | null = null;
    let error: string | null = installed ? null : "Installierter Git-Stand unbekannt. Dashboard einmal mit dem aktuellen Installer aktualisieren.";
    try { latest = await this.latest(force); }
    catch { error = "GitHub ist nicht erreichbar oder der Zugriff auf das private Repository fehlt."; }
    const { existsSync } = await import("node:fs");
    return { installed, latest, available: Boolean(installed && latest && installed !== latest),
      checking: false, installing: existsSync(this.lock), error, lastResult: await this.lastResult() };
  }

  async install(expectedCommit: string): Promise<void> {
    if (!SHA.test(expectedCommit)) throw new Error("Ungültige Commit-ID.");
    const status = await this.status(true);
    if (status.installing) throw new Error("Ein Dashboard-Update läuft bereits.");
    if (!status.installed) throw new Error("Installierter Git-Stand unbekannt. Dashboard einmal mit dem aktuellen Installer aktualisieren.");
    if (!status.available || status.latest !== expectedCommit) throw new Error("Update-Stand geändert. Bitte erneut prüfen.");
    const script = join(this.root, "installer", "scripts", "update-dashboard-github.ps1");
    const { existsSync } = await import("node:fs");
    if (!existsSync(script)) throw new Error("Update-Skript fehlt in der Installation.");
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script,
      "-InstallRoot", this.root, "-ExpectedCommit", expectedCommit], {
      cwd: this.root, detached: true, stdio: "ignore", windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    await new Promise<void>((resolveSpawn, rejectSpawn) => {
      child.once("spawn", () => resolveSpawn());
      child.once("error", rejectSpawn);
    });
    child.unref();
  }
}
