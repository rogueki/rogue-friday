"use client";

import type { CalendarEvent } from "@jarvis/sdk";
import { AlertTriangle } from "lucide-react";
import { useT } from "@/i18n";
import { useFormat } from "../memory/kit/hooks";
import { civilKey, monthGrid, sameDay, weekdayIndex, type Civil } from "./dates";
import { formatCivil } from "./labels";
import { eventsOnDay } from "./layout";

const MAX_CHIPS = 3;

export interface MonthGridProps {
  focus: Civil;
  today: Civil;
  events: readonly CalendarEvent[];
  conflictEventIds: ReadonlySet<string>;
  selectedEventId: string | null;
  onOpenEvent: (id: string) => void;
  onOpenDay: (civil: Civil) => void;
  label: string;
}

export function MonthGrid({ focus, today, events, conflictEventIds, selectedEventId, onOpenEvent, onOpenDay, label }: MonthGridProps) {
  const { t } = useT();
  const format = useFormat();
  const grid = monthGrid(focus);
  const weekdays = grid.slice(0, 7);
  return (
    <div className="cal-month" role="group" aria-label={label}>
      <div className="cal-month__weekdays" aria-hidden="true">
        {weekdays.map((day) => (
          <span key={weekdayIndex(day)}>{formatCivil(day, format.locale, { weekday: "short" })}</span>
        ))}
      </div>
      <div className="cal-month__cells">
        {grid.map((day) => {
          const dayEvents = eventsOnDay(events, day, format.timeZone);
          const outside = day.m !== focus.m;
          const isToday = sameDay(day, today);
          return (
            <div key={civilKey(day)} className={`cal-month__cell${outside ? " cal-month__cell--outside" : ""}${isToday ? " cal-month__cell--today" : ""}`}>
              <button type="button" className="cal-month__num" onClick={() => onOpenDay(day)} aria-label={formatCivil(day, format.locale, { weekday: "long", day: "numeric", month: "long" })} aria-current={isToday ? "date" : undefined}>
                {day.d}
              </button>
              <ul className="cal-month__events">
                {dayEvents.slice(0, MAX_CHIPS).map((event) => {
                  const conflict = conflictEventIds.has(event.id) || event.conflictIds.length > 0;
                  return (
                    <li key={event.id}>
                      <button type="button" className={`cal-chip cal-chip--${event.status}${conflict ? " cal-chip--conflict" : ""}${selectedEventId === event.id ? " cal-chip--selected" : ""}`} onClick={() => onOpenEvent(event.id)} title={event.title}>
                        {conflict ? <AlertTriangle size={10} strokeWidth={2} aria-label={t("calendar.conflict.marker")} /> : null}
                        {!event.allDay ? <span className="cal-chip__time">{format.time(event.start)}</span> : null}
                        <span className="cal-chip__title">{event.title}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {dayEvents.length > MAX_CHIPS ? (
                <button type="button" className="cal-month__more" onClick={() => onOpenDay(day)}>
                  {t("calendar.more", { count: dayEvents.length - MAX_CHIPS })}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
