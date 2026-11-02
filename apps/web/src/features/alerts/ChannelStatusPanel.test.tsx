import type { Channel } from "@friday/sdk";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setApiClient } from "@/lib/api/client";
import { renderWithProviders } from "@/test/render";
import { push, resetRouter } from "../memory/kit/testRouter";
import { errorResponse, FULL, listOf, modules, NOW, resource, routedFetch } from "../memory/kit/testSupport";
import { ChannelStatusPanel } from "./ChannelStatusPanel";

vi.mock("next/navigation", async () => (await import("../memory/kit/testRouter")).navigationMock);

const NATIVE = { adapterId: "friday-communication", system: "friday", lastSyncedAt: NOW };

const channel = (id: string, kind: Channel["kind"]): Channel => ({
  ...resource(id),
  kind,
  name: kind,
  status: "not_configured",
  capabilities: { read: false, draft: false, send: false },
  unreadCount: 0,
  lastSyncAt: null,
  source: NATIVE,
});

const unsetChannels = [
  channel("chan_01JAAAAAAAAAAAAAAAAAAAAAAA", "email"),
  channel("chan_01JBBBBBBBBBBBBBBBBBBBBBBB", "telegram"),
  channel("chan_01JCCCCCCCCCCCCCCCCCCCCCCC", "whatsapp"),
  channel("chan_01JDDDDDDDDDDDDDDDDDDDDDDD", "sms"),
  channel("chan_01JEEEEEEEEEEEEEEEEEEEEEEE", "phone"),
];

beforeEach(() => resetRouter("/alerts"));
afterEach(() => setApiClient(null));

describe("channel status panel", () => {
  it("built-in adapter: unset channels read 'Nicht eingerichtet' with a setup link, never 'antwortet nicht'", async () => {
    const user = userEvent.setup();
    const fake = routedFetch({ "GET /api/v1/communication/channels": listOf(unsetChannels) });
    renderWithProviders(<ChannelStatusPanel />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    const list = await screen.findByRole("list", { name: "Kanalstatus" });
    await waitFor(() => expect(within(list).getAllByText("Nicht eingerichtet")).toHaveLength(5));
    expect(screen.queryByText(/antwortet nicht/)).toBeNull();
    const emailRow = screen.getByText("E-Mail").closest("li") as HTMLElement;
    await user.click(within(emailRow).getByRole("button", { name: "Einrichten" }));
    expect(push).toHaveBeenCalledWith("/settings?area=skillAccounts#himalaya-account-title");
  });

  it("a missing communication adapter is described as not connected, not as not responding", async () => {
    const fake = routedFetch({
      "GET /api/v1/communication/channels": errorResponse("CAPABILITY_MISSING", "Kein Kommunikationsadapter konfiguriert", 403),
    });
    renderWithProviders(<ChannelStatusPanel />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    expect(await screen.findByText(/Noch kein Kommunikationskanal angebunden/)).toBeInTheDocument();
    expect(screen.queryByText(/antwortet nicht/)).toBeNull();
  });

  it("an adapter outage still says the adapter does not respond", async () => {
    const fake = routedFetch({
      "GET /api/v1/communication/channels": errorResponse("ADAPTER_UNAVAILABLE", "down", 503),
    });
    renderWithProviders(<ChannelStatusPanel />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    expect(await screen.findByText(/antwortet nicht/)).toBeInTheDocument();
  });
});

