import { describe, expect, it } from "vitest";
import type { SkillCatalogEntry } from "@friday/sdk";
import { integrationSetupLink, internalSetupLink, officialReference, selectedVisibleSkill, skillState, visibleSkills } from "./skillPresentation";
import { clearOnboardingSnooze, isOnboardingSnoozed, snoozeOnboarding } from "./onboardingSnooze";

const base = { discovered: true, enabled: true } as SkillCatalogEntry;

describe("skill status presentation", () => {
  it("does not equate Hermes activation with verified execution", () => {
    expect(skillState(base).label).toBe("Aktiviert");
    expect(skillState(base).detail).toContain("nicht geprüft");
    expect(skillState({ ...base, discovered: null, enabled: null }).label).toBe("Laufzeit unbekannt");
    expect(skillState({ ...base, discovered: false, enabled: null }).label).toBe("Nicht gefunden");
  });

  it("only turns known settings targets and HTTPS references into links", () => {
    expect(internalSetupLink("adapter:hermes")).toBe("/settings?area=adapters&adapter=hermes");
    expect(internalSetupLink("/settings?area=adapters#calendar-setup-title")).toBe("/settings?area=adapters#calendar-setup-title");
    expect(internalSetupLink("Friday Dashboard > Einstellungen > Adapter > CalDAV")).toBe("/settings?area=adapters#calendar-setup-title");
    expect(internalSetupLink("Friday Dashboard > Einstellungen > Skill-Konten > E-Mail")).toBe("/settings?area=skillAccounts#himalaya-account-title");
    expect(internalSetupLink("Friday Dashboard > Einstellungen > Skill-Konten > Telegram")).toBe("/settings?area=skillAccounts#telegram-gateway-setup-title");
    expect(internalSetupLink("Hermes-Laufzeit: Coding-CLI und Provider-Anmeldung")).toBe("/settings?area=skillAccounts#coding-cli-setup-title");
    expect(internalSetupLink("Hermes-Einstellungen in Friday-Ubuntu")).toBe("/settings?area=skillAccounts");
    expect(internalSetupLink("Host: lokaler Editor")).toBeNull();
    expect(officialReference("https://example.org/setup")).toBe("https://example.org/setup");
    expect(officialReference("javascript:alert(1)")).toBeNull();
  });

  it("opens unsupported account prerequisites at their exact Skill-Konten card", () => {
    const item = (id: string, settingsTarget: string) => ({ id, settingsTarget }) as SkillCatalogEntry["integrationDetails"][number];
    expect(integrationSetupLink(item("hermes_phone", "Hermes-Einstellungen in Friday-Ubuntu"))).toBe("/settings?area=skillAccounts&integration=hermes_phone");
    expect(integrationSetupLink(item("custom/provider", "Host: lokaler Editor"))).toBe("/settings?area=skillAccounts&integration=custom%2Fprovider");
    expect(integrationSetupLink(item("gmx", "Friday Dashboard > Einstellungen > Skill-Konten > E-Mail"))).toBe("/settings?area=skillAccounts#himalaya-account-title");
    expect(integrationSetupLink(item("caldav", "Friday Dashboard > Einstellungen > Adapter > CalDAV"))).toBe("/settings?area=adapters#calendar-setup-title");
    expect(integrationSetupLink(item("obsidian", "/settings?area=skillAccounts#obsidian-setup-title"))).toBe("/settings?area=skillAccounts#obsidian-setup-title");
  });

  it("keeps every Friday skill selectable and never shows a hidden selection", () => {
    const catalog = Array.from({ length: 105 }, (_, index) => ({ ...base, id: `friday:skill-${index}`, name: `Skill ${index}`, description: "", category: "Test", source: "friday" as const }));
    const all = visibleSkills(catalog, "", "friday");
    expect(all).toHaveLength(105);
    const filtered = visibleSkills(catalog, "Skill 104", "friday");
    expect(filtered).toHaveLength(1);
    expect(selectedVisibleSkill(filtered, "friday:skill-1")?.id).toBe("friday:skill-104");
  });

  it("defers a pending introduction only for the current browser session", () => {
    clearOnboardingSnooze();
    expect(isOnboardingSnoozed()).toBe(false);
    snoozeOnboarding();
    expect(isOnboardingSnoozed()).toBe(true);
    clearOnboardingSnooze();
    expect(isOnboardingSnoozed()).toBe(false);
  });
});

it("narrows the catalog to one category without dropping the other filters", () => {
  const catalog = [
    { id: "a", name: "Mail", description: "Postfach", category: "Kommunikation", source: "friday", enabled: true, discovered: true },
    { id: "b", name: "Kalender", description: "Termine", category: "Produktivität", source: "friday", enabled: true, discovered: true },
    { id: "c", name: "Notizen", description: "Ideen", category: "Produktivität", source: "hermes", enabled: false, discovered: true },
  ] as never;
  expect(visibleSkills(catalog, "", "all", "all", "Produktivität").map((skill) => skill.id)).toEqual(["b", "c"]);
  expect(visibleSkills(catalog, "", "friday", "all", "Produktivität").map((skill) => skill.id)).toEqual(["b"]);
  expect(visibleSkills(catalog, "", "all", "all", "all")).toHaveLength(3);
});