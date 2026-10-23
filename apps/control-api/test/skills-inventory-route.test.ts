import { expect, it } from "vitest";
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