import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setApiClient } from "@/lib/api/client";
import { jsonResponse, renderWithProviders } from "@/test/render";
import { GatewayPairingPanel } from "./GatewayPairingPanel";

const state = { contractVersion: "2.0.0", data: { platforms: [
  { platform: "telegram", pending: [{ requestId: "0123456789abcdef", userId: "424242", userName: "Alex", ageMinutes: 3 }],
    approved: [{ userId: "515151", userName: "Sam", approvedAt: "2026-10-29T08:00:00.000Z" }] },
  { platform: "discord", pending: [], approved: [] }, { platform: "whatsapp", pending: [], approved: [] } ] },
  freshness: { state: "fresh", asOf: "2026-10-29T09:00:00Z" } };

afterEach(() => { setApiClient(null); vi.restoreAllMocks(); });

describe("Gateway pairing panel", () => {
  it("lists requests and approvals per platform", async () => {
    renderWithProviders(<GatewayPairingPanel owner />, { fetchImpl: async () => jsonResponse(state) });
    expect(await screen.findByText("Alex (ID 424242), seit 3 Min.")).toBeInTheDocument();
    expect(screen.getByText(/Sam \(ID 515151\)/)).toBeInTheDocument();
    expect(screen.getAllByText("Keine offenen Anfragen.")).toHaveLength(2);
  });

  it("approves by request id", async () => {
    const requests: Array<{ method: string; url: string; body: unknown }> = [];
    renderWithProviders(<GatewayPairingPanel owner />, { fetchImpl: async (input, init) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const body = request.method === "POST" ? await request.clone().json() : null;
      requests.push({ method: request.method, url: request.url, body });
      return jsonResponse(state);
    } });
    fireEvent.click(await screen.findByRole("button", { name: "Alex auf Telegram freigeben" }));
    await waitFor(() => expect(requests.some((entry) => entry.method === "POST" && entry.url.endsWith("/gateway-pairing/approve"))).toBe(true));
    expect(requests.find((entry) => entry.method === "POST")?.body).toEqual({ platform: "telegram", requestId: "0123456789abcdef" });
    expect(await screen.findByText("Freigegeben. Hermes antwortet dieser Person ab sofort.")).toBeInTheDocument();
  });

  it("asks before revoking and does nothing on cancel", async () => {
    const requests: Array<{ method: string; url: string }> = [];
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderWithProviders(<GatewayPairingPanel owner />, { fetchImpl: async (input, init) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      requests.push({ method: request.method, url: request.url });
      return jsonResponse(state);
    } });
    fireEvent.click(await screen.findByRole("button", { name: "Freigabe für Sam auf Telegram entziehen" }));
    await waitFor(() => expect(window.confirm).toHaveBeenCalled());
    expect(requests.some((entry) => entry.method === "POST" && entry.url.endsWith("/gateway-pairing/revoke"))).toBe(false);
  });

  it("offers nothing to non-owners", () => {
    renderWithProviders(<GatewayPairingPanel owner={false} />, { fetchImpl: async () => jsonResponse(state) });
    expect(screen.getByText("Nur der Owner kann Kopplungsanfragen freigeben.")).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
