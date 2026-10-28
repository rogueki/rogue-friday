import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { MIGRATIONS, migrate, openDatabase, type Db } from "../src/db/database";

// DASH-02.04/02.05: migrations must be repeatable and must keep accounts, drafts and plans. The test opens a real
// SQLite file, writes domain rows, migrates again (second call and after a restart) and compares the rows byte-wise.
describe("database migrations are repeatable and preserve domain data", () => {
  const root = mkdtempSync(join(tmpdir(), "friday-migrate-"));
  afterAll(() => { rmSync(root, { recursive: true, force: true }); });

  const row = (db: Db, sql: string, ...params: Array<string | number>) => db.prepare(sql).get(...params);

  it("runs each migration once, keeps accounts, mail drafts and studio plans, and survives a restart", () => {
    const file = join(root, "dashboard.sqlite");
    const first = openDatabase(file);
    // openDatabase migrates on open; an explicitly repeated run must be a no-op.
    expect(migrate(first)).toEqual([]);

    const account = { username: "owner", revision: 3, json: '{"username":"owner","displayName":"Owner"}' };
    first.prepare("INSERT INTO owner_onboarding (id, revision, json, updated_at) VALUES (1, ?, ?, ?)")
      .run(account.revision, account.json, "2026-10-22T10:00:00.000Z");
    first.prepare("INSERT INTO mail_send_journal (key_hash, actor, account_id, body_hash, state, archive_pending, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("hash-1", "owner", "account-1", "body-1", "pending", 0, "2026-10-22T10:01:00.000Z", "2026-10-22T10:01:00.000Z");
    first.prepare("INSERT INTO content_studio_plan (id, revision, json, updated_at) VALUES (1, ?, ?, ?)")
      .run(7, '{"ideas":[{"id":"idea-1"}],"postings":[]}', "2026-10-22T10:02:00.000Z");
    first.prepare("INSERT INTO library_items (kind, id, json, built_in, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run("skill", "lib-1", '{"id":"lib-1"}', 0, "2026-10-22T10:03:00.000Z");
    const appliedBefore = (first.prepare("SELECT id, name, applied_at FROM schema_migrations ORDER BY id").all() as Array<{ id: number }>)
      .map((entry) => entry.id);
    expect(appliedBefore.length).toBeGreaterThanOrEqual(MIGRATIONS.length);

    // Same process, same handle: nothing is applied twice.
    expect(migrate(first)).toEqual([]);
    expect((first.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get() as { count: number }).count)
      .toBe(appliedBefore.length);
    first.close();

    // Restart on the same file: openDatabase migrates again, nothing may change.
    const second = openDatabase(file);
    expect((second.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get() as { count: number }).count)
      .toBe(appliedBefore.length);
    expect(migrate(second)).toEqual([]);
    expect(row(second, "SELECT revision, json FROM owner_onboarding WHERE id = 1") as unknown)
      .toEqual({ revision: account.revision, json: account.json });
    expect(row(second, "SELECT state, archive_pending FROM mail_send_journal WHERE key_hash = ?", "hash-1") as unknown)
      .toEqual({ state: "pending", archive_pending: 0 });
    expect(row(second, "SELECT revision, json FROM content_studio_plan WHERE id = 1") as unknown)
      .toEqual({ revision: 7, json: '{"ideas":[{"id":"idea-1"}],"postings":[]}' });
    expect(row(second, "SELECT json FROM library_items WHERE kind = 'skill' AND id = 'lib-1'") as unknown)
      .toEqual({ json: '{"id":"lib-1"}' });
    expect((second.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check).toBe("ok");

    // A second write after the repeated migration still works, so the schema is intact, not only readable.
    second.prepare("UPDATE mail_send_journal SET state = 'sent', updated_at = ? WHERE key_hash = ?").run("2026-10-22T11:00:00.000Z", "hash-1");
    expect(row(second, "SELECT state FROM mail_send_journal WHERE key_hash = ?", "hash-1") as unknown).toEqual({ state: "sent" });
    second.close();
  });

  it("keeps voice enrollment outside the dashboard database", () => {
    // Enrollment is delegated to the voice service over HTTP; a dashboard migration cannot lose it.
    const sql = MIGRATIONS.map((migration) => migration.sql).join("\n");
    expect(sql.toLowerCase()).not.toContain("enrollment");
    const memory = openDatabase(":memory:");
    const tables = (memory.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>)
      .map(({ name }) => name);
    expect(tables.filter((name) => name.includes("enroll"))).toEqual([]);
    memory.close();
  });
});