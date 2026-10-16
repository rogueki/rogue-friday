import { render, screen } from "@testing-library/react";
import type { SkillCatalogEntry } from "@friday/sdk";
import { expect, it } from "vitest";
import { IntegrationRequirements } from "./IntegrationRequirements";

type Integration = SkillCatalogEntry["integrationDetails"][number];
const item = { id: "provider", account: "required", required: true, setupDe: "Einrichten", reference: "", settingsTarget: "",
  configured: null, connectionChecked: null } as Integration;

it("shows specific required rights and cost notice", () => {
  render(<IntegrationRequirements item={{ ...item,
    permissions: { required_prerequisites: [{ kind: "provider_account", status: "required", notice: "Leserecht freigeben" }], optional_prerequisites: [], scope_status: "unknown", scope_notice: "Scopes beim Anbieter prüfen" },
    cost: { model: "provider_usage", notice: "Nutzungstarif prüfen" },
  }} />);
  expect(screen.getByText("Leserecht freigeben")).toBeTruthy();
  expect(screen.getByText(/Scopes beim Anbieter prüfen/)).toBeTruthy();
  expect(screen.getByText(/Anbieternutzung · Nutzungstarif prüfen/)).toBeTruthy();
});

it("states that old catalogue rights and costs are unknown", () => {
  render(<IntegrationRequirements item={item} />);
  expect(screen.getByText(/Berechtigungen und Freigaben sind nicht katalogisiert/)).toBeTruthy();
  expect(screen.getByText(/Mögliche Anbieter-, Lizenz- oder Betriebskosten/)).toBeTruthy();
});
