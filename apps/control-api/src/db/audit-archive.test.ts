import { mkdtempSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { openDatabase } from "./database";
import { AuditAnchor } from "./audit-anchor";
import { AuditArchive } from "./audit-archive";
import { AuditStore } from "./audit-store";

const cleanup: string[] = [];
afterEach(() => { for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "friday-audit-archive-"));
  cleanup.push(root);
  const db = openDatabase(join(root, "dashboard.sqlite"));
  const archive = new AuditArchive(db, join(root, "archive"));
  const anchor = new AuditAnchor({ db, key: Buffer.alloc(32, 7), file: join(root, "audit-head.json") });
  const audit = new AuditStore(db, undefined, anchor, archive);
  const append = (date: string) => audit.append({ actor: { id: "owner", type: "user", displayName: "Owner" } as never,
    category: "system", action: "test", severity: "info", result: "success", correlationId: "test", occurredAt: date });
  return { root, db, archive, anchor, audit, append };
}

it("archives a contiguous prefix, restarts, appends, and verifies the full anchored chain", () => {
  const f = fixture();
  f.append("2026-01-01T00:00:00Z");
  f.append("2026-01-02T00:00:00Z");
  f.append("2026-10-01T00:00:00Z");
  expect(f.archive.archiveBefore("2026-02-01T00:00:00Z", () => f.audit.verify().valid)).toBe(2);
  expect((f.db.prepare("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number }).n).toBe(1);
  const restarted = new AuditStore(f.db, undefined, f.anchor, f.archive);
  expect(restarted.verify()).toMatchObject({ valid: true, length: 3 });
  restarted.append({ actor: { id: "owner", type: "user", displayName: "Owner" } as never,
    category: "system", action: "test", severity: "info", result: "success", correlationId: "test" });
  expect(restarted.verify()).toMatchObject({ valid: true, length: 4 });
  f.db.close();
});

it("reopens after archiving every hot row and continues the same sequence", () => {
  const f = fixture();
  f.append("2026-01-01T00:00:00Z");
  f.append("2026-01-02T00:00:00Z");
  expect(f.archive.archiveBefore("2026-02-01T00:00:00Z", () => f.audit.verify().valid)).toBe(2);
  expect((f.db.prepare("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number }).n).toBe(0);
  f.db.close();
  const db = openDatabase(join(f.root, "dashboard.sqlite"));
  const archive = new AuditArchive(db, join(f.root, "archive"));
  const anchor = new AuditAnchor({ db, key: Buffer.alloc(32, 7), file: join(f.root, "audit-head.json") });
  const audit = new AuditStore(db, undefined, anchor, archive);
  expect(audit.verify()).toMatchObject({ valid: true, length: 2 });
  const added = audit.append({ actor: { id: "owner", type: "user", displayName: "Owner" } as never,
    category: "system", action: "after-restart", severity: "info", result: "success", correlationId: "test" });
  expect(added.sequence).toBe(3);
  expect(audit.verify()).toMatchObject({ valid: true, length: 3 });
  db.close();
});

it("keeps hot rows if interrupted before the DB commit and detects a missing or tampered segment", () => {
  const f = fixture();
  f.append("2026-01-01T00:00:00Z");
  expect(() => f.archive.archiveBefore("2026-02-01T00:00:00Z", () => f.audit.verify().valid,
    () => { throw new Error("fault before commit"); })).toThrow(/fault/);
  expect(f.audit.verify().valid).toBe(true);
  expect((f.db.prepare("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number }).n).toBe(1);
  expect(f.archive.archiveBefore("2026-02-01T00:00:00Z", () => f.audit.verify().valid)).toBe(1);
  const files = readdirSync(join(f.root, "archive")).filter((name) => name.endsWith(".json"));
  const registered = (f.db.prepare("SELECT filename FROM audit_archive_segments").get() as { filename: string }).filename;
  writeFileSync(join(f.root, "archive", registered), "tampered");
  expect(f.audit.verify()).toMatchObject({ valid: false, reason: "archive_unavailable" });
  unlinkSync(join(f.root, "archive", registered));
  expect(files.length).toBeGreaterThan(0);
  expect(() => new AuditStore(f.db, undefined, f.anchor, f.archive)).toThrow(/missing/);
  f.db.close();
});

it("preserves a later append made just before archive transaction", () => {
  const f = fixture();
  f.append("2026-01-01T00:00:00Z");
  expect(f.archive.archiveBefore("2026-02-01T00:00:00Z", () => f.audit.verify().valid,
    () => { f.append("2026-10-01T00:00:00Z"); })).toBe(1);
  expect(new AuditStore(f.db, undefined, f.anchor, f.archive).verify()).toMatchObject({ valid: true, length: 2 });
  f.db.close();
});
