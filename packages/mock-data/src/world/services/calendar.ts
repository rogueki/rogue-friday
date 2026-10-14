import type {
  Approval,
  CalendarBriefing,
  CalendarConflict,
  CalendarEvent,
  CalendarProposal,
  CalendarProposalRequest,
} from "@jarvis/sdk";
import { MockApiError, notFound, validationFailed } from "../../core/errors";
import { asIso, clone, compareAsc, compareDesc, matchesQuery, type Page } from "../../core/util";
import type { MockWorld } from "../world";
import type { OpContext } from "../types";
import { pageOf, type Query } from "./shared";

export type CalendarEventQuery = Query<"listCalendarEvents">;
export type CalendarConflictQuery = Query<"listCalendarConflicts">;
export type CalendarBriefingQuery = Query<"listCalendarBriefings">;

const TYPE_LABEL: Record<CalendarProposal["type"], string> = {
  create: "Termin anlegen",
  reschedule: "Termin verschieben",
  cancel: "Termin absagen",
  invite: "Teilnehmer einladen",
  respond: "Auf Einladung antworten",
};

const dateTimeFormat = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

export class CalendarService {
  constructor(private readonly w: MockWorld) {}

  findEvent(id: string): CalendarEvent {
    const event = this.w.state.calendarEvents.find((candidate) => candidate.id === id);
    if (!event) throw notFound("Termin", id);
    return event;
  }

  listEvents(query: CalendarEventQuery = {}): Page<CalendarEvent> {
    return this.w.read("listCalendarEvents", () => {
      const from = asIso(query.from, "from");
      const to = asIso(query.to, "to");
      const items = this.w.state.calendarEvents
        .filter((event) => {
          if (from !== undefined && Date.parse(event.end) <= from) return false;
          if (to !== undefined && Date.parse(event.start) >= to) return false;
          return matchesQuery(`${event.title} ${event.description ?? ""} ${event.location ?? ""} ${event.attendees.map((a) => a.name).join(" ")}`, query.q);
        })
        .sort((a, b) => compareAsc(a.start, b.start) || compareAsc(a.id, b.id));
      return pageOf(items, query);
    });
  }

  getEvent(id: string): CalendarEvent {
    return this.w.read("getCalendarEvent", () => clone(this.findEvent(id)));
  }

  listConflicts(query: CalendarConflictQuery = {}): Page<CalendarConflict> {
    return this.w.read("listCalendarConflicts", () => {
      const from = asIso(query.from, "from");
      const to = asIso(query.to, "to");
      const items = this.w.state.calendarConflicts
        .filter((entry) => {
          if (from === undefined && to === undefined) return true;
          return entry.eventIds.some((eventId) => {
            const event = this.w.state.calendarEvents.find((candidate) => candidate.id === eventId);
            if (!event) return false;
            if (from !== undefined && Date.parse(event.end) <= from) return false;
            if (to !== undefined && Date.parse(event.start) >= to) return false;
            return true;
          });
        })
        .sort((a, b) => compareDesc(a.detectedAt, b.detectedAt) || compareDesc(a.id, b.id));
      return pageOf(items, query);
    });
  }

  listBriefings(query: CalendarBriefingQuery = {}): Page<CalendarBriefing> {
    return this.w.read("listCalendarBriefings", () => {
      const items = this.w.state.calendarBriefings.filter((briefing) => (query.eventId ? briefing.eventId === query.eventId : true)).sort((a, b) => compareDesc(a.generatedAt, b.generatedAt));
      return pageOf(items, query);
    });
  }

  listProposals(): CalendarProposal[] {
    return clone(this.w.state.calendarProposals);
  }

  /** Write access to the calendar always goes through a proposal and an approval. */
  createProposal(body: CalendarProposalRequest, ctx?: OpContext): CalendarProposal {
    return this.w.run("createCalendarProposal", ctx, body, () => {
      this.w.validate("CalendarProposalRequest", body);
      const capability = this.w.state.capabilities.modules.calendar;
      const flagByType: Record<CalendarProposal["type"], boolean> = {
        create: capability.create,
        reschedule: capability.reschedule,
        cancel: capability.cancel,
        invite: capability.invite,
        respond: capability.respond,
      };
      if (!flagByType[body.type]) {
        throw new MockApiError({ code: "CAPABILITY_MISSING", message: `Die Fähigkeit calendar.${body.type} wird nicht angeboten.`, details: { capability: `calendar.${body.type}` } });
      }
      let event: CalendarEvent | undefined;
      if (body.type !== "create") {
        if (!body.eventId) throw validationFailed("eventId ist für diesen Vorschlagstyp erforderlich.", [{ path: "eventId", message: "erforderlich" }]);
        event = this.findEvent(body.eventId);
      } else if (!body.title || !body.start || !body.end) {
        throw validationFailed("title, start und end sind zum Anlegen erforderlich.", [{ path: "title", message: "erforderlich" }]);
      }
      if ((body.type === "reschedule" || body.type === "create") && (!body.start || !body.end || Date.parse(body.start) >= Date.parse(body.end))) {
        throw validationFailed("start muss vor end liegen.", [{ path: "start", message: "start < end" }]);
      }
      const now = this.w.nowIso();
      const proposal: CalendarProposal = {
        id: this.w.id("prop"),
        version: 1,
        createdAt: now,
        updatedAt: now,
        source: this.w.source("calendar"),
        type: body.type,
        eventId: event?.id ?? null,
        title: body.title ?? event?.title ?? null,
        proposedStart: body.start ?? null,
        proposedEnd: body.end ?? null,
        attendees: body.attendees ?? [],
        reason: body.reason,
        status: "pending_approval",
        approvalId: null,
      };
      const fields = [
        ...(event ? [{ label: "Termin", value: event.title }] : []),
        ...(event && body.type === "reschedule" ? [{ label: "Bisher", value: this.format(event.start, event.end) }] : []),
        ...(body.start && body.end ? [{ label: body.type === "create" ? "Zeit" : "Neu", value: this.format(body.start, body.end) }] : []),
        ...((body.attendees ?? []).length ? [{ label: "Teilnehmer", value: (body.attendees ?? []).map((a) => a.name).join(", ") }] : []),
      ];
      const approval = this.w.approvals.raise({
        type: "change_event",
        action: `${TYPE_LABEL[body.type]}: ${proposal.title ?? "Neuer Termin"}`,
        riskTier: 2,
        agentId: ctx?.actor?.type === "agent" ? ctx.actor.id : (this.w.state.agents.find((agent) => agent.role.toLowerCase().includes("termin"))?.id ?? null),
        rationale: body.reason,
        impacts: [
          { kind: "schedule", description: "Der Kalender wird nach Ihrer Freigabe geändert.", severity: "warning" },
          ...(body.attendees?.length || event?.attendees.length ? [{ kind: "communication" as const, description: "Teilnehmer erhalten eine aktualisierte Einladung.", severity: "info" as const }] : []),
        ],
        preview: { kind: "calendar", title: proposal.title ?? "Neuer Termin", body: body.reason, fields },
        sourceRef: event ? { type: "calendar_event", id: event.id, label: event.title } : null,
        editable: true,
        ...(ctx?.correlationId ? { correlationId: ctx.correlationId } : {}),
      });
      proposal.approvalId = approval.id;
      this.w.state.calendarProposals.push(proposal);
      return clone(proposal);
    });
  }

  // ---- approval hooks ----

  executeProposal(approval: Approval): string {
    const proposal = this.w.state.calendarProposals.find((candidate) => candidate.approvalId === approval.id);
    if (!proposal) return "Terminänderung wurde im Kalender übernommen.";
    const now = this.w.nowIso();
    let message: string;
    if (proposal.type === "create") {
      const event: CalendarEvent = {
        id: this.w.id("cal"),
        version: 1,
        createdAt: now,
        updatedAt: now,
        source: this.w.source("calendar"),
        title: proposal.title ?? "Neuer Termin",
        start: proposal.proposedStart as string,
        end: proposal.proposedEnd as string,
        allDay: false,
        timeZone: "Europe/Berlin",
        attendees: proposal.attendees,
        status: "confirmed",
        reminderMinutes: [15],
        linkedTaskIds: [],
        linkedThreadIds: [],
        conflictIds: [],
        briefingId: null,
      };
      this.w.state.calendarEvents.push(event);
      this.w.emitFor("calendar", "jarvis.calendar.event_updated", event, `calendar/${event.id}`, approval.correlationId);
      this.recomputeConflicts(event.id);
      message = `Termin „${event.title}“ wurde angelegt.`;
    } else {
      const event = this.findEvent(proposal.eventId as string);
      if (proposal.type === "reschedule") {
        event.start = proposal.proposedStart as string;
        event.end = proposal.proposedEnd as string;
        message = `Termin „${event.title}“ wurde verschoben auf ${this.format(event.start, event.end)}.`;
      } else if (proposal.type === "cancel") {
        event.status = "cancelled";
        message = `Termin „${event.title}“ wurde abgesagt.`;
      } else if (proposal.type === "invite") {
        for (const attendee of proposal.attendees) if (!event.attendees.some((existing) => existing.email && existing.email === attendee.email)) event.attendees.push({ ...attendee, response: "needs_action" });
        message = `Einladungen zu „${event.title}“ wurden versendet.`;
      } else {
        event.status = "confirmed";
        message = `Antwort auf „${event.title}“ wurde gesendet.`;
      }
      this.w.bump(event);
      this.w.emitFor("calendar", "jarvis.calendar.event_updated", event, `calendar/${event.id}`, approval.correlationId);
      this.recomputeConflicts(event.id);
    }
    proposal.status = "applied";
    this.w.bump(proposal);
    return message;
  }

  onApprovalClosed(approval: Approval, outcome: "rejected" | "expired" | "cancelled" | "failed"): void {
    const proposal = this.w.state.calendarProposals.find((candidate) => candidate.approvalId === approval.id);
    if (!proposal || proposal.status === "applied") return;
    proposal.status = outcome === "failed" ? "failed" : "rejected";
    this.w.bump(proposal);
  }

  /** Detects overlaps for one event, adds new conflicts and removes resolved overlap conflicts. */
  recomputeConflicts(eventId: string): void {
    const state = this.w.state;
    const event = state.calendarEvents.find((candidate) => candidate.id === eventId);
    if (!event) return;
    const overlaps = (a: CalendarEvent, b: CalendarEvent): boolean =>
      a.status !== "cancelled" && b.status !== "cancelled" && !a.allDay && !b.allDay && Date.parse(a.start) < Date.parse(b.end) && Date.parse(b.start) < Date.parse(a.end);
    for (const existing of [...state.calendarConflicts]) {
      if (existing.kind !== "overlap" || !existing.eventIds.includes(eventId)) continue;
      const events = existing.eventIds.map((id) => state.calendarEvents.find((candidate) => candidate.id === id));
      const [a, b] = events;
      if (a && b && overlaps(a, b)) continue;
      state.calendarConflicts = state.calendarConflicts.filter((candidate) => candidate.id !== existing.id);
      for (const id of existing.eventIds) {
        const other = state.calendarEvents.find((candidate) => candidate.id === id);
        if (other) {
          other.conflictIds = other.conflictIds.filter((conflictId) => conflictId !== existing.id);
          if (other.id !== eventId) {
            this.w.bump(other);
            this.w.emitFor("calendar", "jarvis.calendar.event_updated", other, `calendar/${other.id}`);
          }
        }
      }
    }
    for (const other of state.calendarEvents) {
      if (other.id === event.id || !overlaps(event, other)) continue;
      const known = state.calendarConflicts.some((entry) => entry.kind === "overlap" && entry.eventIds.includes(event.id) && entry.eventIds.includes(other.id));
      if (known) continue;
      const now = this.w.nowIso();
      const created: CalendarConflict = {
        id: this.w.id("conf"),
        version: 1,
        createdAt: now,
        updatedAt: now,
        source: this.w.source("calendar"),
        eventIds: [event.id, other.id],
        kind: "overlap",
        severity: "warning",
        description: `„${event.title}“ überschneidet sich mit „${other.title}“.`,
        detectedAt: now,
        suggestedResolution: "Einen der Termine verschieben.",
      };
      state.calendarConflicts.push(created);
      event.conflictIds.push(created.id);
      other.conflictIds.push(created.id);
      this.w.bump(other);
      this.w.emitFor("calendar", "jarvis.calendar.event_updated", other, `calendar/${other.id}`);
      this.w.emitFor("calendar", "jarvis.calendar.conflict_detected", created, `calendar/${created.id}`);
    }
  }

  private format(start: string, end: string): string {
    return `${dateTimeFormat.format(new Date(start))} – ${new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" }).format(new Date(end))}`;
  }
}
