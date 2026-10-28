import { copyFileSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  listMigrationBackups,
  MIGRATIONS,
  migrate,
  openDatabase,
  pendingMigrations,
  restoreMigrationBackup,
  type Db,
} from "../src/db/database";

// DASH-02.05: vor jeder Schema-Migration entsteht eine gepruefte Sicherung, und ein Rueckspielen stellt den alten
// Stand wieder her, ohne die Datenbank neu anzulegen. Der Drill arbeitet auf echten Dateien, nicht auf Attrappen.
describe("migrations back up first and can be rolled back", () => {
  const root = mkdtempSync(join(tmpdir(), "friday-migration-backup-"));
  afterAll(() => { rmSync(root, { recursive: true, force: true }); });

  const newest = MIGRATIONS[MIGRATIONS.length - 1]!;
  const createdTables = [...newest.sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)/g)].map((match) => match[1]!);

  /** Baut den Zustand einer Installation, die vor der letzten Migration steht. */
  const downgrade = (db: Db) => {
    for (const table of createdTables) db.exec(`DROP TABLE IF EXISTS ${table}`);
    db.prepare("DELETE FROM schema_migrations WHERE id = ?").run(newest.id);
  };

  it("writes a backup only when an existing installation has pending migrations and keeps the last three", () => {
    const file = join(root, "dashboard.sqlite");
    const first = openDatabase(file);
    // Eine frische Datei ist nichts, was gesichert werden muesste.
    expect(listMigrationBackups(file)).toEqual([]);
    first.close();

    const older = openDatabase(file);
    downgrade(older);
    older.prepare("INSERT INTO kv (key, value, updated_at) VALUES ('konto', 'owner', '2026-10-22T10:00:00.000Z') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
    expect(pendingMigrations(older)).toEqual([newest.id]);
    older.close();

    const upgraded = openDatabase(file);
    expect(pendingMigrations(upgraded)).toEqual([]);
    const backups = listMigrationBackups(file);
    expect(backups).toHaveLength(1);
    expect(backups[0]!.bytes).toBeGreaterThan(0);
    expect((upgraded.prepare("SELECT COUNT(*) AS count FROM kv").get() as { count: number }).count).toBe(1);
    upgraded.close();

    // Drei weitere Migrationslaeufe erzeugen drei weitere Sicherungen; nur die letzten drei bleiben liegen.
    for (let round = 0; round < 3; round++) {
      const db = openDatabase(file);
      downgrade(db);
      db.close();
      const next = openDatabase(file);
      expect(pendingMigrations(next)).toEqual([]);
      next.close();
    }
    expect(listMigrationBackups(file).length).toBe(3);
  });

  it("restores the pre-migration state and re-applies the migration afterwards", () => {
    const file = join(root, "restore.sqlite");
    const db = openDatabase(file);
    downgrade(db);
    db.prepare("INSERT INTO kv (key, value, updated_at) VALUES ('draft', 'entwurf-1', '2026-10-22T11:00:00.000Z')").run();
    // Der alte Stand hat die Tabelle der letzten Migration noch nicht.
    expect((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(createdTables[0]!) as unknown)).toBeUndefined();
    db.close();

    const migrated = openDatabase(file);
    expect(pendingMigrations(migrated)).toEqual([]);
    migrated.close();
    const backup = listMigrationBackups(file)[0]!;
    expect(backup).toBeDefined();

    const restore = restoreMigrationBackup(backup, file);
    expect(restore.integrity).toBe("ok");
    expect(restore.restored).toBe(file);

    const rolledBack = openDatabase(file);
    // Der Entwurf ist noch da; die Migration lief nach dem Rueckspielen erneut und zog ihre Marke nach.
    expect(rolledBack.prepare("SELECT value FROM kv WHERE key = 'draft'").get() as unknown).toEqual({ value: "entwurf-1" });
    expect((rolledBack.prepare("SELECT COUNT(*) AS count FROM kv").get() as { count: number }).count).toBe(1);
    expect(pendingMigrations(rolledBack)).toEqual([]);
    expect((rolledBack.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check).toBe("ok");
    rolledBack.close();
    expect(migrate).toBeTypeOf("function");
  });

  it("refuses a corrupted backup instead of overwriting the database", () => {
    const file = join(root, "corrupt.sqlite");
    const db = openDatabase(file);
    db.prepare("INSERT INTO kv (key, value, updated_at) VALUES ('wichtig', 'bleibt', '2026-10-22T12:00:00.000Z')").run();
    db.close();

    const broken = join(root, "kaputt.bak");
    copyFileSync(file, broken);
    writeFileSync(broken, Buffer.alloc(4096, 0x41));
    expect(() => restoreMigrationBackup(broken, file)).toThrow(/beschaedigt|keine Migrationsmarke|lesbare Datenbank/);

    const after = openDatabase(file);
    expect(after.prepare("SELECT value FROM kv WHERE key = 'wichtig'").get() as unknown).toEqual({ value: "bleibt" });
    after.close();
  });

  it("never writes a backup for an in-memory database", () => {
    const before = readdirSync(root).length;
    const memory = openDatabase(":memory:");
    expect(pendingMigrations(memory)).toEqual([]);
    memory.close();
    expect(readdirSync(root).length).toBe(before);
  });
});