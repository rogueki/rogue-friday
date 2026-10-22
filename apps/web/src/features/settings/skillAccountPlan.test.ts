import type { SkillCatalogEntry } from "@friday/sdk";
import { describe, expect, it } from "vitest";
import { filterSkills, sharedAccountIds, sharedWith, skillAccounts, skillState, skillSummaries } from "./skillAccountPlan";

const detail = (id: string, options: { required?: boolean; configured?: boolean | null } = {}) => ({
  id,
  account: "required" as const,
  required: options.required ?? true,
  setupDe: `Setup ${id}`,
  reference: "",
  settingsTarget: "Hermes-Einstellungen in Friday",
  configured: options.configured === undefined ? false : options.configured,
  connectionChecked: null,
});

const skill = (overrides: Partial<SkillCatalogEntry> & { id: string }): SkillCatalogEntry => ({
  source: "friday",
  name: overrides.name ?? overrides.id,
  category: overrides.category ?? "office",
  description: "Beschreibung",
  version: null,
  packaged: true,
  discovered: true,
  enabled: true,
  observedAt: null,
  observationSource: "friday",
  observationError: null,
  accounts: [],
  setupRefs: [],
  integrationRefs: [],
  requiredCapabilities: [],
  conditionalCapabilities: [],
  integrationDetails: [],
  ...overrides,
});

describe("skill account plan", () => {
  it("explains required accounts and keeps their real state", () => {
    const entry = skill({ id: "kalender", integrationDetails: [detail("caldav", { configured: true }), detail("gmx", { configured: false })] });
    expect(skillAccounts(entry)).toEqual([
      { id: "caldav", required: true, state: "vorhanden", setupDe: "Setup caldav", settingsTarget: "Hermes-Einstellungen in Friday" },
      { id: "gmx", required: true, state: "fehlt", setupDe: "Setup gmx", settingsTarget: "Hermes-Einstellungen in Friday" },
    ]);
    expect(skillState(entry)).toBe("unvollstaendig");
  });

  it("does not call a skill ready when an account state is unknown or the skill is switched off", () => {
    expect(skillState(skill({ id: "a", integrationDetails: [detail("x", { configured: null })] }))).toBe("unbekannt");
    expect(skillState(skill({ id: "b", integrationDetails: [detail("x", { configured: true })], enabled: false }))).toBe("deaktiviert");
    expect(skillState(skill({ id: "c", integrationDetails: [detail("x", { configured: true })], discovered: false }))).toBe("unbeobachtet");
    expect(skillState(skill({ id: "d", integrationDetails: [detail("x", { configured: true })] }))).toBe("bereit");
  });

  it("counts optional accounts separately from required ones", () => {
    const entry = skill({ id: "e", integrationDetails: [detail("req", { required: true, configured: true }), detail("opt", { required: false, configured: false })] });
    expect(skillState(entry)).toBe("bereit");
    expect(skillAccounts(entry).map((account) => [account.id, account.required])).toEqual([["req", true], ["opt", false]]);
  });

  it("sorts open problems first, then alphabetically", () => {
    const summaries = skillSummaries([
      skill({ id: "z", name: "Zeta", integrationDetails: [detail("x", { configured: true })] }),
      skill({ id: "m", name: "Mitte", integrationDetails: [detail("x", { configured: false })] }),
      skill({ id: "a", name: "Alpha", integrationDetails: [detail("x", { configured: true })] }),
    ]);
    expect(summaries.map((summary) => summary.name)).toEqual(["Mitte", "Alpha", "Zeta"]);
  });

  it("searches name, source and state text, and filters by state exactly", () => {
    const summaries = skillSummaries([
      skill({ id: "kalender", name: "Kalender", integrationDetails: [detail("caldav", { configured: false })] }),
      skill({ id: "gif", name: "GIF Suche", source: "hermes", integrationDetails: [detail("tenor", { configured: true })] }),
    ]);
    expect(filterSkills(summaries, { text: "kal" }).map((summary) => summary.id)).toEqual(["kalender"]);
    expect(filterSkills(summaries, { text: "hermes" }).map((summary) => summary.id)).toEqual(["gif"]);
    expect(filterSkills(summaries, { text: "Pflichtkonto fehlt" }).map((summary) => summary.id)).toEqual(["kalender"]);
    expect(filterSkills(summaries, { state: "bereit" }).map((summary) => summary.id)).toEqual(["gif"]);
    expect(filterSkills(summaries, { state: "unvollstaendig" }).map((summary) => summary.id)).toEqual(["kalender"]);
    expect(filterSkills(summaries, { text: "  " })).toHaveLength(2);
    expect(filterSkills(summaries, { text: "gibtesnicht" })).toEqual([]);
  });

  it("names the other skills that need the same credential", () => {
    const summaries = skillSummaries([
      skill({ id: "kalender", name: "Kalender", integrationDetails: [detail("caldav", { configured: true })] }),
      skill({ id: "termine", name: "Termine", integrationDetails: [detail("caldav", { configured: true })] }),
      skill({ id: "mail", name: "Mail", integrationDetails: [detail("gmx", { configured: false })] }),
    ]);
    expect(sharedWith(summaries, "kalender", "caldav")).toEqual(["Termine"]);
    // Ein Konto, das der gewaehlte Skill nicht fuehrt, nennt trotzdem die Skills, die es brauchen.
    expect(sharedWith(summaries, "kalender", "gmx")).toEqual(["Mail"]);
    expect(sharedWith(summaries, "kalender", "gibtesnicht")).toEqual([]);
    expect(sharedAccountIds(summaries, "kalender")).toEqual(["caldav"]);
    expect(sharedAccountIds(summaries, "mail")).toEqual([]);
  });
});