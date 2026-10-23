import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SkillCatalogEntry } from "@friday/sdk";
import { beforeEach, expect, it, vi } from "vitest";
import { SelectedSkillActivation } from "./SelectedSkillActivation";

const mocks = vi.hoisted(() => ({ stale: false, freshness: "fresh", refetch: vi.fn(), mutate: vi.fn(), skills: [] as SkillCatalogEntry[] }));
vi.mock("@/lib/api/domains/skills", () => ({
  useSkillsCatalog: () => ({ data: { data: mocks.skills, freshness: { state: mocks.freshness } },
    isPending: false, isError: false, isStale: mocks.stale, isFetching: false, refetch: mocks.refetch }),
  useSetSkillActivation: () => ({ mutateAsync: mocks.mutate }),
}));

const skill: SkillCatalogEntry = {
  id: "hermes:test", source: "hermes", origin: "local", trust: "local", name: "Test Skill", category: "Test", description: "Test",
  version: null, packaged: false, discovered: true, enabled: false, observedAt: null, observationSource: "test",
  observationError: null, accounts: [], setupRefs: [], integrationRefs: [], integrationDetails: [],
  requiredCapabilities: [], conditionalCapabilities: [],
};

beforeEach(() => { mocks.stale = false; mocks.freshness = "fresh"; mocks.skills = [skill]; mocks.refetch.mockReset(); mocks.mutate.mockReset(); });

it.each(["stale", "unknown"])("blocks activation for %s catalog state and offers refresh", async (state) => {
  mocks.stale = state === "stale";
  mocks.freshness = state === "unknown" ? "unknown" : "fresh";
  render(<SelectedSkillActivation selectedIds={[skill.id]} />);
  expect(screen.getByText("Status unbekannt")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Test Skill aktivieren" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Jetzt aktualisieren" }));
  expect(mocks.refetch).toHaveBeenCalledOnce();
  expect(mocks.mutate).not.toHaveBeenCalled();
});

it("allows activation only with fresh catalog and confirms a fresh response", async () => {
  mocks.refetch.mockResolvedValue({ data: { data: [{ ...skill, enabled: true }], freshness: { state: "fresh" } },
    isPending: false, isError: false, isStale: false });
  mocks.mutate.mockResolvedValue({});
  render(<SelectedSkillActivation selectedIds={[skill.id]} />);
  await userEvent.click(screen.getByRole("button", { name: "Test Skill aktivieren" }));
  expect(mocks.mutate).toHaveBeenCalledWith({ id: skill.id, enabled: true });
  expect(await screen.findByText(/Aktivierung von Hermes bestätigt/)).toBeTruthy();
});

it("changes only the explicitly selected skill", async () => {
  mocks.mutate.mockResolvedValue({});
  mocks.refetch.mockResolvedValue({ data: { data: [{ ...skill, enabled: true }, { ...skill, id: "hermes:other", enabled: false }], freshness: { state: "fresh" } },
    isPending: false, isError: false, isStale: false });
  render(<SelectedSkillActivation selectedIds={[skill.id]} />);
  await userEvent.click(screen.getByRole("button", { name: "Test Skill aktivieren" }));
  expect(mocks.mutate).toHaveBeenCalledOnce();
  expect(mocks.mutate).toHaveBeenCalledWith({ id: skill.id, enabled: true });
});

it("does not offer activation for unknown, missing, or undiscovered skills", () => {
  const unknown = { ...skill, id: "friday:unknown", discovered: true, enabled: null };
  const missing = { ...skill, id: "friday:missing", discovered: false };
  mocks.skills = [unknown, missing];
  render(<SelectedSkillActivation selectedIds={[unknown.id, missing.id, "friday:absent"]} />);
  expect(screen.getByText("Nicht im Katalog")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /aktivieren|deaktivieren/i })).toBeNull();
  expect(mocks.mutate).not.toHaveBeenCalled();
});
