import { spawn } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { ApiError } from "../util/errors";

export const LOCAL_RESEARCH_ENDPOINT = "http://127.0.0.1:43696/";
type HelperResult = { service: string; http: "ready" | "unavailable"; endpoint: string; image: string };
export type ResearchSetupState = {
  available: boolean;
  state: "ready" | "stopped" | "unavailable";
  endpoint: string;
  image: string | null;
  reason: string | null;
};
export type ResearchSetupRun = (mode: "status" | "install") => Promise<HelperResult>;
export type ResearchSetupProbe = (endpoint: string) => Promise<boolean>;

const localProbe: ResearchSetupProbe = async (endpoint) => {
  try {
    const response = await fetch(endpoint, {
      method: "GET",
      signal: AbortSignal.timeout(2_000),
      redirect: "error",
    });
    await response.body?.cancel();
    return response.status === 200 && String(response.headers.get("content-type")).startsWith("text/html");
  } catch {
    return false;
  }
};

function wslPath(path: string): string {
  const match = path.match(/^([A-Za-z]):\\(.*)$/);
  if (!match) throw new Error("windows_install_path_required");
  return `/mnt/${match[1]!.toLowerCase()}/${match[2]!.replaceAll("\\", "/")}`;
}

function target(dataDir: string): { distro: string; script: string } | null {
  if (process.platform !== "win32") return null;
  const root = resolve(dataDir, "..", "..");
  const statePath = join(root, "config", "install-state.json");
  const scriptPath = join(root, "installer", "wsl", "setup_searxng.sh");
  if (!existsSync(statePath) || !existsSync(scriptPath)) return null;
  const script = realpathSync.native(scriptPath);
  const scriptRoot = realpathSync.native(join(root, "installer", "wsl"));
  const outside = relative(scriptRoot.toLowerCase(), script.toLowerCase());
  if (
    outside === ".." ||
    outside.startsWith(`..${sep}`) ||
    isAbsolute(outside) ||
    !lstatSync(scriptPath).isFile()
  )
    throw new Error("research_setup_script_untrusted");
  const state = JSON.parse(readFileSync(statePath, "utf8").replace(/^\uFEFF/, "")) as {
    distro_name?: string;
  };
  if (!state.distro_name || !/^[A-Za-z0-9_.-]+$/.test(state.distro_name))
    throw new Error("research_setup_distro_invalid");
  return { distro: state.distro_name, script: wslPath(script) };
}

async function invoke(dataDir: string, mode: "status" | "install"): Promise<HelperResult> {
  const installation = target(dataDir);
  if (!installation) throw new Error("research_setup_not_installed");
  return new Promise((resolveResult, reject) => {
    const child = spawn(
      "wsl.exe",
      ["-d", installation.distro, "-u", "root", "--exec", "bash", installation.script, mode],
      { windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    let settled = false;
    const fail = (error: Error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };
    const timer = setTimeout(
      () => {
        child.kill();
        fail(new Error("research_setup_timeout"));
      },
      mode === "install" ? 300_000 : 10_000,
    );
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 4_000) child.kill();
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      if (stderr.length > 16_000) child.kill();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      fail(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      if (code !== 0)
        return fail(
          new Error(stderr.includes("install_in_progress") ? "research_setup_busy" : "research_setup_failed"),
        );
      let result: Partial<HelperResult> | null = null;
      try {
        result = JSON.parse(stdout.trim()) as Partial<HelperResult>;
      } catch {
        /* Invalid helper output. */
      }
      if (
        !result ||
        typeof result.service !== "string" ||
        !["ready", "unavailable"].includes(String(result.http)) ||
        result.endpoint !== LOCAL_RESEARCH_ENDPOINT ||
        typeof result.image !== "string"
      )
        return fail(new Error("research_setup_invalid_response"));
      settled = true;
      resolveResult(result as HelperResult);
    });
  });
}

export class ResearchSetupService {
  constructor(
    private readonly dataDir: string,
    private readonly runner: ResearchSetupRun = (mode) => invoke(dataDir, mode),
    private readonly probe: ResearchSetupProbe = localProbe,
  ) {}

  async status(): Promise<ResearchSetupState> {
    try {
      const result = await this.runner("status");
      const reachable =
        result.service === "active" && result.http === "ready" && (await this.probe(LOCAL_RESEARCH_ENDPOINT));
      return {
        available: true,
        state: reachable ? "ready" : "stopped",
        endpoint: LOCAL_RESEARCH_ENDPOINT,
        image: result.image,
        reason: reachable
          ? null
          : result.service === "active" && result.http === "ready"
            ? "WINDOWS_PORT_UNREACHABLE"
            : "SERVICE_NOT_READY",
      };
    } catch {
      return {
        available: false,
        state: "unavailable",
        endpoint: LOCAL_RESEARCH_ENDPOINT,
        image: null,
        reason: "WSL_SETUP_UNAVAILABLE",
      };
    }
  }

  async install(): Promise<ResearchSetupState> {
    let result: HelperResult;
    try {
      result = await this.runner("install");
    } catch (error) {
      const reason = error instanceof Error ? error.message : "research_setup_failed";
      throw new ApiError({
        code: "ADAPTER_UNAVAILABLE",
        message: `Lokaler Suchdienst konnte nicht eingerichtet werden (${reason}). Status pruefen und erneut versuchen.`,
      });
    }
    if (
      result.service !== "active" ||
      result.http !== "ready" ||
      result.endpoint !== LOCAL_RESEARCH_ENDPOINT ||
      !(await this.probe(LOCAL_RESEARCH_ENDPOINT))
    )
      throw new ApiError({
        code: "ADAPTER_UNAVAILABLE",
        message: "Lokaler Suchdienst ist nach der Einrichtung nicht erreichbar.",
      });
    return {
      available: true,
      state: "ready",
      endpoint: LOCAL_RESEARCH_ENDPOINT,
      image: result.image,
      reason: null,
    };
  }
}
