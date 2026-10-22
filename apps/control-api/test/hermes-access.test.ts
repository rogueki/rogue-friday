import { afterEach, expect, it } from "vitest";
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
  const root = mkdtempSync(join(tmpdir(), "friday-hermes-access-"));
  roots.push(root);
  mkdirSync(join(root, "config"));
  writeFileSync(join(root, "config", "install-state.json"),
    JSON.stringify({ distro_name: "Friday-Ubuntu", linux_user: "friday" }));
  mkdirSync(join(root, "installer", "wsl"), { recursive: true });
  writeFileSync(join(root, "installer", "wsl", "hermes_config_bridge.py"), "# bundled fixture\n");
  return new HermesConfigService(join(root, "data"), invoke);
}

const TWO_PROVIDERS = {
  providers: [
    { provider: "copilot", count: 1, credentials: [
      { index: 1, label: "gh auth token", type: "api_key", source: "gh_cli", active: true }] },
    { provider: "kimi-coding", count: 1, credentials: [
      { index: 1, label: "KIMI_API_KEY", type: "api_key", source: "env:KIMI_API_KEY", active: true }] },
  ],
};

it("returns providers with source markers only and never a key", async () => {
  const invoke: RunnerInvoker = async () => TWO_PROVIDERS as never;
  const service = fixture(invoke);
  const result = await service.access();
  expect(result).toEqual(TWO_PROVIDERS);
  expect(JSON.stringify(result)).not.toMatch(/sk-/);
});

it("rejects a count that does not match the listed credentials", async () => {
  const invoke: RunnerInvoker = async () => ({
    providers: [{ provider: "openai", count: 2, credentials: [
      { index: 1, label: "OPENAI_API_KEY", type: "api_key", source: "env:OPENAI_API_KEY", active: true }] }],
  }) as never;
  await expect(fixture(invoke).access()).rejects.toMatchObject({ code: "ADAPTER_UNAVAILABLE" });
});

it("rejects a key value smuggled through a label", async () => {
  const invoke: RunnerInvoker = async () => ({
    providers: [{ provider: "openai", count: 1, credentials: [
      { index: 1, label: "sk-abcdefghijklmnop", type: "api_key", source: "literal", active: true }] }],
  }) as never;
  await expect(fixture(invoke).access()).rejects.toMatchObject({ code: "ADAPTER_UNAVAILABLE" });
});

it("explains an unparsable CLI output instead of returning an empty list", async () => {
  const invoke: RunnerInvoker = async () => {
    throw new Error("bridge exited 1: auth_list_format");
  };
  await expect(fixture(invoke).access()).rejects.toMatchObject({
    code: "ADAPTER_UNAVAILABLE",
    message: expect.stringContaining("unbekanntes Format") as string,
  });
});