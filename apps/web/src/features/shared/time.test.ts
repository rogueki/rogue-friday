import { describe, expect, it } from "vitest";
import { formatDatePattern, formatDateTimePattern } from "./time";

describe("configured date formats", () => {
  const instant = new Date("2026-12-31T23:30:00Z");

  it.each([
    ["dd.MM.yyyy", "01.01.2027"],
    ["yyyy-MM-dd", "2027-01-01"],
    ["MM/dd/yyyy", "01/01/2027"],
  ] as const)("formats %s in the configured time zone", (pattern, expected) => {
    expect(formatDatePattern(instant, pattern, "Europe/Berlin")).toBe(expected);
    expect(formatDateTimePattern(instant, pattern, { locale: "de-DE", timeZone: "Europe/Berlin", hour12: false })).toContain(`${expected},`);
  });
});
