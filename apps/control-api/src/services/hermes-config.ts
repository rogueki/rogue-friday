import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ApiError, conflict, validationFailed } from "../util/errors";
import { invokeCodingRunner, type RunnerInvoker } from "./coding-runs";

export const HERMES_CONFIG_FIELDS = {
  "agent.max_turns": {
    type: "integer",
    min: 1,
    max: 100000,
    family: "agent",
    consumer: "new Hermes agent run",
  },
  "agent.gateway_timeout": {
    type: "integer",
    min: 60,
    max: 86400,
    family: "agent",
    consumer: "Hermes gateway idle policy",
  },
  "agent.api_max_retries": {
    type: "integer",
    min: 1,
    max: 10,
    family: "agent",
    consumer: "new Hermes agent run",
  },
  "session.terminal_continue": { type: "boolean", family: "agent", consumer: "new terminal session" },
  max_live_sessions: {
    type: "integer",
    min: 0,
    max: 10000,
    family: "agent",
    consumer: "Hermes gateway session cache",
  },
} as const;
export type HermesConfigField = keyof typeof HERMES_CONFIG_FIELDS;
export type HermesConfigPatch = { key: HermesConfigField; value: number | boolean };

interface BridgeStatus {
  installed: true;
  sourceRevision: string | null;
  revision: number;
  values: Record<HermesConfigField, number | boolean | null>;
  explicit: Record<HermesConfigField, boolean>;
  secrets: { "model.api_key": boolean };
  families: Array<{ id: string; roots: string[]; followup: string; configFileSet: boolean }>;
  skills: Array<{ id: string; installed: true; enabled: boolean }>;
  plugins: Array<{ id: string; installed: true; enabled: boolean; configured: null }>;
  write: { key: HermesConfigField; persisted: boolean } | null;
}

const unavailable = () =>
  new ApiError({
    code: "ADAPTER_UNAVAILABLE",
    message: "Hermes-Konfiguration in Friday-Ubuntu ist nicht erreichbar.",
  });

export class HermesConfigService {
  constructor(
    private readonly dataDir: string,
    private readonly invoke: RunnerInvoker = invokeCodingRunner,
  ) {}

  private target(): { script: string; distro: string; user: string } {
    let root = resolve(this.dataDir);
    for (let depth = 0; depth < 5 && !existsSync(join(root, "config", "install-state.json")); depth += 1)
      root = resolve(root, "..");
    if (!existsSync(join(root, "config", "install-state.json"))) throw unavailable();
    let state: { distro_name?: string; linux_user?: string };
    try {
      state = JSON.parse(
        readFileSync(join(root, "config", "install-state.json"), "utf8").replace(/^\uFEFF/, ""),
      ) as typeof state;
    } catch {
      throw unavailable();
    }
    if (
      !state.distro_name ||
      !state.linux_user ||
      !/^[a-zA-Z0-9_.-]+$/.test(state.distro_name) ||
      !/^[a-zA-Z0-9_-]+$/.test(state.linux_user)
    )
      throw unavailable();
    if (process.platform !== "win32")
      return {
        distro: state.distro_name,
        user: state.linux_user,
        script: join(root, "installer", "wsl", "hermes_config_bridge.py"),
      };
    const match = root.match(/^([a-zA-Z]):\\(.*)$/);
    if (!match) throw unavailable();
    return {
      distro: state.distro_name,
      user: state.linux_user,
      script: `/mnt/${match[1]?.toLowerCase()}/${match[2]?.replaceAll("\\", "/")}/installer/wsl/hermes_config_bridge.py`,
    };
  }

  private async run(
    action: "status" | "update",
    patch?: HermesConfigPatch,
    revision?: number,
  ): Promise<BridgeStatus | null> {
    const { script, distro, user } = this.target();
    let raw: Record<string, unknown>;
    try {
      raw = await this.invoke(
        script,
        distro,
        user,
        [action],
        patch ? JSON.stringify({ ...patch, revision }) : undefined,
        30000,
        150000,
      );
    } catch (error) {
      if (action === "status" && error instanceof Error && error.message.includes("hermes_not_installed"))
        return null;
      if (error instanceof Error && error.message.includes("revision_conflict"))
        throw conflict("Hermes-Konfiguration wurde außerhalb von Friday geändert.");
      throw unavailable();
    }
    if (
      raw.installed !== true ||
      !Number.isSafeInteger(raw.revision) ||
      typeof raw.values !== "object" ||
      !raw.values ||
      typeof raw.explicit !== "object" ||
      !raw.explicit ||
      !Array.isArray(raw.families) ||
      !Array.isArray(raw.skills) ||
      !Array.isArray(raw.plugins)
    )
      throw unavailable();
    for (const [key, spec] of Object.entries(HERMES_CONFIG_FIELDS)) {
      const value = (raw.values as Record<string, unknown>)[key];
      if (
        value !== null &&
        (spec.type === "integer" ? !Number.isSafeInteger(value) : typeof value !== "boolean")
      )
        throw unavailable();
      if (typeof (raw.explicit as Record<string, unknown>)[key] !== "boolean") throw unavailable();
    }
    if (
      typeof raw.secrets !== "object" ||
      !raw.secrets ||
      typeof (raw.secrets as Record<string, unknown>)["model.api_key"] !== "boolean"
    )
      throw unavailable();
    if (
      raw.sourceRevision !== null &&
      (typeof raw.sourceRevision !== "string" || !/^[0-9a-f]{40}$/.test(raw.sourceRevision))
    )
      throw unavailable();
    if (
      action === "update" &&
      (!raw.write ||
        typeof raw.write !== "object" ||
        (raw.write as Record<string, unknown>).key !== patch?.key ||
        typeof (raw.write as Record<string, unknown>).persisted !== "boolean")
    )
      throw unavailable();
    return raw as unknown as BridgeStatus;
  }

  async status() {
    const observed = await this.run("status");
    return observed
      ? this.present(observed)
      : {
          installed: false as const,
          sourceRevision: null,
          revision: null,
          fields: [],
          secretStates: [],
          families: [],
          skills: [],
          plugins: [],
          write: null,
          checkedAt: new Date().toISOString(),
        };
  }

  async update(patch: HermesConfigPatch, revision: number) {
    const spec = HERMES_CONFIG_FIELDS[patch.key];
    if (!spec) throw validationFailed("Hermes-Feld ist nicht freigegeben.");
    if (
      spec.type === "integer"
        ? !Number.isInteger(patch.value) ||
          (patch.value as number) < spec.min ||
          (patch.value as number) > spec.max
        : typeof patch.value !== "boolean"
    )
      throw validationFailed("Ungültiger Hermes-Konfigurationswert.");
    if (!Number.isSafeInteger(revision) || revision < 1)
      throw validationFailed("Ungültige Hermes-Konfigurationsversion.");
    const observed = await this.run("update", patch, revision);
    if (!observed) throw unavailable();
    return this.present(observed);
  }

  private present(observed: BridgeStatus) {
    const pinned = observed.sourceRevision?.startsWith("d923a5eb") === true;
    return {
      installed: true as const,
      sourceRevision: observed.sourceRevision,
      revision: observed.revision,
      fields: Object.entries(HERMES_CONFIG_FIELDS).map(([key, definition]) => ({
        key,
        type: definition.type,
        family: definition.family,
        consumer: definition.consumer,
        value: observed.values[key as HermesConfigField],
        explicit: observed.explicit[key as HermesConfigField],
        writable: pinned,
        verification: "unverified" as const,
        reasonCode: "runtime_receipt_unavailable" as const,
      })),
      secretStates: [
        { key: "model.api_key", configFileSet: observed.secrets["model.api_key"], effectiveConfigured: null },
      ],
      families: observed.families
        .filter(
          (family) =>
            typeof family.id === "string" &&
            typeof family.configFileSet === "boolean" &&
            Array.isArray(family.roots),
        )
        .map((family) => ({
          id: family.id,
          roots: family.roots.filter((root) => typeof root === "string"),
          followup: family.followup,
          installed: null,
          enabled: null,
          configFileSet: family.configFileSet,
          configured: null,
          available: null,
          authenticated: null,
          needsSetup: null,
          unsupported: null,
          coverage: "followup" as const,
        })),
      skills: observed.skills
        .filter((skill) => typeof skill.id === "string" && typeof skill.enabled === "boolean")
        .map((skill) => ({
          id: skill.id,
          installed: true as const,
          enabled: skill.enabled,
          configured: null,
          authenticated: null,
          available: null,
          needsSetup: null,
          unsupported: null,
        })),
      plugins: observed.plugins
        .filter((plugin) => typeof plugin.id === "string" && typeof plugin.enabled === "boolean")
        .map((plugin) => ({
          id: plugin.id,
          installed: true as const,
          enabled: plugin.enabled,
          configured: null,
          authenticated: null,
          available: null,
          needsSetup: null,
          unsupported: null,
        })),
      write: observed.write
        ? {
            key: observed.write.key,
            persisted: observed.write.persisted,
            applied: null,
            verification: "unverified" as const,
            reasonCode: observed.write.persisted ? "runtime_receipt_unavailable" : "readback_mismatch",
          }
        : null,
      checkedAt: new Date().toISOString(),
    };
  }
}
