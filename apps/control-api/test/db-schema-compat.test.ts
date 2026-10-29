import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  MIGRATIONS,
  migrate,
  openDatabase,
  restoreMigrationBackup,
  unknownMigrations,
  type Db,
} from "../src/db/database";

// DASH-19.06: ein aelterer Stand darf nicht still auf einem Schema einer neueren Version laufen. Der Test arbeitet auf
// echten Dateien, haengt eine unbekannte Migrationsmarke an und prueft Migration wie Rueckspielen einer Sicherung.
describe("schema compatibility with newer database versions", () => {
  const root = mkdtempSync(join(tmpdir(), "friday-schema-compat-"));
  afterAll(() => { rmSync(root, { recursive: true, force: true }); });

  const future = 9999;

  /** Haengt eine Migrationsmarke an, die dieser Code nicht kennt. */
  const markNewer = (db: Db) => {
    db.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)")
      .run(future, "future", "2027-01-01T00:00:00Z");
  };

  const migrationIds = (db: Db) =>
    (db.prepare("SELECT id FROM schema_migrations ORDER BY id").all() as Array<{ id: number }>).map((row) => row.id);

  it("reports no unknown migrations on a fresh database and stays repeatable", () => {
    const db = openDatabase(":memory:");
    expect(unknownMigrations(db)).toEqual([]);
    expect(migrate(db)).toEqual([]);
    expect(unknownMigrations(db)).toEqual([]);
    expect(migrationIds(db)).toEqual(MIGRATIONS.map((migration) => migration.id));
    db.close();
  });

  it("refuses to migrate a database written by a newer version and leaves it untouched", () => {
    const file = join(root, "newer.sqlite");
    const db = openDatabase(file);
    markNewer(db);
    expect(unknownMigrations(db)).toEqual([future]);

    let message = "";
    try {
      migrate(db);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("neueren Friday-Version");
    expect(message).toContain(String(future));

    // Die fremde Marke bleibt stehen: der alte Code loescht oder aendert nichts.
    expect(migrationIds(db)).toEqual([...MIGRATIONS.map((migration) => migration.id), future]);
    expect(unknownMigrations(db)).toEqual([future]);
    db.close();
  });

  it("refuses a backup from a newer version without writing the target", () => {
    const source = join(root, "newer-backup.sqlite");
    const newer = openDatabase(source);
    markNewer(newer);
    newer.close();

    const target = join(root, "ziel.sqlite");
    writeFileSync(target, "unveraendert");
    expect(() => restoreMigrationBackup(source, target)).toThrow(/neueren Friday-Version/);
    expect(readFileSync(target, "utf8")).toBe("unveraendert");

    const missing = join(root, "nicht-angelegt.sqlite");
    expect(() => restoreMigrationBackup(source, missing)).toThrow(/neueren Friday-Version/);
    expect(existsSync(missing)).toBe(false);
  });

  it("restores a backup that only knows migrated versions of this build", () => {
    const file = join(root, "aktuell.sqlite");
    const db = openDatabase(file);
    db.prepare("INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)")
      .run("konto", "owner", "2026-10-22T10:00:00.000Z");
    db.close();

    const target = join(root, "wiederhergestellt.sqlite");
    const restore = restoreMigrationBackup(file, target);
    expect(restore.integrity).toBe("ok");
    expect(restore.restored).toBe(target);

    const restored = openDatabase(target);
    expect(unknownMigrations(restored)).toEqual([]);
    expect(restored.prepare("SELECT value FROM kv WHERE key = ?").get("konto") as unknown).toEqual({ value: "owner" });
    restored.close();
  });
});
