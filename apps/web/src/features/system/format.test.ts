import { describe, expect, it } from "vitest";
import { formatBytes, formatCurrencyEur, formatFraction, formatMs, formatPercent, formatRate, formatRuntime, formatTemperature, MISSING } from "./format";
import { slugify } from "./download";

describe("format helpers never invent values", () => {
  it("renders null/undefined/NaN as the missing marker", () => {
    for (const value of [null, undefined, Number.NaN]) {
      expect(formatBytes(value)).toBe(MISSING);
      expect(formatRate(value)).toBe(MISSING);
      expect(formatMs(value)).toBe(MISSING);
      expect(formatPercent(value)).toBe(MISSING);
      expect(formatTemperature(value)).toBe(MISSING);
      expect(formatRuntime(value)).toBe(MISSING);
      expect(formatCurrencyEur(value)).toBe(MISSING);
      expect(formatFraction(value)).toBe(MISSING);
    }
  });

  it("formats real values", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1,5 KB");
    expect(formatBytes(5 * 1024 ** 3, "en")).toBe("5 GB");
    expect(formatRate(2048)).toBe("2 KB/s");
    expect(formatMs(28)).toBe("28 ms");
    expect(formatPercent(54.4)).toBe("54 %");
    expect(formatFraction(0.876)).toBe("88 %");
    expect(formatRuntime(3_900_000)).toBe("1 Std. 05 Min.");
    expect(formatRuntime(75_000)).toBe("1 Min. 15 Sek.");
    expect(formatTemperature(56.4)).toBe("56 °C");
    expect(formatCurrencyEur(0.62)).toMatch(/0,62\s?€/);
  });

  it("builds safe export file names", () => {
    expect(slugify("Büromöbel-Anbieter in Hannover!")).toBe("bueromoebel-anbieter-in-hannover");
    expect(slugify("***")).toBe("export");
  });
});
