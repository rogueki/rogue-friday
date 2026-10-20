import { describe, expect, it } from "vitest";
import { parseMessengerActionIntent } from "../src/services/messenger-action-intent";

describe("parseMessengerActionIntent", () => {
  it.each([
    ["Schreib Anna über Telegram dass das Release fertig ist",
      { kind: "messenger.send", platform: "telegram", recipient: "Anna", text: "das Release fertig ist" }],
    ["Schreibe eine Nachricht an 12345678 über Telegram: der Build ist grün",
      { kind: "messenger.send", platform: "telegram", recipient: "12345678", text: "der Build ist grün" }],
    ["Schick eine Nachricht an C0123ABCDEF über Slack dass der Termin passt",
      { kind: "messenger.send", platform: "slack", recipient: "C0123ABCDEF", text: "der Termin passt" }],
    ["Sende +491701234567 über WhatsApp dass ich später komme",
      { kind: "messenger.send", platform: "whatsapp", recipient: "+491701234567", text: "ich später komme" }],
    ["Schick eine Telegram-Nachricht an 12345678: kurze Info",
      { kind: "messenger.send", platform: "telegram", recipient: "12345678", text: "kurze Info" }],
    ["Schreibe eine WhatsApp Nachricht dass ich da bin",
      { kind: "messenger.send", platform: "whatsapp", recipient: null, text: "ich da bin" }],
    ["Bitte schreib den Kanal #alerts über IRC dass neu gestartet wird",
      { kind: "messenger.send", platform: "irc", recipient: "#alerts", text: "neu gestartet wird" }],
  ] as const)("parses compose: %s", (text, expected) => {
    expect(parseMessengerActionIntent(text)).toEqual(expected);
  });

  it.each([
    ["Antworte auf die letzte Telegram-Nachricht dass ich dabei bin",
      { kind: "messenger.reply", platform: "telegram", text: "ich dabei bin" }],
    ["Antworte auf ihre letzte WhatsApp-Nachricht: einverstanden",
      { kind: "messenger.reply", platform: "whatsapp", text: "einverstanden" }],
    ["Antworte auf die Nachricht dass alles passt",
      { kind: "messenger.reply", platform: null, text: "alles passt" }],
    ["Antworte ihr über Signal dass der Vertrag da ist",
      { kind: "messenger.reply", platform: "signal", text: "der Vertrag da ist" }],
    ["Antworte über SMS: ja",
      { kind: "messenger.reply", platform: "sms", text: "ja" }],
  ] as const)("parses reply: %s", (text, expected) => {
    expect(parseMessengerActionIntent(text)).toEqual(expected);
  });

  it.each([
    "Schreib Anna dass das Release fertig ist",
    "Schreib eine E-Mail an anna@example.test dass der Termin passt",
    "Antworte auf die letzte Mail von Frau Becker dass ich dabei bin",
    "Zeig mir die registrierten Messenger-Empfänger",
    "Schick eine Nachricht über Telegram",
    "Antworte über Telegram",
    "Was ist los?",
  ])("ignores non-action phrasing: %s", (text) => {
    expect(parseMessengerActionIntent(text)).toBeNull();
  });
});
