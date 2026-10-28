import { describe, expect, it } from "vitest";
import { parseReadQueryIntent } from "./read-query-intent";

describe("spoken memory reads", () => {
  it("lists memory entries and maps pinned and type filters", () => {
    expect(parseReadQueryIntent("zeige mein gedaechtnis")).toEqual({ kind: "memory.list" });
    expect(parseReadQueryIntent("zeige meine gedaechtniseintraege")).toEqual({ kind: "memory.list" });
    expect(parseReadQueryIntent("zeige angeheftete gedaechtniseintraege")).toEqual({ kind: "memory.list", pinned: true });
    expect(parseReadQueryIntent("zeige meine fakten im gedaechtnis")).toEqual({ kind: "memory.list", type: ["fact"] });
    expect(parseReadQueryIntent("zeige meine fakten")).toBeNull();
    expect(parseReadQueryIntent("zeige die firmen im gedaechtnis")).toEqual({ kind: "memory.list", type: ["company"] });
    expect(parseReadQueryIntent("zeige meine fakten und personen im gedaechtnis")).toEqual({ kind: "memory.list", type: ["fact", "person"] });
  });

  it("reads one memory entry by identifier", () => {
    const id = `mem_${"m".repeat(26)}`;
    expect(parseReadQueryIntent(`zeige gedaechtniseintrag ${id}`)).toEqual({ kind: "memory.get", id });
  });

  it("asks back instead of guessing", () => {
    const id = `mem_${"m".repeat(26)}`;
    expect(parseReadQueryIntent(`zeige angehefteten gedaechtniseintrag ${id}`)).toMatchObject({ kind: "clarify" });
    expect(parseReadQueryIntent(`zeige gedaechtnis mem_${"a".repeat(26)} und mem_${"b".repeat(26)}`)).toMatchObject({ kind: "clarify" });
    expect(parseReadQueryIntent(`zeige gedaechtnis und vergiss ${id}`)).toMatchObject({ kind: "clarify" });
    expect(parseReadQueryIntent("zeige gedaechtnis und meine recherchen")).toMatchObject({ kind: "clarify" });
    expect(parseReadQueryIntent("zeige mir meine erinnerungen")?.kind).not.toBe("memory.list");
  });
});

describe("spoken research reads", () => {
  it("lists research projects and reads one by identifier", () => {
    const id = `rsp_${"r".repeat(26)}`;
    expect(parseReadQueryIntent("zeige meine recherchen")).toEqual({ kind: "research.list" });
    expect(parseReadQueryIntent(`zeige recherche ${id}`)).toEqual({ kind: "research.get", id });
  });

  it("asks back instead of guessing", () => {
    expect(parseReadQueryIntent("zeige laufende recherchen")).toMatchObject({ kind: "clarify" });
    expect(parseReadQueryIntent("zeige recherchen und aufgaben")).toMatchObject({ kind: "clarify" });
  });
});
