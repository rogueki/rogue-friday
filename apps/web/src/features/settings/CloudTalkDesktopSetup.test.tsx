import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setApiClient } from "@/lib/api/client";
import { jsonResponse, renderWithProviders } from "@/test/render";
import { CloudTalkDesktopSetup } from "./CloudTalkDesktopSetup";

const status = (overrides: Record<string, unknown> = {}) => ({ contractVersion: "2.0.0",
  data: { configured: true, agentId: 1234, revision: 1, note: "API-Zugang gespeichert", ownerPhone: "+491701234567",
    ownerPhoneConfirmed: true, voiceAgentId: "friday-agent", remindersEnabled: true, reminderMinutes: 15,
    lastReminderState: "unknown", lastReminderAt: "2026-10-17T12:46:00.000Z", ...overrides },
  freshness: { state: "fresh", asOf: "2026-10-17T12:50:00Z" } });

afterEach(() => setApiClient(null));

describe("CloudTalk desktop setup", () => {
  it("names the last reminder state in German", async () => {
    renderWithProviders(<CloudTalkDesktopSetup owner />, { fetchImpl: async () => jsonResponse(status()) });
    await screen.findByText(/Letzte Erinnerung: Ausgang unklar am /);
    expect(screen.queryByText(/\bunknown\b/)).toBeNull();
  });

  it("keeps one idempotency key per preview and blocks a new preview after an unclear outcome", async () => {
    const keys: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const url = request.url;
      if (url.includes("/telephony/cloudtalk/preview")) {
        return jsonResponse({ contractVersion: "2.0.0", data: { destination: "+491709876543", agentId: 1234,
          expiresAt: "2026-10-17T12:52:00.000Z", token: "preview-token", note: "Hinweis" },
          freshness: { state: "fresh", asOf: "2026-10-17T12:50:00Z" } });
      }
      if (url.includes("/telephony/cloudtalk/calls")) {
        const key = request.headers.get("Idempotency-Key");
        if (key) keys.push(key);
        return jsonResponse({ contractVersion: "2.0.0", data: { id: "ctcall_1", destination: "+491709876543",
          state: "unknown", providerStatus: null, createdAt: "2026-10-17T12:50:00.000Z",
          updatedAt: "2026-10-17T12:50:00.000Z", note: "Hinweis" },
          freshness: { state: "fresh", asOf: "2026-10-17T12:50:00Z" } });
      }
      return jsonResponse(status({ lastReminderState: null, lastReminderAt: null }));
    });
    const user = userEvent.setup();
    renderWithProviders(<CloudTalkDesktopSetup owner />, { fetchImpl });
    await user.type(await screen.findByLabelText(/^Zielnummer/), "+491709876543");
    await user.click(screen.getByRole("button", { name: "Rufvorschau erstellen" }));
    await user.click(await screen.findByRole("button", { name: "Diesen CloudTalk-Ruf anfragen" }));
    await screen.findByText(/Anfrage ctcall_1: Ausgang unklar/);
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toBe("");
    expect(screen.getByRole("button", { name: "Rufvorschau erstellen" })).toBeDisabled();
    await user.click(screen.getByLabelText(/Ich habe im CloudTalk-Dashboard geprüft/));
    expect(screen.getByRole("button", { name: "Rufvorschau erstellen" })).toBeEnabled();
  });

  it("offers no input to non-owners", () => {
    renderWithProviders(<CloudTalkDesktopSetup owner={false} />, { fetchImpl: async () => jsonResponse(status()) });
    expect(screen.getByText("Nur der Owner kann den CloudTalk-Zugang einrichten oder einen Ruf bestätigen.")).toBeInTheDocument();
  });
});
