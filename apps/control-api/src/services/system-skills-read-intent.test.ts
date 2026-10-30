import { describe, expect, it } from "vitest";
import { parseReadQueryIntent } from "./read-query-intent";

describe("spoken system reads", () => {
  it("separates status from load", () => {
    expect(parseReadQueryIntent("wie ist der systemstatus")).toEqual({ kind: "system.status" });
    expect(parseReadQueryIntent("zeige den zustand des systems")).toEqual({ kind: "system.status" });
    expect(parseReadQueryIntent("wie hoch ist die auslastung")).toEqual({ kind: "system.metrics" });
    expect(parseReadQueryIntent("wie viel arbeitsspeicher nutzt das system")).toEqual({ kind: "system.metrics" });
  });

  it("asks back instead of acting", () => {
    expect(parseReadQueryIntent("zeige systemstatus und starte den dienst neu")).toMatchObject({ kind: "clarify" });
    expect(parseReadQueryIntent("zeige systemstatus und meine aufgaben")).toMatchObject({ kind: "clarify" });
  });
});

describe("spoken skill reads", () => {
  it("lists skills and maps the enabled filter", () => {
    expect(parseReadQueryIntent("welche skills habe ich")).toEqual({ kind: "skills.list" });
    expect(parseReadQueryIntent("zeige aktive skills")).toEqual({ kind: "skills.list", enabled: true });
    expect(parseReadQueryIntent("zeige deaktivierte faehigkeiten")).toEqual({ kind: "skills.list", enabled: false });
  });

  it("asks back instead of guessing", () => {
    expect(parseReadQueryIntent("zeige aktive und deaktivierte skills")).toMatchObject({ kind: "clarify" });
    expect(parseReadQueryIntent("zeige skills und deaktiviere den ersten")).toMatchObject({ kind: "clarify" });
  });
});
