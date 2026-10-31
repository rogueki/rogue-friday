import { afterEach, describe, expect, it } from "vitest";
import type { NotificationSettings } from "@friday/sdk";
import { openDatabase, type Db } from "../db/database";
import { QuietModeService, type QuietHours } from "./quiet-mode";

let db: Db | undefined;
afterEach(() => { db?.close(); db = undefined; });

const BERLIN = "Europe/Berlin";
const hours = (overrides: Partial<QuietHours> = {}): QuietHours => ({ enabled: true, from: "22:00", to: "07:00", ...overrides });

interface Harness {
  saved: Array<{ enabled: boolean; from: string; to: string }>;
  sent: Array<{ text: string; targetId: string }>;
}

const service = (currentMs: () => number, quietHours: QuietHours = hours(), settings: Partial<NotificationSettings> = {},
  sendText?: (text: string, targetId: string) => Promise<"sent" | "uncertain">): QuietModeService & Harness => {
  if (db === undefined) throw new Error("database not opened");
  const saved: Harness["saved"] = [];
  const sent: Harness["sent"] = [];
  const subject = new QuietModeService({
    db,
    notifications: () => ({ quietHours, ...settings } as NotificationSettings),
    timeZone: () => BERLIN,
    nowMs: currentMs,
    saveQuietHours: (value) => { saved.push(value); },
    sendText: async (text, targetId) => {
      sent.push({ text, targetId });
      return sendText === undefined ? "sent" : sendText(text, targetId);
    },
  });
  return Object.assign(subject, { saved, sent });
};
const failureCode = (run: () => unknown): string | undefined => {
  try { run(); return undefined; } catch (error) { return (error as { code?: string }).code; }
};

describe("QuietModeService", () => {
  it("reports the schedule window across midnight", () => {
    db = openDatabase(":memory:");
    const nowMs = Date.parse("2026-11-10T22:30:00.000Z"); // 23:30 in Berlin
    expect(service(() => nowMs).state()).toEqual({
      active: true,
      source: "schedule",
      until: "2026-11-11T06:00:00.000Z",
      temporaryUntil: null,
      level: "silent",
      summaryAt: "first_interaction",
      periodStart: "2026-11-10T21:00:00.000Z",
    });
  });

  it("reports the scheduled period start and summary mode at night", () => {
    db = openDatabase(":memory:");
    const nowMs = Date.parse("2026-11-10T22:30:00.000Z"); // 23:30 in Berlin
    expect(service(() => nowMs).state()).toMatchObject({
      periodStart: "2026-11-10T21:00:00.000Z",
      summaryAt: "first_interaction",
      level: "silent",
    });
  });

  it("stays inactive outside the schedule window", () => {
    db = openDatabase(":memory:");
    const nowMs = Date.parse("2026-11-10T11:00:00.000Z"); // 12:00 in Berlin
    expect(service(() => nowMs).state()).toEqual({
      active: false, source: null, until: null, temporaryUntil: null, level: null, summaryAt: null, periodStart: null,
    });
  });

  it("treats a disabled window and equal bounds as inactive", () => {
    db = openDatabase(":memory:");
    const nowMs = Date.parse("2026-11-10T22:30:00.000Z");
    expect(service(() => nowMs, hours({ enabled: false })).state().active).toBe(false);
    expect(service(() => nowMs, hours({ from: "07:00", to: "07:00" })).state().active).toBe(false);
  });

  it("reports a same-day window ending at its local end time", () => {
    db = openDatabase(":memory:");
    const nowMs = Date.parse("2026-11-10T12:30:00.000Z"); // 13:30 in Berlin
    expect(service(() => nowMs, hours({ from: "13:00", to: "14:00" })).state()).toMatchObject({
      active: true,
      source: "schedule",
      until: "2026-11-10T13:00:00.000Z",
    });
  });

  it("expires a temporary quiet mode", () => {
    db = openDatabase(":memory:");
    let nowMs = Date.parse("2026-11-10T11:00:00.000Z");
    const subject = service(() => nowMs, hours({ enabled: false }));
    const until = new Date(nowMs + 30 * 60_000).toISOString();
    expect(subject.set(until)).toEqual({
      active: true,
      source: "temporary",
      until,
      temporaryUntil: until,
      level: "silent",
      summaryAt: null,
      periodStart: new Date(nowMs).toISOString(),
    });
    nowMs += 31 * 60_000;
    expect(subject.state()).toEqual({
      active: false, source: null, until: null, temporaryUntil: null, level: null, summaryAt: null, periodStart: null,
    });
  });

  it("keeps the temporary level and period start when extending", () => {
    db = openDatabase(":memory:");
    let nowMs = Date.parse("2026-11-10T11:00:00.000Z");
    const subject = service(() => nowMs, hours({ enabled: false }));
    const firstUntil = new Date(nowMs + 30 * 60_000).toISOString();
    expect(subject.set(firstUntil, "voice_off")).toMatchObject({
      level: "voice_off",
      summaryAt: null,
      periodStart: new Date(nowMs).toISOString(),
    });
    nowMs += 10 * 60_000;
    expect(subject.set(new Date(nowMs + 60 * 60_000).toISOString(), "voice_off")).toMatchObject({
      level: "voice_off",
      periodStart: new Date("2026-11-10T11:00:00.000Z").toISOString(),
    });
  });

  it("records nothing while the quiet mode is inactive", async () => {
    db = openDatabase(":memory:");
    const nowMs = Date.parse("2026-11-10T11:00:00.000Z");
    const subject = service(() => nowMs, hours({ enabled: false }), { quietTextTargetId: "target-1" });
    expect(await subject.notice({ class: "approvals", title: "Freigabe" })).toEqual({
      recorded: false, delivery: "skipped", reason: "Der Ruhemodus ist nicht aktiv.",
    });
    expect(subject.sent).toHaveLength(0);
    expect(subject.summary().items).toHaveLength(0);
  });

  it("skips delivery on the silent level but records the notice", async () => {
    db = openDatabase(":memory:");
    const nowMs = Date.parse("2026-11-10T11:00:00.000Z");
    const subject = service(() => nowMs, hours({ enabled: false }), { quietTextTargetId: "target-1" });
    subject.set(new Date(nowMs + 30 * 60_000).toISOString(), "silent");
    expect(await subject.notice({ class: "agent_questions", title: "Rückfrage" })).toEqual({
      recorded: true, delivery: "skipped", reason: "Stufe still: nichts wird versendet.",
    });
    expect(subject.sent).toHaveLength(0);
    const summary = subject.summary();
    expect(summary.items).toHaveLength(1);
    expect(summary.items[0]).toMatchObject({ class: "agent_questions", title: "Rückfrage", delivery: "skipped" });
  });

  it("sends an important notice while the voice-off level is active", async () => {
    db = openDatabase(":memory:");
    const nowMs = Date.parse("2026-11-10T11:00:00.000Z");
    const subject = service(() => nowMs, hours({ enabled: false }), { quietTextTargetId: "target-1" });
    subject.set(new Date(nowMs + 30 * 60_000).toISOString(), "voice_off");
    expect(await subject.notice({ class: "agent_questions", title: "Rückfrage", text: "Bitte prüfen." })).toEqual({
      recorded: true, delivery: "sent", reason: null,
    });
    expect(subject.sent).toHaveLength(1);
    expect(subject.sent[0]!.targetId).toBe("target-1");
    expect(subject.sent[0]!.text.startsWith("F.R.I.D.A.Y.: ")).toBe(true);
    expect(subject.sent[0]!.text).toContain("Rückfrage");
  });

  it("skips classes that are not important", async () => {
    db = openDatabase(":memory:");
    const nowMs = Date.parse("2026-11-10T11:00:00.000Z");
    const subject = service(() => nowMs, hours({ enabled: false }), { quietTextTargetId: "target-1" });
    subject.set(new Date(nowMs + 30 * 60_000).toISOString(), "voice_off");
    expect(await subject.notice({ class: "task_results", title: "Ergebnis" })).toEqual({
      recorded: true, delivery: "skipped", reason: "Keine wichtige Klasse.",
    });
    expect(subject.sent).toHaveLength(0);
  });

  it("skips the send when no text target is configured", async () => {
    db = openDatabase(":memory:");
    const nowMs = Date.parse("2026-11-10T11:00:00.000Z");
    const subject = service(() => nowMs, hours({ enabled: false }));
    subject.set(new Date(nowMs + 30 * 60_000).toISOString(), "voice_off");
    expect(await subject.notice({ class: "approvals", title: "Freigabe" })).toEqual({
      recorded: true, delivery: "skipped", reason: "Kein Textempfänger eingestellt.",
    });
    expect(subject.sent).toHaveLength(0);
  });

  it("reports the send error as skip reason", async () => {
    db = openDatabase(":memory:");
    const nowMs = Date.parse("2026-11-10T11:00:00.000Z");
    const subject = service(() => nowMs, hours({ enabled: false }), { quietTextTargetId: "target-1" },
      async () => { throw new Error("Hermes-Kanal ist nicht konfiguriert."); });
    subject.set(new Date(nowMs + 30 * 60_000).toISOString(), "voice_off");
    expect(await subject.notice({ class: "approvals", title: "Freigabe" })).toEqual({
      recorded: true, delivery: "skipped", reason: "Hermes-Kanal ist nicht konfiguriert.",
    });
  });

  it("starts a fresh log for a new period and keeps the last log when inactive", async () => {
    db = openDatabase(":memory:");
    let nowMs = Date.parse("2026-11-10T11:00:00.000Z");
    const subject = service(() => nowMs, hours({ enabled: false }), { quietTextTargetId: "target-1" });
    subject.set(new Date(nowMs + 30 * 60_000).toISOString(), "voice_off");
    await subject.notice({ class: "approvals", title: "Erste Freigabe" });
    expect(subject.summary().items).toHaveLength(1);
    subject.clear();
    expect(subject.summary().items).toHaveLength(1);
    nowMs += 60 * 60_000;
    subject.set(new Date(nowMs + 30 * 60_000).toISOString(), "voice_off");
    expect(subject.summary().items).toHaveLength(0);
  });

  it("validates and stores the night schedule", () => {
    db = openDatabase(":memory:");
    const nowMs = Date.parse("2026-11-10T11:00:00.000Z");
    const subject = service(() => nowMs, hours({ enabled: false }));
    expect(failureCode(() => subject.setSchedule({ enabled: true, from: "22:00", to: "22:00" }))).toBe("VALIDATION_FAILED");
    expect(subject.saved).toHaveLength(0);
    const result = subject.setSchedule({ enabled: true, from: "23:00", to: "06:30" });
    expect(subject.saved).toEqual([{ enabled: true, from: "23:00", to: "06:30" }]);
    expect(typeof result.active).toBe("boolean");
  });

  it("rejects a temporary end outside the allowed range", () => {
    db = openDatabase(":memory:");
    const nowMs = Date.parse("2026-11-10T11:00:00.000Z");
    const subject = service(() => nowMs, hours({ enabled: false }));
    expect(failureCode(() => subject.set(new Date(nowMs - 60_000).toISOString()))).toBe("VALIDATION_FAILED");
    expect(failureCode(() => subject.set(new Date(nowMs + 24 * 60 * 60_000 + 60_000).toISOString()))).toBe("VALIDATION_FAILED");
  });

  it("uses the later end when temporary and schedule overlap", () => {
    db = openDatabase(":memory:");
    const nowMs = Date.parse("2026-11-10T21:30:00.000Z"); // 22:30 in Berlin
    const until = "2026-11-10T22:00:00.000Z"; // 23:00 in Berlin
    expect(service(() => nowMs).set(until)).toEqual({
      active: true,
      source: "temporary",
      until: "2026-11-11T06:00:00.000Z",
      temporaryUntil: until,
      level: "silent",
      summaryAt: null,
      periodStart: "2026-11-10T21:00:00.000Z",
    });
  });

  it("clears a temporary quiet mode", () => {
    db = openDatabase(":memory:");
    const nowMs = Date.parse("2026-11-10T11:00:00.000Z");
    const subject = service(() => nowMs, hours({ enabled: false }));
    const until = new Date(nowMs + 30 * 60_000).toISOString();
    subject.set(until);
    expect(subject.clear()).toEqual({
      active: false, source: null, until: null, temporaryUntil: null, level: null, summaryAt: null, periodStart: null,
    });
  });
});
