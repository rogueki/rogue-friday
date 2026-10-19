import { createHash } from "node:crypto";
import type { Db } from "../db/database";
import { ApiError, conflict, validationFailed } from "../util/errors";
import type { MailAccountsService } from "./mail-accounts";

export interface MailSendRequest {
  to: string[]; from?: string; subject: string; body: string;
  inReplyTo?: string; references?: string;
  attachments?: Array<{ filename: string; data: string }>;
}
export interface MailSendOutcome { state: "sent" | "uncertain"; archivePending: boolean; replayed: boolean }
export interface MailReceipt {
  receiptId: string; accountId: string; state: "pending" | "sent" | "uncertain";
  archivePending: boolean; createdAt: string;
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const ADDRESS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
const hasControlCharacters = (value: string) => value.split("").some((character) => character.charCodeAt(0) <= 0x1f);

function validate(request: MailSendRequest) {
  if (!request || !Array.isArray(request.to) || request.to.length < 1 || request.to.length > 10 ||
      request.to.some((address) => typeof address !== "string" || !ADDRESS.test(address) || address.length > 254) ||
      typeof request.subject !== "string" || !request.subject || request.subject.length > 200 || /[\r\n]/.test(request.subject) ||
      typeof request.body !== "string" || Buffer.byteLength(request.body) > 100_000 ||
      (request.from !== undefined && !ADDRESS.test(request.from)) ||
      [request.inReplyTo, request.references].some((value) => value !== undefined && (typeof value !== "string" || value.length > 2000 || /[\r\n]/.test(value))) ||
      (request.attachments !== undefined && !Array.isArray(request.attachments)) ||
      (request.attachments ?? []).length > 5 || (request.attachments ?? []).some((attachment) =>
        !attachment || typeof attachment.filename !== "string" || !attachment.filename || attachment.filename.length > 200 ||
        hasControlCharacters(attachment.filename) || typeof attachment.data !== "string" ||
        attachment.data.length > 7_000_000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(attachment.data) ||
        Buffer.from(attachment.data, "base64").length > 5_000_000) ||
      Buffer.byteLength(JSON.stringify(request), "utf8") > 7_500_000) {
    throw validationFailed("E-Mail-Empfänger, Inhalt oder Anhang ist ungültig.");
  }
}

/** Persist a reservation before SMTP. A timeout is uncertain forever until explicitly reconciled. */
export class MailSendService {
  constructor(private readonly db: Db, private readonly accounts: Pick<MailAccountsService, "list" | "check" | "send" | "archive" | "probeSent">) {}

  receipts(accountId: string): MailReceipt[] {
    const rows = this.db.prepare(`SELECT key_hash, account_id, state, archive_pending, created_at
      FROM mail_send_journal WHERE account_id = ? ORDER BY created_at DESC LIMIT 50`).all(accountId) as Array<{
      key_hash: string; account_id: string; state: MailReceipt["state"]; archive_pending: number; created_at: string;
    }>;
    return rows.map((row) => ({ receiptId: row.key_hash, accountId: row.account_id, state: row.state,
      archivePending: row.archive_pending !== 0, createdAt: row.created_at }));
  }

  async review(accountId: string, receiptId: string): Promise<MailReceipt> {
    const row = this.receiptRow(accountId, receiptId);
    if (row.state === "uncertain" || row.state === "pending") {
      if (!row.message_id) return this.publicReceipt(receiptId, accountId, row);
      const result = await this.accounts.probeSent(accountId, row.message_id);
      if (result.present) {
        this.db.prepare("UPDATE mail_send_journal SET state = 'sent', archive_pending = 0, updated_at = ? WHERE key_hash = ?")
          .run(new Date().toISOString(), receiptId);
      }
    }
    return this.publicReceipt(receiptId, accountId, this.receiptRow(accountId, receiptId));
  }

  async reconcileArchive(accountId: string, receiptId: string, request: MailSendRequest): Promise<MailReceipt> {
    validate(request);
    const row = this.receiptRow(accountId, receiptId);
    if (row.state !== "sent" || row.archive_pending === 0 || !row.message_id || !row.account_hash)
      throw conflict("Nur eine bestätigte Sendung mit offener Sent-Kopie kann archiviert werden.");
    if (row.body_hash !== hash(JSON.stringify(request))) throw conflict("Die ursprüngliche Nachricht stimmt nicht mit dem Versandjournal überein.");
    const account = (await this.accounts.list()).accounts.find((item) => item.id === accountId);
    if (!account || row.account_hash !== hash(JSON.stringify([account.revision, account.email, account.senderName,
      account.signature, account.aliases, account.sentFolder])))
      throw conflict("Das Konto wurde seit dem Versand geändert. Sent-Kopie bitte manuell prüfen.");
    const stale = new Date(Date.now() - 60_000).toISOString();
    const reserved = this.db.prepare(`UPDATE mail_send_journal SET archive_pending = 2, updated_at = ?
      WHERE key_hash = ? AND account_id = ? AND (archive_pending = 1 OR archive_pending = 2 AND updated_at < ?)`)
      .run(new Date().toISOString(), receiptId, accountId, stale).changes;
    if (!reserved) throw conflict("Sent-Kopie wird bereits geprüft. Bitte später erneut laden.");
    try {
      await this.accounts.archive(accountId, { ...request, messageId: row.message_id });
      this.db.prepare("UPDATE mail_send_journal SET archive_pending = 0, updated_at = ? WHERE key_hash = ?")
        .run(new Date().toISOString(), receiptId);
    } catch {
      this.db.prepare("UPDATE mail_send_journal SET archive_pending = 1, updated_at = ? WHERE key_hash = ?")
        .run(new Date().toISOString(), receiptId);
      throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Sent-Kopie konnte nicht verifiziert werden; SMTP wurde nicht erneut aufgerufen." });
    }
    return this.publicReceipt(receiptId, accountId, this.receiptRow(accountId, receiptId));
  }

  private receiptRow(accountId: string, receiptId: string) {
    if (!/^[a-f0-9]{64}$/.test(receiptId)) throw validationFailed("Versandbeleg ist ungültig.");
    const row = this.db.prepare(`SELECT body_hash, state, archive_pending, created_at, updated_at, account_hash, message_id
      FROM mail_send_journal WHERE key_hash = ? AND account_id = ?`).get(receiptId, accountId) as {
      body_hash: string; state: MailReceipt["state"]; archive_pending: number; created_at: string;
      updated_at: string; account_hash: string | null; message_id: string | null;
    } | undefined;
    if (!row) throw validationFailed("Versandbeleg existiert in diesem Konto nicht.");
    return row;
  }

  private publicReceipt(receiptId: string, accountId: string, row: ReturnType<MailSendService["receiptRow"]>): MailReceipt {
    return { receiptId, accountId, state: row.state, archivePending: row.archive_pending !== 0, createdAt: row.created_at };
  }

  receipt(accountId: string, actor: string, key: string): { eventId: string; receiptId: string; occurredAt: string } {
    const keyHash = hash(actor + "\n" + accountId + "\n" + key);
    const row = this.lookup(keyHash);
    if (!row) throw new Error("Mail send receipt missing");
    return { eventId: "mail:" + keyHash.slice(0, 48), receiptId: keyHash, occurredAt: row.created_at };
  }

  async send(accountId: string, request: MailSendRequest, actor: string, key: string): Promise<MailSendOutcome> {
    validate(request);
    if (!actor || !key || key.length < 8 || key.length > 128) throw validationFailed("Idempotency-Key fehlt oder ist ungültig.");
    const keyHash = hash(`${actor}\n${accountId}\n${key}`);
    const bodyHash = hash(JSON.stringify(request));
    const existing = this.lookup(keyHash);
    if (existing) return this.replay(existing, bodyHash);
    const catalog = await this.accounts.list();
    const account = catalog.accounts.find((item) => item.id === accountId);
    if (account && request.from && ![account.email, ...account.aliases].includes(request.from))
      throw validationFailed("Die Absenderadresse gehört nicht zu diesem Mail Postfach.");
    if (!account || !account.secretState.smtpPassword) throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "SMTP für dieses Mail Postfach ist nicht eingerichtet." });
    const accountHash = hash(JSON.stringify([account.revision, account.email, account.senderName, account.signature,
      account.aliases, account.sentFolder]));
    const messageId = "<friday-" + keyHash + "@friday.local>";
    try { if (!(await this.accounts.check(accountId, "smtp")).ok) throw new Error("auth"); }
    catch { throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "SMTP-Anmeldung ist fehlgeschlagen; es wurde nichts versendet." }); }
    const now = new Date().toISOString();
    const inserted = this.db.prepare(`INSERT OR IGNORE INTO mail_send_journal
      (key_hash, actor, account_id, body_hash, state, archive_pending, created_at, updated_at, account_hash, message_id)
      VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?)`).run(keyHash, actor, accountId, bodyHash, now, now, accountHash, messageId).changes;
    if (!inserted) return this.replay(this.lookup(keyHash)!, bodyHash);
    try {
      const result = await this.accounts.send(accountId, { ...request, messageId });
      if (result.state === "uncertain") {
        this.db.prepare("UPDATE mail_send_journal SET state = 'uncertain', archive_pending = ?, updated_at = ? WHERE key_hash = ?")
          .run(result.archivePending ? 1 : 0, new Date().toISOString(), keyHash);
        return { state: "uncertain", archivePending: result.archivePending, replayed: false };
      }
      this.db.prepare("UPDATE mail_send_journal SET state = 'sent', archive_pending = ?, updated_at = ? WHERE key_hash = ?")
        .run(result.archivePending ? 1 : 0, new Date().toISOString(), keyHash);
      return { state: "sent", archivePending: result.archivePending, replayed: false };
    } catch {
      this.db.prepare("UPDATE mail_send_journal SET state = 'uncertain', updated_at = ? WHERE key_hash = ?")
        .run(new Date().toISOString(), keyHash);
      return { state: "uncertain", archivePending: false, replayed: false };
    }
  }

  private lookup(key: string): { body_hash: string; state: string; archive_pending: number; created_at: string } | undefined {
    return this.db.prepare("SELECT body_hash, state, archive_pending, created_at FROM mail_send_journal WHERE key_hash = ?")
      .get(key) as { body_hash: string; state: string; archive_pending: number; created_at: string } | undefined;
  }

  private replay(row: { body_hash: string; state: string; archive_pending: number }, bodyHash: string): MailSendOutcome {
    if (row.body_hash !== bodyHash) throw conflict("Dieser Versand-Schlüssel wurde für eine andere Nachricht verwendet.");
    return { state: row.state === "sent" ? "sent" : "uncertain", archivePending: row.archive_pending !== 0, replayed: true };
  }
}
