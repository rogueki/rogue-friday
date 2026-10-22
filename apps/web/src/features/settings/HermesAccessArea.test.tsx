import { screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { setApiClient } from "@/lib/api/client";
import { renderWithProviders } from "@/test/render";
import { errorResponse, routedFetch, single } from "../memory/kit/testSupport";
import { HermesAccessArea } from "./HermesAccessArea";

afterEach(() => setApiClient(null));

const ACCESS = "GET /api/v1/settings/hermes-access";

const providers = [
  { provider: "copilot", count: 1, credentials: [
    { index: 1, label: "gh auth token", type: "api_key", source: "gh_cli", active: true }] },
  { provider: "kimi-coding", count: 2, credentials: [
    { index: 1, label: "KIMI_API_KEY", type: "api_key", source: "env:KIMI_API_KEY", active: true },
    { index: 2, label: "Kimi Abo", type: "oauth", source: "oauth-store", active: false }] },
];

it("lists providers with type and source but no key value", async () => {
  renderWithProviders(<HermesAccessArea />, { fetchImpl: routedFetch({ [ACCESS]: () => single({ providers }) }).fetch });
  expect(await screen.findByRole("heading", { name: "KI-Zugänge" })).toBeInTheDocument();
  expect(await screen.findByText("copilot")).toBeInTheDocument();
  expect(screen.getByText(/Kimi Abo/)).toBeInTheDocument();
  expect(screen.getByText("Abo-Anmeldung")).toBeInTheDocument();
  expect(screen.getByText("2 Zugänge")).toBeInTheDocument();
  expect(screen.getByText("env:KIMI_API_KEY")).toBeInTheDocument();
  expect(screen.queryByText(/sk-/)).toBeNull();
});

it("says so when no provider is logged in instead of showing invented rows", async () => {
  renderWithProviders(<HermesAccessArea />, { fetchImpl: routedFetch({ [ACCESS]: () => single({ providers: [] }) }).fetch });
  expect(await screen.findByText(/Kein Anbieter ist angemeldet/)).toBeInTheDocument();
});

it("explains an unavailable bridge and offers a retry", async () => {
  renderWithProviders(<HermesAccessArea />, {
    fetchImpl: routedFetch({ [ACCESS]: () => errorResponse("ADAPTER_UNAVAILABLE",
      "Hermes in Friday-Ubuntu ist nicht erreichbar.", 503) }).fetch,
  });
  expect(await screen.findByRole("alert")).toHaveTextContent("nicht erreichbar");
  expect(screen.getByRole("button", { name: "Erneut lesen" })).toBeInTheDocument();
});