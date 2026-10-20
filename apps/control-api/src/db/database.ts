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
  {
    id: 10,
    name: "telephony-call-journal",
    sql: `
      CREATE TABLE telephony_calls (
        id TEXT PRIMARY KEY,
        key_hash TEXT NOT NULL UNIQUE,
        actor TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        destination TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('pending', 'requested', 'owner_answered', 'ended', 'failed', 'unknown')),
        adapter_status INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_telephony_calls_actor_time ON telephony_calls (actor, created_at);
      CREATE TABLE telephony_previews (
        token_hash TEXT PRIMARY KEY,
        actor TEXT NOT NULL,
        destination TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        consumed_at INTEGER
      );
      CREATE INDEX idx_telephony_previews_expiry ON telephony_previews (expires_at);
    `,
  },
  {
    id: 11,
    name: "cloudtalk-call-journal",
    sql: `
      CREATE TABLE cloudtalk_previews (
        token_hash TEXT PRIMARY KEY, actor TEXT NOT NULL, destination TEXT NOT NULL,
        expires_at INTEGER NOT NULL, consumed_at INTEGER
      );
      CREATE INDEX idx_cloudtalk_previews_expiry ON cloudtalk_previews (expires_at);
      CREATE TABLE cloudtalk_calls (
        id TEXT PRIMARY KEY, key_hash TEXT NOT NULL UNIQUE, actor TEXT NOT NULL,
        request_hash TEXT NOT NULL, destination TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('pending', 'requested', 'rejected', 'unknown')),
        provider_status INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_cloudtalk_calls_actor_time ON cloudtalk_calls (actor, created_at);
    `,
  },
  {
    id: 12,
    name: "cloudtalk-voice-agent-reminders",
    sql: `
      CREATE TABLE cloudtalk_reminder_calls (
        event_id TEXT NOT NULL, event_version INTEGER NOT NULL,
        owner_id TEXT NOT NULL, destination TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('pending', 'requested', 'rejected', 'unknown')),
        provider_status INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY (event_id, event_version)
      );
      CREATE INDEX idx_cloudtalk_reminder_owner_time ON cloudtalk_reminder_calls (owner_id, created_at);
    `,
  },
  {
    id: 13,
    name: "multi-mail-send-journal",
    sql: `
      CREATE TABLE mail_send_journal (
        key_hash TEXT PRIMARY KEY,
        actor TEXT NOT NULL,
        account_id TEXT NOT NULL,
        body_hash TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('pending', 'sent', 'uncertain')),
        archive_pending INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_mail_send_account ON mail_send_journal (account_id, created_at);
    `,
  },
  {
    id: 14,
    name: "mail-archive-receipt",
    sql: `
      ALTER TABLE mail_send_journal ADD COLUMN account_hash TEXT;
      ALTER TABLE mail_send_journal ADD COLUMN message_id TEXT;
    `,
  },
  {
    id: 15,
    name: "messenger-send-journal",
    sql: `
      CREATE TABLE messenger_send_journal (
        key_hash TEXT PRIMARY KEY,
        actor TEXT NOT NULL,
        account_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        recipient TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('pending', 'sent', 'uncertain')),
        external_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_messenger_send_actor ON messenger_send_journal (actor, created_at);
    `,
  },
  {
    id: 16,
    name: "messenger-outbound-targets",
    sql: `
      CREATE TABLE messenger_outbound_targets (
        id TEXT PRIMARY KEY,
        actor TEXT NOT NULL,
        account_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        recipient TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(actor,account_id,platform,recipient)
      );
      CREATE INDEX idx_messenger_targets_actor ON messenger_outbound_targets (actor,platform);
    `,
  },
  {
    id: 17,
    name: "messenger-send-draft-hash",
    sql: "ALTER TABLE messenger_send_journal ADD COLUMN draft_hash TEXT;",
  },
  {
    id: 18,
    name: "durable-notifications",
    sql: `
      CREATE TABLE notifications (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        resolved_at TEXT,
        status TEXT NOT NULL CHECK (status IN ('open', 'acknowledged', 'snoozed', 'resolved')),
        pending_dispatch INTEGER NOT NULL DEFAULT 0 CHECK (pending_dispatch IN (0, 1)),
        json TEXT NOT NULL
      );
      CREATE INDEX idx_notifications_status_created ON notifications (status, created_at DESC, id DESC);
      CREATE INDEX idx_notifications_retention ON notifications (resolved_at) WHERE status = 'resolved' AND pending_dispatch = 0;
    `,
  },
  {
    id: 19,
    name: "audit-archive-segments",
    sql: `
      CREATE TABLE audit_archive_segments (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL UNIQUE,
        first_seq INTEGER NOT NULL,
        last_seq INTEGER NOT NULL,
        row_count INTEGER NOT NULL,
        previous_hash TEXT NOT NULL,
        head_hash TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_audit_archive_first ON audit_archive_segments (first_seq);
    `,
  },
  {
    id: 20,
    name: "notification-messenger-origin",
    sql: `
      CREATE TABLE notification_messenger_stages (
        notification_id TEXT NOT NULL,
        step INTEGER NOT NULL CHECK (step > 0),
        actor TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        draft_json TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('staged', 'sent', 'uncertain')),
        receipt_json TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (notification_id, step)
      );
    `,
  },
  {
    id: 21,
    name: "native-action-approval-requests",
    sql: `
      CREATE TABLE native_approval_requests (
        owner_id TEXT NOT NULL,
        request_key TEXT NOT NULL,
        proposal_hash TEXT NOT NULL,
        result_json TEXT NOT NULL,
        action_json TEXT,
        state TEXT NOT NULL CHECK (state IN ('draft', 'pending', 'dispatching', 'uncertain', 'completed', 'rejected', 'expired')),
        receipt_json TEXT,
        dispatch_token TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (owner_id, request_key)
      );
      CREATE INDEX idx_native_approval_owner_created ON native_approval_requests (owner_id, created_at);
      CREATE UNIQUE INDEX idx_native_approval_id ON native_approval_requests (json_extract(result_json, '$.approval.id'));
    `,
  },
  {
    id: 22,
    name: "local-research-evidence",
    sql: `
      CREATE TABLE research_projects (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        request_key TEXT NOT NULL,
        topic TEXT NOT NULL,
        mission TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('running', 'review', 'failed')),
        error_code TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (owner_id, request_key)
      );
      CREATE INDEX idx_research_projects_owner_created ON research_projects (owner_id, created_at DESC);
      CREATE TABLE research_sources (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        domain TEXT NOT NULL,
        excerpt TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (project_id, url)
      );
      CREATE INDEX idx_research_sources_project ON research_sources (project_id, created_at);
    `,
  },
  {
    id: 23,
    name: "research-provider-provenance",
    sql: `ALTER TABLE research_projects ADD COLUMN provider TEXT NOT NULL DEFAULT 'searxng';`,
  },
  {
    id: 26,
    name: "research-page-evidence",
    sql: `
      ALTER TABLE research_sources ADD COLUMN status TEXT NOT NULL DEFAULT 'queued';
      ALTER TABLE research_sources ADD COLUMN retrieved_at TEXT;
      ALTER TABLE research_sources ADD COLUMN body_text TEXT;
      ALTER TABLE research_sources ADD COLUMN content_hash TEXT;
      ALTER TABLE research_sources ADD COLUMN error_code TEXT;
    `,
  },
  {
    id: 27,
    name: "research-draft-findings",
    sql: `
      CREATE TABLE research_findings (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
        source_id TEXT NOT NULL REFERENCES research_sources(id) ON DELETE CASCADE,
        statement TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (project_id, source_id)
      );
      CREATE INDEX idx_research_findings_project ON research_findings (project_id, created_at);
      ALTER TABLE research_projects ADD COLUMN result_summary TEXT;
    `,
  },
  {
    id: 28,
    name: "pending-command-clarifications",
    sql: `
      CREATE TABLE pending_command_clarifications (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        session_hash TEXT NOT NULL,
        payload_ciphertext TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE (owner_id, session_hash)
      );
      CREATE INDEX idx_pending_command_clarifications_expiry ON pending_command_clarifications (expires_at);
    `,
  },
  {
    id: 29,
    name: "encrypted-clarified-mail-drafts",
    sql: `
      CREATE TABLE encrypted_clarified_mail_drafts (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        session_binding TEXT NOT NULL,
        intent_hash TEXT NOT NULL,
        payload_ciphertext TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_encrypted_clarified_mail_drafts_expiry ON encrypted_clarified_mail_drafts (expires_at);
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
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)",
  );
  const applied = new Set(
    (db.prepare("SELECT id FROM schema_migrations").all() as Array<{ id: number }>).map((row) => row.id),
  );
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
      throw new Error(
        `Migration ${migration.id} (${migration.name}) failed: ${error instanceof Error ? error.message : String(error)}`,
        {
          cause: error,
        },
      );
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
