import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { HermesConfigService } from "../src/services/hermes-config";
import type { RunnerInvoker } from "../src/services/coding-runs";
import { startTestApi } from "./helpers";

const stub = (overrides: Record<string, unknown> = {}) => ({
  mutateSkill: async (action: "install" | "update" | "uninstall", name: string) => ({
    action, name, installed: action !== "uninstall", enabled: action === "uninstall" ? null : true,
    snapshot: action === "install" ? null : `20261023T041236Z-${action}-${name}`,
    text: action === "install" ? `Installed: ${name}` : `Updated 1 skill(s).`, bytes: 24,
    observedAt: "2026-10-23T04:30:00.000Z",
  }),
  ...overrides,
});

it("mutates a skill and reports the observed state with its snapshot", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const seen: unknown[] = [];
    api.runtime.hermesConfig = stub({
      mutateSkill: async (action: string, name: string, identifier: string | undefined, force: boolean) => {
        seen.push({ action, name, identifier, force });
        return { action, name, installed: action !== "uninstall", enabled: action === "uninstall" ? null : true,
          snapshot: action === "install" ? null : `20261023T041236Z-${action}-${name}`, text: "Updated 1 skill(s).",
          bytes: 19, observedAt: "2026-10-23T04:30:00.000Z" };
      },
    }) as never;
    const owner = api.client();
    await owner.loginDev("owner");

    const update = await owner.post("/api/v1/skills/arxiv/mutations", { action: "update" });
    expect(update.statusCode).toBe(200);
    expect(update.json().data).toMatchObject({ action: "update", name: "arxiv", installed: true, enabled: true });
    expect(update.json().data.snapshot).toContain("-update-arxiv");

    const install = await owner.post("/api/v1/skills/skill-creator/mutations",
      { action: "install", identifier: "skills-sh/anthropics/skills/skill-creator", force: true });
    expect(install.statusCode).toBe(200);
    expect(install.json().data.snapshot).toBeNull();

    const uninstall = await owner.post("/api/v1/skills/arxiv/mutations", { action: "uninstall" });
    expect(uninstall.json().data).toMatchObject({ installed: false, enabled: null });

    expect(seen).toEqual([
      { action: "update", name: "arxiv", identifier: undefined, force: false },
      { action: "install", name: "skill-creator", identifier: "skills-sh/anthropics/skills/skill-creator", force: true },
      { action: "uninstall", name: "arxiv", identifier: undefined, force: false },
    ]);
  } finally {
    await api.close();
  }
});

it("rejects an unknown action, a missing action and an over-long name before the service runs", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    let called = 0;
    api.runtime.hermesConfig = stub({
      mutateSkill: async () => {
        called += 1;
        throw new Error("must not be reached");
      },
    }) as never;
    const owner = api.client();
    await owner.loginDev("owner");

    // The request schema rejects both before the handler runs; the router keeps its own 400 for the path.
    expect((await owner.post("/api/v1/skills/arxiv/mutations", { action: "remove" })).statusCode).toBe(422);
    expect((await owner.post("/api/v1/skills/arxiv/mutations", {})).statusCode).toBe(422);
    expect((await owner.post(`/api/v1/skills/${"a".repeat(129)}/mutations`,
      { action: "update" })).statusCode).toBe(400);
    expect(called).toBe(0);
  } finally {
    await api.close();
  }
});

function fixture(invoke: RunnerInvoker) {
  const root = mkdtempSync(join(tmpdir(), "friday-skill-mutate-"));
  mkdirSync(join(root, "config"));
  writeFileSync(join(root, "config", "install-state.json"),
    JSON.stringify({ distro_name: "Friday-Ubuntu", linux_user: "friday" }));
  mkdirSync(join(root, "installer", "wsl"), { recursive: true });
  writeFileSync(join(root, "installer", "wsl", "hermes_config_bridge.py"), "# bundled fixture\n");
  return { service: new HermesConfigService(join(root, "data"), invoke), root };
}

it("demands an identifier exactly for installs and never calls the CLI otherwise", async () => {
  const calls: unknown[][] = [];
  const invoke: RunnerInvoker = (async (...args: unknown[]) => {
    calls.push(args);
    throw new Error("skill_mutation_failed");
  }) as RunnerInvoker;
  const { service, root } = fixture(invoke);
  try {
    await expect(service.mutateSkill("install", "arxiv", undefined, false)).rejects.toThrow("Kennung");
    await expect(service.mutateSkill("update", "arxiv", "skills-sh/x/y", false)).rejects.toThrow("nur beim Installieren");
    await expect(service.mutateSkill("update", "bad name", undefined, false)).rejects.toThrow("Skill-Name");
    await expect(service.mutateSkill("install", "arxiv", "has space", false)).rejects.toThrow("Kennung");
    expect(calls).toHaveLength(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("never reports a mutation the CLI did not confirm", async () => {
  const failing = fixture((async () => {
    throw new Error("skill_mutation_failed");
  }) as never);
  try {
    await expect(failing.service.mutateSkill("update", "arxiv", undefined, false))
      .rejects.toThrow("wurde wiederhergestellt");
  } finally {
    rmSync(failing.root, { recursive: true, force: true });
  }

  const lying = fixture((async () => ({ action: "update", name: "arxiv", installed: false, enabled: null,
    snapshot: null, text: "", bytes: 0 })) as never);
  try {
    await expect(lying.service.mutateSkill("update", "arxiv", undefined, false))
      .rejects.toThrow("Hermes-Bruecke in WSL");
  } finally {
    rmSync(lying.root, { recursive: true, force: true });
  }
});