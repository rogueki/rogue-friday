"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useAdapters } from "@/lib/api/domains/system";
import { useT } from "@/i18n";
import { useCapabilities } from "@/lib/capabilities";
import type { PanelState } from "@/components/PanelFrame";
import { useServerClockOffset } from "./useServerClock";
import { classifyAvailability, type Availability, type OutageInfo } from "./availability";

/**
 * First time this client saw an adapter offline. The contract has no "offline since" field, so "nicht erreichbar seit"
 * is the first observation of the outage (falling back to the adapter's last success). Reactive so the text updates.
 */
const firstSeen = new Map<string, string>();
const listeners = new Set<() => void>();
let version = 0;

function notify(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test hook: forget all observations. */
export function resetOutageClock(): void {
  firstSeen.clear();
  notify();
}

/**
 * Availability of the adapters behind capability modules (or adapter categories): `not-configured`, `outage`,
 * `unsupported` or `ok` (see `availability.ts`). Reads the shared `/adapters` and `/capabilities` queries; pass the
 * module query's `error` so a failing call (503 ADAPTER_UNAVAILABLE) is classified even when the adapter list lags.
 */
export function useModulesAvailability(modules: readonly string[], options: { error?: unknown; action?: string } = {}): Availability[] {
  const adapters = useAdapters();
  const { capabilities, isLoading } = useCapabilities();
  const items = adapters.data?.items;
  const clock = useSyncExternalStore(subscribe, () => version, () => 0);
  const offset = useServerClockOffset();
  const key = modules.join("|");
  const availability = useMemo<Availability[]>(
    () =>
      key
        .split("|")
        .filter(Boolean)
        .map((module) =>
          classifyAvailability(
            { module, adapters: items, adaptersPending: adapters.isPending, capabilities, capabilitiesPending: isLoading, error: options.error, action: options.action },
            (id) => firstSeen.get(id),
          ),
        ),
    // `clock` re-runs the decision when a first-observation time was recorded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, items, adapters.isPending, capabilities, isLoading, options.error, options.action, clock],
  );

  const outageIds = availability.flatMap((entry) => (entry.kind === "outage" ? [entry.outage.adapterId] : [])).join("|");
  useEffect(() => {
    let changed = false;
    for (const id of outageIds.split("|").filter(Boolean)) {
      if (!firstSeen.has(id)) {
        firstSeen.set(id, new Date(Date.now() + offset).toISOString());
        changed = true;
      }
    }
    if (changed) notify();
  }, [outageIds, offset]);
  useEffect(() => {
    // A recovered adapter starts a fresh "since" the next time it fails.
    let changed = false;
    for (const adapter of items ?? []) {
      if (adapter.health.status === "online" && firstSeen.delete(adapter.manifest.id)) changed = true;
    }
    if (changed) notify();
  }, [items]);
  return availability;
}

export function useModuleAvailability(module: string, options: { error?: unknown; action?: string } = {}): Availability {
  return useModulesAvailability([module], options)[0] ?? { kind: "ok" };
}

/**
 * "Since" lookup for adapters the caller shows as offline (overview tiles): records the first observation of each id
 * and re-renders once so the text can use it.
 */
export function useOutageTracker(adapterIds: readonly string[]): (adapterId: string) => string | undefined {
  const clock = useSyncExternalStore(subscribe, () => version, () => 0);
  const offset = useServerClockOffset();
  const key = adapterIds.join("|");
  useEffect(() => {
    let changed = false;
    for (const id of key.split("|").filter(Boolean)) {
      if (!firstSeen.has(id)) {
        firstSeen.set(id, new Date(Date.now() + offset).toISOString());
        changed = true;
      }
    }
    if (changed) notify();
  }, [key, offset]);
  // `clock` only exists to subscribe this component to first-observation updates.
  return (id) => (clock >= 0 ? firstSeen.get(id) : undefined);
}

export interface PanelGate {
  availability: Availability;
  /** Terminal state to render instead of the content (pending/not configured/outage without data/unsupported); null = render content. */
  state: PanelState | null;
  /** Set while cached data is shown although the adapter is offline: attach to the `ready` state. */
  outage: OutageInfo | undefined;
  /** Re-reads adapter health and capabilities (and the module's own query via `onRetry`). */
  retry: () => void;
}

/**
 * Availability turned into the shared panel vocabulary (PLAN §9.3):
 * (a) no adapter -> `not-configured`; (b) adapter offline -> `offline` (or `ready` + `outage` when data is cached);
 * (c) adapter up but capability missing -> `unsupported`.
 */
export function useModulePanelGate(
  module: string,
  options: { moduleName: string; error?: unknown; hasData?: boolean; onRetry?: () => void; action?: string },
): PanelGate {
  const { t } = useT();
  const adapters = useAdapters();
  const availability = useModuleAvailability(module, { error: options.error, action: options.action });
  const { refetch } = adapters;
  const { onRetry } = options;
  const retry = (): void => {
    void refetch();
    onRetry?.();
  };
  const hasData = options.hasData ?? false;
  let state: PanelState | null = null;
  let outage: OutageInfo | undefined;
  switch (availability.kind) {
    case "pending":
      state = { kind: "loading" };
      break;
    case "not-configured":
      state = { kind: "not-configured", moduleName: options.moduleName, adapterId: availability.adapterId, onRetry: retry };
      break;
    case "outage": {
      const named = availability.outage.adapterName ? availability.outage : { ...availability.outage, adapterName: t("avail.adapterFor", { module: options.moduleName }) };
      if (hasData) outage = named;
      else state = { kind: "offline", outage: named, onRetry: retry };
      break;
    }
    case "unsupported":
      state = { kind: "unsupported", capability: availability.capability, adapterName: availability.adapterName, moduleName: options.moduleName, onRetry: retry };
      break;
    default:
      break;
  }
  return { availability, state, outage, retry };
}
