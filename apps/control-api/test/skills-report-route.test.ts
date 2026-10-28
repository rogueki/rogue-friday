import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { HermesConfigService } from "../src/services/hermes-config";
import type { RunnerInvoker } from "../src/services/coding-runs";
import { startTestApi } from "./helpers";

const INSPECT = "Skills\n  arxiv\n    category: research\n    source: builtin\n    status: enabled";

const stub = (overrides: Record<string, unknown> = {}) => ({
  skillReport: async (action: "inspect" | "audit" | "diff", name: string) => ({
    action, name, text: action === "diff" ? `--- a/${name}\n+++ b/${name}\n` : INSPECT,
    bytes: action === "diff" ? 24 : 74, truncated: false, observedAt: "2026-10-23T03:00:00.000Z",
  }),
  ...overrides,
});

it("serves inspect, audit and diff as unchanged CLI text", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    api.runtime.hermesConfig = stub() as never;
    const owner = api.client();
    await owner.loginDev("owner");

    const inspect = await owner.get("/api/v1/skills/arxiv/inspect");
    expect(inspect.statusCode).toBe(200);
    expect(inspect.json().data).toEqual({ action: "inspect", name: "arxiv", text: INSPECT, bytes: 74,
      truncated: false, observedAt: "2026-10-23T03:00:00.000Z" });

    const audit = await owner.get("/api/v1/skills/arxiv/audit");
    expect(audit.json().data.action).toBe("audit");

    const diff = await owner.get("/api/v1/skills/google-workspace/diff");
    expect(diff.statusCode).toBe(200);
    expect(diff.json().data).toMatchObject({ action: "diff", name: "google-workspace", truncated: false });
    expect(diff.json().data.text).toContain(`--- a/google-workspace`);
  } finally {
    await api.close();
  }
});

it("rejects an over-long name in the router and a bad slug in the service", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    let called = 0;
    api.runtime.hermesConfig = stub({
      skillReport: async () => {
        called += 1;
        throw new Error("must not be reached");
      },
    }) as never;
    const owner = api.client();
    await owner.loginDev("owner");

    expect((await owner.get(`/api/v1/skills/${"a".repeat(129)}/diff`)).statusCode).toBe(400);
    expect(called).toBe(0);
  } finally {
    await api.close();
  }
});

function fixture(invoke: RunnerInvoker) {
  const root = mkdtempSync(join(tmpdir(), "friday-skill-report-"));
  mkdirSync(join(root, "config"));
  writeFileSync(join(root, "config", "install-state.json"),
    JSON.stringify({ distro_name: "Friday-Ubuntu", linux_user: "friday" }));
  mkdirSync(join(root, "installer", "wsl"), { recursive: true });
  writeFileSync(join(root, "installer", "wsl", "hermes_config_bridge.py"), "# bundled fixture\n");
  return { service: new HermesConfigService(join(root, "data"), invoke), root };
}

it("rejects an invalid name and an empty report before any CLI call", async () => {
  const calls: string[][] = [];
  const invoke: RunnerInvoker = (async (...args: unknown[]) => {
    calls.push(args[3] as string[]);
    throw new Error("skill_report_empty");
  }) as RunnerInvoker;
  const { service, root } = fixture(invoke);
  try {
    await expect(service.skillReport("inspect", "with space")).rejects.toThrow("Skill-Name");
    await expect(service.skillReport("diff", "")).rejects.toThrow("Skill-Name");
    expect(calls).toHaveLength(0);
    await expect(service.skillReport("audit", "arxiv")).rejects.toThrow("keinen Bericht");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("never fills a report with text the CLI did not print", async () => {
  const { service, root } = fixture((async () => ({ action: "inspect", name: "arxiv", text: "  ",
    bytes: 0, truncated: false })) as never);
  try {
    await expect(service.skillReport("inspect", "arxiv")).rejects.toThrow("Hermes-Bruecke in WSL");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});