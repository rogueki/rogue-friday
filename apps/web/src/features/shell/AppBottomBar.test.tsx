import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandConfirmHost } from "@/features/palette/commandRunner";
import { setApiClient } from "@/lib/api/client";
import { capabilitiesOf, jsonResponse, NEVER_RESOLVES, renderWithProviders } from "@/test/render";
import { AppBottomBar } from "./AppBottomBar";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/",
}));

afterEach(() => setApiClient(null));

const COMMAND_ID = "cmd_01HZZZZZZZZZZZZZZZZZZZZZZZ";

function commandFetch(respond: (body: Record<string, unknown>) => Record<string, unknown>) {
  const calls: Array<Record<string, unknown>> = [];
  const impl = ((input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : null;
    const url = request?.url ?? String(input);
    if (!url.endsWith("/api/v1/commands")) return NEVER_RESOLVES(input, init);
    return (request ? request.clone().json() : Promise.resolve(JSON.parse(String(init?.body)))).then((body: Record<string, unknown>) => {
      calls.push(body);
      return jsonResponse({ contractVersion: "1.0.0", commandId: COMMAND_ID, ...respond(body) });
    });
  }) as typeof fetch;
  return { impl, calls };
}

describe("AppBottomBar text input", () => {
  it("sends a typed command through POST /commands with source text and shows the server preview for confirmation", async () => {
    const user = userEvent.setup();
    const { impl, calls } = commandFetch(() => ({
      status: "requires_confirmation",
      requiresConfirmation: true,
      previewText: "Du bist dabei, eine E-Mail an Erik Brandt zu senden.",
      previewId: "prev_1",
      riskTier: 2,
    }));
    renderWithProviders(
      <>
        <AppBottomBar />
        <CommandConfirmHost />
      </>,
      { fetchImpl: impl, capabilities: capabilitiesOf({ commands: { execute: true, stop: true, pause: true, resume: true } }) },
    );
    await user.type(screen.getByRole("textbox", { name: "Befehl eingeben" }), "Mail an Erik senden{Enter}");
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ text: "Mail an Erik senden", source: "text", context: { route: "/" } });
    expect(calls[0]).not.toHaveProperty("confirm");
    expect(await screen.findByText("Du bist dabei, eine E-Mail an Erik Brandt zu senden.")).toBeInTheDocument();
  });

  it("is disabled without the commands.execute capability", () => {
    renderWithProviders(<AppBottomBar />, { capabilities: capabilitiesOf({ commands: { execute: false } }) });
    expect(screen.getByRole("textbox", { name: "Befehl eingeben" })).toBeDisabled();
  });

  it("explains missing location/weather data instead of showing a bare dash", () => {
    renderWithProviders(<AppBottomBar />, { capabilities: capabilitiesOf({ commands: { execute: true } }) });
    expect(screen.getByRole("group", { name: "Standort: Keine Datenquelle angebunden" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Wetter: Keine Datenquelle angebunden" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /Netzwerk: Noch keine Messwerte/ })).toBeInTheDocument();
  });
});
