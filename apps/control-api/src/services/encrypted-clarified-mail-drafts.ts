import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import type { Db } from "../db/database";
import type { MailSendRequest } from "./mail-send";

interface DraftRow { id: string; intent_hash: string; payload_ciphertext: string; expires_at: number }
const VERSION = "v1";
const PURPOSE = "friday/encrypted-clarified-mail-draft/v1";
const TTL_MS = 5 * 60_000;

/** Short-lived mail body storage for clarification-created native previews. */
export class EncryptedClarifiedMailDrafts {
  constructor(private readonly db: Db, private readonly key: Buffer, private readonly now: () => number = Date.now) {
    if (key.length !== 32) throw new Error("Clarified mail draft encryption key is invalid");
    const row = db.prepare("SELECT id, owner_id, session_binding, intent_hash, payload_ciphertext, expires_at FROM encrypted_clarified_mail_drafts WHERE expires_at > ? LIMIT 1")
      .get(now()) as (DraftRow & { owner_id: string; session_binding: string }) | undefined;
    if (row) this.decrypt(row.owner_id, row.session_binding, row);
  }

  static hasPersisted(db: Db): boolean {
    return Boolean(db.prepare("SELECT 1 AS present FROM encrypted_clarified_mail_drafts LIMIT 1").get());
  }

  private aad(ownerId: string, sessionBinding: string, id: string, intentHash: string): Buffer {
    return Buffer.from(`${PURPOSE}\n${ownerId}\n${sessionBinding}\n${id}\n${intentHash}`, "utf8");
  }

  create(ownerId: string, sessionBinding: string, intentHash: string, body: MailSendRequest): { id: string; expiresAt: number } {
    const id = randomUUID();
    const expiresAt = this.now() + TTL_MS;
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    cipher.setAAD(this.aad(ownerId, sessionBinding, id, intentHash));
    const plaintext = Buffer.from(JSON.stringify(body), "utf8");
    if (plaintext.byteLength > 256_000) throw new Error("Clarified mail draft exceeds limit");
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const envelope = [VERSION, nonce.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(":");
    this.db.prepare(`INSERT INTO encrypted_clarified_mail_drafts
      (id, owner_id, session_binding, intent_hash, payload_ciphertext, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, ownerId, sessionBinding, intentHash, envelope, expiresAt, this.now());
    return { id, expiresAt };
  }

  private decrypt(ownerId: string, sessionBinding: string, row: DraftRow): MailSendRequest {
    try {
      const [version, nonce64, tag64, encrypted64] = row.payload_ciphertext.split(":");
      if (version !== VERSION || !nonce64 || !tag64 || !encrypted64) throw new Error("invalid envelope");
      const nonce = Buffer.from(nonce64, "base64"), tag = Buffer.from(tag64, "base64"), encrypted = Buffer.from(encrypted64, "base64");
      if (nonce.length !== 12 || tag.length !== 16 || !encrypted.length) throw new Error("invalid envelope");
      const decipher = createDecipheriv("aes-256-gcm", this.key, nonce);
      decipher.setAAD(this.aad(ownerId, sessionBinding, row.id, row.intent_hash));
      decipher.setAuthTag(tag);
      return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8")) as MailSendRequest;
    } catch {
      throw new Error("Clarified mail draft cannot be decrypted; restore the original auth.key and preserve the encrypted row");
    }
  }

  private find(ownerId: string, sessionBinding: string, id: string, intentHash: string): DraftRow | null {
    const row = this.db.prepare(`SELECT id, intent_hash, payload_ciphertext, expires_at
      FROM encrypted_clarified_mail_drafts WHERE id = ? AND owner_id = ? AND session_binding = ? AND intent_hash = ?`)
      .get(id, ownerId, sessionBinding, intentHash) as DraftRow | undefined;
    if (!row) return null;
    if (row.expires_at <= this.now()) {
      this.delete(ownerId, sessionBinding, id);
      this.removeUnconfirmedPreview(id);
      return null;
    }
    return row;
  }

  read(ownerId: string, sessionBinding: string, id: string, intentHash: string): MailSendRequest | null {
    const row = this.find(ownerId, sessionBinding, id, intentHash);
    return row ? this.decrypt(ownerId, sessionBinding, row) : null;
  }

  consume(ownerId: string, sessionBinding: string, id: string, intentHash: string): MailSendRequest | null {
    const row = this.find(ownerId, sessionBinding, id, intentHash);
    if (!row) return null;
    const body = this.decrypt(ownerId, sessionBinding, row);
    const deleted = this.db.prepare(`DELETE FROM encrypted_clarified_mail_drafts
      WHERE id = ? AND owner_id = ? AND session_binding = ? AND intent_hash = ? AND expires_at > ?`)
      .run(id, ownerId, sessionBinding, intentHash, this.now()).changes;
    return deleted === 1 ? body : null;
  }

  extend(ownerId: string, sessionBinding: string, id: string, intentHash: string, expiresAt: number): void {
    this.db.prepare(`UPDATE encrypted_clarified_mail_drafts SET expires_at = ? WHERE id = ? AND owner_id = ?
      AND session_binding = ? AND intent_hash = ? AND expires_at > ?`)
      .run(expiresAt, id, ownerId, sessionBinding, intentHash, this.now());
  }

  delete(ownerId: string, sessionBinding: string, id: string): void {
    this.db.prepare(`DELETE FROM encrypted_clarified_mail_drafts WHERE id = ? AND owner_id = ? AND session_binding = ?`)
      .run(id, ownerId, sessionBinding);
  }

  purgeExpired(): number {
    const expired = this.db.prepare(`SELECT id FROM encrypted_clarified_mail_drafts WHERE expires_at <= ?`).all(this.now()) as Array<{ id: string }>;
    if (!expired.length) return 0;
    const ids = expired.map((row) => row.id);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const placeholders = ids.map(() => "?").join(",");
      this.db.prepare(`DELETE FROM native_approval_requests WHERE state = 'draft'
        AND json_extract(action_json, '$.kind') = 'mail.send.clarified'
        AND json_extract(action_json, '$.draftId') IN (${placeholders})`).run(...ids);
      const removed = this.db.prepare(`DELETE FROM encrypted_clarified_mail_drafts WHERE expires_at <= ?`).run(this.now()).changes;
      this.db.exec("COMMIT");
      return Number(removed);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private removeUnconfirmedPreview(id: string): void {
    this.db.prepare(`DELETE FROM native_approval_requests WHERE state = 'draft'
      AND json_extract(action_json, '$.kind') = 'mail.send.clarified'
      AND json_extract(action_json, '$.draftId') = ?`).run(id);
  }
}
