"use client";

import type { CalendarEvent } from "@friday/sdk";
import { AlertTriangle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n";
import { useFormat } from "../memory/kit/hooks";
import { civilKey, clock, minutesOfDay, sameDay, type Civil } from "./dates";
import { formatCivil } from "./labels";
import { freeSlots, layoutDay } from "./layout";

export const HOUR_HEIGHT = 48;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

export interface TimeGridProps {
  days: readonly Civil[];
  today: Civil;
  now: Date;
  events: readonly CalendarEvent[];
  conflictEventIds: ReadonlySet<string>;
  selectedEventId: string | null;
  onOpenEvent: (id: string) => void;
  onOpenDay: (civil: Civil) => void;
  /** Day view: shade the free working-hour slots. */
  showFree?: boolean;
  label: string;
}

/** Day and week view: one time-scaled column per day, overlapping events side by side, all-day strip on top, "now" line. */
export function TimeGrid({ days, today, now, events, conflictEventIds, selectedEventId, onOpenEvent, onOpenDay, showFree, label }: TimeGridProps) {
  const { t } = useT();
  const format = useFormat();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(false);
  const layouts = days.map((day) => ({ day, ...layoutDay(events, day, format.timeZone) }));
  const hasAllDay = layouts.some((entry) => entry.allDay.length > 0);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = Math.max(0, (7 * 60 - 30) * (HOUR_HEIGHT / 60));
  }, [days.length]);

  // A scrollable region must be reachable by keyboard (axe: scrollable-region-focusable); not focusable when it does not scroll.
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return undefined;
    const measure = (): void => setScrollable(node.scrollHeight > node.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [days.length]);

  const columns = `56px repeat(${days.length}, minmax(0, 1fr))`;
  return (
    <div className="cal-grid" role="group" aria-label={label} data-days={days.length}>
      <div className="cal-grid__inner" style={{ minWidth: 56 + days.length * (days.length === 1 ? 240 : 104) }}>
        <div className="cal-grid__head" style={{ gridTemplateColumns: columns }}>
          <span />
          {days.map((day) => {
            const isToday = sameDay(day, today);
            return (
              <button key={civilKey(day)} type="button" className={`cal-grid__dayhead${isToday ? " cal-grid__dayhead--today" : ""}`} aria-current={isToday ? "date" : undefined} onClick={() => onOpenDay(day)}>
                <span className="cal-grid__weekday">{formatCivil(day, format.locale, { weekday: "short" })}</span>
                <span className="cal-grid__daynum">{formatCivil(day, format.locale, { day: "numeric", month: days.length === 1 ? "long" : "short" })}</span>
              </button>
            );
          })}
        </div>
        {hasAllDay ? (
          <div className="cal-grid__allday" style={{ gridTemplateColumns: columns }}>
            <span className="cal-grid__alldaylabel">{t("calendar.allDay")}</span>
            {layouts.map(({ day, allDay }) => (
              <div key={civilKey(day)} className="cal-grid__allcell">
                {allDay.map((event) => (
                  <button key={event.id} type="button" className={`cal-chip cal-chip--allday${selectedEventId === event.id ? " cal-chip--selected" : ""}`} onClick={() => onOpenEvent(event.id)}>
                    {event.title}
                  </button>
                ))}
              </div>
            ))}
          </div>
        ) : null}
        <div className="cal-grid__scroll" ref={scrollRef} {...(scrollable ? { tabIndex: 0, role: "region", "aria-label": `${label}: ${t("calendar.grid.scroll")}` } : {})}>
          <div className="cal-grid__body" style={{ gridTemplateColumns: columns, height: HOUR_HEIGHT * 24 }}>
            <div className="cal-grid__hours" aria-hidden="true">
              {HOURS.map((hour) => (
                <span key={hour} className="cal-grid__hour" style={{ top: hour * HOUR_HEIGHT }}>
                  {hour === 0 ? "" : clock(hour * 60)}
                </span>
              ))}
            </div>
            {layouts.map(({ day, timed }) => {
              const isToday = sameDay(day, today);
              const free = showFree ? freeSlots(events, day, format.timeZone) : [];
              return (
                <div key={civilKey(day)} className={`cal-grid__col${isToday ? " cal-grid__col--today" : ""}`} role="list" aria-label={formatCivil(day, format.locale, { weekday: "long", day: "numeric", month: "long" })}>
                  {free.map((slot) => (
                    <div key={slot.startMin} className="cal-free" aria-hidden="true" style={{ top: (slot.startMin / 60) * HOUR_HEIGHT, height: ((slot.endMin - slot.startMin) / 60) * HOUR_HEIGHT }}>
                      <span>{t("calendar.free.slot", { from: clock(slot.startMin), to: clock(slot.endMin) })}</span>
                    </div>
                  ))}
                  {timed.map(({ event, startMin, endMin, column, columns: count }) => {
                    const conflict = conflictEventIds.has(event.id) || event.conflictIds.length > 0;
                    const height = Math.max(20, ((endMin - startMin) / 60) * HOUR_HEIGHT - 2);
                    return (
                      <div
                        key={event.id}
                        role="listitem"
                        className="cal-event-slot"
                        style={{ top: (startMin / 60) * HOUR_HEIGHT, height, left: `calc(${(column / count) * 100}% + 1px)`, width: `calc(${100 / count}% - 3px)` }}
                      >
                        <button
                          type="button"
                          className={`cal-event cal-event--${event.status}${conflict ? " cal-event--conflict" : ""}${selectedEventId === event.id ? " cal-event--selected" : ""}${height < 38 ? " cal-event--short" : ""}`}
                          onClick={() => onOpenEvent(event.id)}
                          title={`${event.title} · ${format.time(event.start)}–${format.time(event.end)}`}
                        >
                          <span className="cal-event__time">
                            {conflict ? <AlertTriangle size={11} strokeWidth={2} aria-label={t("calendar.conflict.marker")} /> : null}
                            {format.time(event.start)}–{format.time(event.end)}
                          </span>
                          <span className="cal-event__title">{event.title}</span>
                          {height > 52 && event.location ? <span className="cal-event__loc">{event.location}</span> : null}
                        </button>
                      </div>
                    );
                  })}
                  {isToday ? <NowLine now={now} timeZone={format.timeZone} /> : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function NowLine({ now, timeZone }: { now: Date; timeZone: string | undefined }) {
  const minutes = minutesOfDay(now, timeZone);
  return <div className="cal-now" aria-hidden="true" style={{ top: (minutes / 60) * HOUR_HEIGHT }} />;
}
