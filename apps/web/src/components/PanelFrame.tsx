"use client";

import type { Freshness } from "@friday/sdk";
import { Button, HudPanel, type HudPanelProps } from "@friday/ui";
import { Settings2 } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { PanelStateBody } from "@/components/PanelStateBody";
import type { OutageInfo } from "@/features/shared/availability";
import { useT } from "@/i18n";

/**
 * State of one panel. Every panel of the app renders through this so loading, empty, stale, degraded, offline and error
 * look and behave the same everywhere (PLAN §1.1 rule 11). Three situations are kept apart (PLAN §9.3):
 *
 * - `not-configured`: no adapter serves the module ("Nicht verbunden", [Adapter konfigurieren]);
 * - `offline`: an adapter is configured but unreachable ("Offline - X nicht erreichbar seit ...", retry);
 * - `unsupported`: the adapter is up but lacks the capability ("Lesen nicht verfügbar").
 *
 * `ready` may carry an `outage` when cached data is shown while the adapter is offline, and a degraded/stale notice.
 */
export type PanelState =
  | { kind: "loading" }
  | { kind: "error"; error: unknown; onRetry?: () => void; retrying?: boolean }
  | { kind: "offline"; outage: OutageInfo; onRetry?: () => void }
  | { kind: "not-configured"; moduleName?: string; adapterId?: string; onRetry?: () => void }
  | { kind: "unsupported"; capability: string; adapterName?: string; moduleName?: string; onRetry?: () => void }
  | { kind: "empty"; title?: string; description?: ReactNode; icon?: ReactNode; action?: ReactNode }
  | {
      kind: "ready";
      degraded?: { adapterId?: string; reason?: string; affected?: readonly string[] };
      freshness?: Freshness | null;
      /** Cached data shown while its adapter is offline. */
      outage?: OutageInfo;
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
  const adapterId = state.kind === "not-configured" ? state.adapterId : undefined;
  const configure =
    state.kind === "not-configured" ? (
      <Button size="sm" variant="ghost" icon={<Settings2 size={14} />} onClick={() => router.push(adapterId && !adapterId.startsWith("unconfigured-") ? `/settings?adapter=${encodeURIComponent(adapterId)}` : "/settings")}>
        {t("panel.configureAdapter")}
      </Button>
    ) : null;

  return (
    <HudPanel {...panelProps} footer={state.kind === "ready" ? footer : configure} bodyClassName={bodyClassName}>
      <PanelStateBody state={state} skeletonRows={skeletonRows}>
        {children}
      </PanelStateBody>
    </HudPanel>
  );
}
