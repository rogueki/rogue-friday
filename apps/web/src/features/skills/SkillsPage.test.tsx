import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SkillCatalogEntry } from "@friday/sdk";
import { expect, it, vi } from "vitest";
import { SkillsPage } from "./SkillsPage";

const mocks = vi.hoisted(() => ({ skills: [] as SkillCatalogEntry[], stale: false, freshness: "fresh", refetch: vi.fn() }));
vi.mock("@/lib/session", () => ({ useSession: () => ({ role: "owner", offline: false }) }));
vi.mock("@/lib/api/domains/skills", () => ({
  useSkillsCatalog: () => ({ data: { data: mocks.skills, catalogError: null, hermesError: null,
    freshness: { state: mocks.freshness, asOf: new Date().toISOString() } }, isPending: false, isError: false, isStale: mocks.stale,
    refetch: mocks.refetch }),
  useSetSkillActivation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSkillMarkdown: (id: string | null) => ({ data: id ? { data: { id, content: "# Anleitung", bytes: 11 } } : undefined,
    isPending: false, isError: false, error: null }),
  useSkillHubSearch: () => ({ data: undefined, isPending: false, isError: false, isFetching: false, error: null }),
  useModifiedSkills: () => ({ data: { data: { names: [], observedAt: new Date().toISOString() } },
    isPending: false, isError: false, error: null }),
}));
vi.mock("./CodingRunsArea", () => ({ CodingRunsArea: () => null }));

const skill = (source: SkillCatalogEntry["source"], version: string | null): SkillCatalogEntry => ({
  id: `${source}:beispiel`, source, origin: source === "friday" ? "friday" : "local",
  trust: source === "friday" ? "unknown" : "local", name: `${source} Beispiel`, category: "Test", description: "Beispiel-Skill",
  version, packaged: source === "friday", discovered: true, enabled: true, observedAt: null,
  observationSource: "test", observationError: null, accounts: [], setupRefs: [], integrationRefs: [],
  integrationDetails: [], requiredCapabilities: [], conditionalCapabilities: [],
});

it("labels absent skill versions as unknown without inventing a Hermes version", async () => {
  mocks.skills = [skill("hermes", null), skill("friday", "1.2.3"),
    { ...skill("friday", null), id: "friday:ohne-version", name: "Friday ohne Version" }];
  render(<SkillsPage />);

  expect(screen.getByText("HERMES STANDARD · Version unbekannt")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: /friday Beispiel/ }));
  expect(screen.getByText("FRIDAY SKILLS · v1.2.3")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: /Friday ohne Version/ }));
  expect(screen.getByText("FRIDAY SKILLS · Version unbekannt")).toBeTruthy();
});

it.each(["cached", "backend"])("does not present %s stale activation as live and offers refresh", async (caseName) => {
  mocks.skills = [skill("hermes", null)];
  mocks.stale = caseName === "cached";
  mocks.freshness = caseName === "backend" ? "unknown" : "fresh";
  mocks.refetch.mockClear();
  render(<SkillsPage />);

  expect(screen.getAllByText("Laufzeit unbekannt")).toHaveLength(2);
  expect(screen.getAllByText(/Katalogdaten sind nicht mehr aktuell/)).toHaveLength(2);
  expect(screen.queryByRole("button", { name: "Deaktivieren" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Jetzt aktualisieren" }));
  expect(mocks.refetch).toHaveBeenCalledOnce();
  mocks.stale = false;
  mocks.freshness = "fresh";
});

it("shows origin and trust separately and reveals further rows on demand", async () => {
  mocks.stale = false;
  mocks.freshness = "fresh";
  mocks.skills = Array.from({ length: 65 }, (_, index) => ({ ...skill("hermes", null),
    id: `hermes:skill-${index}`, name: `Skill ${index}` }));
  render(<SkillsPage />);

  const list = () => within(screen.getByRole("list", { name: "Skills" })).getAllByRole("listitem");
  expect(list()).toHaveLength(60);
  expect(screen.getByText("60 von 65 Skills sichtbar.")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Weitere 5 Skills anzeigen" }));
  expect(list()).toHaveLength(65);
  expect(screen.queryByRole("button", { name: /Weitere .* Skills anzeigen/ })).toBeNull();
  expect(screen.getByText("Trust")).toBeTruthy();
  // The filter label and the detail fact both exist; origin and trust stay two separate statements.
  expect(screen.getAllByText("Herkunft").length).toBeGreaterThanOrEqual(2);
  expect(screen.getAllByText("Lokal installiert").length).toBeGreaterThanOrEqual(2);
  expect(screen.getByLabelText("Herkunft")).toBeTruthy();
});
