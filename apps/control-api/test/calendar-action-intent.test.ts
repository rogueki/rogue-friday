import { describe, expect, it } from "vitest";
import { parseCalendarActionIntent, type CalendarActionIntent } from "../src/services/calendar-action-intent";

// Monday 2026-10-19 10:00 Europe/Berlin (CEST, UTC+2); DST ends 2026-10-25.
const NOW = Date.parse("2026-10-19T08:00:00.000Z");
const ZONE = "Europe/Berlin";
const EVENT_ID = `cal_${"C".repeat(26)}`;

const parse = (text: string) => parseCalendarActionIntent(text, NOW, ZONE);

describe("calendar create language", () => {
  const phrasings: Array<[string, CalendarActionIntent]> = [
    ["Trage Zahnarzt morgen 14 Uhr ein",
      { kind: "calendar.create", title: "Zahnarzt", start: "2026-10-20T12:00:00.000Z", end: "2026-10-20T13:00:00.000Z", timeZone: ZONE }],
    ["Trag mir einen Termin Quartalsplanung am Mittwoch 9:30 ein",
      { kind: "calendar.create", title: "Quartalsplanung", start: "2026-10-21T07:30:00.000Z", end: "2026-10-21T08:30:00.000Z", timeZone: ZONE }],
    ["Plane Teamsync für nächsten Dienstag 15 Uhr",
      { kind: "calendar.create", title: "Teamsync", start: "2026-10-27T14:00:00.000Z", end: "2026-10-27T15:00:00.000Z", timeZone: ZONE }],
    ["Bitte erstelle einen Termin Sprintreview am Freitag 10 Uhr",
      { kind: "calendar.create", title: "Sprintreview", start: "2026-10-23T08:00:00.000Z", end: "2026-10-23T09:00:00.000Z", timeZone: ZONE }],
    ["Lege einen Termin Release-Call übermorgen 8 Uhr an",
      { kind: "calendar.create", title: "Release-Call", start: "2026-10-21T06:00:00.000Z", end: "2026-10-21T07:00:00.000Z", timeZone: ZONE }],
    ["Neuer Termin: Anruf Steuerberater am 21.10.2026 um 13:45 Uhr",
      { kind: "calendar.create", title: "Anruf Steuerberater", start: "2026-10-21T11:45:00.000Z", end: "2026-10-21T12:45:00.000Z", timeZone: ZONE }],
  ];
  for (const [phrase, expected] of phrasings) {
    it(`recognizes ${phrase}`, () => {
      expect(parse(phrase)).toEqual(expected);
    });
  }
});

describe("calendar move language", () => {
  const phrasings: Array<[string, CalendarActionIntent]> = [
    ["Verschieb den Termin Zahnarzt auf Freitag 10 Uhr",
      { kind: "calendar.update", ref: "Zahnarzt", start: "2026-10-23T08:00:00.000Z" }],
    ["Verschiebe die Besprechung Quartalsreview auf übermorgen 16 Uhr",
      { kind: "calendar.update", ref: "Quartalsreview", start: "2026-10-21T14:00:00.000Z" }],
    ["Bitte verlege den Termin auf morgen 7 Uhr",
      { kind: "calendar.update", ref: null, start: "2026-10-20T05:00:00.000Z" }],
    [`Verschieb den Termin ${EVENT_ID} auf Montag 11 Uhr`,
      { kind: "calendar.update", ref: EVENT_ID, start: "2026-10-19T09:00:00.000Z" }],
  ];
  for (const [phrase, expected] of phrasings) {
    it(`recognizes ${phrase}`, () => {
      expect(parse(phrase)).toEqual(expected);
    });
  }
});

describe("calendar delete language", () => {
  const phrasings: Array<[string, CalendarActionIntent]> = [
    ["Lösche den Termin Zahnarzt", { kind: "calendar.delete", ref: "Zahnarzt" }],
    ["Bitte entferne die Besprechung Daily", { kind: "calendar.delete", ref: "Daily" }],
    ["Sag den Termin Arzt ab", { kind: "calendar.delete", ref: "Arzt" }],
    [`Loesche das Meeting ${EVENT_ID}`, { kind: "calendar.delete", ref: EVENT_ID }],
    ["Lösche den Termin", { kind: "calendar.delete", ref: null }],
    ["Streiche meinen Termin", { kind: "calendar.delete", ref: null }],
  ];
  for (const [phrase, expected] of phrasings) {
    it(`recognizes ${phrase}`, () => {
      expect(parse(phrase)).toEqual(expected);
    });
  }
});

describe("calendar follow-ups to a listing", () => {
  const phrasings: Array<[string, CalendarActionIntent]> = [
    ["Verschiebe den zweiten auf morgen 16 Uhr",
      { kind: "calendar.update", ref: null, start: "2026-10-20T14:00:00.000Z", listed: { ordinal: 1 } }],
    ["Verlege ihn auf Mittwoch 9:30",
      { kind: "calendar.update", ref: null, start: "2026-10-21T07:30:00.000Z", listed: { ordinal: null } }],
    ["Lösche den ersten Termin", { kind: "calendar.delete", ref: null, listed: { ordinal: 0 } }],
    ["Sag ihn ab", { kind: "calendar.delete", ref: null, listed: { ordinal: null } }],
    ["Bitte streiche den fünften", { kind: "calendar.delete", ref: null, listed: { ordinal: 4 } }],
  ];
  for (const [phrase, expected] of phrasings) {
    it(`recognizes ${phrase}`, () => {
      expect(parse(phrase)).toEqual(expected);
    });
  }

  it.each(["Verschiebe ihn auf später", "Lösche sie", "Lösche es", "Lösche den siebten", "Sag den Urlaub ab"])(
    "does not read %s as a listed event", (phrase) => {
      expect(parse(phrase)).toBeNull();
    });
});

describe("calendar language negatives", () => {
  it.each([
    "Zeige mir die Termine nächste Woche",
    "Was steht morgen im Kalender?",
    "Lösche die Aufgabe Quartalsbericht",
    "Neue Aufgabe: Quartalsbericht erledigen",
    "Trage Zahnarzt als Aufgabe ein",
    "Trage Zahnarzt morgen ein",
    "Trage Frühstück heute 8 Uhr ein",
    "Verschieb den Termin auf irgendwann",
    "Verschieb den Termin Zahnarzt auf Freitag",
    "Lösche den Termin das",
    "Erstelle einen Termin",
    "Plane den Urlaub",
  ])("does not infer a write from %s", (phrase) => {
    expect(parse(phrase)).toBeNull();
  });
});
