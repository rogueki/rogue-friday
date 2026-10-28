import { describe, expect, it } from "vitest";
import { parseReadQueryIntent } from "./read-query-intent";

describe("spoken agent reads", () => {
  it("lists agents and maps explicit statuses one-to-one", () => {
    expect(parseReadQueryIntent("zeige meine agenten")).toEqual({ kind: "agents.list" });
    expect(parseReadQueryIntent("zeige laufende agenten")).toEqual({ kind: "agents.list", status: ["working"] });
    expect(parseReadQueryIntent("welche agenten sind pausiert")).toEqual({ kind: "agents.list", status: ["paused"] });
    expect(parseReadQueryIntent("zeige agenten mit fehlern")).toEqual({ kind: "agents.list", status: ["error"] });
    expect(parseReadQueryIntent("zeige offline agenten")).toEqual({ kind: "agents.list", status: ["offline"] });
  });

  it("treats 'aktiv' as the set of running states, not as a single guessed status", () => {
    expect(parseReadQueryIntent("zeige aktive agenten")).toEqual({
      kind: "agents.list",
      status: ["idle", "starting", "working", "waiting"],
    });
  });

  it("reads one agent by its identifier", () => {
    const id = `agent_${"b".repeat(26)}`;
    expect(parseReadQueryIntent(`zeige agent ${id}`)).toEqual({ kind: "agents.get", id });
    expect(parseReadQueryIntent(`zeige den pausierten agenten ${id}`)).toMatchObject({ kind: "clarify" });
  });

  it("refuses ambiguous or mixed requests", () => {
    expect(parseReadQueryIntent("zeige laufende und pausierte agenten")).toMatchObject({ kind: "clarify" });
    expect(parseReadQueryIntent("zeige agenten und stoppe den ersten")).toMatchObject({ kind: "clarify" });
    expect(parseReadQueryIntent("starte den agenten fuer recherche")).toBeNull();
  });
});