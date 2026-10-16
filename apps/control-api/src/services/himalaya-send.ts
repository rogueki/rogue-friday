import { createHash } from "node:crypto";
import type { Db } from "../db/database";
import { ApiError, conflict, validationFailed } from "../util/errors";
import type { HimalayaAccountService } from "./himalaya-account";

export interface HimalayaSendRequest { to: string[]; subject: string; body: string }
export interface HimalayaSendOutcome { state: "sent" | "unknown"; replayed: boolean }

const ADDRESS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const hasInvalidControl = (value: string, allowLineBreaks: boolean): boolean =>
  [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code === 127 || (code < 32 && !(allowLineBreaks && (code === 9 || code === 10)));
  });

function validate(input: HimalayaSendRequest): void {
  if (!input || !Array.isArray(input.to) || input.to.length < 1 || input.to.length > 10 ||
      new Set(input.to).size !== input.to.length || !input.to.every((address) => typeof address === "string" && address.length <= 254 && ADDRESS.test(address)) ||
      typeof input.subject !== "string" || input.subject.length < 1 || input.subject.length > 200 || hasInvalidControl(input.subject, false) ||
      typeof input.body !== "string" || Buffer.byteLength(input.body, "utf8") < 1 || Buffer.byteLength(input.body, "utf8") > 100000 || hasInvalidControl(input.body, true)) {
    throw validationFailed("E-Mail-Adresse, Betreff oder Nachrichtentext ist ungueltig.");
  }
}

/** Reservation is committed before SMTP. Pending rows are unknown after process restart and are never retried. */
export class HimalayaSendService {
  constructor(private readonly db: Db, private readonly account: Pick<HimalayaAccountService, "status" | "sendRaw">) {}

  async send(input: HimalayaSendRequest, actor: string, key: string): Promise<HimalayaSendOutcome> {
    validate(input);
    if (!key || !actor) throw validationFailed("Ein Idempotency-Key ist fuer E-Mail-Versand erforderlich.");
    const keyHash = digest(`${actor}\n${key}`);
    const bodyHash = digest(JSON.stringify(input));
    const existing = this.lookup(keyHash);
    if (existing) return this.replay(existing, bodyHash);
    let ready: Awaited<ReturnType<HimalayaAccountService["status"]>>;
    try { ready = await this.account.status(); }
    catch { throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "SMTP-Postfach ist nicht erreichbar.", details: { stage: "preflight" } }); }
    if (!ready.readyForLocalUse) throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "SMTP-Postfach ist nicht eingerichtet.", details: { stage: "preflight" } });
    const now = new Date().toISOString();
    const inserted = this.db.prepare(`INSERT OR IGNORE INTO himalaya_send_journal
      (key_hash, actor, body_hash, state, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?)`).run(keyHash, actor, bodyHash, now, now).changes;
    if (!inserted) return this.replay(this.lookup(keyHash)!, bodyHash);
    try {
      await this.account.sendRaw(input);
      this.db.prepare("UPDATE himalaya_send_journal SET state = 'sent', updated_at = ? WHERE key_hash = ?").run(new Date().toISOString(), keyHash);
      return { state: "sent", replayed: false };
    } catch {
      this.db.prepare("UPDATE himalaya_send_journal SET state = 'unknown', updated_at = ? WHERE key_hash = ?").run(new Date().toISOString(), keyHash);
      return { state: "unknown", replayed: false };
    }
  }

  private lookup(keyHash: string): { body_hash: string; state: string } | undefined {
    return this.db.prepare("SELECT body_hash, state FROM himalaya_send_journal WHERE key_hash = ?")
      .get(keyHash) as { body_hash: string; state: string } | undefined;
  }

  private replay(row: { body_hash: string; state: string }, bodyHash: string): HimalayaSendOutcome {
    if (row.body_hash !== bodyHash) throw conflict("Dieser Versand-Schluessel wurde fuer eine andere Nachricht verwendet.");
    return { state: row.state === "sent" ? "sent" : "unknown", replayed: true };
  }
}
