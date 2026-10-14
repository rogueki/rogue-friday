"use client";

import { isJarvisApiError } from "@jarvis/sdk";
import type { Freshness } from "@jarvis/sdk";
import { Button, DegradedState, EmptyState, ErrorState, HudPanel, OfflineState, Skeleton, StaleBanner, type HudPanelProps } from "@jarvis/ui";
import { Settings2 } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useT } from "@/i18n";

/**
 * State of one panel. Every panel of the app renders through this so loading, empty, stale, degraded, offline and error
 * look and behave the same everywhere (PLAN §1.1 rule 11). `ready` may additionally carry a degraded/stale notice.
 */
export type PanelState =
  | { kind: "loading" }
  | { kind: "error"; error: unknown; onRetry?: () => void; retrying?: boolean }
  | { kind: "offline"; adapterId?: string; reason?: string; lastSync?: string; onRetry?: () => void }
  | { kind: "empty"; title?: string; description?: ReactNode; icon?: ReactNode; action?: ReactNode }
  | {
      kind: "ready";
      degraded?: { adapterId?: string; reason?: string; affected?: readonly string[] };
      freshness?: Freshness | null;
      onRefresh?: () => void;
    };

export interface PanelFrameProps extends Omit<HudPanelProps, "children"> {
  state: PanelState;
  /** Rows of skeleton placeholders while loading. */
  skeletonRows?: number;
  /** Content for the `ready` state. */
  children?: ReactNode;
}

export function PanelFrame({ state, skeletonRows = 3, children, footer, bodyClassName, ...panelProps }: PanelFrameProps) {
  const { t } = useT();
  const router = useRouter();
  let body: ReactNode;
  let showFooter = true;

  switch (state.kind) {
    case "loading":
      body = (
        <div className="web-panel-skeleton" aria-busy="true">
          {Array.from({ length: skeletonRows }, (_, index) => (
            <Skeleton key={index} variant="row" height={44} label={t("common.loading")} />
          ))}
        </div>
      );
      showFooter = false;
      break;
    case "error": {
      const api = isJarvisApiError(state.error) ? state.error : null;
      body = (
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
      showFooter = false;
      break;
    }
    case "offline":
      body = (
        <OfflineState
          compact
          title={t("panel.offline.title")}
          description={state.reason ?? t("panel.offline.description")}
          lastSync={state.lastSync}
          onRetry={state.onRetry}
          retryLabel={t("common.retry")}
        />
      );
      showFooter = false;
      break;
    case "empty":
      body = <EmptyState compact title={state.title ?? t("common.empty")} description={state.description} icon={state.icon} action={state.action} />;
      showFooter = false;
      break;
    default:
      body = (
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
            <DegradedState
              compact
              className="web-panel-notice"
              title={t("panel.degraded.title")}
              description={state.degraded.reason}
              affected={state.degraded.affected}
            />
          ) : null}
          {children}
        </>
      );
  }

  const configure =
    state.kind === "offline" ? (
      <Button size="sm" variant="ghost" icon={<Settings2 size={14} />} onClick={() => router.push(state.adapterId ? `/settings?adapter=${encodeURIComponent(state.adapterId)}` : "/settings")}>
        {t("panel.configureAdapter")}
      </Button>
    ) : null;

  return (
    <HudPanel {...panelProps} footer={showFooter ? footer : configure} bodyClassName={bodyClassName}>
      {body}
    </HudPanel>
  );
}
