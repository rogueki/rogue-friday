import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Db = DatabaseSync;

interface Migration {
  id: number;
  name: string;
  sql: string;
}

/** Append-only list: never edit a shipped migration, add a new one. */
export const MIGRATIONS: readonly Migration[] = [
  {
    id: 1,
    name: "core-tables",
    sql: `
      CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);

      CREATE TABLE settings_areas (
        area TEXT PRIMARY KEY,
        json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE audit_log (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        occurred_at TEXT NOT NULL,
        correlation_id TEXT NOT NULL,
        category TEXT NOT NULL,
        action TEXT NOT NULL,
        json TEXT NOT NULL,
        prev_hash TEXT NOT NULL,
        hash TEXT NOT NULL
      );
      CREATE INDEX idx_audit_occurred ON audit_log (occurred_at);

      CREATE TABLE idempotency_keys (
        key_hash TEXT PRIMARY KEY,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        actor TEXT NOT NULL,
        body_hash TEXT NOT NULL,
        status INTEGER NOT NULL,
        response_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX idx_idempotency_expires ON idempotency_keys (expires_at);

      CREATE TABLE command_history (
        id TEXT PRIMARY KEY,
        correlation_id TEXT NOT NULL,
        actor TEXT NOT NULL,
        text TEXT NOT NULL,
        redacted INTEGER NOT NULL,
        origin TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_command_created ON command_history (created_at);

      CREATE TABLE library_items (
        kind TEXT NOT NULL,
        id TEXT NOT NULL,
        json TEXT NOT NULL,
        built_in INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (kind, id)
      );

      CREATE TABLE adapter_overrides (
        adapter_id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        provider TEXT,
        enabled INTEGER,
        config_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    id: 2,
    name: "adapter-override-version",
    sql: `
      ALTER TABLE adapter_overrides ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
    `,
  },
  {
    id: 3,
    name: "content-studio-plan",
    sql: `
      CREATE TABLE content_studio_plan (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        revision INTEGER NOT NULL CHECK (revision >= 1),
        json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    id: 4,
    name: "content-studio-production-jobs",
    sql: `
      CREATE TABLE content_studio_jobs (
        id TEXT PRIMARY KEY,
        request_key TEXT NOT NULL UNIQUE,
        request_hash TEXT NOT NULL,
        idea_id TEXT NOT NULL,
        specification_json TEXT NOT NULL,
        state TEXT NOT NULL,
        provider_task_id TEXT,
        result_url TEXT,
        error_code TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_content_studio_jobs_state ON content_studio_jobs (state, updated_at);
    `,
  },
  {
    id: 5,
    name: "owner-onboarding",
    sql: `
      CREATE TABLE owner_onboarding (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        revision INTEGER NOT NULL CHECK (revision >= 1),
        json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    id: 6,
    name: "coding-voice-repository",
    sql: `
      CREATE TABLE coding_voice_repository (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        revision INTEGER NOT NULL CHECK (revision >= 1),
        alias TEXT NOT NULL,
        repository TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    id: 7,
    name: "himalaya-send-journal",
    sql: `
      CREATE TABLE himalaya_send_journal (
        key_hash TEXT PRIMARY KEY,
        actor TEXT NOT NULL,
        body_hash TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('pending', 'sent', 'unknown')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    id: 8,
    name: "caldav-create-journal",
    sql: `
      CREATE TABLE caldav_create_journal (
        key_hash TEXT PRIMARY KEY,
        actor TEXT NOT NULL,
        body_hash TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('pending', 'created', 'unknown')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    id: 9,
    name: "local-calendar-events",
    sql: `
      CREATE TABLE local_calendar_events (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version >= 1),
        title TEXT NOT NULL,
        starts_at TEXT NOT NULL,
        ends_at TEXT NOT NULL,
        time_zone TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_local_calendar_range ON local_calendar_events (starts_at, ends_at);
    `,
  },
];

export function openDatabase(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
  migrate(db);
  return db;
}

export function migrate(db: Db): number[] {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
  const applied = new Set((db.prepare("SELECT id FROM schema_migrations").all() as Array<{ id: number }>).map((row) => row.id));
  const ran: number[] = [];
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    db.exec("BEGIN");
    try {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(
        migration.id,
        migration.name,
        new Date().toISOString(),
      );
      db.exec("COMMIT");
      ran.push(migration.id);
    } catch (error) {
      db.exec("ROLLBACK");
      throw new Error(`Migration ${migration.id} (${migration.name}) failed: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      });
    }
  }
  return ran;
}

export function kvGet(db: Db, key: string): string | undefined {
  const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value;
}

export function kvSet(db: Db, key: string, value: string): void {
  db.prepare(
    "INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).run(key, value, new Date().toISOString());
}
