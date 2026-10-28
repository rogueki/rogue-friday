import { describe, expect, it } from "vitest";
import { parseReadQueryIntent } from "./read-query-intent";

describe("spoken communication reads", () => {
  it("lists threads and maps the German status words", () => {
    expect(parseReadQueryIntent("zeige meine unterhaltungen")).toEqual({ kind: "communication.list" });
    expect(parseReadQueryIntent("zeige offene unterhaltungen")).toEqual({ kind: "communication.list", status: ["open"] });
    expect(parseReadQueryIntent("welche unterhaltungen sind wartend")).toEqual({ kind: "communication.list", status: ["waiting"] });
    expect(parseReadQueryIntent("zeige beantwortete threads")).toEqual({ kind: "communication.list", status: ["replied"] });
    expect(parseReadQueryIntent("zeige archivierte mails")).toEqual({ kind: "communication.list", status: ["archived"] });
  });

  it("filters threads that need an answer", () => {
    expect(parseReadQueryIntent("zeige unterhaltungen die eine antwort brauchen"))
      .toEqual({ kind: "communication.list", needsReply: true });
    expect(parseReadQueryIntent("welche unterhaltungen sind unbeantwortet"))
      .toEqual({ kind: "communication.list", needsReply: true });
  });

  it("refuses filters it cannot honour instead of faking them", () => {
    expect(parseReadQueryIntent("zeige ungelesene mails")).toMatchObject({ kind: "clarify" });
    expect(parseReadQueryIntent("zeige unterhaltungen der letzten woche")).toMatchObject({ kind: "clarify" });
    expect(parseReadQueryIntent("zeige offene und wartende unterhaltungen")).toMatchObject({ kind: "clarify" });
    expect(parseReadQueryIntent("zeige offene unterhaltungen die eine antwort brauchen")).toMatchObject({ kind: "clarify" });
  });

  it("keeps writing commands out of the read path", () => {
    expect(parseReadQueryIntent("antworte auf die unterhaltung von hoffmann")).toBeNull();
    expect(parseReadQueryIntent("zeige unterhaltungen und archiviere die erste")).toMatchObject({ kind: "clarify" });
  });
});