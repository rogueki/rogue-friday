import { describe, expect, it } from "vitest";
import { parseAutomationActionIntent } from "../src/services/automation-action-intent";

describe("automation action intents (German NL)", () => {
  it.each([
    ["Aktiviere die Automation Rechnungscheck", "Rechnungscheck"],
    ["Bitte aktiviert die Automation Nachtlauf", "Nachtlauf"],
    ["Schalte die Automation Backup ein", "Backup"],
  ])("parses an enable: %s", (text, ref) => {
    expect(parseAutomationActionIntent(text)).toEqual({ kind: "automation.enable", ref });
  });

  it.each([
    ["Deaktiviere die Automation Rechnungscheck", "Rechnungscheck"],
    ["Bitte deaktiviert die Automation Nachtlauf", "Nachtlauf"],
    ["Schalte die Automation Backup ab", "Backup"],
  ])("parses a disable: %s", (text, ref) => {
    expect(parseAutomationActionIntent(text)).toEqual({ kind: "automation.disable", ref });
  });

  it.each([
    ["Pausiere die Automation Rechnungscheck", "Rechnungscheck"],
    ["Halte die Automation Nachtlauf an", "Nachtlauf"],
    ["Leg die Automation Backup still", "Backup"],
  ])("parses a pause: %s", (text, ref) => {
    expect(parseAutomationActionIntent(text)).toEqual({ kind: "automation.pause", ref });
  });

  it.each([
    ["Setz die Automation Rechnungscheck fort", "Rechnungscheck"],
    ["Bitte setzt die Automation Nachtlauf fort", "Nachtlauf"],
    ["Lass die Automation Backup weiterlaufen", "Backup"],
  ])("parses a resume: %s", (text, ref) => {
    expect(parseAutomationActionIntent(text)).toEqual({ kind: "automation.resume", ref });
  });

  it.each([
    ["Teste die Automation Rechnungscheck", "Rechnungscheck"],
    ["Bitte testet die Automation Nachtlauf", "Nachtlauf"],
    ["Probiere die Automation Backup aus", "Backup"],
  ])("parses a test: %s", (text, ref) => {
    expect(parseAutomationActionIntent(text)).toEqual({ kind: "automation.test", ref });
  });

  it.each([
    ["Pausiere alle Automationen"],
    ["Bitte haltet alle Automationen an"],
    ["Legt alle Automationen still"],
    ["Stoppe alle Automationen"],
  ])("parses a pause-all: %s", (text) => {
    expect(parseAutomationActionIntent(text)).toEqual({ kind: "automation.pauseAll" });
  });

  it.each([
    "Was macht die Automation Rechnungscheck?",
    "Erstelle eine Automation Backup",
    "Aktiviere den Recherche-Agenten",
    "Pausiere die Musik",
    "Aktiviere die Automation",
    "Teste die Automation",
    "Setz die Automation fort",
    "Alle Automationen anzeigen",
    "Der Automation Rechnungscheck läuft gerade",
  ])("ignores non-actions and empty references: %s", (text) => {
    expect(parseAutomationActionIntent(text)).toBeNull();
  });
});
