import { expect, it } from "vitest";
import { HermesConfigService } from "../src/services/hermes-config";
import type { RunnerInvoker } from "../src/services/coding-runs";
import { startTestApi } from "./helpers";

const stub = (calls: Array<{ action: string; params: Record<string, unknown> }> = []) => ({
  mutateSkillGovernance: async (action: string, params: Record<string, unknown>) => {
    calls.push({ action, params });
    const target = action === "reset" ? String(params.name)
      : action === "trust" || action === "untrust" ? String(params.path) : String(params.repo);
    return { action, target, text: `${action}: ${target}`, bytes: 12, changedAt: "2026-10-23T05:00:00.000Z" };
  },
});

it("trusts a project root and manages taps through one typed operation", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const calls: Array<{ action: string; params: Record<string, unknown> }> = [];
    api.runtime.hermesConfig = stub(calls) as never;
    const owner = api.client();
    await owner.loginDev("owner");

    const trust = await owner.post("/api/v1/skills/governance",
      { action: "trust", path: "/home/ubuntu/work/project", repo: null, name: null });
    expect(trust.statusCode).toBe(200);
    expect(trust.json().data).toEqual({ action: "trust", target: "/home/ubuntu/work/project",
      text: "trust: /home/ubuntu/work/project", bytes: 12, changedAt: "2026-10-23T05:00:00.000Z" });

    const remove = await owner.post("/api/v1/skills/governance",
      { action: "tap-remove", path: null, repo: "anthropics/skills", name: null });
    expect(remove.json().data.target).toBe("anthropics/skills");
    expect(calls.map((call) => call.action)).toEqual(["trust", "tap-remove"]);
  } finally {
    await api.close();
  }
});

it("refuses a body that does not fit the action", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    // A real service with a dead invoker: wrong bodies are refused by its own checks (422), a valid one only fails
    // when it would reach the CLI (503), which is exactly the split this route has to keep.
    const service = new HermesConfigService({} as never, {} as RunnerInvoker);
    const wired = service as unknown as { target: () => { script: string; distro: string; user: string };
      invoke: () => Promise<never> };
    wired.target = () => ({ script: "/nonexistent/bridge.py", distro: "d", user: "u" });
    wired.invoke = async () => { throw new Error("adapter_unavailable"); };
    api.runtime.hermesConfig = service as never;
    const owner = api.client();
    await owner.loginDev("owner");

    for (const body of [
      { action: "trust", path: null, repo: null, name: null },
      { action: "trust", path: "relative/path", repo: null, name: null },
      { action: "tap-add", path: null, repo: "no-slash", name: null },
      { action: "tap-remove", path: null, repo: null, name: null },
      { action: "reset", path: null, repo: null, name: null },
      { action: "config", path: null, repo: null, name: null },
    ]) expect((await owner.post("/api/v1/skills/governance", body)).statusCode, JSON.stringify(body)).toBe(422);
    expect((await owner.post("/api/v1/skills/governance",
      { action: "trust", path: "/home/ubuntu/project", repo: null, name: null })).statusCode).toBe(503);
  } finally {
    await api.close();
  }
});

it("keeps the service honest about which action takes which field", async () => {
  const service = new HermesConfigService({} as never, {} as RunnerInvoker);
  await expect(service.mutateSkillGovernance("trust", { path: "/home/x", repo: "a/b" }))
    .rejects.toThrow("nur einen Pfad");
  await expect(service.mutateSkillGovernance("tap-add", { repo: "owner/repo", path: "/home/x" }))
    .rejects.toThrow("nur ein Repository");
  await expect(service.mutateSkillGovernance("tap-remove", {})).rejects.toThrow("nur ein Repository");
  await expect(service.mutateSkillGovernance("reset", {})).rejects.toThrow("nur einen Skill-Namen");
  await expect(service.mutateSkillGovernance("untrust", { path: "rel" })).rejects.toThrow("absolut");
});