import { expect, it } from "vitest";
import { openDatabase } from "../db/database";
import type { SettingsService } from "./settings";
import type { SystemBackupService } from "./system-backup";
import { BackupJobsService, backupDue, validateBackupSchedule } from "./backup-jobs";

it("parses five-field cron with lists, ranges, steps and timezone", () => {
  validateBackupSchedule("*/15 3-5 * * 1,3,5");
  expect(() => validateBackupSchedule("every morning")).toThrow();
  expect(backupDue("0 3 * * *", new Date("2026-10-19T01:00:00Z"), "Europe/Paris").due).toBe(true);
  expect(backupDue("0 3 * * *", new Date("2026-10-19T02:00:00Z"), "Europe/Paris").due).toBe(false);
});

it("runs once per repeated local DST slot and persists the job result", async () => {
  const db = openDatabase(":memory:");
  const calls: string[] = [];
  const settings = { area(name: string) {
    return name === "profile" ? { timeZone: "Europe/Paris" } :
      { enabled: true, schedule: "30 2 * * *", targetPath: "synthetic", retentionCount: 2 };
  } } as SettingsService;
  const backup = { create: async () => { calls.push("run"); return {
    path: "synthetic/snapshot", createdAt: "2026-10-25T00:00:00Z", fileCount: 3, verified: true }; },
    coverage: () => "windows-and-memory" } as unknown as SystemBackupService;
  const jobs = new BackupJobsService(db, settings, backup);
  expect(await jobs.tick(new Date("2026-10-25T00:30:00Z"))).toBe(true);
  expect(await jobs.tick(new Date("2026-10-25T01:30:00Z"))).toBe(false);
  expect(calls).toEqual(["run"]);
  expect(jobs.status().last).toMatchObject({ status: "success", path: "synthetic/snapshot" });
  db.close();
});
