import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setApiClient } from "@/lib/api/client";
import { jsonResponse, renderWithProviders } from "@/test/render";
import { TelegramGatewaySetup } from "./TelegramGatewaySetup";

const status = { contractVersion: "2.0.0", data: { tokenConfigured: false, botAuthentication: "missing", botId: null, botUsername: null, receiveMode: "unknown", allowedUserIds: [], allowedChatIds: [],
  enabled: false, gatewayRunning: false, connectionState: "unknown", applied: null, revision: 42, requireMention: null },
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
      clearToken: false, allowedUserIds: ["123456789"], allowedChatIds: [], removeWebhook: false, enabled: true, requireMention: false });
    expect(screen.queryByText(token)).toBeNull();
  });

  it("offers no input to non-owners", () => {
    renderWithProviders(<TelegramGatewaySetup owner={false} />, { fetchImpl: async () => jsonResponse(status) });
    expect(screen.getByText("Nur der Owner kann den Telegram-Bot einrichten.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Bot-Token")).toBeNull();
  });

  it("shows readable labels instead of raw bot status values", async () => {
    renderWithProviders(<TelegramGatewaySetup owner />, { fetchImpl: async () => jsonResponse({ ...status,
      data: { ...status.data, botAuthentication: "invalid", receiveMode: "polling" } }) });
    await screen.findByText(/Bot-Authentisierung: von Telegram abgelehnt · Empfangsmodus: Polling\./);
    expect(screen.queryByText(/\binvalid\b/)).toBeNull();
  });

  it("sends group chat ids", async () => {
    const requests: Array<{ method: string; body: unknown }> = [];
    renderWithProviders(<TelegramGatewaySetup owner />, { fetchImpl: async (input, init) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const method = request.method;
      const body = method === "PUT" ? await request.json() : null;
      requests.push({ method, body });
      return jsonResponse(status);
    } });
    await screen.findByRole("button", { name: "Telegram-Konfiguration speichern" });
    fireEvent.change(screen.getByLabelText("Erlaubte Gruppen-Chat-IDs (beginnen mit „-“)"), { target: { value: "-1001, -1002" } });
    fireEvent.click(screen.getByRole("button", { name: "Telegram-Konfiguration speichern" }));
    await waitFor(() => expect(requests.some((entry) => entry.method === "PUT")).toBe(true));
    expect(requests.find((entry) => entry.method === "PUT")?.body).toEqual({ token: "",
      clearToken: false, allowedUserIds: [], allowedChatIds: ["-1001", "-1002"], removeWebhook: false, enabled: false, requireMention: false });
  });

  it("offers webhook removal only in webhook mode and sends it explicitly", async () => {
    const polling = renderWithProviders(<TelegramGatewaySetup owner />, { fetchImpl: async () => jsonResponse({ ...status,
      data: { ...status.data, receiveMode: "polling" } }) });
    await screen.findByRole("button", { name: "Telegram-Konfiguration speichern" });
    expect(screen.queryByLabelText("Webhook bei Telegram entfernen, damit Hermes per Polling empfängt")).toBeNull();
    polling.unmount();

    const requests: Array<{ method: string; body: unknown }> = [];
    renderWithProviders(<TelegramGatewaySetup owner />, { fetchImpl: async (input, init) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const method = request.method;
      const body = method === "PUT" ? await request.json() : null;
      requests.push({ method, body });
      return jsonResponse({ ...status, data: { ...status.data, receiveMode: "webhook" } });
    } });
    await screen.findByRole("button", { name: "Telegram-Konfiguration speichern" });
    fireEvent.click(screen.getByLabelText("Webhook bei Telegram entfernen, damit Hermes per Polling empfängt"));
    fireEvent.click(screen.getByRole("button", { name: "Telegram-Konfiguration speichern" }));
    await waitFor(() => expect(requests.some((entry) => entry.method === "PUT")).toBe(true));
    expect(requests.find((entry) => entry.method === "PUT")?.body).toMatchObject({ removeWebhook: true });
  });

  it("loads and saves the group mention rule", async () => {
    const requests: Array<{ method: string; body: unknown }> = [];
    renderWithProviders(<TelegramGatewaySetup owner />, { fetchImpl: async (input, init) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      requests.push({ method: request.method, body: request.method === "PUT" ? await request.json() : null });
      return jsonResponse({ ...status, data: { ...status.data, allowedChatIds: ["-1001234567890"], requireMention: true } });
    } });
    const box = await screen.findByLabelText("In Gruppen nur antworten, wenn Friday erwähnt oder per Befehl angesprochen wird");
    expect((box as HTMLInputElement).checked).toBe(true);
    fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: "Telegram-Konfiguration speichern" }));
    await waitFor(() => expect(requests.some((entry) => entry.method === "PUT")).toBe(true));
    expect(requests.find((entry) => entry.method === "PUT")?.body).toMatchObject({ allowedChatIds: ["-1001234567890"], requireMention: false });
  });
});
