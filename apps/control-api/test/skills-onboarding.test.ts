import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { startTestApi, type TestApi } from "./helpers";
import { SkillsService } from "../src/services/skills";
import type { AdapterConfigSettings } from "@friday/sdk";

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
    expect(byName.get("opencode")).toMatchObject({ accounts: ["hermes_opencode"], integrationDetails: [{ account: "conditional", required: false }],
      setupRefs: [], requiredCapabilities: [expect.stringMatching(/OpenCode.*CLI/)] });
    expect(byName.get("email-inbox-triage")).toMatchObject({ accounts: ["hermes_email_inbox_triage"],
      integrationDetails: [{ account: "conditional", setupDe: expect.stringContaining("Himalaya"), settingsTarget: "Hermes-Einstellungen in Friday-Ubuntu" }],
      requiredCapabilities: [expect.stringContaining("Google-Workspace-Connector")] });
    expect(byName.get("llm-wiki")).toMatchObject({ accounts: ["hermes_llm_wiki_sync"],
      integrationDetails: [{ account: "none", required: true, setupDe: expect.stringContaining("Markdown-Wiki") },
        { account: "conditional", required: false, setupDe: expect.stringContaining("Sync-Abonnement") }],
      requiredCapabilities: [expect.stringContaining("Markdown-Ordner")] });
    expect(byName.get("blocked-page-recovery")).toMatchObject({ accounts: ["hermes_blocked_page_recovery"],
      integrationDetails: [{ account: "conditional", setupDe: expect.stringContaining("JINA_API_KEY") }],
      requiredCapabilities: [expect.stringContaining("Jina-API-Key")] });
    expect(byName.get("hermes-agent")).toMatchObject({ accounts: [],
      integrationDetails: [{ account: "none", configured: null, connectionChecked: null }],
      requiredCapabilities: [expect.stringContaining("Hermes-Installation")], conditionalCapabilities: [] });
  });

  it("reports native coding CLI readiness without conflating it with Hermes activation or exposing status details", async () => {
    const fetcher: typeof fetch = async (input) => String(input).endsWith("/api/skills")
      ? Response.json({ skills: [
        { name: "codex", enabled: true }, { name: "opencode", enabled: false }, { name: "claude-code", enabled: true },
      ] })
      : new Response('<script>window.__HERMES_SESSION_TOKEN__="test-token-123456"</script>');
    let failed = false;
    let unknown = false;
    let opencodeSignedOut = false;
    let reads = 0;
    const service = new SkillsService({ dashboardUrl: "http://127.0.0.1:43791", fetcher,
      codingCliStatus: async () => {
        reads += 1;
        if (failed) throw new Error("private WSL failure detail");
        return [
          { cli: "codex", installed: true, version: "1.2.3", authState: unknown ? "unknown" : "signed_in" },
          { cli: "opencode", installed: true, version: "2.3.4", authState: opencodeSignedOut ? "signed_out" : "stored_credentials" },
          { cli: "claude-code", installed: false, version: null, authState: "signed_in" },
        ];
      },
    });
    const status = async () => {
      const listed = await service.list();
      expect(listed.skills).toHaveLength(3);
      expect(JSON.stringify(listed)).not.toMatch(/1\.2\.3|2\.3\.4|private WSL failure detail/);
      return new Map(listed.skills.map((skill) => [skill.id, skill]));
    };
    let entries = await status();
    expect(entries.get("hermes:codex")).toMatchObject({ enabled: true, integrationDetails: [{ configured: true, connectionChecked: null }] });
    expect(entries.get("hermes:opencode")).toMatchObject({ enabled: false, integrationDetails: [{ configured: true, connectionChecked: null }] });
    expect(entries.get("hermes:claude-code")).toMatchObject({ enabled: true, integrationDetails: [{ configured: false, connectionChecked: null }] });
    unknown = true;
    opencodeSignedOut = true;
    entries = await status();
    expect(entries.get("hermes:codex")?.integrationDetails[0]).toMatchObject({ configured: null, connectionChecked: null });
    expect(entries.get("hermes:opencode")?.integrationDetails[0]).toMatchObject({ configured: false, connectionChecked: null });
    failed = true;
    entries = await status();
    for (const entry of entries.values()) expect(entry.integrationDetails[0]).toMatchObject({ configured: null, connectionChecked: null });
    expect(reads).toBe(3);
  });

  it("reads locally configured Content Studio keys anew for matching Friday integrations", async () => {
    const dir = mkdtempSync(join(tmpdir(), "friday-skill-key-status-"));
    let localApi: TestApi | undefined;
    try {
      const registry = join(dir, "registry");
      mkdirSync(registry);
      const names = ["kie-skill", "eleven-skill", "other-skill"];
      writeFileSync(join(registry, "skills.json"), JSON.stringify({ skills: names.map((name) => ({ name })) }));
      writeFileSync(join(registry, "integration_setup.json"), JSON.stringify({ schema_version: 1, inventory_count: names.length,
        integrations: { kie_ai: { account: "required" }, elevenlabs: { account: "required" }, unrelated: { account: "required" } },
        skills: {
          "kie-skill": { required_integrations: ["kie_ai"] },
          "eleven-skill": { required_integrations: ["elevenlabs"] },
          "other-skill": { required_integrations: ["unrelated"] },
        },
      }));
      const fetcher: typeof fetch = async (input) => String(input).endsWith("/api/skills")
        ? Response.json({ skills: [] })
        : new Response('<script>window.__HERMES_SESSION_TOKEN__="test-token-123456"</script>');
      localApi = await startTestApi({ dir, providerFetch: fetcher,
        env: { FRIDAY_SKILLS_CATALOG_PATH: join(registry, "integration_setup.json"), FRIDAY_HERMES_DASHBOARD_URL: "http://127.0.0.1:43791" } });
      const owner = localApi.client(); await owner.loginDev("owner");
      const integrations = async () => {
        const response = await owner.get("/api/v1/skills");
        expect(response.statusCode, response.body).toBe(200);
        return new Map<string, { configured: boolean | null; connectionChecked: boolean | null }>(response.json().data.map(
          (skill: { id: string; integrationDetails: { configured: boolean | null; connectionChecked: boolean | null }[] }) =>
            [skill.id, skill.integrationDetails[0]!] as const));
      };
      let current = await integrations();
      expect(current.get("friday:kie-skill")).toMatchObject({ configured: false, connectionChecked: null });
      expect(current.get("friday:eleven-skill")).toMatchObject({ configured: false, connectionChecked: null });
      expect(current.get("friday:other-skill")).toMatchObject({ configured: null, connectionChecked: null });
      expect((await owner.patch("/api/v1/settings/content-studio-keys", { provider: "kie", key: "private-kie-status" })).statusCode).toBe(200);
      expect((await owner.patch("/api/v1/settings/content-studio-keys", { provider: "elevenlabs", key: "private-eleven-status" })).statusCode).toBe(200);
      current = await integrations();
      expect(current.get("friday:kie-skill")).toMatchObject({ configured: true, connectionChecked: null });
      expect(current.get("friday:eleven-skill")).toMatchObject({ configured: true, connectionChecked: null });
      expect(current.get("friday:other-skill")).toMatchObject({ configured: null, connectionChecked: null });
      expect((await owner.get("/api/v1/skills")).body).not.toMatch(/private-(kie|eleven)-status/);
      expect((await owner.patch("/api/v1/settings/content-studio-keys", { provider: "kie", key: "" })).statusCode).toBe(200);
      current = await integrations();
      expect(current.get("friday:kie-skill")).toMatchObject({ configured: false, connectionChecked: null });
      expect(current.get("friday:eleven-skill")).toMatchObject({ configured: true, connectionChecked: null });
    } finally {
      await localApi?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports local Hermes key and Obsidian readiness without disclosing values or hiding skills on failure", async () => {
    const dir = mkdtempSync(join(tmpdir(), "friday-local-skill-status-"));
    try {
      writeFileSync(join(dir, "skills.json"), JSON.stringify({ skills: [{ name: "vault-skill" }] }));
      writeFileSync(join(dir, "integration_setup.json"), JSON.stringify({ schema_version: 1, inventory_count: 1,
        integrations: { obsidian: { account: "none" } },
        skills: { "vault-skill": { required_integrations: ["obsidian"] } },
      }));
      const fetcher: typeof fetch = async (input) => String(input).endsWith("/api/skills")
        ? Response.json({ skills: ["airtable", "notion", "gif-search", "blocked-page-recovery", "obsidian", "teams-meeting-pipeline"].map((name) => ({ name, enabled: true })) })
        : new Response('<script>window.__HERMES_SESSION_TOKEN__="test-token-123456"</script>');
      let fail = false;
      let vaultReadable = true;
      let keyReads = 0;
      let vaultReads = 0;
      const service = new SkillsService({ catalogPath: join(dir, "integration_setup.json"), dashboardUrl: "http://127.0.0.1:43791", fetcher,
        hermesKeyStatus: async () => { keyReads += 1; if (fail) throw new Error("WSL unavailable"); return { configured: {
          AIRTABLE_API_KEY: true, NOTION_API_KEY: false, TENOR_API_KEY: true, JINA_API_KEY: false,
          MSGRAPH_TENANT_ID: true, MSGRAPH_CLIENT_ID: true, MSGRAPH_CLIENT_SECRET: false,
        }, secret: "synthetic-private-value" }; },
        obsidianVaultStatus: async () => { vaultReads += 1; if (fail) throw new Error("Vault unavailable"); return { configured: true, readable: vaultReadable }; },
      });
      const configured = await service.list();
      const status = (id: string, listed = configured) => listed.skills.find((skill) => skill.id === id)?.integrationDetails[0];
      expect(status("hermes:airtable")).toMatchObject({ configured: true, connectionChecked: null });
      expect(status("hermes:notion")).toMatchObject({ configured: false, connectionChecked: null });
      expect(status("hermes:gif-search")).toMatchObject({ configured: true, connectionChecked: null });
      expect(status("hermes:blocked-page-recovery")).toMatchObject({ configured: false, connectionChecked: null });
      expect(status("hermes:teams-meeting-pipeline")).toMatchObject({ configured: false, connectionChecked: null });
      expect(status("hermes:obsidian")).toMatchObject({ configured: true, connectionChecked: null });
      expect(status("friday:vault-skill")).toMatchObject({ configured: true, connectionChecked: null });
      expect(keyReads).toBe(1);
      expect(vaultReads).toBe(1);
      expect(JSON.stringify(configured)).not.toContain("synthetic-private-value");
      const allGraphValues = new SkillsService({ catalogPath: join(dir, "integration_setup.json"), dashboardUrl: "http://127.0.0.1:43791", fetcher,
        hermesKeyStatus: async () => ({ configured: { AIRTABLE_API_KEY: false, NOTION_API_KEY: false, TENOR_API_KEY: false, JINA_API_KEY: false,
          MSGRAPH_TENANT_ID: true, MSGRAPH_CLIENT_ID: true, MSGRAPH_CLIENT_SECRET: true } }),
      });
      expect((await allGraphValues.list()).skills.find((skill) => skill.id === "hermes:teams-meeting-pipeline")?.integrationDetails[0])
        .toMatchObject({ configured: true, connectionChecked: null });
      vaultReadable = false;
      const unreadable = await service.list();
      expect(status("friday:vault-skill", unreadable)).toMatchObject({ configured: false, connectionChecked: null });
      expect(status("hermes:obsidian", unreadable)).toMatchObject({ configured: false, connectionChecked: null });
      fail = true;
      const unknown = await service.list();
      expect(unknown.skills).toHaveLength(configured.skills.length);
      expect(status("hermes:airtable", unknown)).toMatchObject({ configured: null, connectionChecked: null });
      expect(status("hermes:teams-meeting-pipeline", unknown)).toMatchObject({ configured: null, connectionChecked: null });
      expect(status("friday:vault-skill", unknown)).toMatchObject({ configured: null, connectionChecked: null });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("reports llm-wiki local readiness separately from optional Obsidian Sync", async () => {
    const fetcher: typeof fetch = async (input) => String(input).endsWith("/api/skills")
      ? Response.json({ skills: [{ name: "llm-wiki", enabled: true }] })
      : new Response('<script>window.__HERMES_SESSION_TOKEN__="test-token-123456"</script>');
    let readable = false;
    const service = new SkillsService({ dashboardUrl: "http://127.0.0.1:43791", fetcher,
      wikiPathStatus: async () => ({ configured: readable, readable }), });
    const details = async () => (await service.list()).skills.find((entry) => entry.id === "hermes:llm-wiki")?.integrationDetails;
    expect(await details()).toMatchObject([
      { id: "hermes_llm_wiki", required: true, account: "none", configured: false, connectionChecked: null },
      { id: "hermes_llm_wiki_sync", required: false, account: "conditional", configured: null, connectionChecked: null },
    ]);
    readable = true;
    expect((await details())?.[0]).toMatchObject({ configured: true, connectionChecked: null });
  });

  it("shares one Himalaya status read for generic IMAP/SMTP and Hermes mail without claiming a connection", async () => {
    const dir = mkdtempSync(join(tmpdir(), "friday-mail-skill-status-"));
    try {
      writeFileSync(join(dir, "skills.json"), JSON.stringify({ skills: [
        { name: "friday-mail-one" }, { name: "friday-mail-two" },
      ] }));
      writeFileSync(join(dir, "integration_setup.json"), JSON.stringify({ schema_version: 1, inventory_count: 2,
        integrations: { imap_smtp_mail: { account: "required" }, gmx: { account: "conditional" } },
        skills: {
          "friday-mail-one": { required_integrations: ["imap_smtp_mail"], conditional_integrations: ["gmx"] },
          "friday-mail-two": { required_integrations: ["imap_smtp_mail"] },
        },
      }));
      const fetcher: typeof fetch = async (input) => String(input).endsWith("/api/skills")
        ? Response.json({ skills: [{ name: "himalaya", enabled: true }] })
        : new Response('<script>window.__HERMES_SESSION_TOKEN__="test-token-123456"</script>');
      let ready = false;
      let fail = false;
      let reads = 0;
      const service = new SkillsService({ catalogPath: join(dir, "integration_setup.json"),
        dashboardUrl: "http://127.0.0.1:43791", fetcher,
        himalayaAccountStatus: async () => { reads += 1; if (fail) throw new Error("WSL unavailable"); return { readyForLocalUse: ready }; },
      });
      const details = async () => new Map((await service.list()).skills.map((skill) => [skill.id, skill.integrationDetails]));
      const unready = await details();
      expect(reads).toBe(1);
      expect(unready.get("friday:friday-mail-one")).toMatchObject([
        { id: "imap_smtp_mail", configured: false, connectionChecked: null },
        { id: "gmx", configured: null, connectionChecked: null },
      ]);
      expect(unready.get("friday:friday-mail-two")?.[0]).toMatchObject({ configured: false, connectionChecked: null });
      expect(unready.get("hermes:himalaya")?.[0]).toMatchObject({ configured: false, connectionChecked: null });
      ready = true;
      const configured = await details();
      expect(reads).toBe(2);
      for (const id of ["friday:friday-mail-one", "friday:friday-mail-two", "hermes:himalaya"])
        expect(configured.get(id)?.[0]).toMatchObject({ configured: true, connectionChecked: null });
      expect(configured.get("friday:friday-mail-one")?.[1]).toMatchObject({ configured: null, connectionChecked: null });
      fail = true;
      const unknown = await details();
      expect(reads).toBe(3);
      for (const id of ["friday:friday-mail-one", "friday:friday-mail-two", "hermes:himalaya"])
        expect(unknown.get(id)?.[0]).toMatchObject({ configured: null, connectionChecked: null });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("separates working local calendar storage from optional CalDAV configuration", async () => {
    const dir = mkdtempSync(join(tmpdir(), "friday-calendar-skill-status-"));
    try {
      writeFileSync(join(dir, "skills.json"), JSON.stringify({ skills: [{ name: "friday-calendar-manager" }] }));
      writeFileSync(join(dir, "integration_setup.json"), JSON.stringify({ schema_version: 1, inventory_count: 1,
        integrations: { friday_local_calendar: { account: "none" }, caldav: { account: "required" } },
        skills: { "friday-calendar-manager": { required_integrations: ["friday_local_calendar"], conditional_integrations: ["caldav"] } },
      }));
      let localReady = true;
      let statusFailure = false;
      const adapter: AdapterConfigSettings = { adapterId: "caldav-calendar", category: "calendar", provider: "caldav-calendar",
        enabled: false, config: { mode: "caldav" }, configSchema: {}, secretFields: {} };
      const service = new SkillsService({ catalogPath: join(dir, "integration_setup.json"),
        localCalendarStatus: () => { if (statusFailure) throw new Error("database unavailable"); return localReady; },
        calendarAdapterStatus: () => { if (statusFailure) throw new Error("adapter state unavailable"); return [adapter]; },
      });
      const details = async () => (await service.list()).skills[0]?.integrationDetails;
      expect(await details()).toMatchObject([
        { id: "friday_local_calendar", required: true, configured: true, connectionChecked: null },
        { id: "caldav", required: false, configured: false, connectionChecked: null },
      ]);
      adapter.enabled = true;
      adapter.secretFields = { calendarUrl: { configured: true }, username: { configured: true }, password: { configured: false } };
      expect((await details())?.[1]).toMatchObject({ configured: false, connectionChecked: null });
      adapter.secretFields.password = { configured: true };
      adapter.config.mode = "ics";
      expect((await details())?.[1]).toMatchObject({ configured: false, connectionChecked: null });
      adapter.config.mode = "caldav";
      expect((await details())?.[1]).toMatchObject({ configured: true, connectionChecked: null });
      localReady = false;
      expect((await details())?.[0]).toMatchObject({ configured: false, connectionChecked: null });
      statusFailure = true;
      expect(await details()).toMatchObject([
        { configured: null, connectionChecked: null }, { configured: null, connectionChecked: null },
      ]);
      const localApi = await startTestApi({ env: { FRIDAY_SKILLS_CATALOG_PATH: join(dir, "integration_setup.json") } });
      try {
        const owner = localApi.client(); await owner.loginDev("owner");
        const response = await owner.get("/api/v1/skills");
        expect(response.statusCode, response.body).toBe(200);
        expect(response.json().data.find((skill: { id: string }) => skill.id === "friday:friday-calendar-manager")?.integrationDetails)
          .toMatchObject([{ configured: true, connectionChecked: null }, { configured: false, connectionChecked: null }]);
      } finally { await localApi.close(); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("reports SIP and CloudTalk API setup independently without claiming a provider connection", async () => {
    const dir = mkdtempSync(join(tmpdir(), "friday-phone-skill-status-"));
    try {
      writeFileSync(join(dir, "skills.json"), JSON.stringify({ skills: [{ name: "friday-phone-call-coordinator" }] }));
      writeFileSync(join(dir, "integration_setup.json"), JSON.stringify({ schema_version: 1, inventory_count: 1,
        integrations: { telephony: { account: "required" }, cloudtalk_api: { account: "conditional" } },
        skills: { "friday-phone-call-coordinator": { required_integrations: ["telephony"], conditional_integrations: ["cloudtalk_api"] } },
      }));
      let sipConfigured = false;
      let sipReady = false;
      let cloudTalkConfigured = false;
      let agentId: number | null = null;
      let failSip = false;
      let failCloudTalk = false;
      const service = new SkillsService({ catalogPath: join(dir, "integration_setup.json"),
        telephonyStatus: async () => { if (failSip) throw new Error("SIP unavailable");
          return { configured: sipConfigured, ready: sipReady }; },
        cloudTalkStatus: () => { if (failCloudTalk) throw new Error("CloudTalk profile unavailable");
          return { configured: cloudTalkConfigured, agentId }; },
      });
      const details = async () => (await service.list()).skills[0]?.integrationDetails;
      expect(await details()).toMatchObject([
        { id: "telephony", configured: false, connectionChecked: null },
        { id: "cloudtalk_api", configured: false, connectionChecked: null },
      ]);
      cloudTalkConfigured = true;
      expect((await details())?.[1]).toMatchObject({ configured: false, connectionChecked: null });
      agentId = 42;
      expect((await details())?.[1]).toMatchObject({ configured: true, connectionChecked: null });
      expect((await details())?.[0]).toMatchObject({ configured: false, connectionChecked: null });
      sipConfigured = true;
      cloudTalkConfigured = false;
      expect(await details()).toMatchObject([
        { configured: true, connectionChecked: null }, { configured: false, connectionChecked: null },
      ]);
      sipReady = true;
      expect((await details())?.[0]).toMatchObject({ configured: true, connectionChecked: null });
      failSip = true;
      failCloudTalk = true;
      expect(await details()).toMatchObject([
        { configured: null, connectionChecked: null }, { configured: null, connectionChecked: null },
      ]);

      const localApi = await startTestApi({ env: { FRIDAY_SKILLS_CATALOG_PATH: join(dir, "integration_setup.json") } });
      try {
        const owner = localApi.client(); await owner.loginDev("owner");
        const listed = async () => (await owner.get("/api/v1/skills")).json().data[0].integrationDetails;
        expect(await listed()).toMatchObject([
          { configured: null, connectionChecked: null }, { configured: false, connectionChecked: null },
        ]);
        const realStatus = localApi.runtime.cloudtalk.status.bind(localApi.runtime.cloudtalk);
        localApi.runtime.cloudtalk.status = () => ({ ...realStatus(), configured: true, agentId: 42 });
        expect((await listed())?.[1]).toMatchObject({ configured: true, connectionChecked: null });
      } finally { await localApi.close(); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  const realCatalog = resolve(process.cwd(), "..", "..", "Skills", "registry", "integration_setup.json");
  it.runIf(existsSync(realCatalog))("loads every skill from the packaged registry", async () => {
    const result = await new SkillsService({ catalogPath: realCatalog }).list();
    expect(result.skills).toHaveLength(105);
    expect(result.skills.every((skill) => skill.source === "friday" && skill.packaged && skill.enabled === null)).toBe(true);
  });
});

it("preserves version 2 permission and cost metadata and marks legacy gaps unknown", async () => {
  const dir = mkdtempSync(join(tmpdir(), "friday-skill-rights-"));
  try {
    writeFileSync(join(dir, "skills.json"), JSON.stringify({ skills: [{ id: "rights-example", category: "Test", description: "Test" }] }));
    const metadata = { schema_version: 2, inventory_count: 1,
      integrations: { provider: { account: "required", setup_de: "Anbieter einrichten", permissions: {
        required_prerequisites: [{ kind: "provider_account", status: "required", notice: "Konto mit Leserecht" }],
        optional_prerequisites: [], scope_status: "unknown", scope_notice: "Konkrete Scopes beim Anbieter prüfen"
      }, cost: { model: "provider_usage", notice: "Nutzung beim Anbieter prüfen" } } },
      skills: { "rights-example": { required_integrations: ["provider"], conditional_integrations: [] } } };
    writeFileSync(join(dir, "integration_setup.json"), JSON.stringify(metadata));
    const service = new SkillsService({ catalogPath: join(dir, "integration_setup.json") });
    const current = (await service.list()).skills[0]?.integrationDetails[0];
    expect(current).toMatchObject({ permissions: { required_prerequisites: [{ kind: "provider_account", status: "required", notice: "Konto mit Leserecht" }], scope_status: "unknown" }, cost: { model: "provider_usage", notice: "Nutzung beim Anbieter prüfen" } });
    writeFileSync(join(dir, "integration_setup.json"), JSON.stringify({ ...metadata, schema_version: 1,
      integrations: { provider: { account: "required", setup_de: "Anbieter einrichten" } } }));
    const legacy = (await service.list()).skills[0]?.integrationDetails[0];
    expect(legacy).toMatchObject({ permissions: { scope_status: "unknown", scope_notice: expect.stringContaining("nicht vollständig katalogisiert") }, cost: { model: "unknown" } });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
