"use client";

import type { AdapterInfo, Freshness, Overview } from "@jarvis/sdk";
import type { ReactNode } from "react";
import type { PanelState } from "@/components/PanelFrame";
import {
  CATEGORY_NAV_KEY,
  adapterNotConfigured,
  categoryOfDegradedEntry,
  categoryOfSection,
  isUnconfiguredEntry,
  outageFromSection,
  outageOf,
} from "@/features/shared/availability";
import { useOutageTracker } from "@/features/shared/useAvailability";
import { useT, type MessageKey } from "@/i18n";
import { useOverview } from "@/lib/api/domains/core";
import { useAdapters } from "@/lib/api/domains/system";

type DegradedSection = Overview["degradedSections"][number];

export interface SectionStatus {
  offline?: DegradedSection;
  degraded?: DegradedSection;
}

/**
 * Looks up the degraded/offline entries of the overview that belong to a panel (PLAN §27.16). `sections` may be panel
 * ids, module ids or the German labels the Control API puts into `degradedSections[].section`; entries are matched by
 * adapter category, so `"agents"`, `"Agenten"` and `"unconfigured-agents"` all belong to the agents panel.
 */
export function sectionStatus(overview: Overview | undefined, sections: readonly string[], adapters?: readonly AdapterInfo[]): SectionStatus {
  const categories = new Set(sections.map((section) => categoryOfSection(section)).filter((category) => category !== undefined));
  const entries = (overview?.degradedSections ?? []).filter((entry) => {
    if (sections.includes(entry.section)) return true;
    const category = categoryOfDegradedEntry(entry, adapters);
    return category !== undefined && categories.has(category);
  });
  return {
    offline: entries.find((entry) => entry.status === "offline"),
    degraded: entries.find((entry) => entry.status !== "offline"),
  };
}

/**
 * Freshness of the whole overview. The envelope is "stale" whenever any section failed; that is already explained per
 * panel by `degradedSections` (an unrelated panel with healthy data must not show a stale banner). A failed refresh of
 * the overview itself is stale.
 */
export function overviewFreshness(query: { data?: { freshness: Freshness; data: Overview }; isError: boolean; dataUpdatedAt: number }): Freshness | undefined {
  const envelope = query.data?.freshness;
  // Restored from the offline cache and not refreshed: keep the honest label and the age of the data.
  if (envelope?.state === "offline-cache") return envelope;
  if (query.isError && query.dataUpdatedAt > 0) return { state: "stale", asOf: new Date(query.dataUpdatedAt).toISOString() };
  if (envelope && envelope.state !== "fresh" && (query.data?.data.degradedSections.length ?? 0) > 0) return { state: "fresh", asOf: envelope.asOf };
  return envelope;
}

export interface PanelResolveOptions {
  /** True when the panel has nothing to show although its source is healthy. */
  empty?: boolean;
  emptyTitle?: string;
  emptyDescription?: ReactNode;
  emptyIcon?: ReactNode;
  /** The panel's data source is missing in the payload (`null`) without a degraded entry: treated like an unconfigured adapter. */
  missing?: boolean;
}

export interface OverviewPanelData {
  overview: Overview | undefined;
  freshness: Freshness | undefined;
  refetch: () => void;
  /** Ready-made state; render `ready` content only when `state.kind === "ready"`. */
  resolve: (options?: PanelResolveOptions) => PanelState;
}

/**
 * Per-panel view of the single aggregated overview query: loading and error come from the query, offline/degraded from
 * `degradedSections`, so one failing adapter never takes the other panels down. An offline entry is an outage when the
 * adapter is registered ("Offline - X nicht erreichbar seit ...") and "not connected" when none is configured (PLAN §9.3).
 */
export function useOverviewPanel(sections: readonly string[]): OverviewPanelData {
  const { t } = useT();
  const query = useOverview();
  const adapters = useAdapters();
  const overview = query.data?.data;
  const freshness = overviewFreshness(query);
  const items = adapters.data?.items;
  const refetch = (): void => {
    void query.refetch();
    void adapters.refetch();
  };
  const status = sectionStatus(overview, sections, items);
  const offlineAdapterId = status.offline?.adapterId;
  const since = useOutageTracker(offlineAdapterId && !isUnconfiguredEntry(status.offline as DegradedSection) ? [offlineAdapterId] : []);
  const firstCategory = sections.map((section) => categoryOfSection(section)).find((category) => category !== undefined);
  const moduleName = firstCategory ? t(CATEGORY_NAV_KEY[firstCategory] as MessageKey) : undefined;

  const resolve = (options: PanelResolveOptions = {}): PanelState => {
    if (query.isPending) return { kind: "loading" };
    if (!overview) return { kind: "error", error: query.error, onRetry: refetch, retrying: query.isFetching };
    const entry = status.offline;
    if (entry) {
      const adapter = items?.find((candidate) => candidate.manifest.id === entry.adapterId);
      if (isUnconfiguredEntry(entry) || (adapter && adapterNotConfigured(adapter))) {
        return { kind: "not-configured", moduleName, adapterId: isUnconfiguredEntry(entry) ? undefined : entry.adapterId, onRetry: refetch };
      }
      const outage = adapter ? { ...outageOf(adapter, since(adapter.manifest.id)), reason: entry.reason || adapter.health.lastError?.message } : outageFromSection(entry, undefined, since(entry.adapterId));
      return { kind: "offline", outage, onRetry: refetch };
    }
    if (options.missing) return { kind: "not-configured", moduleName, onRetry: refetch };
    if (options.empty) {
      return { kind: "empty", title: options.emptyTitle, description: options.emptyDescription, icon: options.emptyIcon };
    }
    return {
      kind: "ready",
      degraded: status.degraded ? { adapterId: status.degraded.adapterId, reason: status.degraded.reason, affected: [status.degraded.adapterId] } : undefined,
      freshness,
      onRefresh: refetch,
    };
  };

  return { overview, freshness, refetch, resolve };
}
