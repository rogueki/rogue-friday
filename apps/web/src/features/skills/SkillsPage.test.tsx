import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SkillCatalogEntry } from "@friday/sdk";
import { expect, it, vi } from "vitest";
import { SkillsPage } from "./SkillsPage";

const mocks = vi.hoisted(() => ({ skills: [] as SkillCatalogEntry[] }));
vi.mock("@/lib/session", () => ({ useSession: () => ({ role: "owner", offline: false }) }));
vi.mock("@/lib/api/domains/skills", () => ({
  useSkillsCatalog: () => ({ data: { data: mocks.skills, catalogError: null, hermesError: null }, isPending: false, isError: false }),
  useSetSkillActivation: () => ({ mutateAsync: vi.fn(), isPending: false }),
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
