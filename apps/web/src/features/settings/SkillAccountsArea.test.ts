import type { SkillCatalogEntry } from "@friday/sdk";
import { describe, expect, it } from "vitest";
import { accountSetupView } from "./SkillAccountsArea";

const integration = (id: string) => ({
  id, account: "required" as const, required: true, setupDe: "Setup", reference: "", settingsTarget: "Hermes-Einstellungen in Friday-Ubuntu",
  configured: null, connectionChecked: null, requiredBy: ["Test"],
}) satisfies SkillCatalogEntry["integrationDetails"][number] & { requiredBy: string[] };

describe("Skill account setup paths", () => {
  it("opens the encrypted Friday key form without claiming a provider login", () => {
    const setup = accountSetupView(integration("kie_ai"), { kie: true, elevenlabs: false, capcut: false });
    expect(setup.href).toBe("/settings?area=contentStudioKeys");
    expect(setup.state).toContain("Schlüssel hinterlegt");
    expect(setup.state).toContain("Anbieterzugriff nicht geprüft");
    expect(accountSetupView(integration("elevenlabs"), { kie: true, elevenlabs: false, capcut: false }).state).toContain("Schlüssel fehlt");
  });

  it("points a Hermes-only account to its WSL configuration without a fake Friday form", () => {
    const setup = accountSetupView(integration("hermes_notion"), undefined);
    expect(setup.href).toBeNull();
    expect(setup.location).toContain("~/.hermes/.env");
    expect(setup.state).toContain("nicht durch Friday geprüft");
  });

  it("keeps an unknown integration unsupported instead of inventing a connection", () => {
    const setup = accountSetupView(integration("unknown_provider"), undefined);
    expect(setup.href).toBeNull();
    expect(setup.state).toContain("Keine bestätigte Dashboard-Einrichtung");
    expect(accountSetupView(integration("__proto__"), undefined).href).toBeNull();
  });
});
