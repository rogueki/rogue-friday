import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { openDatabase } from "../db/database";
import { DurableMemoryService } from "./durable-memory";
import { SystemBackupService } from "./system-backup";
import { SystemRecoveryService } from "./system-recovery";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

async function fixture() {
  const base = mkdtempSync(join(tmpdir(), "friday-recovery-"));
  roots.push(base);
  const old = join(base, "old");
  const oldData = join(old, "dashboard", "data");
  const oldVault = join(old, "memory", "Friday");
  const destination = join(base, "backups");
  mkdirSync(oldData, { recursive: true });
  mkdirSync(join(oldVault, ".obsidian"), { recursive: true });
  mkdirSync(join(old, "config"));
  mkdirSync(destination);
  writeFileSync(join(oldData, "auth.key"), Buffer.alloc(32, 1).toString("base64"));
  writeFileSync(join(old, "config", "hermes_api.key"), "old-hermes-key");
  const db = openDatabase(join(oldData, "dashboard.sqlite"));
  const memory = new DurableMemoryService(oldData, oldVault);
  const backup = new SystemBackupService(oldData, db, memory);
  const created = await backup.create(destination, 2);
  const manifestPath = join(created.path, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    files: Record<string, string>; wslIncluded: boolean; sourceInstallRoot: string; sourceVaultPath: string;
  };
  const oldStatePath = join(created.path, "config", "install-state.json");
  mkdirSync(join(created.path, "config"), { recursive: true });
  writeFileSync(oldStatePath, JSON.stringify({ dashboard_hash: "same-build", distro_name: "FridayOld",
    ports: { Dashboard: 43691 } }));
  manifest.files["config/install-state.json"] = digest(oldStatePath);
  const wsl = join(created.path, "wsl");
  mkdirSync(wsl);
  writeFileSync(join(wsl, "manifest.json"), JSON.stringify({ version: 1, files: {}, sqlite: [],
    excludedRebuildable: ["cache", "hermes-agent", "installs", "tools"], hermesRevision: "a".repeat(40) }));
  manifest.files["wsl/manifest.json"] = digest(join(wsl, "manifest.json"));
  manifest.wslIncluded = true;
  writeFileSync(manifestPath, JSON.stringify(manifest));
  expect(backup.verify(created.path).fileCount).toBeGreaterThan(2);

  const fresh = join(base, "fresh");
  const freshData = join(fresh, "dashboard", "data");
  mkdirSync(join(fresh, "dashboard", "apps", "control-api", "dist"), { recursive: true });
  mkdirSync(join(fresh, "config"));
  mkdirSync(join(fresh, "memory", "Friday", ".obsidian"), { recursive: true });
  mkdirSync(freshData, { recursive: true });
  writeFileSync(join(fresh, "dashboard", "apps", "control-api", "dist", "main.js"), "installed-build");
  writeFileSync(join(fresh, "config", "install-state.json"), JSON.stringify({ distro_name: "FridayNew",
    distro_location: join(base, "new-distro"), dashboard_hash: "same-build", ports: { Dashboard: 43791 },
    done: ["dashboard"] }));
  const freshDb = openDatabase(join(freshData, "dashboard.sqlite"));
  freshDb.close();
  return { base, old, fresh, db, memory, backup, created, service: new SystemRecoveryService(backup) };
}

it("prepares credential and state import without changing the fresh installation", async () => {
  const f = await fixture();
  const before = readFileSync(join(f.fresh, "config", "install-state.json"), "utf8");
  const staged = f.service.prepare(f.created.path, f.fresh);
  expect(staged.wslRevision).toBe("a".repeat(40));
  expect(readFileSync(join(staged.path, "new", "config", "hermes_api.key"), "utf8")).toBe("old-hermes-key");
  const next = JSON.parse(readFileSync(join(staged.path, "new", "config", "install-state.json"), "utf8")) as
    { distro_name: string; ports: { Dashboard: number }; dashboard_hash: string };
  expect(next).toMatchObject({ distro_name: "FridayNew", ports: { Dashboard: 43791 }, dashboard_hash: "same-build" });
  expect(readFileSync(join(staged.path, "new", "config", "obsidian-vault-path.txt"), "utf8"))
    .toBe(join(f.fresh, "memory", "Friday"));
  expect(readFileSync(join(f.fresh, "config", "install-state.json"), "utf8")).toBe(before);
  expect(existsSync(join(f.fresh, "config", "hermes_api.key"))).toBe(false);
  f.memory.close(); f.db.close();
});

it("refuses a target with existing activity or the same distro", async () => {
  const f = await fixture();
  const active = openDatabase(join(f.fresh, "dashboard", "data", "dashboard.sqlite"));
  active.prepare("INSERT INTO command_history VALUES (?,?,?,?,?,?,?,?)").run("one", "c1", "owner", "user text", 1,
    "dashboard", "executed", "2026-10-19T00:00:00Z");
  active.close();
  expect(() => f.service.prepare(f.created.path, f.fresh)).toThrow(/conversation activity/);
  f.memory.close(); f.db.close();
});

it("applies a prepared import and rolls back only its unchanged files", async () => {
  const f = await fixture();
  const originalState = readFileSync(join(f.fresh, "config", "install-state.json"), "utf8");
  const originalDb = readFileSync(join(f.fresh, "dashboard", "data", "dashboard.sqlite"));
  const staged = f.service.prepare(f.created.path, f.fresh);
  expect(f.service.apply(staged.path)).toMatchObject({ state: "applied", fileCount: staged.fileCount });
  expect(readFileSync(join(f.fresh, "config", "hermes_api.key"), "utf8")).toBe("old-hermes-key");
  expect(readFileSync(join(f.fresh, "config", "install-state.json"), "utf8")).not.toBe(originalState);
  expect(f.service.rollback(staged.path).state).toBe("rolled-back");
  expect(readFileSync(join(f.fresh, "config", "install-state.json"), "utf8")).toBe(originalState);
  expect(readFileSync(join(f.fresh, "dashboard", "data", "dashboard.sqlite")).equals(originalDb)).toBe(true);
  expect(existsSync(join(f.fresh, "config", "hermes_api.key"))).toBe(false);
  f.memory.close(); f.db.close();
});

it("refuses rollback after recovered state has changed", async () => {
  const f = await fixture();
  const staged = f.service.prepare(f.created.path, f.fresh);
  f.service.apply(staged.path);
  writeFileSync(join(f.fresh, "config", "hermes_api.key"), "newer-secret");
  expect(() => f.service.rollback(staged.path)).toThrow(/changed/);
  expect(readFileSync(join(f.fresh, "config", "hermes_api.key"), "utf8")).toBe("newer-secret");
  f.memory.close(); f.db.close();
});

it("refuses a fresh database with uncheckpointed WAL bytes", async () => {
  const f = await fixture();
  const database = join(f.fresh, "dashboard", "data", "dashboard.sqlite");
  writeFileSync(`${database}-wal`, "synthetic pending bytes");
  expect(() => f.service.prepare(f.created.path, f.fresh)).toThrow(/checkpointed SQLite/);
  expect(existsSync(join(f.fresh, "config", "hermes_api.key"))).toBe(false);
  f.memory.close(); f.db.close();
});

it("preserves a fresh database sidecar through apply and rollback", async () => {
  const f = await fixture();
  const database = join(f.fresh, "dashboard", "data", "dashboard.sqlite");
  writeFileSync(`${database}-shm`, "preexisting-sidecar");
  const staged = f.service.prepare(f.created.path, f.fresh);
  const sidecarBefore = readFileSync(`${database}-shm`);
  f.service.apply(staged.path);
  expect(existsSync(`${database}-shm`)).toBe(false);
  f.service.rollback(staged.path);
  expect(readFileSync(`${database}-shm`).equals(sidecarBefore)).toBe(true);
  f.memory.close(); f.db.close();
});

it("can roll back an interrupted file move using the persistent journal", async () => {
  const f = await fixture();
  const staged = f.service.prepare(f.created.path, f.fresh);
  const planPath = join(staged.path, "recovery-plan.json");
  const plan = JSON.parse(readFileSync(planPath, "utf8")) as { state: string; files: Record<string, string> };
  plan.state = "applying";
  writeFileSync(planPath, JSON.stringify(plan));
  const name = "config/install-state.json";
  const target = join(f.fresh, name);
  const saved = join(staged.path, "previous-active", name);
  mkdirSync(join(staged.path, "previous-active", "config"), { recursive: true });
  const original = readFileSync(target, "utf8");
  renameSync(target, saved);
  renameSync(join(staged.path, "new", name), target);
  expect(f.service.rollback(staged.path).state).toBe("rolled-back");
  expect(readFileSync(target, "utf8")).toBe(original);
  f.memory.close(); f.db.close();
});
