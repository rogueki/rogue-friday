import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CONTRACT_VERSION, createFridayClient, type SessionResponse } from "@friday/sdk";
import { afterEach, expect, it, vi } from "vitest";
import { setApiClient } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/queryKeys";
import { LoginView } from "./LoginView";

const replace = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const envelope = (setupRequired: boolean, authenticated: boolean): SessionResponse => ({
  contractVersion: CONTRACT_VERSION,
  data: {
    authenticated,
    setupRequired,
    user: authenticated ? { id: "usr_01JAAAAAAAAAAAAAAAAAAAAAAA", displayName: "Erik", role: "owner" } : null,
    role: authenticated ? "owner" : null,
    csrfToken: authenticated ? "csrf" : null,
    expiresAt: null,
    reauthUntil: null,
  },
  freshness: { state: "fresh", asOf: new Date().toISOString() },
});

afterEach(() => { setApiClient(null); replace.mockReset(); window.sessionStorage.clear(); });

async function login(setupRequired: boolean): Promise<string[]> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.session, envelope(setupRequired, false));
  client.setQueryData(queryKeys.meta, { features: { devScenarios: false }, dataMode: "live" });
  setApiClient(createFridayClient({ baseUrl: "http://localhost", fetch: async (input) => {
    const request = input as Request;
    if (request.method === "POST") return Response.json(envelope(false, true));
    if (request.url.endsWith("/api/v1/meta")) return Response.json({ features: { devScenarios: false }, dataMode: "live" });
    return Response.json(envelope(setupRequired, false));
  } }));
  const user = userEvent.setup();
  render(<QueryClientProvider client={client}><LoginView /></QueryClientProvider>);
  if (setupRequired) {
    await user.type(screen.getByLabelText("Dein Name"), "Erik");
    await user.type(screen.getByLabelText("Passwort wiederholen"), "long-password-123");
  }
  await user.type(screen.getByLabelText("Benutzername"), "erik");
  await user.type(screen.getByLabelText("Passwort", { exact: true }), "long-password-123");
  await user.click(screen.getByRole("button", { name: setupRequired ? "Konto erstellen und anmelden" : "Anmelden" }));
  await waitFor(() => expect(replace).toHaveBeenCalled());
  await waitFor(() => expect(client.getQueryData<SessionResponse>(queryKeys.session)?.data.authenticated).toBe(true));
  return replace.mock.calls.map(([path]) => path as string);
}

it("opens onboarding after first owner account creation without a competing home redirect", async () => {
  expect(await login(true)).toEqual(["/onboarding"]);
});

it("opens home after an ordinary login", async () => {
  expect(await login(false)).toEqual(["/"]);
});
