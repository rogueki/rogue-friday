import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ApiError, validationFailed } from "../util/errors";
import { invokeCodingRunner, type RunnerInvoker } from "./coding-runs";

export const HERMES_SKILL_KEYS = ["AIRTABLE_API_KEY", "NOTION_API_KEY", "TENOR_API_KEY", "JINA_API_KEY"] as const;
export type HermesSkillKey = typeof HERMES_SKILL_KEYS[number];
export type CheckableHermesSkillKey = "AIRTABLE_API_KEY" | "NOTION_API_KEY";
export type HermesSkillKeyCheck = { key: CheckableHermesSkillKey; state: "verified" | "missing" | "rejected" | "permission-limited" | "unavailable"; checkedAt: string };
export interface HermesSkillKeysStatus { configured: Record<HermesSkillKey, boolean>; applied: boolean | null }
const unavailable = () => new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Hermes-Skill-Konten in Friday-Ubuntu sind nicht erreichbar." });

export class HermesSkillKeysService {
  constructor(private readonly dataDir: string, private readonly invoke: RunnerInvoker = invokeCodingRunner) {}

  private target(): { script: string; distro: string; user: string } {
    let root = resolve(this.dataDir);
    for (let depth = 0; depth < 5 && !existsSync(join(root, "config", "install-state.json")); depth += 1) root = resolve(root, "..");
    if (!existsSync(join(root, "config", "install-state.json"))) throw unavailable();
    let state: { distro_name?: string; linux_user?: string };
    try { state = JSON.parse(readFileSync(join(root, "config", "install-state.json"), "utf8")) as typeof state; }
    catch { throw unavailable(); }
    if (!state.distro_name || !state.linux_user || !/^[a-zA-Z0-9_.-]+$/.test(state.distro_name) || !/^[a-zA-Z0-9_-]+$/.test(state.linux_user)) throw unavailable();
    const match = root.match(/^([a-zA-Z]):\\(.*)$/);
    if (!match) throw unavailable();
    return { distro: state.distro_name, user: state.linux_user,
      script: `/mnt/${match[1]?.toLowerCase()}/${match[2]?.replaceAll("\\", "/")}/installer/wsl/configure_skill_keys.py` };
  }

  private async run(action: "status" | "update", input?: { key: HermesSkillKey; value: string }): Promise<HermesSkillKeysStatus> {
    const { script, distro, user } = this.target();
    let data: Record<string, unknown>;
    // A key update may spend up to 20 seconds restarting the Hermes gateway after the atomic write.
    try { data = await this.invoke(script, distro, user, [action], input ? JSON.stringify(input) : undefined, action === "update" ? 45000 : 20000); }
    catch { throw unavailable(); }
    const configured = data.configured;
    if (!configured || typeof configured !== "object" || Array.isArray(configured) ||
        !HERMES_SKILL_KEYS.every((key) => typeof (configured as Record<string, unknown>)[key] === "boolean") ||
        !(data.applied === null || typeof data.applied === "boolean")) throw unavailable();
    return { configured: configured as Record<HermesSkillKey, boolean>, applied: data.applied as boolean | null };
  }

  status(): Promise<HermesSkillKeysStatus> { return this.run("status"); }

  async check(key: string): Promise<HermesSkillKeyCheck> {
    if (key !== "AIRTABLE_API_KEY" && key !== "NOTION_API_KEY") throw validationFailed("Für diesen Anbieter ist keine Verbindungsprüfung verfügbar.");
    const { script, distro, user } = this.target();
    let data: Record<string, unknown>;
    try { data = await this.invoke(script, distro, user, ["check"], JSON.stringify({ key }), 12000); }
    catch { throw unavailable(); }
    if (data.key !== key || !["verified", "missing", "rejected", "permission-limited", "unavailable"].includes(String(data.state)) ||
        typeof data.checkedAt !== "string" || !Number.isFinite(Date.parse(data.checkedAt))) throw unavailable();
    return data as HermesSkillKeyCheck;
  }

  update(key: string, value: string): Promise<HermesSkillKeysStatus> {
    if (!HERMES_SKILL_KEYS.includes(key as HermesSkillKey) || typeof value !== "string" ||
        (value !== "" && (!/^[\x21-\x7e]{1,2048}$/.test(value) || /["'\\$`]/.test(value)))) {
      throw validationFailed("Ungültiger Hermes-Skill-Schlüssel.");
    }
    return this.run("update", { key: key as HermesSkillKey, value });
  }
}
