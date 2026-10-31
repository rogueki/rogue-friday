import type {
  NotificationSettings,
  QuietModeState,
  QuietModeSummary,
  QuietNoticeRequest,
  QuietNoticeResult,
} from "@friday/sdk";
import { kvGet, kvSet, type Db } from "../db/database";
import { validationFailed } from "../util/errors";

const TEMPORARY_UNTIL_KEY = "quiet_mode.temporary_until";
const TEMPORARY_SINCE_KEY = "quiet_mode.temporary_since";
const TEMPORARY_LEVEL_KEY = "quiet_mode.temporary_level";
const LOG_KEY = "quiet_mode.log";
const MAX_LOG_ITEMS = 200;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export type QuietLevel = "silent" | "voice_off";
export type QuietClass = QuietNoticeRequest["class"];

export interface QuietHours {
  enabled: boolean;
  from: string;
  to: string;
  level?: QuietLevel;
  summaryAt?: "end" | "first_interaction";
}

export interface QuietModeDeps {
  db: Db;
  notifications: () => NotificationSettings;
  timeZone: () => string;
  nowMs: () => number;
  saveQuietHours: (hours: { enabled: boolean; from: string; to: string }) => void;
  sendText: (text: string, targetId: string) => Promise<"sent" | "uncertain">;
}

interface QuietLogItem {
  class: QuietClass;
  title: string;
  at: string;
  delivery: QuietNoticeResult["delivery"];
}

interface QuietLog {
  periodStart: string;
  periodEnd: string | null;
  items: QuietLogItem[];
}

const DEFAULT_IMPORTANT_CLASSES: QuietClass[] = ["agent_questions", "approvals"];
const KNOWN_CLASSES = new Set<string>(["agent_questions", "task_results", "approvals", "appointments"]);

function quietLevel(value: unknown): QuietLevel | null {
  return value === "silent" || value === "voice_off" ? value : null;
}

function storedTimeMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function isLogItem(value: unknown): value is QuietLogItem {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return typeof item.class === "string" && KNOWN_CLASSES.has(item.class) && typeof item.title === "string" &&
    typeof item.at === "string" &&
    (item.delivery === "sent" || item.delivery === "uncertain" || item.delivery === "skipped");
}

function clockMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (match === null) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? hour * 60 + minute : null;
}

function localMinutes(nowMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(nowMs));
  const value = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return value("hour") * 60 + value("minute");
}

/** Computes the local quiet-hours window; a DST switch may move the end by at most one hour. */
export function scheduleWindow(nowMs: number, hours: QuietHours, timeZone: string): { active: boolean; untilMs: number | null } {
  if (!hours.enabled) return { active: false, untilMs: null };
  const from = clockMinutes(hours.from);
  const to = clockMinutes(hours.to);
  if (from === null || to === null || from === to) return { active: false, untilMs: null };
  const minutes = localMinutes(nowMs, timeZone);
  const active = from < to ? from <= minutes && minutes < to : minutes >= from || minutes < to;
  if (!active) return { active: false, untilMs: null };
  const startOfMinute = Math.floor(nowMs / MINUTE_MS) * MINUTE_MS;
  const minutesUntilEnd = ((to - minutes + 1440) % 1440) || 1440;
  return { active: true, untilMs: startOfMinute + minutesUntilEnd * MINUTE_MS };
}

export class QuietModeService {
  constructor(private readonly deps: QuietModeDeps) {}

  state(): QuietModeState {
    const now = this.deps.nowMs();
    const settings = this.deps.notifications();
    const quietHours: QuietHours = settings.quietHours ?? { enabled: false, from: "00:00", to: "00:00" };
    const storedMs = storedTimeMs(kvGet(this.deps.db, TEMPORARY_UNTIL_KEY));
    const temporaryMs = storedMs !== null && storedMs > now ? storedMs : null;
    const schedule = scheduleWindow(now, quietHours, this.deps.timeZone());
    const untilMs = temporaryMs !== null && schedule.untilMs !== null ? Math.max(temporaryMs, schedule.untilMs) : temporaryMs ?? schedule.untilMs;
    const source = temporaryMs !== null ? "temporary" : schedule.active ? "schedule" : null;
    const level: QuietModeState["level"] = temporaryMs !== null
      ? quietLevel(kvGet(this.deps.db, TEMPORARY_LEVEL_KEY)) ?? settings.quietMode?.level ?? "silent"
      : schedule.active ? quietHours.level ?? "silent" : null;
    const summaryAt: QuietModeState["summaryAt"] = source === "schedule" ? quietHours.summaryAt ?? "first_interaction" : null;
    const periodStartMs = this.periodStartMs(now, temporaryMs, schedule, quietHours);
    return {
      active: temporaryMs !== null || schedule.active,
      source,
      until: untilMs === null ? null : new Date(untilMs).toISOString(),
      temporaryUntil: temporaryMs === null ? null : new Date(temporaryMs).toISOString(),
      level,
      summaryAt,
      periodStart: periodStartMs === null ? null : new Date(periodStartMs).toISOString(),
    };
  }

  set(untilIso: string, level?: QuietLevel): QuietModeState {
    const now = this.deps.nowMs();
    const untilMs = Date.parse(untilIso);
    if (!Number.isFinite(untilMs) || untilMs <= now + MINUTE_MS || untilMs > now + DAY_MS) {
      throw validationFailed("Das Ende des Ruhemodus muss zwischen einer Minute und 24 Stunden in der Zukunft liegen.");
    }
    // Extending a running temporary quiet mode must not start a new period.
    if (this.state().source !== "temporary") {
      kvSet(this.deps.db, TEMPORARY_SINCE_KEY, new Date(now).toISOString());
    }
    kvSet(this.deps.db, TEMPORARY_UNTIL_KEY, new Date(untilMs).toISOString());
    kvSet(this.deps.db, TEMPORARY_LEVEL_KEY, level ?? this.deps.notifications().quietMode?.level ?? "silent");
    return this.state();
  }

  clear(): QuietModeState {
    kvSet(this.deps.db, TEMPORARY_UNTIL_KEY, "");
    return this.state();
  }

  setSchedule(hours: { enabled: boolean; from: string; to: string }): QuietModeState {
    if (hours.enabled && hours.from === hours.to) {
      throw validationFailed("Beginn und Ende der Nachtruhe müssen sich unterscheiden.");
    }
    this.deps.saveQuietHours(hours);
    return this.state();
  }

  async notice(input: QuietNoticeRequest): Promise<QuietNoticeResult> {
    const state = this.state();
    if (!state.active) {
      return { recorded: false, delivery: "skipped", reason: "Der Ruhemodus ist nicht aktiv." };
    }
    const settings = this.deps.notifications();
    const targetId = settings.quietTextTargetId ?? null;
    let delivery: QuietNoticeResult["delivery"] = "skipped";
    let reason: string | null = null;
    if (state.level !== "voice_off") {
      reason = "Stufe still: nichts wird versendet.";
    } else if (!(settings.importantClasses ?? DEFAULT_IMPORTANT_CLASSES).includes(input.class)) {
      reason = "Keine wichtige Klasse.";
    } else if (targetId === null) {
      reason = "Kein Textempfänger eingestellt.";
    } else {
      const text = `F.R.I.D.A.Y.: ${input.title}${input.text ? ` – ${input.text}` : ""}`.slice(0, 1000);
      try {
        delivery = await this.deps.sendText(text, targetId);
      } catch (error) {
        reason = error instanceof Error ? error.message : "Versand nicht möglich.";
      }
    }
    const now = this.deps.nowMs();
    const log = this.readLog();
    const current: QuietLog = log !== null && log.periodStart === state.periodStart
      ? log
      : { periodStart: state.periodStart ?? new Date(now).toISOString(), periodEnd: state.until, items: [] };
    const items: QuietLogItem[] = [...current.items, {
      class: input.class,
      title: input.title.slice(0, 200),
      at: new Date(now).toISOString(),
      delivery,
    }].slice(-MAX_LOG_ITEMS);
    this.writeLog({ periodStart: current.periodStart, periodEnd: state.until, items });
    return { recorded: true, delivery, reason };
  }

  summary(): QuietModeSummary {
    const state = this.state();
    const log = this.readLog();
    if (state.active) {
      const items = log !== null && log.periodStart === state.periodStart ? log.items : [];
      return { active: true, periodStart: state.periodStart, periodEnd: state.until, items };
    }
    if (log === null) return { active: false, periodStart: null, periodEnd: null, items: [] };
    return { active: false, periodStart: log.periodStart, periodEnd: log.periodEnd, items: log.items };
  }

  private periodStartMs(now: number, temporaryMs: number | null,
    schedule: { active: boolean; untilMs: number | null }, hours: QuietHours): number | null {
    const starts: number[] = [];
    if (temporaryMs !== null) {
      starts.push(storedTimeMs(kvGet(this.deps.db, TEMPORARY_SINCE_KEY)) ?? now);
    }
    if (schedule.active && schedule.untilMs !== null) {
      const from = clockMinutes(hours.from);
      const to = clockMinutes(hours.to);
      const lengthMinutes = from === null || to === null ? 0 : (to - from + 1440) % 1440;
      starts.push(schedule.untilMs - lengthMinutes * MINUTE_MS);
    }
    return starts.length === 0 ? null : Math.min(...starts);
  }

  private readLog(): QuietLog | null {
    const raw = kvGet(this.deps.db, LOG_KEY);
    if (typeof raw !== "string" || raw.length === 0) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (typeof parsed !== "object" || parsed === null) return null;
    const candidate = parsed as { periodStart?: unknown; periodEnd?: unknown; items?: unknown };
    if (typeof candidate.periodStart !== "string" || !Array.isArray(candidate.items)) return null;
    return {
      periodStart: candidate.periodStart,
      periodEnd: typeof candidate.periodEnd === "string" ? candidate.periodEnd : null,
      items: candidate.items.filter(isLogItem).slice(-MAX_LOG_ITEMS),
    };
  }

  private writeLog(log: QuietLog): void {
    kvSet(this.deps.db, LOG_KEY, JSON.stringify(log));
  }
}
