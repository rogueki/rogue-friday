import { kvGet, kvSet, type Db } from "../db/database";
import type { SettingsService } from "./settings";
import type { SystemBackupService } from "./system-backup";

interface LastResult {
  at: string;
  status: "success" | "failed";
  path: string | null;
  error: string | null;
}

const slots = [{ min: 0, max: 59 }, { min: 0, max: 23 }, { min: 1, max: 31 },
  { min: 1, max: 12 }, { min: 0, max: 7 }] as const;

function cronField(input: string, min: number, max: number): Set<number> {
  const result = new Set<number>();
  for (const segment of input.split(",")) {
    const [range, rawStep, extra] = segment.split("/");
    if (!range || extra !== undefined || rawStep !== undefined && (!/^\d+$/.test(rawStep) || Number(rawStep) < 1))
      throw new Error("Unsupported backup schedule");
    const step = rawStep === undefined ? 1 : Number(rawStep);
    const bounds = range === "*" ? [min, max] : range.includes("-") ? range.split("-").map(Number) : [Number(range), Number(range)];
    const start = bounds[0];
    const end = bounds[1];
    if (bounds.length !== 2 || start === undefined || end === undefined) throw new Error("Unsupported backup schedule");
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < min || end > max || start > end)
      throw new Error("Unsupported backup schedule");
    for (let value = start; value <= end; value += step) result.add(value);
  }
  return result;
}

export function validateBackupSchedule(schedule: string): void {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error("Backup schedule requires five cron fields");
  parts.forEach((part, index) => cronField(part, slots[index]!.min, slots[index]!.max));
}

function localParts(date: Date, zone: string): { values: number[]; slot: string } {
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
    weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const fields = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(fields.weekday ?? "");
  if (dow < 0) throw new Error("Invalid backup time zone");
  return { values: [Number(fields.minute), Number(fields.hour), Number(fields.day), Number(fields.month), dow],
    slot: `${fields.year}-${fields.month}-${fields.day}T${fields.hour}:${fields.minute}` };
}

/** Cron is evaluated in the selected profile timezone. Repeated DST minutes run once per local slot. */
export function backupDue(schedule: string, date: Date, zone: string): { due: boolean; slot: string } {
  validateBackupSchedule(schedule);
  const parts = schedule.trim().split(/\s+/);
  const { values, slot } = localParts(date, zone);
  const match = parts.map((part, index) => {
    const field = cronField(part!, slots[index]!.min, slots[index]!.max);
    return field.has(values[index]!) || index === 4 && values[index] === 0 && field.has(7);
  });
  const domAny = parts[2] === "*";
  const dowAny = parts[4] === "*";
  return { due: match[0]! && match[1]! && match[3]! && (domAny || dowAny ? match[2]! && match[4]! : match[2]! || match[4]!), slot };
}

export class BackupJobsService {
  private running = false;

  constructor(private readonly db: Db, private readonly settings: SettingsService, private readonly backup: SystemBackupService) {}

  status(): { enabled: boolean; schedule: string; timeZone: string; targetPath: string; last: LastResult | null; running: boolean;
    coverage: "windows-and-memory" | "windows-wsl-and-memory" } {
    const settings = this.settings.area("backups");
    let last: LastResult | null = null;
    try { last = JSON.parse(kvGet(this.db, "system_backup.last_result") ?? "null") as LastResult | null; } catch { /* corrupted result is unknown */ }
    return { enabled: settings.enabled, schedule: settings.schedule, timeZone: this.settings.area("profile").timeZone,
      targetPath: settings.targetPath, last, running: this.running, coverage: this.backup.coverage() };
  }

  preview(targetPath?: string) { return this.backup.preview(targetPath ?? this.settings.area("backups").targetPath); }

  async run(): Promise<{ path: string; createdAt: string; fileCount: number; verified: boolean }> {
    if (this.running) throw new Error("System backup is already running");
    this.running = true;
    try {
      const settings = this.settings.area("backups");
      const result = await this.backup.create(settings.targetPath, settings.retentionCount);
      this.record({ at: new Date().toISOString(), status: "success", path: result.path, error: null });
      return result;
    } catch (error) {
      this.record({ at: new Date().toISOString(), status: "failed", path: null,
        error: error instanceof Error ? error.message.slice(0, 160) : "Backup failed" });
      throw error;
    } finally { this.running = false; }
  }

  async tick(date = new Date()): Promise<boolean> {
    const status = this.status();
    if (!status.enabled || this.running) return false;
    const { due, slot } = backupDue(status.schedule, date, status.timeZone);
    if (!due || kvGet(this.db, "system_backup.last_slot") === slot) return false;
    kvSet(this.db, "system_backup.last_slot", slot);
    await this.run();
    return true;
  }

  verify(path: string) { return this.backup.verifyPublished(path); }
  restoreTest(path: string, targetPath: string) { return this.backup.restoreIsolated(path, targetPath); }

  private record(result: LastResult): void { kvSet(this.db, "system_backup.last_result", JSON.stringify(result)); }
}
