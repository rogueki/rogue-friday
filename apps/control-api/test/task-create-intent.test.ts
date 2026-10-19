import { describe, expect, it } from "vitest";
import { parseTaskCreateIntent } from "../src/services/task-create-intent";

describe("task creation language", () => {
  const phrasings = [
    "Neue Aufgabe: Quartalsbericht pruefen",
    "Erstelle eine Aufgabe: Quartalsbericht pruefen",
    "Bitte erzeuge eine neue Aufgabe für Quartalsbericht pruefen",
    "Leg mir eine Aufgabe an namens Quartalsbericht pruefen",
    "Notiere Quartalsbericht pruefen als Aufgabe",
    "Trage Quartalsbericht pruefen als neue Aufgabe ein",
    "Füge Quartalsbericht pruefen zur Aufgabenliste hinzu",
    "Pack Quartalsbericht pruefen auf die Aufgabenliste",
    "Create a task called Quartalsbericht pruefen",
    "Add new task for Quartalsbericht pruefen",
  ];
  for (const phrase of phrasings) {
    it(`recognizes ${phrase}`, () => {
      expect(parseTaskCreateIntent(phrase)).toEqual({ title: "Quartalsbericht pruefen", priority: "P2" });
    });
  }
  it("keeps the exact task title and explicit priority", () => {
    expect(parseTaskCreateIntent("Neue Aufgabe (P0): Bericht: Kapitel 2 pruefen"))
      .toEqual({ title: "Bericht: Kapitel 2 pruefen", priority: "P0" });
  });
  it.each(["Zeige mir die Aufgabenliste: heute", "Was bedeutet neue Aufgabe: morgen?", "Neue Aufgabe:",
    "Erstelle eine Aufgabe ohne Titel", "Notiere das als Aufgabe", "Neue Aufgabe: " + "x".repeat(301)])("does not infer a write from %s", (phrase) => {
    expect(parseTaskCreateIntent(phrase)).toBeNull();
  });
});
