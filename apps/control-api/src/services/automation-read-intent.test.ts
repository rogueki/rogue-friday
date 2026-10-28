import { describe, expect, it } from "vitest";
import { parseReadQueryIntent } from "./read-query-intent";

describe("spoken automation reads", () => {
  it("lists automations and maps the enabled flag", () => {
    expect(parseReadQueryIntent("zeige meine automationen")).toEqual({ kind: "automations.list" });
    expect(parseReadQueryIntent("zeige aktive automationen")).toEqual({ kind: "automations.list", enabled: true });
    expect(parseReadQueryIntent("welche automationen sind aktiviert")).toEqual({ kind: "automations.list", enabled: true });
    expect(parseReadQueryIntent("zeige deaktivierte automationen")).toEqual({ kind: "automations.list", enabled: false });
    expect(parseReadQueryIntent("zeige meine zeitplaene")).toEqual({ kind: "automations.list" });
    expect(parseReadQueryIntent("zeige mir die automationen an")).toEqual({ kind: "automations.list" });
    expect(parseReadQueryIntent("zeige automationen aus dem backup")).toEqual({ kind: "automations.list" });
    expect(parseReadQueryIntent("zeige inaktive automationen")).toEqual({ kind: "automations.list", enabled: false });
  });

  it("reads one automation by identifier", () => {
    const id = `automation_${"c".repeat(26)}`;
    expect(parseReadQueryIntent(`zeige automation ${id}`)).toEqual({ kind: "automations.get", id });
    expect(parseReadQueryIntent(`zeige die aktive automation ${id}`)).toMatchObject({ kind: "clarify" });
  });

  it("refuses ambiguous or mixed requests", () => {
    expect(parseReadQueryIntent("zeige aktive und deaktivierte automationen")).toMatchObject({ kind: "clarify" });
    expect(parseReadQueryIntent("zeige automationen und aktiviere die erste")).toMatchObject({ kind: "clarify" });
    expect(parseReadQueryIntent("zeige automationen und aufgaben")).toMatchObject({ kind: "clarify" });
    expect(parseReadQueryIntent("aktiviere die backup automation")).toBeNull();
  });
});