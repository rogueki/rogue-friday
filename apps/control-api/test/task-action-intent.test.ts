import { describe, expect, it } from "vitest";
import { parseTaskActionIntent } from "../src/services/task-action-intent";

const TASK_ID = `task_${"C".repeat(26)}`;

describe("task status language", () => {
  const statusPhrasings: Array<[string, TaskActionExpected]> = [
    ["Markiere die Aufgabe Quartalsbericht als erledigt", { kind: "task.update", status: "done", ref: "Quartalsbericht" }],
    ["Setze den Task Quartalsbericht auf in Arbeit", { kind: "task.update", status: "running", ref: "Quartalsbericht" }],
    ["Bitte stelle die Aufgabe Quartalsbericht auf warten", { kind: "task.update", status: "waiting", ref: "Quartalsbericht" }],
    ["Markiere die Aufgabe Quartalsbericht als fertig", { kind: "task.update", status: "done", ref: "Quartalsbericht" }],
    ["Setze die Aufgabe Quartalsbericht auf in Prüfung", { kind: "task.update", status: "review", ref: "Quartalsbericht" }],
    [`Markiere den Task ${TASK_ID} als offen`, { kind: "task.update", status: "todo", ref: TASK_ID }],
    ["Mark task Quartalsbericht as done", { kind: "task.update", status: "done", ref: "Quartalsbericht" }],
    ["Markiere die Aufgabe als erledigt", { kind: "task.update", status: "done", ref: null }],
    ["Setze den Task auf bereit", { kind: "task.update", status: "ready", ref: null }],
  ];
  for (const [phrase, expected] of statusPhrasings) {
    it(`recognizes ${phrase}`, () => {
      expect(parseTaskActionIntent(phrase)).toEqual(expected);
    });
  }

  const cancelPhrasings: Array<[string, TaskActionExpected]> = [
    ["Lösche die Aufgabe Quartalsbericht", { kind: "task.cancel", ref: "Quartalsbericht" }],
    ["Bitte storniere den Task Quartalsbericht", { kind: "task.cancel", ref: "Quartalsbericht" }],
    ["Brich die Aufgabe Quartalsbericht ab", { kind: "task.cancel", ref: "Quartalsbericht" }],
    ["Entferne die Aufgabe Quartalsbericht", { kind: "task.cancel", ref: "Quartalsbericht" }],
    [`Cancel task ${TASK_ID}`, { kind: "task.cancel", ref: TASK_ID }],
    ["Lösche die Aufgabe", { kind: "task.cancel", ref: null }],
    ["Brich den Task ab", { kind: "task.cancel", ref: null }],
  ];
  for (const [phrase, expected] of cancelPhrasings) {
    it(`recognizes ${phrase}`, () => {
      expect(parseTaskActionIntent(phrase)).toEqual(expected);
    });
  }

  it.each([
    "Zeige mir die erledigten Aufgaben",
    "Was bedeutet storniert?",
    "Liste alle wartenden Tasks",
    "Markiere die Aufgabe Quartalsbericht",
    "Markiere die Aufgabe Quartalsbericht als irgendwas",
    "Lösche die Aufgabe das",
    "Neue Aufgabe: Quartalsbericht erledigen",
    "Öffne die Aufgaben",
    "Storniere",
  ])("does not infer a write from %s", (phrase) => {
    expect(parseTaskActionIntent(phrase)).toBeNull();
  });
});

type TaskActionExpected =
  | { kind: "task.update"; status: string; ref: string | null }
  | { kind: "task.cancel"; ref: string | null };
