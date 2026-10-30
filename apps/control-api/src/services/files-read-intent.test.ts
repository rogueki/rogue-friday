import { describe, expect, it } from "vitest";
import { parseReadQueryIntent } from "./read-query-intent";

describe("spoken file reads", () => {
  it("lists files and maps category filters", () => {
    expect(parseReadQueryIntent("zeige meine dateien")).toEqual({ kind: "files.list" });
    expect(parseReadQueryIntent("Welche Dokumente habe ich?")).toEqual({ kind: "files.list" });
    expect(parseReadQueryIntent("zeige meine rechnungen bei den dateien")).toEqual({ kind: "files.list", category: ["invoices"] });
    expect(parseReadQueryIntent("zeige hochgeladene dateien")).toEqual({ kind: "files.list", category: ["uploaded"] });
    expect(parseReadQueryIntent("zeige berichte und präsentationen in den dateien")).toEqual({ kind: "files.list", category: ["reports", "presentations"] });
    expect(parseReadQueryIntent("zeige temporäre dateien")).toEqual({ kind: "files.list", category: ["temporary"] });
  });

  it("reads one file by identifier", () => {
    const id = `file_${"f".repeat(26)}`;
    expect(parseReadQueryIntent(`zeige datei ${id}`)).toEqual({ kind: "files.get", id });
  });

  it("asks back instead of guessing", () => {
    const id = `file_${"f".repeat(26)}`;
    expect(parseReadQueryIntent(`zeige rechnungen datei ${id}`)).toMatchObject({ kind: "clarify" });
    expect(parseReadQueryIntent(`zeige datei file_${"a".repeat(26)} und file_${"b".repeat(26)}`)).toMatchObject({ kind: "clarify" });
    expect(parseReadQueryIntent("suche die datei angebot")).toMatchObject({ kind: "clarify" });
    expect(parseReadQueryIntent("zeige dateien und loesche die erste")).toMatchObject({ kind: "clarify" });
    expect(parseReadQueryIntent("zeige meine dateien und aufgaben")).toMatchObject({ kind: "clarify" });
    expect(parseReadQueryIntent("zeige dateien und mein gedaechtnis")).toMatchObject({ kind: "clarify" });
  });

  it("keeps file write phrases out of the read path", () => {
    expect(parseReadQueryIntent("lösche die datei angebot.pdf")).toBeNull();
    expect(parseReadQueryIntent("benenne die datei angebot.pdf um in angebot-alt.pdf")).toBeNull();
  });
});
