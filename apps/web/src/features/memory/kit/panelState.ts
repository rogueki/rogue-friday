"use client";

import { isJarvisApiError, type Freshness } from "@jarvis/sdk";
import type { ReactNode } from "react";
import type { PanelState } from "@/components/PanelFrame";
import { useT } from "@/i18n";
import { useCapabilities, type CapabilityState } from "@/lib/capabilities";

/** Error codes that mean "the backing adapter is not reachable / not configured" (PLAN §9.3), not "the request was wrong". */
const OUTAGE_CODES: ReadonlySet<string> = new Set(["ADAPTER_UNAVAILABLE", "ADAPTER_TIMEOUT", "CAPABILITY_MISSING"]);

export function isAdapterOutage(error: unknown): boolean {
  return isJarvisApiError(error) && OUTAGE_CODES.has(error.code);
}

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
  /** Capability state of `<module>.read`. `missing` renders "Nicht verbunden · Adapter konfigurieren". */
  read: CapabilityState;
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
 * Maps one query + the module's read capability to the shared panel state (PLAN §1.1 rule 11):
 * loading, error, offline (adapter down or not connected), empty, or ready with stale/degraded notices.
 * A refetch error with data already on screen keeps the data and marks it as offline cache — stale data is never shown as live.
 */
export function usePanelState<T extends { freshness: Freshness }>(query: QueryView<T>, options: PanelStateOptions): PanelState {
  const { t } = useT();
  const { capabilities, isLoading: capabilitiesLoading } = useCapabilities();
  const retry = (): void => void query.refetch();

  if (capabilities && options.read === "missing") {
    return { kind: "offline", adapterId: options.adapterId, reason: t("memory.kit.notConnected", { module: options.moduleName }) };
  }
  if (!capabilities && capabilitiesLoading) return { kind: "loading" };
  if (query.isPending) return { kind: "loading" };

  const data = query.data;
  if (!data) {
    if (isAdapterOutage(query.error)) {
      const message = isJarvisApiError(query.error) ? query.error.message : undefined;
      return { kind: "offline", adapterId: options.adapterId, reason: message, onRetry: retry };
    }
    return { kind: "error", error: query.error, onRetry: retry, retrying: query.isFetching };
  }
  if (options.empty) {
    return { kind: "empty", title: options.emptyTitle, description: options.emptyDescription, icon: options.emptyIcon, action: options.emptyAction };
  }
  const freshness = effectiveFreshness(query) ?? data.freshness;
  return { kind: "ready", freshness, degraded: options.degraded, onRefresh: retry };
}

/** Freshness to display for a query: data kept on screen after a failed refetch is offline cache, never "current". */
export function effectiveFreshness<T extends { freshness: Freshness }>(query: Pick<QueryView<T>, "data" | "isError">): Freshness | undefined {
  if (!query.data) return undefined;
  return query.isError ? { state: "offline-cache", asOf: query.data.freshness.asOf } : query.data.freshness;
}
