"use client";

import type { CalendarEvent, CalendarProposalType } from "@friday/sdk";
import { Button, EmptyState, HudPanel, IconButton, useMediaQuery, useNow } from "@friday/ui";
import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, Globe2 } from "lucide-react";
import { Suspense, useMemo, useState } from "react";
import { PanelFrame } from "@/components/PanelFrame";
import { useT } from "@/i18n";
import { useCalendarConflicts, useCalendarEvents } from "@/lib/api/domains/calendar";
import { useCapability, useCapabilityState } from "@/lib/capabilities";
import { useSession } from "@/lib/session";
import { CapabilityNote, DataBadges } from "../memory/kit/Badges";
import { useUrlParam, useFormat } from "../memory/kit/hooks";
import { effectiveFreshness, usePanelState } from "../memory/kit/panelState";
import { AgendaView } from "./AgendaView";
import { CalendarSide } from "./CalendarSide";
import { addDays, addMonths, civilKey, civilOf, isoWeek, parseCivilKey, rangeOfDays, startOfWeek, tzOffsetMinutes, monthGrid, type Civil } from "./dates";
import { EventDrawer } from "./EventDrawer";
import { formatCivil, isView, offsetLabel, VIEWS, viewKey, type CalendarView } from "./labels";
import { MonthGrid } from "./MonthGrid";
import { ProposalDialog, type ProposalDefaults } from "./ProposalDialog";
import { CalDavCreateDialog } from "./CalDavCreateDialog";
import { LocalEventDialog } from "./LocalEventDialog";
import { TimeGrid } from "./TimeGrid";
import "./calendar.css";

const AGENDA_DAYS = 30;

export function CalendarPage() {
  return (
    <Suspense fallback={null}>
      <CalendarPageInner />
    </Suspense>
  );
}

function CalendarPageInner() {
  const session = useSession();
  const { t } = useT();
  const format = useFormat();
  const now = useNow(30_000);
  const wide = useMediaQuery("(min-width: 1280px)");
  const narrow = useMediaQuery("(max-width: 640px)");
  const [viewParam, setViewParam] = useUrlParam("view");
  const [dateParam, setDateParam] = useUrlParam("date");
  const [eventId, setEventId] = useUrlParam("event");
  const [proposal, setProposal] = useState<ProposalDefaults | null>(null);
  const [caldavCreateOpen, setCalDavCreateOpen] = useState(false);
  const [localEditorOpen, setLocalEditorOpen] = useState(false);
  const [localEvent, setLocalEvent] = useState<CalendarEvent | null>(null);

  const timeZone = format.timeZone;
  const today = civilOf(now, timeZone);
  // Phones get the agenda by default: seven day columns do not fit a 390 px screen (PLAN §53).
  const view: CalendarView = isView(viewParam) ? viewParam : narrow ? "agenda" : "week";
  const focus = parseCivilKey(dateParam) ?? today;

  const days = useMemo<Civil[]>(() => {
    if (view === "day") return [focus];
    if (view === "week") {
      const first = startOfWeek(focus);
      return Array.from({ length: 7 }, (_, index) => addDays(first, index));
    }
    return [];
  }, [view, focus]);

  const range = useMemo(() => {
    if (view === "day") return rangeOfDays(focus, 1, timeZone);
    if (view === "week") return rangeOfDays(startOfWeek(focus), 7, timeZone);
    if (view === "month") return rangeOfDays(monthGrid(focus)[0] as Civil, 42, timeZone);
    return rangeOfDays(focus, AGENDA_DAYS, timeZone);
  }, [view, focus, timeZone]);

  const eventsQuery = useCalendarEvents({ from: range.from.toISOString(), to: range.to.toISOString(), limit: 200 });
  const conflicts = useCalendarConflicts();
  const proposeState = useCapabilityState("calendar", "propose");
  const canPropose = useCapability("calendar", "propose");
  const canCreateCalDav = useCapability("calendar", "create") && !canPropose && session.role === "owner";

  const events: CalendarEvent[] = useMemo(() => eventsQuery.data?.items ?? [], [eventsQuery.data]);
  const conflictEventIds = useMemo(() => new Set((conflicts.data?.items ?? []).flatMap((conflict) => conflict.eventIds)), [conflicts.data]);
  const visibleCount = events.filter((event) => event.status !== "cancelled").length;

  const state = usePanelState(eventsQuery, {
    module: "calendar",
    moduleName: t("nav.calendar"),
    adapterId: eventsQuery.data?.sources[0]?.adapterId,
    empty: view === "agenda" && events.length === 0,
    emptyTitle: t("calendar.empty"),
    emptyDescription: t("calendar.empty.hint"),
    emptyIcon: <CalendarDays size={22} strokeWidth={1.5} />,
  });

  const go = (target: Civil): void => setDateParam(civilKey(target));
  const step = (direction: 1 | -1): void => {
    if (view === "day") go(addDays(focus, direction));
    else if (view === "week") go(addDays(focus, 7 * direction));
    else if (view === "month") go(addMonths(focus, direction));
    else go(addDays(focus, AGENDA_DAYS * direction));
  };
  const openDay = (civil: Civil): void => {
    setViewParam("day");
    setDateParam(civilKey(civil));
  };

  const rangeLabel = useMemo(() => {
    if (view === "day") return formatCivil(focus, format.locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    if (view === "week") {
      const first = startOfWeek(focus);
      const last = addDays(first, 6);
      const from = formatCivil(first, format.locale, { day: "numeric", month: first.m === last.m ? undefined : "short" });
      const to = formatCivil(last, format.locale, { day: "numeric", month: "long", year: "numeric" });
      return `${t("calendar.weekShort", { week: isoWeek(first) })} · ${from} – ${to}`;
    }
    if (view === "month") return formatCivil(focus, format.locale, { month: "long", year: "numeric" });
    return t("calendar.agenda.range", { from: formatCivil(focus, format.locale, { day: "numeric", month: "long", year: "numeric" }), days: AGENDA_DAYS });
  }, [view, focus, format.locale, t]);

  const zoneName = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const offset = offsetLabel(tzOffsetMinutes(now, timeZone));
  const label = t("calendar.viewLabel", { view: t(viewKey(view)), range: rangeLabel });

  const propose = (type: CalendarProposalType, event: CalendarEvent): void => setProposal({ type, eventId: event.id });

  return (
    <div className="mk-page cal-page">
      <HudPanel
        title={t("nav.calendar")}
        subtitle={t("page.calendar.description")}
        icon={<CalendarDays size={18} strokeWidth={1.5} />}
        actions={
          <span className="mk-actions">
            <DataBadges sources={eventsQuery.data?.sources} freshness={effectiveFreshness(eventsQuery)} />
            {session.role === "owner" && <Button size="sm" icon={<CalendarPlus size={14} />} onClick={() => { setLocalEvent(null); setLocalEditorOpen(true); }}>Jetzt Termin anlegen</Button>}
            {canCreateCalDav && <Button size="sm" variant="ghost" onClick={() => setCalDavCreateOpen(true)}>CalDAV-Termin anlegen</Button>}
            <Button size="sm" icon={<CalendarPlus size={14} />} disabled={!canPropose} title={!canPropose ? t("calendar.proposal.notAllowed") : t("calendar.proposal.hint")} onClick={() => setProposal({ type: "create" })}>
              {t("calendar.proposal.open")}
            </Button>
          </span>
        }
      >
        <div className="mk-stack">
          {session.role === "owner" ? <p className="mk-note">Friday-Kalender ist bereit. Du kannst Termine direkt verwalten und bei Bedarf einen externen Kalender verbinden.</p> : <CapabilityNote state={proposeState} readText={t("calendar.kit.readOnly")} writeText={t("calendar.kit.writeUnavailable")} />}
          <div className="cal-toolbar">
            <div className="cal-seg" role="group" aria-label={t("calendar.views")}>
              {VIEWS.map((value) => (
                <button key={value} type="button" className="cal-seg__btn" aria-pressed={view === value} onClick={() => setViewParam(value)}>
                  {t(viewKey(value))}
                </button>
              ))}
            </div>
            <div className="cal-nav" role="group" aria-label={t("calendar.navigate")}>
              <IconButton label={t("calendar.previous")} icon={<ChevronLeft size={16} strokeWidth={1.5} />} size="sm" onClick={() => step(-1)} />
              <Button size="sm" variant="ghost" onClick={() => setDateParam(null)} disabled={civilKey(focus) === civilKey(today)}>
                {t("calendar.today")}
              </Button>
              <IconButton label={t("calendar.next")} icon={<ChevronRight size={16} strokeWidth={1.5} />} size="sm" onClick={() => step(1)} />
            </div>
            <h2 className="cal-range" aria-live="polite">
              {rangeLabel}
            </h2>
            <span className="cal-zone" title={t("calendar.zone.hint")}>
              <Globe2 size={13} strokeWidth={1.5} aria-hidden="true" /> {t("calendar.zone.label", { zone: zoneName, offset })}
            </span>
            <span className="cal-count mk-muted">{t("calendar.count", { count: visibleCount })}</span>
          </div>
        </div>
      </HudPanel>

      <div className={`cal-layout${wide ? " cal-layout--wide" : ""}`}>
        <PanelFrame title={t(viewKey(view))} state={state} skeletonRows={6} className="cal-main" bodyClassName="cal-main__body">
          {view === "day" || view === "week" ? (
            <TimeGrid
              days={days}
              today={today}
              now={now}
              events={events}
              conflictEventIds={conflictEventIds}
              selectedEventId={eventId}
              onOpenEvent={(id) => setEventId(id, { push: true })}
              onOpenDay={openDay}
              showFree={view === "day"}
              label={label}
            />
          ) : view === "month" ? (
            <MonthGrid focus={focus} today={today} events={events} conflictEventIds={conflictEventIds} selectedEventId={eventId} onOpenEvent={(id) => setEventId(id, { push: true })} onOpenDay={openDay} label={label} />
          ) : (
            <AgendaView first={focus} days={AGENDA_DAYS} today={today} events={events} conflictEventIds={conflictEventIds} selectedEventId={eventId} onOpenEvent={(id) => setEventId(id, { push: true })} label={label} />
          )}
          {eventsQuery.data?.pageInfo.hasNextPage ? <p className="mk-note">{t("calendar.truncated")}</p> : null}
        </PanelFrame>
        <CalendarSide focusDay={focus} events={events} now={now} onOpenEvent={(id) => setEventId(id, { push: true })} onPropose={setProposal} />
      </div>

      {events.length === 0 && state.kind === "ready" && view !== "agenda" ? (
        <EmptyState compact icon={<CalendarDays size={20} strokeWidth={1.5} />} title={t("calendar.empty.range")} description={t("calendar.empty.rangeHint")} />
      ) : null}

      <EventDrawer id={eventId} onClose={() => setEventId(null)} onPropose={propose} onEditLocal={(event) => { setLocalEvent(event); setLocalEditorOpen(true); setEventId(null); }} />
      <ProposalDialog open={proposal !== null} onOpenChange={(open) => { if (!open) setProposal(null); }} events={events} defaults={proposal ?? undefined} />
      <CalDavCreateDialog open={caldavCreateOpen} onOpenChange={setCalDavCreateOpen} />
      <LocalEventDialog open={localEditorOpen} event={localEvent} onOpenChange={setLocalEditorOpen} />
    </div>
  );
}
