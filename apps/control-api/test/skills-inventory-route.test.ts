import { expect, it } from "vitest";
import { HermesConfigService } from "../src/services/hermes-config";
import type { RunnerInvoker } from "../src/services/coding-runs";
import { SkillsService } from "../src/services/skills";
import { startTestApi } from "./helpers";

const dashboard = async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.endsWith("/api/skills"))
    return Response.json({ skills: [
      { name: "powerpoint", description: "Presentations", category: "Office", enabled: false, version: "2.1.0" },
      { name: "claude-code", description: "Coding agent", category: "autonomous-ai-agents", enabled: true },
    ] });
  if (url.endsWith("/")) return new Response('<script>window.__HERMES_SESSION_TOKEN__="test-token-123456"</script>');
  throw new Error(`unexpected URL ${url}`);
};

it("serves CLI origin and trust as separate fields next to the dashboard state", async () => {
  const api = await startTestApi({ providerFetch: dashboard as typeof fetch, responseValidation: "throw",
    env: { FRIDAY_HERMES_DASHBOARD_URL: "http://127.0.0.1:43791" } });
  try {
    api.runtime.skills = new SkillsService({
      dashboardUrl: "http://127.0.0.1:43791", fetcher: dashboard as typeof fetch,
      hermesInventory: async () => ({ at: "2026-10-23T01:00:00.000Z", entries: [
        { name: "powerpoint", category: "Office", origin: "local", trust: "local", state: "enabled" },
        { name: "claude-code", category: "autonomous-ai-agents", origin: "builtin", trust: "builtin", state: "enabled" },
        { name: "hub-demo", category: "communication", origin: "hub", trust: "project", state: "enabled" },
      ] }) });
    const owner = api.client();
    await owner.loginDev("owner");
    const response = await owner.get("/api/v1/skills");
    expect(response.statusCode).toBe(200);
    const byName = new Map(response.json().data.map((skill: { name: string }) => [skill.name, skill]));
    // The dashboard reports activation, the CLI reports where the skill lives and what trusts it.
    expect(byName.get("powerpoint")).toMatchObject({ origin: "local", trust: "local", enabled: false,
      version: "2.1.0", observationSource: "hermes-dashboard" });
    expect(byName.get("claude-code")).toMatchObject({ origin: "builtin", trust: "builtin", enabled: true });
    expect(byName.get("hub-demo")).toMatchObject({ id: "hermes:hub-demo", origin: "hub", trust: "project",
      category: "communication", enabled: true, discovered: true, observationSource: "hermes-cli" });
  } finally {
    await api.close();
  }
});

it("keeps the inventory when the CLI reports an origin token this code has never seen", async () => {
  // v0.22.2 calls the very same skills `external` where v0.20.5 said `local`. A closed list threw the whole
  // inventory away and the catalog silently lost origin and trust for every skill (N-064).
  const service = new HermesConfigService({} as never, {} as RunnerInvoker);
  const wired = service as unknown as { target: () => { script: string; distro: string; user: string };
    invoke: () => Promise<unknown> };
  wired.target = () => ({ script: "/mnt/d/Friday/installer/wsl/hermes_config_bridge.py", distro: "Friday-2",
    user: "friday" });
  wired.invoke = async () => ({ count: 2, skills: [
    { name: "friday-weather", category: "weather", origin: "external", trust: "local", state: "enabled" },
    { name: "arxiv", category: "research", origin: "builtin", trust: "builtin", state: "disabled" },
  ] });

  const inventory = await service.skillInventory();
  expect(inventory.entries.map((entry) => [entry.name, entry.origin, entry.trust, entry.state])).toEqual([
    ["friday-weather", "external", "local", "enabled"],
    ["arxiv", "builtin", "builtin", "disabled"],
  ]);

  // Nonsense tokens are still refused, and the refusal says what happened instead of blaming the distro.
  wired.invoke = async () => ({ count: 1, skills: [
    { name: "broken", category: "x", origin: "has space", trust: "local", state: "enabled" }] });
  await expect(service.skillInventory()).rejects.toMatchObject({
    code: "ADAPTER_UNAVAILABLE", message: expect.stringContaining("Hermes-Bruecke in WSL") });
});
