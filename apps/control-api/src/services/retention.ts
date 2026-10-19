import { kvGet, kvSet, type Db } from "../db/database";
import type { AuditArchive } from "../db/audit-archive";
import type { AuditStore } from "../db/audit-store";
import type { SettingsService } from "./settings";
import type { SystemBackupService } from "./system-backup";

/** Implemented by the durable notification repository; pending dispatch is excluded there. */
export interface NotificationRetention {
  countResolvedBefore(cutoffIso: string): number;
  deleteResolvedBefore(cutoffIso: string): number;
}

interface Counts { activity: number; voiceHistory: number; auditToArchive: number; notifications: number; temporaryFiles: number }
export interface RetentionPlan {
  cutoffs: Record<keyof Counts, string>;
  eligible: Counts;
  archivedAuditRows: number;
  memoryPolicy: "unlimited";
  auditPolicy: "archive-local-indefinitely";
}
interface LastResult { at: string; status: "success" | "failed"; counts: Counts | null;
  confirmedPartial: Partial<Counts>; error: string | null }

function cutoff(now: Date, days: number): string { return new Date(now.getTime() - days * 86_400_000).toISOString(); }
const count = (db: Db, query: string, cutoffIso: string): number =>
  (db.prepare(query).get(cutoffIso) as { n: number }).n;

export class RetentionService {
  private running = false;

  constructor(private readonly db: Db, private readonly settings: SettingsService,
    private readonly audit: AuditStore, private readonly archive: AuditArchive,
    private readonly backup: SystemBackupService, private readonly notifications: NotificationRetention) {}

  status(): { last: LastResult | null; running: boolean; automaticEnabled: boolean } {
    let last: LastResult | null = null;
    try { last = JSON.parse(kvGet(this.db, "data_retention.last_result") ?? "null") as LastResult | null; }
    catch { /* invalid prior status is unknown */ }
    return { last, running: this.running, automaticEnabled: kvGet(this.db, "data_retention.automatic_enabled") === "true" };
  }

  enableAutomatic(): void { kvSet(this.db, "data_retention.automatic_enabled", "true"); }
  disableAutomatic(): void { kvSet(this.db, "data_retention.automatic_enabled", "false"); }

  dryRun(now = new Date()): RetentionPlan {
    const settings = this.settings.area("dataRetention");
    const cutoffs = {
      activity: cutoff(now, settings.activityDays),
      voiceHistory: cutoff(now, settings.voiceHistoryDays),
      auditToArchive: cutoff(now, settings.auditDays),
      notifications: cutoff(now, settings.notificationDays),
      temporaryFiles: cutoff(now, settings.temporaryFileDays),
    };
    return { cutoffs, eligible: {
      activity: count(this.db, "SELECT COUNT(*) AS n FROM command_history WHERE origin != 'voice' AND created_at < ?", cutoffs.activity),
      voiceHistory: count(this.db, "SELECT COUNT(*) AS n FROM command_history WHERE origin = 'voice' AND created_at < ?", cutoffs.voiceHistory),
      auditToArchive: this.archive.countEligible(cutoffs.auditToArchive),
      notifications: this.notifications.countResolvedBefore(cutoffs.notifications),
      temporaryFiles: this.backup.temporaryCandidates(cutoffs.temporaryFiles).length,
    }, archivedAuditRows: this.archive.archivedCount(), memoryPolicy: "unlimited",
    auditPolicy: "archive-local-indefinitely" };
  }

  run(now = new Date()): RetentionPlan & { removed: Counts; at: string } {
    if (this.running) throw new Error("Retention job is already running");
    this.running = true;
    const confirmedPartial: Partial<Counts> = {};
    try {
      const plan = this.dryRun(now);
      const archived = this.archive.archiveBefore(plan.cutoffs.auditToArchive, () => this.audit.verify().valid);
      confirmedPartial.auditToArchive = archived;
      this.db.exec("BEGIN IMMEDIATE");
      let activity = 0;
      let voiceHistory = 0;
      let notifications = 0;
      try {
        activity = Number(this.db.prepare("DELETE FROM command_history WHERE origin != 'voice' AND created_at < ?")
          .run(plan.cutoffs.activity).changes);
        voiceHistory = Number(this.db.prepare("DELETE FROM command_history WHERE origin = 'voice' AND created_at < ?")
          .run(plan.cutoffs.voiceHistory).changes);
        notifications = this.notifications.deleteResolvedBefore(plan.cutoffs.notifications);
        this.db.exec("COMMIT");
        confirmedPartial.activity = activity;
        confirmedPartial.voiceHistory = voiceHistory;
        confirmedPartial.notifications = notifications;
      } catch (error) { this.db.exec("ROLLBACK"); throw error; }
      const temporaryFiles = this.backup.cleanupTemporary(plan.cutoffs.temporaryFiles);
      confirmedPartial.temporaryFiles = temporaryFiles;
      const removed = { activity, voiceHistory, auditToArchive: archived, notifications, temporaryFiles };
      const at = new Date().toISOString();
      kvSet(this.db, "data_retention.last_result", JSON.stringify({ at, status: "success", counts: removed,
        confirmedPartial, error: null }));
      return { ...plan, removed, at };
    } catch (error) {
      kvSet(this.db, "data_retention.last_result", JSON.stringify({ at: new Date().toISOString(), status: "failed", counts: null,
        confirmedPartial,
        error: error instanceof Error ? error.message.slice(0, 160) : "Retention failed" }));
      throw error;
    } finally { this.running = false; }
  }

  tick(now = new Date()): boolean {
    const status = this.status();
    if (!status.automaticEnabled) return false;
    const last = status.last;
    if (last?.status === "success" && now.getTime() - Date.parse(last.at) < 86_400_000) return false;
    this.run(now);
    return true;
  }
}
