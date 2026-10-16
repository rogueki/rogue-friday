import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { startTestApi, type TestApi } from "./helpers";
import { SkillsService } from "../src/services/skills";

const steps = { intro: "completed", profile: "skipped", skills: "completed", accounts: "skipped", finish: "pending" };
const update = { preferredName: "Alex", steps, goals: ["Recherche"], selectedSkillIds: ["friday:research"] };

describe("skills and resumable onboarding", () => {
  let api: TestApi;
  let hermesEnabled = false;
  let hermesUp = true;
  let calls = 0;

  beforeAll(async () => {
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (!hermesUp) throw new Error("offline");
      if (url.endsWith("/")) return new Response('<script>window.__HERMES_SESSION_TOKEN__="test-token-123456"</script>');
      if (url.endsWith("/api/skills/toggle")) {
        calls += 1;
        const body = JSON.parse(String(init?.body));
        if (body.name !== "research") throw new Error("unexpected skill");
        hermesEnabled = body.enabled;
        return Response.json({ ok: true });
      }
      if (url.endsWith("/api/skills")) return Response.json({ skills: [
        { name: "research", description: "Live research", category: "Research", enabled: hermesEnabled },
        { name: "powerpoint", description: "Presentations", category: "Office", enabled: true },
      ] });
      throw new Error("unexpected URL");
    };
    api = await startTestApi({ providerFetch: fetcher, env: { FRIDAY_HERMES_DASHBOARD_URL: "http://127.0.0.1:43791" } });
    const registry = join(api.dir, "registry");
    mkdirSync(registry);
    writeFileSync(join(registry, "skills.json"), JSON.stringify({ skills: [{ name: "research", category: "Research", trigger: "Static research", version: "1.0.0", implemented: true }] }));
    writeFileSync(join(registry, "integration_setup.json"), JSON.stringify({ schema_version: 1, inventory_count: 1,
      integrations: { search: { account: "required", setup_de: "Search account", reference: "https://example.test/search", settings_target: "/settings" } },
      skills: { research: { required_integrations: ["search"], conditional_integrations: [], setup_de: "Start research", live_status: "enabled" } },
    }));
    api.runtime.skills = new SkillsService({
      catalogPath: join(registry, "integration_setup.json"), dashboardUrl: "http://127.0.0.1:43791", fetcher,
    });
  });
  afterAll(async () => { await api.close(); });

  it("guards owner catalog and mutations", async () => {
    expect((await api.client().get("/api/v1/skills")).statusCode).toBe(401);
    const viewer = api.client(); await viewer.loginDev("viewer");
    expect((await viewer.get("/api/v1/skills")).statusCode).toBe(403);
    expect((await viewer.get("/api/v1/onboarding")).statusCode).toBe(403);
    const owner = api.client(); await owner.loginDev("owner");
    expect((await owner.request("PUT", "/api/v1/onboarding", { body: update, csrf: false, headers: { "if-match": "0" } })).statusCode).toBe(403);
    expect((await owner.request("PUT", "/api/v1/skills/friday:research/activation", { body: { enabled: true }, csrf: false })).statusCode).toBe(403);
  });

  it("limits the local voice bridge to catalog and onboarding, never activation", async () => {
    const voice = api.client();
    const headers = { authorization: `Bearer ${api.runtime.voiceBridgeKey.toString("base64")}` };
    expect((await voice.request("GET", "/api/v1/skills", { headers })).statusCode).toBe(200);
    const state = await voice.request("GET", "/api/v1/onboarding", { headers });
    expect(state.statusCode).toBe(200);
    expect((await voice.request("PUT", "/api/v1/onboarding", { headers: { ...headers, "if-match": "999" }, body: update })).statusCode).toBe(409);
    expect((await voice.request("PUT", "/api/v1/skills/friday:research/activation", { headers, body: { enabled: true } })).statusCode).toBe(401);
    expect((await voice.request("GET", "/api/v1/settings", { headers })).statusCode).toBe(401);
  });

  it("keeps static metadata separate from observed Hermes activation", async () => {
    const owner = api.client(); await owner.loginDev("owner");
    const data = (await owner.get("/api/v1/skills")).json().data;
    expect(data).toHaveLength(2);
    expect(data[0]).toMatchObject({ id: "friday:research", packaged: true, discovered: true, enabled: false,
      accounts: ["search"], integrationDetails: [{ configured: null, connectionChecked: null }] });
    expect(data[1]).toMatchObject({ id: "hermes:powerpoint", packaged: false, discovered: true, enabled: true,
      requiredCapabilities: [expect.stringContaining("python-pptx")], integrationDetails: [{ configured: null, connectionChecked: null }] });
    expect((await owner.request("PUT", "/api/v1/skills/friday:unknown/activation", { body: { enabled: true } })).statusCode).toBe(404);
    expect((await owner.request("PUT", "/api/v1/skills/friday:research/activation", { body: { enabled: true } })).json().data.enabled).toBe(true);
    expect(calls).toBe(1);
    hermesUp = false;
    const unavailable = (await owner.get("/api/v1/skills")).json().data;
    expect(unavailable[0]).toMatchObject({ discovered: null, enabled: null });
    expect((await owner.request("PUT", "/api/v1/skills/friday:research/activation", { body: { enabled: false } })).statusCode).toBe(503);
    hermesUp = true;
  });

  it("persists per-step decisions with optimistic concurrency and completion only after all decisions", async () => {
    const owner = api.client(); await owner.loginDev("owner");
    expect((await owner.get("/api/v1/onboarding")).json().data).toMatchObject({ revision: 0, steps: { intro: "pending" }, completedAt: null });
    expect((await owner.request("PUT", "/api/v1/onboarding", { body: update })).statusCode).toBe(422);
    expect((await owner.request("PUT", "/api/v1/onboarding", { body: { ...update, steps: { ...steps, accounts: "completed" } }, headers: { "if-match": "0" } })).statusCode).toBe(422);
    const first = await owner.request("PUT", "/api/v1/onboarding", { body: update, headers: { "if-match": "0" } });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().data).toMatchObject({ revision: 1, preferredName: "Alex", completedAt: null });
    expect(api.runtime.settings.get().profile.displayName).toBe("Alex");
    expect((await owner.request("PUT", "/api/v1/onboarding", { body: update, headers: { "if-match": "0" } })).statusCode).toBe(409);
    const settings = api.runtime.settings.get();
    api.runtime.settings.patch({ profile: { ...settings.profile, displayName: "Anderer Anzeigename" } }, settings.version);
    const done = await owner.request("PUT", "/api/v1/onboarding", { body: { ...update, steps: { ...steps, finish: "completed" } }, headers: { "if-match": "1" } });
    expect(done.json().data.completedAt).toBeTruthy();
    expect(api.runtime.settings.get().profile.displayName).toBe("Anderer Anzeigename");
    expect((await owner.get("/api/v1/onboarding")).json().data.revision).toBe(2);
    const legacy = done.json().data;
    api.runtime.db.prepare("UPDATE owner_onboarding SET json = ? WHERE id = 1")
      .run(JSON.stringify({ ...legacy, steps: { ...legacy.steps, accounts: "completed" } }));
    expect((await owner.get("/api/v1/onboarding")).json().data.steps.accounts).toBe("skipped");
  });

  it("keeps owner progress after a process restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "friday-onboarding-restart-"));
    try {
      const first = await startTestApi({ dir });
      const owner = first.client(); await owner.loginDev("owner");
      expect((await owner.get("/api/v1/onboarding")).json().data.revision).toBe(0);
      expect((await owner.request("PUT", "/api/v1/onboarding", { body: update, headers: { "if-match": "0" } })).statusCode).toBe(200);
      await first.close();
      const restarted = await startTestApi({ dir });
      const again = restarted.client(); await again.loginDev("owner");
      expect((await again.get("/api/v1/onboarding")).json().data).toMatchObject({ revision: 1, preferredName: "Alex", goals: ["Recherche"] });
      await restarted.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("does not convert inconsistent static catalog flags into runtime status", async () => {
    const dir = mkdtempSync(join(tmpdir(), "friday-skill-catalog-"));
    try {
      writeFileSync(join(dir, "skills.json"), JSON.stringify({ skills: [{ name: "research", implemented: true }] }));
      writeFileSync(join(dir, "integration_setup.json"), JSON.stringify({ schema_version: 1, inventory_count: 2, skills: {} }));
      const service = new SkillsService({ catalogPath: join(dir, "integration_setup.json") });
      const result = await service.list();
      expect(result.skills).toEqual([]);
      expect(result.fresh).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("keeps a discovered Hermes skill with missing activation as unknown", async () => {
    const fetcher: typeof fetch = async (input) => String(input).endsWith("/api/skills")
      ? Response.json({ skills: [{ name: "powerpoint", enabled: "yes" }] })
      : new Response('<script>window.__HERMES_SESSION_TOKEN__="test-token-123456"</script>');
    const service = new SkillsService({ dashboardUrl: "http://127.0.0.1:43791", fetcher });
    const listed = await service.list();
    expect(listed.skills).toMatchObject([{ id: "hermes:powerpoint", discovered: true, enabled: null }]);
    await expect(service.toggle("hermes:powerpoint", true)).rejects.toThrow("nicht bestätigt");
  });

  it("shows account setup metadata for Hermes built-ins with connector or optional credential prerequisites", async () => {
    const fetcher: typeof fetch = async (input) => String(input).endsWith("/api/skills")
      ? Response.json({ skills: [
        { name: "powerpoint", enabled: true },
        { name: "airtable", enabled: false },
        { name: "opencode", enabled: true },
        { name: "hermes-agent", enabled: true },
        { name: "email-inbox-triage", enabled: true },
        { name: "llm-wiki", enabled: false },
        { name: "blocked-page-recovery", enabled: true },
      ] })
      : new Response('<script>window.__HERMES_SESSION_TOKEN__="test-token-123456"</script>');
    const result = await new SkillsService({ dashboardUrl: "http://127.0.0.1:43791", fetcher }).list();
    const byName = new Map(result.skills.map((skill) => [skill.name, skill]));
    expect(byName.get("powerpoint")).toMatchObject({ accounts: [], integrationDetails: [{ account: "none", required: true }],
      requiredCapabilities: [expect.stringContaining("python-pptx")] });
    expect(byName.get("airtable")).toMatchObject({ accounts: ["hermes_airtable"], integrationDetails: [{ account: "required", required: true }],
      requiredCapabilities: [expect.stringContaining("Personal Access Token")] });
    expect(byName.get("opencode")).toMatchObject({ accounts: ["hermes_opencode"], integrationDetails: [{ account: "conditional", required: true }],
      setupRefs: [], requiredCapabilities: [expect.stringContaining("OpenCode CLI")] });
    expect(byName.get("email-inbox-triage")).toMatchObject({ accounts: ["hermes_email_inbox_triage"],
      integrationDetails: [{ account: "conditional", setupDe: expect.stringContaining("Himalaya"), settingsTarget: "Hermes-Einstellungen in Friday-Ubuntu" }],
      requiredCapabilities: [expect.stringContaining("Google-Workspace-Connector")] });
    expect(byName.get("llm-wiki")).toMatchObject({ accounts: ["hermes_llm_wiki"],
      integrationDetails: [{ account: "conditional", setupDe: expect.stringContaining("aktivem Sync-Abonnement") }],
      requiredCapabilities: [expect.stringContaining("Markdown-Pfad")] });
    expect(byName.get("blocked-page-recovery")).toMatchObject({ accounts: ["hermes_blocked_page_recovery"],
      integrationDetails: [{ account: "conditional", setupDe: expect.stringContaining("JINA_API_KEY") }],
      requiredCapabilities: [expect.stringContaining("Jina-API-Key")] });
    expect(byName.get("hermes-agent")).toMatchObject({ accounts: [], integrationDetails: [], requiredCapabilities: [], conditionalCapabilities: [] });
  });

  const realCatalog = resolve(process.cwd(), "..", "..", "Skills", "registry", "integration_setup.json");
  it.runIf(existsSync(realCatalog))("loads every skill from the packaged registry", async () => {
    const result = await new SkillsService({ catalogPath: realCatalog }).list();
    expect(result.skills).toHaveLength(105);
    expect(result.skills.every((skill) => skill.source === "friday" && skill.packaged && skill.enabled === null)).toBe(true);
  });
});
