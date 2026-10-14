"use client";

import type { Freshness, Overview } from "@jarvis/sdk";
import type { ReactNode } from "react";
import type { PanelState } from "@/components/PanelFrame";
import { useOverview } from "@/lib/api/domains/core";

type DegradedSection = Overview["degradedSections"][number];

export interface SectionStatus {
  offline?: DegradedSection;
  degraded?: DegradedSection;
}

/** Looks up the degraded/offline entries of the overview that belong to a panel (PLAN §27.16). */
export function sectionStatus(overview: Overview | undefined, sections: readonly string[]): SectionStatus {
  const entries = (overview?.degradedSections ?? []).filter((entry) => sections.includes(entry.section));
  return {
    offline: entries.find((entry) => entry.status === "offline"),
    degraded: entries.find((entry) => entry.status !== "offline"),
  };
}

export interface PanelResolveOptions {
  /** True when the panel has nothing to show although its source is healthy. */
  empty?: boolean;
  emptyTitle?: string;
  emptyDescription?: ReactNode;
  emptyIcon?: ReactNode;
  /** The panel's data source is missing in the payload (`null`): treated like an unconfigured adapter. */
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
 * `degradedSections`, so one failing adapter never takes the other panels down.
 */
export function useOverviewPanel(sections: readonly string[]): OverviewPanelData {
  const query = useOverview();
  const overview = query.data?.data;
  const freshness = query.data?.freshness;
  const refetch = (): void => void query.refetch();
  const status = sectionStatus(overview, sections);

  const resolve = (options: PanelResolveOptions = {}): PanelState => {
    if (query.isPending) return { kind: "loading" };
    if (!overview) return { kind: "error", error: query.error, onRetry: refetch, retrying: query.isFetching };
    if (status.offline) {
      return { kind: "offline", adapterId: status.offline.adapterId, reason: status.offline.reason, lastSync: overview.lastUpdatedAt, onRetry: refetch };
    }
    if (options.missing) return { kind: "offline", lastSync: overview.lastUpdatedAt, onRetry: refetch };
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
