import type { Layout, LayoutWidget } from "@jarvis/sdk";

export type WidgetId =
  | "core-overview"
  | "ai-core-orb"
  | "attention-feed"
  | "active-agents"
  | "mission-timeline"
  | "quick-commands"
  | "system-monitor"
  | "memory-insights"
  | "models-services";

export const WIDGET_IDS: readonly WidgetId[] = [
  "core-overview",
  "ai-core-orb",
  "attention-feed",
  "active-agents",
  "mission-timeline",
  "quick-commands",
  "system-monitor",
  "memory-insights",
  "models-services",
];

/** Built-in layout (same as config/layouts/jarvis-command-overview.json); used until/unless the settings deliver another. */
export const DEFAULT_OVERVIEW_LAYOUT: Layout = {
  layoutId: "jarvis-command-overview",
  name: "Jarvis Command / Overview",
  columns: 12,
  widgets: [
    { id: "core-overview", x: 0, y: 0, w: 3, h: 7, visible: true },
    { id: "ai-core-orb", x: 3, y: 0, w: 6, h: 7, visible: true },
    { id: "attention-feed", x: 9, y: 0, w: 3, h: 7, visible: true },
    { id: "active-agents", x: 0, y: 7, w: 5, h: 4, visible: true },
    { id: "mission-timeline", x: 5, y: 7, w: 4, h: 4, visible: true },
    { id: "quick-commands", x: 9, y: 7, w: 3, h: 4, visible: true },
    { id: "system-monitor", x: 0, y: 11, w: 4, h: 4, visible: true },
    { id: "memory-insights", x: 4, y: 11, w: 3, h: 4, visible: true },
    { id: "models-services", x: 7, y: 11, w: 5, h: 4, visible: true },
  ],
};

const isWidgetId = (id: string): id is WidgetId => (WIDGET_IDS as readonly string[]).includes(id);

/**
 * Picks the active layout and makes it safe: unknown widgets are dropped (all unknown: default layout), invalid rectangles fall back to the default
 * placement of that widget, widgets missing from a custom layout stay hidden (the user removed them on purpose).
 */
export function resolveOverviewLayout(layouts: readonly Layout[] | undefined, activeLayoutId: string | undefined): Layout {
  const chosen = layouts?.find((layout) => layout.layoutId === activeLayoutId) ?? DEFAULT_OVERVIEW_LAYOUT;
  const columns = chosen.columns ?? 12;
  const widgets: LayoutWidget[] = [];
  for (const widget of chosen.widgets) {
    if (!isWidgetId(widget.id)) continue;
    const fallback = DEFAULT_OVERVIEW_LAYOUT.widgets.find((w) => w.id === widget.id) as LayoutWidget;
    const valid =
      Number.isInteger(widget.x) && Number.isInteger(widget.y) && widget.w >= 1 && widget.h >= 1 && widget.x >= 0 && widget.x + widget.w <= columns;
    widgets.push(valid ? widget : { ...fallback, visible: widget.visible });
  }
  // A layout that knows none of the overview widgets (e.g. written for another view) must not blank the home page.
  if (widgets.length === 0) return { ...DEFAULT_OVERVIEW_LAYOUT };
  return { ...chosen, columns, widgets };
}

/** Grid placement of a widget as CSS custom properties (desktop); narrower viewports stack via CSS. */
export function widgetPlacement(widget: LayoutWidget, columns: number): Record<string, string> {
  return {
    "--ov-col": `${Math.round((widget.x / columns) * 12) + 1} / span ${Math.max(1, Math.round((widget.w / columns) * 12))}`,
    "--ov-row": `${widget.y + 1} / span ${widget.h}`,
  };
}
