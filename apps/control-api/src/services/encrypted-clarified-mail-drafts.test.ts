import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../db/database";
import { EncryptedClarifiedMailDrafts } from "./encrypted-clarified-mail-drafts";

describe("encrypted clarified mail drafts", () => {
  let db: Db | undefined;
  afterEach(() => { db?.close(); db = undefined; });

  it("keeps the body encrypted and consumes it once for the same owner and session", () => {
    db = openDatabase(":memory:");
    const drafts = new EncryptedClarifiedMailDrafts(db, Buffer.alloc(32, 9), () => 10_000);
    const body = { to: ["person@example.test"], subject: "Private", body: "Sensitive message content" };
    const created = drafts.create("owner", "session-binding", "intent-hash", body);
    const row = db.prepare("SELECT payload_ciphertext FROM encrypted_clarified_mail_drafts").get() as { payload_ciphertext: string };
    expect(row.payload_ciphertext).not.toContain("Sensitive message content");
    expect(drafts.read("other-owner", "session-binding", created.id, "intent-hash")).toBeNull();
    expect(drafts.read("owner", "other-session", created.id, "intent-hash")).toBeNull();
    expect(drafts.read("owner", "session-binding", created.id, "different-hash")).toBeNull();
    expect(drafts.consume("owner", "session-binding", created.id, "intent-hash")).toEqual(body);
    expect(drafts.consume("owner", "session-binding", created.id, "intent-hash")).toBeNull();
  });

  it("preserves encrypted body data when the key is unavailable", () => {
    db = openDatabase(":memory:");
    const key = Buffer.alloc(32, 13);
    const drafts = new EncryptedClarifiedMailDrafts(db, key, () => 10_000);
    const body = { to: ["person@example.test"], subject: "Private", body: "Recoverable encrypted content" };
    const created = drafts.create("owner", "session-binding", "intent-hash", body);
    const before = (db.prepare("SELECT payload_ciphertext FROM encrypted_clarified_mail_drafts").get() as { payload_ciphertext: string }).payload_ciphertext;
    expect(() => new EncryptedClarifiedMailDrafts(db!, Buffer.alloc(32, 14), () => 10_000))
      .toThrow("restore the original auth.key");
    expect((db.prepare("SELECT payload_ciphertext FROM encrypted_clarified_mail_drafts").get() as { payload_ciphertext: string }).payload_ciphertext).toBe(before);
    expect(new EncryptedClarifiedMailDrafts(db, key, () => 10_000).read("owner", "session-binding", created.id, "intent-hash")).toEqual(body);
  });
});
