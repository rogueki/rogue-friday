import { describe, expect, it } from "vitest";
import { derivedSubject, parseMailActionIntent } from "../src/services/mail-action-intent";

describe("parseMailActionIntent", () => {
  it.each([
    ["Schreibe eine Mail an erik@example.test dass das Meeting morgen entfällt",
      { kind: "mail.compose", recipient: "erik@example.test", subject: null, body: "das Meeting morgen entfällt" }],
    ["Schreib eine E-Mail an Frau Becker: die Unterlagen sind fertig",
      { kind: "mail.compose", recipient: "Frau Becker", subject: null, body: "die Unterlagen sind fertig" }],
    ["Schreibe eine Mail an Max mit dem Betreff Projektstatus: das Release ist fertig",
      { kind: "mail.compose", recipient: "Max", subject: "Projektstatus", body: "das Release ist fertig" }],
    ["Verfasse eine Nachricht an anna@example.test mit Betreff „Urlaub“: ich bin nächste Woche weg",
      { kind: "mail.compose", recipient: "anna@example.test", subject: "Urlaub", body: "ich bin nächste Woche weg" }],
    ["Sende eine Mail an anna@example.test dass ich morgen später komme",
      { kind: "mail.compose", recipient: "anna@example.test", subject: null, body: "ich morgen später komme" }],
    ["Schick eine E-Mail an support@example.test: der Fehler tritt weiterhin auf",
      { kind: "mail.compose", recipient: "support@example.test", subject: null, body: "der Fehler tritt weiterhin auf" }],
  ] as const)("parses compose: %s", (text, expected) => {
    expect(parseMailActionIntent(text)).toEqual(expected);
  });

  it.each([
    ["Antworte auf die Mail von becker@example.test dass ich dabei bin",
      { kind: "mail.reply", sender: "becker@example.test", body: "ich dabei bin" }],
    ["Antworte auf die letzte Mail von Frau Becker: einverstanden",
      { kind: "mail.reply", sender: "Frau Becker", body: "einverstanden" }],
    ["Antworte Frau Becker dass der Termin passt",
      { kind: "mail.reply", sender: "Frau Becker", body: "der Termin passt" }],
    ["Antworte ihr dass der Termin passt",
      { kind: "mail.reply", sender: null, body: "der Termin passt" }],
    ["Antworte dem Absender: ja, gerne",
      { kind: "mail.reply", sender: null, body: "ja, gerne" }],
  ] as const)("parses reply: %s", (text, expected) => {
    expect(parseMailActionIntent(text)).toEqual(expected);
  });

  it.each([
    "Sende eine E-Mail an Frau Becker",
    "Mail an Erik senden",
    "Antworte auf die Mail",
    "Antworte bitte",
    "Wann ist mein nächster Termin?",
    "Schreibe eine Mail an",
    "Zeig mir meine Mails",
  ])("ignores non-action phrasing: %s", (text) => {
    expect(parseMailActionIntent(text)).toBeNull();
  });
});

describe("derivedSubject", () => {
  it("uses the first squashed line and truncates at sixty characters", () => {
    expect(derivedSubject("Das Release Ist Fertig\nweitere Zeile")).toBe("das release ist fertig");
    expect(derivedSubject("Umlaute äöü ß")).toBe("umlaute aeoeue ss");
    expect(derivedSubject("x".repeat(80))).toBe(`${"x".repeat(57)}...`);
    expect(derivedSubject("   ")).toBe("Nachricht von Friday");
  });
});
