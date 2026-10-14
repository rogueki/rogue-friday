"use client";

import type { Freshness, OrbSnapshot } from "@jarvis/sdk";
import { useQuery } from "@tanstack/react-query";
import { coreQueries } from "@/lib/api/domains/core";

export interface OrbSnapshotState {
  snapshot: OrbSnapshot | undefined;
  freshness: Freshness | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
}

/**
 * Orb state store = the query cache entry of GET /orb/status. `jarvis.orb.status_changed` events are written into the
 * same entry by the realtime reducer, so every consumer (orb, voice panel, command bar, a11y sentence) sees one value.
 */
export function useOrbSnapshot(): OrbSnapshotState {
  const query = useQuery(coreQueries.orb());
  const snapshot = query.data?.data;
  const freshness = query.data?.freshness;
  return {
    snapshot,
    freshness,
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}
