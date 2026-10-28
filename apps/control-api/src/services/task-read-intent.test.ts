import { describe, expect, it } from "vitest";
import { parseReadQueryIntent } from "./read-query-intent";

describe("spoken task reads", () => {
  it("parses the common open-task questions without inventing a status", () => {
    for (const phrase of [
      "Zeige meine offenen Aufgaben",
      "zeig offene aufgaben",
      "welche Aufgaben sind offen",
      "liste meine Aufgaben",
      "Zeige meine Aufgaben",
    ]) {
      const intent = parseReadQueryIntent(phrase);
      expect(intent?.kind, phrase).toBe("tasks.list");
    }
    expect(parseReadQueryIntent("Zeige meine offenen Aufgaben")).toEqual({
      kind: "tasks.list",
      status: ["todo", "ready", "running", "waiting", "review"],
    });
    // Ohne Statuswort bleibt der Filter leer: die Antwort zeigt den tatsaechlichen Stand statt einer Annahme.
    expect(parseReadQueryIntent("Zeige meine Aufgaben")).toEqual({ kind: "tasks.list" });
  });

  it("keeps explicit statuses one-to-one", () => {
    expect(parseReadQueryIntent("zeige laufende aufgaben")).toEqual({ kind: "tasks.list", status: ["running"] });
    expect(parseReadQueryIntent("zeige fehlgeschlagene aufgaben")).toEqual({ kind: "tasks.list", status: ["failed"] });
    expect(parseReadQueryIntent("zeige erledigte aufgaben")).toEqual({ kind: "tasks.list", status: ["done"] });
    expect(parseReadQueryIntent("zeige wartende aufgaben")).toEqual({ kind: "tasks.list", status: ["waiting"] });
  });

  it("reads a single task by its identifier and rejects a foreign prefix", () => {
    const id = `task_${"a".repeat(26)}`;
    expect(parseReadQueryIntent(`zeige aufgabe ${id}`)).toEqual({ kind: "tasks.get", id });
    const foreign = parseReadQueryIntent(`zeige aufgabe act_${"a".repeat(26)}`);
    expect(foreign?.kind).toBe("clarify");
  });

  it("refuses to combine a read question with a change", () => {
    const mixed = parseReadQueryIntent("zeige meine Aufgaben und loesche die erste");
    expect(mixed?.kind).toBe("clarify");
  });

  it("rejects a status that does not exist for tasks", () => {
    const foreignStatus = parseReadQueryIntent("zeige genehmigte aufgaben");
    expect(foreignStatus?.kind).toBe("clarify");
  });

  it("does not turn a task creation sentence into a read", () => {
    expect(parseReadQueryIntent("Trage Zahnarzt als Aufgabe ein")).toBeNull();
  });
});