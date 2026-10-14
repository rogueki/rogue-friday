import { describe, expect, it } from "vitest";
import { addDays, addMonths, civilKey, civilOf, fromLocalInput, instantOf, isoWeek, minutesOfDay, monthGrid, parseCivilKey, startOfWeek, toLocalInput, tzOffsetMinutes, weekdayIndex } from "./dates";

const BERLIN = "Europe/Berlin";

describe("time zone arithmetic", () => {
  it("knows the Berlin offset in summer and winter time", () => {
    expect(tzOffsetMinutes(new Date("2026-07-01T12:00:00Z"), BERLIN)).toBe(120);
    expect(tzOffsetMinutes(new Date("2026-12-01T12:00:00Z"), BERLIN)).toBe(60);
    expect(tzOffsetMinutes(new Date("2026-07-01T12:00:00Z"), "America/New_York")).toBe(-240);
  });

  it("derives the local civil day and minute of day", () => {
    const instant = new Date("2026-10-14T22:30:00Z");
    expect(civilKey(civilOf(instant, BERLIN))).toBe("2026-10-15");
    expect(minutesOfDay(instant, BERLIN)).toBe(30);
    expect(civilKey(civilOf(instant, "UTC"))).toBe("2026-10-14");
  });

  it("converts local wall time to the right instant across the DST change", () => {
    expect(instantOf({ y: 2026, m: 10, d: 14 }, 9 * 60, BERLIN).toISOString()).toBe("2026-10-14T07:00:00.000Z");
    // CET starts on 2026-10-25: midnight local is still UTC+2, noon is UTC+1.
    expect(instantOf({ y: 2026, m: 10, d: 25 }, 0, BERLIN).toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(instantOf({ y: 2026, m: 10, d: 25 }, 12 * 60, BERLIN).toISOString()).toBe("2026-10-25T11:00:00.000Z");
    // The day of the change has 25 hours.
    const next = instantOf({ y: 2026, m: 10, d: 26 }, 0, BERLIN).getTime();
    expect((next - instantOf({ y: 2026, m: 10, d: 25 }, 0, BERLIN).getTime()) / 3_600_000).toBe(25);
  });

  it("round-trips datetime-local values", () => {
    const instant = fromLocalInput("2026-10-14T09:30", BERLIN);
    expect(instant?.toISOString()).toBe("2026-10-14T07:30:00.000Z");
    expect(toLocalInput(instant as Date, BERLIN)).toBe("2026-10-14T09:30");
    expect(fromLocalInput("nonsense", BERLIN)).toBeNull();
  });
});

describe("civil dates", () => {
  it("validates keys", () => {
    expect(parseCivilKey("2026-02-30")).toBeNull();
    expect(parseCivilKey("2026-10-14")).toEqual({ y: 2026, m: 10, d: 14 });
  });

  it("computes weeks (Monday first), months and ISO weeks", () => {
    const wednesday = { y: 2026, m: 10, d: 14 };
    expect(weekdayIndex(wednesday)).toBe(2);
    expect(civilKey(startOfWeek(wednesday))).toBe("2026-10-12");
    expect(civilKey(addDays(wednesday, 20))).toBe("2026-11-03");
    expect(civilKey(addMonths({ y: 2026, m: 1, d: 31 }, 1))).toBe("2026-02-28");
    expect(isoWeek(wednesday)).toBe(42);
    expect(isoWeek({ y: 2026, m: 1, d: 1 })).toBe(1);
    const grid = monthGrid(wednesday);
    expect(grid).toHaveLength(42);
    expect(civilKey(grid[0] as never)).toBe("2026-09-28");
  });
});
