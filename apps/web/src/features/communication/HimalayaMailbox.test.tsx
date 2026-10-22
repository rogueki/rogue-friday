import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MailAccount } from "@friday/sdk";
import { setApiClient } from "@/lib/api/client";
import { renderWithProviders } from "@/test/render";
import { routedFetch, single } from "../memory/kit/testSupport";
import { HimalayaMailbox } from "./HimalayaMailbox";

afterEach(() => { setApiClient(null); vi.restoreAllMocks(); });

const account = (id: string, displayName: string, email: string): MailAccount => ({
  id, displayName, email, senderName: displayName, aliases: [], signature: "", imapHost: `imap.${id}.test`,
  imapPort: 993, imapSecurity: "tls", imapLogin: email, smtpHost: `smtp.${id}.test`, smtpPort: 465,
  smtpSecurity: "tls", smtpLogin: email, sentFolder: "Sent", draftsFolder: "Drafts", trashFolder: "Trash",
  archiveFolder: "Archive", spamFolder: "Spam", authMode: "password", oauthClientId: "", oauthTenant: "",
  revision: 1, secretState: { imapPassword: true, smtpPassword: true, oauthRefreshToken: false },
});

const WORK = account("work", "Geschäft", "erik@firma.test");
const PRIVATE = account("privat", "Privat", "erik@privat.test");

const SESSION = single({ authenticated: true, setupRequired: false, csrfToken: "csrf-test", role: "owner",
  user: { id: "user-1", displayName: "Erik Brandt", role: "owner", email: "erik@firma.test" },
  expiresAt: null, reauthUntil: null });

const sessionRoute = { "GET /api/v1/auth/session": SESSION };

const envelope = (id: string, subject: string, uidValidity: string) => ({
  mailbox: "INBOX", uidValidity, page: 1,
  items: [{ id, subject, from: "Absender <absender@fremd.test>", date: "Thu, 22 Oct 2026 10:00:00 +0000", flags: [] }],
});

const messageOf = (uid: string, uidValidity: string, subject: string, attachments: unknown[] = []) => ({
  mailbox: "INBOX", uid, uidValidity, subject, from: "Absender <absender@fremd.test>",
  to: "erik@firma.test", date: "Thu, 22 Oct 2026 10:00:00 +0000", messageId: `<${uid}@fremd.test>`,
  replyTo: "", references: "", bodyText: "Bitte prüfen.", attachments,
});

async function openMailbox(user: ReturnType<typeof userEvent.setup>, accountId: "work" | "privat") {
  await user.click(await screen.findByRole("button", { name: "E-Mail Postfach öffnen" }));
  const select = await screen.findByLabelText("Konto");
  await user.selectOptions(select, accountId);
}

describe("integrated mailbox", () => {
  it("keeps two accounts and their folders apart and never marks a read message as read", async () => {
    const user = userEvent.setup();
    const fake = routedFetch({
      ...sessionRoute,
      "GET /api/v1/integrations/mail/accounts": single({ accounts: [WORK, PRIVATE], defaultAccountId: "work", revision: 1 }),
      "GET /api/v1/integrations/mail/accounts/work/folders": single({ folders: [
        { id: "INBOX", name: "Posteingang", role: null }, { id: "Sent", name: "Gesendet", role: "sent" }] }),
      "GET /api/v1/integrations/mail/accounts/privat/folders": single({ folders: [{ id: "INBOX", name: "Posteingang", role: null }] }),
      "GET /api/v1/integrations/mail/accounts/work/envelopes": single(envelope("17", "Wartung am Freitag", "42")),
      "GET /api/v1/integrations/mail/accounts/privat/envelopes": single(envelope("3", "Privater Termin", "77")),
      "GET /api/v1/integrations/mail/accounts/work/message": single(messageOf("17", "42", "Wartung am Freitag")),
    });
    renderWithProviders(<HimalayaMailbox />, { fetchImpl: fake.fetch });
    await openMailbox(user, "work");
    expect(await screen.findByText(/Lesen markiert Nachrichten nicht als gelesen/)).toBeInTheDocument();
    const folder = await screen.findByLabelText("Ordner");
    expect(within(folder).getByRole("option", { name: "Gesendet" })).toBeInTheDocument();
    await user.selectOptions(folder, "INBOX");
    await user.click(await screen.findByRole("button", { name: /Wartung am Freitag/ }));
    expect(await screen.findByText("Bitte prüfen.")).toBeInTheDocument();
    const messageCall = fake.to("GET", "/api/v1/integrations/mail/accounts/work/message")[0]!;
    expect(messageCall.search).toContain("uidValidity=42");
    expect(messageCall.search).toContain("uid=17");
    // Reading opened the message with its UIDVALIDITY and issued no flag change at all.
    expect(fake.to("POST", "/api/v1/integrations/mail/accounts/work/change")).toHaveLength(0);
    expect(fake.to("GET", "/api/v1/integrations/mail/accounts/privat/envelopes")).toHaveLength(0);

    await user.selectOptions(screen.getByLabelText("Konto"), "privat");
    const privateFolder = await screen.findByLabelText("Ordner");
    expect(within(privateFolder).queryByRole("option", { name: "Gesendet" })).toBeNull();
    await user.selectOptions(privateFolder, "INBOX");
    expect(await screen.findByRole("button", { name: /Privater Termin/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Wartung am Freitag/ })).toBeNull();
    expect(fake.to("GET", "/api/v1/integrations/mail/accounts/privat/envelopes")[0]!.search).toContain("mailbox=INBOX");
  });

  it("shows the send journal and reviews an uncertain receipt without sending again", async () => {
    const user = userEvent.setup();
    const fake = routedFetch({
      ...sessionRoute,
      "GET /api/v1/integrations/mail/accounts": single({ accounts: [WORK], defaultAccountId: "work", revision: 1 }),
      "GET /api/v1/integrations/mail/accounts/work/receipts": single({ items: [
        { receiptId: "r".repeat(12) + "-unklar", state: "uncertain", archivePending: true, createdAt: "2026-10-22T10:00:00Z" },
        { receiptId: "r".repeat(12) + "-offen", state: "sent", archivePending: true, createdAt: "2026-10-22T11:00:00Z" },
        { receiptId: "r".repeat(12) + "-fertig", state: "sent", archivePending: false, createdAt: "2026-10-22T12:00:00Z" },
      ] }),
      "POST /api/v1/integrations/mail/accounts/work/receipts/rrrrrrrrrrrr-unklar/review": single({ state: "sent", archivePending: false }),
    });
    renderWithProviders(<HimalayaMailbox />, { fetchImpl: fake.fetch });
    await openMailbox(user, "work");
    const journal = await screen.findByRole("region", { name: "Offene Versandbelege" });
    expect(within(journal).getByText(/Versand unklar/)).toBeInTheDocument();
    expect(within(journal).getByText(/SMTP bestätigt, Gesendet-Kopie offen/)).toBeInTheDocument();
    expect(within(journal).queryByText(new RegExp("fertig"))).toBeNull();
    await user.click(within(journal).getByRole("button", { name: "Gesendet-Ordner prüfen" }));
    expect(await screen.findByText("Gesendet-Kopie bestätigt.")).toBeInTheDocument();
    const review = fake.to("POST", `/api/v1/integrations/mail/accounts/work/receipts/${"r".repeat(12)}-unklar/review`);
    expect(review).toHaveLength(1);
    // The journal action never touches the send route.
    expect(fake.calls.filter((call) => call.path.endsWith("/send"))).toHaveLength(0);
  });

  it("never downloads an attachment above the size limit and fetches the small one once", async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn(() => "blob:test");
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const fake = routedFetch({
      ...sessionRoute,
      "GET /api/v1/integrations/mail/accounts": single({ accounts: [WORK], defaultAccountId: "work", revision: 1 }),
      "GET /api/v1/integrations/mail/accounts/work/folders": single({ folders: [{ id: "INBOX", name: "Posteingang", role: null }] }),
      "GET /api/v1/integrations/mail/accounts/work/envelopes": single(envelope("17", "Mit Anhang", "42")),
      "GET /api/v1/integrations/mail/accounts/work/message": single(messageOf("17", "42", "Mit Anhang", [
        { filename: "groß.bin", contentType: "application/octet-stream", size: 6 * 1024 * 1024 },
        { filename: "notiz.txt", contentType: "text/plain", size: 12 },
      ])),
      "GET /api/v1/integrations/mail/accounts/work/attachment": single({ filename: "notiz.txt", contentType: "text/plain", size: 12,
        data: btoa("Hallo Welt") }),
    });
    renderWithProviders(<HimalayaMailbox />, { fetchImpl: fake.fetch });
    await openMailbox(user, "work");
    await user.selectOptions(await screen.findByLabelText("Ordner"), "INBOX");
    await user.click(await screen.findByRole("button", { name: /Mit Anhang/ }));
    const attachments = await screen.findByRole("list", { name: "Anhänge" });
    expect(within(attachments).getByRole("button", { name: /groß.bin/ })).toBeDisabled();
    const small = within(attachments).getByRole("button", { name: /notiz.txt/ });
    expect(small).toBeEnabled();
    await user.click(small);
    await waitFor(() => expect(fake.to("GET", "/api/v1/integrations/mail/accounts/work/attachment")).toHaveLength(1));
    expect(fake.to("GET", "/api/v1/integrations/mail/accounts/work/attachment")[0]!.search).toContain("index=1");
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clicked).toHaveBeenCalledTimes(1);
  });
});