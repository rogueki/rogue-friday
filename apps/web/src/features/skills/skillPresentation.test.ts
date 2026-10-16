import { describe, expect, it } from "vitest";
import type { SkillCatalogEntry } from "@friday/sdk";
import { internalSetupLink, officialReference, selectedVisibleSkill, skillState, visibleSkills } from "./skillPresentation";
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
    expect(internalSetupLink("Host: lokaler Editor")).toBeNull();
    expect(officialReference("https://example.org/setup")).toBe("https://example.org/setup");
    expect(officialReference("javascript:alert(1)")).toBeNull();
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
