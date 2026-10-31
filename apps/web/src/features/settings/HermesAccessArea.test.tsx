import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { setApiClient } from "@/lib/api/client";
import { renderWithProviders } from "@/test/render";
import { errorResponse, routedFetch, single } from "../memory/kit/testSupport";
import { HermesAccessArea } from "./HermesAccessArea";

afterEach(() => setApiClient(null));

const ACCESS = "GET /api/v1/settings/hermes-access";
const LOGIN = "POST /api/v1/settings/hermes-access/oauth";
const flow = (data: Record<string, unknown>) => single({ flowId: "a".repeat(32), provider: "openai-codex", userCode: null,
  verificationUrl: null, expiresAt: null, failureClass: null, ...data });
const waiting = { status: "awaiting_approval", userCode: "ABCD-1234", verificationUrl: "https://auth.example.org/device",
  expiresAt: "2026-10-31T10:15:00Z" };

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

it("starts a device-code login, shows code and link and rereads the list once Hermes stored it", async () => {
  let status = "awaiting_approval";
  const fake = routedFetch({
    [ACCESS]: () => single({ providers: [] }),
    [LOGIN]: (_url: URL, _request: Request, body: unknown) =>
      (body as { action: string }).action === "start" || status === "awaiting_approval" ? flow(waiting) : flow({ status }),
  });
  const view = renderWithProviders(<HermesAccessArea />, { fetchImpl: fake.fetch });
  fireEvent.change(await screen.findByRole("combobox", { name: "Anbieter" }), { target: { value: "openai-codex" } });
  fireEvent.click(screen.getByRole("button", { name: "Anmeldung starten" }));
  expect(await screen.findByText("ABCD-1234")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "https://auth.example.org/device" }))
    .toHaveAttribute("href", "https://auth.example.org/device");
  expect(screen.getByText(/Gültig bis/)).toBeInTheDocument();
  expect(fake.to("POST", "/api/v1/settings/hermes-access/oauth")[0]?.body).toEqual({ action: "start", provider: "openai-codex" });
  const reads = fake.to("GET", "/api/v1/settings/hermes-access").length;
  status = "configured";
  await view.queryClient.refetchQueries({ queryKey: ["settings", "hermes-provider-oauth"] });
  expect(await screen.findByText("Angemeldet. Hermes hat den Zugang gespeichert.")).toBeInTheDocument();
  await waitFor(() => expect(fake.to("GET", "/api/v1/settings/hermes-access").length).toBeGreaterThan(reads));
  expect(screen.queryByRole("button", { name: "Anmeldung abbrechen" })).toBeNull();
});

it("cancels a running login and names why it ended", async () => {
  let cancelled = false;
  const fake = routedFetch({
    [ACCESS]: () => single({ providers: [] }),
    [LOGIN]: (_url: URL, _request: Request, body: unknown) => {
      if ((body as { action: string }).action === "cancel") {
        cancelled = true;
        return flow({ status: "cancelling" });
      }
      return cancelled ? flow({ status: "failed", failureClass: "oauth_cancelled" }) : flow(waiting);
    },
  });
  renderWithProviders(<HermesAccessArea />, { fetchImpl: fake.fetch });
  fireEvent.click(await screen.findByRole("button", { name: "Anmeldung starten" }));
  fireEvent.click(await screen.findByRole("button", { name: "Anmeldung abbrechen" }));
  expect(await screen.findByText("Anmeldung fehlgeschlagen (abgebrochen).")).toBeInTheDocument();
  expect(fake.to("POST", "/api/v1/settings/hermes-access/oauth").map((call) => (call.body as { action: string }).action))
    .toContain("cancel");
  expect(screen.getByRole("button", { name: "Anmeldung starten" })).toBeEnabled();
});