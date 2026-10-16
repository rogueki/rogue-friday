import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ApiError, conflict, validationFailed } from "../util/errors";
import { invokeCodingRunner, type RunnerInvoker } from "./coding-runs";

export interface WikiPathStatus {
  path: string;
  revision: number;
  configured: boolean;
  customized: boolean;
  readable: boolean;
  applied: boolean | null;
}

const unavailable = () => new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Hermes-Wiki in Friday-Ubuntu ist nicht erreichbar." });

export class WikiPathService {
  constructor(private readonly dataDir: string, private readonly invoke: RunnerInvoker = invokeCodingRunner) {}

  private target(): { script: string; distro: string; user: string } {
    let root = resolve(this.dataDir);
    for (let depth = 0; depth < 5 && !existsSync(join(root, "config", "install-state.json")); depth += 1) root = resolve(root, "..");
    if (!existsSync(join(root, "config", "install-state.json"))) throw unavailable();
    let state: { distro_name?: string; linux_user?: string };
    try { state = JSON.parse(readFileSync(join(root, "config", "install-state.json"), "utf8").replace(/^\uFEFF/, "")) as typeof state; }
    catch { throw unavailable(); }
    if (!state.distro_name || !state.linux_user || !/^[a-zA-Z0-9_.-]+$/.test(state.distro_name) || !/^[a-zA-Z0-9_-]+$/.test(state.linux_user)) throw unavailable();
    const match = root.match(/^([a-zA-Z]):\\(.*)$/);
    if (!match) throw unavailable();
    return { distro: state.distro_name, user: state.linux_user,
      script: `/mnt/${match[1]?.toLowerCase()}/${match[2]?.replaceAll("\\", "/")}/installer/wsl/configure_wiki_path.py` };
  }

  private async run(action: "status" | "update", input?: { path: string; revision: number }): Promise<WikiPathStatus> {
    const { script, distro, user } = this.target();
    let data: Record<string, unknown>;
    try { data = await this.invoke(script, distro, user, [action], input ? JSON.stringify(input) : undefined, action === "update" ? 45000 : 20000); }
    catch (error) {
      const message = String(error);
      if (message.includes("runner_3:")) throw conflict("Der Wiki-Pfad wurde inzwischen geändert. Bitte neu laden.");
      if (message.includes("runner_4:")) throw validationFailed("Der Wiki-Pfad ist in Friday-Ubuntu nicht lesbar.");
      throw unavailable();
    }
    if (typeof data.path !== "string" || !Number.isSafeInteger(data.revision) || typeof data.configured !== "boolean" ||
        typeof data.customized !== "boolean" || typeof data.readable !== "boolean" ||
        !(data.applied === null || typeof data.applied === "boolean")) throw unavailable();
    return data as unknown as WikiPathStatus;
  }

  status(): Promise<WikiPathStatus> { return this.run("status"); }

  update(path: string, revision: number): Promise<WikiPathStatus> {
    if (typeof path !== "string" || path.length > 1024 || (path && !path.startsWith("/")) || /[\r\n"'\\$`]/.test(path) || !Number.isSafeInteger(revision)) {
      throw validationFailed("Ungültiger lokaler Wiki-Pfad.");
    }
    return this.run("update", { path, revision });
  }
}
