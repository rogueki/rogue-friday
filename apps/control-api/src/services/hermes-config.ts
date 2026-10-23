import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isIP } from "node:net";
import type { HermesCronMutationReceipt, HermesCronMutationRequest } from "@friday/sdk";
import { ApiError, conflict, notFound, validationFailed } from "../util/errors";
import { invokeCodingRunner, nativeRunnerScript, type RunnerInvoker } from "./coding-runs";
import type { HermesInventoryEntry } from "./skills";

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
  "terminal.container_cpu": { type: "number", min: 0.01, max: 1024, family: "execution", consumer: "new container environment; Docker CPU enforcement depends on cgroups" },
  "terminal.container_memory": { type: "integer", min: 1, max: 1048576, family: "execution", consumer: "new container environment; Docker memory enforcement depends on cgroups" },
  "terminal.container_disk": { type: "integer", min: 1, max: 1048576, family: "execution", consumer: "new container environment; Docker disk quota depends on storage driver" },
  "terminal.container_persistent": { type: "boolean", family: "execution", consumer: "new Docker session scope and container lifetime" },
  "terminal.backend": { type: "string", kind: "executionBackend", family: "execution", consumer: "new Hermes terminal environment" },
  "terminal.cwd": { type: "string", kind: "workspacePath", family: "execution", consumer: "new Hermes terminal environment" },
  "terminal.docker_network": { type: "boolean", family: "execution", consumer: "new Docker sandbox" },
  "terminal.docker_mount_cwd_to_workspace": { type: "boolean", family: "execution", consumer: "new Docker sandbox" },
  "terminal.docker_volumes": { type: "textList", kind: "dockerMounts", family: "execution", consumer: "new Docker sandbox" },
  "browser.command_timeout": { type: "integer", min: 5, max: 600, family: "execution", consumer: "new browser session or cleared browser cache" },
  "browser.snapshot_threshold": { type: "integer", min: 1000, max: 200000, family: "execution", consumer: "new browser session or cleared browser cache" },
  "browser.inactivity_timeout": { type: "integer", min: 30, max: 3600, family: "execution", consumer: "new browser module session" },
  "browser.engine": { type: "string", kind: "browserEngine", family: "execution", consumer: "new local browser session" },
  "browser.headed": { type: "boolean", family: "execution", consumer: "new local Chromium window" },
  "browser.auto_local_for_private_urls": { type: "boolean", family: "execution", consumer: "next cloud-backend private URL route" },
  "browser.dialog_policy": { type: "string", kind: "dialogPolicy", family: "execution", consumer: "new CDP dialog supervisor" },
  "browser.dialog_timeout_s": { type: "integer", min: 1, max: 3600, family: "execution", consumer: "new CDP dialog supervisor" },
  "browser.allow_private_urls": { type: "boolean", family: "execution", consumer: "new Hermes browser navigation" },
  "browser.use_real_profile": { type: "boolean", family: "execution", consumer: "new browser profile snapshot" },
  "browser.real_profile_pin": { type: "string", kind: "profilePin", family: "execution", consumer: "new browser profile snapshot" },
  "browser.restrict_evaluate": { type: "boolean", family: "execution", consumer: "new browser console evaluation" },
  "browser.allow_unsafe_evaluate": { type: "boolean", family: "execution", consumer: "new browser console evaluation" },
  "code_execution.mode": { type: "string", kind: "codeMode", family: "execution", consumer: "new execute_code kernel" },
  "code_execution.kernel_idle_timeout": { type: "integer", min: 30, max: 86400, family: "execution", consumer: "new code-kernel idle sweep" },
  "code_execution.max_session_kernels": { type: "integer", min: 1, max: 32, family: "execution", consumer: "new code-kernel admission" },
  "computer_use.permission_mode": { type: "string", kind: "computerPermission", family: "execution", consumer: "new computer-use session" },
  "computer_use.capability_manifest": { type: "string", kind: "manifestPath", family: "execution", consumer: "new bounded computer-use session" },
  "computer_use.max_image_dimension": { type: "integer", min: 320, max: 4096, family: "execution", consumer: "new computer-use driver session" },
  "computer_use.ax_max_elements": { type: "integer", min: 50, max: 1000, family: "execution", consumer: "next computer-use accessibility capture" },
  "computer_use.capture_after_mode": { type: "string", kind: "captureAfterMode", family: "execution", consumer: "next computer-use action capture" },
  toolsets: { type: "textList", kind: "toolsetNames", family: "execution", consumer: "new Hermes tool surface" },
  command_allowlist: { type: "textList", kind: "allowlistSubset", family: "execution", consumer: "next dangerous-command approval check" },
  "approvals.mode": { type: "string", kind: "approvalMode", family: "execution", consumer: "next Hermes command approval" },
  "approvals.timeout": { type: "integer", min: 15, max: 600, family: "execution", consumer: "next Hermes approval wait" },
  "approvals.denial_breaker_threshold": { type: "integer", min: 0, max: 100000, family: "execution", consumer: "next smart-guardian denial sequence" },
  "approvals.deny": { type: "textList", kind: "denyGlobs", family: "execution", consumer: "next Hermes terminal command approval" },
  "approvals.destructive_slash_confirm": { type: "boolean", family: "execution", consumer: "next Hermes destructive slash command" },
  "approvals.mcp_reload_confirm": { type: "boolean", family: "execution", consumer: "next Hermes MCP reload command" },
  "approvals.single_query_mode": { type: "string", kind: "automaticApproval", family: "execution", consumer: "next flagged command in single-query mode" },
  "approvals.unattended_mode": { type: "string", kind: "automaticApproval", family: "execution", consumer: "next flagged command on a notifier-blind gateway platform" },
  "security.protected_instruction_files": { type: "boolean", family: "execution", consumer: "next protected instruction file write" },
  "skills.disabled": { type: "skillNames", family: "extensions", consumer: "next Hermes skill resolution" },
  "cron.catch_up_missed": { type: "boolean", family: "operations", consumer: "Hermes cron due scan" },
  "cron.allow_agent_scheduling": { type: "boolean", family: "operations", consumer: "Hermes cron toolset for new runs" },
  "cron.preflight": { type: "boolean", family: "operations", consumer: "Hermes cron pre-dispatch validation" },
  "cron.max_parallel_jobs": { type: "optionalInteger", min: 1, max: 64, family: "operations", consumer: "Hermes cron per-profile pool" },
  "cron.output_retention": { type: "integer", min: 0, max: 10000, family: "operations", consumer: "Hermes cron output pruning" },
  "cron.script_timeout_seconds": { type: "integer", min: 1, max: 86400, family: "operations", consumer: "new Hermes cron script runs" },
  "cron.session_db_timeout_seconds": { type: "integer", min: 0, max: 3600, family: "operations", consumer: "new Hermes cron session DB opens" },
  "cron.failure_repeat_alert_hours": { type: "integer", min: 0, max: 168, family: "operations", consumer: "Hermes cron failure incident notifier" },
  "cron.require_restart_safe_scope": { type: "boolean", family: "operations", consumer: "Hermes cron worker scope admission" },
  "gateway.loop_watchdog": { type: "boolean", family: "operations", consumer: "next Hermes gateway start" },
  "gateway.startup_watchdog": { type: "boolean", family: "operations", consumer: "next Hermes gateway process start" },
  "gateway.startup_watchdog_timeout_seconds": { type: "integer", min: 30, max: 3600, family: "operations", consumer: "next Hermes gateway process start" },
  "gateway.restart_loop_guard.max_restarts": { type: "integer", min: 0, max: 20, family: "operations", consumer: "next Hermes gateway restart" },
  "gateway.respawn_storm.max_starts": { type: "integer", min: 0, max: 100, family: "operations", consumer: "next Hermes gateway process start" },
  "gateway.signal_interrupt_grace_timeout": { type: "number", min: 0, max: 60, family: "operations", consumer: "next Hermes gateway signal drain" },
  "logging.level": { type: "string", kind: "logLevel", family: "operations", consumer: "Hermes setup_logging(): agent.log; new process required" },
  "logging.max_size_mb": { type: "integer", min: 1, max: 100, family: "operations", consumer: "Hermes setup_logging(): agent.log rotation; new process required" },
  "logging.backup_count": { type: "integer", min: 1, max: 50, family: "operations", consumer: "Hermes setup_logging(): agent.log rotation; new process required" },
} as const;
export type HermesConfigField = keyof typeof HERMES_CONFIG_FIELDS;
type FallbackEntry = { provider: string; model: string };
export type HermesConfigPatch = { key: HermesConfigField; value: number | boolean | string | FallbackEntry[] | string[] | null };
export type HermesPluginPatch = { key: "plugin.activation"; pluginId: string; enabled: boolean };
export type HermesMcpPatch = { key: "mcp.httpServer"; name: string; url: string | null; enabled: boolean };
export type HermesMcpActivationPatch = { key: "mcp.activation"; name: string; enabled: boolean };
export type HermesMcpBearerPatch = { key: "mcp.bearerCredential"; name: string; token: string | null };
export const HERMES_MODEL_CREDENTIALS = ["OPENROUTER_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"] as const;
export type HermesModelCredential = typeof HERMES_MODEL_CREDENTIALS[number];
export type HermesModelCredentialPatch = { key: HermesModelCredential; value: string | null };

const REASONING_EFFORTS = new Set(["", "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);
function printablePath(value: string): boolean {
  return value.length <= 512 && value.startsWith("/") && !/[\p{C}\p{Zl}\p{Zp}]/u.test(value);
}
function validStringPatch(kind: "provider" | "model" | "reasoning" | "tailMode" | "executionBackend" |
  "profilePin" | "codeMode" | "computerPermission" | "manifestPath" | "workspacePath" | "browserEngine" |
  "approvalMode" | "automaticApproval" | "logLevel" | "dialogPolicy" | "captureAfterMode", value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (kind === "reasoning") return REASONING_EFFORTS.has(value);
  if (kind === "tailMode") return value === "lean" || value === "legacy";
  if (kind === "executionBackend") return value === "local" || value === "docker";
  if (kind === "codeMode") return value === "project" || value === "strict";
  if (kind === "dialogPolicy") return value === "must_respond" || value === "auto_dismiss";
  if (kind === "browserEngine") return value === "auto" || value === "chrome" || value === "lightpanda";
  if (kind === "captureAfterMode") return value === "som" || value === "ax" || value === "vision";
  if (kind === "computerPermission") return value === "standard" || value === "bounded";
  if (kind === "approvalMode") return value === "manual" || value === "smart" || value === "off";
  if (kind === "automaticApproval") return value === "deny" || value === "approve";
  if (kind === "profilePin") return value === "" || /^(Default|Profile [0-9]{1,3})$/.test(value);
  if (kind === "manifestPath") return value === "" || printablePath(value);
  if (kind === "workspacePath") return value === "." || printablePath(value);
  if (kind === "logLevel") return value === "DEBUG" || value === "INFO" || value === "WARNING";
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
function validExecutionList(kind: "dockerMounts" | "toolsetNames" | "allowlistSubset" | "denyGlobs", value: unknown): value is string[] {
  const limit = kind === "dockerMounts" ? 8 : kind === "toolsetNames" ? 16 : 128;
  return Array.isArray(value) && value.length <= limit && value.every((item) =>
    typeof item === "string" && item.length >= 1 && item.length <= 512 &&
    (kind === "dockerMounts" || kind === "denyGlobs" ? !/[\p{C}\p{Zl}\p{Zp}]/u.test(item) :
      (kind === "allowlistSubset" ? /^[ -~]+$/ : /^[!-~]+$/).test(item))) &&
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
    endpoint: string | null; editable: boolean; authMode: "none" | "bearer" | "oauth" | "unknown";
    credentialConfigured: boolean | null }>;
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

  async mutateCron(request: HermesCronMutationRequest): Promise<HermesCronMutationReceipt> {
    nativeRunnerScript(this.dataDir, "hermes_cron_mutate.py");
    const { script, distro, user } = this.target();
    const cronScript = script.replace(/hermes_config_bridge\.py$/, "hermes_cron_mutate.py");
    if (cronScript === script) throw unavailable();
    let raw: Record<string, unknown>;
    try {
      raw = await this.invoke(cronScript, distro, user, ["mutate"], JSON.stringify(request), 15000, 20000);
    } catch {
      // A bridge timeout may follow a persisted native write. The staged journal keeps this action uncertain.
      throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Cron-Aenderung nicht bestaetigt; nativen Status neu laden." });
    }
    if (typeof raw.error === "string") {
      if (["store_revision_conflict", "profile_conflict", "timezone_conflict", "job_not_found"].includes(raw.error))
        throw conflict("Hermes-Zeitplan hat sich geaendert; Status neu laden.");
      if (raw.error === "invalid_request" || raw.error === "unsupported_profile")
        throw validationFailed("Hermes-Zeitplanaktion ist ungueltig.");
      throw unavailable();
    }
    if (Object.keys(raw).sort().join(",") !==
        "accepted,action,executionVerified,jobId,profile,profileTimezone,state,storeRevision" ||
        raw.action !== request.action || raw.profile !== request.profile ||
        raw.profileTimezone !== request.profileTimezone ||
        typeof raw.jobId !== "string" || !/^[0-9a-f]{12}$/.test(raw.jobId) ||
        (request.action !== "create" && raw.jobId !== request.jobId) ||
        typeof raw.storeRevision !== "string" || !/^[0-9a-f]{64}$/.test(raw.storeRevision) ||
        typeof raw.state !== "string" || raw.state.length > 40 ||
        raw.accepted !== true || raw.executionVerified !== false) throw unavailable();
    return raw as unknown as HermesCronMutationReceipt;
  }

  async cronJobs(): Promise<Record<string, unknown>> {
    const { script, distro, user } = this.target();
    const cronScript = script.replace(/hermes_config_bridge\.py$/, "hermes_cron_read.py");
    if (cronScript === script) throw unavailable();
    let raw: Record<string, unknown>;
    try {
      raw = await this.invoke(cronScript, distro, user, ["list"], undefined, 15000, 150000);
    } catch {
      throw unavailable();
    }
    if (Object.keys(raw).sort().join(",") !==
        "count,jobs,profile,profileTimezone,schedulerRunning,sourceRevision,storeRevision,truncated" ||
      raw.sourceRevision !== "d923a5eb487a17c0a68801bba9ef0f56c81040a8" ||
      typeof raw.profile !== "string" || raw.profile.length > 100 ||
      (raw.profileTimezone !== null && typeof raw.profileTimezone !== "string") ||
      typeof raw.storeRevision !== "string" || !/^[0-9a-f]{64}$/.test(raw.storeRevision) ||
      !Number.isSafeInteger(raw.count) || Number(raw.count) < 0 ||
      typeof raw.truncated !== "boolean" || raw.schedulerRunning !== null ||
      !Array.isArray(raw.jobs) || raw.jobs.length > 200 ||
      (raw.truncated !== (Number(raw.count) > 200)) ||
      raw.jobs.length !== Math.min(Number(raw.count), 200) ||
      raw.jobs.some((job) => !job || typeof job !== "object" || Array.isArray(job) ||
        Object.keys(job).sort().join(",") !==
          "enabled,id,lastRunAt,name,nextRunAt,schedule,state,timezone" ||
        typeof job.id !== "string" || typeof job.name !== "string" ||
        typeof job.schedule !== "string" || typeof job.enabled !== "boolean" ||
        typeof job.state !== "string" ||
        (job.timezone !== null && typeof job.timezone !== "string") ||
        (job.nextRunAt !== null && typeof job.nextRunAt !== "string") ||
        (job.lastRunAt !== null && typeof job.lastRunAt !== "string"))) throw unavailable();
    return raw;
  }

  async skillMarkdown(id: string) {
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(id))
      throw validationFailed("Ungueltige Skill-Kennung.");
    const { script, distro, user } = this.target();
    let raw: Record<string, unknown>;
    try {
      raw = await this.invoke(script, distro, user, ["skill-md"], JSON.stringify({ id }), 10000, 70000);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("skill_md_missing")) throw notFound("Skill-Datei", id);
      if (message.includes("skill_md_too_large"))
        throw validationFailed("Die SKILL.md ist groesser als 64 KiB und wird nicht angezeigt.");
      if (message.includes("invalid_skill_id")) throw validationFailed("Ungueltige Skill-Kennung.");
      throw unavailable();
    }
    if (raw.id !== id || typeof raw.content !== "string" || raw.content.length < 1 ||
        raw.content.length > 65536 || !Number.isInteger(raw.bytes) || (raw.bytes as number) < 1 ||
        (raw.bytes as number) > 65536) throw unavailable();
    // Raw text only: the UI must escape it, the bridge never renders HTML.
    return { id, content: raw.content, bytes: raw.bytes as number };
  }

  async hubSearch(query: string, source: string | undefined, limit: number) {
    const trimmed = query.trim();
    if (trimmed.length < 1 || trimmed.length > 120) throw validationFailed("Der Suchbegriff braucht 1 bis 120 Zeichen.");
    if (source !== undefined && !/^[a-z0-9][a-z0-9.-]{0,39}$/.test(source))
      throw validationFailed("Unbekannte Skill-Quelle.");
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw validationFailed("Limit muss zwischen 1 und 50 liegen.");
    const { script, distro, user } = this.target();
    let raw: Record<string, unknown>;
    try {
      raw = await this.invoke(script, distro, user, ["hub-search"],
        JSON.stringify({ query: trimmed, source: source ?? null, limit }), 65000, 262144);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("hub_search_timeout"))
        throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Die Skill-Registry hat nicht rechtzeitig geantwortet." });
      if (message.includes("hub_search_format"))
        throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Die Skill-Suche hat ein unbekanntes Format geliefert." });
      if (message.includes("invalid_request")) throw validationFailed("Ungueltige Suchanfrage.");
      throw unavailable();
    }
    if (raw.query !== trimmed || raw.source !== (source ?? null) || !Array.isArray(raw.results) ||
        raw.results.length > 50) throw unavailable();
    const results = raw.results.map((value) => {
      if (!value || typeof value !== "object") throw unavailable();
      const hit = value as Record<string, unknown>;
      if (typeof hit.identifier !== "string" || hit.identifier.length < 1 || hit.identifier.length > 300 ||
          typeof hit.name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(hit.name) ||
          typeof hit.source !== "string" || hit.source.length < 1 || hit.source.length > 40 ||
          typeof hit.trustLevel !== "string" || hit.trustLevel.length < 1 || hit.trustLevel.length > 40 ||
          typeof hit.description !== "string" || hit.description.length > 2000) throw unavailable();
      return { identifier: hit.identifier, name: hit.name, source: hit.source,
        trustLevel: hit.trustLevel, description: hit.description };
    });
    return { query: trimmed, source: source ?? "all", results, observedAt: new Date().toISOString() };
  }

  async modifiedSkills(): Promise<{ names: string[]; at: string }> {
    const { script, distro, user } = this.target();
    let raw: Record<string, unknown>;
    try {
      raw = await this.invoke(script, distro, user, ["modified-list"], undefined, 30000, 131072);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("modified_skills_format"))
        throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Die Liste lokal geaenderter Skills hat ein unbekanntes Format." });
      throw unavailable();
    }
    if (!Array.isArray(raw.names) || raw.names.length > 500) throw unavailable();
    const names = raw.names.map((value) => {
      if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(value)) throw unavailable();
      return value;
    });
    return { names, at: new Date().toISOString() };
  }

  async mutateSkill(action: "install" | "update" | "uninstall", name: string, identifier: string | undefined,
    force: boolean) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(name)) throw validationFailed("Ungueltiger Skill-Name.");
    if (action === "install") {
      if (typeof identifier !== "string" || identifier.length < 3 || identifier.length > 300 || /\s/.test(identifier))
        throw validationFailed("Zum Installieren wird eine Skill-Kennung gebraucht.");
    } else if (identifier !== undefined) {
      throw validationFailed("Eine Kennung ist nur beim Installieren erlaubt.");
    }
    const { script, distro, user } = this.target();
    let raw: Record<string, unknown>;
    try {
      raw = await this.invoke(script, distro, user, ["skill-mutate"],
        JSON.stringify({ action, name, identifier: identifier ?? null, force }), 195000, 262144);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("skill_mutation_timeout"))
        throw new ApiError({ code: "ADAPTER_UNAVAILABLE",
          message: "Die Skill-Aenderung hat nicht rechtzeitig geantwortet; der alte Stand wurde wiederhergestellt." });
      if (message.includes("skill_mutation_failed"))
        throw new ApiError({ code: "ADAPTER_UNAVAILABLE",
          message: "Die CLI hat die Skill-Aenderung nicht bestaetigt; der alte Stand wurde wiederhergestellt." });
      if (message.includes("invalid_request")) throw validationFailed("Ungueltige Skill-Aenderung.");
      throw unavailable();
    }
    if (raw.action !== action || raw.name !== name || typeof raw.installed !== "boolean" ||
        (raw.enabled !== null && typeof raw.enabled !== "boolean") ||
        (raw.snapshot !== null && (typeof raw.snapshot !== "string" || raw.snapshot.length > 200)) ||
        typeof raw.text !== "string" || raw.text.length > 4096 || !Number.isInteger(raw.bytes) ||
        (raw.bytes as number) < 0) throw unavailable();
    const expected = action !== "uninstall";
    if (raw.installed !== expected) throw unavailable();
    return { action, name, installed: raw.installed, enabled: raw.enabled as boolean | null,
      snapshot: raw.snapshot as string | null, text: raw.text, bytes: raw.bytes as number,
      observedAt: new Date().toISOString() };
  }

  async skillReport(action: "inspect" | "audit" | "diff", name: string) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(name)) throw validationFailed("Ungueltiger Skill-Name.");
    const { script, distro, user } = this.target();
    let raw: Record<string, unknown>;
    try {
      // inspect and audit resolve the name against the registries first (measured 37 s), diff answers locally.
      raw = await this.invoke(script, distro, user, ["skill-report"], JSON.stringify({ action, name }),
        action === "diff" ? 35000 : 95000, 262144);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes(`skill_${action}_timeout`))
        throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Der Skill-Bericht hat nicht rechtzeitig geantwortet." });
      if (message.includes("skill_report_empty"))
        throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Die CLI hat keinen Bericht geliefert." });
      if (message.includes("skill_report_format"))
        throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Der Skill-Bericht hat ein unbekanntes Format." });
      if (message.includes("invalid_request")) throw validationFailed("Ungueltiger Skill-Name.");
      throw unavailable();
    }
    if (raw.action !== action || raw.name !== name || typeof raw.text !== "string" || raw.text.length > 65536 ||
        raw.text.trim() === "" || !Number.isInteger(raw.bytes) || (raw.bytes as number) < 0 ||
        typeof raw.truncated !== "boolean") throw unavailable();
    return { action, name, text: raw.text, bytes: raw.bytes as number, truncated: raw.truncated,
      observedAt: new Date().toISOString() };
  }

  async skillInventory(): Promise<{ entries: HermesInventoryEntry[]; at: string }> {
    const { script, distro, user } = this.target();
    let raw: Record<string, unknown>;
    try {
      raw = await this.invoke(script, distro, user, ["skills-list"], undefined, 30000, 512000);
    } catch (error) {
      if (error instanceof Error && error.message.includes("skills_list_format"))
        throw new ApiError({ code: "ADAPTER_UNAVAILABLE",
          message: "Das Hermes-Skill-Inventar hat ein unbekanntes Format; Herkunft und Trust bleiben unbekannt." });
      throw unavailable();
    }
    if (!Number.isInteger(raw.count) || !Array.isArray(raw.skills) || raw.count !== raw.skills.length ||
        raw.skills.length > 2000) throw unavailable();
    const names = new Set<string>();
    const entries = raw.skills.map((value): HermesInventoryEntry => {
      if (!value || typeof value !== "object") throw unavailable();
      const entry = value as Record<string, unknown>;
      if (typeof entry.name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(entry.name) ||
          typeof entry.category !== "string" || entry.category.length > 64 ||
          !["builtin", "local", "hub"].includes(entry.origin as string) ||
          !["builtin", "local", "project"].includes(entry.trust as string) ||
          !["enabled", "disabled"].includes(entry.state as string) || names.has(entry.name)) throw unavailable();
      names.add(entry.name);
      return { name: entry.name, category: entry.category, origin: entry.origin as HermesInventoryEntry["origin"],
        trust: entry.trust as HermesInventoryEntry["trust"], state: entry.state as HermesInventoryEntry["state"] };
    });
    return { entries, at: new Date().toISOString() };
  }

  async access() {
    const { script, distro, user } = this.target();
    let raw: Record<string, unknown>;
    try {
      raw = await this.invoke(script, distro, user, ["auth-list"], undefined, 20000, 512000);
    } catch (error) {
      if (error instanceof Error && error.message.includes("auth_list_format"))
        throw new ApiError({ code: "ADAPTER_UNAVAILABLE",
          message: "Die Hermes-Zugaenge konnten nicht gelesen werden: die CLI-Ausgabe hat ein unbekanntes Format." });
      throw unavailable();
    }
    if (!Array.isArray(raw.providers) || raw.providers.length > 64) throw unavailable();
    const seen = new Set<string>();
    const providers = raw.providers.map((entry) => {
      const provider = entry as Record<string, unknown>;
      if (!provider || typeof provider !== "object" || typeof provider.provider !== "string" ||
          !/^[A-Za-z0-9_.-]{1,64}$/.test(provider.provider) || seen.has(provider.provider) ||
          !Array.isArray(provider.credentials) || provider.credentials.length < 1 ||
          provider.credentials.length > 100 || provider.count !== provider.credentials.length) throw unavailable();
      seen.add(provider.provider);
      const credentials = provider.credentials.map((item) => {
        const credential = item as Record<string, unknown>;
        if (!credential || typeof credential !== "object" || !Number.isInteger(credential.index) ||
            (credential.index as number) < 1 || typeof credential.label !== "string" ||
            credential.label.length < 1 || credential.label.length > 200 ||
            !["api_key", "oauth"].includes(String(credential.type)) ||
            typeof credential.source !== "string" || credential.source.length < 1 ||
            credential.source.length > 200 || typeof credential.active !== "boolean") throw unavailable();
        // A misbehaving CLI must not be able to smuggle a key through label or source.
        if (/(?:sk-|ghp_|xox[bp]-)[A-Za-z0-9_-]{8,}/.test(`${credential.label} ${credential.source}`))
          throw unavailable();
        return { index: credential.index as number, label: credential.label, type: credential.type as "api_key" | "oauth",
          source: credential.source, active: credential.active };
      });
      return { provider: provider.provider, count: credentials.length, credentials };
    });
    return { providers };
  }

  private target(): { script: string; distro: string; user: string } {
    if (process.platform !== "win32")
      return { script: nativeRunnerScript(this.dataDir, "hermes_config_bridge.py").script,
        distro: "", user: "" };
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
    const match = root.match(/^([a-zA-Z]):\\(.*)$/);
    if (!match) throw unavailable();
    return {
      distro: state.distro_name,
      user: state.linux_user,
      script: `/mnt/${match[1]?.toLowerCase()}/${match[2]?.replaceAll("\\", "/")}/installer/wsl/hermes_config_bridge.py`,
    };
  }

  private async run(
    action: "status" | "update" | "credential-update" | "plugin-activation" | "mcp-http" | "mcp-activation" | "mcp-bearer",
    patch?: HermesConfigPatch | HermesModelCredentialPatch | HermesPluginPatch | HermesMcpPatch | HermesMcpActivationPatch | HermesMcpBearerPatch,
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
        patch ? JSON.stringify(action === "mcp-bearer"
          ? { name: (patch as HermesMcpBearerPatch).name, token: (patch as HermesMcpBearerPatch).token, revision }
          : action === "mcp-activation"
          ? { name: (patch as HermesMcpActivationPatch).name,
            enabled: (patch as HermesMcpActivationPatch).enabled, revision }
          : action === "mcp-http"
          ? { name: (patch as HermesMcpPatch).name, url: (patch as HermesMcpPatch).url,
            enabled: (patch as HermesMcpPatch).enabled, revision }
          : action === "plugin-activation"
          ? { pluginId: (patch as HermesPluginPatch).pluginId, enabled: (patch as HermesPluginPatch).enabled, revision }
          : { ...patch, revision }) : undefined,
        action === "credential-update" || action === "plugin-activation" || action === "mcp-http" || action === "mcp-activation" || action === "mcp-bearer" ? 60000 : 30000,
        150000,
      );
    } catch (error) {
      if (action === "status" && error instanceof Error && error.message.includes("hermes_not_installed"))
        return null;
      if (error instanceof Error && error.message.includes("revision_conflict"))
        throw conflict("Hermes-Konfiguration wurde außerhalb von Friday geändert.");
      if (action === "update" && error instanceof Error) {
        if (error.message.includes("profile_snapshot_cleanup_failed"))
          throw new ApiError({ code: "ADAPTER_UNAVAILABLE",
            message: "Browserprofil-Zustimmung wurde geändert, aber der Hermes-Snapshot konnte nicht bestätigt entfernt werden. Status neu laden und den lokalen Profilordner prüfen." });
        if (error.message.includes("docker_unavailable"))
          throw validationFailed("Der Docker-Daemon ist in Friday-Ubuntu nicht erreichbar.");
        if (error.message.includes("execution_backend_required"))
          throw validationFailed("Docker-Optionen erfordern zuerst das Docker-Terminal-Backend.");
        if (error.message.includes("docker_policy_requires_safe_baseline"))
          throw validationFailed("Vor dem Docker-Wechsel Netzwerk deaktivieren und Host-Mounts entfernen; danach Berechtigungen einzeln einschalten.");
        if (error.message.includes("capability_manifest_required") || error.message.includes("invalid_capability_manifest"))
          throw validationFailed("Computer Use braucht ein vorhandenes Manifest im Hermes-Profil.");
        if (error.message.includes("profile_pin_required"))
          throw validationFailed("Vor dem echten Browserprofil muss dessen Verzeichnisname festgelegt bleiben.");
        if (error.message.includes("allowlist_addition_requires_native_approval"))
          throw validationFailed("Neue dauerhafte Befehlsfreigaben müssen über Hermes' Freigabedialog erfolgen.");
        if (["invalid_execution_workspace", "invalid_docker_mount", "conflicting_browser_evaluate_policy", "unknown_toolset"]
          .some((code) => error.message.includes(code)))
          throw validationFailed("Hermes-Ausführungsrichtlinie ist für diese Installation ungültig.");
      }
      if (action === "mcp-activation" && error instanceof Error && error.message.includes("managed_entry_conflict"))
        throw conflict("Nur HTTPS-MCP-Eintraege ohne Zugangsdaten sind hier schaltbar.");
      if (action === "mcp-bearer" && error instanceof Error &&
          (error.message.includes("managed_entry_conflict") || error.message.includes("credential_name_conflict")))
        throw conflict("MCP-Zugangsdaten gehoeren nicht eindeutig zu diesem verwalteten HTTPS-Server.");
      if (action === "mcp-bearer")
        throw new ApiError({ code: "ADAPTER_UNAVAILABLE",
          message: "Hermes-MCP-Schluesselvorgang nicht bestaetigt. Status neu laden, bevor er wiederholt wird." });
      if (action === "credential-update")
        throw new ApiError({ code: "ADAPTER_UNAVAILABLE",
          message: "Hermes-Schlüsselvorgang nicht bestätigt. Status neu laden; eine Wiederholung könnte den bereits gespeicherten Schlüssel überschreiben." });
      if (action === "plugin-activation")
        throw new ApiError({ code: "ADAPTER_UNAVAILABLE",
          message: "Hermes-Plugin-Aktivierung nicht bestätigt. Status neu laden, bevor sie erneut versucht wird." });
      if (action === "mcp-activation")
        throw new ApiError({ code: "ADAPTER_UNAVAILABLE",
          message: "Hermes-MCP-Aktivierung nicht bestaetigt. Status neu laden, bevor sie erneut versucht wird." });
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
          spec.type === "skillNames" ? !validSkillNames(value) :
          spec.type === "textList" ? !validExecutionList(spec.kind, value) : typeof value !== "string")
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
          ? `plugin:${(patch as HermesPluginPatch).pluginId}` : action === "mcp-http" || action === "mcp-activation" || action === "mcp-bearer"
          ? `mcp:${(patch as HermesMcpPatch | HermesMcpActivationPatch | HermesMcpBearerPatch).name}` : patch?.key) ||
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
        : spec.type === "textList" ? !validExecutionList(spec.kind, patch.value)
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

  async activateMcp(patch: HermesMcpActivationPatch, revision: number) {
    if (patch.key !== "mcp.activation" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(patch.name) ||
        typeof patch.enabled !== "boolean" || !Number.isSafeInteger(revision) || revision < 1)
      throw validationFailed("Ungueltige Hermes-MCP-Aktivierung.");
    const observed = await this.run("mcp-activation", patch, revision);
    if (!observed) throw unavailable();
    return this.present(observed);
  }

  async updateMcpBearer(patch: HermesMcpBearerPatch, revision: number) {
    if (patch.key !== "mcp.bearerCredential" || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(patch.name) ||
        !(patch.token === null || typeof patch.token === "string" && patch.token.length >= 1 &&
          patch.token.length <= 4096 && /^[\x21-\x7e]+$/.test(patch.token)) ||
        !Number.isSafeInteger(revision) || revision < 1)
      throw validationFailed("Ungueltige Hermes-MCP-Zugangsdaten.");
    const observed = await this.run("mcp-bearer", patch, revision);
    if (!observed) throw unavailable();
    return this.present(observed);
  }

  async probeMcp(name: string, revision: number) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name) || !Number.isSafeInteger(revision) || revision < 1)
      throw validationFailed("Ungueltige Hermes-MCP-Probe.");
    const { script, distro, user } = this.target();
    let raw: Record<string, unknown>;
    try {
      raw = await this.invoke(script, distro, user, ["mcp-probe"], JSON.stringify({ name, revision }), 30000, 4096);
    } catch (error) {
      if (error instanceof Error && error.message.includes("revision_conflict"))
        throw conflict("Hermes-Konfiguration wurde waehrend der Probe geaendert.");
      if (error instanceof Error && error.message.includes("unprobeable_server"))
        throw validationFailed("Nur aktivierte verwaltete HTTPS-MCP-Eintraege ohne Auth oder mit hinterlegtem Bearer-Schluessel sind pruefbar.");
      throw unavailable();
    }
    const failures = ["auth_required", "config_invalid", "connect_failed", "protocol_failed",
      "protocol_unsupported", "redirect_rejected", "private_or_unresolved_address"];
    if (raw.name !== name || raw.revision !== revision || typeof raw.connected !== "boolean" ||
        typeof raw.toolCountComplete !== "boolean" ||
        !(raw.connected ? Number.isSafeInteger(raw.toolCount) && (raw.toolCount as number) >= 0 &&
          (raw.toolCount as number) <= 10000 && raw.failureClass === null :
          raw.toolCount === null && raw.toolCountComplete === false && failures.includes(String(raw.failureClass))))
      throw unavailable();
    return { name, revision, checkedAt: new Date().toISOString(), connected: raw.connected,
      toolCount: raw.toolCount, toolCountComplete: raw.toolCountComplete,
      failureClass: raw.failureClass, runtimeApplied: null };
  }

  async testApproval(command: string, revision: number) {
    if (typeof command !== "string" || !command.trim() || command.length > 512 ||
        [...command].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) ||
        !Number.isSafeInteger(revision) || revision < 1)
      throw validationFailed("Ungueltige Hermes-Freigabevorschau.");
    const { script, distro, user } = this.target();
    let raw: Record<string, unknown>;
    try {
      raw = await this.invoke(script, distro, user, ["approval-test"],
        JSON.stringify({ command, revision }), 30000, 4096);
    } catch (error) {
      if (error instanceof Error && error.message.includes("revision_conflict"))
        throw conflict("Hermes-Konfiguration wurde waehrend der Vorschau geaendert.");
      if (error instanceof Error && error.message.includes("unsupported_execution_backend"))
        throw validationFailed("Hermes-Freigabevorschau ist nur fuer lokale oder Docker-Terminals verfuegbar.");
      throw unavailable();
    }
    const verdicts = ["allow", "ask-approval", "hardline-deny", "user-deny"];
    if (raw.revision !== revision || (raw.backend !== "local" && raw.backend !== "docker") ||
        !verdicts.includes(String(raw.verdict)) ||
        !(raw.rule === null || typeof raw.rule === "string" && raw.rule.length <= 512) ||
        typeof raw.detail !== "string" || raw.detail.length > 1024)
      throw unavailable();
    return { revision, checkedAt: new Date().toISOString(), backend: raw.backend,
      verdict: raw.verdict, rule: raw.rule, detail: raw.detail, runtimeApplied: null };
  }

  async manageMcpOAuth(body: { action: "start"; name: string } | { action: "status" | "cancel"; flowId: string }, revision: number,
    ownerId: string) {
    if (!Number.isSafeInteger(revision) || revision < 1 ||
        typeof ownerId !== "string" || ownerId.length < 1 || ownerId.length > 128 ||
        [...ownerId].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) ||
        (body.action === "start" ? !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(body.name) :
          !/^[0-9a-f]{32}$/.test(body.flowId)))
      throw validationFailed("Ungueltiger Hermes-MCP-OAuth-Vorgang.");
    const { script, distro, user } = this.target();
    let raw: Record<string, unknown>;
    try {
      raw = await this.invoke(script, distro, user, [`mcp-oauth-${body.action}`], JSON.stringify(
        body.action === "start" ? { name: body.name, revision, ownerId } : { flowId: body.flowId, ownerId }), 30000, 10000);
    } catch (error) {
      if (error instanceof Error && error.message.includes("revision_conflict"))
        throw conflict("Hermes-Konfiguration wurde vor dem OAuth-Start geaendert.");
      if (error instanceof Error && error.message.includes("managed_entry_conflict"))
        throw conflict("Nur aktive verwaltete HTTPS-MCP-Server ohne vorhandene Authentifizierung koennen OAuth starten.");
      throw unavailable();
    }
    if (!/^[0-9a-f]{32}$/.test(String(raw.flowId)) ||
        body.action !== "start" && raw.flowId !== body.flowId ||
        !["starting", "awaiting_approval", "publishing", "cancelling", "configured", "failed"].includes(String(raw.status)) ||
        !(raw.authorizationUrl === undefined || typeof raw.authorizationUrl === "string" &&
          raw.authorizationUrl.length <= 8192 && raw.authorizationUrl.startsWith("https://")) ||
        !(raw.revision === undefined || Number.isSafeInteger(raw.revision) && (raw.revision as number) >= 1) ||
        !(raw.failureClass === undefined || typeof raw.failureClass === "string" && raw.failureClass.length <= 80))
      throw unavailable();
    return { flowId: raw.flowId as string, status: raw.status as
      "starting" | "awaiting_approval" | "publishing" | "cancelling" | "configured" | "failed",
      authorizationUrl: typeof raw.authorizationUrl === "string" ? raw.authorizationUrl : null,
      revision: typeof raw.revision === "number" ? raw.revision : null,
      failureClass: typeof raw.failureClass === "string" ? raw.failureClass : null,
      runtimeApplied: null };
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
        typeof server.editable === "boolean" &&
        ["none", "bearer", "oauth", "unknown"].includes(server.authMode) &&
        (server.credentialConfigured === null || typeof server.credentialConfigured === "boolean")).map((server) => ({
        id: server.id, transport: server.transport, enabled: server.enabled,
        endpoint: server.endpoint, editable: server.editable, authMode: server.authMode,
        credentialConfigured: server.credentialConfigured,
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
