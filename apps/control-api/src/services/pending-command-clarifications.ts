import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import type { Db } from "../db/database";
import type { CalendarActionIntent } from "./calendar-action-intent";
import type { MailActionIntent } from "./mail-action-intent";

export type PendingCommandClarification =
  | { kind: "calendar.clarify"; intent: Extract<CalendarActionIntent, { kind: "calendar.update" | "calendar.delete" }>; candidates: Array<{ id: string; version: number; title: string; start: string }> }
  | { kind: "mail.clarify"; accountId: string; intent: Extract<MailActionIntent, { kind: "mail.compose" }>; candidates: Array<{ address: string; label: string }> }
  | { kind: "calendar.confirm"; previewId: string; choice: number; intent: Extract<CalendarActionIntent, { kind: "calendar.update" | "calendar.delete" }>; selectedId: string }
  | { kind: "mail.confirm"; previewId: string; choice: number; accountId: string; intentHash: string; selectedAddress: string };

interface Row { id: string; payload_ciphertext: string; expires_at: number }
const TTL_MS = 5 * 60_000;
const VERSION = "v1";
const PURPOSE = "friday/pending-command-clarifications/v1";

export function parseClarificationChoice(text: string, optionCount: number): number | null {
  const value = text.trim().toLocaleLowerCase("de-DE").replace(/[.!?]+$/, "").trim();
  const numeric = /^(?:(?:use|choose|select|option|number|nimm|waehle|w\u00e4hle|option)\s+)?([1-9][0-9]?)$/.exec(value);
  if (numeric) {
    const index = Number(numeric[1]) - 1;
    return index >= 0 && index < optionCount ? index : null;
  }
  const ordinal: Record<string, number> = {
    first: 0, "the first": 0, "the first one": 0, "first one": 0,
    second: 1, "the second": 1, "the second one": 1, "second one": 1,
    third: 2, "the third": 2, "the third one": 2, "third one": 2,
    fourth: 3, "the fourth": 3, "the fourth one": 3, "fourth one": 3,
    erste: 0, erster: 0, erstes: 0, ersten: 0, "die erste": 0, "der erste": 0, "den ersten": 0, "das erste": 0,
    zweite: 1, zweiter: 1, zweites: 1, zweiten: 1, "die zweite": 1, "der zweite": 1, "den zweiten": 1, "das zweite": 1,
    dritte: 2, dritter: 2, drittes: 2, dritten: 2, "die dritte": 2, "der dritte": 2, "den dritten": 2, "das dritte": 2,
    vierte: 3, vierter: 3, viertes: 3, vierten: 3, "die vierte": 3, "der vierte": 3, "den vierten": 3, "das vierte": 3,
  };
  const ordinalMatch = /^(?:(?:use|choose|select|pick|take|nimm|waehle|w\u00e4hle)\s+)?(.+)$/.exec(value);
  if (!ordinalMatch) return null;
  const index = ordinal[ordinalMatch[1]!];
  return index !== undefined && index < optionCount ? index : null;
}

/** Short-lived typed dialogue state. It is bound to the authenticated owner and hashed browser session. */
export class PendingCommandClarifications {
  constructor(private readonly db: Db, private readonly key: Buffer, private readonly now: () => number = Date.now) {
    if (key.length !== 32) throw new Error("Pending clarification encryption key is invalid");
  }

  private sessionHash(ownerId: string, sessionId: string): string {
    return createHash("sha256").update(`${ownerId}\n${sessionId}`).digest("hex");
  }

  sessionBinding(ownerId: string, sessionId: string): string {
    return this.sessionHash(ownerId, sessionId);
  }

  private aad(ownerId: string, sessionHash: string, id: string, expiresAt: number): Buffer {
    return Buffer.from(`${PURPOSE}\n${ownerId}\n${sessionHash}\n${id}\n${expiresAt}`, "utf8");
  }

  put(ownerId: string, sessionId: string, payload: PendingCommandClarification): { id: string; expiresAt: number } {
    const sessionHash = this.sessionHash(ownerId, sessionId);
    const id = randomUUID();
    const expiresAt = this.now() + TTL_MS;
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    cipher.setAAD(this.aad(ownerId, sessionHash, id, expiresAt));
    const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
    if (plaintext.byteLength > 512_000) throw new Error("Pending clarification payload exceeds limit");
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const stored = [VERSION, nonce.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(":");
    this.db.prepare("DELETE FROM pending_command_clarifications WHERE expires_at <= ?").run(this.now());
    this.db.prepare(`INSERT INTO pending_command_clarifications (id, owner_id, session_hash, payload_ciphertext, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(owner_id, session_hash) DO UPDATE SET id=excluded.id,
      payload_ciphertext=excluded.payload_ciphertext, expires_at=excluded.expires_at, created_at=excluded.created_at`)
      .run(id, ownerId, sessionHash, stored, expiresAt, this.now());
    return { id, expiresAt };
  }

  purgeExpired(): number {
    return Number(this.db.prepare("DELETE FROM pending_command_clarifications WHERE expires_at <= ?").run(this.now()).changes);
  }

  read(ownerId: string, sessionId: string): { id: string; payload: PendingCommandClarification } | null {
    const sessionHash = this.sessionHash(ownerId, sessionId);
    const row = this.db.prepare(`SELECT id, payload_ciphertext, expires_at FROM pending_command_clarifications
      WHERE owner_id = ? AND session_hash = ?`).get(ownerId, sessionHash) as Row | undefined;
    if (!row) return null;
    if (row.expires_at <= this.now()) {
      this.db.prepare("DELETE FROM pending_command_clarifications WHERE owner_id = ? AND session_hash = ? AND id = ?")
        .run(ownerId, sessionHash, row.id);
      return null;
    }
    try {
      const [version, nonce64, tag64, encrypted64] = row.payload_ciphertext.split(":");
      if (version !== VERSION || !nonce64 || !tag64 || !encrypted64) throw new Error("invalid envelope");
      const nonce = Buffer.from(nonce64, "base64"), tag = Buffer.from(tag64, "base64"), encrypted = Buffer.from(encrypted64, "base64");
      if (nonce.length !== 12 || tag.length !== 16 || !encrypted.length) throw new Error("invalid envelope");
      const decipher = createDecipheriv("aes-256-gcm", this.key, nonce);
      decipher.setAAD(this.aad(ownerId, sessionHash, row.id, row.expires_at));
      decipher.setAuthTag(tag);
      const value = JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8")) as PendingCommandClarification;
      if (!new Set(["calendar.clarify", "mail.clarify", "calendar.confirm", "mail.confirm"]).has(value.kind)) throw new Error("invalid payload");
      return { id: row.id, payload: value };
    } catch {
      this.db.prepare("DELETE FROM pending_command_clarifications WHERE owner_id = ? AND session_hash = ? AND id = ?")
        .run(ownerId, sessionHash, row.id);
      throw new Error("Pending clarification cannot be decrypted; restore the original auth.key");
    }
  }

  /** Read and consume are synchronous; the compare-delete makes a competing follow-up lose safely. */
  consume(ownerId: string, sessionId: string, expectedId: string): PendingCommandClarification | null {
    const found = this.read(ownerId, sessionId);
    if (!found || found.id !== expectedId) return null;
    const changes = this.db.prepare(`DELETE FROM pending_command_clarifications
      WHERE owner_id = ? AND session_hash = ? AND id = ? AND expires_at > ?`)
      .run(ownerId, this.sessionHash(ownerId, sessionId), expectedId, this.now()).changes;
    return changes === 1 ? found.payload : null;
  }
}
