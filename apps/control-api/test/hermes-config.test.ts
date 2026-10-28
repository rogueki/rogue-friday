import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HermesConfigService, validBaseUrl } from "../src/services/hermes-config";
import { nativeRunnerScript } from "../src/services/coding-runs";
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
  // Linux resolves the bridge from the trusted install tree before invoking the test double.
  mkdirSync(join(root, "installer", "wsl"), { recursive: true });
  writeFileSync(join(root, "installer", "wsl", "hermes_config_bridge.py"), "# bundled fixture\n");
  writeFileSync(join(root, "installer", "wsl", "hermes_cron_mutate.py"), "# bundled fixture\n");
  return new HermesConfigService(join(root, "data"), invoke);
}

it("resolves the bundled native Linux Hermes bridge without WSL install-state fields", () => {
  const root = mkdtempSync(join(tmpdir(), "friday-hermes-native-"));
  roots.push(root);
  mkdirSync(join(root, "installer", "wsl"), { recursive: true });
  writeFileSync(join(root, "installer", "wsl", "hermes_config_bridge.py"), "# bundled fixture\n");
  expect(nativeRunnerScript(join(root, "data"), "hermes_config_bridge.py", {}).script)
    .toBe(realpathSync.native(join(root, "installer", "wsl", "hermes_config_bridge.py")));
});

it("validates native cron read output before returning it", async () => {
  const response = { sourceRevision: "d923a5eb487a17c0a68801bba9ef0f56c81040a8", profile: "default", profileTimezone: "UTC",
    storeRevision: "a".repeat(64), count: 1, truncated: false, schedulerRunning: null,
    jobs: [{ id: "job-1", name: "Morning", schedule: "09:00 UTC", timezone: "UTC",
      enabled: true, state: "scheduled", nextRunAt: null, lastRunAt: null }] };
  const invoke = vi.fn(async () => response) as unknown as RunnerInvoker;
  const service = fixture(invoke);
  expect(await service.cronJobs()).toEqual(response);
  expect(vi.mocked(invoke).mock.calls[0]?.[0]).toContain("hermes_cron_read.py");
  expect(vi.mocked(invoke).mock.calls[0]?.[3]).toEqual(["list"]);
  vi.mocked(invoke).mockImplementationOnce(async () => ({ ...response, jobs: [{ ...response.jobs[0], prompt: "SECRET", enabled: "yes" }] }));
  await expect(service.cronJobs()).rejects.toMatchObject({ code: "ADAPTER_UNAVAILABLE" });
});

it("validates native Cron receipts and leaves timed-out mutations unconfirmed", async () => {
  const request = { action: "create" as const, expectedStoreRevision: "a".repeat(64), profile: "default",
    profileTimezone: "UTC", name: "Morning", schedule: "30m", prompt: "PRIVATE-CRON-PROMPT" };
  const receipt = { action: "create" as const, jobId: "012345abcdef", profile: "default", profileTimezone: "UTC",
    storeRevision: "b".repeat(64), state: "paused", accepted: true as const, executionVerified: false as const };
  const invoke = vi.fn(async () => receipt) as unknown as RunnerInvoker;
  const service = fixture(invoke);
  expect(await service.mutateCron(request)).toEqual(receipt);
  expect(vi.mocked(invoke).mock.calls[0]?.[0]).toContain("hermes_cron_mutate.py");
  expect(vi.mocked(invoke).mock.calls[0]?.[4]).toBe(JSON.stringify(request));
  vi.mocked(invoke).mockResolvedValueOnce({ ...receipt, prompt: request.prompt });
  await expect(service.mutateCron(request)).rejects.toMatchObject({ code: "ADAPTER_UNAVAILABLE" });
  vi.mocked(invoke).mockResolvedValueOnce({ error: "store_revision_conflict" });
  await expect(service.mutateCron(request)).rejects.toMatchObject({ code: "CONFLICT" });
  vi.mocked(invoke).mockRejectedValueOnce(new Error("timeout after native write"));
  await expect(service.mutateCron(request)).rejects.toMatchObject({ code: "ADAPTER_UNAVAILABLE",
    message: expect.stringContaining("nicht bestaetigt") });
});

const bridge = {
  installed: true,
  sourceRevision: "d923a5eb487a17c0a68801bba9ef0f56c81040a8",
  revision: 123,
  values: {
    "model.provider": "openrouter",
    "model.default": "example/model",
    "model.base_url": null,
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
    "terminal.container_cpu": 1,
    "terminal.container_memory": 5120,
    "terminal.container_disk": 51200,
    "terminal.container_persistent": true,
    "terminal.backend": "local",
    "terminal.cwd": ".",
    "terminal.docker_network": true,
    "terminal.docker_mount_cwd_to_workspace": false,
    "terminal.docker_volumes": [],
    "browser.command_timeout": 30,
    "browser.snapshot_threshold": 15000,
    "browser.inactivity_timeout": 120,
    "browser.engine": "auto",
    "browser.headed": false,
    "browser.auto_local_for_private_urls": true,
    "browser.dialog_policy": "must_respond",
    "browser.dialog_timeout_s": 300,
    "browser.allow_private_urls": false,
    "browser.use_real_profile": false,
    "browser.real_profile_pin": "",
    "browser.restrict_evaluate": false,
    "browser.allow_unsafe_evaluate": false,
    "code_execution.mode": "project",
    "code_execution.kernel_idle_timeout": 1800,
    "code_execution.max_session_kernels": 4,
    "computer_use.permission_mode": "standard",
    "computer_use.capability_manifest": "",
    "computer_use.max_image_dimension": 1456,
    "computer_use.ax_max_elements": 200,
    "computer_use.capture_after_mode": "som",
    toolsets: ["hermes-cli"],
    command_allowlist: [],
    "approvals.mode": "smart",
    "approvals.timeout": 300,
    "approvals.denial_breaker_threshold": 3,
    "approvals.deny": [],
    "approvals.destructive_slash_confirm": true,
    "approvals.mcp_reload_confirm": true,
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
    "model.base_url": false,
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
    "terminal.container_cpu": false,
    "terminal.container_memory": false,
    "terminal.container_disk": false,
    "terminal.container_persistent": false,
    "terminal.backend": false,
    "terminal.cwd": false,
    "terminal.docker_network": false,
    "terminal.docker_mount_cwd_to_workspace": false,
    "terminal.docker_volumes": false,
    "browser.command_timeout": false,
    "browser.snapshot_threshold": false,
    "browser.inactivity_timeout": false,
    "browser.engine": false,
    "browser.headed": false,
    "browser.auto_local_for_private_urls": false,
    "browser.dialog_policy": false,
    "browser.dialog_timeout_s": false,
    "browser.allow_private_urls": false,
    "browser.use_real_profile": false,
    "browser.real_profile_pin": false,
    "browser.restrict_evaluate": false,
    "browser.allow_unsafe_evaluate": false,
    "code_execution.mode": false,
    "code_execution.kernel_idle_timeout": false,
    "code_execution.max_session_kernels": false,
    "computer_use.permission_mode": false,
    "computer_use.capability_manifest": false,
    "computer_use.max_image_dimension": false,
    "computer_use.ax_max_elements": false,
    "computer_use.capture_after_mode": false,
    toolsets: false,
    command_allowlist: false,
    "approvals.mode": false,
    "approvals.timeout": false,
    "approvals.denial_breaker_threshold": false,
    "approvals.deny": false,
    "approvals.destructive_slash_confirm": false,
    "approvals.mcp_reload_confirm": false,
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
  expect(status.fields).toHaveLength(83);
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
    process.platform === "win32" ? "Friday-Ubuntu" : "",
    process.platform === "win32" ? "friday" : "",
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

it("passes explicit unattended approval policy by revision without claiming a command was approved", async () => {
  const invoke = vi.fn(async () => ({ ...bridge, revision: 124,
    values: { ...bridge.values, "approvals.unattended_mode": "approve" },
    write: { key: "approvals.unattended_mode", persisted: true },
  })) as unknown as RunnerInvoker;
  const service = fixture(invoke);
  const status = await service.update({ key: "approvals.unattended_mode", value: "approve" }, 123);
  expect(status.write).toMatchObject({ persisted: true, applied: null, verification: "unverified" });
  expect(JSON.parse((vi.mocked(invoke).mock.calls[0]?.[4] ?? "") as string)).toEqual({
    key: "approvals.unattended_mode", value: "approve", revision: 123,
  });
  await expect(service.update({ key: "approvals.unattended_mode", value: "off" }, 123))
    .rejects.toMatchObject({ code: "VALIDATION_FAILED" });
});

it("allows explicit owner policy bypass values but still requires typed values and revision", async () => {
  const invoke = vi.fn()
    .mockResolvedValueOnce({ ...bridge, revision: 124,
      values: { ...bridge.values, "approvals.mode": "off" },
      write: { key: "approvals.mode", persisted: true },
    })
    .mockResolvedValueOnce({ ...bridge, revision: 125,
      values: { ...bridge.values, "security.protected_instruction_files": false },
      write: { key: "security.protected_instruction_files", persisted: true },
    }) as unknown as RunnerInvoker;
  const service = fixture(invoke);
  await service.update({ key: "approvals.mode", value: "off" }, 123);
  await service.update({ key: "security.protected_instruction_files", value: false }, 124);
  expect(JSON.parse(String(vi.mocked(invoke).mock.calls[0]?.[4]))).toEqual({
    key: "approvals.mode", value: "off", revision: 123,
  });
  expect(JSON.parse(String(vi.mocked(invoke).mock.calls[1]?.[4]))).toEqual({
    key: "security.protected_instruction_files", value: false, revision: 124,
  });
  await expect(service.update({ key: "approvals.mode", value: "auto" }, 123))
    .rejects.toMatchObject({ code: "VALIDATION_FAILED" });
});

it("previews a command through native approval test without a write receipt or command echo", async () => {
  const invoke = vi.fn(async () => ({ revision: 123, backend: "local", verdict: "ask-approval",
    rule: "synthetic pattern", detail: "would ask", })) as unknown as RunnerInvoker;
  const service = fixture(invoke);
  const result = await service.testApproval("rm -rf build", 123);
  expect(result).toMatchObject({ verdict: "ask-approval", backend: "local", runtimeApplied: null });
  expect(JSON.stringify(result)).not.toContain("rm -rf build");
  expect(vi.mocked(invoke).mock.calls[0]?.[3]).toEqual(["approval-test"]);
  expect(JSON.parse(String(vi.mocked(invoke).mock.calls[0]?.[4]))).toEqual({
    command: "rm -rf build", revision: 123,
  });
  await expect(service.testApproval("bad\ncommand", 123)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
});

it("passes native unconditional deny globs with a revision and rejects control characters", async () => {
  const value = ["git push --force*"];
  const invoke = vi.fn(async () => ({ ...bridge, revision: 124,
    values: { ...bridge.values, "approvals.deny": value },
    write: { key: "approvals.deny", persisted: true },
  })) as unknown as RunnerInvoker;
  const service = fixture(invoke);
  const status = await service.update({ key: "approvals.deny", value }, 123);
  expect(status.write).toMatchObject({ persisted: true, applied: null });
  expect(JSON.parse(String(vi.mocked(invoke).mock.calls[0]?.[4]))).toEqual({
    key: "approvals.deny", value, revision: 123,
  });
  await expect(service.update({ key: "approvals.deny", value: ["bad\npattern"] }, 123))
    .rejects.toMatchObject({ code: "VALIDATION_FAILED" });
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
  await expect(service.update({ key: "model.base_url", value: "https://llm.example.com/v1?x=1" }, 123)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  await expect(service.update({ key: "model.base_url", value: "http://llm.example.com/v1" }, 123)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  await expect(service.update({ key: "agent.reasoning_effort", value: "unsupported" }, 123)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  await expect(service.update({ key: "fallback_model", value: [{ provider: "openrouter", model: "" }] }, 123)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  await expect(service.update({ key: "compression.threshold", value: 1.1 }, 123)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
});

it("accepts only bounded custom-provider base URLs", () => {
  expect(validBaseUrl("https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1")).toBe(true);
  expect(validBaseUrl("http://127.0.0.1:11434/v1")).toBe(true);
  expect(validBaseUrl("http://localhost:8080/v1")).toBe(true);
  expect(validBaseUrl("http://llm.example.com/v1")).toBe(false);
  expect(validBaseUrl("https://user:pw@llm.example.com/v1")).toBe(false);
  expect(validBaseUrl("https://llm.example.com/v1?x=1")).toBe(false);
  expect(validBaseUrl("ftp://llm.example.com")).toBe(false);
  expect(validBaseUrl("https://llm example.com")).toBe(false);
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
