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
    "agent.max_turns": 500,
    "agent.gateway_timeout": 1800,
    "agent.api_max_retries": 3,
    "session.terminal_continue": true,
    max_live_sessions: 16,
  },
  explicit: {
    "agent.max_turns": true,
    "agent.gateway_timeout": false,
    "agent.api_max_retries": false,
    "session.terminal_continue": false,
    max_live_sessions: false,
  },
  secrets: { "model.api_key": true, rawCredential: "CANARY-DO-NOT-RETURN" },
  families: [
    {
      id: "agent",
      roots: ["agent"],
      followup: "P7-C",
      configFileSet: true,
      unexpected: "CANARY-DO-NOT-RETURN",
    },
  ],
  skills: [{ id: "hermes-agent", installed: true, enabled: true, unexpected: "CANARY-DO-NOT-RETURN" }],
  plugins: [
    { id: "kanban", installed: true, enabled: false, configured: null, unexpected: "CANARY-DO-NOT-RETURN" },
  ],
  write: null,
};

it("returns only allowlisted resolved values and installed manifests without credential leakage", async () => {
  const invoke = vi.fn(async () => bridge) as unknown as RunnerInvoker;
  const status = await fixture(invoke).status();
  expect(status.fields).toHaveLength(5);
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
