import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../db/database";
import { PendingCommandClarifications, parseClarificationChoice, type PendingCommandClarification } from "./pending-command-clarifications";

describe("pending command clarification storage", () => {
  let db: Db | undefined;
  afterEach(() => { db?.close(); db = undefined; });

  it("binds encrypted pending turns to owner and authenticated session and consumes them once", () => {
    db = openDatabase(":memory:");
    const store = new PendingCommandClarifications(db, Buffer.alloc(32, 7), () => 1_000);
    const payload: PendingCommandClarification = { kind: "calendar.clarify", intent: {
      kind: "calendar.delete", ref: "Doppeltermin",
    }, candidates: [
      { id: "cal_1", version: 1, title: "Doppeltermin", start: "2026-10-20T10:00:00.000Z" },
      { id: "cal_2", version: 1, title: "Doppeltermin", start: "2026-10-21T10:00:00.000Z" },
    ] };
    const created = store.put("owner", "session-one", payload);
    const row = db.prepare("SELECT payload_ciphertext FROM pending_command_clarifications").get() as { payload_ciphertext: string };
    expect(row.payload_ciphertext).not.toContain("Doppeltermin");
    expect(store.read("other-owner", "session-one")).toBeNull();
    expect(store.read("owner", "session-two")).toBeNull();
    expect(store.consume("owner", "session-one", created.id)).toEqual(payload);
    expect(store.consume("owner", "session-one", created.id)).toBeNull();
  });

  it("expires pending turns and rejects an old id after replacement", () => {
    db = openDatabase(":memory:");
    let now = 5_000;
    const store = new PendingCommandClarifications(db, Buffer.alloc(32, 8), () => now);
    const payload: PendingCommandClarification = { kind: "calendar.clarify", intent: {
      kind: "calendar.delete", ref: "Duplicate",
    }, candidates: [{ id: "cal_3", version: 1, title: "Duplicate", start: "2026-10-20T10:00:00.000Z" }] };
    const first = store.put("owner", "session", payload);
    const second = store.put("owner", "session", payload);
    expect(store.consume("owner", "session", first.id)).toBeNull();
    expect(store.read("owner", "session")?.id).toBe(second.id);
    now += 5 * 60_000;
    expect(store.read("owner", "session")).toBeNull();
  });

  it("preserves ciphertext on key mismatch so restoring the original key recovers the turn", () => {
    db = openDatabase(":memory:");
    const key = Buffer.alloc(32, 11);
    const store = new PendingCommandClarifications(db, key, () => 10_000);
    const payload: PendingCommandClarification = { kind: "calendar.clarify", intent: {
      kind: "calendar.delete", ref: "Private event",
    }, candidates: [{ id: "cal_4", version: 1, title: "Private event", start: "2026-10-20T10:00:00.000Z" }] };
    store.put("owner", "session", payload);
    const before = (db.prepare("SELECT payload_ciphertext FROM pending_command_clarifications").get() as { payload_ciphertext: string }).payload_ciphertext;
    expect(() => new PendingCommandClarifications(db!, Buffer.alloc(32, 12), () => 10_000))
      .toThrow("restore the original auth.key");
    expect((db.prepare("SELECT payload_ciphertext FROM pending_command_clarifications").get() as { payload_ciphertext: string }).payload_ciphertext).toBe(before);
    expect(new PendingCommandClarifications(db, key, () => 10_000).read("owner", "session")?.payload).toEqual(payload);
  });

  it("parses only a bounded one-based option choice", () => {
    expect(parseClarificationChoice("use the second one", 2)).toBe(1);
    expect(parseClarificationChoice("Nimm den zweiten", 2)).toBe(1);
    expect(parseClarificationChoice("w\u00e4hle zweite", 2)).toBe(1);
    expect(parseClarificationChoice("3", 2)).toBeNull();
    expect(parseClarificationChoice("5", 5)).toBe(4);
    expect(parseClarificationChoice("use the second one and delete it", 2)).toBeNull();
  });
});
