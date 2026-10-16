import type { SkillCatalogEntry } from "@friday/sdk";
import { describe, expect, it } from "vitest";
import { accountSetupView } from "./SkillAccountsArea";

const integration = (id: string) => ({
  id, account: "required" as const, required: true, setupDe: "Setup", reference: "", settingsTarget: "Hermes-Einstellungen in Friday-Ubuntu",
  configured: null, connectionChecked: null, requiredBy: ["Test"],
}) satisfies SkillCatalogEntry["integrationDetails"][number] & { requiredBy: string[] };

describe("Skill account setup paths", () => {
  it("opens actual calendar, mail and coding CLI setup sections without claiming a live connection", () => {
    const calendar = accountSetupView(integration("caldav"), undefined);
    expect(calendar.href).toBe("/settings?area=adapters#calendar-setup-title");
    expect(calendar.state).toContain("nicht geprüft");
    const mail = accountSetupView(integration("gmx"), undefined);
    expect(mail.href).toBe("/settings?area=skillAccounts#himalaya-account-title");
    expect(mail.state).toContain("separat");
    expect(accountSetupView(integration("coding_cli"), undefined).href).toBe("/settings?area=skillAccounts#coding-cli-setup-title");
  });
  it("links generic Friday IMAP/SMTP skills to the owner form and distinguishes local readiness from a connection", () => {
    const href = "/settings?area=skillAccounts#himalaya-account-title";
    for (const [configured, expected] of [[null, "unbekannt"], [false, "noch nicht lokal bereit"], [true, "lokal bereit"]] as const) {
      const setup = accountSetupView({ ...integration("imap_smtp_mail"), configured }, undefined);
      expect(setup.href).toBe(href);
      expect(setup.action).toContain("IMAP/SMTP-Postfach");
      expect(setup.state).toContain(expected);
      expect(setup.state).toContain("Verbindung nicht geprüft");
    }
    expect(accountSetupView(integration("gmx"), undefined).state).toContain("GMX-Skill-Adapter separat");
    expect(accountSetupView(integration("hermes_himalaya"), undefined).href).toBe(href);
  });
  it("opens the encrypted Friday key form without claiming a provider login", () => {
    const setup = accountSetupView(integration("kie_ai"), { kie: true, elevenlabs: false, capcut: false });
    expect(setup.href).toBe("/settings?area=contentStudioKeys");
    expect(setup.state).toContain("Schlüssel hinterlegt");
    expect(setup.state).toContain("Anbieterzugriff nicht geprüft");
    expect(accountSetupView(integration("elevenlabs"), { kie: true, elevenlabs: false, capcut: false }).state).toContain("Schlüssel fehlt");
  });

  it("points a supported Hermes account to its owner form and reports presence only", () => {
    const setup = accountSetupView(integration("hermes_notion"), undefined);
    expect(setup.href).toContain("skillAccounts");
    expect(setup.state).toContain("unbekannt");
    const configured = accountSetupView(integration("hermes_notion"), undefined, { configured: { AIRTABLE_API_KEY: false, NOTION_API_KEY: true, TENOR_API_KEY: false, JINA_API_KEY: false, MSGRAPH_TENANT_ID: false, MSGRAPH_CLIENT_ID: false, MSGRAPH_CLIENT_SECRET: false }, applied: null });
    expect(configured.state).toContain("hinterlegt");
    expect(configured.state).toContain("Anbieterzugriff nicht geprüft");
  });

  it("links Teams setup and counts only present Graph values", () => {
    const item = integration("hermes_teams_meeting_pipeline");
    expect(accountSetupView(item, undefined).state).toContain("unbekannt");
    const setup = accountSetupView(item, undefined, { configured: { AIRTABLE_API_KEY: false, NOTION_API_KEY: false, TENOR_API_KEY: false, JINA_API_KEY: false,
      MSGRAPH_TENANT_ID: true, MSGRAPH_CLIENT_ID: true, MSGRAPH_CLIENT_SECRET: false }, applied: null });
    expect(setup.href).toContain("hermes-key-setup-title");
    expect(setup.state).toContain("2 von 3");
    expect(setup.state).toContain("Teams nicht geprüft");
  });

  it("keeps an unknown integration unsupported instead of inventing a connection", () => {
    const setup = accountSetupView(integration("unknown_provider"), undefined);
    expect(setup.href).toBeNull();
    expect(setup.state).toContain("Keine bestätigte Dashboard-Einrichtung");
    expect(accountSetupView(integration("__proto__"), undefined).href).toBeNull();
  });

  it("links Friday and Hermes Obsidian skills to the local vault form", () => {
    for (const id of ["obsidian", "hermes_obsidian"]) {
      const setup = accountSetupView({ ...integration(id), configured: true }, undefined);
      expect(setup.href).toBe("/settings?area=skillAccounts#obsidian-setup-title");
      expect(setup.state).toContain("erreichbar");
      expect(setup.state).toContain("nicht geprüft");
      expect(accountSetupView({ ...integration(id), configured: false }, undefined).state).toContain("nicht erreichbar");
    }
  });

  it("links llm-wiki to its own local path without treating optional sync as configured", () => {
    const setup = accountSetupView({ ...integration("hermes_llm_wiki"), configured: true }, undefined);
    expect(setup.href).toBe("/settings?area=skillAccounts#wiki-path-setup-title");
    expect(setup.state).toContain("lesbar");
    expect(accountSetupView(integration("hermes_llm_wiki_sync"), undefined).href).toBeNull();
  });
});
