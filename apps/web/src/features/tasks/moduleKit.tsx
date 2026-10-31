"use client";

import type { Freshness, SourceDescriptor } from "@friday/sdk";
import {
  Button,
  FreshnessBadge,
  IconButton,
  SourceBadge,
  VisuallyHidden,
  useNow,
  useToast,
  type ButtonProps,
} from "@friday/ui";
import { Check, Copy, Lock } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useT } from "@/i18n";
import { formatDateTimePattern } from "@/features/shared/time";
import type { PanelState } from "@/components/PanelFrame";
import { sectionStatus } from "@/features/overview/useOverviewPanel";
import { isAdapterOutage, outageFromSection } from "@/features/shared/availability";
import type { PanelGate } from "@/features/shared/useAvailability";
import { useServerClockOffset } from "@/features/shared/useServerClock";
import { useOverview } from "@/lib/api/domains/core";
import { useCapabilities, capabilityState, type CapabilityModule, type CapabilityState } from "@/lib/capabilities";
import { useAppSettings } from "@/lib/settings";
import "./kit.css";

/**
 * Small building blocks shared by the module pages Tasks, Live Activity, Approvals and Agents: capability notices and
 * gated buttons, source/freshness badges, URL query state, copy button, time formatting. Strings live under `tasks.kit.*`.
 */

/* ── capabilities ─────────────────────────────────────────────────────── */

export type ModuleReadability = "unknown" | "readable" | "unavailable";
export type WriteAccess = "unknown" | "full" | "partial" | "readonly";

export interface ModuleAccess {
  readable: ModuleReadability;
  write: WriteAccess;
}

/** What the capability document grants for `module`: readable at all, and how many of `writeActions` may be used. */
export function useModuleAccess(module: CapabilityModule, writeActions: readonly string[]): ModuleAccess {
  const { capabilities, isLoading } = useCapabilities();
  return useMemo(() => {
    if (!capabilities) return { readable: isLoading ? "unknown" : "unavailable", write: "unknown" };
    const read = capabilityState(capabilities, module, "read");
    if (read === "missing") return { readable: "unavailable", write: "readonly" };
    const granted = writeActions.filter((action) => capabilityState(capabilities, module, action) === "available").length;
    const write: WriteAccess = granted === 0 ? "readonly" : granted === writeActions.length ? "full" : "partial";
    return { readable: "readable", write };
  }, [capabilities, isLoading, module, writeActions]);
}

/** "Lesen verfügbar / Schreiben nicht verfügbar" for modules whose adapter only reads (PLAN §9.3). */
export function ReadOnlyNotice({ access }: { access: ModuleAccess }) {
  const { t } = useT();
  if (access.readable !== "readable" || access.write !== "readonly") return null;
  return (
    <div className="mod-note" role="status">
      <Lock size={13} strokeWidth={1.75} aria-hidden="true" />
      <span>{t("tasks.kit.readOnly")}</span>
    </div>
  );
}

export function useCapabilityReason(): (state: CapabilityState) => string | undefined {
  const { t } = useT();
  return useCallback(
    (state) => (state === "available" ? undefined : state === "read-only" ? t("tasks.kit.reason.readOnly") : t("tasks.kit.reason.missing")),
    [t],
  );
}

export interface GatedButtonProps extends ButtonProps {
  /** Capability of the action; anything but `available` disables the button and explains why. */
  gate: CapabilityState;
  /** Extra reason that disables the button although the capability is granted (e.g. wrong task status). */
  blockedReason?: string;
}

/** Button that is never hidden silently: without the capability it is disabled with the reason as tooltip and text. */
export function GatedButton({ gate, blockedReason, disabled, title, children, ...rest }: GatedButtonProps) {
  const reasonOf = useCapabilityReason();
  const reason = reasonOf(gate) ?? blockedReason;
  const blocked = reason !== undefined;
  return (
    <Button {...rest} disabled={disabled || blocked} title={reason ?? title} aria-disabled={disabled || blocked ? true : undefined}>
      {children}
      {reason ? <VisuallyHidden>{` (${reason})`}</VisuallyHidden> : null}
    </Button>
  );
}

/** `asOf` can be a few seconds ahead of the local estimate of the server clock; "in 6 Sekunden" would be nonsense for an age. */
export function freshAnchor(now: Date, asOf: string | null | undefined): Date {
  const at = asOf ? Date.parse(asOf) : Number.NaN;
  return !Number.isNaN(at) && at > now.getTime() ? new Date(at) : now;
}

/* ── origin ───────────────────────────────────────────────────────────── */

/** Source and freshness of a list or detail response (PLAN §8.8/8.9), shown in every page header. */
export function DataOrigin({ sources, freshness, className, slot = "header" }: { sources?: readonly SourceDescriptor[]; freshness?: Freshness | null; className?: string; slot?: "header" | "body" }) {
  const { locale } = useT();
  const { now } = useDateFormatter();
  const names = useMemo(() => {
    const unique = new Set((sources ?? []).map((source) => source.system || source.adapterId));
    return [...unique].join(", ");
  }, [sources]);
  const mode = freshness?.state === "offline-cache" ? "cache" : "live";
  if (!names && !freshness) return null;
  return (
    <span className={className ?? `mod-origin mod-origin--${slot}`}>
      {names ? <SourceBadge source={names} mode={mode} /> : null}
      {freshness ? <FreshnessBadge state={freshness.state} asOf={freshness.asOf ?? undefined} now={freshAnchor(now, freshness.asOf)} locale={locale} /> : null}
    </span>
  );
}

/* ── URL state ────────────────────────────────────────────────────────── */

/** Several query parameters at once (`?task=…&tab=…`): one navigation, so no update overwrites the other. */
export function useQueryParams(): { get: (name: string) => string | null; set: (patch: Record<string, string | null>, mode?: "push" | "replace") => void } {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const get = useCallback((name: string) => params?.get(name) ?? null, [params]);
  const set = useCallback(
    (patch: Record<string, string | null>, mode: "push" | "replace" = "replace") => {
      const search = new URLSearchParams(params?.toString() ?? "");
      for (const [name, next] of Object.entries(patch)) {
        if (next === null || next === "") search.delete(name);
        else search.set(name, next);
      }
      const query = search.toString();
      const url = query ? `${pathname}?${query}` : pathname;
      if (mode === "push") router.push(url);
      else router.replace(url);
    },
    [params, pathname, router],
  );
  return { get, set };
}

/** One query parameter as state; replace keeps the history clean for filters, push is for opening details. */
export function useQueryParam(name: string): [string | null, (value: string | null, mode?: "push" | "replace") => void] {
  const { get, set } = useQueryParams();
  const setOne = useCallback((value: string | null, mode: "push" | "replace" = "replace") => set({ [name]: value }, mode), [name, set]);
  return [get(name), setOne];
}

/* ── clipboard ────────────────────────────────────────────────────────── */

/** Icon button that copies a value (correlation id, task id); announces the result as a toast. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const { t } = useT();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const copy = (): void => {
    navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true);
        toast({ title: t("common.copied"), description: value, tone: "green", duration: 2500 });
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => toast({ title: t("tasks.kit.copyFailed"), description: value, tone: "amber" }));
  };
  return <IconButton label={label} icon={copied ? <Check size={14} /> : <Copy size={14} />} size="sm" onClick={copy} />;
}

/* ── time ─────────────────────────────────────────────────────────────── */

export interface DateFormatter {
  locale: string;
  now: Date;
  /** "14:03:21" */
  time: (iso: string | null | undefined) => string;
  /** "14.10.2026, 14:03" */
  dateTime: (iso: string | null | undefined) => string;
  /** "vor 3 Min." */
  relative: (iso: string | null | undefined) => string;
  /** "1 Std. 4 Min." / "42 Min." / "5 Min. 3 Sek." / "42 Sek." / "850 ms" */
  duration: (ms: number | null | undefined) => string;
}

type Translate = ReturnType<typeof useT>["t"];

// Intl objects are expensive to construct; rows of a virtualized list mount by the dozen, so they are shared per setting.
const formatCache = new Map<string, { time: Intl.DateTimeFormat; relative: Intl.RelativeTimeFormat }>();
function intlFor(locale: string, timeZone: string | undefined, hour12: boolean | undefined) {
  const key = `${locale}|${timeZone ?? ""}|${hour12 ?? ""}`;
  let entry = formatCache.get(key);
  if (!entry) {
    entry = {
      time: new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12, timeZone }),
      relative: new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" }),
    };
    formatCache.set(key, entry);
  }
  return entry;
}

function parseDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function createDateFormatter(options: { locale: string; timeZone?: string; hour12?: boolean; dateFormat?: "dd.MM.yyyy" | "yyyy-MM-dd" | "MM/dd/yyyy"; now: Date; t: Translate }): DateFormatter {
  const { locale, timeZone, hour12, dateFormat = "dd.MM.yyyy", now, t } = options;
  const intl = intlFor(locale, timeZone, hour12);
  return {
    locale,
    now,
    time: (iso) => {
      const date = parseDate(iso);
      return date ? intl.time.format(date) : "—";
    },
    dateTime: (iso) => {
      const date = parseDate(iso);
      return date ? formatDateTimePattern(date, dateFormat, { locale: locale === "de" ? "de-DE" : "en-GB", timeZone, hour12 }) : "—";
    },
    relative: (iso) => {
      const date = parseDate(iso);
      if (!date) return "—";
      const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
      const abs = Math.abs(seconds);
      if (abs < 10) return intl.relative.format(0, "second");
      if (abs < 60) return intl.relative.format(seconds, "second");
      if (abs < 3600) return intl.relative.format(Math.round(seconds / 60), "minute");
      if (abs < 86_400) return intl.relative.format(Math.round(seconds / 3600), "hour");
      return intl.relative.format(Math.round(seconds / 86_400), "day");
    },
    duration: (ms) => {
      if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
      if (ms < 1000) return `${Math.round(ms)} ms`;
      const totalSeconds = Math.round(ms / 1000);
      if (totalSeconds < 60) return `${totalSeconds} ${t("tasks.kit.unit.seconds")}`;
      const totalMinutes = Math.floor(totalSeconds / 60);
      if (totalMinutes < 10) return `${totalMinutes} ${t("time.minutes")} ${totalSeconds % 60} ${t("tasks.kit.unit.seconds")}`;
      if (totalMinutes < 60) return `${totalMinutes} ${t("time.minutes")}`;
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      return minutes === 0 ? `${hours} ${t("time.hours")}` : `${hours} ${t("time.hours")} ${minutes} ${t("time.minutes")}`;
    },
  };
}

const DateFormatterContext = createContext<DateFormatter | null>(null);

/**
 * One date formatter (locale, time zone, server-clock-corrected `now`, ticking every `tickMs`) for a whole module page.
 * Rows of a 10 000 item list read it from context instead of each building formatters, a clock and a meta query.
 */
export function DateFormatterProvider({ tickMs = 30_000, children }: { tickMs?: number; children: ReactNode }) {
  const { locale, t } = useT();
  const { timeZone, hour12, dateFormat } = useAppSettings();
  const clientNow = useNow(tickMs);
  const offset = useServerClockOffset();
  const now = useMemo(() => new Date(clientNow.getTime() + offset), [clientNow, offset]);
  const value = useMemo(() => createDateFormatter({ locale, timeZone, hour12, dateFormat, now, t }), [locale, timeZone, hour12, dateFormat, now, t]);
  return <DateFormatterContext.Provider value={value}>{children}</DateFormatterContext.Provider>;
}

/** The page's formatter; outside a provider (isolated component tests) a German default without live ticking. */
export function useDateFormatter(): DateFormatter {
  const { locale, t } = useT();
  const fromContext = useContext(DateFormatterContext);
  const fallback = useMemo(() => (fromContext ? null : createDateFormatter({ locale, now: new Date(), t })), [fromContext, locale, t]);
  return fromContext ?? (fallback as DateFormatter);
}

/* ── layout helpers ───────────────────────────────────────────────────── */

/** Label/value pair list used by all detail drawers. */
export function FactList({ items }: { items: readonly { label: string; value: ReactNode; wide?: boolean }[] }) {
  return (
    <dl className="mod-facts">
      {items.map((item) => (
        <div key={item.label} className={item.wide ? "mod-facts__row mod-facts__row--wide" : "mod-facts__row"}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Height in px of the element the ref is attached to (a flexible region), for virtualized lists that need a number. */
export function useFillHeight(minimum = 320): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState(minimum);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const measure = (): void => {
      const next = element.clientHeight;
      if (next > 0) setHeight(Math.max(minimum, next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [minimum]);
  return [ref, height];
}

/* ── panel state ──────────────────────────────────────────────────────── */

/** Offline/degraded entries of the overview (`degradedSections`) that belong to a module (section ids or German labels). */
export function useModuleSection(sections: readonly string[]) {
  const overview = useOverview();
  return useMemo(() => sectionStatus(overview.data?.data, sections), [overview.data, sections]);
}

export interface PanelStateInput {
  pending: boolean;
  error: unknown;
  /** Something is cached/loaded: a failed refresh then degrades the view instead of replacing it. */
  hasData: boolean;
  empty: boolean;
  emptyState?: { title: string; description?: ReactNode; action?: ReactNode };
  /** Availability of the module's adapter (`useModulePanelGate`): not configured / offline / unsupported (PLAN §9.3). */
  gate: PanelGate;
  /** Offline/degraded entries of the overview; covers the case that `/adapters` is not readable for this role. */
  section?: ReturnType<typeof sectionStatus>;
  freshness?: Freshness | null;
  onRetry: () => void;
  retrying?: boolean;
  refreshFailedLabel: string;
}

/** One decision table for loading / error / not configured / offline / unsupported / empty / degraded / stale of every module page (PLAN §1.1 rule 11, §9.3). */
export function resolvePanelState(input: PanelStateInput): PanelState {
  const { pending, error, hasData, section, gate } = input;
  if (gate.state) return gate.state;
  if (pending && !hasData) return { kind: "loading" };
  if (error && !hasData) return { kind: "error", error, onRetry: input.onRetry, retrying: input.retrying };
  if (!hasData) return { kind: "loading" };
  const outage = gate.outage ?? (section?.offline ? outageFromSection(section.offline) : undefined);
  if (outage && input.empty) return { kind: "offline", outage, onRetry: gate.retry };
  if (input.empty) return { kind: "empty", title: input.emptyState?.title, description: input.emptyState?.description, action: input.emptyState?.action };
  const notice = section?.degraded;
  const degraded = notice
    ? { adapterId: notice.adapterId, reason: notice.reason, affected: [notice.adapterId] }
    : error && !outage && !isAdapterOutage(error)
      ? { reason: `${input.refreshFailedLabel} ${error instanceof Error ? error.message : ""}`.trim() }
      : undefined;
  const freshness: Freshness | null | undefined = outage ? { state: "offline-cache", asOf: outage.lastSuccessAt ?? input.freshness?.asOf ?? new Date().toISOString() } : input.freshness;
  return { kind: "ready", degraded, freshness: freshness ?? undefined, outage, onRefresh: gate.retry };
}

/** Two- or three-way switch for views and display modes (`aria-pressed` buttons, never colour-only). */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string; icon?: ReactNode }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="mod-seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" className="mod-seg__btn" aria-pressed={option.value === value} onClick={() => onChange(option.value)}>
          {option.icon}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}
