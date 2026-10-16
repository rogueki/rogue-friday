import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setApiClient } from "@/lib/api/client";
import { jsonResponse, renderWithProviders } from "@/test/render";
import { TelegramGatewaySetup } from "./TelegramGatewaySetup";

const status = { contractVersion: "2.0.0", data: { tokenConfigured: false, allowedUserIds: [],
  enabled: false, gatewayRunning: false, connectionState: "unknown", applied: null, revision: 42 },
  freshness: { state: "fresh", asOf: "2026-10-16T10:00:00Z" } };

afterEach(() => setApiClient(null));

describe("Telegram gateway setup", () => {
  it("sends the bot token only after owner save and never renders it again", async () => {
    const requests: Array<{ method: string; body: unknown }> = [];
    renderWithProviders(<TelegramGatewaySetup owner />, { fetchImpl: async (input, init) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const method = request.method;
      const body = method === "PUT" ? await request.json() : null;
      requests.push({ method, body });
      return jsonResponse(status);
    } });
    await screen.findByRole("button", { name: "Telegram-Konfiguration speichern" });
    expect(requests.some((entry) => entry.method === "PUT")).toBe(false);
    const token = `123456789:${"a".repeat(35)}`;
    fireEvent.change(screen.getByLabelText("Bot-Token"), { target: { value: token } });
    fireEvent.change(screen.getByLabelText("Erlaubte numerische User-IDs"), { target: { value: "123456789" } });
    fireEvent.click(screen.getByLabelText("Telegram aktivieren"));
    fireEvent.click(screen.getByRole("button", { name: "Telegram-Konfiguration speichern" }));
    await waitFor(() => expect(requests.some((entry) => entry.method === "PUT")).toBe(true));
    expect(requests.find((entry) => entry.method === "PUT")?.body).toEqual({ token,
      clearToken: false, allowedUserIds: ["123456789"], enabled: true });
    expect(screen.queryByText(token)).toBeNull();
  });

  it("offers no input to non-owners", () => {
    renderWithProviders(<TelegramGatewaySetup owner={false} />, { fetchImpl: async () => jsonResponse(status) });
    expect(screen.getByText("Nur der Owner kann den Telegram-Bot einrichten.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Bot-Token")).toBeNull();
  });
});
