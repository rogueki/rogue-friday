import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setApiClient } from "@/lib/api/client";
import { jsonResponse, renderWithProviders } from "@/test/render";
import { HimalayaAccountSetup } from "./HimalayaAccountSetup";

const account = {
  contractVersion: "2.0.0",
  data: { managed: true, configPresent: true, credentialsPresent: true, cliInstalled: true, readyForLocalUse: true, connectionChecked: false, revision: 1 },
  freshness: { state: "fresh", asOf: "2026-10-16T10:00:00Z" },
};

afterEach(() => setApiClient(null));

describe("Himalaya IMAP connection check", () => {
  it("lists folders only on explicit owner click and clears the result after editing", async () => {
    const paths: string[] = [];
    renderWithProviders(<HimalayaAccountSetup owner />, { fetchImpl: async (input) => {
      const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
      paths.push(path);
      if (path.endsWith("/settings/himalaya-account")) return jsonResponse(account);
      if (path.endsWith("/communication/himalaya/mailboxes")) return jsonResponse({
        contractVersion: "2.0.0", data: { mailboxes: [{ id: "INBOX", name: "INBOX", role: "inbox" }] }, freshness: account.freshness,
      });
      return jsonResponse({}, 404);
    } });

    const button = await screen.findByRole("button", { name: "IMAP-Verbindung prüfen" });
    expect(paths.filter((path) => path.endsWith("/communication/himalaya/mailboxes"))).toHaveLength(0);
    fireEvent.click(button);
    expect(await screen.findByText("IMAP-Verbindung erfolgreich; 1 Ordner gefunden. SMTP wurde nicht geprüft.")).toBeInTheDocument();
    expect(paths.filter((path) => path.endsWith("/communication/himalaya/mailboxes"))).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("IMAP-Server"), { target: { value: "new.example" } });
    expect(button).toBeDisabled();
    expect(screen.queryByText(/1 Ordner gefunden/)).toBeNull();
  });

  it("reports a sanitized failure and offers no check to non-owners", async () => {
    let mailboxCalls = 0;
    const fetchImpl: typeof fetch = async (input) => {
      const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
      if (path.endsWith("/settings/himalaya-account")) return jsonResponse(account);
      if (path.endsWith("/communication/himalaya/mailboxes")) {
        mailboxCalls++;
        return jsonResponse({ code: "UNAVAILABLE", message: "secret@example.org password leaked", correlationId: "corr_test", severity: "error", retryable: false }, 503);
      }
      return jsonResponse({}, 404);
    };
    const owner = renderWithProviders(<HimalayaAccountSetup owner />, { fetchImpl });
    fireEvent.click(await screen.findByRole("button", { name: "IMAP-Verbindung prüfen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("IMAP-Verbindung fehlgeschlagen");
    expect(screen.queryByText(/secret@example\.org/)).toBeNull();
    expect(mailboxCalls).toBe(1);
    owner.unmount();

    renderWithProviders(<HimalayaAccountSetup owner={false} />, { fetchImpl });
    await waitFor(() => expect(screen.queryByRole("button", { name: "IMAP-Verbindung prüfen" })).toBeNull());
    expect(mailboxCalls).toBe(1);
  });
});
