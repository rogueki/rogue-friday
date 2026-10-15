import type { Channel, Draft, Thread } from "@friday/sdk";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setApiClient } from "@/lib/api/client";
import { renderWithProviders } from "@/test/render";
import { push, resetRouter } from "../memory/kit/testRouter";
import { errorResponse, FRESH, FULL, listOf, modules, NOW, resource, routedFetch, single } from "../memory/kit/testSupport";
import { CommunicationPage } from "./CommunicationPage";

vi.mock("next/navigation", async () => (await import("../memory/kit/testRouter")).navigationMock);

const MAIL = "chan_01JAAAAAAAAAAAAAAAAAAAAAAA";
const WA = "chan_01JBBBBBBBBBBBBBBBBBBBBBBB";
const SMS = "chan_01JCCCCCCCCCCCCCCCCCCCCCCC";
const THREAD = "thr_01JAAAAAAAAAAAAAAAAAAAAAAA";
const DRAFT = "draft_01JAAAAAAAAAAAAAAAAAAAAAAA";
const APPROVAL = "appr_01JAAAAAAAAAAAAAAAAAAAAAAA";

const channel = (id: string, partial: Partial<Channel>): Channel => ({
  ...resource(id),
  kind: "email",
  name: "GMX Postfach",
  status: "online",
  capabilities: { read: true, draft: true, send: true },
  unreadCount: 2,
  lastSyncAt: NOW,
  ...partial,
});

const channels = [
  channel(MAIL, {}),
  channel(WA, { kind: "whatsapp", name: "WhatsApp", status: "read_only", capabilities: { read: true, draft: false, send: false }, unreadCount: 1 }),
  channel(SMS, { kind: "sms", name: "SMS", status: "not_configured", capabilities: { read: false, draft: false, send: false }, unreadCount: 0, lastSyncAt: null }),
];

function makeThread(partial: Partial<Thread> = {}): Thread {
  return {
    ...resource(THREAD, 4),
    channelId: MAIL,
    channelKind: "email",
    subject: "Terminbestätigung 21.10. – Besprechung Anlagenwartung",
    participants: [
      { name: "Katharina Becker", address: "k.becker@beispiel.example" },
      { name: "Erik Brandt", address: "erik.brandt@gmx.example", role: "owner" },
    ],
    priority: "P1",
    summary: "Frau Becker bittet um Bestätigung des Termins am 21.10.",
    needsReply: true,
    deadline: "2026-10-14T16:00:00Z",
    status: "open",
    linkedTaskId: "task_01JAAAAAAAAAAAAAAAAAAAAAAA",
    lastMessageAt: NOW,
    messageCount: 1,
    unreadCount: 1,
    hasDraft: false,
    draftIds: [],
    extractedEvents: [{ title: "Besprechung Anlagenwartung", start: "2026-10-21T08:00:00Z", end: "2026-10-21T09:00:00Z" }],
    extractedTasks: [{ title: "Wartungsprotokoll bereitstellen", dueAt: null }],
    suggestedReply: "Sehr geehrte Frau Becker, der Termin passt. Das Protokoll sende ich vorab.",
    messages: [
      {
        ...resource("msg_01JAAAAAAAAAAAAAAAAAAAAAAA"),
        threadId: THREAD,
        direction: "inbound",
        from: { name: "Katharina Becker", address: "k.becker@beispiel.example" },
        to: [{ name: "Erik Brandt", address: "erik.brandt@gmx.example", role: "owner" }],
        sentAt: NOW,
        bodyText: "Bitte bestätigen Sie den Termin und bringen Sie das Wartungsprotokoll mit.",
        aiSummary: "Bittet um Terminbestätigung.",
        attachments: [{ id: "att_1", name: "Wartungsprotokoll.pdf", mimeType: "application/pdf", sizeBytes: 123_456 }],
        originalRef: "imap:INBOX/4711",
      },
    ],
    ...partial,
  };
}

const draft = (partial: Partial<Draft> = {}): Draft => ({
  ...resource(DRAFT, 1),
  channelId: MAIL,
  threadId: THREAD,
  to: [{ name: "Katharina Becker", address: "k.becker@beispiel.example" }],
  subject: "Re: Terminbestätigung 21.10. – Besprechung Anlagenwartung",
  body: "Sehr geehrte Frau Becker, der Termin passt. Das Protokoll sende ich vorab.",
  status: "draft",
  approvalId: null,
  generatedByAgentId: null,
  ...partial,
});

const routes = (thread = makeThread(), list: Channel[] = channels) => ({
  "GET /api/v1/communication/channels": listOf(list),
  "GET /api/v1/communication/threads": listOf([thread]),
  [`GET /api/v1/communication/threads/${THREAD}`]: single(thread),
});

beforeEach(() => resetRouter("/communication"));
afterEach(() => setApiClient(null));

async function openThread(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.click((await screen.findByText("Terminbestätigung 21.10. – Besprechung Anlagenwartung")).closest("button") as HTMLElement);
  return await screen.findByRole("dialog");
}

describe("communication page: inbox and channels", () => {
  it("shows the inbox fields of the unified inbox", async () => {
    const fake = routedFetch(routes());
    renderWithProviders(<CommunicationPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    const row = (await screen.findByText("Terminbestätigung 21.10. – Besprechung Anlagenwartung")).closest("button") as HTMLElement;
    expect(within(row).getByText("P1")).toBeInTheDocument();
    expect(within(row).getByText("Katharina Becker")).toBeInTheDocument();
    expect(within(row).getByText("Frau Becker bittet um Bestätigung des Termins am 21.10.")).toBeInTheDocument();
    expect(within(row).getByText("Antwort nötig")).toBeInTheDocument();
    expect(within(row).getByText("Offen")).toBeInTheDocument();
    expect(within(row).getByText("Aufgabe verknüpft")).toBeInTheDocument();
    expect(within(row).getByText(/Frist/)).toBeInTheDocument();
  });

  it("shows every channel status of PLAN §33.4 with what the channel may do", async () => {
    const fake = routedFetch(routes());
    renderWithProviders(<CommunicationPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    const rail = await screen.findByRole("list", { name: "Kanäle" });
    await waitFor(() => expect(within(rail).getByText("Online")).toBeInTheDocument());
    expect(within(rail).getByText("Nur lesen")).toBeInTheDocument();
    expect(within(rail).getByText("Nicht konfiguriert")).toBeInTheDocument();
    expect(within(rail).getByText("Lesen verfügbar, Senden nicht verfügbar.")).toBeInTheDocument();
    expect(within(rail).getByRole("button", { name: /Adapter konfigurieren/ })).toBeInTheDocument();
  });

  it("filters by channel through the API", async () => {
    const user = userEvent.setup();
    const fake = routedFetch(routes());
    renderWithProviders(<CommunicationPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    await screen.findByText("Terminbestätigung 21.10. – Besprechung Anlagenwartung");
    await user.click(within(await screen.findByRole("list", { name: "Kanäle" })).getByRole("button", { name: /WhatsApp/ }));
    await waitFor(() => expect(fake.calls.some((call) => call.path === "/api/v1/communication/threads" && call.search.includes(`channelId=${WA}`))).toBe(true));
  });

  it("searches with the typed term", async () => {
    const user = userEvent.setup();
    const fake = routedFetch(routes());
    renderWithProviders(<CommunicationPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    await screen.findByText("Terminbestätigung 21.10. – Besprechung Anlagenwartung");
    await user.type(screen.getByRole("searchbox", { name: "Nachrichten durchsuchen" }), "Wartung");
    await waitFor(() => expect(fake.calls.some((call) => call.path === "/api/v1/communication/threads" && call.search.includes("q=Wartung"))).toBe(true));
  });

  it("send capability missing: states 'Lesen verfügbar / Senden nicht verfügbar'", async () => {
    const fake = routedFetch(routes());
    renderWithProviders(<CommunicationPage />, { fetchImpl: fake.fetch, capabilities: modules({ communication: { read: true, draft: true } }) });
    await screen.findByText("Terminbestätigung 21.10. – Besprechung Anlagenwartung");
    expect(screen.getByText("Lesen verfügbar")).toBeInTheDocument();
    expect(screen.getByText("Senden nicht verfügbar")).toBeInTheDocument();
  });

  it("shows 'Offline' (not 'Nicht verbunden') when the mail adapter is unreachable", async () => {
    const fake = routedFetch({
      "GET /api/v1/communication/channels": errorResponse("ADAPTER_UNAVAILABLE", "IMAP-Server nicht erreichbar", 503),
      "GET /api/v1/communication/threads": errorResponse("ADAPTER_UNAVAILABLE", "IMAP-Server nicht erreichbar", 503),
    });
    renderWithProviders(<CommunicationPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    await waitFor(() => expect(screen.getAllByText("Offline").length).toBeGreaterThan(0));
    expect(screen.getAllByText(/IMAP-Server nicht erreichbar/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /Erneut versuchen/ }).length).toBeGreaterThan(0);
    expect(screen.queryByText("Nicht verbunden")).toBeNull();
  });

  it("shows empty and error states", async () => {
    const empty = routedFetch({ ...routes(), "GET /api/v1/communication/threads": listOf([]) });
    const view = renderWithProviders(<CommunicationPage />, { fetchImpl: empty.fetch, capabilities: modules(FULL) });
    expect(await screen.findByText("Keine Nachrichten")).toBeInTheDocument();
    view.unmount();
    const broken = routedFetch({ ...routes(), "GET /api/v1/communication/threads": errorResponse("INTERNAL", "Kaputt", 500) });
    renderWithProviders(<CommunicationPage />, { fetchImpl: broken.fetch, capabilities: modules(FULL) });
    expect(await screen.findByText("Kaputt")).toBeInTheDocument();
  });

  it("marks stale inbox data", async () => {
    const fake = routedFetch({ ...routes(), "GET /api/v1/communication/threads": listOf([makeThread()], { freshness: { state: "offline-cache", asOf: NOW } }) });
    renderWithProviders(<CommunicationPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    await screen.findByText("Terminbestätigung 21.10. – Besprechung Anlagenwartung");
    expect(screen.getAllByText("Offline-Cache").length).toBeGreaterThan(0);
  });
});

describe("communication page: thread detail and drafts", () => {
  it("shows thread, attachments, AI summary, extracted dates and tasks, suggested reply and source", async () => {
    const user = userEvent.setup();
    const fake = routedFetch(routes());
    renderWithProviders(<CommunicationPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    const dialog = await openThread(user);
    expect(within(dialog).getByText("Bitte bestätigen Sie den Termin und bringen Sie das Wartungsprotokoll mit.")).toBeInTheDocument();
    expect(within(dialog).getByText(/Wartungsprotokoll\.pdf · 121\s?KB/)).toBeInTheDocument();
    expect(within(dialog).getByText("Frau Becker bittet um Bestätigung des Termins am 21.10.", { selector: "p" })).toBeInTheDocument();
    expect(within(dialog).getByText("Besprechung Anlagenwartung")).toBeInTheDocument();
    expect(within(dialog).getByText("Wartungsprotokoll bereitstellen")).toBeInTheDocument();
    expect(within(dialog).getByText(/Sehr geehrte Frau Becker, der Termin passt/)).toBeInTheDocument();
    expect(within(dialog).getByText(/imap:INBOX\/4711/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Quelle:/)).toBeInTheDocument();
  });

  it("creates a draft from the suggested reply and never sends: request-send goes through an approval", async () => {
    const user = userEvent.setup();
    const created = draft();
    const fake = routedFetch({
      ...routes(),
      "POST /api/v1/communication/drafts": () => single(created),
      [`POST /api/v1/communication/drafts/${DRAFT}/request-send`]: () => single({ id: APPROVAL, status: "pending", type: "send_email" }),
    });
    renderWithProviders(<CommunicationPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    const dialog = await openThread(user);
    await user.click(within(dialog).getByRole("button", { name: "Als Entwurf übernehmen" }));
    await waitFor(() => expect(fake.to("POST", "/api/v1/communication/drafts")).toHaveLength(1));
    expect(fake.to("POST", "/api/v1/communication/drafts")[0]?.body).toMatchObject({
      channelId: MAIL,
      threadId: THREAD,
      subject: "Re: Terminbestätigung 21.10. – Besprechung Anlagenwartung",
      to: [{ address: "k.becker@beispiel.example" }],
      replyToMessageId: "msg_01JAAAAAAAAAAAAAAAAAAAAAAA",
    });
    // The draft is created automatically but nothing is sent yet.
    expect(fake.to("POST", `/api/v1/communication/drafts/${DRAFT}/request-send`)).toHaveLength(0);

    const requestButton = await within(dialog).findByRole("button", { name: "Versand anfragen" });
    await user.click(requestButton);
    const confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).getByText(/Es wird noch nichts gesendet/)).toBeInTheDocument();
    expect(within(confirm).getByText(/Ohne deine Freigabe wird nicht gesendet/)).toBeInTheDocument();
    expect(fake.to("POST", `/api/v1/communication/drafts/${DRAFT}/request-send`)).toHaveLength(0);
    await user.click(within(confirm).getByRole("button", { name: "Freigabe anfragen" }));
    await waitFor(() => expect(fake.to("POST", `/api/v1/communication/drafts/${DRAFT}/request-send`)).toHaveLength(1));
    const call = fake.to("POST", `/api/v1/communication/drafts/${DRAFT}/request-send`)[0];
    expect(call?.headers.get("If-Match")).toBe("1");
    expect(call?.headers.get("Idempotency-Key")).toBeTruthy();
    // After the request the draft waits for approval and offers the link to it; the send button is gone.
    expect(await within(dialog).findByText("Wartet auf Freigabe")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Freigabe öffnen" }));
    expect(push).toHaveBeenCalledWith(`/approvals?approval=${APPROVAL}`);
    expect(within(dialog).queryByRole("button", { name: "Versand anfragen" })).toBeNull();
  });

  it("saves edits with If-Match before asking for approval", async () => {
    const user = userEvent.setup();
    const fake = routedFetch({
      ...routes(),
      "POST /api/v1/communication/drafts": () => single(draft()),
      [`PATCH /api/v1/communication/drafts/${DRAFT}`]: () => single(draft({ version: 2, body: "Neuer Text" })),
    });
    renderWithProviders(<CommunicationPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    const dialog = await openThread(user);
    await user.click(within(dialog).getByRole("button", { name: "Als Entwurf übernehmen" }));
    const body = await within(dialog).findByLabelText("Nachricht");
    await user.clear(body);
    await user.type(body, "Neuer Text");
    await user.click(within(dialog).getByRole("button", { name: "Entwurf speichern" }));
    await waitFor(() => expect(fake.to("PATCH", `/api/v1/communication/drafts/${DRAFT}`)).toHaveLength(1));
    const patch = fake.to("PATCH", `/api/v1/communication/drafts/${DRAFT}`)[0];
    expect(patch?.headers.get("If-Match")).toBe("1");
    expect(patch?.body).toMatchObject({ body: "Neuer Text" });
  });

  it("disables drafting and sending on a read-only channel and says why", async () => {
    const user = userEvent.setup();
    const thread = makeThread({ channelId: WA, channelKind: "whatsapp" });
    const fake = routedFetch({ ...routes(thread), "GET /api/v1/communication/threads": listOf([thread]) });
    renderWithProviders(<CommunicationPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    const dialog = await openThread(user);
    const take = await within(dialog).findByRole("button", { name: "Als Entwurf übernehmen" });
    expect(take).toBeDisabled();
    expect(within(dialog).getByText("Entwürfe sind für diesen Kanal nicht verfügbar.")).toBeInTheDocument();
  });

  it("loads the drafts of the thread from GET /communication/drafts?threadId= and makes them editable", async () => {
    const user = userEvent.setup();
    const thread = makeThread({ hasDraft: true, draftIds: [DRAFT] });
    const fake = routedFetch({
      ...routes(thread),
      "GET /api/v1/communication/drafts": () => listOf([draft({ version: 3 })]),
      [`PATCH /api/v1/communication/drafts/${DRAFT}`]: () => single(draft({ version: 4, body: "Geändert" })),
    });
    renderWithProviders(<CommunicationPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    const dialog = await openThread(user);
    const body = await within(dialog).findByLabelText("Nachricht");
    expect(body).toHaveValue("Sehr geehrte Frau Becker, der Termin passt. Das Protokoll sende ich vorab.");
    const listCall = fake.to("GET", "/api/v1/communication/drafts")[0];
    expect(new URLSearchParams(listCall?.search).get("threadId")).toBe(THREAD);
    expect(within(dialog).queryByText("Entwurf im Quellsystem")).toBeNull();
    await user.clear(body);
    await user.type(body, "Geändert");
    await user.click(within(dialog).getByRole("button", { name: "Entwurf speichern" }));
    await waitFor(() => expect(fake.to("PATCH", `/api/v1/communication/drafts/${DRAFT}`)).toHaveLength(1));
    expect(fake.to("PATCH", `/api/v1/communication/drafts/${DRAFT}`)[0]?.headers.get("If-Match")).toBe("3");
  });

  it("shows a draft the thread lists even if the draft list does not know it (older adapters)", async () => {
    const user = userEvent.setup();
    const thread = makeThread({ hasDraft: true, draftIds: [DRAFT] });
    const fake = routedFetch({ ...routes(thread), "GET /api/v1/communication/drafts": () => listOf([]) });
    renderWithProviders(<CommunicationPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    const dialog = await openThread(user);
    expect(await within(dialog).findByText("Entwurf im Quellsystem")).toBeInTheDocument();
  });

  it("does not request the draft list without the capability and falls back to the placeholder", async () => {
    const user = userEvent.setup();
    const thread = makeThread({ hasDraft: true, draftIds: [DRAFT] });
    const fake = routedFetch({ ...routes(thread), "GET /api/v1/communication/drafts": () => listOf([draft()]) });
    renderWithProviders(<CommunicationPage />, { fetchImpl: fake.fetch, capabilities: modules({ communication: { read: true, draft: false, send: false }, mail: { read: true } }) });
    const dialog = await openThread(user);
    expect(await within(dialog).findByText("Entwurf im Quellsystem")).toBeInTheDocument();
    expect(fake.to("GET", "/api/v1/communication/drafts")).toHaveLength(0);
  });

  it("explains a failed draft list with a retry and keeps the placeholder", async () => {
    const user = userEvent.setup();
    const thread = makeThread({ hasDraft: true, draftIds: [DRAFT] });
    let fail = true;
    const fake = routedFetch({
      ...routes(thread),
      "GET /api/v1/communication/drafts": () => (fail ? errorResponse("INTERNAL", "Entwurfsspeicher nicht erreichbar", 500) : listOf([draft()])),
    });
    renderWithProviders(<CommunicationPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    const dialog = await openThread(user);
    expect(await within(dialog).findByText(/Die Entwürfe dieses Threads konnten nicht geladen werden/)).toBeInTheDocument();
    expect(within(dialog).getByText("Entwurf im Quellsystem")).toBeInTheDocument();
    fail = false;
    await user.click(within(dialog).getByRole("button", { name: "Erneut versuchen" }));
    expect(await within(dialog).findByLabelText("Nachricht")).toBeInTheDocument();
  });

  it("sending unavailable: the request button is disabled with the reason", async () => {
    const user = userEvent.setup();
    const fake = routedFetch({ ...routes(), "POST /api/v1/communication/drafts": () => single(draft()) });
    renderWithProviders(<CommunicationPage />, { fetchImpl: fake.fetch, capabilities: modules({ communication: { read: true, draft: true, send: false }, mail: { read: true, draft: true, send: true } }) });
    const dialog = await openThread(user);
    await user.click(within(dialog).getByRole("button", { name: "Als Entwurf übernehmen" }));
    const request = await within(dialog).findByRole("button", { name: "Versand anfragen" });
    expect(request).toBeDisabled();
    expect(within(dialog).getAllByText(/Senden nicht verfügbar: Dieser Kanal oder Adapter erlaubt kein Senden/).length).toBeGreaterThan(0);
  });
});

describe("communication page: compose", () => {
  it("validates the recipient and creates an unthreaded draft", async () => {
    const user = userEvent.setup();
    const fake = routedFetch({ ...routes(), "POST /api/v1/communication/drafts": () => single(draft({ threadId: null, subject: "Hallo", body: "Text" })) });
    renderWithProviders(<CommunicationPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    await screen.findByText("Terminbestätigung 21.10. – Besprechung Anlagenwartung");
    await user.click(screen.getByRole("button", { name: "Neue Nachricht" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Adresse/), "kein-mail");
    await user.type(within(dialog).getByLabelText(/Nachricht/), "Text");
    await user.click(within(dialog).getByRole("button", { name: "Entwurf anlegen" }));
    expect(within(dialog).getByText("Bitte eine gültige E-Mail-Adresse angeben.")).toBeInTheDocument();
    expect(fake.to("POST", "/api/v1/communication/drafts")).toHaveLength(0);
    await user.clear(within(dialog).getByLabelText(/Adresse/));
    await user.type(within(dialog).getByLabelText(/Adresse/), "a.b@beispiel.example");
    await user.click(within(dialog).getByRole("button", { name: "Entwurf anlegen" }));
    await waitFor(() => expect(fake.to("POST", "/api/v1/communication/drafts")).toHaveLength(1));
    expect(await within(dialog).findByRole("button", { name: "Versand anfragen" })).toBeInTheDocument();
  });
});

void FRESH;
