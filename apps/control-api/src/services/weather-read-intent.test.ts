import { describe, expect, it } from "vitest";
import { weatherDescription } from "./location-weather";
import { parseReadQueryIntent } from "./read-query-intent";

describe("weather read intent", () => {
  it.each(["wie ist das wetter", "wie ist das wetter draussen", "was sagt das wetter in meiner stadt", "welche temperatur haben wir"])(
    "%s -> weather.current", (text) => {
      expect(parseReadQueryIntent(text)).toEqual({ kind: "weather.current" });
    });

  it.each([
    ["wie wird das wetter morgen", "keine Vorhersage"],
    ["wie ist das wetter in hamburg", "gespeicherten Standort"],
    ["zeige das wetter und setze den standort auf hamburg", "Einstellungen"],
    ["zeige wetter und aufgaben", "zwei Bereiche"],
  ])("%s -> clarify", (text, part) => {
    const intent = parseReadQueryIntent(text);
    expect(intent?.kind).toBe("clarify");
    expect(intent && "message" in intent ? intent.message : "").toContain(part);
  });

  it("does not take the CPU temperature for the weather", () => {
    expect(parseReadQueryIntent("wie hoch ist die cpu temperatur")?.kind).toBe("system.metrics");
  });

  it("names every WMO group and does not guess unknown codes", () => {
    expect(weatherDescription(0)).toBe("klar");
    expect(weatherDescription(2)).toBe("teilweise bewölkt");
    expect(weatherDescription(63)).toBe("Regen");
    expect(weatherDescription(95)).toBe("Gewitter");
    expect(weatherDescription(42)).toBe("Wettercode 42");
  });
});
