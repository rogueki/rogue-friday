"use client";

import { isFridayApiError } from "@friday/sdk";
import { DegradedState, EmptyState, ErrorState, OfflineState, Skeleton, StaleBanner } from "@friday/ui";
import type { ReactNode } from "react";
import type { PanelState } from "@/components/PanelFrame";
import type { OutageInfo } from "@/features/shared/availability";
import { useDateFormatter } from "@/features/tasks/moduleKit";
import { useT } from "@/i18n";

/** Terminates a message with a period unless it already ends in sentence punctuation. */
const endSentence = (text: string): string => (/[.!?…]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

/** "Offline – Voice HTTP nicht erreichbar seit 14.10.2026, 18:53 (vor 2 Min.), letzter Erfolg …" (PLAN §9.3). */
export function useOutageText(): (outage: OutageInfo) => string {
  const { t } = useT();
  const format = useDateFormatter();
  return (outage) => {
    const stamp = (iso: string | null | undefined): string => (iso ? `${format.dateTime(iso)} (${format.relative(iso)})` : "");
    const adapter = outage.adapterName || t("avail.adapterUnknown");
    const last = stamp(outage.lastSuccessAt) || t("avail.offline.never");
    const since = stamp(outage.since);
    const base = outage.recovering
      ? t("avail.offline.recovering", { adapter, last })
      : since
        ? t("avail.offline.description", { adapter, since, last })
        : t("avail.offline.descriptionNoSince", { adapter, last });
    return outage.reason ? `${base} ${endSentence(t("avail.offline.reason", { reason: outage.reason }))}` : base;
  };
}

/** Panel body in an outage: title "Offline", the adapter, since when, last success, retry. */
export function OutageBody({ outage, onRetry, cached = false, className }: { outage: OutageInfo; onRetry?: () => void; cached?: boolean; className?: string }) {
  const { t } = useT();
  const text = useOutageText();
  const description = cached ? `${text(outage)} ${t("avail.offline.cached")}` : text(outage);
  return (
    <OfflineState
      compact
      className={className}
      title={t("avail.offline.title")}
      description={description}
      lastSync={outage.lastSuccessAt ?? undefined}
      onRetry={onRetry}
      retryLabel={t("common.retry")}
      data-state="outage"
    />
  );
}

/**
 * Renders a `PanelState` (the body of a panel, drawer or tab). Every module page renders through this so loading,
 * empty, stale, degraded, outage, not-configured, unsupported and error look and behave the same (PLAN §1.1 rule 11).
 */
export function PanelStateBody({ state, children, skeleton, skeletonRows = 3 }: { state: PanelState; children?: ReactNode; skeleton?: ReactNode; skeletonRows?: number }) {
  const { t } = useT();
  switch (state.kind) {
    case "loading":
      return (
        <div className="web-panel-skeleton" aria-busy="true">
          {skeleton ??
            Array.from({ length: skeletonRows }, (_, index) => <Skeleton key={index} variant="row" height={44} label={t("common.loading")} />)}
        </div>
      );
    case "error": {
      const api = isFridayApiError(state.error) ? state.error : null;
      return (
        <ErrorState
          compact
          title={t("common.loadError")}
          description={api?.message ?? (state.error instanceof Error ? state.error.message : undefined)}
          code={api?.code}
          correlationId={api?.correlationId}
          onRetry={state.onRetry}
          retrying={state.retrying}
          retryLabel={t("common.retry")}
          labels={{ copy: t("common.copy"), copied: t("common.copied"), correlation: t("common.correlationId") }}
        />
      );
    }
    case "offline":
      return <OutageBody outage={state.outage} onRetry={state.onRetry} />;
    case "not-configured":
      return (
        <OfflineState
          compact
          title={t("avail.notConfigured.title")}
          description={state.moduleName ? t("avail.notConfigured.description", { module: state.moduleName }) : t("panel.offline.description")}
          onRetry={state.onRetry}
          retryLabel={t("common.retry")}
          data-state="not-configured"
        />
      );
    case "unsupported":
      return (
        <DegradedState
          compact
          title={t("avail.unsupported.title")}
          description={
            state.adapterName
              ? t("avail.unsupported.description", { adapter: state.adapterName, capability: state.capability })
              : t("avail.unsupported.descriptionNoAdapter", { capability: state.capability })
          }
          data-state="unsupported"
        />
      );
    case "empty":
      return <EmptyState compact title={state.title ?? t("common.empty")} description={state.description} icon={state.icon} action={state.action} />;
    default:
      return (
        <>
          {state.outage ? (
            <OutageBody outage={state.outage} onRetry={state.onRefresh} cached className="web-panel-notice" />
          ) : state.freshness && state.freshness.state !== "fresh" ? (
            <StaleBanner
              className="web-panel-notice"
              asOf={state.freshness.asOf ?? undefined}
              message={t("panel.stale")}
              refreshLabel={t("common.refresh")}
              onRefresh={state.onRefresh}
            />
          ) : null}
          {state.degraded ? (
            <DegradedState compact className="web-panel-notice" title={t("panel.degraded.title")} description={state.degraded.reason} affected={state.degraded.affected} />
          ) : null}
          {children}
        </>
      );
  }
}
