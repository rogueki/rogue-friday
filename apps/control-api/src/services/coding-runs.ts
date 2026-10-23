import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { FridayConfig } from "@friday/config";
import { ApiError, conflict, notFound, validationFailed } from "../util/errors";
import type { SkillsService } from "./skills";

const CLI_IDS = ["codex", "opencode", "claude-code"] as const;
type CodingCli = typeof CLI_IDS[number];
const RUN_ID = /^run_[a-f0-9]{32}$/;
const unavailable = (message: string) => new ApiError({ code: "ADAPTER_UNAVAILABLE", message });

function under(path: string, root: string): boolean {
  const remainder = relative(process.platform === "win32" ? root.toLowerCase() : root,
    process.platform === "win32" ? path.toLowerCase() : path);
  return remainder === "" || (remainder !== ".." && !remainder.startsWith(`..${sep}`) && !isAbsolute(remainder));
}

/** Resolve only a bundled script below Friday's trusted installation root. */
export function nativeRunnerScript(dataDir: string, filename: "coding_runner.py" | "powerpoint_runner.py" | "hermes_config_bridge.py" | "research_hermes_synthesis.py" | "hermes_cron_mutate.py",
  env: NodeJS.ProcessEnv = process.env): { root: string; script: string } {
  const atRoot = (root: string): { root: string; script: string } | null => {
    try {
      const canonicalRoot = realpathSync.native(root);
      const candidate = join(canonicalRoot, "installer", "wsl", filename);
      const script = realpathSync.native(candidate);
      if (under(script, join(canonicalRoot, "installer", "wsl")) && lstatSync(candidate).isFile()) return { root: canonicalRoot, script };
    } catch { /* Missing or escaping bundled script. */ }
    return null;
  };
  if (env.FRIDAY_INSTALL_ROOT !== undefined) {
    const configuredRoot = env.FRIDAY_INSTALL_ROOT;
    if (!configuredRoot || !isAbsolute(configuredRoot) || (process.platform !== "win32" && !configuredRoot.startsWith("/"))) {
      throw unavailable("FRIDAY_INSTALL_ROOT muss ein absoluter Installationspfad sein.");
    }
    const target = atRoot(configuredRoot);
    if (!target) throw unavailable("Der native Friday-Runner fehlt unter FRIDAY_INSTALL_ROOT.");
    return target;
  }
  let root = resolve(dataDir);
  for (let depth = 0; depth < 6; depth += 1) {
    const target = atRoot(root);
    if (target) return target;
    const parent = resolve(root, "..");
    if (parent === root) break;
    root = parent;
  }
  throw unavailable("Der native Friday-Runner fehlt im Installationsverzeichnis.");
}

export interface CodingRun {
  runId: string;
  status: string;
  requestedCli: CodingCli | null;
  requestedWorkdir: string | null;
  preflightVersion: string | null;
  /** True only after the fixed native CLI process was actually launched in requestedWorkdir. */
  executionVerified: boolean;
  output: string | null;
  error: string | null;
  updatedAt: number | null;
}

export interface CodingCliStatus {
  cli: CodingCli;
  installed: boolean;
  version: string | null;
  authState: "signed_in" | "signed_out" | "stored_credentials" | "unknown";
}

export type RunnerInvoker = (script: string, distro: string, user: string, args: string[], input?: string, timeoutMs?: number, maxOutputBytes?: number) => Promise<Record<string, unknown>>;

export function codingRunnerCommand(script: string, distro: string, user: string, args: string[], platform: NodeJS.Platform = process.platform) {
  return platform === "win32"
    ? { file: "wsl.exe", args: ["-d", distro, "-u", user, "--exec", "python3", script, ...args] }
    : { file: "python3", args: [script, ...args] };
}

/** One short runner operation. Jobs themselves live outside this request. */
export async function invokeCodingRunner(script: string, distro: string, user: string, args: string[], input?: string, timeoutMs = 20000, maxOutputBytes = 20000): Promise<Record<string, unknown>> {
  // 35 s was a guess that silently killed every long CLI call at the guard instead of at the CLI: skill reports,
  // catalogue commands and mutations pass 95-195 s and could never run (N-065). The cap only stops nonsense values.
  if (Buffer.byteLength(input ?? "", "utf8") > 64_000 || timeoutMs < 1 || timeoutMs > 300_000 || maxOutputBytes < 1 || maxOutputBytes > 5_500_000) throw new Error("runner_limits");
  return new Promise((resolveResult, reject) => {
    const command = codingRunnerCommand(script, distro, user, args);
    const child = spawn(command.file, command.args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"], shell: false });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; if (Buffer.byteLength(stdout, "utf8") > maxOutputBytes) child.kill(); });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; if (Buffer.byteLength(stderr, "utf8") > 2000) child.kill(); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      // A killed child produces no JSON, which used to surface as "invalid payload" and hid the real cause.
      if (timedOut) return reject(new Error("runner_timeout"));
      let parsed: unknown;
      try { parsed = JSON.parse(stdout.trim()); } catch { parsed = null; }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return reject(new Error(`runner_invalid:${code ?? "unknown"}`));
      if (code !== 0) return reject(new Error(`runner_${code}:${String((parsed as { error?: string }).error ?? "unknown")}`));
      resolveResult(parsed as Record<string, unknown>);
    });
    child.stdin.end(input ?? "");
  });
}

export class CodingRunsService {
  constructor(private readonly config: FridayConfig, private readonly skills: SkillsService, private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly invoke: RunnerInvoker = invokeCodingRunner) {}

  private install(): { script: string; distro: string; user: string; root: string } {
    if (process.platform !== "win32") return { ...nativeRunnerScript(this.config.paths.dataDir, "coding_runner.py", this.env), distro: "", user: "" };
    let root = resolve(this.config.paths.dataDir);
    for (let i = 0; i < 5 && !existsSync(join(root, "config", "install-state.json")); i += 1) root = resolve(root, "..");
    const file = join(root, "config", "install-state.json");
    if (!existsSync(file)) throw unavailable("Friday-Installationszustand für WSL fehlt.");
    let state: { distro_name?: string; linux_user?: string };
    try { state = JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, "")) as typeof state; } catch { throw unavailable("Friday-Installationszustand ist ungültig."); }
    if (!state.distro_name || !state.linux_user || !/^[a-zA-Z0-9_.-]+$/.test(state.distro_name) || !/^[a-zA-Z0-9_-]+$/.test(state.linux_user)) throw unavailable("WSL-Ziel ist nicht konfiguriert.");
    const match = root.match(/^([a-zA-Z]):\\(.*)$/);
    if (!match) throw unavailable("Installationspfad kann WSL nicht zugeordnet werden.");
    const script = `/mnt/${match[1]?.toLowerCase()}/${match[2]?.replaceAll("\\", "/")}/installer/wsl/coding_runner.py`;
    return { root, distro: state.distro_name, user: state.linux_user, script };
  }

  canonicalRepository(requestedPath: string): string {
    return this.repository(requestedPath, this.install().root);
  }

  async prepareVoiceRepository(requestedPath: string): Promise<string> {
    const canonical = this.canonicalRepository(requestedPath);
    // Reuse the runner's Linux-Git check without selecting a CLI or contacting a model.
    const checked = await this.call(["repository", canonical]);
    if (typeof checked.workdir !== "string" || !checked.workdir.startsWith("/")) throw unavailable("Linux konnte das Git-Repository nicht bestätigen.");
    return canonical;
  }

  private repository(requestedPath: string, installRoot: string): string {
    const linux = process.platform !== "win32";
    if (!isAbsolute(requestedPath) || (linux ? !requestedPath.startsWith("/") : !/^[a-zA-Z]:\\/.test(requestedPath)) || requestedPath.length > 1024) {
      throw validationFailed(linux ? "Wähle einen absoluten lokalen Linux-Pfad zu einem Git-Repository." : "Wähle einen absoluten lokalen Windows-Pfad zu einem Git-Repository.");
    }
    let canonical: string;
    try { canonical = realpathSync.native(requestedPath); } catch { throw validationFailed("Das ausgewählte Repository existiert nicht."); }
    const roots = [homedir(), installRoot, ...(this.env.FRIDAY_CODING_ROOTS ?? "").split(linux ? ":" : ";").filter(Boolean)]
      .filter((path) => isAbsolute(path) && (!linux || path.startsWith("/")))
      .map((path) => { try { return realpathSync.native(path); } catch { return ""; } });
    if (!roots.some((root) => root && under(canonical, root))) throw validationFailed("Das Repository liegt außerhalb der freigegebenen Coding-Verzeichnisse.");
    if (!existsSync(join(canonical, ".git"))) throw validationFailed("Der gewählte Ordner ist kein Git-Repository-Root.");
    return canonical;
  }

  private async call(args: string[], input?: string, timeoutMs?: number): Promise<Record<string, unknown>> {
    const { script, distro, user } = this.install();
    const runtime = process.platform === "win32" ? "Friday-Ubuntu" : "Linux";
    try { return await this.invoke(script, distro, user, args, input, timeoutMs); }
    catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("runner_3:")) throw validationFailed(`Das Repository ist für Linux-Git in ${runtime} nicht lesbar. Verwende einen normalen Git-Clone.`);
      if (message.includes("runner_4:")) throw unavailable(`Die ausgewählte native Coding-CLI ist in ${runtime} nicht ausführbar.`);
      if (message.includes("runner_5:")) throw notFound("Coding-Run");
      if (message.includes("runner_6:")) throw conflict("Idempotency-Key wurde für einen anderen Coding-Auftrag verwendet.");
      if (message.includes("runner_7:")) throw conflict("Es läuft bereits ein Coding-Auftrag. Warte oder stoppe ihn zuerst.");
      throw unavailable(`Der native Coding-Runner in ${runtime} ist nicht erreichbar.`);
    }
  }

  private map(payload: Record<string, unknown>): CodingRun {
    if (typeof payload.runId !== "string" || !RUN_ID.test(payload.runId) || typeof payload.status !== "string") throw unavailable("Coding-Runner lieferte keinen gültigen Run-Status.");
    const requestedCli = CLI_IDS.find((id) => id === payload.requestedCli) ?? null;
    return { runId: payload.runId, status: payload.status, requestedCli,
      requestedWorkdir: typeof payload.requestedWorkdir === "string" ? payload.requestedWorkdir : null,
      preflightVersion: typeof payload.preflightVersion === "string" ? payload.preflightVersion : null,
      executionVerified: payload.executionVerified === true,
      output: typeof payload.output === "string" ? payload.output.slice(-12000) : null,
      error: typeof payload.error === "string" ? payload.error.slice(0, 1000) : null,
      updatedAt: typeof payload.updatedAt === "number" ? payload.updatedAt : null };
  }

  async start(input: { cli: "auto" | CodingCli; repository: string; task: string }, idempotencyKey: string): Promise<CodingRun> {
    const task = input.task.trim();
    if (task.length < 10 || task.length > 4000 || task.startsWith("-")) throw validationFailed("Der Coding-Auftrag muss 10 bis 4000 Zeichen enthalten und mit Text beginnen.");
    if (!/^idem_[A-F0-9]{26}$/.test(idempotencyKey)) throw validationFailed("Coding-Run erfordert einen gültigen Idempotency-Key.");
    const install = this.install();
    const repository = this.repository(input.repository, install.root);
    const catalog = await this.skills.list();
    const candidates = input.cli === "auto" ? CLI_IDS : [input.cli];
    for (const cli of candidates) {
      if (!catalog.skills.some((skill) => skill.id === `hermes:${cli}` && skill.discovered === true && skill.enabled === true)) continue;
      try { await this.call(["probe", cli, repository]); }
      catch (error) { if (input.cli === "auto" && error instanceof ApiError && error.code === "ADAPTER_UNAVAILABLE") continue; throw error; }
      try {
        return this.map(await this.call(["start", cli, repository, idempotencyKey], task));
      } catch (error) {
        if (!(error instanceof ApiError && error.code === "ADAPTER_UNAVAILABLE")) throw error;
        const expectedId = `run_${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 32)}`;
        try { return await this.status(expectedId); } catch { throw error; }
      }
    }
    throw unavailable("Kein aktivierter, nativer Coding-CLI-Skill mit erreichbarem Repository gefunden.");
  }

  async status(runId: string): Promise<CodingRun> {
    if (!RUN_ID.test(runId)) throw validationFailed("Ungültige Run-ID.");
    return this.map(await this.call(["status", runId]));
  }

  async cliStatus(): Promise<CodingCliStatus[]> {
    const payload = await this.call(["cli-status"], undefined, 35000);
    if (!Array.isArray(payload.clis) || payload.clis.length !== CLI_IDS.length) throw unavailable("Coding-CLI-Status ist nicht verfügbar.");
    const validStates = ["signed_in", "signed_out", "stored_credentials", "unknown"];
    const statuses = payload.clis as CodingCliStatus[];
    if (!CLI_IDS.every((cli) => statuses.some((item) => item.cli === cli && typeof item.installed === "boolean" &&
      (item.version === null || (typeof item.version === "string" && /^\d+\.\d+\.\d+$/.test(item.version))) && validStates.includes(item.authState)))) {
      throw unavailable("Coding-CLI-Status ist ungültig.");
    }
    return CLI_IDS.map((cli) => {
      const item = statuses.find((entry) => entry.cli === cli)!;
      return { cli, installed: item.installed, version: item.version, authState: item.authState };
    });
  }

  async stop(runId: string): Promise<CodingRun> {
    if (!RUN_ID.test(runId)) throw validationFailed("Ungültige Run-ID.");
    return this.map(await this.call(["stop", runId]));
  }
}
