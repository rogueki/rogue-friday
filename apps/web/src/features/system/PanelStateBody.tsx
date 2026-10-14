"use client";

import { isJarvisApiError } from "@jarvis/sdk";
import { DegradedState, EmptyState, ErrorState, OfflineState, Skeleton, StaleBanner } from "@jarvis/ui";
import type { ReactNode } from "react";
import type { PanelState } from "@/components/PanelFrame";
import { useT } from "@/i18n";

/**
 * Renders a `PanelState` inline (inside drawers and tab bodies) with the same vocabulary as `PanelFrame`, which can
 * only render inside its own panel.
 */
export function PanelStateBody({ state, children, skeleton }: { state: PanelState; children?: ReactNode; skeleton?: ReactNode }) {
  const { t } = useT();
  switch (state.kind) {
    case "loading":
      return (
        <div className="web-panel-skeleton" aria-busy="true">
          {skeleton ?? <Skeleton variant="row" height={44} label={t("common.loading")} />}
        </div>
      );
    case "error": {
      const api = isJarvisApiError(state.error) ? state.error : null;
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
      return (
        <OfflineState
          compact
          title={t("panel.offline.title")}
          description={state.reason ?? t("panel.offline.description")}
          lastSync={state.lastSync}
          onRetry={state.onRetry}
          retryLabel={t("common.retry")}
        />
      );
    case "empty":
      return <EmptyState compact title={state.title ?? t("common.empty")} description={state.description} icon={state.icon} action={state.action} />;
    default:
      return (
        <>
          {state.freshness && state.freshness.state !== "fresh" ? (
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
