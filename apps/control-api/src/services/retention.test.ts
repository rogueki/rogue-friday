import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { openDatabase } from "../db/database";
import { AuditArchive } from "../db/audit-archive";
import { AuditStore } from "../db/audit-store";
import type { SettingsService } from "./settings";
import type { SystemBackupService } from "./system-backup";
import { RetentionService, type NotificationRetention } from "./retention";

const cleanup: string[] = [];
afterEach(() => { for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true }); });

function fixture(notifications: NotificationRetention, backupOverride?: SystemBackupService) {
  const root = mkdtempSync(join(tmpdir(), "friday-retention-"));
  cleanup.push(root);
  const db = openDatabase(join(root, "dashboard.sqlite"));
  const archive = new AuditArchive(db, join(root, "audit-archive"));
  const audit = new AuditStore(db, undefined, undefined, archive);
  const settings = { area: () => ({ activityDays: 90, voiceHistoryDays: 30, auditDays: 365,
    notificationDays: 60, temporaryFileDays: 7, memoryDefaultTtlDays: null }) } as unknown as SettingsService;
  const backup = { temporaryCandidates: () => [], cleanupTemporary: () => 0 } as unknown as SystemBackupService;
  const retention = new RetentionService(db, settings, audit, archive, backupOverride ?? backup, notifications);
  return { db, archive, audit, retention };
}

function command(db: ReturnType<typeof openDatabase>, id: string, origin: string, date: string) {
  db.prepare("INSERT INTO command_history VALUES (?,?,?,?,?,?,?,?)")
    .run(id, `c-${id}`, "owner", "synthetic", 1, origin, "executed", date);
}

it("dry-runs exact store counts, archives old audit, deletes only scoped history and resolved notifications", () => {
  let resolved = 1;
  const f = fixture({ countResolvedBefore: () => resolved, deleteResolvedBefore: () => { resolved = 0; return 1; } });
  command(f.db, "activity-old", "text", "2026-01-01T00:00:00Z");
  command(f.db, "voice-old", "voice", "2026-01-01T00:00:00Z");
  command(f.db, "recent", "text", "2026-10-18T00:00:00Z");
  f.audit.append({ actor: { id: "owner", type: "user", displayName: "Owner" } as never,
    category: "system", action: "test", severity: "info", result: "success", correlationId: "c",
    occurredAt: "2025-01-01T00:00:00Z" });
  const now = new Date("2026-10-19T00:00:00Z");
  expect(f.retention.dryRun(now).eligible).toEqual({ activity: 1, voiceHistory: 1, auditToArchive: 1,
    notifications: 1, temporaryFiles: 0 });
  expect(f.retention.run(now).removed).toEqual({ activity: 1, voiceHistory: 1, auditToArchive: 1,
    notifications: 1, temporaryFiles: 0 });
  expect(f.audit.verify().valid).toBe(true);
  expect(f.retention.dryRun(now).archivedAuditRows).toBe(1);
  expect((f.db.prepare("SELECT COUNT(*) AS n FROM command_history").get() as { n: number }).n).toBe(1);
  expect(f.retention.tick(now)).toBe(false);
  f.db.close();
});

it("rolls back history deletion if notification cleanup fails and records a failed run", () => {
  const f = fixture({ countResolvedBefore: () => 1, deleteResolvedBefore: () => { throw new Error("notification failure"); } });
  command(f.db, "old", "text", "2026-01-01T00:00:00Z");
  expect(() => f.retention.run(new Date("2026-10-19T00:00:00Z"))).toThrow(/notification failure/);
  expect((f.db.prepare("SELECT COUNT(*) AS n FROM command_history").get() as { n: number }).n).toBe(1);
  expect(f.retention.status().last?.status).toBe("failed");
  f.db.close();
});

it("reports confirmed archive and DB cleanup when later temporary cleanup fails", () => {
  const backup = { temporaryCandidates: () => [], cleanupTemporary: () => { throw new Error("temporary failure"); } } as
    unknown as SystemBackupService;
  const f = fixture({ countResolvedBefore: () => 0, deleteResolvedBefore: () => 0 }, backup);
  command(f.db, "old", "text", "2026-01-01T00:00:00Z");
  f.audit.append({ actor: { id: "owner", type: "user", displayName: "Owner" } as never,
    category: "system", action: "test", severity: "info", result: "success", correlationId: "c",
    occurredAt: "2025-01-01T00:00:00Z" });
  expect(() => f.retention.run(new Date("2026-10-19T00:00:00Z"))).toThrow(/temporary failure/);
  expect(f.retention.status().last).toMatchObject({ status: "failed",
    confirmedPartial: { auditToArchive: 1, activity: 1, voiceHistory: 0, notifications: 0 } });
  expect(f.audit.verify().valid).toBe(true);
  f.db.close();
});
