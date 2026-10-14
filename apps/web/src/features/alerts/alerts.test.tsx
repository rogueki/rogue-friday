import type { Notification } from "@jarvis/sdk";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setApiClient } from "@/lib/api/client";
import { renderWithProviders } from "@/test/render";
import { resetRouter } from "../memory/kit/testRouter";
import { errorResponse, FULL, listOf, modules, NOW, resource, routedFetch, single } from "../memory/kit/testSupport";
import { AlertsPage } from "./AlertsPage";

vi.mock("next/navigation", async () => (await import("../memory/kit/testRouter")).navigationMock);

const P1 = "ntf_01JAAAAAAAAAAAAAAAAAAAAAAA";
const P3 = "ntf_01JBBBBBBBBBBBBBBBBBBBBBBB";

const escalation: Notification["escalation"] = [
  { step: 1, channel: "dashboard", state: "sent", scheduledAt: "2026-10-14T09:50:00Z", sentAt: "2026-10-14T09:50:00Z", acknowledgedAt: null },
  { step: 2, channel: "telegram", state: "sent", scheduledAt: "2026-10-14T10:00:00Z", sentAt: "2026-10-14T10:00:05Z", acknowledgedAt: null },
  { step: 3, channel: "whatsapp", state: "pending", scheduledAt: "2026-10-14T10:20:00Z", sentAt: null, acknowledgedAt: null },
  { step: 4, channel: "phone", state: "pending", scheduledAt: "2026-10-14T10:40:00Z", sentAt: null, acknowledgedAt: null },
];

function makeNotification(partial: Partial<Notification> = {}): Notification {
  return {
    ...resource(P1, 2),
    priority: "P1",
    category: "approval",
    title: "Freigabe erforderlich: Zahlung über 4.287,60 EUR",
    body: "Die Zahlung benötigt Re-Authentifizierung.",
    status: "open",
    acknowledged: false,
    snoozedUntil: null,
    resolved: false,
    escalation,
    sourceRef: { type: "approval", id: "appr_01JAAAAAAAAAAAAAAAAAAAAAAA" },
    targetRoute: "/approvals?approval=appr_01JAAAAAAAAAAAAAAAAAAAAAAA",
    ...partial,
  };
}

const info = makeNotification({ id: P3, version: 1, priority: "P3", category: "system", title: "Backup abgeschlossen", body: "Alles gesichert.", escalation: [], targetRoute: null, sourceRef: null });

const channels = {
  contractVersion: "1.0.0",
  items: [
    { ...resource("chan_01JAAAAAAAAAAAAAAAAAAAAAAA"), kind: "telegram", name: "Telegram", status: "online", capabilities: { read: true, draft: true, send: true }, unreadCount: 0, lastSyncAt: NOW },
    { ...resource("chan_01JBBBBBBBBBBBBBBBBBBBBBBB"), kind: "whatsapp", name: "WhatsApp", status: "read_only", capabilities: { read: true, draft: false, send: false }, unreadCount: 0, lastSyncAt: NOW },
    { ...resource("chan_01JCCCCCCCCCCCCCCCCCCCCCCC"), kind: "phone", name: "Telefon", status: "not_configured", capabilities: { read: false, draft: false, send: false }, unreadCount: 0, lastSyncAt: null },
  ],
  pageInfo: { nextCursor: null, hasNextPage: false },
  freshness: { state: "fresh", asOf: NOW },
  sources: [],
};

const settings = { contractVersion: "1.0.0", data: { notifications: { channels: [{ kind: "telegram", enabled: true, minPriority: "P2" }, { kind: "whatsapp", enabled: false, minPriority: "P1" }], quietHours: { enabled: false, from: "22:00", to: "07:00" }, defaultEscalation: [], snoozeDefaultMinutes: 60 } }, freshness: { state: "fresh", asOf: NOW } };

const routes = (items: Notification[] = [makeNotification(), info]) => ({
  "GET /api/v1/notifications": (url: URL) => listOf(url.searchParams.getAll("status").includes("resolved") ? [makeNotification({ id: "ntf_01JDDDDDDDDDDDDDDDDDDDDDDD", status: "resolved", resolved: true, title: "Alter Alarm" })] : items),
  "GET /api/v1/communication/channels": channels,
  "GET /api/v1/settings": settings,
});

beforeEach(() => resetRouter("/alerts"));
afterEach(() => setApiClient(null));

describe("alerts page", () => {
  it("shows P0/P1 prominently with priority words, counts and no animation classes", async () => {
    const fake = routedFetch(routes());
    renderWithProviders(<AlertsPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    const card = (await screen.findByText("Freigabe erforderlich: Zahlung über 4.287,60 EUR")).closest("article") as HTMLElement;
    expect(card).toHaveClass("alr-card--prominent");
    expect(within(card).getByText("P1 · Dringend")).toBeInTheDocument();
    expect(within(card).getByText("Offen")).toBeInTheDocument();
    expect(card.querySelector("[class*='pulse'], [class*='blink']")).toBeNull();
    const strip = screen.getByRole("group", { name: "Nach Priorität filtern" });
    expect(within(strip).getByRole("button", { name: /P1/ })).toHaveTextContent("1");
    expect(within(strip).getByRole("button", { name: /P3/ })).toHaveTextContent("1");
  });

  it("acknowledges with the seen version (If-Match) and an Idempotency-Key", async () => {
    const user = userEvent.setup();
    const fake = routedFetch({ ...routes(), [`POST /api/v1/notifications/${P1}/acknowledge`]: () => single(makeNotification({ status: "acknowledged", acknowledged: true, version: 3 })) });
    renderWithProviders(<AlertsPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    const card = (await screen.findByText("Freigabe erforderlich: Zahlung über 4.287,60 EUR")).closest("article") as HTMLElement;
    await user.click(within(card).getByRole("button", { name: "Bestätigen" }));
    await waitFor(() => expect(fake.to("POST", `/api/v1/notifications/${P1}/acknowledge`)).toHaveLength(1));
    const call = fake.to("POST", `/api/v1/notifications/${P1}/acknowledge`)[0];
    expect(call?.headers.get("If-Match")).toBe("2");
    expect(call?.headers.get("Idempotency-Key")).toBeTruthy();
  });

  it("snoozes for the chosen duration", async () => {
    const user = userEvent.setup();
    const fake = routedFetch({ ...routes(), [`POST /api/v1/notifications/${P3}/snooze`]: () => single({ ...info, status: "snoozed", snoozedUntil: NOW }) });
    renderWithProviders(<AlertsPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    const card = (await screen.findByText("Backup abgeschlossen")).closest("article") as HTMLElement;
    await user.click(within(card).getByRole("button", { name: "Zurückstellen" }));
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("Dauer"), "240");
    await user.click(within(dialog).getByRole("button", { name: "Zurückstellen" }));
    await waitFor(() => expect(fake.to("POST", `/api/v1/notifications/${P3}/snooze`)).toHaveLength(1));
    expect(fake.to("POST", `/api/v1/notifications/${P3}/snooze`)[0]?.body).toEqual({ durationMinutes: 240 });
  });

  it("validates a custom snooze duration", async () => {
    const user = userEvent.setup();
    const fake = routedFetch(routes());
    renderWithProviders(<AlertsPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    const card = (await screen.findByText("Backup abgeschlossen")).closest("article") as HTMLElement;
    await user.click(within(card).getByRole("button", { name: "Zurückstellen" }));
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("Dauer"), "custom");
    const minutes = within(dialog).getByLabelText("Minuten");
    await user.clear(minutes);
    await user.type(minutes, "0");
    await user.click(within(dialog).getByRole("button", { name: "Zurückstellen" }));
    expect(within(dialog).getByText(/ganze Zahl zwischen 1 und/)).toBeInTheDocument();
    expect(fake.to("POST", `/api/v1/notifications/${P3}/snooze`)).toHaveLength(0);
  });

  it("asks for confirmation before resolving an urgent alert but not a normal one", async () => {
    const user = userEvent.setup();
    const fake = routedFetch({
      ...routes(),
      [`POST /api/v1/notifications/${P1}/resolve`]: () => single(makeNotification({ status: "resolved", resolved: true })),
      [`POST /api/v1/notifications/${P3}/resolve`]: () => single({ ...info, status: "resolved", resolved: true }),
    });
    renderWithProviders(<AlertsPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    const urgent = (await screen.findByText("Freigabe erforderlich: Zahlung über 4.287,60 EUR")).closest("article") as HTMLElement;
    await user.click(within(urgent).getByRole("button", { name: "Lösen" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(fake.to("POST", `/api/v1/notifications/${P1}/resolve`)).toHaveLength(0);
    await user.click(within(confirm).getByRole("button", { name: "Lösen" }));
    await waitFor(() => expect(fake.to("POST", `/api/v1/notifications/${P1}/resolve`)).toHaveLength(1));

    const normal = (await screen.findByText("Backup abgeschlossen")).closest("article") as HTMLElement;
    await user.click(within(normal).getByRole("button", { name: "Lösen" }));
    await waitFor(() => expect(fake.to("POST", `/api/v1/notifications/${P3}/resolve`)).toHaveLength(1));
  });

  it("opens the source route of an alert", async () => {
    const user = userEvent.setup();
    const fake = routedFetch(routes());
    renderWithProviders(<AlertsPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    const card = (await screen.findByText("Freigabe erforderlich: Zahlung über 4.287,60 EUR")).closest("article") as HTMLElement;
    await user.click(within(card).getByRole("button", { name: "Quelle öffnen" }));
    const { push } = await import("../memory/kit/testRouter");
    expect(push).toHaveBeenCalledWith("/approvals?approval=appr_01JAAAAAAAAAAAAAAAAAAAAAAA");
  });

  it("shows the escalation chain Dashboard → Telegram → WhatsApp → Telefon with timestamps", async () => {
    const user = userEvent.setup();
    const fake = routedFetch(routes());
    renderWithProviders(<AlertsPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    const card = (await screen.findByText("Freigabe erforderlich: Zahlung über 4.287,60 EUR")).closest("article") as HTMLElement;
    await user.click(within(card).getByRole("button", { name: /Details zu/ }));
    const drawer = await screen.findByRole("dialog");
    const chain = within(drawer).getByRole("list", { name: "Eskalation" });
    const steps = within(chain).getAllByRole("listitem").filter((item) => item.className.includes("alr-chain__step"));
    expect(steps.map((step) => /Dashboard|Telegram|WhatsApp|Telefon/.exec(step.textContent ?? "")?.[0])).toEqual(["Dashboard", "Telegram", "WhatsApp", "Telefon"]);
    expect(within(steps[1] as HTMLElement).getByText("Gesendet", { selector: ".jv-chip__label" })).toBeInTheDocument();
    expect(within(steps[2] as HTMLElement).getByText("Geplant", { selector: ".jv-chip__label" })).toBeInTheDocument();
    expect(steps[1]?.textContent).toMatch(/\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}/);
  });

  it("shows channel status including read-only and not configured", async () => {
    const fake = routedFetch(routes());
    renderWithProviders(<AlertsPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    const list = await screen.findByRole("list", { name: "Kanalstatus" });
    await waitFor(() => expect(within(list).getByText("Nur lesen")).toBeInTheDocument());
    expect(within(list).getByText("Nicht konfiguriert")).toBeInTheDocument();
    expect(within(list).getByRole("button", { name: /Adapter konfigurieren/ })).toBeInTheDocument();
    expect(within(list).getByText("ab P2")).toBeInTheDocument();
  });

  it("read-only capability: states 'Lesen verfügbar' and disables acknowledge, snooze and resolve", async () => {
    const fake = routedFetch(routes());
    renderWithProviders(<AlertsPage />, { fetchImpl: fake.fetch, capabilities: modules({ notifications: { read: true } }) });
    const card = (await screen.findByText("Freigabe erforderlich: Zahlung über 4.287,60 EUR")).closest("article") as HTMLElement;
    expect(screen.getByText("Lesen verfügbar")).toBeInTheDocument();
    for (const name of ["Bestätigen", "Zurückstellen", "Lösen"]) expect(within(card).getByRole("button", { name })).toBeDisabled();
    expect(within(card).getByRole("button", { name: "Quelle öffnen" })).toBeEnabled();
  });

  it("loads resolved alerts only in the history tab", async () => {
    const user = userEvent.setup();
    const fake = routedFetch(routes());
    renderWithProviders(<AlertsPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    await screen.findByText("Backup abgeschlossen");
    expect(fake.calls.some((call) => call.search.includes("status=resolved"))).toBe(false);
    await user.click(screen.getByRole("tab", { name: /Verlauf/ }));
    expect(await screen.findByText("Alter Alarm")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bestätigen" })).toBeNull();
  });

  it("filters by priority", async () => {
    const user = userEvent.setup();
    const fake = routedFetch(routes());
    renderWithProviders(<AlertsPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    await screen.findByText("Backup abgeschlossen");
    await user.click(within(screen.getByRole("group", { name: "Nach Priorität filtern" })).getByRole("button", { name: /P3/ }));
    expect(screen.queryByText("Freigabe erforderlich: Zahlung über 4.287,60 EUR")).toBeNull();
    expect(screen.getByText("Backup abgeschlossen")).toBeInTheDocument();
  });

  it("shows the empty, offline and error states", async () => {
    const empty = routedFetch({ ...routes([]) });
    const view = renderWithProviders(<AlertsPage />, { fetchImpl: empty.fetch, capabilities: modules(FULL) });
    expect(await screen.findByText("Keine aktiven Meldungen")).toBeInTheDocument();
    view.unmount();

    const offline = routedFetch({ ...routes(), "GET /api/v1/notifications": errorResponse("ADAPTER_UNAVAILABLE", "Benachrichtigungsdienst offline", 503) });
    const second = renderWithProviders(<AlertsPage />, { fetchImpl: offline.fetch, capabilities: modules(FULL) });
    expect(await screen.findByText("Benachrichtigungsdienst offline")).toBeInTheDocument();
    second.unmount();

    const broken = routedFetch({ ...routes(), "GET /api/v1/notifications": errorResponse("INTERNAL", "Kaputt", 500) });
    renderWithProviders(<AlertsPage />, { fetchImpl: broken.fetch, capabilities: modules(FULL) });
    expect(await screen.findByText("Kaputt")).toBeInTheDocument();
  });
});
