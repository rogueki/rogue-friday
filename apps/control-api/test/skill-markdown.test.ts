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
  const root = mkdtempSync(join(tmpdir(), "friday-skill-markdown-"));
  roots.push(root);
  mkdirSync(join(root, "config"));
  writeFileSync(join(root, "config", "install-state.json"),
    JSON.stringify({ distro_name: "Friday-Ubuntu", linux_user: "friday" }));
  mkdirSync(join(root, "installer", "wsl"), { recursive: true });
  writeFileSync(join(root, "installer", "wsl", "hermes_config_bridge.py"), "# bundled fixture\n");
  return new HermesConfigService(join(root, "data"), invoke);
}

it("returns the raw SKILL.md text for a valid slug", async () => {
  const invoke: RunnerInvoker = async () => ({
    id: "demo", content: "# Demo\n\n<script>alert(1)</script>\n", bytes: 34,
  }) as never;
  await expect(fixture(invoke).skillMarkdown("demo")).resolves.toEqual({
    id: "demo", content: "# Demo\n\n<script>alert(1)</script>\n", bytes: 34,
  });
});

it("rejects a slug that could escape the skill directory before invoking anything", async () => {
  let called = false;
  const invoke: RunnerInvoker = async () => { called = true; return {} as never; };
  await expect(fixture(invoke).skillMarkdown("../etc")).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  expect(called).toBe(false);
});

it("maps a missing SKILL.md to 404 and an oversized file to a readable 422", async () => {
  const missing: RunnerInvoker = async () => { throw new Error("bridge exited 5: skill_md_missing"); };
  await expect(fixture(missing).skillMarkdown("demo")).rejects.toMatchObject({ code: "NOT_FOUND" });
  const large: RunnerInvoker = async () => { throw new Error("bridge exited 5: skill_md_too_large"); };
  await expect(fixture(large).skillMarkdown("demo")).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
});

it("refuses a response whose id or size does not match the request", async () => {
  const wrongId: RunnerInvoker = async () => ({ id: "other", content: "x", bytes: 1 }) as never;
  await expect(fixture(wrongId).skillMarkdown("demo")).rejects.toMatchObject({ code: "ADAPTER_UNAVAILABLE" });
  const tooBig: RunnerInvoker = async () => ({ id: "demo", content: "x", bytes: 999999 }) as never;
  await expect(fixture(tooBig).skillMarkdown("demo")).rejects.toMatchObject({ code: "ADAPTER_UNAVAILABLE" });
});