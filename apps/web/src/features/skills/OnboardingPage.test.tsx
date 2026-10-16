import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SkillCatalogEntry } from "@friday/sdk";
import { beforeEach, expect, it, vi } from "vitest";
import { AccountPrerequisites, OnboardingPage } from "./OnboardingPage";

const mocks = vi.hoisted(() => ({ stale: false, freshness: "fresh", refetch: vi.fn(), save: vi.fn(), skill: null as SkillCatalogEntry | null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/lib/session", () => ({ useSession: () => ({ role: "owner", offline: false, displayName: "Test" }) }));
vi.mock("@/lib/api/domains/skills", () => ({
  useOnboarding: () => ({ data: { data: { revision: 1, preferredName: "Test", goals: [], selectedSkillIds: [],
    steps: { intro: "pending", profile: "pending", skills: "pending", accounts: "pending", finish: "pending" } } }, isPending: false, isError: false }),
  useSkillsCatalog: () => ({ data: { data: mocks.skill ? [mocks.skill] : [], freshness: { state: mocks.freshness } },
    isPending: false, isError: false, isStale: mocks.stale, isFetching: false, refetch: mocks.refetch }),
  useUpdateOnboarding: () => ({ mutateAsync: mocks.save, isPending: false }),
  useSetSkillActivation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

beforeEach(() => {
  mocks.stale = false; mocks.freshness = "fresh"; mocks.refetch.mockReset(); mocks.save.mockReset();
  mocks.save.mockResolvedValue({});
  mocks.skill = { id: "hermes:test", source: "hermes", name: "Test Skill", category: "Test", description: "Test",
    version: null, packaged: false, discovered: true, enabled: true, observedAt: null, observationSource: "test",
    observationError: null, accounts: [], setupRefs: [], integrationRefs: [], integrationDetails: [],
    requiredCapabilities: [], conditionalCapabilities: [] };
});

it("shows conditional prerequisites once and keeps untested connections unverified", () => {
  const optional = {
    id: "obsidian_sync", account: "conditional" as const, required: false,
    setupDe: "Optionales Sync-Konto einrichten.", reference: "", settingsTarget: "/settings?area=skillAccounts",
    configured: null, connectionChecked: null,
  };
  const skills = [
    { integrationDetails: [optional] },
    { integrationDetails: [{ ...optional, configured: true }] },
  ] as SkillCatalogEntry[];
  render(<AccountPrerequisites skills={skills} />);
  const item = screen.getByRole("listitem");
  expect(screen.getAllByRole("listitem")).toHaveLength(1);
  expect(within(item).getByText(/Optional · Konto je nach Nutzung/)).toBeTruthy();
  expect(within(item).getByText(/Einrichtung: nicht geprüft · Verbindung: nicht geprüft/)).toBeTruthy();
  expect(within(item).getByRole("link", { name: /Einstellungen für obsidian sync öffnen/ })).toHaveAttribute("href", "/settings?area=skillAccounts&integration=obsidian_sync");
});

it.each(["stale", "unknown"])("does not complete the Skills step from %s catalog state", async (state) => {
  mocks.stale = state === "stale";
  mocks.freshness = state === "unknown" ? "unknown" : "fresh";
  render(<OnboardingPage />);
  await userEvent.click(screen.getByRole("button", { name: /Fähigkeiten · offen/ }));

  expect(screen.getByText("Hermes · Status unbekannt")).toBeTruthy();
  expect(screen.queryByText("aktiviert")).toBeNull();
  expect(screen.getByRole("button", { name: "Speichern und weiter" })).toBeDisabled();
  await userEvent.click(screen.getAllByRole("button", { name: "Jetzt aktualisieren" })[0]!);
  expect(mocks.refetch).toHaveBeenCalledOnce();
  expect(mocks.save).not.toHaveBeenCalled();
});

it("completes the Skills step when a fresh catalog confirms the state", async () => {
  render(<OnboardingPage />);
  await userEvent.click(screen.getByRole("button", { name: /Fähigkeiten · offen/ }));
  expect(screen.getByText("Hermes · aktiviert")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Speichern und weiter" }));
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({
    steps: expect.objectContaining({ skills: "completed" }),
  }) }));
});

it("allows completion after refreshing stale catalog state", async () => {
  mocks.stale = true;
  const { rerender } = render(<OnboardingPage />);
  await userEvent.click(screen.getByRole("button", { name: /Fähigkeiten · offen/ }));
  expect(screen.getByRole("button", { name: "Speichern und weiter" })).toBeDisabled();
  await userEvent.click(screen.getAllByRole("button", { name: "Jetzt aktualisieren" })[0]!);
  mocks.stale = false;
  rerender(<OnboardingPage />);
  expect(screen.getByText("Hermes · aktiviert")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Speichern und weiter" }));
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({
    steps: expect.objectContaining({ skills: "completed" }),
  }) }));
});
