import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Db } from "../db/database";
import { kvGet, kvSet } from "../db/database";
import { ApiError, conflict, validationFailed } from "../util/errors";

const PROFILE_KEY = "telephony.cloudtalk.profile";
const E164 = /^\+[1-9]\d{7,14}$/;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
type Profile = { revision: number; agentId?: number; accessKeyId: string; accessKeySecret: string;
  ownerId?: string; ownerPhone?: string; ownerPhoneConfirmed?: boolean; voiceAgentId?: string; remindersEnabled?: boolean; reminderMinutes?: number };
type ConfigureInput = { agentId?: number; accessKeyId: string; accessKeySecret: string;
  ownerPhone?: string; ownerPhoneConfirmed?: boolean; voiceAgentId?: string; remindersEnabled?: boolean; reminderMinutes?: number };
type ReminderEvent = { id: string; owner_id: string; version: number; title: string; starts_at: string; time_zone: string };
type CallRow = { id: string; key_hash: string; request_hash: string; actor: string; destination: string;
  state: "pending" | "requested" | "rejected" | "unknown"; provider_status: number | null; created_at: string; updated_at: string };

export class CloudTalkService {
  private remindersRunning = false;
  constructor(private readonly db: Db, private readonly key: Buffer,
    private readonly request: typeof fetch = fetch, private readonly now: () => number = Date.now,
    private readonly ownerName: () => string = () => "Owner") {
    if (key.length !== 32) throw new Error("CloudTalk encryption key is invalid");
    this.readProfile();
    this.db.prepare("UPDATE cloudtalk_calls SET state = 'unknown', updated_at = ? WHERE state = 'pending'")
      .run(new Date(now()).toISOString());
    this.db.prepare("UPDATE cloudtalk_reminder_calls SET state = 'unknown', updated_at = ? WHERE state = 'pending'")
      .run(new Date(now()).toISOString());
  }

  private readProfile(): Profile | null {
    const stored = kvGet(this.db, PROFILE_KEY);
    if (!stored) return null;
    try {
      const [version, nonce64, tag64, cipher64] = stored.split(":");
      if (version !== "v1" || !nonce64 || !tag64 || !cipher64) throw new Error("invalid envelope");
      const nonce = Buffer.from(nonce64, "base64");
      const tag = Buffer.from(tag64, "base64");
      if (nonce.length !== 12 || tag.length !== 16) throw new Error("invalid envelope");
      const decipher = createDecipheriv("aes-256-gcm", this.key, nonce);
      decipher.setAAD(Buffer.from(PROFILE_KEY));
      decipher.setAuthTag(tag);
      const profile = JSON.parse(Buffer.concat([decipher.update(Buffer.from(cipher64, "base64")), decipher.final()]).toString("utf8")) as Profile;
      if (!Number.isSafeInteger(profile.revision) || (profile.agentId !== undefined && !Number.isSafeInteger(profile.agentId)) ||
        !profile.accessKeyId || !profile.accessKeySecret) throw new Error("invalid profile");
      return profile;
    } catch { throw new Error("CloudTalk profile cannot be decrypted; restore the original auth.key"); }
  }

  status() {
    const profile = this.readProfile();
    const last = profile?.ownerId ? this.db.prepare("SELECT state, created_at FROM cloudtalk_reminder_calls WHERE owner_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(profile.ownerId) as { state: string; created_at: string } | undefined : undefined;
    return { configured: profile !== null, agentId: profile?.agentId ?? null, revision: profile?.revision ?? 0,
      ownerPhone: profile?.ownerPhone ?? null, voiceAgentId: profile?.voiceAgentId ?? null,
      remindersEnabled: profile?.remindersEnabled === true, reminderMinutes: profile?.reminderMinutes ?? 15,
      lastReminderState: last?.state ?? null, lastReminderAt: last?.created_at ?? null,
      note: "API-Zugang gespeichert; Agentenstatus, Rufnummer und tatsächlicher Anruf sind nicht geprüft." };
  }

  configure(input: ConfigureInput, revision: number, ownerId?: string) {
    const current = this.readProfile();
    if (revision !== (current?.revision ?? 0)) throw conflict("CloudTalk-Konfiguration wurde geändert. Bitte neu laden.");
    if ((input.agentId !== undefined && (!Number.isSafeInteger(input.agentId) || input.agentId <= 0 || input.agentId > 2147483647)) ||
      typeof input.accessKeyId !== "string" || input.accessKeyId.length < 4 || input.accessKeyId.length > 200 ||
      typeof input.accessKeySecret !== "string" || input.accessKeySecret.length < 8 || input.accessKeySecret.length > 500) {
      throw validationFailed("CloudTalk Agent-ID oder API-Schlüssel sind ungültig.");
    }
    const ownerPhone = input.ownerPhone?.trim();
    const voiceAgentId = input.voiceAgentId?.trim();
    const reminderMinutes = input.reminderMinutes ?? 15;
    if ((ownerPhone && !E164.test(ownerPhone)) || (voiceAgentId && !/^[A-Za-z0-9_-]{1,100}$/.test(voiceAgentId)) ||
      !Number.isSafeInteger(reminderMinutes) || reminderMinutes < 1 || reminderMinutes > 120 ||
      (input.remindersEnabled === true && (!ownerId || !ownerPhone || !voiceAgentId || input.ownerPhoneConfirmed !== true))) {
      throw validationFailed("Fuer Erinnerungsanrufe sind Owner, E.164-Rufnummer, VoiceAgent-ID und 1-120 Minuten Vorlauf erforderlich.");
    }
    const profile: Profile = { ...input, ownerId, ownerPhone, voiceAgentId, reminderMinutes,
      remindersEnabled: input.remindersEnabled === true, revision: revision + 1 };
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    cipher.setAAD(Buffer.from(PROFILE_KEY));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(profile), "utf8"), cipher.final()]);
    kvSet(this.db, PROFILE_KEY, ["v1", nonce.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(":"));
    return this.status();
  }

  /** One pass over due owner events. A durable reservation precedes every external POST. */
  async tickReminders(): Promise<void> {
    if (this.remindersRunning) return;
    this.remindersRunning = true;
    try {
      const profile = this.readProfile();
      if (!profile?.remindersEnabled || profile.ownerPhoneConfirmed !== true || !profile.ownerId || !profile.ownerPhone || !profile.voiceAgentId ||
        !E164.test(profile.ownerPhone)) return;
      const now = this.now();
      const rows = this.db.prepare(`SELECT id, owner_id, version, title, starts_at, time_zone FROM local_calendar_events
        WHERE owner_id = ? AND starts_at > ? AND starts_at <= ? ORDER BY starts_at, id LIMIT 10`)
        .all(profile.ownerId, new Date(now).toISOString(), new Date(now + (profile.reminderMinutes ?? 15) * 60_000).toISOString()) as unknown as ReminderEvent[];
      for (const row of rows) {
        const localHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: row.time_zone, hour: "2-digit", hourCycle: "h23" }).format(now));
        if (localHour < 8 || localHour >= 20) continue;
        const time = new Date(this.now()).toISOString();
        this.db.exec("BEGIN IMMEDIATE");
        let reserved = false;
        try {
          const recent = this.db.prepare("SELECT count(*) AS n FROM cloudtalk_reminder_calls WHERE owner_id = ? AND created_at >= ?")
            .get(profile.ownerId, new Date(this.now() - 3_600_000).toISOString()) as { n: number };
          if (recent.n < 5) {
            reserved = this.db.prepare(`INSERT OR IGNORE INTO cloudtalk_reminder_calls
              (event_id,event_version,owner_id,destination,state,created_at,updated_at)
              SELECT id,version,owner_id,?,'pending',?,? FROM local_calendar_events
              WHERE id = ? AND owner_id = ? AND version = ? AND starts_at = ?`)
              .run(profile.ownerPhone, time, time, row.id, profile.ownerId, row.version, row.starts_at).changes === 1;
          }
          this.db.exec("COMMIT");
        } catch (error) { this.db.exec("ROLLBACK"); throw error; }
        if (!reserved) continue;
        let state: "requested" | "rejected" | "unknown" = "unknown";
        let providerStatus: number | null = null;
        try {
          const current = this.db.prepare("SELECT 1 FROM local_calendar_events WHERE id = ? AND owner_id = ? AND version = ? AND starts_at = ?")
            .get(row.id, row.owner_id, row.version, row.starts_at);
          if (!current || Date.parse(row.starts_at) <= this.now() || this.readProfile()?.revision !== profile.revision) state = "rejected";
          else {
            const appointmentTime = new Intl.DateTimeFormat("de-DE", { timeZone: row.time_zone,
              dateStyle: "full", timeStyle: "short" }).format(new Date(row.starts_at));
            const basic = Buffer.from(`${profile.accessKeyId}:${profile.accessKeySecret}`).toString("base64");
            const response = await this.request("https://api.cloudtalk.io/v1/voice-agent/calls", {
              method: "POST", redirect: "error", signal: AbortSignal.timeout(12_000),
              headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify({ call_number: profile.ownerPhone, voice_agent_id: profile.voiceAgentId,
                call_properties: { system_prompt: { variables: { contact_name: this.ownerName(),
                  appointment_time: `${appointmentTime} (${row.title})` } } } }),
            });
            providerStatus = response.status;
            if (response.ok) state = "requested";
            else if (response.status >= 400 && response.status < 500) state = "rejected";
          }
        } catch { /* The provider may have accepted the request; never retry an unknown outcome. */ }
        this.db.prepare("UPDATE cloudtalk_reminder_calls SET state = ?, provider_status = ?, updated_at = ? WHERE event_id = ? AND event_version = ?")
          .run(state, providerStatus, new Date(this.now()).toISOString(), row.id, row.version);
      }
    } finally { this.remindersRunning = false; }
  }

  preview(destination: string, actor: string) {
    const profile = this.readProfile();
    if (!profile) throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "CloudTalk-API-Zugang fehlt." });
    if (!profile.agentId) throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "CloudTalk Agent-ID fuer den klassischen API-Ruf fehlt." });
    if (!E164.test(destination)) throw validationFailed("Zielnummer muss im E.164-Format sein.");
    const expires = this.now() + 120000;
    const body = Buffer.from(JSON.stringify({ actor, destination, revision: profile.revision, expires })).toString("base64url");
    const token = `${body}.${createHmac("sha256", this.key).update(body).digest("base64url")}`;
    this.db.prepare("DELETE FROM cloudtalk_previews WHERE expires_at < ?").run(this.now());
    this.db.prepare("INSERT INTO cloudtalk_previews (token_hash,actor,destination,expires_at) VALUES (?,?,?,?)")
      .run(hash(token), actor, destination, expires);
    return { destination, agentId: profile.agentId, expiresAt: new Date(expires).toISOString(), token,
      note: "CloudTalk ruft zuerst den Agenten an (20 Sekunden zum Abheben), danach die Zielnummer." };
  }

  async originate(destination: string, token: string, actor: string, idempotencyKey: string) {
    if (idempotencyKey.length < 8 || idempotencyKey.length > 128) throw validationFailed("Idempotency-Key ist erforderlich.");
    const keyHash = hash(`${actor}\n${idempotencyKey}`);
    const requestHash = hash(`${actor}\n${destination}`);
    const existing = this.db.prepare("SELECT * FROM cloudtalk_calls WHERE key_hash = ?").get(keyHash) as CallRow | undefined;
    if (existing) return this.replay(existing, requestHash);
    const profile = this.readProfile();
    if (!profile) throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "CloudTalk-API-Zugang fehlt." });
    if (!profile.agentId) throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "CloudTalk Agent-ID fuer den klassischen API-Ruf fehlt." });
    if (!E164.test(destination)) throw validationFailed("Zielnummer muss im E.164-Format sein.");
    const [body, signature, extra] = token.split(".");
    if (!body || !signature || extra || body.length > 1024 || signature.length > 100) throw validationFailed("CloudTalk-Vorschau ist ungültig.");
    const expected = createHmac("sha256", this.key).update(body).digest();
    const given = Buffer.from(signature, "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw validationFailed("CloudTalk-Vorschau ist ungültig.");
    let claims: { actor?: string; destination?: string; revision?: number; expires?: number };
    try { claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as typeof claims; }
    catch { throw validationFailed("CloudTalk-Vorschau ist ungültig."); }
    if (claims.actor !== actor || claims.destination !== destination || claims.revision !== profile.revision ||
      !claims.expires || claims.expires < this.now() || claims.expires > this.now() + 120000) throw conflict("CloudTalk-Vorschau ist abgelaufen.");
    const id = `ctcall_${randomBytes(16).toString("hex")}`;
    const time = new Date(this.now()).toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    let inserted: number;
    try {
      const since = new Date(this.now() - 3600000).toISOString();
      const recent = this.db.prepare("SELECT count(*) AS n FROM cloudtalk_calls WHERE actor = ? AND created_at >= ?").get(actor, since) as { n: number };
      if (recent.n >= 5) throw new ApiError({ code: "RATE_LIMITED", status: 429, message: "Maximal fünf CloudTalk-Rufversuche pro Stunde." });
      const consumed = this.db.prepare(`UPDATE cloudtalk_previews SET consumed_at = ? WHERE token_hash = ? AND actor = ? AND destination = ? AND consumed_at IS NULL AND expires_at >= ?`)
        .run(this.now(), hash(token), actor, destination, this.now()).changes;
      if (!consumed) throw conflict("CloudTalk-Vorschau wurde bereits benutzt oder ist abgelaufen.");
      inserted = Number(this.db.prepare(`INSERT OR IGNORE INTO cloudtalk_calls
        (id,key_hash,actor,request_hash,destination,state,created_at,updated_at) VALUES (?,?,?,?,?,'pending',?,?)`)
        .run(id, keyHash, actor, requestHash, destination, time, time).changes);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    if (!inserted) return this.replay(this.db.prepare("SELECT * FROM cloudtalk_calls WHERE key_hash = ?").get(keyHash) as CallRow, requestHash);
    let state: CallRow["state"] = "unknown";
    let providerStatus: number | null = null;
    try {
      const basic = Buffer.from(`${profile.accessKeyId}:${profile.accessKeySecret}`).toString("base64");
      const response = await this.request("https://api.cloudtalk.io/api/calls/create.json", {
        method: "POST", headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json", Accept: "application/json", "User-Agent": "Friday/1.0" },
        body: JSON.stringify({ agent_id: profile.agentId, callee_number: destination }), signal: AbortSignal.timeout(12000), redirect: "error",
      });
      providerStatus = response.status;
      if (response.status >= 400 && response.status < 500) state = "rejected";
      else if (response.ok) {
        const result = await response.json() as { responseData?: { status?: number } };
        state = result.responseData?.status === 200 ? "requested" : "unknown";
      }
    } catch { /* The request may have reached CloudTalk; never retry this key or claim it failed. */ }
    this.db.prepare("UPDATE cloudtalk_calls SET state = ?, provider_status = ?, updated_at = ? WHERE id = ?")
      .run(state, providerStatus, new Date(this.now()).toISOString(), id);
    return { id, destination, state, providerStatus, createdAt: time, updatedAt: new Date(this.now()).toISOString(), replayed: false,
      note: "requested bestätigt nur CloudTalk-API-Annahme, weder Agentenabnahme noch Zielverbindung." };
  }

  private replay(row: CallRow, requestHash: string) {
    if (row.request_hash !== requestHash) throw conflict("Idempotency-Key wurde für eine andere Nummer benutzt.");
    return { id: row.id, destination: row.destination, state: row.state, providerStatus: row.provider_status,
      createdAt: row.created_at, updatedAt: row.updated_at, replayed: true,
      note: "Journalzustand; kein zweiter API-Aufruf. Zielverbindung nicht bestätigt." };
  }
}
