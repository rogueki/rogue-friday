"use client";

import type { CalendarEvent } from "@friday/sdk";
import { StatusChip } from "@friday/ui";
import { AlertTriangle, FileText, MapPin, Users } from "lucide-react";
import { useT } from "@/i18n";
import { useFormat } from "../memory/kit/hooks";
import { addDays, civilKey, sameDay, type Civil } from "./dates";
import { formatCivil, STATUS_TONE, statusKey } from "./labels";
import { eventsOnDay } from "./layout";

export interface AgendaViewProps {
  first: Civil;
  days: number;
  today: Civil;
  events: readonly CalendarEvent[];
  conflictEventIds: ReadonlySet<string>;
  selectedEventId: string | null;
  onOpenEvent: (id: string) => void;
  label: string;
}

/** Chronological list grouped by day; days without events are left out. */
export function AgendaView({ first, days, today, events, conflictEventIds, selectedEventId, onOpenEvent, label }: AgendaViewProps) {
  const { t } = useT();
  const format = useFormat();
  const groups = Array.from({ length: days }, (_, index) => addDays(first, index))
    .map((day) => ({ day, items: eventsOnDay(events, day, format.timeZone) }))
    .filter((group) => group.items.length > 0);
  return (
    <div className="cal-agenda" role="group" aria-label={label}>
      {groups.map(({ day, items }) => (
        <section key={civilKey(day)} className="cal-agenda__day" aria-label={formatCivil(day, format.locale, { weekday: "long", day: "numeric", month: "long" })}>
          <h3 className={`cal-agenda__heading${sameDay(day, today) ? " cal-agenda__heading--today" : ""}`}>
            {formatCivil(day, format.locale, { weekday: "long", day: "numeric", month: "long" })}
            {sameDay(day, today) ? <span className="cal-agenda__today">{t("calendar.today")}</span> : null}
          </h3>
          <ul className="mk-list">
            {items.map((event) => {
              const conflict = conflictEventIds.has(event.id) || event.conflictIds.length > 0;
              return (
                <li key={event.id}>
                  <button type="button" className={`mk-row cal-agenda__row${selectedEventId === event.id ? " mk-row--selected" : ""}${conflict ? " cal-agenda__row--conflict" : ""}`} onClick={() => onOpenEvent(event.id)}>
                    <span className="cal-agenda__time">{event.allDay ? t("calendar.allDay") : `${format.time(event.start)}–${format.time(event.end)}`}</span>
                    <span className="mk-row__main">
                      <span className="mk-row__title">{event.title}</span>
                      <span className="mk-row__meta">
                        {event.location ? (
                          <span className="cal-agenda__flag">
                            <MapPin size={12} strokeWidth={1.5} aria-hidden="true" /> {event.location}
                          </span>
                        ) : null}
                        {event.attendees.length > 0 ? (
                          <span className="cal-agenda__flag">
                            <Users size={12} strokeWidth={1.5} aria-hidden="true" /> {t("calendar.attendees.count", { count: event.attendees.length })}
                          </span>
                        ) : null}
                        {event.briefingId ? (
                          <span className="cal-agenda__flag">
                            <FileText size={12} strokeWidth={1.5} aria-hidden="true" /> {t("calendar.briefing.available")}
                          </span>
                        ) : null}
                      </span>
                    </span>
                    <span className="mk-row__side">
                      {conflict ? (
                        <StatusChip tone="red" icon={<AlertTriangle size={12} strokeWidth={1.75} aria-hidden="true" />}>
                          {t("calendar.conflict.marker")}
                        </StatusChip>
                      ) : null}
                      {event.status !== "confirmed" ? <StatusChip tone={STATUS_TONE[event.status]}>{t(statusKey(event.status))}</StatusChip> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
