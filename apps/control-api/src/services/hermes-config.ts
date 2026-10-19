import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isIP } from "node:net";
import { ApiError, conflict, validationFailed } from "../util/errors";
import { invokeCodingRunner, type RunnerInvoker } from "./coding-runs";

export const HERMES_CONFIG_FIELDS = {
  "model.provider": { type: "string", kind: "provider", family: "models", consumer: "new Hermes provider route" },
  "model.default": { type: "string", kind: "model", family: "models", consumer: "new Hermes model request" },
  "agent.reasoning_effort": { type: "string", kind: "reasoning", family: "models", consumer: "new Hermes model request" },
  "fallback.min_switch_reset_seconds": { type: "integer", min: 0, max: 3600, family: "models", consumer: "next Hermes fallback decision" },
  fallback_model: { type: "fallback", family: "models", consumer: "new Hermes provider route" },
  "agent.auto_recovery_cycles": { type: "integer", min: 0, max: 20, family: "agent", consumer: "new Hermes API recovery loop" },
  "agent.run_budget_seconds": { type: "optionalInteger", min: 1, max: 86400, family: "agent", consumer: "new Hermes agent run" },
  "agent.budget_warning_ratio": { type: "optionalNumber", min: 0.01, max: 0.99, family: "agent", consumer: "new Hermes agent run" },
  "agent.agent_cache.max_size": { type: "integer", min: 1, max: 4096, family: "agent", consumer: "gateway agent cache" },
  max_concurrent_sessions: { type: "integer", min: 0, max: 10000, family: "agent", consumer: "gateway session admission" },
  context_file_max_chars: { type: "integer", min: 0, max: 1000000, family: "agent", consumer: "next context-file load" },
  "compression.enabled": { type: "boolean", family: "agent", consumer: "next Hermes compression check" },
  "compression.threshold": { type: "number", min: 0.1, max: 0.95, family: "agent", consumer: "next Hermes compression check" },
  "compression.target_ratio": { type: "number", min: 0.1, max: 0.8, family: "agent", consumer: "next Hermes compression check" },
  "compression.tail_mode": { type: "string", kind: "tailMode", family: "agent", consumer: "next Hermes compression" },
  "compression.protect_last_n": { type: "integer", min: 0, max: 100, family: "agent", consumer: "next Hermes compression" },
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
  "terminal.timeout": { type: "integer", min: 1, max: 3600, family: "execution", consumer: "new Hermes terminal environment" },
  "browser.command_timeout": { type: "integer", min: 5, max: 600, family: "execution", consumer: "new browser session or cleared browser cache" },
  "browser.snapshot_threshold": { type: "integer", min: 1000, max: 200000, family: "execution", consumer: "new browser session or cleared browser cache" },
  "skills.disabled": { type: "skillNames", family: "extensions", consumer: "next Hermes skill resolution" },
} as const;
export type HermesConfigField = keyof typeof HERMES_CONFIG_FIELDS;
type FallbackEntry = { provider: string; model: string };
export type HermesConfigPatch = { key: HermesConfigField; value: number | boolean | string | FallbackEntry[] | string[] | null };
export type HermesPluginPatch = { key: "plugin.activation"; pluginId: string; enabled: boolean };
export type HermesMcpPatch = { key: "mcp.httpServer"; name: string; url: string | null; enabled: boolean };
export const HERMES_MODEL_CREDENTIALS = ["OPENROUTER_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"] as const;
export type HermesModelCredential = typeof HERMES_MODEL_CREDENTIALS[number];
export type HermesModelCredentialPatch = { key: HermesModelCredential; value: string | null };

const REASONING_EFFORTS = new Set(["", "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);
function validStringPatch(kind: "provider" | "model" | "reasoning" | "tailMode", value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (kind === "reasoning") return REASONING_EFFORTS.has(value);
  if (kind === "tailMode") return value === "lean" || value === "legacy";
  if (kind === "provider") return /^[A-Za-z0-9_.-]{1,64}$/.test(value);
  return value.length > 0 && value.length <= 200 && !/\s/.test(value) &&
    [...value].every((character) => character.charCodeAt(0) > 31 && character.charCodeAt(0) !== 127);
}
function validFallback(value: unknown): value is FallbackEntry[] {
  return Array.isArray(value) && value.length <= 8 && value.every((entry) =>
    entry && typeof entry === "object" && Object.keys(entry).sort().join(",") === "model,provider" &&
    validStringPatch("provider", entry.provider) && validStringPatch("model", entry.model));
}
function validSkillNames(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 512 &&
    value.every((name) => typeof name === "string" && /^[A-Za-z0-9._/-]{1,100}$/.test(name)) &&
    new Set(value).size === value.length;
}
function validMcpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048 ||
      [...value].some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !!url.hostname && !url.username && !url.password &&
      !url.search && !url.hash && (!url.port || url.port === "443") &&
      /^[A-Za-z0-9.-]+$/.test(url.hostname) && url.hostname.includes(".") &&
      !url.hostname.endsWith(".local") && isIP(url.hostname) === 0;
  } catch {
    return false;
  }
}

interface BridgeStatus {
  installed: true;
  sourceRevision: string | null;
  revision: number;
  values: Record<HermesConfigField, number | boolean | string | FallbackEntry[] | string[] | null>;
  explicit: Record<HermesConfigField, boolean>;
  secrets: Record<"model.api_key" | HermesModelCredential, boolean>;
  families: Array<{ id: string; roots: string[]; followup: string; configFileSet: boolean }>;
  inventory: { scope: "profile"; skillsComplete: boolean; pluginsComplete: boolean; modelProvidersComplete: boolean; reasons: string[] };
  modelProviders: Array<{ id: string; configFileSet: boolean; authenticated: null; available: null }>;
  skills: Array<{ id: string; installed: true; enabled: boolean | null }>;
  plugins: Array<{ id: string; installed: true; enabled: boolean | null; configured: null }>;
  mcpComplete: boolean;
  mcpServers: Array<{ id: string; transport: "http" | "stdio" | "unknown"; enabled: boolean | null;
    endpoint: string | null; editable: boolean }>;
  write: { key: string; persisted: boolean } | null;
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
    action: "status" | "update" | "credential-update" | "plugin-activation" | "mcp-http",
    patch?: HermesConfigPatch | HermesModelCredentialPatch | HermesPluginPatch | HermesMcpPatch,
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
        patch ? JSON.stringify(action === "mcp-http"
          ? { name: (patch as HermesMcpPatch).name, url: (patch as HermesMcpPatch).url,
            enabled: (patch as HermesMcpPatch).enabled, revision }
          : action === "plugin-activation"
          ? { pluginId: (patch as HermesPluginPatch).pluginId, enabled: (patch as HermesPluginPatch).enabled, revision }
          : { ...patch, revision }) : undefined,
        action === "credential-update" || action === "plugin-activation" || action === "mcp-http" ? 60000 : 30000,
        150000,
      );
    } catch (error) {
      if (action === "status" && error instanceof Error && error.message.includes("hermes_not_installed"))
        return null;
      if (error instanceof Error && error.message.includes("revision_conflict"))
        throw conflict("Hermes-Konfiguration wurde außerhalb von Friday geändert.");
      if (action === "credential-update")
        throw new ApiError({ code: "ADAPTER_UNAVAILABLE",
          message: "Hermes-Schlüsselvorgang nicht bestätigt. Status neu laden; eine Wiederholung könnte den bereits gespeicherten Schlüssel überschreiben." });
      if (action === "plugin-activation")
        throw new ApiError({ code: "ADAPTER_UNAVAILABLE",
          message: "Hermes-Plugin-Aktivierung nicht bestätigt. Status neu laden, bevor sie erneut versucht wird." });
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
      typeof raw.inventory !== "object" || !raw.inventory ||
      !Array.isArray(raw.modelProviders) ||
      !Array.isArray(raw.skills) ||
      !Array.isArray(raw.plugins) || typeof raw.mcpComplete !== "boolean" || !Array.isArray(raw.mcpServers)
    )
      throw unavailable();
    const inventory = raw.inventory as Record<string, unknown>;
    if (inventory.scope !== "profile" || typeof inventory.skillsComplete !== "boolean" ||
      typeof inventory.pluginsComplete !== "boolean" || typeof inventory.modelProvidersComplete !== "boolean" ||
      !Array.isArray(inventory.reasons)) throw unavailable();
    for (const [key, spec] of Object.entries(HERMES_CONFIG_FIELDS)) {
      const value = (raw.values as Record<string, unknown>)[key];
      if (
        value !== null &&
        (spec.type === "integer" || spec.type === "optionalInteger" ? !Number.isSafeInteger(value) :
          spec.type === "number" || spec.type === "optionalNumber" ? typeof value !== "number" || !Number.isFinite(value) :
          spec.type === "boolean" ? typeof value !== "boolean" :
          spec.type === "fallback" ? !validFallback(value) :
          spec.type === "skillNames" ? !validSkillNames(value) : typeof value !== "string")
      )
        throw unavailable();
      if (typeof (raw.explicit as Record<string, unknown>)[key] !== "boolean") throw unavailable();
    }
    if (
      typeof raw.secrets !== "object" ||
      !raw.secrets ||
      !["model.api_key", ...HERMES_MODEL_CREDENTIALS].every((key) =>
        typeof (raw.secrets as Record<string, unknown>)[key] === "boolean")
    )
      throw unavailable();
    if (
      raw.sourceRevision !== null &&
      (typeof raw.sourceRevision !== "string" || !/^[0-9a-f]{40}$/.test(raw.sourceRevision))
    )
      throw unavailable();
    if (
      action !== "status" &&
      (!raw.write ||
        typeof raw.write !== "object" ||
        (raw.write as Record<string, unknown>).key !== (action === "plugin-activation"
          ? `plugin:${(patch as HermesPluginPatch).pluginId}` : action === "mcp-http"
          ? `mcp:${(patch as HermesMcpPatch).name}` : patch?.key) ||
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
          inventory: { scope: "profile" as const, skillsComplete: false, pluginsComplete: false,
            modelProvidersComplete: false, reasons: ["hermes_not_installed"] },
          modelProviders: [],
          skills: [],
          plugins: [],
          mcpComplete: false,
          mcpServers: [],
          write: null,
          checkedAt: new Date().toISOString(),
        };
  }

  async modelCatalog(providerId?: string) {
    if (providerId !== undefined && !/^[A-Za-z0-9_.-]{1,64}$/.test(providerId))
      throw validationFailed("Ungültige Hermes-Anbieterkennung.");
    const { script, distro, user } = this.target();
    let raw: Record<string, unknown>;
    try {
      raw = await this.invoke(script, distro, user, ["model-catalog"],
        JSON.stringify({ providerId: providerId ?? null }), 45000, 150000);
    } catch (error) {
      if (error instanceof Error && error.message.includes("unknown_provider"))
        throw validationFailed("Hermes bietet diesen Anbieter nicht an.");
      throw unavailable();
    }
    if (typeof raw.sourceRevision !== "string" || !/^d923a5eb[0-9a-f]{32}$/.test(raw.sourceRevision) ||
        !Array.isArray(raw.providers) || raw.providers.length > 200 ||
        !raw.providers.every((provider) => provider && typeof provider === "object" &&
          typeof (provider as Record<string, unknown>).id === "string" &&
          /^[A-Za-z0-9_.-]{1,64}$/.test((provider as Record<string, unknown>).id as string) &&
          typeof (provider as Record<string, unknown>).label === "string" &&
          ((provider as Record<string, unknown>).label as string).length <= 200)) throw unavailable();
    if (new Set(raw.providers.map((provider) => (provider as { id: string }).id)).size !== raw.providers.length)
      throw unavailable();
    const selected = raw.selected;
    if (selected !== null &&
        (!selected || typeof selected !== "object" ||
         (selected as Record<string, unknown>).id !== providerId ||
         !raw.providers.some((provider) => (provider as { id: string }).id === providerId) ||
         !Array.isArray((selected as Record<string, unknown>).models) ||
         ((selected as Record<string, unknown>).models as unknown[]).length > 1000 ||
         !((selected as Record<string, unknown>).models as unknown[]).every((model) =>
           typeof model === "string" && model.length >= 1 && model.length <= 200 && !/\s/.test(model)) ||
         !["curated", "endpoint_confirmed_picker"].includes(String((selected as Record<string, unknown>).origin)) ||
         !["unsupported", "succeeded", "failed"].includes(String((selected as Record<string, unknown>).probeStatus)) ||
         (selected as Record<string, unknown>).modelAccess !== null)) throw unavailable();
    if (providerId === undefined && selected !== null || providerId !== undefined && selected === null)
      throw unavailable();
    return {
      sourceRevision: raw.sourceRevision,
      checkedAt: new Date().toISOString(),
      providerListComplete: null,
      providers: raw.providers.map((provider) => ({
        id: (provider as { id: string }).id, label: (provider as { label: string }).label,
      })),
      selected: selected === null ? null : {
        id: providerId as string,
        models: (selected as { models: string[] }).models,
        origin: (selected as { origin: "curated" | "endpoint_confirmed_picker" }).origin,
        probeStatus: (selected as { probeStatus: "unsupported" | "succeeded" | "failed" }).probeStatus,
        modelAccess: null,
      },
    };
  }

  async update(patch: HermesConfigPatch, revision: number) {
    const spec = HERMES_CONFIG_FIELDS[patch.key];
    if (!spec) throw validationFailed("Hermes-Feld ist nicht freigegeben.");
    if (
      spec.type === "integer" || spec.type === "optionalInteger"
        ? spec.type === "optionalInteger" && patch.value === null ? false :
          !Number.isInteger(patch.value) ||
          (patch.value as number) < spec.min ||
          (patch.value as number) > spec.max
        : spec.type === "optionalNumber" && patch.value === null ? false :
          spec.type === "number" || spec.type === "optionalNumber" ? typeof patch.value !== "number" || !Number.isFinite(patch.value) ||
          patch.value < spec.min || patch.value > spec.max
        : spec.type === "boolean" ? typeof patch.value !== "boolean"
        : spec.type === "fallback" ? !validFallback(patch.value)
        : spec.type === "skillNames" ? !validSkillNames(patch.value)
        : !validStringPatch(spec.kind, patch.value)
    )
      throw validationFailed("Ungültiger Hermes-Konfigurationswert.");
    if (!Number.isSafeInteger(revision) || revision < 1)
      throw validationFailed("Ungültige Hermes-Konfigurationsversion.");
    const observed = await this.run("update", patch, revision);
    if (!observed) throw unavailable();
    return this.present(observed);
  }

  async updateCredential(patch: HermesModelCredentialPatch, revision: number) {
    if (!HERMES_MODEL_CREDENTIALS.includes(patch.key) ||
        !(patch.value === null || (typeof patch.value === "string" && patch.value.length >= 1 &&
          patch.value.length <= 4096 && /^[\x20-\x7e]+$/.test(patch.value))))
      throw validationFailed("Ungültiger Hermes-Modellanbieterschlüssel.");
    if (!Number.isSafeInteger(revision) || revision < 1)
      throw validationFailed("Ungültige Hermes-Konfigurationsversion.");
    const observed = await this.run("credential-update", patch, revision);
    if (!observed) throw unavailable();
    return this.present(observed);
  }

  async updatePlugin(patch: HermesPluginPatch, revision: number) {
    if (patch.key !== "plugin.activation" || !/^[A-Za-z0-9._/-]{1,100}$/.test(patch.pluginId) ||
        !patch.pluginId.split("/").every((part) => part !== "" && part !== "." && part !== "..") ||
        typeof patch.enabled !== "boolean" || !Number.isSafeInteger(revision) || revision < 1)
      throw validationFailed("Ungültige Hermes-Plugin-Aktivierung.");
    const observed = await this.run("plugin-activation", patch, revision);
    if (!observed) throw unavailable();
    return this.present(observed);
  }

  async updateMcp(patch: HermesMcpPatch, revision: number) {
    if (patch.key !== "mcp.httpServer" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(patch.name) ||
        typeof patch.enabled !== "boolean" || !Number.isSafeInteger(revision) || revision < 1 ||
        !(patch.url === null && patch.enabled === false || validMcpUrl(patch.url)))
      throw validationFailed("Ungueltiger Hermes-MCP-Server.");
    const observed = await this.run("mcp-http", patch, revision);
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
      secretStates: (["model.api_key", ...HERMES_MODEL_CREDENTIALS] as const).map((key) => ({
        key, configFileSet: observed.secrets[key], effectiveConfigured: null,
      })),
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
      inventory: { scope: "profile" as const, skillsComplete: observed.inventory.skillsComplete === true,
        pluginsComplete: observed.inventory.pluginsComplete === true,
        modelProvidersComplete: observed.inventory.modelProvidersComplete === true,
        reasons: observed.inventory.reasons.filter((reason) => typeof reason === "string") },
      modelProviders: observed.modelProviders.filter((provider) =>
        typeof provider.id === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(provider.id) &&
        typeof provider.configFileSet === "boolean").map((provider) => ({
        id: provider.id, configFileSet: provider.configFileSet, authenticated: null, available: null,
      })),
      skills: observed.skills
        .filter((skill) => typeof skill.id === "string" && (skill.enabled === null || typeof skill.enabled === "boolean"))
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
        .filter((plugin) => typeof plugin.id === "string" && (plugin.enabled === null || typeof plugin.enabled === "boolean"))
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
      mcpComplete: observed.mcpComplete,
      mcpServers: observed.mcpServers.filter((server) =>
        /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(server.id) &&
        ["http", "stdio", "unknown"].includes(server.transport) &&
        (server.enabled === null || typeof server.enabled === "boolean") &&
        (server.endpoint === null || typeof server.endpoint === "string") &&
        typeof server.editable === "boolean").map((server) => ({
        id: server.id, transport: server.transport, enabled: server.enabled,
        endpoint: server.endpoint, editable: server.editable,
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
