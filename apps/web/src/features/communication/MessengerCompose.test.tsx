import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { listOf, NOW, routedFetch, single, SOURCE } from "../memory/kit/testSupport";
import { MessengerCompose } from "./MessengerCompose";

vi.mock("@/lib/session", () => ({ useSession: () => ({ role: "owner" }) }));

afterEach(() => window.history.replaceState({}, "", "/communication"));

describe("MessengerCompose alert handoff", () => {
  it("hydrates an opaque notification reference and requires a fresh explicit preview", async () => {
    const id = "ntf_01JAAAAAAAAAAAAAAAAAAAAAAA";
    window.history.replaceState({}, "", `/communication?messengerNotification=${id}`);
    const alert = {
      id, version: 2, createdAt: NOW, updatedAt: NOW, source: SOURCE, priority: "P2", category: "system",
      title: "Backup abgeschlossen", body: "Der lokale Sicherungslauf ist fertig.", status: "open", acknowledged: false,
      acknowledgedAt: null, snoozedUntil: null, resolved: false, resolvedAt: null, sourceRef: null, targetRoute: null,
      escalation: [{ step: 1, channel: "telegram", state: "awaiting_approval", scheduledAt: NOW, sentAt: null, acknowledgedAt: null }],
    };
    const expectedDraft = {
      accountId: "default", platform: "telegram", recipient: "-1001234567890",
      text: "Backup abgeschlossen\n\nDer lokale Sicherungslauf ist fertig.",
    };
    const fake = routedFetch({
      "GET /api/v1/notifications": listOf([alert]),
      "GET /api/v1/settings": single({ notifications: {
        channels: [{ kind: "telegram", enabled: true, minPriority: "P2", accountId: "default", recipient: "-1001234567890" }],
        quietHours: { enabled: false, from: "22:00", to: "07:00" }, defaultEscalation: [], snoozeDefaultMinutes: 30,
      } }),
      "GET /api/v1/messenger/receipts": single({ items: [] }),
      "GET /api/v1/messenger/targets": single({ items: [] }),
      "POST /api/v1/messenger/preview": (_url: URL, _request: Request, body: unknown) => single({ token: "preview-token", expiresAt: NOW, fingerprint: "draft-hash", draft: body }),
    });
    const user = userEvent.setup();
    renderWithProviders(<MessengerCompose />, { fetchImpl: fake.fetch });

    const recipient = await screen.findByLabelText("Empfänger-ID") as HTMLInputElement;
    await waitFor(() => expect(recipient.value).toBe(expectedDraft.recipient));
    expect((screen.getByLabelText("Nachricht") as HTMLTextAreaElement).value).toBe(expectedDraft.text);
    expect(screen.getByRole("status")).toHaveTextContent("es wurde nichts gesendet");
    await user.click(screen.getByRole("button", { name: "Vorschau prüfen" }));
    await waitFor(() => expect(fake.to("POST", "/api/v1/messenger/preview")).toHaveLength(1));
    expect(fake.to("POST", "/api/v1/messenger/preview")[0]?.body).toEqual(expectedDraft);
    expect(await screen.findByRole("group", { name: "Versandfreigabe" })).toBeInTheDocument();
  });
});
