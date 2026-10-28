import { describe, expect, it } from "vitest";
import { parseReadQueryIntent } from "./read-query-intent";

describe("spoken calendar reads", () => {
  it("maps today and tomorrow to a civil day, never to a rolling window", () => {
    expect(parseReadQueryIntent("Zeige meine Termine heute")).toEqual({ kind: "calendar.list", dayOffset: 0 });
    expect(parseReadQueryIntent("zeig termine fuer morgen")).toEqual({ kind: "calendar.list", dayOffset: 1 });
    expect(parseReadQueryIntent("welche termine habe ich heute im kalender")).toEqual({ kind: "calendar.list", dayOffset: 0 });
  });

  it("asks for a day instead of inventing a period", () => {
    expect(parseReadQueryIntent("zeige meine termine")).toMatchObject({ kind: "clarify" });
  });

  it("names the periods it does not support yet", () => {
    expect(parseReadQueryIntent("zeige termine diese woche")).toMatchObject({ kind: "clarify" });
    expect(parseReadQueryIntent("zeige termine uebermorgen")).toMatchObject({ kind: "clarify" });
    expect(parseReadQueryIntent("zeige termine morgen um 14 uhr")).toMatchObject({ kind: "clarify" });
  });

  it("keeps scheduling commands out of the read path", () => {
    expect(parseReadQueryIntent("trage zahnarzt morgen um 14 uhr ein")).toBeNull();
    expect(parseReadQueryIntent("verschiebe den termin auf morgen")).toBeNull();
    expect(parseReadQueryIntent("zeige termine heute und loesche den ersten")).toMatchObject({ kind: "clarify" });
  });
});