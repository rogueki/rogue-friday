import { describe, expect, it } from "vitest";
import { localDayRange } from "./calendar-day-range";

describe("local day boundaries", () => {
  it("uses the zone's midnights, not a rolling 24 hour window", () => {
    const noon = Date.parse("2026-10-22T10:00:00.000Z"); // 12:00 in Berlin (CEST)
    expect(localDayRange(noon, "Europe/Berlin", 0)).toEqual({
      from: "2026-10-21T22:00:00.000Z",
      to: "2026-10-22T22:00:00.000Z",
    });
    expect(localDayRange(noon, "Europe/Berlin", 1)).toEqual({
      from: "2026-10-22T22:00:00.000Z",
      to: "2026-10-23T22:00:00.000Z",
    });
  });

  it("keeps 23 and 25 hour days correct across the DST switch", () => {
    // 2026-03-29 is the spring change (CET -> CEST): that day has 23 hours.
    const spring = localDayRange(Date.parse("2026-03-29T10:00:00.000Z"), "Europe/Berlin", 0);
    expect((Date.parse(spring!.to) - Date.parse(spring!.from)) / 3_600_000).toBe(23);
    // 2026-10-25 is the autumn change (CEST -> CET): 25 hours.
    const autumn = localDayRange(Date.parse("2026-10-25T10:00:00.000Z"), "Europe/Berlin", 0);
    expect((Date.parse(autumn!.to) - Date.parse(autumn!.from)) / 3_600_000).toBe(25);
  });

  it("refuses a missing or unusable zone instead of guessing", () => {
    const noon = Date.parse("2026-10-22T10:00:00.000Z");
    expect(localDayRange(noon, undefined, 0)).toBeNull();
    expect(localDayRange(noon, "Nicht/Existiert", 0)).toBeNull();
    expect(localDayRange(noon, "Europe/Berlin", 2)).toBeNull();
  });
});