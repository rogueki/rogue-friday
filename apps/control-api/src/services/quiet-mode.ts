import type { QuietModeState } from "@friday/sdk";
import { kvGet, kvSet, type Db } from "../db/database";
import { validationFailed } from "../util/errors";

const TEMPORARY_UNTIL_KEY = "quiet_mode.temporary_until";
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export interface QuietHours {
  enabled: boolean;
  from: string;
  to: string;
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
  constructor(
    private readonly db: Db,
    private readonly quietHours: () => QuietHours,
    private readonly timeZone: () => string,
    private readonly nowMs: () => number,
  ) {}

  state(): QuietModeState {
    const now = this.nowMs();
    const stored = kvGet(this.db, TEMPORARY_UNTIL_KEY);
    const storedMs = typeof stored === "string" ? Date.parse(stored) : Number.NaN;
    const temporaryMs = Number.isFinite(storedMs) && storedMs > now ? storedMs : null;
    const schedule = scheduleWindow(now, this.quietHours(), this.timeZone());
    const untilMs = temporaryMs !== null && schedule.untilMs !== null ? Math.max(temporaryMs, schedule.untilMs) : temporaryMs ?? schedule.untilMs;
    const source = temporaryMs !== null ? "temporary" : schedule.active ? "schedule" : null;
    return {
      active: temporaryMs !== null || schedule.active,
      source,
      until: untilMs === null ? null : new Date(untilMs).toISOString(),
      temporaryUntil: temporaryMs === null ? null : new Date(temporaryMs).toISOString(),
    };
  }

  set(untilIso: string): QuietModeState {
    const now = this.nowMs();
    const untilMs = Date.parse(untilIso);
    if (!Number.isFinite(untilMs) || untilMs <= now + MINUTE_MS || untilMs > now + DAY_MS) {
      throw validationFailed("Das Ende des Ruhemodus muss zwischen einer Minute und 24 Stunden in der Zukunft liegen.");
    }
    kvSet(this.db, TEMPORARY_UNTIL_KEY, new Date(untilMs).toISOString());
    return this.state();
  }

  clear(): QuietModeState {
    kvSet(this.db, TEMPORARY_UNTIL_KEY, "");
    return this.state();
  }
}
