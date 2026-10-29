import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setApiClient } from "@/lib/api/client";
import { jsonResponse, renderWithProviders } from "@/test/render";
import { MessagingGatewaySetup } from "./MessagingGatewaySetup";

const envelope = (data: object) => ({ contractVersion: "2.0.0", data,
  freshness: { state: "fresh", asOf: "2026-10-16T10:00:00Z" } });
afterEach(() => setApiClient(null));

describe("messaging gateway setup", () => {
  it("saves Discord only after owner action and never renders the token", async () => {
    const requests: Array<{ method: string; body: unknown }> = [];
    renderWithProviders(<MessagingGatewaySetup owner platform="discord" />, { fetchImpl: async (input, init) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      requests.push({ method: request.method, body: request.method === "PUT" ? await request.json() : null });
      return jsonResponse(envelope({ setupUrl: "http://127.0.0.1:43791/channels", tokenConfigured: false, allowedUserIds: [], allowedChannelIds: [],
        enabled: false, gatewayRunning: true, connectionState: "unknown", applied: null, revision: 1 }));
    } });
    await screen.findByRole("button", { name: "Discord-Konfiguration speichern" });
    expect(requests.some((entry) => entry.method === "PUT")).toBe(false);
    const token = "a".repeat(40);
    fireEvent.change(screen.getByLabelText("Discord-Bot-Token"), { target: { value: token } });
    fireEvent.change(screen.getByLabelText("Erlaubte Discord-User-IDs"), { target: { value: "123456789012345678" } });
    fireEvent.click(screen.getByRole("button", { name: "Discord-Konfiguration speichern" }));
    await waitFor(() => expect(requests.some((entry) => entry.method === "PUT")).toBe(true));
    expect(requests.find((entry) => entry.method === "PUT")?.body).toMatchObject({ token, allowedUserIds: ["123456789012345678"] });
    expect(screen.queryByText(token)).toBeNull();
  });

  it("starts native WhatsApp pairing and submits mode and owner phone", async () => {
    const requests: Array<{ method: string; body: unknown }> = [];
    let pairing = false;
    renderWithProviders(<MessagingGatewaySetup owner platform="whatsapp" />, { fetchImpl: async (input, init) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      if (new URL(request.url).pathname.endsWith("whatsapp-pairing")) {
        if (request.method === "POST") pairing = true;
        return jsonResponse(envelope({ id: pairing ? "abcdefghijklmnopqrstuvwx" : null, state: pairing ? "waiting" : "idle",
          qr: pairing ? "FAKE_PAIRING_PAYLOAD" : null, expiresAt: pairing ? Date.now() + 60000 : null,
          linkedIdentity: null, connectionState: "unknown", mode: "bot" }));
      }
      requests.push({ method: request.method, body: request.method === "PUT" ? await request.json() : null });
      return jsonResponse(envelope({ setupUrl: "http://127.0.0.1:43791/channels", mode: null, sessionPresent: false, allowedUserIds: [],
        enabled: false, gatewayRunning: true, connectionState: "unknown", applied: null, revision: 2 }));
    } });
    await screen.findByRole("button", { name: "Kopplung starten / QR erneuern" });
    fireEvent.click(screen.getByRole("button", { name: "Kopplung starten / QR erneuern" }));
    expect(await screen.findByAltText("WhatsApp-Kopplungs-QR-Code")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Erlaubte Telefonnummern (Ländervorwahl, ohne +)"), { target: { value: "491701234567" } });
    fireEvent.click(screen.getByRole("button", { name: "WhatsApp-Konfiguration speichern" }));
    await waitFor(() => expect(requests.some((entry) => entry.method === "PUT")).toBe(true));
    expect(requests.find((entry) => entry.method === "PUT")?.body).toEqual({ mode: "bot", allowedUserIds: ["491701234567"], enabled: false });
  });

  it("offers a cancel action for an expired WhatsApp QR code", async () => {
    const requests: Array<{ method: string; path: string }> = [];
    renderWithProviders(<MessagingGatewaySetup owner platform="whatsapp" />, { fetchImpl: async (input, init) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const path = new URL(request.url).pathname;
      if (path.endsWith("whatsapp-pairing")) {
        requests.push({ method: request.method, path });
        return jsonResponse(envelope({ id: "abcdefghijklmnopqrstuvwx", state: "qr_expired", qr: null,
          expiresAt: Date.now() + 300000, linkedIdentity: null, connectionState: "unknown", mode: "bot" }));
      }
      return jsonResponse(envelope({ setupUrl: "http://127.0.0.1:43791/channels", mode: null, sessionPresent: false, allowedUserIds: [],
        enabled: false, gatewayRunning: true, connectionState: "unknown", applied: null, revision: 2 }));
    } });
    expect(await screen.findByText("Der QR-Code ist abgelaufen. Neuen Code anfordern oder die Kopplung abbrechen.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Kopplung abbrechen" }));
    await waitFor(() => expect(requests.filter((entry) => entry.method === "DELETE" && entry.path.endsWith("whatsapp-pairing"))).toHaveLength(1));
  });
});
