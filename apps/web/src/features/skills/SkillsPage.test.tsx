import { render, screen } from "@testing-library/react";
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
}));
vi.mock("./CodingRunsArea", () => ({ CodingRunsArea: () => null }));

const skill = (source: SkillCatalogEntry["source"], version: string | null): SkillCatalogEntry => ({
  id: `${source}:beispiel`, source, name: `${source} Beispiel`, category: "Test", description: "Beispiel-Skill",
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
