"use client";

import { StaleBanner } from "@friday/ui";
import { useMemo, type ComponentType, type CSSProperties } from "react";
import { useT } from "@/i18n";
import { useOverview } from "@/lib/api/domains/core";
import { useLayouts } from "@/lib/api/domains/settings";
import { useRealtimeStatus } from "@/lib/realtime/store";
import { useAppSettings } from "@/lib/settings";
import { AttentionPanel, CoreOverviewPanel, OrbPanel } from "./CorePanels";
import { overviewFreshness } from "./useOverviewPanel";
import { resolveOverviewLayout, widgetPlacement, type WidgetId } from "./layout";
import { ActiveAgentsPanel, MemoryInsightsPanel, MissionTimelinePanel, ModelsServicesPanel, QuickCommandsPanel, SystemMonitorPanel } from "./WidgetPanels";

interface CellProps {
  className?: string;
  style?: CSSProperties;
}

const WIDGETS: Record<WidgetId, ComponentType<CellProps>> = {
  "core-overview": CoreOverviewPanel,
  "ai-core-orb": OrbPanel,
  "attention-feed": AttentionPanel,
  "active-agents": ActiveAgentsPanel,
  "mission-timeline": MissionTimelinePanel,
  "quick-commands": QuickCommandsPanel,
  "system-monitor": SystemMonitorPanel,
  "memory-insights": MemoryInsightsPanel,
  "models-services": ModelsServicesPanel,
};

/**
 * Overview (PLAN §27). Placement comes from the layout JSON (settings -> layouts, 12 columns); widgets can be hidden or
 * moved without a rebuild. Below 1100 px the CSS stacks the cells (tablet: orb, attention, two columns; mobile: one column).
 */
export function OverviewPage() {
  const { t } = useT();
  const { settings } = useAppSettings();
  const layouts = useLayouts();
  const overview = useOverview();
  const realtime = useRealtimeStatus();
  const layout = useMemo(() => resolveOverviewLayout(layouts.data?.items, settings?.dashboard.activeLayoutId), [layouts.data?.items, settings?.dashboard.activeLayoutId]);

  const freshness = overviewFreshness(overview);
  const stale = freshness && freshness.state !== "fresh" ? freshness : null;
  const streamDown = realtime.state === "offline" || realtime.state === "polling";

  return (
    <div className="ov-page">
      {stale || streamDown ? (
        <StaleBanner
          className="ov-stale"
          asOf={stale?.asOf ?? undefined}
          message={streamDown ? t("overview.stale.stream") : t("overview.stale.data")}
          refreshLabel={t("common.refresh")}
          onRefresh={() => void overview.refetch()}
          refreshing={overview.isFetching}
        />
      ) : null}
      <div className="ov-grid" data-density={settings?.dashboard.compact ? "compact" : undefined}>
        {layout.widgets
          .filter((widget) => widget.visible)
          .map((widget) => {
            const Widget = WIDGETS[widget.id as WidgetId];
            return <Widget key={widget.id} className={`ov-cell ov-cell--${widget.id}`} style={widgetPlacement(widget, layout.columns ?? 12) as CSSProperties} />;
          })}
      </div>
    </div>
  );
}
