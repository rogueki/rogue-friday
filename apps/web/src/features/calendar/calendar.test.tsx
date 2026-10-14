import type { CalendarBriefing, CalendarConflict, CalendarEvent } from "@jarvis/sdk";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setApiClient } from "@/lib/api/client";
import { renderWithProviders } from "@/test/render";
import { push, resetRouter } from "../memory/kit/testRouter";
import { errorResponse, FULL, listOf, modules, NOW, resource, routedFetch, single } from "../memory/kit/testSupport";
import { CalendarPage } from "./CalendarPage";
import { parseAttendees } from "./ProposalDialog";

vi.mock("next/navigation", async () => (await import("../memory/kit/testRouter")).navigationMock);
// The user setting decides the display zone (PLAN §34.2); the tests pin it so they do not depend on the machine.
vi.mock("@/lib/settings", () => ({ useAppSettings: () => ({ settings: undefined, isLoading: false, locale: "de", timeZone: "Europe/Berlin", hour12: false }) }));

const E1 = "cal_01JAAAAAAAAAAAAAAAAAAAAAAA";
const E2 = "cal_01JBBBBBBBBBBBBBBBBBBBBBBB";

// Fixed "now" so views are deterministic: Wednesday 14 Oct 2026.
function event(id: string, title: string, start: string, end: string, partial: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    ...resource(id),
    title,
    start,
    end,
    allDay: false,
    timeZone: "Europe/Berlin",
    location: "Besprechungsraum 2",
    attendees: [{ name: "Jan-Hendrik Voss", email: "j.voss@beispiel.example", response: "accepted" }],
    status: "confirmed",
    reminderMinutes: [15],
    linkedTaskIds: [],
    linkedThreadIds: [],
    conflictIds: [],
    briefingId: null,
    ...partial,
  };
}

const standup = event(E1, "Daily Standup", "2026-10-14T07:00:00Z", "2026-10-14T07:15:00Z", { conflictIds: ["cflt_01JAAAAAAAAAAAAAAAAAAAAAAA"], briefingId: "brf_01JAAAAAAAAAAAAAAAAAAAAAAA", linkedThreadIds: ["thr_01JAAAAAAAAAAAAAAAAAAAAAAA"] });
const review = event(E2, "Quartalsreview", "2026-10-15T13:00:00Z", "2026-10-15T14:00:00Z");

const conflict: CalendarConflict = {
  ...resource("cflt_01JAAAAAAAAAAAAAAAAAAAAAAA"),
  eventIds: [E1, E2],
  kind: "overlap",
  severity: "warning",
  description: "Standup und Review überschneiden sich.",
  detectedAt: NOW,
  suggestedResolution: "Review auf Freitag verschieben.",
};
const briefing: CalendarBriefing = {
  ...resource("brf_01JAAAAAAAAAAAAAAAAAAAAAAA"),
  eventId: E1,
  summary: "Kurzer Abgleich zum Projektstand.",
  attendeeContext: [{ name: "Jan-Hendrik Voss", notes: "Wartet auf die Rechnung." }],
  linkedThreadIds: [],
  talkingPoints: ["Rechnung klären", "Termin Review"],
  generatedAt: NOW,
};

const routes = (events: CalendarEvent[] = [standup, review]) => ({
  "GET /api/v1/calendar/events": (url: URL) => {
    const from = Date.parse(url.searchParams.get("from") ?? "");
    const to = Date.parse(url.searchParams.get("to") ?? "");
    return listOf(events.filter((item) => Date.parse(item.end) > from && Date.parse(item.start) < to));
  },
  [`GET /api/v1/calendar/events/${E1}`]: single(standup),
  "GET /api/v1/calendar/conflicts": listOf([conflict]),
  "GET /api/v1/calendar/briefings": listOf([briefing]),
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-14T05:30:00Z") });
  resetRouter("/calendar");
});
afterEach(() => {
  vi.useRealTimers();
  setApiClient(null);
});

const setup = () => userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });

describe("calendar page: views", () => {
  it("defaults to the week view and switches between Tag, Woche, Monat and Agenda", async () => {
    const user = setup();
    const fake = routedFetch(routes());
    renderWithProviders(<CalendarPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    const views = screen.getByRole("group", { name: "Kalenderansicht" });
    expect(within(views).getByRole("button", { name: "Woche" })).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByRole("group", { name: /Woche: KW 42/ })).toBeInTheDocument();
    expect(await screen.findAllByText("Daily Standup")).not.toHaveLength(0);

    await user.click(within(views).getByRole("button", { name: "Tag" }));
    expect(await screen.findByRole("group", { name: /Tag: Mittwoch, 14\. Oktober 2026/ })).toBeInTheDocument();
    expect(within(views).getByRole("button", { name: "Tag" })).toHaveAttribute("aria-pressed", "true");

    await user.click(within(views).getByRole("button", { name: "Monat" }));
    expect(await screen.findByRole("group", { name: /Monat: Oktober 2026/ })).toBeInTheDocument();
    expect(screen.getByText("Quartalsreview")).toBeInTheDocument();

    await user.click(within(views).getByRole("button", { name: "Agenda" }));
    const agenda = await screen.findByRole("group", { name: /Agenda: Ab 14\. Oktober 2026/ });
    expect(within(agenda).getByText(/Mittwoch, 14\. Oktober/)).toBeInTheDocument();
    expect(within(agenda).getByText(/Donnerstag, 15\. Oktober/)).toBeInTheDocument();
  });

  it("requests the visible range for each view", async () => {
    const user = setup();
    const fake = routedFetch(routes());
    renderWithProviders(<CalendarPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    await screen.findAllByText("Daily Standup");
    const week = fake.calls.filter((call) => call.path === "/api/v1/calendar/events").at(-1);
    const weekParams = new URLSearchParams(week?.search);
    expect(weekParams.get("from")).toBe("2026-10-11T22:00:00.000Z"); // Monday 12.10. 00:00 Berlin
    expect(weekParams.get("to")).toBe("2026-10-18T22:00:00.000Z");
    await user.click(screen.getByRole("button", { name: "Tag" }));
    await waitFor(() => {
      const day = new URLSearchParams(fake.calls.filter((call) => call.path === "/api/v1/calendar/events").at(-1)?.search);
      expect(day.get("from")).toBe("2026-10-13T22:00:00.000Z");
      expect(day.get("to")).toBe("2026-10-14T22:00:00.000Z");
    });
  });

  it("navigates to the next week and back to today", async () => {
    const user = setup();
    const fake = routedFetch(routes());
    renderWithProviders(<CalendarPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    await screen.findAllByText("Daily Standup");
    await user.click(screen.getByRole("button", { name: "Weiter" }));
    expect(await screen.findByRole("group", { name: /Woche: KW 43/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Heute" }));
    expect(await screen.findByRole("group", { name: /Woche: KW 42/ })).toBeInTheDocument();
  });

  it("states the time zone", async () => {
    const fake = routedFetch(routes());
    renderWithProviders(<CalendarPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    await screen.findAllByText("Daily Standup");
    expect(screen.getByText(/Zeitzone .+ \(UTC[+-]\d{2}:\d{2}\)/)).toBeInTheDocument();
  });
});

describe("calendar page: conflicts, free time, briefings and detail", () => {
  it("marks conflicting events and lists the conflict with its suggestion", async () => {
    const fake = routedFetch(routes());
    renderWithProviders(<CalendarPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    await screen.findAllByText("Daily Standup");
    expect(await screen.findByText("Standup und Review überschneiden sich.")).toBeInTheDocument();
    expect(screen.getByText(/Vorschlag: Review auf Freitag verschieben\./)).toBeInTheDocument();
    expect(screen.getAllByLabelText("Konflikt").length).toBeGreaterThan(0);
  });

  it("lists free working-hour slots of the focused day", async () => {
    const fake = routedFetch(routes());
    renderWithProviders(<CalendarPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    await screen.findAllByText("Daily Standup");
    // Standup 09:00-09:15 Berlin: free 08:00-09:00 (60 min) and 09:15-18:00.
    expect(await screen.findByText("08:00–09:00")).toBeInTheDocument();
    expect(screen.getByText("09:15–18:00")).toBeInTheDocument();
  });

  it("shows the briefing in the side panel and the event drawer with attendee context and links", async () => {
    const user = setup();
    const fake = routedFetch(routes());
    renderWithProviders(<CalendarPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    await screen.findAllByText("Daily Standup");
    const panelTitle = await screen.findByText("Kurzer Abgleich zum Projektstand.", { selector: ".mk-row__text" });
    await user.click(panelTitle.closest("button") as HTMLElement);
    const drawer = await screen.findByRole("dialog");
    expect(await within(drawer).findByText("Rechnung klären")).toBeInTheDocument();
    expect(within(drawer).getByText("Wartet auf die Rechnung.")).toBeInTheDocument();
    expect(within(drawer).getByText("Zugesagt")).toBeInTheDocument();
    expect(within(drawer).getByText("15 Min. vorher")).toBeInTheDocument();
    await user.click(within(drawer).getByRole("button", { name: "Mail-Thread öffnen" }));
    expect(push).toHaveBeenCalledWith("/communication?thread=thr_01JAAAAAAAAAAAAAAAAAAAAAAA");
  });

  it("shows empty, error, offline and stale states", async () => {
    const empty = routedFetch({ ...routes([]) });
    const first = renderWithProviders(<CalendarPage />, { fetchImpl: empty.fetch, capabilities: modules(FULL) });
    expect(await screen.findByText("Keine Termine in diesem Zeitraum")).toBeInTheDocument();
    first.unmount();

    const broken = routedFetch({ ...routes(), "GET /api/v1/calendar/events": errorResponse("INTERNAL", "Kalender kaputt", 500) });
    const second = renderWithProviders(<CalendarPage />, { fetchImpl: broken.fetch, capabilities: modules(FULL) });
    expect(await screen.findByText("Kalender kaputt")).toBeInTheDocument();
    second.unmount();

    const offline = routedFetch({ ...routes(), "GET /api/v1/calendar/events": errorResponse("ADAPTER_UNAVAILABLE", "Kalender-Server nicht erreichbar", 503) });
    const third = renderWithProviders(<CalendarPage />, { fetchImpl: offline.fetch, capabilities: modules(FULL) });
    expect(await screen.findByText("Kalender-Server nicht erreichbar")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Adapter konfigurieren/ }).length).toBeGreaterThan(0);
    third.unmount();

    const stale = routedFetch({ ...routes(), "GET /api/v1/calendar/events": listOf([standup], { freshness: { state: "stale", asOf: NOW } }) });
    renderWithProviders(<CalendarPage />, { fetchImpl: stale.fetch, capabilities: modules(FULL) });
    await screen.findAllByText("Daily Standup");
    expect(screen.getAllByText(/möglicherweise nicht mehr aktuell/).length).toBeGreaterThan(0);
  });
});

describe("calendar page: write actions are proposals", () => {
  it("disables the proposal button and states read-only access without propose capability", async () => {
    const fake = routedFetch(routes());
    renderWithProviders(<CalendarPage />, { fetchImpl: fake.fetch, capabilities: modules({ calendar: { read: true } }) });
    await screen.findAllByText("Daily Standup");
    expect(screen.getByText("Lesen verfügbar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Terminvorschlag" })).toBeDisabled();
  });

  it("validates the proposal form and posts it with an Idempotency-Key", async () => {
    const user = setup();
    const fake = routedFetch({
      ...routes(),
      "POST /api/v1/calendar/proposals": () => single({ ...resource("prop_01JAAAAAAAAAAAAAAAAAAAAAAA"), type: "create", eventId: null, title: "Fokuszeit", proposedStart: null, proposedEnd: null, attendees: [], reason: "x", status: "pending_approval", approvalId: "appr_01JAAAAAAAAAAAAAAAAAAAAAAA" }),
    });
    renderWithProviders(<CalendarPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    await screen.findAllByText("Daily Standup");
    await user.click(screen.getByRole("button", { name: "Terminvorschlag" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Vorschlag erstellen" }));
    expect(within(dialog).getByText("Bitte einen Titel angeben.")).toBeInTheDocument();
    expect(within(dialog).getByText("Bitte eine Begründung angeben.")).toBeInTheDocument();
    expect(fake.to("POST", "/api/v1/calendar/proposals")).toHaveLength(0);

    await user.type(within(dialog).getByLabelText(/Titel/), "Fokuszeit");
    await user.type(within(dialog).getByLabelText(/Beginn/), "2026-10-16T10:00");
    await user.type(within(dialog).getByLabelText(/Ende/), "2026-10-16T09:00");
    await user.type(within(dialog).getByLabelText(/Begründung/), "Kein Fokusblock am Donnerstag");
    await user.click(within(dialog).getByRole("button", { name: "Vorschlag erstellen" }));
    expect(within(dialog).getByText("Das Ende muss nach dem Beginn liegen.")).toBeInTheDocument();

    await user.clear(within(dialog).getByLabelText(/Ende/));
    await user.type(within(dialog).getByLabelText(/Ende/), "2026-10-16T11:30");
    await user.click(within(dialog).getByRole("button", { name: "Vorschlag erstellen" }));
    await waitFor(() => expect(fake.to("POST", "/api/v1/calendar/proposals")).toHaveLength(1));
    const call = fake.to("POST", "/api/v1/calendar/proposals")[0];
    expect(call?.body).toMatchObject({ type: "create", title: "Fokuszeit", reason: "Kein Fokusblock am Donnerstag", start: "2026-10-16T08:00:00.000Z", end: "2026-10-16T09:30:00.000Z" });
    expect(call?.headers.get("Idempotency-Key")).toBeTruthy();
    expect(await within(dialog).findByText(/wartet auf deine Freigabe/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Freigabe öffnen" }));
    expect(push).toHaveBeenCalledWith("/approvals?approval=appr_01JAAAAAAAAAAAAAAAAAAAAAAA");
  });

  it("offers only the actions the adapter allows", async () => {
    const user = setup();
    const fake = routedFetch(routes());
    renderWithProviders(<CalendarPage />, { fetchImpl: fake.fetch, capabilities: modules({ calendar: { read: true, propose: true, create: true, reschedule: false, cancel: false, invite: false, respond: false } }) });
    await screen.findAllByText("Daily Standup");
    await user.click(screen.getByRole("button", { name: "Terminvorschlag" }));
    const dialog = await screen.findByRole("dialog");
    const type = within(dialog).getByLabelText("Art") as HTMLSelectElement;
    expect(within(type).getByRole("option", { name: "Termin anlegen" })).toBeEnabled();
    expect(within(type).getByRole("option", { name: /Termin verschieben \(nicht verfügbar\)/ })).toBeDisabled();
  });

  it("proposes a reschedule from a conflict with the event preselected", async () => {
    const user = setup();
    const fake = routedFetch({ ...routes(), "POST /api/v1/calendar/proposals": () => single({ ...resource("prop_01JBBBBBBBBBBBBBBBBBBBBBBB"), type: "reschedule", eventId: E1, title: null, proposedStart: null, proposedEnd: null, attendees: [], reason: "x", status: "pending_approval", approvalId: null }) });
    renderWithProviders(<CalendarPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    await screen.findAllByText("Daily Standup");
    await user.click(await screen.findByRole("button", { name: "Verschiebung vorschlagen" }));
    const dialog = await screen.findByRole("dialog");
    expect((within(dialog).getByLabelText("Art") as HTMLSelectElement).value).toBe("reschedule");
    expect((within(dialog).getByLabelText("Termin") as HTMLSelectElement).value).toBe(E1);
    await user.type(within(dialog).getByLabelText(/Begründung/), "Überschneidung auflösen");
    await user.click(within(dialog).getByRole("button", { name: "Vorschlag erstellen" }));
    await waitFor(() => expect(fake.to("POST", "/api/v1/calendar/proposals")).toHaveLength(1));
    expect(fake.to("POST", "/api/v1/calendar/proposals")[0]?.body).toMatchObject({ type: "reschedule", eventId: E1, reason: "Überschneidung auflösen" });
  });
});

describe("attendee parsing", () => {
  it("accepts 'Name <mail>' and plain addresses and reports invalid lines", () => {
    expect(parseAttendees("Erik Brandt <erik@beispiel.example>\nlena@beispiel.example; kaputt")).toEqual({
      attendees: [
        { name: "Erik Brandt", email: "erik@beispiel.example", response: "needs_action" },
        { name: "lena@beispiel.example", email: "lena@beispiel.example", response: "needs_action" },
      ],
      invalid: ["kaputt"],
    });
  });
});
