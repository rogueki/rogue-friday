"use client";

import type { Freshness } from "@jarvis/sdk";
import { FreshnessBadge, SourceBadge, useNow, type HealthState } from "@jarvis/ui";
import { useMemo, type ReactNode } from "react";
import type { PanelState } from "@/components/PanelFrame";
import { useModulePanelGate } from "@/features/shared/useAvailability";
import { formatRelative } from "@/features/shared/time";
import { useT, type MessageKey } from "@/i18n";
import { useMeta } from "@/lib/api/domains/core";
import type { CapabilityModule } from "@/lib/capabilities";
import { useAppSettings } from "@/lib/settings";
import { bcp47, MISSING } from "./format";
import "./common.css";

export interface Formatters {
  locale: string;
  /** Absolute date and time in the configured time zone; "—" for null. */
  dateTime: (iso: string | null | undefined) => string;
  /** "vor 2 Min." relative to now; "—" for null. */
  relative: (iso: string | null | undefined) => string;
  number: (value: number | null | undefined, digits?: number) => string;
}

export function useFormatters(): Formatters {
  const { locale } = useT();
  const { timeZone, hour12 } = useAppSettings();
  const now = useNow(30_000);
  return useMemo<Formatters>(() => {
    const tag = bcp47(locale);
    const dateFormat = new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeStyle: "short", timeZone, hour12 });
    return {
      locale,
      dateTime: (iso) => {
        if (!iso) return MISSING;
        const date = new Date(iso);
        return Number.isNaN(date.getTime()) ? MISSING : dateFormat.format(date);
      },
      relative: (iso) => {
        if (!iso) return MISSING;
        const date = new Date(iso);
        return Number.isNaN(date.getTime()) ? MISSING : formatRelative(date, now, locale);
      },
      number: (value, digits = 0) =>
        value === null || value === undefined || !Number.isFinite(value)
          ? MISSING
          : new Intl.NumberFormat(tag, { maximumFractionDigits: digits }).format(value),
    };
  }, [locale, timeZone, hour12, now]);
}

interface QueryLike<T> {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  data: T | undefined;
  isFetching: boolean;
  dataUpdatedAt: number;
  refetch: () => unknown;
}

export interface QueryStateOptions {
  /** Capability module that serves the query: decides not configured / offline / unsupported (PLAN §9.3). */
  module?: CapabilityModule;
  /** Display name for "nicht verbunden"; defaults to the module's nav label. */
  moduleName?: string;
  /** `false` for control-plane data (the adapter registry itself): no adapter's availability applies to it. */
  gate?: boolean;
  empty?: boolean;
  emptyTitle?: string;
  emptyDescription?: ReactNode;
  emptyIcon?: ReactNode;
  freshness?: Freshness | null;
}

/**
 * Maps one query onto the shared `PanelState` vocabulary (PLAN §1.1 rule 11): loading, error, not configured, offline
 * (adapter registered but unreachable), unsupported capability, empty and ready. A failed refetch while data is cached
 * stays `ready` but flags the data as offline cache, so old data is never shown as live (PLAN §48.10).
 */
export function useQueryPanelState<T>(query: QueryLike<T>, options: QueryStateOptions = {}): PanelState {
  const { t } = useT();
  const retry = (): void => void query.refetch();
  const module = options.module ?? "system";
  const gate = useModulePanelGate(module, {
    moduleName: options.moduleName ?? t(`nav.${module}` as MessageKey),
    error: query.error,
    hasData: query.data !== undefined,
    onRetry: retry,
  });
  const gated = options.gate !== false;
  if (gated && gate.state) return gate.state;
  if (query.isPending) return { kind: "loading" };
  if (query.isError && query.data === undefined) {
    return { kind: "error", error: query.error, onRetry: retry, retrying: query.isFetching };
  }
  const outage = gated ? gate.outage : undefined;
  if (options.empty && outage) return { kind: "offline", outage, onRetry: gate.retry };
  if (options.empty) {
    return { kind: "empty", title: options.emptyTitle, description: options.emptyDescription, icon: options.emptyIcon };
  }
  const freshness: Freshness | null = outage
    ? { state: "offline-cache", asOf: outage.lastSuccessAt ?? (query.dataUpdatedAt > 0 ? new Date(query.dataUpdatedAt).toISOString() : new Date().toISOString()) }
    : query.isError && query.dataUpdatedAt > 0
      ? { state: "stale", asOf: new Date(query.dataUpdatedAt).toISOString() }
      : (options.freshness ?? null);
  return { kind: "ready", freshness, outage, onRefresh: gate.retry };
}

interface StatusStripProps {
  freshness?: Freshness | null;
  /** Source system name, e.g. `source.system` of the resource or `sources[0]`. */
  source?: string | null;
}

/** Source and freshness of a panel's data (PLAN §24: every data panel names its source and age). */
export function StatusStrip({ freshness, source }: StatusStripProps) {
  const { t, locale } = useT();
  const meta = useMeta();
  const mode = freshness?.state === "offline-cache" ? "cache" : meta.data?.dataMode === "mock" ? "mock" : meta.data ? "live" : undefined;
  return (
    <span className="mc-strip">
      {source ? <SourceBadge source={source} mode={mode} prefix={t("system.common.source")} /> : null}
      {freshness ? (
        <FreshnessBadge
          state={freshness.state}
          asOf={freshness.asOf ?? undefined}
          locale={bcp47(locale)}
          labels={{
            fresh: t("system.common.freshness.fresh"),
            stale: t("system.common.freshness.stale"),
            unknown: t("system.common.freshness.unknown"),
            "offline-cache": t("system.common.freshness.offlineCache"),
          }}
        />
      ) : null}
    </span>
  );
}

/** Label/value pair used in detail lists; null/undefined values render as "—" with an optional reason. */
export function KeyValue({ label, children, reason, mono = false }: { label: string; children?: ReactNode; reason?: string; mono?: boolean }) {
  const missing = children === null || children === undefined || children === "";
  return (
    <div className="mc-kv">
      <dt>{label}</dt>
      <dd className={mono ? "mc-mono" : undefined} title={missing ? reason : undefined}>
        {missing ? MISSING : children}
      </dd>
    </div>
  );
}

/** Health labels in the UI locale (the `@jarvis/ui` defaults are German only). */
export function useHealthLabels(): Record<HealthState, string> {
  const { t } = useT();
  return {
    ok: t("health.online"),
    degraded: t("health.degraded"),
    down: t("health.offline"),
    unknown: t("health.unknown"),
    maintenance: t("health.paused"),
  };
}
