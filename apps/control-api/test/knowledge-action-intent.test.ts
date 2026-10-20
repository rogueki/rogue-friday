import { describe, expect, it } from "vitest";
import { parseKnowledgeActionIntent } from "../src/services/knowledge-action-intent";

describe("knowledge action intents (German NL)", () => {
  it.each([
    ["Merke dir: Der Server läuft auf Port 3000", "Der Server läuft auf Port 3000"],
    ["Merke dir, der Termin ist morgen", "der Termin ist morgen"],
    ["Bitte merkt euch: Wasserstand prüfen", "Wasserstand prüfen"],
    ["Speichere im Gedächtnis: Recherche zu KI-Agents", "Recherche zu KI-Agents"],
    ["Erstelle einen Gedächtniseintrag: Lieblingsfarbe blau", "Lieblingsfarbe blau"],
    ["Lege einen Eintrag an: Projekt startet im Mai", "Projekt startet im Mai"],
  ])("parses a memory create: %s", (text, content) => {
    expect(parseKnowledgeActionIntent(text)).toEqual({ kind: "memory.create", content });
  });

  it.each([
    ["Aktualisiere den Gedächtniseintrag Server auf Port 8080", "Server", "Port 8080"],
    ["Bitte ändere den Eintrag Stromversorger zu Ecosia Energy", "Stromversorger", "Ecosia Energy"],
    ["Aktualisiere den Eintrag Reiseplan: Reise nach Rom geplant", "Reiseplan", "Reise nach Rom geplant"],
  ])("parses a memory update: %s", (text, ref, content) => {
    expect(parseKnowledgeActionIntent(text)).toEqual({ kind: "memory.update", ref, content });
  });

  it.each([
    ["Bestätige den Gedächtniseintrag Server", "Server"],
    ["Bitte bestätige den Eintrag Notizen", "Notizen"],
  ])("parses a memory confirm: %s", (text, ref) => {
    expect(parseKnowledgeActionIntent(text)).toEqual({ kind: "memory.confirm", ref });
  });

  it.each([
    ["Lösche den Gedächtniseintrag Testeintrag", "Testeintrag"],
    ["Vergiss den Eintrag Altes Passwort", "Altes Passwort"],
    ["Bitte löscht den Eintrag Entwurf 12", "Entwurf 12"],
  ])("parses a memory delete: %s", (text, ref) => {
    expect(parseKnowledgeActionIntent(text)).toEqual({ kind: "memory.delete", ref });
  });

  it.each([
    ["Benenne die Datei Bericht.md um in Quartalsbericht.md", "Bericht.md", "Quartalsbericht.md"],
    ["Bitte benenne die Datei notizen.txt in todo.txt um", "notizen.txt", "todo.txt"],
    ["Benenn die Datei „rohling.csv“ um in „import.csv“", "rohling.csv", "import.csv"],
  ])("parses a file rename: %s", (text, ref, name) => {
    expect(parseKnowledgeActionIntent(text)).toEqual({ kind: "file.rename", ref, name });
  });

  it.each([
    ["Lösche die Datei alt.md", "alt.md"],
    ["Bitte löscht die Datei Entwurf.txt", "Entwurf.txt"],
    ["Lösch die Datei „scan final.png“", "scan final.png"],
  ])("parses a file delete: %s", (text, ref) => {
    expect(parseKnowledgeActionIntent(text)).toEqual({ kind: "file.delete", ref });
  });

  it.each([
    "Was weißt du über den Server?",
    "Lies den Eintrag Server",
    "Erstelle eine Datei Bericht.md",
    "Lösche den Ordner Alt",
    "Merkwürdig ist das schon",
    "Lösche den Eintrag",
    "Vergiss es",
    "Benenne die Datei um",
    "Aktualisiere den Eintrag Server",
    "Der Gedächtniseintrag Server ist wichtig",
    "Öffne die Datei Bericht.md",
    "Erzähl mir etwas über den Gedächtniseintrag Server",
  ])("ignores non-actions and empty references: %s", (text) => {
    expect(parseKnowledgeActionIntent(text)).toBeNull();
  });
});
