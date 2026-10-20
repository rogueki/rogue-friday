import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HermesConfigService } from "../src/services/hermes-config";
import type { RunnerInvoker } from "../src/services/coding-runs";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(invoke: RunnerInvoker) {
  const root = mkdtempSync(join(tmpdir(), "friday-hermes-config-"));
  roots.push(root);
  mkdirSync(join(root, "config"));
  writeFileSync(
    join(root, "config", "install-state.json"),
    JSON.stringify({ distro_name: "Friday-Ubuntu", linux_user: "friday" }),
  );
  return new HermesConfigService(join(root, "data"), invoke);
}

const bridge = {
  installed: true,
  sourceRevision: "d923a5eb487a17c0a68801bba9ef0f56c81040a8",
  revision: 123,
  values: {
    "model.provider": "openrouter",
    "model.default": "example/model",
    "agent.reasoning_effort": "medium",
    "fallback.min_switch_reset_seconds": 0,
    fallback_model: [],
    "agent.auto_recovery_cycles": 5,
    "agent.run_budget_seconds": null,
    "agent.budget_warning_ratio": null,
    "agent.agent_cache.max_size": 128,
    max_concurrent_sessions: null,
    context_file_max_chars: null,
    "compression.enabled": true,
    "compression.threshold": 0.5,
    "compression.target_ratio": 0.2,
    "compression.tail_mode": "lean",
    "compression.protect_last_n": 20,
    "agent.max_turns": 500,
    "agent.gateway_timeout": 1800,
    "agent.api_max_retries": 3,
    "session.terminal_continue": true,
    max_live_sessions: 16,
    "terminal.timeout": 180,
    "terminal.backend": "local",
    "terminal.cwd": ".",
    "terminal.docker_network": true,
    "terminal.docker_mount_cwd_to_workspace": false,
    "terminal.docker_volumes": [],
    "browser.command_timeout": 30,
    "browser.snapshot_threshold": 15000,
    "browser.allow_private_urls": false,
    "browser.use_real_profile": false,
    "browser.real_profile_pin": "",
    "browser.restrict_evaluate": false,
    "browser.allow_unsafe_evaluate": false,
    "code_execution.mode": "project",
    "computer_use.permission_mode": "standard",
    "computer_use.capability_manifest": "",
    toolsets: ["hermes-cli"],
    command_allowlist: [],
    "approvals.mode": "smart",
    "approvals.timeout": 300,
    "approvals.single_query_mode": "deny",
    "approvals.unattended_mode": "deny",
    "security.protected_instruction_files": true,
    "skills.disabled": [],
    "cron.catch_up_missed": true,
    "cron.allow_agent_scheduling": false,
    "cron.preflight": true,
    "cron.max_parallel_jobs": null,
    "cron.output_retention": 50,
    "cron.script_timeout_seconds": 3600,
    "cron.session_db_timeout_seconds": 10,
    "cron.failure_repeat_alert_hours": 6,
    "cron.require_restart_safe_scope": false,
    "gateway.loop_watchdog": true,
    "gateway.startup_watchdog": true,
    "gateway.startup_watchdog_timeout_seconds": 300,
    "gateway.restart_loop_guard.max_restarts": 3,
    "gateway.respawn_storm.max_starts": 5,
    "gateway.signal_interrupt_grace_timeout": 1,
    "logging.level": "INFO",
    "logging.max_size_mb": 5,
    "logging.backup_count": 3,
  },
  explicit: {
    "model.provider": true,
    "model.default": true,
    "agent.reasoning_effort": false,
    "fallback.min_switch_reset_seconds": false,
    fallback_model: false,
    "agent.auto_recovery_cycles": false,
    "agent.run_budget_seconds": false,
    "agent.budget_warning_ratio": false,
    "agent.agent_cache.max_size": false,
    max_concurrent_sessions: false,
    context_file_max_chars: false,
    "compression.enabled": false,
    "compression.threshold": false,
    "compression.target_ratio": false,
    "compression.tail_mode": false,
    "compression.protect_last_n": false,
    "agent.max_turns": true,
    "agent.gateway_timeout": false,
    "agent.api_max_retries": false,
    "session.terminal_continue": false,
    max_live_sessions: false,
    "terminal.timeout": false,
    "terminal.backend": false,
    "terminal.cwd": false,
    "terminal.docker_network": false,
    "terminal.docker_mount_cwd_to_workspace": false,
    "terminal.docker_volumes": false,
    "browser.command_timeout": false,
    "browser.snapshot_threshold": false,
    "browser.allow_private_urls": false,
    "browser.use_real_profile": false,
    "browser.real_profile_pin": false,
    "browser.restrict_evaluate": false,
    "browser.allow_unsafe_evaluate": false,
    "code_execution.mode": false,
    "computer_use.permission_mode": false,
    "computer_use.capability_manifest": false,
    toolsets: false,
    command_allowlist: false,
    "approvals.mode": false,
    "approvals.timeout": false,
    "approvals.single_query_mode": false,
    "approvals.unattended_mode": false,
    "security.protected_instruction_files": false,
    "skills.disabled": false,
    "cron.catch_up_missed": false,
    "cron.allow_agent_scheduling": false,
    "cron.preflight": false,
    "cron.max_parallel_jobs": false,
    "cron.output_retention": false,
    "cron.script_timeout_seconds": false,
    "cron.session_db_timeout_seconds": false,
    "cron.failure_repeat_alert_hours": false,
    "cron.require_restart_safe_scope": false,
    "gateway.loop_watchdog": false,
    "gateway.startup_watchdog": false,
    "gateway.startup_watchdog_timeout_seconds": false,
    "gateway.restart_loop_guard.max_restarts": false,
    "gateway.respawn_storm.max_starts": false,
    "gateway.signal_interrupt_grace_timeout": false,
    "logging.level": false,
    "logging.max_size_mb": false,
    "logging.backup_count": false,
  },
  secrets: { "model.api_key": true, OPENROUTER_API_KEY: true, OPENAI_API_KEY: false,
    ANTHROPIC_API_KEY: false, rawCredential: "CANARY-DO-NOT-RETURN" },
  families: [
    {
      id: "agent",
      roots: ["agent"],
      followup: "P7-C",
      configFileSet: true,
      unexpected: "CANARY-DO-NOT-RETURN",
    },
  ],
  inventory: { scope: "profile", skillsComplete: true, pluginsComplete: true, modelProvidersComplete: true, reasons: [] },
  modelProviders: [{ id: "openrouter", configFileSet: true, authenticated: null, available: null }],
  skills: [{ id: "hermes-agent", installed: true, enabled: true, unexpected: "CANARY-DO-NOT-RETURN" }],
  plugins: [
    { id: "kanban", installed: true, enabled: false, configured: null, unexpected: "CANARY-DO-NOT-RETURN" },
  ],
  mcpComplete: true,
  mcpServers: [],
  write: null,
};

it("returns only allowlisted resolved values and installed manifests without credential leakage", async () => {
  const invoke = vi.fn(async () => bridge) as unknown as RunnerInvoker;
  const status = await fixture(invoke).status();
  expect(status.fields).toHaveLength(63);
  expect(status.fields.find((field) => field.key === "terminal.timeout")).toMatchObject({
    value: 180, family: "execution", verification: "unverified",
  });
  expect(status.fields.find((field) => field.key === "skills.disabled")).toMatchObject({
    value: [], family: "extensions", verification: "unverified",
  });
  expect(status.fields.find((field) => field.key === "agent.max_turns")).toMatchObject({
    value: 500,
    writable: true,
    verification: "unverified",
  });
  expect(status.skills).toEqual([
    {
      id: "hermes-agent",
      installed: true,
      enabled: true,
      configured: null,
      authenticated: null,
      available: null,
      needsSetup: null,
      unsupported: null,
    },
  ]);
  expect(JSON.stringify(status)).not.toContain("CANARY-DO-NOT-RETURN");
  expect(invoke).toHaveBeenCalledWith(
    expect.stringContaining("hermes_config_bridge.py"),
    "Friday-Ubuntu",
    "friday",
    ["status"],
    undefined,
    30000,
    150000,
  );
});

it("passes one typed field and If-Match revision, then reports persisted without inventing runtime ACK", async () => {
  const invoke = vi.fn(async () => ({
    ...bridge,
    revision: 124,
    values: { ...bridge.values, "agent.max_turns": 600 },
    write: { key: "agent.max_turns", persisted: true },
  })) as unknown as RunnerInvoker;
  const service = fixture(invoke);
  const status = await service.update({ key: "agent.max_turns", value: 600 }, 123);
  expect(status.write).toMatchObject({ persisted: true, applied: null, verification: "unverified" });
  expect(JSON.parse((vi.mocked(invoke).mock.calls[0]?.[4] ?? "") as string)).toEqual({
    key: "agent.max_turns",
    value: 600,
    revision: 123,
  });
  await expect(service.update({ key: "model.api_key" as never, value: 1 }, 123)).rejects.toMatchObject({
    code: "VALIDATION_FAILED",
  });
  await expect(service.update({ key: "agent.max_turns", value: 0 }, 123)).rejects.toMatchObject({
    code: "VALIDATION_FAILED",
  });
  await expect(service.update({ key: "browser.command_timeout", value: 4 }, 123)).rejects.toMatchObject({
    code: "VALIDATION_FAILED",
  });
  await expect(service.update({ key: "skills.disabled", value: ["one", "one"] }, 123)).rejects.toMatchObject({
    code: "VALIDATION_FAILED",
  });
});

it("sends model credentials only through bridge stdin and reports set-state without echoing the secret", async () => {
  const invoke = vi.fn(async () => ({ ...bridge, revision: 124,
    write: { key: "OPENROUTER_API_KEY", persisted: true },
  })) as unknown as RunnerInvoker;
  const service = fixture(invoke);
  const secret = "CANARY-ONLY-IN-STDIN";
  const result = await service.updateCredential({ key: "OPENROUTER_API_KEY", value: secret }, 123);
  expect(result.secretStates.find((entry) => entry.key === "OPENROUTER_API_KEY")).toMatchObject({
    configFileSet: true, effectiveConfigured: null,
  });
  expect(result.write).toMatchObject({ persisted: true, applied: null, verification: "unverified" });
  expect(JSON.stringify(result)).not.toContain(secret);
  expect(vi.mocked(invoke).mock.calls[0]?.[3]).toEqual(["credential-update"]);
  expect(JSON.parse(String(vi.mocked(invoke).mock.calls[0]?.[4]))).toEqual({
    key: "OPENROUTER_API_KEY", value: secret, revision: 123,
  });
  await expect(service.updateCredential({ key: "OPENROUTER_API_KEY", value: "bad\nkey" }, 123))
    .rejects.toMatchObject({ code: "VALIDATION_FAILED" });
});

it("does not report a timed-out credential write as failed or safe to retry", async () => {
  const invoke = vi.fn(async () => { throw new Error("runner timed out"); }) as unknown as RunnerInvoker;
  await expect(fixture(invoke).updateCredential({ key: "OPENAI_API_KEY", value: "CANARY" }, 123))
    .rejects.toMatchObject({ code: "ADAPTER_UNAVAILABLE",
      message: expect.stringContaining("Status neu laden") });
});

it("activates only a typed installed-plugin request and leaves runtime adoption unverified", async () => {
  const invoke = vi.fn(async () => ({ ...bridge, revision: 124,
    plugins: [{ id: "kanban", installed: true, enabled: true, configured: null }],
    write: { key: "plugin:kanban", persisted: true },
  })) as unknown as RunnerInvoker;
  const service = fixture(invoke);
  const result = await service.updatePlugin({ key: "plugin.activation", pluginId: "kanban", enabled: true }, 123);
  expect(result.plugins[0]?.enabled).toBe(true);
  expect(result.write).toMatchObject({ key: "plugin:kanban", persisted: true, applied: null });
  expect(vi.mocked(invoke).mock.calls[0]?.[3]).toEqual(["plugin-activation"]);
  expect(JSON.parse(String(vi.mocked(invoke).mock.calls[0]?.[4]))).toEqual({
    pluginId: "kanban", enabled: true, revision: 123,
  });
  await expect(service.updatePlugin({ key: "plugin.activation", pluginId: "../../bad", enabled: true }, 123))
    .rejects.toMatchObject({ code: "VALIDATION_FAILED" });
});

it("activates a managed MCP entry without exposing or resending its URL", async () => {
  const invoke = vi.fn(async () => ({ ...bridge, revision: 124,
    mcpServers: [{ id: "example", transport: "http", enabled: false,
      endpoint: "https://example.org", editable: true, authMode: "none", credentialConfigured: null }],
    write: { key: "mcp:example", persisted: true },
  })) as unknown as RunnerInvoker;
  const service = fixture(invoke);
  const result = await service.activateMcp({ key: "mcp.activation", name: "example", enabled: false }, 123);
  expect(result.mcpServers[0]?.enabled).toBe(false);
  expect(result.write).toMatchObject({ persisted: true, applied: null });
  expect(vi.mocked(invoke).mock.calls[0]?.[3]).toEqual(["mcp-activation"]);
  expect(JSON.parse(String(vi.mocked(invoke).mock.calls[0]?.[4]))).toEqual({
    name: "example", enabled: false, revision: 123,
  });
  await expect(service.activateMcp({ key: "mcp.activation", name: "bad/path", enabled: true }, 123))
    .rejects.toMatchObject({ code: "VALIDATION_FAILED" });
});

it("returns only a revision-bound MCP protocol receipt without endpoint or server text", async () => {
  const invoke = vi.fn(async () => ({ name: "example", revision: 123, connected: true,
    toolCount: 2, toolCountComplete: true, failureClass: null, secret: "CANARY-PRIVATE" })) as unknown as RunnerInvoker;
  const result = await fixture(invoke).probeMcp("example", 123);
  expect(result).toMatchObject({ connected: true, toolCount: 2, runtimeApplied: null });
  expect(JSON.stringify(result)).not.toContain("CANARY-PRIVATE");
  expect(vi.mocked(invoke).mock.calls[0]?.[3]).toEqual(["mcp-probe"]);
  expect(JSON.parse(String(vi.mocked(invoke).mock.calls[0]?.[4]))).toEqual({ name: "example", revision: 123 });
  await expect(fixture(invoke).probeMcp("bad/path", 123)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
});

it("sends a write-only MCP Bearer credential through the bounded bridge", async () => {
  const invoke = vi.fn(async () => ({ ...bridge, revision: 124,
    mcpServers: [{ id: "example", transport: "http", enabled: true,
      endpoint: "https://example.org", editable: false, authMode: "bearer", credentialConfigured: true }],
    write: { key: "mcp:example", persisted: true },
  })) as unknown as RunnerInvoker;
  const service = fixture(invoke);
  const result = await service.updateMcpBearer({ key: "mcp.bearerCredential", name: "example",
    token: "CANARY-MCP-PRIVATE" }, 123);
  expect(result.mcpServers[0]?.credentialConfigured).toBe(true);
  expect(result.write).toMatchObject({ persisted: true, applied: null });
  expect(JSON.stringify(result)).not.toContain("CANARY-MCP-PRIVATE");
  expect(vi.mocked(invoke).mock.calls[0]?.[3]).toEqual(["mcp-bearer"]);
  expect(JSON.parse(String(vi.mocked(invoke).mock.calls[0]?.[4]))).toEqual({
    name: "example", token: "CANARY-MCP-PRIVATE", revision: 123,
  });
  await expect(service.updateMcpBearer({ key: "mcp.bearerCredential", name: "bad-name",
    token: "CANARY" }, 123)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
});

it("treats an MCP credential timeout as an unknown result and requires status refresh", async () => {
  const invoke = vi.fn(async () => { throw new Error("runner timed out"); }) as unknown as RunnerInvoker;
  await expect(fixture(invoke).updateMcpBearer({ key: "mcp.bearerCredential",
    name: "example", token: "CANARY-MCP-PRIVATE" }, 123))
    .rejects.toMatchObject({ code: "ADAPTER_UNAVAILABLE", message: expect.stringContaining("Status neu laden") });
});

it("accepts a structured fallback chain and rejects unsafe model/provider identifiers", async () => {
  const chain = [{ provider: "openrouter", model: "example/model" }];
  const invoke = vi.fn(async () => ({ ...bridge, revision: 124,
    values: { ...bridge.values, fallback_model: chain },
    write: { key: "fallback_model", persisted: true },
  })) as unknown as RunnerInvoker;
  const service = fixture(invoke);
  const result = await service.update({ key: "fallback_model", value: chain }, 123);
  expect(result.fields.find((field) => field.key === "fallback_model")?.value).toEqual(chain);
  expect(result.write).toMatchObject({ persisted: true, applied: null });
  await expect(service.update({ key: "model.provider", value: "evil; command" }, 123)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  await expect(service.update({ key: "agent.reasoning_effort", value: "unsupported" }, 123)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  await expect(service.update({ key: "fallback_model", value: [{ provider: "openrouter", model: "" }] }, 123)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  await expect(service.update({ key: "compression.threshold", value: 1.1 }, 123)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
});

it("clears optional run budget without claiming a live-turn change", async () => {
  const invoke = vi.fn(async () => ({ ...bridge, revision: 124,
    write: { key: "agent.run_budget_seconds", persisted: true },
  })) as unknown as RunnerInvoker;
  const result = await fixture(invoke).update({ key: "agent.run_budget_seconds", value: null }, 123);
  expect(result.write).toMatchObject({ persisted: true, applied: null, verification: "unverified" });
  expect(JSON.parse((vi.mocked(invoke).mock.calls[0]?.[4] ?? "") as string)).toMatchObject({
    key: "agent.run_budget_seconds", value: null, revision: 123,
  });
});

it("maps external revision changes to conflict and disables writes for an unknown Hermes source", async () => {
  const conflictInvoke = vi.fn(async () => {
    throw new Error("runner_4:revision_conflict");
  }) as unknown as RunnerInvoker;
  await expect(
    fixture(conflictInvoke).update({ key: "agent.api_max_retries", value: 4 }, 123),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const unpinned = fixture(
    vi.fn(async () => ({ ...bridge, sourceRevision: "a".repeat(40) })) as unknown as RunnerInvoker,
  );
  expect((await unpinned.status()).fields.every((field) => field.writable === false)).toBe(true);
});

it("distinguishes a missing Hermes installation from an unavailable bridge", async () => {
  const missing = fixture(
    vi.fn(async () => {
      throw new Error("runner_5:hermes_not_installed");
    }) as unknown as RunnerInvoker,
  );
  expect(await missing.status()).toMatchObject({ installed: false, revision: null, fields: [], plugins: [] });
  const unavailable = fixture(
    vi.fn(async () => {
      throw new Error("runner_5:hermes_unavailable");
    }) as unknown as RunnerInvoker,
  );
  await expect(unavailable.status()).rejects.toMatchObject({ code: "ADAPTER_UNAVAILABLE" });
});

it("keeps unknown skill activation and partial inventory visible", async () => {
  const observed = await fixture(vi.fn(async () => ({ ...bridge,
    inventory: { scope: "profile", skillsComplete: false, pluginsComplete: true, modelProvidersComplete: true, reasons: ["skill_activation_unknown"] },
    skills: [{ id: "sample", installed: true, enabled: null }],
  })) as unknown as RunnerInvoker).status();
  expect(observed.skills[0]?.enabled).toBeNull();
  expect(observed.inventory).toMatchObject({ skillsComplete: false, reasons: ["skill_activation_unknown"] });
});

it("returns a redacted picker catalog without inferring provider login or model access", async () => {
  const invoke = vi.fn(async (_script, _distro, _user, _args, request) => ({
    sourceRevision: bridge.sourceRevision,
    providers: [{ id: "openai-api", label: "OpenAI API", secret: "CANARY-DO-NOT-RETURN" }],
    selected: JSON.parse(String(request)).providerId ? {
      id: "openai-api", models: ["gpt-test"], origin: "endpoint_confirmed_picker",
      probeStatus: "succeeded", modelAccess: null, secret: "CANARY-DO-NOT-RETURN",
    } : null,
    secret: "CANARY-DO-NOT-RETURN",
  })) as unknown as RunnerInvoker;
  const service = fixture(invoke);
  const offered = await service.modelCatalog();
  expect(offered).toMatchObject({ providerListComplete: null, selected: null,
    providers: [{ id: "openai-api", label: "OpenAI API" }] });
  const probed = await service.modelCatalog("openai-api");
  expect(probed.selected).toEqual({ id: "openai-api", models: ["gpt-test"],
    origin: "endpoint_confirmed_picker", probeStatus: "succeeded", modelAccess: null });
  expect(JSON.stringify([offered, probed])).not.toContain("CANARY-DO-NOT-RETURN");
  expect(vi.mocked(invoke).mock.calls[1]?.[3]).toEqual(["model-catalog"]);
  expect(JSON.parse(String(vi.mocked(invoke).mock.calls[1]?.[4]))).toEqual({ providerId: "openai-api" });
  await expect(service.modelCatalog("unsafe;provider")).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
});

it("fails closed when a catalog response claims an unrequested provider", async () => {
  const service = fixture(vi.fn(async () => ({ sourceRevision: bridge.sourceRevision,
    providers: [{ id: "openai-api", label: "OpenAI API" }],
    selected: { id: "anthropic", models: [], origin: "curated", probeStatus: "failed", modelAccess: null },
  })) as unknown as RunnerInvoker);
  await expect(service.modelCatalog("openai-api")).rejects.toMatchObject({ code: "ADAPTER_UNAVAILABLE" });
});

it("binds MCP OAuth start to the revision and returns only bounded state", async () => {
  const invoke = vi.fn(async () => ({ flowId: "a".repeat(32), status: "awaiting_approval",
    authorizationUrl: "https://auth.example.org/authorize?state=sample", updatedAt: 1,
    access_token: "CANARY-DO-NOT-RETURN" })) as unknown as RunnerInvoker;
  const service = fixture(invoke);
  const result = await service.manageMcpOAuth({ action: "start", name: "sample" }, 123, "owner-1");
  expect(result).toMatchObject({ status: "awaiting_approval", revision: null, runtimeApplied: null });
  expect(JSON.stringify(result)).not.toContain("CANARY-DO-NOT-RETURN");
  expect(vi.mocked(invoke).mock.calls[0]?.[3]).toEqual(["mcp-oauth-start"]);
  expect(JSON.parse(String(vi.mocked(invoke).mock.calls[0]?.[4]))).toEqual({ name: "sample", revision: 123,
    ownerId: "owner-1" });
  await expect(service.manageMcpOAuth({ action: "start", name: "bad/name" }, 123, "owner-1"))
    .rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  await expect(service.manageMcpOAuth({ action: "status", flowId: "bad" }, 123, "owner-1"))
    .rejects.toMatchObject({ code: "VALIDATION_FAILED" });
});
