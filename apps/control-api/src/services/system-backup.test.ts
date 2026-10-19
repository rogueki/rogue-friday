import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, symlinkSync, unlinkSync } from "node:fs";
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
  writeFileSync(join(data, "auth.key"), Buffer.alloc(32, 1).toString("base64"));
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
  expect(readFileSync(join(restored.path, "keys", "auth.key"), "utf8")).toBe(Buffer.alloc(32, 1).toString("base64"));
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

it("refuses a destination nested in live data or Vault", async () => {
  const f = fixture();
  await expect(f.service.preview(f.data)).rejects.toThrow(/overlaps/);
  await expect(f.service.preview(f.vault)).rejects.toThrow(/overlaps/);
  f.memory.close();
  f.db.close();
});

it("requires every manifest artifact and refuses unlisted files or symlinks", async () => {
  const f = fixture();
  const created = await f.service.create(f.destination, 2);
  const manifestPath = join(created.path, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { files: Record<string, string> };
  delete manifest.files["dashboard.sqlite"];
  writeFileSync(manifestPath, JSON.stringify(manifest));
  expect(() => f.service.verify(created.path)).toThrow(/manifest/);
  manifest.files["dashboard.sqlite"] = "a".repeat(64);
  writeFileSync(manifestPath, JSON.stringify(manifest));
  expect(() => f.service.verify(created.path)).toThrow(/checksum/);
  writeFileSync(join(created.path, "extra.txt"), "unlisted");
  expect(() => f.service.verify(created.path)).toThrow(/inventory/);
  f.memory.close();
  f.db.close();
});

it("rejects an omitted Memory manifest even when the backup inventory matches", async () => {
  const f = fixture();
  const created = await f.service.create(f.destination, 2);
  const manifestPath = join(created.path, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { files: Record<string, string> };
  delete manifest.files["memory/manifest.json"];
  unlinkSync(join(created.path, "memory", "manifest.json"));
  writeFileSync(manifestPath, JSON.stringify(manifest));
  expect(() => f.service.verify(created.path)).toThrow(/manifest/);
  f.memory.close();
  f.db.close();
});

it("includes selected custom voice references and refuses a missing configured reference", async () => {
  const f = fixture();
  const config = join(f.root, "config");
  mkdirSync(config);
  const reference = join(f.root, "custom-voice.wav");
  writeFileSync(reference, "synthetic-audio");
  writeFileSync(join(config, "voice.json"), JSON.stringify({ tts_reference: reference }));
  const created = await f.service.create(f.destination, 2);
  const manifest = JSON.parse(readFileSync(join(created.path, "manifest.json"), "utf8")) as
    { voiceSources: Record<string, string> };
  expect(readFileSync(join(created.path, manifest.voiceSources[reference]!), "utf8")).toBe("synthetic-audio");
  unlinkSync(reference);
  await expect(f.service.create(f.destination, 2)).rejects.toThrow(/voice reference is missing/);
  f.memory.close();
  f.db.close();
});

it("prunes only registered snapshots and preserves a same-prefix canary", async () => {
  const f = fixture();
  const canary = join(f.destination, "friday-system-lookalike");
  mkdirSync(canary);
  writeFileSync(join(canary, "sentinel"), "untouched");
  const first = await f.service.create(f.destination, 1);
  const second = await f.service.create(f.destination, 1);
  expect(existsSync(first.path)).toBe(false);
  expect(existsSync(second.path)).toBe(true);
  expect(readFileSync(join(canary, "sentinel"), "utf8")).toBe("untouched");
  f.memory.close();
  f.db.close();
});

it("rejects a symlinked manifest before reading its target", async () => {
  const f = fixture();
  const created = await f.service.create(f.destination, 2);
  const manifest = join(created.path, "manifest.json");
  const outside = join(f.root, "outside-manifest.json");
  writeFileSync(outside, readFileSync(manifest));
  unlinkSync(manifest);
  try { symlinkSync(outside, manifest, "file"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") { f.memory.close(); f.db.close(); return; }
    throw error;
  }
  expect(() => f.service.verify(created.path)).toThrow(/ordinary file/);
  f.memory.close();
  f.db.close();
});
