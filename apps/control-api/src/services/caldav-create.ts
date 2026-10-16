import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { AdapterRegistry, CallContext } from "@friday/adapter-core";
import type { Db } from "../db/database";
import { ApiError, conflict, validationFailed } from "../util/errors";

export interface CalDavEventInput { title: string; start: string; end: string }
export interface CalDavCreateInput extends CalDavEventInput { confirmationToken: string }
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

function checked(input: CalDavEventInput): CalDavEventInput {
  if (!input || typeof input.title !== "string" || typeof input.start !== "string" || typeof input.end !== "string") throw validationFailed("Termindaten fehlen.");
  const title = input.title.trim();
  if (!title || [...title].length > 120 || Buffer.byteLength(title) > 500 || [...title].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw validationFailed("Titel ist ungueltig.");
  const start = Date.parse(input.start);
  const end = Date.parse(input.end);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(input.start) ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(input.end) ||
      !Number.isFinite(start) || !Number.isFinite(end) || start < Date.now() - 86_400_000 || end <= start || end - start > 7 * 86_400_000 || start > Date.now() + 366 * 86_400_000) {
    throw validationFailed("Start und Ende muessen einen gueltigen Termin innerhalb eines Jahres und bis zu sieben Tagen Dauer beschreiben.");
  }
  return { title, start: new Date(start).toISOString(), end: new Date(end).toISOString() };
}

/** Explicit two-step owner confirmation. Tokens bind actor, operation key, content and expiry. */
export class CalDavCreateService {
  constructor(private readonly db: Db, private readonly registry: AdapterRegistry, private readonly secret: Buffer, private readonly currentTarget: () => string) {}

  private available(): void {
    if (!this.registry.aggregateCapabilities().modules.calendar.create) throw new ApiError({ code: "CAPABILITY_MISSING", message: "CalDAV-Terminanlage ist nicht verfuegbar." });
    const entry = this.registry.listAdapters().find((adapter) => adapter.manifest.category === "calendar");
    if (entry?.provider !== "caldav-calendar") throw new ApiError({ code: "CAPABILITY_MISSING", message: "Ein expliziter CalDAV-Kalender ist erforderlich." });
  }

  private fingerprint(input: CalDavEventInput, actor: string, key: string, expires: number): string {
    return createHmac("sha256", this.secret).update(JSON.stringify([input, actor, key, expires, this.currentTarget()])).digest("hex");
  }

  preview(input: CalDavEventInput, actor: string, key: string): { title: string; start: string; end: string; confirmationToken: string; expiresAt: string } {
    this.available();
    if (!actor || !key || key.length < 8 || key.length > 128) throw validationFailed("Idempotency-Key fehlt oder ist ungueltig.");
    const event = checked(input);
    const expires = Date.now() + 5 * 60_000;
    return { ...event, confirmationToken: `${expires}.${this.fingerprint(event, actor, key, expires)}`, expiresAt: new Date(expires).toISOString() };
  }

  async create(input: CalDavCreateInput, actor: string, key: string, call: CallContext): Promise<{ state: "created" | "unknown"; replayed: boolean }> {
    const event = checked(input);
    if (!actor || !key || key.length < 8 || key.length > 128) throw validationFailed("Idempotency-Key fehlt oder ist ungueltig.");
    const match = /^(\d{13})\.([a-f0-9]{64})$/.exec(input.confirmationToken ?? "");
    const expires = Number(match?.[1]);
    const expected = this.fingerprint(event, actor, key, expires);
    if (!match || !Number.isSafeInteger(expires) || Date.now() > expires || !timingSafeEqual(Buffer.from(match[2]!, "hex"), Buffer.from(expected, "hex"))) {
      throw new ApiError({ code: "APPROVAL_REQUIRED", message: "Die Terminvorschau muss erneut bestaetigt werden." });
    }
    const keyHash = digest(`${actor}\n${key}`);
    const bodyHash = digest(JSON.stringify(event));
    const existing = this.lookup(keyHash);
    if (existing) return this.replay(existing, bodyHash);
    this.available();
    const now = new Date().toISOString();
    const inserted = this.db.prepare(`INSERT OR IGNORE INTO caldav_create_journal
      (key_hash, actor, body_hash, state, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?)`).run(keyHash, actor, bodyHash, now, now).changes;
    if (!inserted) return this.replay(this.lookup(keyHash)!, bodyHash);
    // Stable UID/URI; reservation is durable before the only external PUT. The registry sees no retry key.
    const uid = digest(`${actor}\n${key}\n${bodyHash}`).slice(0, 32);
    try {
      await this.registry.getPort("calendar").createCalendarEvent!({ body: { ...event, uid } }, call);
      this.db.prepare("UPDATE caldav_create_journal SET state = 'created', updated_at = ? WHERE key_hash = ?").run(new Date().toISOString(), keyHash);
      return { state: "created", replayed: false };
    } catch {
      this.db.prepare("UPDATE caldav_create_journal SET state = 'unknown', updated_at = ? WHERE key_hash = ?").run(new Date().toISOString(), keyHash);
      return { state: "unknown", replayed: false };
    }
  }

  private lookup(keyHash: string): { body_hash: string; state: string } | undefined {
    return this.db.prepare("SELECT body_hash, state FROM caldav_create_journal WHERE key_hash = ?").get(keyHash) as { body_hash: string; state: string } | undefined;
  }
  private replay(row: { body_hash: string; state: string }, bodyHash: string): { state: "created" | "unknown"; replayed: boolean } {
    if (row.body_hash !== bodyHash) throw conflict("Dieser Terminschluessel wurde bereits mit anderen Daten verwendet.");
    return { state: row.state === "created" ? "created" : "unknown", replayed: true };
  }
}
