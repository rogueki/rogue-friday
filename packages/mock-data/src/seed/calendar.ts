import type {
  Attendee,
  CalendarBriefing,
  CalendarConflict,
  CalendarEvent,
  CalendarProposal,
} from "@friday/sdk";
import { HOUR, MIN, type SeedContext } from "./context";
import type { EventKey, Story, TaskKey, ThreadKey } from "./story";

const TZ = "Europe/Berlin";

interface EventSpec {
  key: EventKey;
  title: string;
  description: string;
  start: string;
  end: string;
  allDay?: boolean;
  location?: string;
  attendees: Attendee[];
  status?: CalendarEvent["status"];
  reminders: number[];
  tasks?: TaskKey[];
  threads?: ThreadKey[];
  briefing?: {
    summary: string;
    context: { name: string; notes: string }[];
    points: string[];
  };
}

const accepted = (name: string, email: string): Attendee => ({ name, email, response: "accepted" });

const SPECS: EventSpec[] = [
  {
    key: "fokus",
    title: "Fokuszeit: Konzept Büroumzug Hannover-Linden",
    description: "Ungestörter Block für das Umzugskonzept (Grundriss, Netzwerk, Möbel).",
    start: "2026-10-14T09:00:00.000Z",
    end: "2026-10-14T10:30:00.000Z",
    attendees: [],
    reminders: [10],
  },
  {
    key: "hoffmann",
    title: "Videocall Hoffmann Logistik – Angebotsrunde",
    description: "Besprechung des überarbeiteten Angebots für die Lagerverwaltung, Fragen zur Rechnung 2026-0917.",
    start: "2026-10-14T13:30:00.000Z",
    end: "2026-10-14T14:30:00.000Z",
    location: "Videokonferenz",
    attendees: [accepted("Dr. Miriam Hoffmann", "m.hoffmann@hoffmann-logistik.example"), accepted("Björn Zander", "b.zander@zander-logistik.example")],
    reminders: [30, 5],
    threads: ["hoffmann"],
    briefing: {
      summary: "Zweite Angebotsrunde mit Hoffmann Logistik. Offen ist außerdem die überfällige Rechnung 2026-0917 über 6.180,00 EUR.",
      context: [
        { name: "Dr. Miriam Hoffmann", notes: "Geschäftsführerin, bevorzugt knappe Zusammenfassungen, zahlt erfahrungsgemäß nach Erinnerung." },
        { name: "Björn Zander", notes: "Leiter Lager, technischer Ansprechpartner." },
      ],
      points: ["Überarbeitetes Angebot: Lagerverwaltung inkl. Schnittstelle", "Rechnung 2026-0917 freundlich ansprechen", "Nächste Schritte und Zeitplan vereinbaren"],
    },
  },
  {
    key: "daily",
    title: "Daily Standup Projekt Leuchtturm",
    description: "Kurzabstimmung mit dem Projektteam.",
    start: "2026-10-15T07:00:00.000Z",
    end: "2026-10-15T07:15:00.000Z",
    location: "Teams",
    attendees: [accepted("Lena Brückner", "l.brueckner@nordwind-energie.example")],
    reminders: [5],
  },
  {
    key: "review",
    title: "Quartalsreview Q3 2026",
    description: "Durchsprache des Quartalsberichts mit der Präsentation.",
    start: "2026-10-15T13:00:00.000Z",
    end: "2026-10-15T14:00:00.000Z",
    location: "Besprechungsraum 2",
    attendees: [],
    reminders: [60, 10],
    tasks: ["quartalsbericht"],
  },
  {
    key: "steuer",
    title: "Telefontermin Steuerberater Albrecht",
    description: "Offene Belege und Fristen für die Erklärung 2025 klären.",
    start: "2026-10-16T09:00:00.000Z",
    end: "2026-10-16T09:45:00.000Z",
    location: "Telefon",
    attendees: [accepted("Thomas Albrecht", "t.albrecht@albrecht-partner.example")],
    reminders: [30],
    tasks: ["steuer"],
    threads: ["albrecht"],
  },
  {
    key: "umzug",
    title: "Büroumzug Hannover-Linden – Vorbereitung",
    description: "Ganztägige Vorbereitung: Kartons, Netzwerkplan, Zugangsschlüssel.",
    start: "2026-10-18T22:00:00.000Z",
    end: "2026-10-19T22:00:00.000Z",
    allDay: true,
    location: "Hannover-Linden",
    attendees: [],
    reminders: [1440],
  },
  {
    key: "zahnarzt",
    title: "Zahnarzt Dr. Lindemann – Kontrolle",
    description: "Halbjährliche Kontrolle.",
    start: "2026-10-20T06:30:00.000Z",
    end: "2026-10-20T07:15:00.000Z",
    location: "Hannover-List",
    attendees: [],
    status: "tentative",
    reminders: [120, 30],
  },
  {
    key: "becker",
    title: "Besprechung Anlagenwartung – Becker & Söhne Maschinenbau",
    description: "Vor-Ort-Termin zur Wartung der Fertigungsanlage. Wartungsprotokoll der letzten Inspektion mitbringen.",
    start: "2026-10-21T08:00:00.000Z",
    end: "2026-10-21T09:30:00.000Z",
    location: "Hannover, Büro Becker & Söhne",
    attendees: [accepted("Katharina Becker", "k.becker@becker-maschinenbau.example")],
    reminders: [1440, 60],
    tasks: ["becker"],
    threads: ["becker"],
    briefing: {
      summary: "Termin mit Frau Becker zur Anlagenwartung. Sie bittet um das Wartungsprotokoll der letzten Inspektion.",
      context: [{ name: "Katharina Becker", notes: "Kundin seit 2021, Ansprechpartnerin für Instandhaltung, schätzt pünktliche schriftliche Bestätigungen." }],
      points: ["Wartungsprotokoll aushändigen", "Zeitfenster für den Austausch der Lager abstimmen", "Angebot für Folgewartung ansprechen"],
    },
  },
  {
    key: "lieferanten",
    title: "Lieferantengespräch Nordlicht IT-Systeme",
    description: "Konditionen für den Wartungsvertrag, Reaktionszeiten und Vertragslaufzeit.",
    start: "2026-10-22T12:00:00.000Z",
    end: "2026-10-22T13:00:00.000Z",
    location: "Hannover, Nordlicht Büro",
    attendees: [accepted("Jan-Hendrik Voss", "voss@nordlicht-it.example"), accepted("Jens Kühnemann", "info@kuehnemann-haustechnik.example")],
    reminders: [60],
    threads: ["nordlicht"],
    briefing: {
      summary: "Gespräch über die Verlängerung des Wartungsvertrags (24 Monate) und die Rechnung 2026-1142.",
      context: [{ name: "Jan-Hendrik Voss", notes: "Account Manager Nordlicht, verhandlungsbereit bei Laufzeit, weniger bei Preis." }],
      points: ["Laufzeit 24 vs. 12 Monate", "Reaktionszeit 4 Stunden fest vereinbaren", "Skonto bei Zahlung bis 21.10."],
    },
  },
  {
    key: "workshop",
    title: "Workshop Projekt Leuchtturm – Architektur und Zeitplan",
    description: "Ganztägiger Nachmittags-Workshop mit allen Teilnehmern.",
    start: "2026-10-22T12:30:00.000Z",
    end: "2026-10-22T15:00:00.000Z",
    location: "Konferenzraum Süd",
    attendees: [accepted("Lena Brückner", "l.brueckner@nordwind-energie.example"), accepted("Matthias Ostermann", "ostermann@ostermann-elektro.example")],
    reminders: [60, 15],
  },
];

export interface CalendarSeed {
  events: CalendarEvent[];
  conflicts: CalendarConflict[];
  briefings: CalendarBriefing[];
  proposals: CalendarProposal[];
}

export function buildCuratedCalendar(ctx: SeedContext, story: Story): CalendarSeed {
  const conflictOverlapId = ctx.id("conf");
  const conflictFocusId = ctx.id("conf");
  const conflictByEvent: Record<string, string[]> = {
    [story.events.lieferanten]: [conflictOverlapId],
    [story.events.workshop]: [conflictOverlapId],
    [story.events.daily]: [conflictFocusId],
    [story.events.review]: [conflictFocusId],
  };

  const briefings: CalendarBriefing[] = [];
  const events: CalendarEvent[] = SPECS.map((spec) => {
    const id = story.events[spec.key];
    let briefingId: string | null = null;
    if (spec.briefing) {
      briefingId = ctx.id("brief");
      briefings.push({
        id: briefingId,
        version: 1,
        createdAt: ctx.at(-3 * HOUR),
        updatedAt: ctx.at(-3 * HOUR),
        source: ctx.src("calendar"),
        eventId: id,
        summary: spec.briefing.summary,
        attendeeContext: spec.briefing.context,
        linkedThreadIds: (spec.threads ?? []).map((key) => story.threads[key]),
        talkingPoints: spec.briefing.points,
        generatedAt: ctx.at(-3 * HOUR),
      });
    }
    const event: CalendarEvent = {
      id,
      version: ctx.rng.int(1, 4),
      createdAt: ctx.at(-5 * 24 * HOUR),
      updatedAt: ctx.at(-ctx.rng.int(1, 40) * HOUR),
      source: ctx.src("calendar"),
      title: spec.title,
      description: spec.description,
      start: spec.start,
      end: spec.end,
      allDay: spec.allDay ?? false,
      timeZone: TZ,
      attendees: spec.attendees,
      status: spec.status ?? "confirmed",
      reminderMinutes: spec.reminders,
      linkedTaskIds: (spec.tasks ?? []).map((key) => story.tasks[key]),
      linkedThreadIds: (spec.threads ?? []).map((key) => story.threads[key]),
      conflictIds: conflictByEvent[id] ?? [],
      briefingId,
    };
    if (spec.location) event.location = spec.location;
    return event;
  });

  const conflicts: CalendarConflict[] = [
    {
      id: conflictOverlapId,
      version: 1,
      createdAt: ctx.at(-2 * HOUR),
      updatedAt: ctx.at(-2 * HOUR),
      source: ctx.src("calendar"),
      eventIds: [story.events.lieferanten, story.events.workshop],
      kind: "overlap",
      severity: "warning",
      description: "Das Lieferantengespräch (14:00–15:00) überschneidet sich mit dem Workshop Projekt Leuchtturm (14:30–17:00).",
      detectedAt: ctx.at(-2 * HOUR),
      suggestedResolution: "Lieferantengespräch auf Freitag 09:30 Uhr verschieben.",
    },
    {
      id: conflictFocusId,
      version: 1,
      createdAt: ctx.at(-2 * HOUR),
      updatedAt: ctx.at(-2 * HOUR),
      source: ctx.src("calendar"),
      eventIds: [story.events.daily, story.events.review],
      kind: "no_focus_time",
      severity: "info",
      description: "Am Donnerstag bleibt zwischen Standup und Quartalsreview kein zusammenhängender Fokusblock von 90 Minuten.",
      detectedAt: ctx.at(-2 * HOUR),
      suggestedResolution: "Fokuszeit am Donnerstag von 10:00 bis 11:30 Uhr blockieren.",
    },
  ];

  const proposals: CalendarProposal[] = [
    {
      id: ctx.id("prop"),
      version: 1,
      createdAt: ctx.at(-40 * MIN),
      updatedAt: ctx.at(-40 * MIN),
      source: ctx.src("calendar"),
      type: "reschedule",
      eventId: story.events.lieferanten,
      title: "Lieferantengespräch Nordlicht IT-Systeme",
      proposedStart: "2026-10-23T07:30:00.000Z",
      proposedEnd: "2026-10-23T08:30:00.000Z",
      attendees: [accepted("Jan-Hendrik Voss", "voss@nordlicht-it.example")],
      reason: "Überschneidung mit dem Workshop Projekt Leuchtturm am Donnerstag.",
      status: "pending_approval",
      approvalId: story.approvals.terminVerschieben,
    },
  ];
  return { events, conflicts, briefings, proposals };
}

const FILLER_TITLES = [
  "Wochenplanung",
  "Rücksprache Elektriker Ostermann",
  "Kundentermin Hameln",
  "Jour fixe Vertrieb",
  "Mittagessen mit Herrn Zander",
  "Abstimmung Webshop-Relaunch",
  "Telefonat Stadtwerke Hannover",
  "Schulung Datenschutz",
];

export function buildFillerEvents(ctx: SeedContext, count: number): CalendarEvent[] {
  const dayStart = Date.parse("2026-10-12T00:00:00.000Z");
  return Array.from({ length: count }, (_, index) => {
    const dayOffset = ctx.rng.int(0, 20);
    const startMinute = ctx.rng.int(7 * 60, 17 * 60);
    const durationMinutes = ctx.rng.pick([15, 30, 45, 60, 90]);
    const start = dayStart + dayOffset * 86_400_000 + startMinute * MIN;
    return {
      id: ctx.id("cal"),
      version: 1,
      createdAt: ctx.at(-7 * 24 * HOUR),
      updatedAt: ctx.at(-24 * HOUR),
      source: ctx.src("calendar"),
      title: `${ctx.rng.pick(FILLER_TITLES)} (${index + 1})`,
      start: new Date(start).toISOString(),
      end: new Date(start + durationMinutes * MIN).toISOString(),
      allDay: false,
      timeZone: TZ,
      attendees: [],
      status: "confirmed",
      reminderMinutes: [15],
      linkedTaskIds: [],
      linkedThreadIds: [],
      conflictIds: [],
      briefingId: null,
    } satisfies CalendarEvent;
  });
}
