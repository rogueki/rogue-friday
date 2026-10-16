import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Db } from "../db/database";
import { ApiError, conflict, notFound, validationFailed } from "../util/errors";
import { invokeCodingRunner, type RunnerInvoker } from "./coding-runs";

export interface TelephonyStatus {
  configured: boolean; mode: "local" | "trunk" | null; ariReachable: boolean;
  registration: "unavailable" | "unknown" | "unregistered" | "registered" | "not_required";
  ownerEndpoint: "unknown" | "online" | "offline"; configurationApplied: boolean; dialplanLoaded: boolean; ready: boolean;
  revision: number; callerId: string | null;
}
export interface TelephonyProfile {
  mode: "local" | "trunk"; ariUser: string; ariPassword: string; ariPort: number;
  ownerEndpoint: string; callerId: string; sipHost?: string; sipUser?: string; sipPassword?: string;
}
export interface TelephonyCall {
  id: string; destination: string; state: "pending" | "requested" | "owner_answered" | "ended" | "failed" | "unknown";
  adapterStatus: number | null; createdAt: string; updatedAt: string; replayed?: boolean;
}
type CallRow = { id: string; key_hash: string; actor: string; request_hash: string; destination: string;
  state: TelephonyCall["state"]; adapter_status: number | null; created_at: string; updated_at: string };
const E164 = /^\+[1-9][0-9]{6,14}$/;
const EXTENSION = /^[1-9][0-9]{2,5}$/;
const LABEL = /^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/;
const HOST = /^[a-zA-Z0-9.-]{1,253}$/;
const SECRET = /^[A-Za-z0-9!@#$%^&*()_+,.?/-]{12,200}$/;
const SIP_SECRET = /^[A-Za-z0-9!@#$%^&*()_+,.?/-]{1,200}$/;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const unavailable = (message: string) => new ApiError({ code: "ADAPTER_UNAVAILABLE", message });

/** The SIP trunk itself runs in Asterisk; Friday never accepts an arbitrary ARI URL or shell command. */
export class TelephonyService {
  constructor(private readonly db: Db, private readonly dataDir: string, private readonly previewKey: Buffer,
    private readonly invoke: RunnerInvoker = invokeCodingRunner, private readonly now: () => number = Date.now) {
    this.db.prepare("UPDATE telephony_calls SET state = 'unknown', updated_at = ? WHERE state = 'pending'")
      .run(new Date(this.now()).toISOString());
  }

  private target(): { script: string; distro: string; user: string } {
    let root = resolve(this.dataDir);
    for (let depth = 0; depth < 5 && !existsSync(join(root, "config", "install-state.json")); depth += 1) root = resolve(root, "..");
    let state: { distro_name?: string; linux_user?: string };
    try { state = JSON.parse(readFileSync(join(root, "config", "install-state.json"), "utf8").replace(/^\uFEFF/, "")) as typeof state; }
    catch { throw unavailable("Friday-Ubuntu ist nicht konfiguriert."); }
    if (!state.distro_name || !state.linux_user || !/^[a-zA-Z0-9_.-]+$/.test(state.distro_name) ||
        !/^[a-zA-Z0-9_-]+$/.test(state.linux_user)) throw unavailable("Friday-Ubuntu ist nicht konfiguriert.");
    const drive = root.match(/^([a-zA-Z]):\\(.*)$/);
    if (!drive) throw unavailable("Der Installationspfad kann WSL nicht zugeordnet werden.");
    return { distro: state.distro_name, user: state.linux_user,
      script: `/mnt/${drive[1]?.toLowerCase()}/${drive[2]?.replaceAll("\\", "/")}/installer/wsl/telephony_runner.py` };
  }

  private async run(action: string, args: string[] = [], input?: unknown): Promise<Record<string, unknown>> {
    const target = this.target();
    try { return await this.invoke(target.script, target.distro, target.user, [action, ...args],
      input === undefined ? undefined : JSON.stringify(input), action === "originate" ? 12000 : 8000); }
    catch (error) {
      if (error instanceof Error && error.message.startsWith("runner_3:revision_conflict")) throw conflict("Telefonie-Konfiguration wurde geändert. Bitte neu laden.");
      if (error instanceof Error && error.message.startsWith("runner_4:")) throw validationFailed("Telefonie-Eingaben sind ungültig.");
      throw unavailable("Asterisk-Telefonieadapter antwortet nicht oder der Ausgang des Anrufs ist unklar.");
    }
  }

  async status(): Promise<TelephonyStatus> {
    const data = await this.run("status");
    if (typeof data.configured !== "boolean" || typeof data.ariReachable !== "boolean" || typeof data.ready !== "boolean" ||
        typeof data.configurationApplied !== "boolean" || typeof data.dialplanLoaded !== "boolean" ||
        !Number.isSafeInteger(data.revision) || ![null, "local", "trunk"].includes(data.mode as string | null) ||
        !["unavailable", "unknown", "unregistered", "registered", "not_required"].includes(data.registration as string) ||
        !["unknown", "online", "offline"].includes(data.ownerEndpoint as string) ||
        !(data.callerId === null || typeof data.callerId === "string")) throw unavailable("Telefonieadapter lieferte einen ungültigen Status.");
    return data as unknown as TelephonyStatus;
  }

  async configure(profile: TelephonyProfile, revision: number): Promise<TelephonyStatus> {
    if (!Number.isSafeInteger(revision) || revision < 0 || !profile || !["local", "trunk"].includes(profile.mode) ||
      !LABEL.test(profile.ariUser) || !LABEL.test(profile.ownerEndpoint) || !SECRET.test(profile.ariPassword) ||
      !Number.isSafeInteger(profile.ariPort) || profile.ariPort < 1 || profile.ariPort > 65535 ||
      !(profile.mode === "trunk" ? E164 : EXTENSION).test(profile.callerId) ||
      (profile.mode === "trunk" && (!profile.sipHost || !HOST.test(profile.sipHost) ||
        !profile.sipUser || !SIP_SECRET.test(profile.sipUser) || !profile.sipPassword || !SIP_SECRET.test(profile.sipPassword)))) {
      throw validationFailed("SIP-/ARI-Konfiguration ist ungültig.");
    }
    const data = await this.run("configure", [], { profile, revision });
    if (!Number.isSafeInteger(data.revision)) throw unavailable("Telefonieprofil wurde nicht bestätigt.");
    return this.status();
  }

  async preview(destination: string, actor: string): Promise<{ destination: string; callerId: string; mode: string; expiresAt: string; token: string }> {
    const status = await this.status();
    if (!status.ready || !status.mode || !status.callerId) throw unavailable("Asterisk, SIP-Registrierung oder Owner-Nebenstelle ist nicht bereit.");
    if (!(status.mode === "trunk" ? E164 : EXTENSION).test(destination)) throw validationFailed("Zielnummer ist für diesen Modus ungültig.");
    const expires = this.now() + 120000;
    const body = Buffer.from(JSON.stringify({ actor, destination, revision: status.revision, expires }), "utf8").toString("base64url");
    const signature = createHmac("sha256", this.previewKey).update(body).digest("base64url");
    const token = `${body}.${signature}`;
    this.db.prepare("DELETE FROM telephony_previews WHERE expires_at < ?").run(this.now());
    this.db.prepare("INSERT INTO telephony_previews (token_hash,actor,destination,expires_at) VALUES (?,?,?,?)")
      .run(digest(token), actor, destination, expires);
    return { destination, callerId: status.callerId, mode: status.mode,
      expiresAt: new Date(expires).toISOString(), token };
  }

  private checkPreview(token: string, destination: string, actor: string, revision: number): void {
    const [body, signature, extra] = token.split(".");
    if (!body || !signature || extra || body.length > 1024 || signature.length > 100) throw validationFailed("Anrufvorschau fehlt oder ist ungültig.");
    const expected = createHmac("sha256", this.previewKey).update(body).digest();
    let given: Buffer;
    try { given = Buffer.from(signature, "base64url"); } catch { throw validationFailed("Anrufvorschau ist ungültig."); }
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw validationFailed("Anrufvorschau ist ungültig.");
    let claims: { actor?: string; destination?: string; revision?: number; expires?: number };
    try { claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as typeof claims; }
    catch { throw validationFailed("Anrufvorschau ist ungültig."); }
    if (claims.actor !== actor || claims.destination !== destination || claims.revision !== revision ||
        !claims.expires || claims.expires < this.now() || claims.expires > this.now() + 120000) throw conflict("Anrufvorschau ist abgelaufen oder die Konfiguration hat sich geändert.");
  }

  async originate(destination: string, previewToken: string, actor: string, key: string): Promise<TelephonyCall> {
    if (!key || key.length < 8 || key.length > 128) throw validationFailed("Idempotency-Key ist erforderlich.");
    const keyHash = digest(`${actor}\n${key}`);
    const requestHash = digest(`${actor}\n${destination}`);
    const existing = this.lookupByKey(keyHash);
    if (existing) return this.replay(existing, requestHash);
    const status = await this.status();
    if (!status.ready || !status.mode) throw unavailable("SIP-/Asterisk-Adapter ist nicht bereit.");
    if (!(status.mode === "trunk" ? E164 : EXTENSION).test(destination)) throw validationFailed("Zielnummer ist ungültig.");
    this.checkPreview(previewToken, destination, actor, status.revision);
    const id = `call_${randomBytes(16).toString("hex")}`;
    const time = new Date(this.now()).toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    let inserted: number;
    try {
      const since = new Date(this.now() - 3600000).toISOString();
      const recent = this.db.prepare("SELECT count(*) AS n FROM telephony_calls WHERE actor = ? AND created_at >= ?").get(actor, since) as { n: number };
      if (recent.n >= 5) throw new ApiError({ code: "RATE_LIMITED", status: 429, message: "Maximal fünf Anrufversuche pro Stunde." });
      const consumed = this.db.prepare(`UPDATE telephony_previews SET consumed_at = ?
        WHERE token_hash = ? AND actor = ? AND destination = ? AND consumed_at IS NULL AND expires_at >= ?`)
        .run(this.now(), digest(previewToken), actor, destination, this.now()).changes;
      if (!consumed) throw conflict("Anrufvorschau wurde bereits benutzt oder ist abgelaufen.");
      inserted = Number(this.db.prepare(`INSERT OR IGNORE INTO telephony_calls
        (id,key_hash,actor,request_hash,destination,state,created_at,updated_at)
        VALUES (?,?,?,?,?,'pending',?,?)`).run(id, keyHash, actor, requestHash, destination, time, time).changes);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    if (!inserted) return this.replay(this.lookupByKey(keyHash)!, requestHash);
    try {
      const result = await this.run("originate", [], { callId: id, number: destination });
      const state = result.accepted === true ? "requested" : "unknown";
      this.update(id, state, typeof result.adapterStatus === "number" ? result.adapterStatus : null);
    } catch { this.update(id, "unknown", null); }
    return this.getStored(id, actor);
  }

  async get(id: string, actor: string): Promise<TelephonyCall> {
    const stored = this.getStored(id, actor);
    if (["ended", "failed"].includes(stored.state)) return stored;
    try {
      const data = await this.run("channel", [id]);
      const adapterStatus = Number.isSafeInteger(data.adapterStatus) ? Number(data.adapterStatus) : null;
      if (data.adapterReachable === true && data.found === true && data.state === "Up") this.update(id, "owner_answered", adapterStatus);
      else if (data.adapterReachable === true && data.found === true && stored.state === "pending") this.update(id, "requested", adapterStatus);
      else if (data.adapterReachable === true && data.found === false) this.update(id, stored.state === "owner_answered" ? "ended" : "unknown", adapterStatus);
    } catch { /* Keep last observed state; a timeout is not proof of call termination. */ }
    return this.getStored(id, actor);
  }

  async hangup(id: string, actor: string): Promise<TelephonyCall> {
    const stored = this.getStored(id, actor);
    if (stored.state === "ended") return stored;
    const data = await this.run("hangup", [id]);
    if (data.accepted === true || data.alreadyGone === true) this.update(id, "ended", Number.isSafeInteger(data.adapterStatus) ? Number(data.adapterStatus) : null);
    return this.getStored(id, actor);
  }

  private update(id: string, state: TelephonyCall["state"], adapterStatus: number | null): void {
    this.db.prepare("UPDATE telephony_calls SET state = ?, adapter_status = ?, updated_at = ? WHERE id = ?")
      .run(state, adapterStatus, new Date(this.now()).toISOString(), id);
  }
  private lookupByKey(keyHash: string): CallRow | undefined {
    return this.db.prepare("SELECT * FROM telephony_calls WHERE key_hash = ?").get(keyHash) as CallRow | undefined;
  }
  private replay(row: CallRow, requestHash: string): TelephonyCall {
    if (row.request_hash !== requestHash) throw conflict("Idempotency-Key wurde für eine andere Zielnummer benutzt.");
    return { ...this.map(row), replayed: true };
  }
  private getStored(id: string, actor: string): TelephonyCall {
    if (!/^call_[a-f0-9]{32}$/.test(id)) throw notFound("Anruf");
    const row = this.db.prepare("SELECT * FROM telephony_calls WHERE id = ? AND actor = ?").get(id, actor) as CallRow | undefined;
    if (!row) throw notFound("Anruf");
    return this.map(row);
  }
  private map(row: CallRow): TelephonyCall {
    return { id: row.id, destination: row.destination, state: row.state, adapterStatus: row.adapter_status,
      createdAt: row.created_at, updatedAt: row.updated_at };
  }
}
