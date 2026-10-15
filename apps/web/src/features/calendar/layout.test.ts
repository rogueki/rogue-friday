import type { CalendarEvent } from "@friday/sdk";
import { describe, expect, it } from "vitest";
import { NOW, resource } from "../memory/kit/testSupport";
import { allDayCovers, clipToDay, eventsOnDay, freeSlots, layoutDay } from "./layout";

const BERLIN = "Europe/Berlin";
const DAY = { y: 2026, m: 10, d: 14 };

function event(id: string, start: string, end: string, partial: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    ...resource(`cal_${id.padEnd(26, "A")}`),
    title: id,
    start,
    end,
    allDay: false,
    timeZone: BERLIN,
    attendees: [],
    status: "confirmed",
    reminderMinutes: [],
    linkedTaskIds: [],
    linkedThreadIds: [],
    conflictIds: [],
    briefingId: null,
    ...partial,
  };
}

describe("day layout", () => {
  it("places overlapping events in side-by-side columns", () => {
    // 09:00-10:00 and 09:30-10:30 Berlin time (UTC+2)
    const a = event("a", "2026-10-14T07:00:00Z", "2026-10-14T08:00:00Z");
    const b = event("b", "2026-10-14T07:30:00Z", "2026-10-14T08:30:00Z");
    const c = event("c", "2026-10-14T09:00:00Z", "2026-10-14T09:30:00Z");
    const { timed } = layoutDay([c, b, a], DAY, BERLIN);
    const byTitle = Object.fromEntries(timed.map((item) => [item.event.title, item]));
    expect(byTitle["a"]).toMatchObject({ startMin: 540, endMin: 600, column: 0, columns: 2 });
    expect(byTitle["b"]).toMatchObject({ startMin: 570, endMin: 630, column: 1, columns: 2 });
    expect(byTitle["c"]).toMatchObject({ startMin: 660, column: 0, columns: 1 });
  });

  it("clips events that cross midnight to the local day and ignores other days", () => {
    const night = event("n", "2026-10-14T20:00:00Z", "2026-10-15T01:00:00Z"); // 22:00 - 03:00 Berlin
    expect(clipToDay(night, DAY, BERLIN)).toEqual({ startMin: 22 * 60, endMin: 24 * 60 });
    expect(clipToDay(night, { y: 2026, m: 10, d: 15 }, BERLIN)).toEqual({ startMin: 0, endMin: 3 * 60 });
    expect(clipToDay(night, { y: 2026, m: 10, d: 13 }, BERLIN)).toBeNull();
  });

  it("keeps all-day events apart and covers their dates [start, end)", () => {
    const trip = event("t", "2026-10-13T00:00:00Z", "2026-10-15T00:00:00Z", { allDay: true });
    expect(allDayCovers(trip, { y: 2026, m: 10, d: 13 })).toBe(true);
    expect(allDayCovers(trip, { y: 2026, m: 10, d: 14 })).toBe(true);
    expect(allDayCovers(trip, { y: 2026, m: 10, d: 15 })).toBe(false);
    const { timed, allDay } = layoutDay([trip], DAY, BERLIN);
    expect(timed).toHaveLength(0);
    expect(allDay).toHaveLength(1);
  });

  it("orders a day's events with all-day first", () => {
    const trip = event("t", "2026-10-14T00:00:00Z", "2026-10-15T00:00:00Z", { allDay: true });
    const late = event("late", "2026-10-14T13:00:00Z", "2026-10-14T14:00:00Z");
    const early = event("early", "2026-10-14T06:00:00Z", "2026-10-14T07:00:00Z");
    expect(eventsOnDay([late, early, trip], DAY, BERLIN).map((item) => item.title)).toEqual(["t", "early", "late"]);
  });
});

describe("free time", () => {
  it("returns gaps of at least 30 minutes inside working hours", () => {
    const meeting = event("m", "2026-10-14T07:00:00Z", "2026-10-14T08:30:00Z"); // 09:00-10:30
    const lunch = event("l", "2026-10-14T10:00:00Z", "2026-10-14T10:20:00Z"); // 12:00-12:20 (not blocking a 30 min gap alone)
    expect(freeSlots([meeting, lunch], DAY, BERLIN)).toEqual([
      { startMin: 480, endMin: 540 },
      { startMin: 630, endMin: 720 },
      { startMin: 740, endMin: 1080 },
    ]);
  });

  it("ignores cancelled and all-day events and merges overlapping blocks", () => {
    const cancelled = event("c", "2026-10-14T06:00:00Z", "2026-10-14T16:00:00Z", { status: "cancelled" });
    const allDay = event("a", "2026-10-14T00:00:00Z", "2026-10-15T00:00:00Z", { allDay: true });
    expect(freeSlots([cancelled, allDay], DAY, BERLIN)).toEqual([{ startMin: 480, endMin: 1080 }]);
    const one = event("o", "2026-10-14T07:00:00Z", "2026-10-14T09:00:00Z"); // 09-11
    const two = event("t", "2026-10-14T08:00:00Z", "2026-10-14T10:00:00Z"); // 10-12
    expect(freeSlots([one, two], DAY, BERLIN)).toEqual([
      { startMin: 480, endMin: 540 },
      { startMin: 720, endMin: 1080 },
    ]);
  });

  it("is empty when the day is fully booked", () => {
    const all = event("x", "2026-10-14T05:00:00Z", "2026-10-14T17:00:00Z");
    expect(freeSlots([all], DAY, BERLIN)).toEqual([]);
  });
});

void NOW;
