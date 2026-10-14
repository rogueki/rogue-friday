"use client";

import type { CalendarBriefing, CalendarConflict, CalendarEvent } from "@jarvis/sdk";
import { Button, StatusChip } from "@jarvis/ui";
import { AlertTriangle, CalendarPlus, FileText } from "lucide-react";
import { useMemo } from "react";
import { PanelFrame } from "@/components/PanelFrame";
import { useT } from "@/i18n";
import { useCalendarBriefings, useCalendarConflicts } from "@/lib/api/domains/calendar";
import { useCapability } from "@/lib/capabilities";
import { severityFromWire } from "../shared/presentation";
import { DataBadges } from "../memory/kit/Badges";
import { useFormat } from "../memory/kit/hooks";
import { usePanelState } from "../memory/kit/panelState";
import { civilKey, clock, instantOf, type Civil } from "./dates";
import { conflictKindKey, formatCivil } from "./labels";
import { freeSlots, type Interval } from "./layout";
import type { ProposalDefaults } from "./ProposalDialog";

export interface CalendarSideProps {
  focusDay: Civil;
  events: readonly CalendarEvent[];
  now: Date;
  onOpenEvent: (id: string) => void;
  onPropose: (defaults: ProposalDefaults) => void;
}

const MAX_BRIEFINGS = 4;

export function CalendarSide({ focusDay, events, now, onOpenEvent, onPropose }: CalendarSideProps) {
  return (
    <div className="cal-side">
      <ConflictsPanel onOpenEvent={onOpenEvent} onPropose={onPropose} />
      <FreePanel focusDay={focusDay} events={events} onPropose={onPropose} />
      <BriefingsPanel events={events} now={now} onOpenEvent={onOpenEvent} />
    </div>
  );
}

function ConflictsPanel({ onOpenEvent, onPropose }: Pick<CalendarSideProps, "onOpenEvent" | "onPropose">) {
  const { t } = useT();
  const format = useFormat();
  const query = useCalendarConflicts();
  const canPropose = useCapability("calendar", "propose");
  const canReschedule = useCapability("calendar", "reschedule");
  const items: CalendarConflict[] = query.data?.items ?? [];
  const state = usePanelState(query, {
    module: "calendar",
    moduleName: t("nav.calendar"),
    adapterId: query.data?.sources[0]?.adapterId,
    empty: items.length === 0,
    emptyTitle: t("calendar.conflicts.empty"),
    emptyDescription: t("calendar.conflicts.emptyHint"),
    emptyIcon: <AlertTriangle size={20} strokeWidth={1.5} />,
  });
  return (
    <PanelFrame title={t("calendar.conflicts.title")} state={state} skeletonRows={2} className="mk-narrow" level={items.length > 0 ? 3 : 1} tone={items.length > 0 ? "amber" : "cyan"}>
      <ul className="mk-list">
        {items.map((conflict) => {
          const critical = severityFromWire(conflict.severity) === "critical";
          const firstEvent = conflict.eventIds[0];
          return (
            <li key={conflict.id} className={`mk-block mk-block--${critical ? "red" : "amber"}`}>
              <p className="cal-conflict__head">
                <StatusChip tone={critical ? "red" : "amber"} icon={<AlertTriangle size={12} strokeWidth={1.75} aria-hidden="true" />}>
                  {t(conflictKindKey(conflict.kind))}
                </StatusChip>
                <span className="mk-muted">{format.relative(conflict.detectedAt)}</span>
              </p>
              <p>{conflict.description}</p>
              {conflict.suggestedResolution ? <p className="mk-muted">{t("calendar.conflicts.suggestion", { text: conflict.suggestedResolution })}</p> : null}
              <div className="mk-actions cal-conflict__actions">
                {firstEvent ? (
                  <Button size="sm" variant="ghost" onClick={() => onOpenEvent(firstEvent)}>
                    {t("calendar.conflicts.openEvent")}
                  </Button>
                ) : null}
                {firstEvent ? (
                  <Button size="sm" variant="ghost" disabled={!canPropose || !canReschedule} title={!canPropose || !canReschedule ? t("calendar.proposal.notAllowed") : undefined} onClick={() => onPropose({ type: "reschedule", eventId: firstEvent })}>
                    {t("calendar.conflicts.propose")}
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </PanelFrame>
  );
}

function slotMinutes(slots: readonly Interval[]): number {
  return slots.reduce((sum, slot) => sum + (slot.endMin - slot.startMin), 0);
}

function FreePanel({ focusDay, events, onPropose }: Pick<CalendarSideProps, "focusDay" | "events" | "onPropose">) {
  const { t } = useT();
  const format = useFormat();
  const canPropose = useCapability("calendar", "propose");
  const canCreate = useCapability("calendar", "create");
  const slots = useMemo(() => freeSlots(events, focusDay, format.timeZone), [events, focusDay, format.timeZone]);
  const total = slotMinutes(slots);
  const dayLabel = formatCivil(focusDay, format.locale, { weekday: "long", day: "numeric", month: "long" });
  return (
    <PanelFrame title={t("calendar.free.title")} subtitle={dayLabel} state={{ kind: "ready" }}>
      {slots.length === 0 ? (
        <p className="mk-note">{t("calendar.free.none")}</p>
      ) : (
        <div className="mk-stack">
          <p className="mk-note">{t("calendar.free.summary", { count: slots.length, hours: Math.floor(total / 60), minutes: total % 60 })}</p>
          <ul className="mk-list">
            {slots.map((slot) => (
              <li key={`${civilKey(focusDay)}-${slot.startMin}`} className="mk-row cal-free-row">
                <span aria-hidden="true" />
                <span className="mk-row__main">
                  <span className="mk-row__title">
                    {clock(slot.startMin)}–{clock(slot.endMin)}
                  </span>
                  <span className="mk-row__meta">{t("calendar.free.length", { minutes: slot.endMin - slot.startMin })}</span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<CalendarPlus size={13} />}
                  disabled={!canPropose || !canCreate}
                  title={!canPropose || !canCreate ? t("calendar.proposal.notAllowed") : undefined}
                  onClick={() =>
                    onPropose({
                      type: "create",
                      start: instantOf(focusDay, slot.startMin, format.timeZone).toISOString(),
                      end: instantOf(focusDay, Math.min(slot.endMin, slot.startMin + 60), format.timeZone).toISOString(),
                    })
                  }
                >
                  {t("calendar.free.propose")}
                </Button>
              </li>
            ))}
          </ul>
          <p className="mk-note">{t("calendar.free.hours", { from: "08:00", to: "18:00" })}</p>
        </div>
      )}
    </PanelFrame>
  );
}

function BriefingsPanel({ events, now, onOpenEvent }: Pick<CalendarSideProps, "events" | "now" | "onOpenEvent">) {
  const { t } = useT();
  const format = useFormat();
  const query = useCalendarBriefings();
  const briefings = query.data?.items ?? [];
  const byEvent = new Map<string, CalendarBriefing>(briefings.map((briefing) => [briefing.eventId, briefing]));
  const upcoming = events
    .filter((event) => event.status !== "cancelled" && Date.parse(event.end) > now.getTime() && (byEvent.has(event.id) || event.briefingId))
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, MAX_BRIEFINGS);
  const state = usePanelState(query, {
    module: "calendar",
    moduleName: t("nav.calendar"),
    adapterId: query.data?.sources[0]?.adapterId,
    empty: upcoming.length === 0,
    emptyTitle: t("calendar.briefing.empty"),
    emptyDescription: t("calendar.briefing.emptyHint"),
    emptyIcon: <FileText size={20} strokeWidth={1.5} />,
  });
  return (
    <PanelFrame title={t("calendar.briefing.title")} state={state} skeletonRows={2} className="mk-narrow" actions={<DataBadges sources={query.data?.sources} />}>
      <ul className="mk-list">
        {upcoming.map((event) => {
          const briefing = byEvent.get(event.id);
          return (
            <li key={event.id}>
              <button type="button" className="mk-row cal-briefing" onClick={() => onOpenEvent(event.id)}>
                <FileText size={16} strokeWidth={1.5} aria-hidden="true" />
                <span className="mk-row__main">
                  <span className="mk-row__title">{event.title}</span>
                  <span className="mk-row__meta">{format.dateTime(event.start)}</span>
                  {briefing ? <span className="mk-row__text">{briefing.summary}</span> : null}
                </span>
                <span />
              </button>
            </li>
          );
        })}
      </ul>
    </PanelFrame>
  );
}
