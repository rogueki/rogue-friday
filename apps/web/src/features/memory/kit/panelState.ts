"use client";

import type { Freshness } from "@jarvis/sdk";
import type { ReactNode } from "react";
import type { PanelState } from "@/components/PanelFrame";
import { useModulePanelGate } from "@/features/shared/useAvailability";

export { isAdapterOutage } from "@/features/shared/availability";

/** The slice of a TanStack query result the state resolver needs. */
export interface QueryView<T> {
  data: T | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
  refetch: () => unknown;
}

export interface PanelStateOptions {
  /** Capability module that serves the view (`communication`, `calendar`, ...): decides not configured / offline / unsupported. */
  module: string;
  /** Display name of the module for the "not connected" text. */
  moduleName: string;
  adapterId?: string;
  /** True when the (healthy) source returned nothing to show. */
  empty?: boolean;
  emptyTitle?: string;
  emptyDescription?: ReactNode;
  emptyIcon?: ReactNode;
  emptyAction?: ReactNode;
  /** Extra degradation notice (e.g. one channel offline) shown above the content. */
  degraded?: { adapterId?: string; reason?: string; affected?: readonly string[] };
}

/**
 * Maps one query + the module's availability to the shared panel state (PLAN §1.1 rule 11, §9.3): loading, error,
 * not configured, offline (adapter registered but unreachable), unsupported capability, empty, or ready with stale,
 * offline-cache and degraded notices. A refetch error with data on screen keeps the data and marks it as offline cache.
 */
export function usePanelState<T extends { freshness: Freshness }>(query: QueryView<T>, options: PanelStateOptions): PanelState {
  const retry = (): void => void query.refetch();
  const data = query.data;
  const gate = useModulePanelGate(options.module, { moduleName: options.moduleName, error: query.error, hasData: data !== undefined, onRetry: retry });
  if (gate.state) return gate.state;
  if (query.isPending) return { kind: "loading" };

  if (!data) {
    return { kind: "error", error: query.error, onRetry: retry, retrying: query.isFetching };
  }
  if (options.empty && gate.outage) return { kind: "offline", outage: gate.outage, onRetry: gate.retry };
  if (options.empty) {
    return { kind: "empty", title: options.emptyTitle, description: options.emptyDescription, icon: options.emptyIcon, action: options.emptyAction };
  }
  const freshness = gate.outage ? { state: "offline-cache" as const, asOf: gate.outage.lastSuccessAt ?? data.freshness.asOf } : (effectiveFreshness(query) ?? data.freshness);
  return { kind: "ready", freshness, outage: gate.outage, degraded: options.degraded, onRefresh: gate.retry };
}

/** Freshness to display for a query: data kept on screen after a failed refetch is offline cache, never "current". */
export function effectiveFreshness<T extends { freshness: Freshness }>(query: Pick<QueryView<T>, "data" | "isError">): Freshness | undefined {
  if (!query.data) return undefined;
  return query.isError ? { state: "offline-cache", asOf: query.data.freshness.asOf } : query.data.freshness;
}
