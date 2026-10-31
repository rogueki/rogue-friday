import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../db/database";
import { QuietModeService, type QuietHours } from "./quiet-mode";

let db: Db | undefined;
afterEach(() => { db?.close(); db = undefined; });

const BERLIN = "Europe/Berlin";
const hours = (overrides: Partial<QuietHours> = {}): QuietHours => ({ enabled: true, from: "22:00", to: "07:00", ...overrides });
const service = (currentMs: () => number, quietHours: QuietHours = hours()): QuietModeService => {
  if (db === undefined) throw new Error("database not opened");
  return new QuietModeService(db, () => quietHours, () => BERLIN, currentMs);
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
    });
  });

  it("stays inactive outside the schedule window", () => {
    db = openDatabase(":memory:");
    const nowMs = Date.parse("2026-11-10T11:00:00.000Z"); // 12:00 in Berlin
    expect(service(() => nowMs).state()).toEqual({ active: false, source: null, until: null, temporaryUntil: null });
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
    expect(subject.set(until)).toEqual({ active: true, source: "temporary", until, temporaryUntil: until });
    nowMs += 31 * 60_000;
    expect(subject.state()).toEqual({ active: false, source: null, until: null, temporaryUntil: null });
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
    });
  });

  it("clears a temporary quiet mode", () => {
    db = openDatabase(":memory:");
    const nowMs = Date.parse("2026-11-10T11:00:00.000Z");
    const subject = service(() => nowMs, hours({ enabled: false }));
    const until = new Date(nowMs + 30 * 60_000).toISOString();
    subject.set(until);
    expect(subject.clear()).toEqual({ active: false, source: null, until: null, temporaryUntil: null });
  });
});
