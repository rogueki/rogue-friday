import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { openDatabase } from "../db/database";
import { DurableMemoryService } from "./durable-memory";
import { SystemBackupService } from "./system-backup";

const cleanup: string[] = [];
afterEach(() => { for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "friday-system-backup-"));
  cleanup.push(root);
  const data = join(root, "dashboard", "data");
  const vault = join(root, "vault");
  const destination = join(root, "backups");
  mkdirSync(data, { recursive: true });
  mkdirSync(join(vault, ".obsidian"), { recursive: true });
  mkdirSync(destination);
  writeFileSync(join(data, "auth.key"), "synthetic test key");
  const db = openDatabase(join(data, "dashboard.sqlite"));
  const memory = new DurableMemoryService(data, vault);
  return { root, data, vault, destination, db, memory, service: new SystemBackupService(data, db, memory) };
}

it("snapshots a consistent SQLite database and memory manifest, then verifies an inert restore", async () => {
  const f = fixture();
  f.db.prepare("INSERT INTO command_history VALUES (?,?,?,?,?,?,?,?)").run("one", "c1", "owner", "redacted", 1,
    "dashboard", "executed", "2026-10-19T00:00:00Z");
  const created = await f.service.create(f.destination, 2);
  expect(created.verified).toBe(true);
  expect(f.service.verify(created.path).fileCount).toBeGreaterThan(2);
  const restored = f.service.restoreIsolated(created.path, join(f.data, "probe"));
  expect(restored.fileCount).toBe(created.fileCount);
  expect(readFileSync(join(restored.path, "keys", "auth.key"), "utf8")).toBe("synthetic test key");
  expect(existsSync(join(f.vault, "Conversations"))).toBe(false);
  f.memory.close();
  f.db.close();
});

it("rejects a pre-existing restore target and a changed backup without touching the canary", async () => {
  const f = fixture();
  const created = await f.service.create(f.destination, 2);
  const restores = join(f.data, "system-restores");
  mkdirSync(restores);
  const target = join(restores, "canary");
  mkdirSync(target);
  writeFileSync(join(target, "sentinel"), "preserve me");
  expect(() => f.service.restoreIsolated(created.path, target)).toThrow(/new and isolated/);
  expect(readFileSync(join(target, "sentinel"), "utf8")).toBe("preserve me");
  writeFileSync(join(created.path, "keys", "auth.key"), "tampered");
  expect(() => f.service.restoreIsolated(created.path, join(restores, "unused"))).toThrow(/checksum/);
  expect(existsSync(join(restores, "unused"))).toBe(false);
  f.memory.close();
  f.db.close();
});

it("refuses a destination nested in live data or Vault", () => {
  const f = fixture();
  expect(() => f.service.preview(f.data)).toThrow(/overlaps/);
  expect(() => f.service.preview(f.vault)).toThrow(/overlaps/);
  f.memory.close();
  f.db.close();
});
