import { describe, expect, it } from "vitest";
import { formatVoiceRuntimeReadback, parseReadQueryIntent, READ_STATUS_ALIASES } from "./read-query-intent";

describe("read-only command intent parsing", () => {
  it("only compares known voice values from a recent fresh status and treats default device policy separately", () => {
    const now = Date.parse("2026-10-20T12:00:00.000Z");
    const response = (data: Record<string, unknown>, state: "fresh" | "stale" = "fresh", asOf: string | null = "2026-10-20T11:59:50.000Z") => ({
      data: data as never, freshness: { state, asOf },
    });
    const settings = { ttsVoice: "classic", inputDeviceId: "mic-1", outputDeviceId: "speaker-1" };
    const fresh = formatVoiceRuntimeReadback(settings, response({
      ttsVoiceChoice: "classic", audioInputDeviceId: "mic-1", audioOutputDeviceId: "speaker-1",
      stt: { state: "ready" }, tts: { state: "ready" },
    }), now);
    expect(fresh).toContain("TTS-Stimme stimmt");
    expect(fresh).toContain("Eingabegeraet Kennung stimmt");

    const bothMissing = formatVoiceRuntimeReadback(settings, response({
      ttsVoiceChoice: null, audioInputDeviceId: null, audioOutputDeviceId: null,
      stt: { state: "ready" }, tts: { state: "ready" },
    }), now);
    expect(bothMissing).toContain("TTS-Stimme nicht verglichen");
    expect(bothMissing).toContain("Geraetevergleich nicht verifiziert");
    expect(bothMissing).not.toContain("stimmt ueberein");

    const defaultPolicy = formatVoiceRuntimeReadback({ ttsVoice: "", inputDeviceId: null, outputDeviceId: null }, response({
      ttsVoiceChoice: "system-default", audioInputDeviceId: "resolved-mic", audioOutputDeviceId: null,
      stt: { state: "ready" }, tts: { state: "ready" },
    }), now);
    expect(defaultPolicy).toContain("Default-Policy gespeichert");
    expect(defaultPolicy).not.toContain("weicht ab");

    for (const stale of [
      response({ audioInputDeviceId: "mic-1" }, "stale"),
      response({ audioInputDeviceId: "mic-1" }, "fresh", "2026-10-20T11:58:59.000Z"),
      response({ audioInputDeviceId: "mic-1" }, "fresh", null),
    ]) expect(formatVoiceRuntimeReadback(settings, stale, now)).toContain("nicht verifiziert");
  });
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
    const supportedStatuses: Array<[string, string, string]> = [
      ["activity", "failed", "failed"], ["activity", "running", "running"],
      ["activity", "started", "started"], ["activity", "succeeded", "succeeded"],
      ["activity", "cancelled", "cancelled"], ["activity", "info", "info"],
      ["notifications", "open", "open"], ["notifications", "acknowledged", "acknowledged"],
      ["notifications", "snoozed", "snoozed"], ["notifications", "resolved", "resolved"],
      ["approvals", "pending", "pending"], ["approvals", "approved", "approved"],
      ["approvals", "rejected", "rejected"], ["approvals", "expired", "expired"],
      ["approvals", "cancelled", "cancelled"], ["approvals", "executed", "executed"],
      ["approvals", "failed", "failed"], ["audit", "failed", "failure"],
      ["audit", "denied", "denied"], ["audit", "successful", "success"],
      ["audit", "pending", "pending"],
    ];
    for (const [family, phrase, status] of supportedStatuses) {
      const familyWord = family === "notifications" ? "alerts" : family === "approvals" ? "approvals" : family;
      const intent = parseReadQueryIntent(`Show ${phrase} ${familyWord}`);
      expect(intent?.kind, `${family} ${phrase}`).toBe(`${family}.list`);
      if (family === "activity") expect(intent).toMatchObject({ status });
      else if (family === "audit") expect(intent).toMatchObject({ result: [status] });
      else expect(intent).toMatchObject({ status: [status] });
    }
    for (const alias of READ_STATUS_ALIASES) for (const term of alias.terms) for (const [family, status] of Object.entries(alias.mapsTo)) {
      const familyWord = family === "notifications" ? "alerts" : family;
      const intent = parseReadQueryIntent(`Show ${term} ${familyWord}`);
      expect(intent?.kind, `${term} -> ${family}`).toBe(`${family}.list`);
      if (family === "activity") expect(intent).toMatchObject({ status });
      else if (family === "audit") expect(intent).toMatchObject({ result: [status] });
      else expect(intent).toMatchObject({ status: [status] });
    }
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
    expect(parseReadQueryIntent("Show 9999 Activity")?.kind).toBe("clarify");
    expect(parseReadQueryIntent("Show last 2 hours and 3 Activity events")?.kind).toBe("clarify");
    expect(parseReadQueryIntent("Show last 2 hours and last 3 days Activity events")?.kind).toBe("clarify");
    const activityId = `act_${"z".repeat(26)}`;
    expect(parseReadQueryIntent(`Show Activity ${activityId} failed`)?.kind).toBe("clarify");
    expect(parseReadQueryIntent(`Show Activity ${activityId} last 2 hours`)?.kind).toBe("clarify");
    expect(parseReadQueryIntent(`Show Activity ${activityId} other`)?.kind).toBe("clarify");
    expect(parseReadQueryIntent(`open Activity ${activityId}`)).toEqual({ kind: "activity.get", id: activityId });
    expect(parseReadQueryIntent(`Show open Activity ${activityId}`)?.kind).toBe("clarify");
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

  it("parses bounded settings and Content Studio plan reads without swallowing extra filters", () => {
    expect(parseReadQueryIntent("Wie sind meine Voice-Einstellungen?"))
      .toEqual({ kind: "settings.get", area: "voice" });
    expect(parseReadQueryIntent("Show my notification settings"))
      .toEqual({ kind: "settings.get", area: "notifications" });
    expect(parseReadQueryIntent("Zeige mir den Content Studio Plan"))
      .toEqual({ kind: "contentStudio.plan" });
    expect(parseReadQueryIntent("Zeige den Content Studio Plan für nächste Woche")?.kind).toBe("clarify");
  });
});
