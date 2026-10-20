import { createHash } from "node:crypto";
import { redactString } from "@friday/observability";
import type { Layout, Theme } from "@friday/sdk";
import type { Db } from "./database";

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export interface StoredResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

export type IdempotencyLookup =
  | { kind: "miss" }
  | { kind: "replay"; response: StoredResponse }
  | { kind: "conflict" };

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

/**
 * Idempotency keys (PLAN §8.7). The stored identity is method + path + key + actor, so a key can never replay another
 * user's response or another endpoint's. Reusing a key with a different body is a conflict, not a replay.
 */
export class IdempotencyStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now,
    private readonly ttlMs: number = IDEMPOTENCY_TTL_MS,
  ) {}

  static keyHash(method: string, path: string, key: string, actor: string): string {
    return sha256(`${method.toUpperCase()}\n${path}\n${key}\n${actor}`);
  }

  static bodyHash(body: unknown): string {
    return sha256(JSON.stringify(sortKeys(body ?? null)));
  }

  lookup(method: string, path: string, key: string, actor: string, bodyHash: string): IdempotencyLookup {
    const keyHash = IdempotencyStore.keyHash(method, path, key, actor);
    const row = this.db
      .prepare("SELECT body_hash, status, response_json, expires_at FROM idempotency_keys WHERE key_hash = ?")
      .get(keyHash) as { body_hash: string; status: number; response_json: string; expires_at: number } | undefined;
    if (!row) return { kind: "miss" };
    if (row.expires_at <= this.now()) {
      this.db.prepare("DELETE FROM idempotency_keys WHERE key_hash = ?").run(keyHash);
      return { kind: "miss" };
    }
    if (row.body_hash !== bodyHash) return { kind: "conflict" };
    const stored = JSON.parse(row.response_json) as { body: unknown; headers?: Record<string, string> };
    return { kind: "replay", response: { status: row.status, body: stored.body, headers: stored.headers ?? {} } };
  }

  save(method: string, path: string, key: string, actor: string, bodyHash: string, response: StoredResponse): void {
    const now = this.now();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO idempotency_keys
         (key_hash, method, path, actor, body_hash, status, response_json, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        IdempotencyStore.keyHash(method, path, key, actor),
        method.toUpperCase(),
        path,
        actor,
        bodyHash,
        response.status,
        JSON.stringify({ body: response.body, headers: response.headers }),
        now,
        now + this.ttlMs,
      );
  }

  purgeExpired(): number {
    return Number(this.db.prepare("DELETE FROM idempotency_keys WHERE expires_at <= ?").run(this.now()).changes);
  }

  count(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM idempotency_keys").get() as { n: number }).n;
  }
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
  );
}

// ---------------------------------------------------------------------------------------------------------------------

/** Words that make a command text sensitive; the text is then stored redacted, never verbatim. */
const SENSITIVE_COMMAND = /passwort|kennwort|zugangscode|\bpin\b|\biban\b|token|geheim|kreditkarte|password|secret|api[-_ ]?key/i;

export interface CommandHistoryRecord {
  id: string;
  correlationId: string;
  actor: string;
  text: string;
  redacted: boolean;
  origin: string;
  status: string;
  createdAt: string;
}

export class CommandHistoryStore {
  constructor(private readonly db: Db) {}

  static isSensitive(text: string): boolean {
    return SENSITIVE_COMMAND.test(text);
  }

  record(entry: Omit<CommandHistoryRecord, "text" | "redacted"> & { text: string; redact?: boolean }): CommandHistoryRecord {
    const { redact = false, ...record } = entry;
    const sensitive = redact || CommandHistoryStore.isSensitive(record.text);
    const stored = sensitive ? "[REDACTED]" : redactString(record.text);
    this.db
      .prepare(
        "INSERT INTO command_history (id, correlation_id, actor, text, redacted, origin, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(record.id, record.correlationId, record.actor, stored, sensitive || stored !== record.text ? 1 : 0, record.origin, record.status, record.createdAt);
    return { ...record, text: stored, redacted: sensitive || stored !== record.text };
  }

  recent(limit = 50): CommandHistoryRecord[] {
    const rows = this.db.prepare("SELECT * FROM command_history ORDER BY created_at DESC, rowid DESC LIMIT ?").all(limit) as Array<{
      id: string;
      correlation_id: string;
      actor: string;
      text: string;
      redacted: number;
      origin: string;
      status: string;
      created_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      correlationId: row.correlation_id,
      actor: row.actor,
      text: row.text,
      redacted: row.redacted === 1,
      origin: row.origin,
      status: row.status,
      createdAt: row.created_at,
    }));
  }

  count(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM command_history").get() as { n: number }).n;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export type LibraryKind = "theme" | "layout";

/** Built-in (from `config/themes`, `config/layouts`) and imported themes/layouts. Built-ins are never overwritten. */
export class LibraryStore {
  constructor(private readonly db: Db) {}

  list<T extends Theme | Layout>(kind: LibraryKind): T[] {
    const rows = this.db
      .prepare("SELECT json FROM library_items WHERE kind = ? ORDER BY built_in DESC, id")
      .all(kind) as Array<{ json: string }>;
    return rows.map((row) => JSON.parse(row.json) as T);
  }

  get<T extends Theme | Layout>(kind: LibraryKind, id: string): T | undefined {
    const row = this.db.prepare("SELECT json FROM library_items WHERE kind = ? AND id = ?").get(kind, id) as { json: string } | undefined;
    return row ? (JSON.parse(row.json) as T) : undefined;
  }

  isBuiltIn(kind: LibraryKind, id: string): boolean {
    const row = this.db.prepare("SELECT built_in FROM library_items WHERE kind = ? AND id = ?").get(kind, id) as { built_in: number } | undefined;
    return row?.built_in === 1;
  }

  put(kind: LibraryKind, id: string, value: Theme | Layout, builtIn: boolean): void {
    this.db
      .prepare(
        `INSERT INTO library_items (kind, id, json, built_in, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(kind, id) DO UPDATE SET json = excluded.json, built_in = excluded.built_in, updated_at = excluded.updated_at`,
      )
      .run(kind, id, JSON.stringify(value), builtIn ? 1 : 0, new Date().toISOString());
  }

  /** Re-seeds built-ins on every start so that repaired or updated files in `config/` take effect. */
  replaceBuiltIns(kind: LibraryKind, items: Array<{ id: string; value: Theme | Layout }>): void {
    this.db.prepare("DELETE FROM library_items WHERE kind = ? AND built_in = 1").run(kind);
    for (const item of items) this.put(kind, item.id, item.value, true);
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export interface AdapterOverride {
  adapterId: string;
  category: string;
  provider: string | null;
  enabled: boolean | null;
  config: Record<string, unknown>;
  /** Optimistic-concurrency token (`If-Match`); 1 for an adapter that was never changed through the settings UI. */
  version: number;
}

/** Non-secret adapter configuration edited through the settings UI; it layers over `adapters.yaml` at startup. */
export class AdapterOverrideStore {
  constructor(private readonly db: Db) {}

  list(): AdapterOverride[] {
    const rows = this.db.prepare("SELECT * FROM adapter_overrides").all() as Array<{
      adapter_id: string;
      category: string;
      provider: string | null;
      enabled: number | null;
      config_json: string;
      version: number;
    }>;
    return rows.map((row) => ({
      adapterId: row.adapter_id,
      category: row.category,
      provider: row.provider,
      enabled: row.enabled === null ? null : row.enabled === 1,
      config: JSON.parse(row.config_json) as Record<string, unknown>,
      version: row.version,
    }));
  }

  get(adapterId: string): AdapterOverride | undefined {
    return this.list().find((entry) => entry.adapterId === adapterId);
  }

  /** Current version of an adapter's configuration (1 until the first change is saved). */
  version(adapterId: string): number {
    const row = this.db.prepare("SELECT version FROM adapter_overrides WHERE adapter_id = ?").get(adapterId) as { version: number } | undefined;
    return row?.version ?? 1;
  }

  /** Stores the change and increments the version; returns the new version. */
  save(entry: Omit<AdapterOverride, "version">): number {
    this.db
      .prepare(
        `INSERT INTO adapter_overrides (adapter_id, category, provider, enabled, config_json, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, 2)
         ON CONFLICT(adapter_id) DO UPDATE SET category = excluded.category, provider = excluded.provider,
           enabled = excluded.enabled, config_json = excluded.config_json, updated_at = excluded.updated_at,
           version = adapter_overrides.version + 1`,
      )
      .run(
        entry.adapterId,
        entry.category,
        entry.provider,
        entry.enabled === null ? null : entry.enabled ? 1 : 0,
        JSON.stringify(entry.config),
        new Date().toISOString(),
      );
    return this.version(entry.adapterId);
  }

  replaceCategory(entry: Omit<AdapterOverride, "version">): number {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM adapter_overrides WHERE category = ? AND adapter_id != ?").run(entry.category, entry.adapterId);
      const version = this.save(entry);
      this.db.exec("COMMIT");
      return version;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
