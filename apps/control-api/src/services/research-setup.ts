import { spawn } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { ApiError } from "../util/errors";

export const LOCAL_RESEARCH_ENDPOINT = "http://127.0.0.1:43696/";
export const PINNED_RESEARCH_IMAGE =
  "ghcr.io/searxng/searxng@sha256:5ed0323b5f5f8701264ef65e239a2bd83cb57098f2b971fa30bf79c06eeae271";
type HelperResult = {
  service: string;
  http: "ready" | "unavailable";
  endpoint: string;
  image: string;
  imageVerified: boolean;
};
export type ResearchSetupState = {
  available: boolean;
  state: "ready" | "stopped" | "unavailable";
  endpoint: string;
  image: string | null;
  reason: string | null;
};
export type ResearchSetupRun = (mode: "status" | "install") => Promise<HelperResult>;
export type ResearchSetupProbe = (endpoint: string) => Promise<boolean>;

export const localProbe: ResearchSetupProbe = async (endpoint) => {
  try {
    const response = await fetch(new URL("search?format=json", endpoint), {
      method: "GET",
      signal: AbortSignal.timeout(2_000),
      redirect: "error",
      headers: { Accept: "application/json" },
    });
    if (
      response.status !== 400 ||
      !String(response.headers.get("content-type")).startsWith("application/json")
    ) {
      await response.body?.cancel();
      return false;
    }
    const reader = response.body?.getReader();
    if (!reader) return false;
    const chunks: Buffer[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4_096) {
        await reader.cancel();
        return false;
      }
      chunks.push(Buffer.from(value));
    }
    const payload: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return (
      !!payload &&
      typeof payload === "object" &&
      !Array.isArray(payload) &&
      Object.keys(payload).length === 1 &&
      (payload as { error?: unknown }).error === "No query"
    );
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
        typeof result.image !== "string" ||
        typeof result.imageVerified !== "boolean"
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
      const pinned = result.imageVerified && result.image === PINNED_RESEARCH_IMAGE;
      const reachable =
        pinned &&
        result.service === "active" &&
        result.http === "ready" &&
        (await this.probe(LOCAL_RESEARCH_ENDPOINT));
      const reason = reachable
        ? null
        : result.service !== "active"
          ? "SERVICE_NOT_READY"
          : !pinned
            ? "WRONG_IMAGE"
            : result.http !== "ready"
              ? "JSON_UNAVAILABLE"
              : "WINDOWS_PORT_UNREACHABLE";
      return {
        available: true,
        state: reachable ? "ready" : "stopped",
        endpoint: LOCAL_RESEARCH_ENDPOINT,
        image: result.image,
        reason,
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
        message:
          reason === "research_setup_timeout"
            ? "Die Einrichtung hat das Zeitlimit erreicht; ein WSL-Kindprozess kann noch laufen. Status pruefen, bevor die Einrichtung erneut gestartet wird."
            : `Lokaler Suchdienst konnte nicht eingerichtet werden (${reason}). Status pruefen und erneut versuchen.`,
      });
    }
    if (
      result.service !== "active" ||
      result.http !== "ready" ||
      result.endpoint !== LOCAL_RESEARCH_ENDPOINT ||
      !result.imageVerified ||
      result.image !== PINNED_RESEARCH_IMAGE ||
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
