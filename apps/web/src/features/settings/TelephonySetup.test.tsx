import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setApiClient } from "@/lib/api/client";
import { jsonResponse, renderWithProviders } from "@/test/render";
import { TelephonySetup } from "./TelephonySetup";

const status = (overrides: Record<string, unknown> = {}) => ({ contractVersion: "2.0.0",
  data: { configured: true, mode: "trunk", ariReachable: true, registration: "registered", ownerEndpoint: "online",
    configurationApplied: true, dialplanLoaded: true, ready: true, revision: 1, callerId: "+491701234567", ...overrides },
  freshness: { state: "fresh", asOf: "2026-10-16T10:00:00Z" } });

afterEach(() => setApiClient(null));

describe("Telephony setup", () => {
  it("renders readable labels instead of raw adapter values", async () => {
    renderWithProviders(<TelephonySetup owner />, { fetchImpl: async () => jsonResponse(status()) });
    await screen.findByText(/SIP-Registrierung registriert/);
    expect(screen.getByText(/Owner-Nebenstelle online/)).toBeInTheDocument();
  });

  it("names an unregistered SIP trunk and an offline owner endpoint in plain German", async () => {
    renderWithProviders(<TelephonySetup owner />, { fetchImpl: async () =>
      jsonResponse(status({ registration: "unregistered", ownerEndpoint: "offline" })) });
    await screen.findByText(/SIP-Registrierung nicht registriert/);
    expect(screen.getByText(/Owner-Nebenstelle offline/)).toBeInTheDocument();
  });

  it("offers no input to non-owners", () => {
    renderWithProviders(<TelephonySetup owner={false} />, { fetchImpl: async () => jsonResponse(status()) });
    expect(screen.getByText("Nur der Owner kann Telefonie einrichten.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Adapterstatus erneut prüfen" })).toBeNull();
  });
});
