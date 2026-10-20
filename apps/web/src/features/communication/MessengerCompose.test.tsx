import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StagedWriteConfirmHost } from "@/lib/api/stagedWrite";
import { renderWithProviders } from "@/test/render";
import { listOf, NOW, routedFetch, single, SOURCE } from "../memory/kit/testSupport";
import { MessengerCompose } from "./MessengerCompose";

vi.mock("@/lib/session", () => ({ useSession: () => ({ role: "owner" }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/communication",
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => window.history.replaceState({}, "", "/communication"));

/** The staged-write answer of the Control API: 403 APPROVAL_REQUIRED with stage `preview` (P9 slice). */
const previewRequired = (previewText: string, previewId: string) => new Response(JSON.stringify({
  error: { code: "APPROVAL_REQUIRED", message: "Nachricht zuerst mit unveraenderter Vorschau bestaetigen.", severity: "info",
    retryable: false, correlationId: previewId, details: { stage: "preview", previewId, previewText } },
}), { status: 403, headers: { "content-type": "application/json" } });

/** Staged route helper: the first call is only staged, the repeat with `X-Action-Preview-Id` executes. */
const stagedRoute = (previewText: string, previewId: string, done: () => unknown) => (_url: URL, request: Request): unknown =>
  request.headers.get("x-action-preview-id") === previewId ? single(done()) : previewRequired(previewText, previewId);

describe("MessengerCompose alert handoff", () => {
  it("hydrates an opaque notification reference and requires a fresh explicit preview", async () => {
    const id = "ntf_01JAAAAAAAAAAAAAAAAAAAAAAA";
    window.history.replaceState({}, "", `/communication?messengerNotification=${id}&messengerStep=1`);
    const alert = {
      id, version: 2, createdAt: NOW, updatedAt: NOW, source: SOURCE, priority: "P2", category: "system",
      title: "Backup abgeschlossen", body: "Der lokale Sicherungslauf ist fertig.", status: "open", acknowledged: false,
      acknowledgedAt: null, snoozedUntil: null, resolved: false, resolvedAt: null, sourceRef: null, targetRoute: null,
      escalation: [{ step: 1, channel: "telegram", state: "awaiting_approval", scheduledAt: NOW, sentAt: null, acknowledgedAt: null }],
    };
    const expectedDraft = {
      accountId: "default", platform: "telegram", recipient: "-1001234567890",
      text: "Backup abgeschlossen\n\nDer lokale Sicherungslauf ist fertig.",
      notificationId: id, notificationStep: 1,
    };
    const fake = routedFetch({
      "GET /api/v1/notifications": (url: URL) => url.searchParams.get("cursor") === "older" ? listOf([alert]) : {
        ...listOf([]), pageInfo: { nextCursor: "older", hasNextPage: true },
      },
      "GET /api/v1/settings": single({ notifications: {
        channels: [{ kind: "telegram", enabled: true, minPriority: "P2", accountId: "default", recipient: "-1001234567890" }],
        quietHours: { enabled: false, from: "22:00", to: "07:00" }, defaultEscalation: [], snoozeDefaultMinutes: 30,
      } }),
      "GET /api/v1/messenger/receipts": single({ items: [] }),
      "GET /api/v1/messenger/targets": single({ items: [] }),
      "POST /api/v1/messenger/preview": (_url: URL, _request: Request, body: unknown) => single({ token: "preview-token", expiresAt: NOW, fingerprint: "draft-hash", draft: body, idempotencyKey: "stable-notification-key" }),
    });
    const user = userEvent.setup();
    renderWithProviders(<MessengerCompose />, { fetchImpl: fake.fetch });

    const recipient = await screen.findByLabelText("Empfänger-ID") as HTMLInputElement;
    await waitFor(() => expect(recipient.value).toBe(expectedDraft.recipient));
    expect((screen.getByLabelText("Nachricht") as HTMLTextAreaElement).value).toBe(expectedDraft.text);
    expect(screen.getByRole("status")).toHaveTextContent("es wurde nichts gesendet");
    await user.click(screen.getByRole("button", { name: "Vorschau prüfen" }));
    await waitFor(() => expect(fake.to("POST", "/api/v1/messenger/preview")).toHaveLength(1));
    expect(fake.to("GET", "/api/v1/notifications")).toHaveLength(2);
    expect(fake.to("POST", "/api/v1/messenger/preview")[0]?.body).toEqual(expectedDraft);
    expect(await screen.findByRole("group", { name: "Versandfreigabe" })).toBeInTheDocument();
  });
});


describe("MessengerCompose plain send", () => {
  it("stages the exact message and sends it only after the server preview is confirmed", async () => {
    const draft = { accountId: "default", platform: "telegram", recipient: "12345678", text: "Synthetic only" };
    const previewId = "corr_0000000000000000000000ms1";
    const fake = routedFetch({
      "GET /api/v1/messenger/receipts": single({ items: [] }),
      "GET /api/v1/messenger/targets": single({ items: [] }),
      "POST /api/v1/messenger/preview": (_url: URL, _request: Request, body: unknown) =>
        single({ token: "preview-token", expiresAt: NOW, fingerprint: "draft-hash", draft: body }),
      "POST /api/v1/messenger/confirm": stagedRoute(
        "Nachricht über telegram an 12345678 senden? Text: „Synthetic only“", previewId,
        () => ({ receiptId: "b".repeat(64), accountId: "default", platform: "telegram", recipient: "12345678",
          state: "sent", externalId: "syn-1", createdAt: NOW, replayed: false, memoryCapture: "written" })),
    });
    const user = userEvent.setup();
    renderWithProviders(<><MessengerCompose /><StagedWriteConfirmHost /></>, { fetchImpl: fake.fetch });

    fireEvent.change(await screen.findByLabelText("Empfänger-ID"), { target: { value: draft.recipient } });
    fireEvent.change(screen.getByLabelText("Nachricht"), { target: { value: draft.text } });
    await user.click(screen.getByRole("button", { name: "Vorschau prüfen" }));
    await user.click(await screen.findByRole("button", { name: "Genau diese Nachricht senden" }));
    await waitFor(() => expect(fake.to("POST", "/api/v1/messenger/confirm")).toHaveLength(1));
    const staged = fake.to("POST", "/api/v1/messenger/confirm")[0]!;
    expect(staged.headers.get("x-action-preview-id")).toBeNull();
    expect(staged.body).toEqual({ draft, token: "preview-token" });
    // The native pipeline derives the journal key from the preview id; no client idempotency key is sent.
    expect(staged.headers.get("idempotency-key")).toBeNull();

    const confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).getByText("Nachricht über telegram an 12345678 senden? Text: „Synthetic only“"))
      .toBeInTheDocument();
    await user.click(within(confirm).getByRole("button", { name: "Bestätigen" }));
    await waitFor(() => expect(fake.to("POST", "/api/v1/messenger/confirm")).toHaveLength(2));
    const executed = fake.to("POST", "/api/v1/messenger/confirm")[1]!;
    expect(executed.headers.get("x-action-preview-id")).toBe(previewId);
    expect(executed.body).toEqual(staged.body);
    expect(await screen.findByText("Der Adapter hat die Zustellung bestätigt.")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Versandfreigabe" })).not.toBeInTheDocument();
  });
});
