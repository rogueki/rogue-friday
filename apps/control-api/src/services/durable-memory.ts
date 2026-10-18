import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, linkSync, unlinkSync, realpathSync,
  openSync, writeSync, fsyncSync, closeSync, renameSync, rmSync, mkdtempSync } from "node:fs";
import { basename, dirname, join, resolve, relative, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface IntegrationEvent {
  eventId: string;
  contractVersion: string;
  eventType: "user_utterance" | "assistant_response" | "action_result";
  actor: { type: "user" | "assistant" | "system" | "provider"; id: string; role: string | null };
  identityId: string | null;
  channel: string;
  sessionId: string | null;
  dialogId: string | null;
  correlationId: string | null;
  source: string;
  occurredAt: string;
  outcome: "completed" | "aborted" | "uncertain";
  captureEligibility: "eligible" | "private" | "do_not_store";
  redaction: "complete" | "required";
  payload: { kind: "text"; text: string } | { kind: "action"; actionId: string; targetId: string | null; externalId: string | null };
}

export interface MemoryHit {
  eventId: string; text: string; occurredAt: string; source: string; channel: string;
  identityId: string | null; sessionId: string | null; score: number;
}

export interface MemorySettings {
  enabled: boolean;
  privateMode: boolean;
  channels: { dashboard: boolean; voice: boolean; hermes: boolean };
  retention: "unlimited";
  exclusions: string[];
}

const safeId = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const safeLabel = /^[a-zA-Z0-9][a-zA-Z0-9_./:-]{0,127}$/;
const secretCue = /\b(?:password|passwort|passphrase|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|secret|geheimnis|otp|einmalcode|private[ _-]?key|bearer|authorization|kennwort|zugangsdaten)\b|\bpin\s*(?:[:=]|is\b|lautet\b)/i;
const secretValue = /\b(?:sk-[a-zA-Z0-9_-]{16,}|gh[pousr]_[a-zA-Z0-9]{16,}|(?:\d[ -]*?){13,19})\b/g;
const sha = (value: string): string => createHash("sha256").update(value).digest("hex");

function safeText(value: string): string {
  // Ambiguous credential statements are excluded in full. A missed fragment in an outbox is irreversible.
  return secretCue.test(value) ? "[Zugangsdaten entfernt]" : value.replace(secretValue, "[Geheimnis entfernt]");
}

function containsUnredactedSecret(contents: string): boolean {
  const withoutMarkers = contents.replaceAll("[Zugangsdaten entfernt]", "").replaceAll("[Geheimnis entfernt]", "");
  return safeText(withoutMarkers) !== withoutMarkers;
}

function validate(event: IntegrationEvent): void {
  if (!safeId.test(event.eventId) || !safeId.test(event.actor.id) || !safeLabel.test(event.channel) || !safeLabel.test(event.source) ||
      [event.sessionId, event.dialogId, event.correlationId, event.identityId].some((value) => value !== null && !safeId.test(value)) ||
      [event.eventId, event.actor.id, event.channel, event.source, event.identityId, event.sessionId, event.dialogId, event.correlationId]
        .some((value) => value && (secretCue.test(value) || /^(?:sk-[a-zA-Z0-9_-]{16,}|gh[pousr]_[a-zA-Z0-9]{16,})$/.test(value))) ||
      !Number.isFinite(Date.parse(event.occurredAt)) || !["user_utterance", "assistant_response", "action_result"].includes(event.eventType))
    throw new Error("Invalid integration event");
  if ((event.eventType === "user_utterance" && (event.actor.type !== "user" || event.payload.kind !== "text")) ||
      (event.eventType === "assistant_response" && (event.actor.type !== "assistant" || event.payload.kind !== "text")) ||
      (event.eventType === "action_result" && event.payload.kind !== "action")) throw new Error("Event type/payload mismatch");
  if (event.identityId !== null && !safeId.test(event.identityId)) throw new Error("Invalid identity");
  if (event.payload.kind === "text" && event.payload.text.length > 200_000) throw new Error("Event too large");
}

function redact(event: IntegrationEvent): IntegrationEvent {
  const payload = event.payload.kind === "text"
    ? { kind: "text" as const, text: safeText(event.payload.text) }
    : { kind: "action" as const, actionId: safeText(event.payload.actionId),
        targetId: event.payload.targetId && safeText(event.payload.targetId),
        externalId: event.payload.externalId && safeText(event.payload.externalId) };
  return { ...event, actor: { ...event.actor, id: safeText(event.actor.id), role: event.actor.role && safeText(event.actor.role) },
    channel: safeText(event.channel), source: safeText(event.source), payload, redaction: "complete" };
}

function note(event: IntegrationEvent): string {
  const text = event.payload.kind === "text" ? event.payload.text :
    `Action: ${event.payload.actionId}\nOutcome: ${event.outcome}\nTarget: ${event.payload.targetId ?? ""}\nExternal ID: ${event.payload.externalId ?? ""}`;
  const metadata = event.payload.kind === "text" ? { ...event, payload: { kind: "text" } } : event;
  return `---\nfriday_memory: 1\nmetadata: ${JSON.stringify(metadata)}\n---\n\n${text}\n`;
}

function parseNote(contents: string): IntegrationEvent | null {
  const match = /^---\nfriday_memory: 1\nmetadata: (.+)\n---\n\n([\s\S]*)\n$/.exec(contents);
  if (!match) return null;
  const meta = JSON.parse(match[1]!) as IntegrationEvent;
  if (meta.payload.kind === "text") meta.payload.text = match[2]!;
  validate(meta);
  return meta;
}

export class DurableMemoryService {
  private readonly db: DatabaseSync;
  private readonly dataDir: string;
  private indexError: string | null = null;
  vaultPath: string;
  private writing = false;

  constructor(dataDir: string, vaultPath?: string) {
    const root = resolve(dataDir);
    this.dataDir = root;
    mkdirSync(join(root, "memory"), { recursive: true });
    const configuredPath = join(root, "..", "..", "config", "obsidian-vault-path.txt");
    const savedVault = existsSync(configuredPath) ? readFileSync(configuredPath, "utf8").trim() : "";
    this.vaultPath = resolve((vaultPath ?? savedVault) || process.env.FRIDAY_OBSIDIAN_VAULT || join(root, "..", "..", "memory", "Friday"));
    this.db = new DatabaseSync(join(root, "memory", "outbox.sqlite"));
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    this.db.exec(`CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, json TEXT NOT NULL, hash TEXT NOT NULL,
      state TEXT NOT NULL, path TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tombstones (id TEXT PRIMARY KEY, deleted_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS pending_deletes (id TEXT PRIMARY KEY, path TEXT NOT NULL, error TEXT);
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS memory_events_state ON events(state);`);
    this.db.exec("CREATE INDEX IF NOT EXISTS memory_events_identity ON events(json_extract(json,'$.identityId'));");
    this.db.prepare("INSERT OR IGNORE INTO metadata(key,value) VALUES('capture_settings',?)").run(JSON.stringify({
      enabled: true, privateMode: false, channels: { dashboard: true, voice: true, hermes: true },
      retention: "unlimited", exclusions: ["private", "do_not_store", "credentials", "raw_audio"] }));
    // Only pending events are replayable. A written note missing after a healthy complete
    // Vault scan is an Obsidian deletion, not a request to recreate user-deleted content.
  }

  close(): void { this.db.close(); }

  getSettings(): MemorySettings {
    const row = this.db.prepare("SELECT value FROM metadata WHERE key='capture_settings'").get() as { value: string } | undefined;
    const saved = row ? JSON.parse(row.value) as Partial<MemorySettings> : {};
    return { enabled: saved.enabled !== false, privateMode: saved.privateMode === true,
      channels: { dashboard: saved.channels?.dashboard !== false, voice: saved.channels?.voice !== false,
        hermes: saved.channels?.hermes !== false }, retention: "unlimited",
      exclusions: ["private", "do_not_store", "credentials", "raw_audio"] };
  }

  setSettings(input: Pick<MemorySettings, "enabled" | "privateMode" | "channels">): MemorySettings {
    if (typeof input.enabled !== "boolean" || typeof input.privateMode !== "boolean" ||
        !input.channels || ["dashboard", "voice", "hermes"].some((key) =>
          typeof input.channels[key as keyof MemorySettings["channels"]] !== "boolean"))
      throw new Error("Invalid memory settings");
    const settings: MemorySettings = { enabled: input.enabled, privateMode: input.privateMode,
      channels: { dashboard: input.channels.dashboard, voice: input.channels.voice, hermes: input.channels.hermes },
      retention: "unlimited", exclusions: ["private", "do_not_store", "credentials", "raw_audio"] };
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("INSERT INTO metadata(key,value) VALUES('capture_settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
        .run(JSON.stringify(settings));
      const disabled = Object.entries(settings.channels).filter(([, allowed]) => !allowed).map(([name]) => name);
      if (!settings.enabled || settings.privateMode || disabled.length) {
        const pending = this.db.prepare("SELECT id,json FROM events WHERE state='pending'").all() as Array<{ id: string; json: string }>;
        const remove = this.db.prepare("DELETE FROM events WHERE id=?");
        for (const row of pending) if (!settings.enabled || settings.privateMode ||
            disabled.includes((JSON.parse(row.json) as IntegrationEvent).channel)) {
          this.db.prepare("INSERT OR IGNORE INTO tombstones VALUES (?,?)").run(row.id, new Date().toISOString());
          remove.run(row.id);
        }
      }
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return settings;
  }

  prepareVaultSwitch(nextPath: string): void {
    const next = resolve(nextPath);
    if (next === this.vaultPath) return;
    this.flush();
    if (this.status().pending || this.indexError || !existsSync(join(next, ".obsidian")))
      throw new Error("Both vaults must be writable and indexed before switching");
    const rows = this.db.prepare("SELECT path FROM events WHERE state='written'").all() as Array<{ path: string }>;
    for (const row of rows) {
      const source = join(this.vaultPath, row.path);
      const target = join(next, row.path);
      const contents = readFileSync(source, "utf8");
      if (containsUnredactedSecret(contents)) throw new Error("Current Vault contains unreviewed credentials");
      mkdirSync(dirname(target), { recursive: true });
      if (existsSync(target)) {
        if (readFileSync(target, "utf8") !== contents) throw new Error("New Vault has a conflicting Friday note");
      } else {
        const temporary = `${target}.${randomUUID()}.tmp`;
        try {
          const handle = openSync(temporary, "wx");
          try { writeSync(handle, contents); fsyncSync(handle); } finally { closeSync(handle); }
          linkSync(temporary, target);
        } finally { if (existsSync(temporary)) unlinkSync(temporary); }
      }
    }
  }

  switchVault(nextPath: string): void {
    this.prepareVaultSwitch(nextPath);
    this.vaultPath = resolve(nextPath);
    this.reindex();
  }

  capture(candidate: IntegrationEvent): { eventId: string; accepted: boolean; pending: boolean } {
    validate(candidate);
    if (candidate.captureEligibility !== "eligible") return { eventId: candidate.eventId, accepted: false, pending: false };
    const settings = this.getSettings();
    if (!settings.enabled || settings.privateMode ||
        candidate.channel in settings.channels && !settings.channels[candidate.channel as keyof MemorySettings["channels"]])
      return { eventId: candidate.eventId, accepted: false, pending: false };
    if (this.db.prepare("SELECT 1 FROM tombstones WHERE id=?").get(candidate.eventId))
      return { eventId: candidate.eventId, accepted: false, pending: false };
    const event = redact(candidate);
    const json = JSON.stringify(event);
    const digest = sha(json);
    const previous = this.db.prepare("SELECT hash,state FROM events WHERE id=?").get(event.eventId) as { hash: string; state: string } | undefined;
    if (previous) {
      if (previous.hash !== digest) throw new Error("Event ID conflict");
      return { eventId: event.eventId, accepted: true, pending: previous.state !== "written" };
    }
    const date = new Date(event.occurredAt);
    const path = join("Conversations", String(date.getUTCFullYear()), String(date.getUTCMonth() + 1).padStart(2, "0"), `${event.eventId}.md`);
    this.db.prepare("INSERT INTO events VALUES (?,?,?,?,?,?,?)").run(event.eventId, json, digest, "pending", path, null, new Date().toISOString());
    this.flush();
    return { eventId: event.eventId, accepted: true, pending: this.isPending(event.eventId) };
  }

  private isPending(id: string): boolean {
    return (this.db.prepare("SELECT state FROM events WHERE id=?").get(id) as { state: string } | undefined)?.state !== "written";
  }

  reindex(): void {
    const root = join(this.vaultPath, "Conversations");
    if (!existsSync(join(this.vaultPath, ".obsidian"))) { this.indexError = "Vault unavailable"; return; }
    if (!existsSync(root)) {
      const written = (this.db.prepare("SELECT COUNT(*) AS n FROM events WHERE state='written'").get() as { n: number }).n;
      this.indexError = written ? "Vault conversations unavailable" : null;
      return;
    }
    const seen = new Set<string>();
    let scanError: string | null = null;
    const visit = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) { visit(path); continue; }
        if (!entry.name.endsWith(".md")) continue;
        try {
          const contents = readFileSync(path, "utf8");
          if (!contents.startsWith("---\nfriday_memory: 1\n")) continue;
          const event = parseNote(contents);
          if (!event) { scanError = "Unrecognized Friday note"; continue; }
          if (event.captureEligibility !== "eligible" || this.db.prepare("SELECT 1 FROM tombstones WHERE id=?").get(event.eventId)) continue;
          const safe = redact(event);
          // A note edited directly in Obsidian updates retrieval, but a credential-bearing edit is never indexed.
          if (containsUnredactedSecret(contents) || JSON.stringify(safe) !== JSON.stringify(event)) {
            scanError = "Credential-bearing Vault edit requires review";
            continue;
          }
          seen.add(event.eventId);
          const json = JSON.stringify(safe);
          this.db.prepare(`INSERT INTO events VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
            json=excluded.json,hash=excluded.hash,state='written',path=excluded.path,error=NULL`).run(
            event.eventId, json, sha(json), "written", relative(this.vaultPath, path), null, new Date().toISOString());
        } catch { scanError = "Friday note could not be read or parsed"; }
      }
    };
    try { visit(root); } catch { scanError = "Vault scan incomplete"; }
    this.indexError = scanError;
    if (scanError) return;
    const rows = this.db.prepare("SELECT id FROM events WHERE state='written'").all() as Array<{ id: string }>;
    for (const row of rows) if (!seen.has(row.id)) {
      this.db.prepare("INSERT OR IGNORE INTO tombstones VALUES (?,?)").run(row.id, new Date().toISOString());
      this.db.prepare("DELETE FROM events WHERE id=?").run(row.id);
    }
  }

  flush(): void {
    if (this.writing) return;
    this.writing = true;
    try {
      const rows = this.db.prepare("SELECT id,json,path FROM events WHERE state!='written' ORDER BY created_at,id").all() as
        Array<{ id: string; json: string; path: string }>;
      for (const row of rows) {
        try {
          if (!existsSync(join(this.vaultPath, ".obsidian"))) throw new Error("Vault is unavailable");
          const target = join(this.vaultPath, row.path);
          mkdirSync(dirname(target), { recursive: true });
          const content = note(JSON.parse(row.json) as IntegrationEvent);
          if (existsSync(target)) {
            if (readFileSync(target, "utf8") !== content) throw new Error("Vault note changed outside Friday");
          } else {
            const temporary = `${target}.${randomUUID()}.tmp`;
            try {
              const handle = openSync(temporary, "wx");
              try { writeSync(handle, content); fsyncSync(handle); } finally { closeSync(handle); }
              try { linkSync(temporary, target); }
              catch (error) {
                if (["EXDEV", "ENOTSUP", "EOPNOTSUPP"].includes((error as NodeJS.ErrnoException).code ?? ""))
                  throw new Error("Atomic Vault linking unsupported; outbox retained", { cause: error });
                throw error;
              }
            } finally { if (existsSync(temporary)) unlinkSync(temporary); }
          }
          this.db.prepare("UPDATE events SET state='written',error=NULL WHERE id=?").run(row.id);
        } catch (error) {
          this.db.prepare("UPDATE events SET state='pending',error=? WHERE id=?").run(
            error instanceof Error ? error.message.slice(0, 160) : "Vault write failed", row.id);
        }
      }
      const deletes = this.db.prepare("SELECT id,path FROM pending_deletes").all() as Array<{ id: string; path: string }>;
      for (const row of deletes) {
        try {
          const target = join(this.vaultPath, row.path);
          if (existsSync(target)) unlinkSync(target);
          this.db.prepare("DELETE FROM pending_deletes WHERE id=?").run(row.id);
        } catch (error) {
          this.db.prepare("UPDATE pending_deletes SET error=? WHERE id=?").run(
            error instanceof Error ? error.message.slice(0, 160) : "Delete failed", row.id);
        }
      }
    } finally { this.writing = false; }
  }

  status(): { vaultPath: string; ready: boolean; pending: number; lastWrittenAt: string | null; lastError: string | null;
    lastRestoreTestAt: string | null; indexState: string; settings: MemorySettings } {
    this.reindex();
    const pending = (this.db.prepare("SELECT COUNT(*) AS n FROM events WHERE state!='written'").get() as { n: number }).n +
      (this.db.prepare("SELECT COUNT(*) AS n FROM pending_deletes").get() as { n: number }).n;
    const last = this.db.prepare("SELECT created_at FROM events WHERE state='written' ORDER BY created_at DESC LIMIT 1").get() as
      { created_at: string } | undefined;
    const error = this.db.prepare("SELECT error FROM events WHERE error IS NOT NULL ORDER BY created_at DESC LIMIT 1").get() as
      { error: string } | undefined;
    const deleteError = this.db.prepare("SELECT error FROM pending_deletes WHERE error IS NOT NULL LIMIT 1").get() as { error: string } | undefined;
    let writable = false;
    if (existsSync(join(this.vaultPath, ".obsidian"))) {
      const probe = join(this.vaultPath, `.friday-status-${randomUUID()}`);
      try { writeFileSync(probe, "ok", { flag: "wx" }); writable = readFileSync(probe, "utf8") === "ok"; }
      catch { writable = false; }
      finally { if (existsSync(probe)) unlinkSync(probe); }
    }
    const restore = this.db.prepare("SELECT value FROM metadata WHERE key='last_restore_test_at'").get() as { value: string } | undefined;
    return { vaultPath: this.vaultPath, ready: writable && pending === 0 && !this.indexError,
      pending, lastWrittenAt: last?.created_at ?? null, lastError: deleteError?.error ?? error?.error ?? this.indexError ?? null,
      lastRestoreTestAt: restore?.value ?? null, indexState: !writable ? "unavailable" : this.indexError ? "error" : "ready",
      settings: this.getSettings() };
  }

  search(query: string, identityId: string | null, limit = 20): MemoryHit[] {
    if (!query.trim() || limit < 1 || limit > 100) return [];
    this.reindex();
    const tokens = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    if (this.indexError) throw new Error(this.indexError);
    const rows = this.db.prepare("SELECT json FROM events WHERE state='written' AND json_extract(json,'$.identityId') IS ? ORDER BY created_at DESC");
    const hits: MemoryHit[] = [];
    for (const { json } of rows.iterate(identityId) as Iterable<{ json: string }>) {
      const event = JSON.parse(json) as IntegrationEvent;
      if (event.payload.kind !== "text") continue;
        const text = (event.payload as { text: string }).text;
        const lower = text.toLocaleLowerCase();
        const hit = { eventId: event.eventId, text, occurredAt: event.occurredAt, source: event.source, channel: event.channel,
          identityId: event.identityId, sessionId: event.sessionId, score: tokens.filter((token) => lower.includes(token)).length / tokens.length };
        if (hit.score > 0) {
          hits.push(hit);
          hits.sort((a, b) => b.score - a.score || b.occurredAt.localeCompare(a.occurredAt));
          if (hits.length > limit) hits.pop();
        }
    }
    return hits;
  }

  forget(id: string, identityId?: string): { eventId: string; deleted: boolean } {
    if (!safeId.test(id)) throw new Error("Invalid event ID");
    const row = this.db.prepare("SELECT path,json FROM events WHERE id=?").get(id) as { path: string; json: string } | undefined;
    if (row && identityId !== undefined && (JSON.parse(row.json) as IntegrationEvent).identityId !== identityId)
      throw new Error("Identity mismatch");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("INSERT OR IGNORE INTO tombstones VALUES (?,?)").run(id, new Date().toISOString());
      if (row) this.db.prepare("INSERT OR REPLACE INTO pending_deletes VALUES (?,?,NULL)").run(id, row.path);
      this.db.prepare("DELETE FROM events WHERE id=?").run(id);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    this.flush();
    return { eventId: id, deleted: Boolean(row) };
  }

  correct(id: string, text: string, identityId: string): { eventId: string; replacementEventId: string; corrected: boolean } {
    if (!safeId.test(id) || !text.trim() || text.length > 200_000) throw new Error("Invalid correction");
    this.reindex();
    const row = this.db.prepare("SELECT json,path FROM events WHERE id=? AND state='written'").get(id) as
      { json: string; path: string } | undefined;
    if (!row) throw new Error("Source memory unavailable");
    const original = JSON.parse(row.json) as IntegrationEvent;
    if (original.identityId !== identityId) throw new Error("Identity mismatch");
    const now = new Date().toISOString();
    const event = redact({ ...original, eventId: `correction-${randomUUID()}`, occurredAt: now, eventType: "user_utterance",
      actor: { type: "user", id: identityId, role: null }, source: "dashboard/memory-correction", outcome: "completed",
      payload: { kind: "text", text: `Korrektur von ${id}: ${text}` }, redaction: "required" });
    const json = JSON.stringify(event);
    const date = new Date(now);
    const path = join("Conversations", String(date.getUTCFullYear()), String(date.getUTCMonth() + 1).padStart(2, "0"), `${event.eventId}.md`);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("INSERT INTO events VALUES (?,?,?,?,?,?,?)").run(event.eventId, json, sha(json), "pending", path, null, now);
      this.db.prepare("INSERT OR IGNORE INTO tombstones VALUES (?,?)").run(id, now);
      this.db.prepare("INSERT OR REPLACE INTO pending_deletes VALUES (?,?,NULL)").run(id, row.path);
      this.db.prepare("DELETE FROM events WHERE id=?").run(id);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    this.flush();
    return { eventId: id, replacementEventId: event.eventId, corrected: true };
  }

  backup(): { path: string; eventCount: number; createdAt: string } {
    this.flush();
    if (this.status().pending) throw new Error("Pending vault writes prevent a complete backup");
    this.reindex();
    if (this.indexError) throw new Error("Vault index is not complete; backup refused");
    const createdAt = new Date().toISOString();
    const targetRoot = join(this.dataDir, "memory", "backups");
    mkdirSync(targetRoot, { recursive: true });
    const path = resolve(targetRoot, `friday-memory-${createdAt.replace(/[:.]/g, "-")}-${randomUUID()}`);
    const temporary = `${path}.incomplete`;
    mkdirSync(temporary, { recursive: false });
    const rows = this.db.prepare("SELECT path FROM events WHERE state='written'").all() as Array<{ path: string }>;
    const hashes: Record<string, string> = {};
    try {
      for (const row of rows) {
        const from = join(this.vaultPath, row.path);
        const to = join(temporary, row.path);
        const contents = readFileSync(from, "utf8");
        const event = parseNote(contents);
        if (!event || event.captureEligibility !== "eligible" || event.redaction !== "complete" ||
            containsUnredactedSecret(contents) || JSON.stringify(redact(event)) !== JSON.stringify(event))
          throw new Error("Vault note is invalid or contains credential-like text");
        mkdirSync(dirname(to), { recursive: true });
        writeFileSync(to, contents, { flag: "wx", flush: true });
        hashes[row.path.replaceAll("\\", "/")] = sha(contents);
      }
      const tombstones = this.db.prepare("SELECT id,deleted_at FROM tombstones").all();
      writeFileSync(join(temporary, "manifest.json"), JSON.stringify({ version: 1, createdAt, eventCount: rows.length, tombstones, hashes }),
        { flag: "wx", flush: true });
      renameSync(temporary, path);
      return { path, eventCount: rows.length, createdAt };
    } catch (error) {
      if (existsSync(temporary) && temporary.startsWith(targetRoot + sep)) rmSync(temporary, { recursive: true, force: true });
      throw error;
    }
  }

  restore(backupPath: string, targetVaultPath: string): { targetVaultPath: string; eventCount: number; restoredAt: string } {
    const source = resolve(backupPath);
    const target = resolve(targetVaultPath);
    const backupRoot = join(this.dataDir, "memory", "backups") + sep;
    const dataMemoryRoot = join(this.dataDir, "memory") + sep;
    const indexPath = join(dirname(target), `${basename(target)}-memory-index.sqlite`);
    if (!source.startsWith(backupRoot) || !basename(source).startsWith("friday-memory-") || source.endsWith(".incomplete") ||
        !target.startsWith(dataMemoryRoot) || source === this.vaultPath ||
        target === this.vaultPath || target === source || existsSync(target) || existsSync(indexPath))
      throw new Error("Restore target must be a new isolated vault");
    mkdirSync(dirname(target), { recursive: true });
    if (!realpathSync(source).startsWith(realpathSync(join(this.dataDir, "memory", "backups")) + sep) ||
        !realpathSync(dirname(target)).startsWith(realpathSync(join(this.dataDir, "memory")) + sep))
      throw new Error("Restore path escapes Friday data directory");
    const manifest = JSON.parse(readFileSync(join(source, "manifest.json"), "utf8")) as { version: number; eventCount: number; tombstones: Array<{ id: string }>; hashes: Record<string, string> };
    if (manifest.version !== 1 || !Number.isSafeInteger(manifest.eventCount) || manifest.eventCount < 0 ||
        Object.keys(manifest.hashes ?? {}).length !== manifest.eventCount) throw new Error("Unsupported or incomplete backup");
    const tombstones = new Set(manifest.tombstones.map((item) => item.id));
    let count = 0;
    const verified: Array<{ relativePath: string; contents: string; event: IntegrationEvent }> = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) throw new Error("Symlink in backup");
        const sourcePath = join(dir, entry.name);
        if (entry.isDirectory()) { walk(sourcePath); continue; }
        if (!entry.name.endsWith(".md")) continue;
        const key = relative(source, sourcePath).replaceAll("\\", "/");
        const contents = readFileSync(sourcePath, "utf8");
        if (sha(contents) !== manifest.hashes[key]) throw new Error("Backup checksum mismatch");
        const event = parseNote(contents);
        if (!event || !safeId.test(event.eventId) || tombstones.has(event.eventId) ||
            event.captureEligibility !== "eligible" || event.redaction !== "complete" ||
            containsUnredactedSecret(contents) || JSON.stringify(redact(event)) !== JSON.stringify(event))
          throw new Error("Invalid or sensitive backup note");
        verified.push({ relativePath: relative(source, sourcePath), contents, event });
        count += 1;
      }
    };
    walk(source);
    if (count !== manifest.eventCount) throw new Error("Incomplete backup");
    const staging = mkdtempSync(join(dirname(target), ".friday-restore-"));
    const stagedVault = join(staging, "vault");
    const stagedIndex = join(staging, "index.sqlite");
    let publishedVault = false;
    let publishedIndex = false;
    try {
      mkdirSync(join(stagedVault, ".obsidian"), { recursive: true });
      writeFileSync(stagedIndex, "", { flag: "wx" });
      const restoredIndex = new DatabaseSync(stagedIndex);
      try {
        restoredIndex.exec("CREATE TABLE IF NOT EXISTS entries (event_id TEXT PRIMARY KEY, identity_id TEXT, occurred_at TEXT, text TEXT)");
        const add = restoredIndex.prepare("INSERT INTO entries VALUES (?,?,?,?)");
        for (const item of verified) {
          const dest = join(stagedVault, item.relativePath);
          if (!dest.startsWith(stagedVault + sep)) throw new Error("Invalid backup path");
          mkdirSync(dirname(dest), { recursive: true });
          writeFileSync(dest, item.contents, { flag: "wx", flush: true });
          add.run(item.event.eventId, item.event.identityId, item.event.occurredAt,
            item.event.payload.kind === "text" ? item.event.payload.text : "");
        }
      } finally { restoredIndex.close(); }
      if (existsSync(target) || existsSync(indexPath)) throw new Error("Restore target appeared during staging");
      renameSync(stagedVault, target);
      publishedVault = true;
      renameSync(stagedIndex, indexPath);
      publishedIndex = true;
    } catch (error) {
      if (publishedVault) rmSync(target, { recursive: true, force: true });
      if (publishedIndex) rmSync(indexPath, { force: true });
      throw error;
    } finally { rmSync(staging, { recursive: true, force: true }); }
    const restoredAt = new Date().toISOString();
    this.db.prepare("INSERT INTO metadata VALUES ('last_restore_test_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(restoredAt);
    return { targetVaultPath: target, eventCount: count, restoredAt };
  }
}
