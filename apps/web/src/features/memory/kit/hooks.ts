"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatClockTime, formatDatePattern, formatDateTimePattern, formatRelative } from "@/features/shared/time";
import { useT } from "@/i18n";
import { useAppSettings } from "@/lib/settings";

export type UrlParamSetter = (value: string | null, options?: { push?: boolean }) => void;

/**
 * One query parameter of the current page as state (`?memory=mem_…`). Detail views are drawers driven by the URL so a
 * reload or a shared link reopens them (static export: no dynamic route segments). Must run below a `<Suspense>`.
 */
export function useUrlParam(name: string): [string | null, UrlParamSetter] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const value = params.get(name);
  const paramsString = params.toString();
  const set = useCallback<UrlParamSetter>(
    (next, options) => {
      const search = new URLSearchParams(paramsString);
      if (next === null || next === "") search.delete(name);
      else search.set(name, next);
      const query = search.toString();
      const target = query ? `${pathname}?${query}` : pathname;
      if (options?.push) router.push(target, { scroll: false });
      else router.replace(target, { scroll: false });
    },
    [name, paramsString, pathname, router],
  );
  return [value, set];
}

export interface Formatter {
  /** BCP-47 locale used for `Intl`. */
  locale: string;
  timeZone: string | undefined;
  hour12: boolean | undefined;
  dateFormat: ReturnType<typeof useAppSettings>["dateFormat"];
  firstDayOfWeek: ReturnType<typeof useAppSettings>["firstDayOfWeek"];
  time: (iso: string | null | undefined) => string;
  date: (iso: string | null | undefined) => string;
  dateTime: (iso: string | null | undefined) => string;
  relative: (iso: string | null | undefined, now?: Date) => string;
}

/** Time formatting in the user's configured time zone, locale and 12/24 h preference (PLAN §8.2: wire = UTC, UI = local). */
export function useFormat(): Formatter {
  const { locale } = useT();
  const { timeZone, hour12, dateFormat, firstDayOfWeek } = useAppSettings();
  return useMemo<Formatter>(() => {
    const intl = locale === "de" ? "de-DE" : "en-GB";
    const parse = (iso: string | null | undefined): Date | null => {
      if (!iso) return null;
      const date = new Date(iso);
      return Number.isNaN(date.getTime()) ? null : date;
    };
    return {
      locale: intl,
      timeZone,
      hour12,
      dateFormat,
      firstDayOfWeek,
      time: (iso) => formatClockTime(iso, { locale: intl, timeZone, hour12 }),
      date: (iso) => {
        const date = parse(iso);
        return date ? formatDatePattern(date, dateFormat, timeZone) : "—";
      },
      dateTime: (iso) => {
        const date = parse(iso);
        return date ? formatDateTimePattern(date, dateFormat, { locale: intl, timeZone, hour12 }) : "—";
      },
      relative: (iso, now = new Date()) => {
        const date = parse(iso);
        return date ? formatRelative(date, now, intl) : "—";
      },
    };
  }, [locale, timeZone, hour12, dateFormat, firstDayOfWeek]);
}

/** Value that follows `value` after `delayMs` of quiet (search fields: one request per pause, not per keystroke). */
export function useDebounced<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    if (delayMs <= 0) {
      setDebounced(value);
      return undefined;
    }
    const handle = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}
