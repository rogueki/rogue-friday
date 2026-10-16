import { render, screen, within } from "@testing-library/react";
import type { SkillCatalogEntry } from "@friday/sdk";
import { expect, it } from "vitest";
import { AccountPrerequisites } from "./OnboardingPage";

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
  expect(within(item).getByRole("link", { name: /Einstellungen für obsidian sync öffnen/ })).toHaveAttribute("href", "/settings?area=skillAccounts");
});
