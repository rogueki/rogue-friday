import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { MailAccount } from "@friday/sdk";
import { StagedWriteConfirmHost } from "@/lib/api/stagedWrite";
import { setApiClient } from "@/lib/api/client";
import { renderWithProviders } from "@/test/render";
import { errorResponse, routedFetch, single } from "../memory/kit/testSupport";
import { MailCompose } from "./MailCompose";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push }),
  usePathname: () => "/communication",
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => setApiClient(null));

const ACCOUNT = { id: "work", displayName: "Geschäftspostfach", email: "sender@example.test", senderName: "Sender",
  aliases: [], signature: "", imapHost: "imap.example.test", imapPort: 993, imapSecurity: "tls",
  imapLogin: "sender@example.test", smtpHost: "smtp.example.test", smtpPort: 465, smtpSecurity: "tls",
  smtpLogin: "sender@example.test", sentFolder: "Sent", draftsFolder: "Drafts", trashFolder: "Trash",
  archiveFolder: "Archive", spamFolder: "Spam", authMode: "password", oauthClientId: "", oauthTenant: "",
  revision: 1, secretState: { imapPassword: true, smtpPassword: true, oauthRefreshToken: false } } as MailAccount;

const SEND_PATH = "POST /api/v1/integrations/mail/accounts/work/send";
const RECEIPT = "a".repeat(64);

/** The staged-write answer of the Control API: 403 APPROVAL_REQUIRED with stage `preview` (P9 slice). */
const previewRequired = (previewText: string, previewId: string) => new Response(JSON.stringify({
  error: { code: "APPROVAL_REQUIRED", message: "E-Mail zuerst mit unveraenderter Vorschau bestaetigen.", severity: "info",
    retryable: false, correlationId: previewId, details: { stage: "preview", previewId, previewText } },
}), { status: 403, headers: { "content-type": "application/json" } });

/** Staged route helper: the first call is only staged, the repeat with `X-Action-Preview-Id` executes. */
const stagedRoute = (previewText: string, previewId: string, done: () => unknown) => (_url: URL, request: Request): unknown =>
  request.headers.get("x-action-preview-id") === previewId ? single(done()) : previewRequired(previewText, previewId);

async function fillAndSend(user: ReturnType<typeof userEvent.setup>) {
  fireEvent.change(screen.getByLabelText("Empfänger"), { target: { value: "erik@example.test" } });
  fireEvent.change(screen.getByLabelText("Betreff"), { target: { value: "Projektstatus" } });
  fireEvent.change(screen.getByLabelText("Text"), { target: { value: "Das Release ist fertig." } });
  await user.click(screen.getByRole("button", { name: "Versand prüfen" }));
  await user.click(screen.getByRole("button", { name: "Genau diese E-Mail senden" }));
}

it("stages the exact message and sends it only after the server preview is confirmed", async () => {
  const user = userEvent.setup();
  const fake = routedFetch({ [SEND_PATH]: stagedRoute(
    "E-Mail an erik@example.test senden? Betreff: „Projektstatus“", "corr_0000000000000000000000ml1",
    () => ({ state: "sent", archivePending: false, replayed: false, receiptId: RECEIPT, memoryCapture: "written" })) });
  const onClose = vi.fn();
  renderWithProviders(<><MailCompose account={ACCOUNT} mode="new" onClose={onClose} /><StagedWriteConfirmHost /></>,
    { fetchImpl: fake.fetch });
  await fillAndSend(user);
  await waitFor(() => expect(fake.to("POST", "/api/v1/integrations/mail/accounts/work/send")).toHaveLength(1));
  const staged = fake.to("POST", "/api/v1/integrations/mail/accounts/work/send")[0]!;
  expect(staged.headers.get("x-action-preview-id")).toBeNull();
  expect(staged.body).toMatchObject({ to: ["erik@example.test"], from: "sender@example.test",
    subject: "Projektstatus", body: "Das Release ist fertig." });
  const confirm = await screen.findByRole("alertdialog");
  expect(within(confirm).getByText("E-Mail an erik@example.test senden? Betreff: „Projektstatus“")).toBeInTheDocument();
  await user.click(within(confirm).getByRole("button", { name: "Bestätigen" }));
  await waitFor(() => expect(fake.to("POST", "/api/v1/integrations/mail/accounts/work/send")).toHaveLength(2));
  const executed = fake.to("POST", "/api/v1/integrations/mail/accounts/work/send")[1]!;
  expect(executed.headers.get("x-action-preview-id")).toBe("corr_0000000000000000000000ml1");
  expect(executed.body).toEqual(staged.body);
  // The compose view stays open and shows the receipt instead of closing on the staged round trip.
  expect(onClose).not.toHaveBeenCalled();
  expect(await screen.findByText("SMTP-Versand und Gesendet-Kopie bestätigt.")).toBeInTheDocument();
  expect(screen.getByText(/Versandbeleg:/)).toBeInTheDocument();
});

it("keeps an uncertain outcome visible with the review action instead of resending", async () => {
  const user = userEvent.setup();
  const fake = routedFetch({ [SEND_PATH]: stagedRoute(
    "E-Mail an erik@example.test senden? Betreff: „Projektstatus“", "corr_0000000000000000000000ml2",
    () => ({ state: "uncertain", archivePending: false, replayed: false, receiptId: RECEIPT, memoryCapture: "written" })) });
  renderWithProviders(<><MailCompose account={ACCOUNT} mode="new" onClose={vi.fn()} /><StagedWriteConfirmHost /></>,
    { fetchImpl: fake.fetch });
  await fillAndSend(user);
  const confirm = await screen.findByRole("alertdialog");
  await user.click(within(confirm).getByRole("button", { name: "Bestätigen" }));
  expect(await screen.findByText(/Versand unklar/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Gesendet-Ordner prüfen/ })).toBeInTheDocument();
  expect(fake.to("POST", "/api/v1/integrations/mail/accounts/work/send")).toHaveLength(2);
});

it("keeps the dialog open with the server message when validation fails before staging", async () => {
  const user = userEvent.setup();
  const fake = routedFetch({ [SEND_PATH]: () => errorResponse("VALIDATION_FAILED", "Empfängeradresse ist ungültig.", 422) });
  const onClose = vi.fn();
  renderWithProviders(<><MailCompose account={ACCOUNT} mode="new" onClose={onClose} /><StagedWriteConfirmHost /></>,
    { fetchImpl: fake.fetch });
  await fillAndSend(user);
  expect((await screen.findAllByText(/Antwort unbekannt|Empfängeradresse/)).length).toBeGreaterThan(0);
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(onClose).not.toHaveBeenCalled();
  expect(fake.to("POST", "/api/v1/integrations/mail/accounts/work/send")).toHaveLength(1);
});

const DRAFT_PATH = "POST /api/v1/integrations/mail/accounts/work/draft";
const ALIAS_ACCOUNT = { ...ACCOUNT, aliases: ["alias@example.test"] } as MailAccount;

async function fillDraft(user: ReturnType<typeof userEvent.setup>) {
  fireEvent.change(screen.getByLabelText("Empfänger"), { target: { value: "erik@example.test" } });
  fireEvent.change(screen.getByLabelText("Betreff"), { target: { value: "Entwurf mit Anhang" } });
  fireEvent.change(screen.getByLabelText("Text"), { target: { value: "Noch nicht senden." } });
  await user.click(screen.getByRole("button", { name: "Entwurf speichern (ohne Versand)" }));
}

it("stores a draft under the chosen alias without ever sending", async () => {
  const user = userEvent.setup();
  const fake = routedFetch({ [DRAFT_PATH]: () => single({
    state: "drafted", messageId: "<friday-" + "b".repeat(64) + "@friday.local>", alreadyPresent: false }) });
  renderWithProviders(<MailCompose account={ALIAS_ACCOUNT} mode="new" onClose={vi.fn()} />, { fetchImpl: fake.fetch });
  await user.selectOptions(screen.getByLabelText("Absender"), "alias@example.test");
  await fillDraft(user);
  await waitFor(() => expect(fake.to("POST", "/api/v1/integrations/mail/accounts/work/draft")).toHaveLength(1));
  const draft = fake.to("POST", "/api/v1/integrations/mail/accounts/work/draft")[0]!;
  expect(draft.body).toMatchObject({ from: "alias@example.test", to: ["erik@example.test"], subject: "Entwurf mit Anhang" });
  const key = draft.headers.get("idempotency-key");
  expect(key).toBeTruthy();
  expect(fake.to("POST", "/api/v1/integrations/mail/accounts/work/send")).toHaveLength(0);
  expect(await screen.findByText(/Entwurf im Entwürfe-Ordner gespeichert/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Entwurf speichern (ohne Versand)" }));
  await waitFor(() => expect(fake.to("POST", "/api/v1/integrations/mail/accounts/work/draft")).toHaveLength(2));
  expect(fake.to("POST", "/api/v1/integrations/mail/accounts/work/draft")[1]!.headers.get("idempotency-key")).toBe(key);
  expect(fake.to("POST", "/api/v1/integrations/mail/accounts/work/send")).toHaveLength(0);
});

it("rejects an oversized attachment before any request and keeps small files", async () => {
  const user = userEvent.setup();
  const fake = routedFetch({ [DRAFT_PATH]: single({ state: "drafted", messageId: "<friday-" + "c".repeat(64) + "@friday.local>", alreadyPresent: false }) });
  renderWithProviders(<MailCompose account={ACCOUNT} mode="new" onClose={vi.fn()} />, { fetchImpl: fake.fetch });
  const input = screen.getByLabelText(/Anhänge/);
  const big = new File([new Uint8Array(6 * 1024 * 1024)], "zu-gross.bin", { type: "application/octet-stream" });
  fireEvent.change(input, { target: { files: [big] } });
  expect(await screen.findByText("Anhang zu groß (maximal 5 MB je Datei).")).toBeInTheDocument();
  expect(fake.calls).toHaveLength(0);
  fireEvent.change(input, { target: { files: [new File(["Hallo Welt"], "notiz.txt", { type: "text/plain" })] } });
  expect(await screen.findByText("notiz.txt")).toBeInTheDocument();
  await fillDraft(user);
  await waitFor(() => expect(fake.to("POST", "/api/v1/integrations/mail/accounts/work/draft")).toHaveLength(1));
  expect(fake.to("POST", "/api/v1/integrations/mail/accounts/work/draft")[0]!.body).toMatchObject({
    attachments: [{ filename: "notiz.txt", data: "SGFsbG8gV2VsdA==" }] });
});

it("answers the sender with the original message ids and never with the own address", async () => {
  const user = userEvent.setup();
  const fake = routedFetch({ [SEND_PATH]: stagedRoute(
    "E-Mail an absender@fremd.test senden? Betreff: „Re: Wartung“", "corr_0000000000000000000000ml2",
    () => ({ state: "sent", archivePending: false, replayed: false, receiptId: RECEIPT, memoryCapture: "written" })) });
  const original = { mailbox: "INBOX", uid: "17", uidValidity: "42", subject: "Wartung", from: "Absender <absender@fremd.test>",
    to: "sender@example.test, alias@example.test", date: "Thu, 22 Oct 2026 10:00:00 +0000",
    messageId: "<orig@fremd.test>", replyTo: "", references: "<root@fremd.test>", bodyText: "Bitte prüfen.",
    attachments: [] };
  renderWithProviders(<MailCompose account={ALIAS_ACCOUNT} original={original} mode="reply" onClose={vi.fn()} />,
    { fetchImpl: fake.fetch });
  expect(screen.getByLabelText("Empfänger")).toHaveValue("absender@fremd.test");
  expect(screen.getByLabelText("Betreff")).toHaveValue("Re: Wartung");
  fireEvent.change(screen.getByLabelText("Text"), { target: { value: "Erledigt." } });
  await user.click(screen.getByRole("button", { name: "Versand prüfen" }));
  await user.click(screen.getByRole("button", { name: "Genau diese E-Mail senden" }));
  await waitFor(() => expect(fake.to("POST", "/api/v1/integrations/mail/accounts/work/send")).toHaveLength(1));
  expect(fake.to("POST", "/api/v1/integrations/mail/accounts/work/send")[0]!.body).toMatchObject({
    inReplyTo: "<orig@fremd.test>", references: "<root@fremd.test> <orig@fremd.test>", to: ["absender@fremd.test"] });
});

it("keeps the sent copy pending visible and never resends when only the archive failed", async () => {
  const user = userEvent.setup();
  const fake = routedFetch({ [SEND_PATH]: stagedRoute(
    "E-Mail an erik@example.test senden? Betreff: „Projektstatus“", "corr_0000000000000000000000ml3",
    () => ({ state: "sent", archivePending: true, replayed: false, receiptId: RECEIPT, memoryCapture: "written" })) });
  renderWithProviders(<><MailCompose account={ACCOUNT} mode="new" onClose={vi.fn()} /><StagedWriteConfirmHost /></>,
    { fetchImpl: fake.fetch });
  await fillAndSend(user);
  const confirm = await screen.findByRole("alertdialog");
  await user.click(within(confirm).getByRole("button", { name: "Bestätigen" }));
  expect(await screen.findByText(/Kopie in Gesendet ist noch ausstehend; nicht erneut senden/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Nur Gesendet-Kopie ergänzen" })).toBeInTheDocument();
  expect(fake.to("POST", "/api/v1/integrations/mail/accounts/work/send")).toHaveLength(2);
});

it("reports a timed-out confirmed send as unknown and never retries it", async () => {
  const user = userEvent.setup();
  const previewId = "corr_0000000000000000000000ml9";
  const fake = routedFetch({ [SEND_PATH]: (_url: URL, request: Request) => {
    if (request.headers.get("x-action-preview-id") === previewId) throw new TypeError("Failed to fetch");
    return previewRequired("E-Mail an erik@example.test senden? Betreff: „Projektstatus“", previewId);
  } });
  renderWithProviders(<><MailCompose account={ACCOUNT} mode="new" onClose={vi.fn()} /><StagedWriteConfirmHost /></>,
    { fetchImpl: fake.fetch });
  await fillAndSend(user);
  const confirm = await screen.findByRole("alertdialog");
  await user.click(within(confirm).getByRole("button", { name: "Bestätigen" }));
  expect(await screen.findByText("Antwort unbekannt. Bitte beim Anbieter prüfen, bevor du erneut sendest.")).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(fake.to("POST", "/api/v1/integrations/mail/accounts/work/send")).toHaveLength(2);
});
