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
          qr: pairing ? "FAKE_PAIRING_PAYLOAD" : null, expiresAt: pairing ? Date.now() / 1000 + 600 : null,
          linkedIdentity: null, connectionState: "unknown", mode: "bot" }));
      }
      requests.push({ method: request.method, body: request.method === "PUT" ? await request.json() : null });
      return jsonResponse(envelope({ setupUrl: "http://127.0.0.1:43791/channels", mode: null, sessionPresent: false, allowedUserIds: [],
        enabled: false, gatewayRunning: true, connectionState: "unknown", applied: null, revision: 2 }));
    } });
    await screen.findByRole("button", { name: "Kopplung starten / QR erneuern" });
    fireEvent.click(screen.getByRole("button", { name: "Kopplung starten / QR erneuern" }));
    expect(await screen.findByAltText("WhatsApp-Kopplungs-QR-Code")).toBeTruthy();
    // expiresAt is in seconds: ten minutes from now, not a date 50 years ahead.
    expect(screen.getByRole("timer").textContent).toMatch(/^Kopplungsvorgang endet in (10:00|9:5\d) Minuten\.$/);
    fireEvent.change(screen.getByLabelText("Erlaubte Telefonnummern (Ländervorwahl, ohne +)"), { target: { value: "491701234567" } });
    fireEvent.click(screen.getByRole("button", { name: "WhatsApp-Konfiguration speichern" }));
    await waitFor(() => expect(requests.some((entry) => entry.method === "PUT")).toBe(true));
    expect(requests.find((entry) => entry.method === "PUT")?.body).toEqual({ mode: "bot", allowedUserIds: ["491701234567"], enabled: false,
      groupPolicy: "disabled", groupAllowedIds: [], requireMention: false, replyPrefix: "" });
  });

  it("loads and saves WhatsApp group rules and the reply header", async () => {
    const requests: Array<{ method: string; body: unknown }> = [];
    renderWithProviders(<MessagingGatewaySetup owner platform="whatsapp" />, { fetchImpl: async (input, init) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      if (new URL(request.url).pathname.endsWith("whatsapp-pairing")) {
        return jsonResponse(envelope({ id: null, state: "idle", qr: null, expiresAt: null, linkedIdentity: null, connectionState: "unknown" }));
      }
      requests.push({ method: request.method, body: request.method === "PUT" ? await request.json() : null });
      return jsonResponse(envelope({ setupUrl: "http://127.0.0.1:43791/channels", mode: "bot", sessionPresent: true, allowedUserIds: ["491701234567"],
        enabled: true, gatewayRunning: true, connectionState: "connected", applied: null, revision: 3, groupPolicy: "allowlist",
        groupAllowedIds: ["120363012345678901@g.us"], requireMention: true, replyPrefix: "*Friday*" }));
    } });
    const groupIds = await screen.findByLabelText("Freigegebene Gruppen-IDs (endet auf @g.us)");
    expect((groupIds as HTMLInputElement).value).toBe("120363012345678901@g.us");
    expect((screen.getByLabelText("In Gruppen nur antworten, wenn Friday erwähnt wird") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(/Kopfzeile über WhatsApp-Antworten/) as HTMLInputElement).value).toBe("*Friday*");
    fireEvent.change(groupIds, { target: { value: "120363012345678901@g.us, 120363000000000002@g.us" } });
    fireEvent.change(screen.getByLabelText(/Kopfzeile über WhatsApp-Antworten/), { target: { value: " *F.R.I.D.A.Y.* " } });
    fireEvent.click(screen.getByRole("button", { name: "WhatsApp-Konfiguration speichern" }));
    await waitFor(() => expect(requests.some((entry) => entry.method === "PUT")).toBe(true));
    expect(requests.find((entry) => entry.method === "PUT")?.body).toEqual({ mode: "bot", allowedUserIds: ["491701234567"], enabled: true,
      groupPolicy: "allowlist", groupAllowedIds: ["120363012345678901@g.us", "120363000000000002@g.us"], requireMention: true,
      replyPrefix: "*F.R.I.D.A.Y.*" });
  });

  it("warns about all-groups access set in Hermes and saves the safer choice", async () => {
    const requests: Array<{ method: string; body: unknown }> = [];
    renderWithProviders(<MessagingGatewaySetup owner platform="whatsapp" />, { fetchImpl: async (input, init) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      if (new URL(request.url).pathname.endsWith("whatsapp-pairing")) {
        return jsonResponse(envelope({ id: null, state: "idle", qr: null, expiresAt: null, linkedIdentity: null, connectionState: "unknown" }));
      }
      requests.push({ method: request.method, body: request.method === "PUT" ? await request.json() : null });
      return jsonResponse(envelope({ setupUrl: "http://127.0.0.1:43791/channels", mode: "bot", sessionPresent: true, allowedUserIds: [],
        enabled: false, gatewayRunning: true, connectionState: "unknown", applied: null, revision: 4, groupPolicy: "open",
        groupAllowedIds: ["120363012345678901@g.us"], requireMention: null, replyPrefix: null }));
    } });
    expect(await screen.findByText(/In Hermes ist „alle Gruppen“ eingestellt\./)).toBeTruthy();
    expect((screen.getByLabelText("Gruppennachrichten") as HTMLSelectElement).value).toBe("disabled");
    expect(screen.queryByLabelText("Freigegebene Gruppen-IDs (endet auf @g.us)")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "WhatsApp-Konfiguration speichern" }));
    await waitFor(() => expect(requests.some((entry) => entry.method === "PUT")).toBe(true));
    expect(requests.find((entry) => entry.method === "PUT")?.body).toMatchObject({ groupPolicy: "disabled", groupAllowedIds: [],
      requireMention: false, replyPrefix: "" });
  });

  it("offers a cancel action for an expired WhatsApp QR code", async () => {
    const requests: Array<{ method: string; path: string }> = [];
    renderWithProviders(<MessagingGatewaySetup owner platform="whatsapp" />, { fetchImpl: async (input, init) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const path = new URL(request.url).pathname;
      if (path.endsWith("whatsapp-pairing")) {
        requests.push({ method: request.method, path });
        return jsonResponse(envelope({ id: "abcdefghijklmnopqrstuvwx", state: "qr_expired", qr: null,
          expiresAt: Date.now() / 1000 - 5, linkedIdentity: null, connectionState: "unknown", mode: "bot" }));
      }
      return jsonResponse(envelope({ setupUrl: "http://127.0.0.1:43791/channels", mode: null, sessionPresent: false, allowedUserIds: [],
        enabled: false, gatewayRunning: true, connectionState: "unknown", applied: null, revision: 2 }));
    } });
    expect(await screen.findByText("Der QR-Code ist abgelaufen. Neuen Code anfordern oder die Kopplung abbrechen.")).toBeTruthy();
    expect(screen.getByRole("timer").textContent).toBe("Der Kopplungsvorgang ist abgelaufen. Kopplung neu starten.");
    fireEvent.click(screen.getByRole("button", { name: "Kopplung abbrechen" }));
    await waitFor(() => expect(requests.filter((entry) => entry.method === "DELETE" && entry.path.endsWith("whatsapp-pairing"))).toHaveLength(1));
  });

  it("renders the Discord runtime connection in readable German", async () => {
    renderWithProviders(<MessagingGatewaySetup owner platform="discord" />, { fetchImpl: async () => jsonResponse(envelope({
      setupUrl: "http://127.0.0.1:43791/channels", tokenConfigured: true, allowedUserIds: [], allowedChannelIds: [],
      enabled: false, gatewayRunning: true, connectionState: "disconnected", applied: null, revision: 1 })) });
    const status = await screen.findByText(/Laufzeitverbindung: getrennt\./);
    expect(status.textContent).toContain("Laufzeitverbindung: getrennt.");
    expect(status.textContent).not.toMatch(/\bdisconnected\b/);
  });
});
