import { describe, expect, it } from "vitest";
import { parseReadQueryIntent } from "./read-query-intent";

describe("read-only command intent parsing", () => {
  it("maps German and English activity/status/time phrases to typed filters", () => {
    expect(parseReadQueryIntent("Zeig mir fehlgeschlagene Activity-Ereignisse der letzten 12 Stunden"))
      .toEqual({ kind: "activity.list", status: "failed", lookbackHours: 12 });
    expect(parseReadQueryIntent("Show open alerts"))
      .toEqual({ kind: "notifications.list", status: ["open"] });
    expect(parseReadQueryIntent("Liste ausstehende Freigaben"))
      .toEqual({ kind: "approvals.list", status: ["pending"] });
    expect(parseReadQueryIntent("Show open approvals"))
      .toEqual({ kind: "approvals.list", status: ["pending"] });
    expect(parseReadQueryIntent("Zeige Security-Audit-Ereignisse"))
      .toEqual({ kind: "audit.list", securityOnly: true });
    expect(parseReadQueryIntent("Zeige Aktivitäten, die fehlgeschlagen sind"))
      .toEqual({ kind: "activity.list", status: "failed" });
    expect(parseReadQueryIntent("Zeige Meldungen, die bestätigt wurden"))
      .toEqual({ kind: "notifications.list", status: ["acknowledged"] });
    expect(parseReadQueryIntent("Zeige, was läuft bei der Aktivität"))
      .toEqual({ kind: "activity.list", status: "running" });
  });

  it("requires one domain and one unambiguous status, rejects unsupported filters and bounds date windows", () => {
    expect(parseReadQueryIntent("Zeige Freigaben und Audit" )?.kind).toBe("clarify");
    expect(parseReadQueryIntent("Show open and resolved alerts")?.kind).toBe("clarify");
    expect(parseReadQueryIntent("Show approved Activity")?.kind).toBe("clarify");
    expect(parseReadQueryIntent("Show pending notifications")?.kind).toBe("clarify");
    expect(parseReadQueryIntent("Zeig Audit der letzten 90 Tage")?.kind).toBe("clarify");
    expect(parseReadQueryIntent("Show notifications from the last 2 hours")?.kind).toBe("clarify");
    expect(parseReadQueryIntent("Zeige Activity für meinen Agenten Alpha")?.kind).toBe("clarify");
    expect(parseReadQueryIntent("Suche Activity mit Titel Datenbankausfall")?.kind).toBe("clarify");
    expect(parseReadQueryIntent("Zeige Activity und starte den Agenten")?.kind).toBe("clarify");
    expect(parseReadQueryIntent("Show recent audit events today")?.kind).toBe("clarify");
    expect(parseReadQueryIntent("Show audit events yesterday")?.kind).toBe("clarify");
    expect(parseReadQueryIntent("starte bitte den Agenten" )).toBeNull();
  });

  it("requires an exact opaque id for detail reads and rejects cross-domain ids", () => {
    const activityId = `act_${"a".repeat(26)}`;
    const notificationId = `ntf_${"b".repeat(26)}`;
    expect(parseReadQueryIntent(`Zeige Activity ${activityId}`)).toEqual({ kind: "activity.get", id: activityId });
    expect(parseReadQueryIntent(`Zeige Benachrichtigung ${notificationId}`)).toEqual({ kind: "notifications.unsupportedDetail", id: notificationId });
    expect(parseReadQueryIntent(`Zeige Activity ${notificationId}`)?.kind).toBe("clarify");
  });
});
