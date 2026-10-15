"use client";

import type { ActivityEvent, Freshness, SourceDescriptor } from "@friday/sdk";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { activityHeadKey, useActivityStream } from "@/lib/api/domains/activity";
import { addToBuffer, compareNewestFirst, matchesFilters, rangeStart, toServerFilters, type ActivityFilterState } from "./model";

/** Upper bound of events kept in the page buffer; the oldest are dropped first. 10 000 is the performance target. */
export const ACTIVITY_BUFFER_CAP = 20_000;
/** Minimum time between two renders caused by incoming events; a burst is shown as one update per interval. */
export const ACTIVITY_UPDATE_INTERVAL_MS = 200;

export interface ActivityBuffer {
  /** Events shown (filtered, newest first, frozen while paused). */
  events: ActivityEvent[];
  /** Every buffered event before client-side filtering (source of the filter options). */
  all: ActivityEvent[];
  paused: boolean;
  /** Events that arrived while paused and match the filters. */
  pending: number;
  pause: () => void;
  resume: () => void;
  loading: boolean;
  error: unknown;
  hasMore: boolean;
  loadMore: () => void;
  loadingMore: boolean;
  loadMoreError: unknown;
  refetch: () => void;
  refetching: boolean;
  freshness: Freshness | undefined;
  sources: SourceDescriptor[] | undefined;
  hasData: boolean;
  /** Older events matching the server-side filters are being fetched; the buffered events stay visible meanwhile. */
  historyLoading: boolean;
}

/**
 * Live buffer of the activity page: every event that `applyEvent` puts into the head list is taken from the query
 * cache the moment it arrives (the cached list itself is capped at 200, so reading it only at render time would lose
 * events of a burst), together with the server-filtered history and older pages, merged by id. Renders are throttled;
 * pausing freezes the visible set, resuming shows what arrived meanwhile.
 */
export function useActivityBuffer(filters: ActivityFilterState): ActivityBuffer {
  const queryClient = useQueryClient();
  // The time range is anchored once per selection, so the server query key stays stable between renders.
  const rangeFrom = useMemo(() => {
    const start = rangeStart(filters.range, Date.now());
    return start === null ? undefined : new Date(start).toISOString();
  }, [filters.range]);
  const serverFilters = useMemo(() => toServerFilters(filters, rangeFrom), [filters, rangeFrom]);
  const stream = useActivityStream(serverFilters);

  const bufferRef = useRef<Map<string, ActivityEvent>>(new Map());
  const [version, setVersion] = useState(0);
  const lastBump = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Leading and trailing throttle: the first change renders at once, a burst afterwards once per interval. */
  const bump = useCallback(() => {
    const wait = lastBump.current + ACTIVITY_UPDATE_INTERVAL_MS - Date.now();
    if (wait <= 0) {
      lastBump.current = Date.now();
      setVersion((value) => value + 1);
      return;
    }
    if (timer.current !== null) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      lastBump.current = Date.now();
      setVersion((value) => value + 1);
    }, wait);
  }, []);

  // Live events: read from the cache on every update of the head list, not once per render.
  useEffect(() => {
    const headKey = activityHeadKey();
    const absorbHead = (): void => {
      const data = queryClient.getQueryData<{ items: ActivityEvent[] }>(headKey);
      if (!data) return;
      addToBuffer(bufferRef.current, data.items, ACTIVITY_BUFFER_CAP);
      bump();
    };
    absorbHead();
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== "updated") return;
      const key = event.query.queryKey;
      if (key.length === headKey.length && key[0] === headKey[0] && key[1] === headKey[1] && JSON.stringify(key[2]) === JSON.stringify(headKey[2])) absorbHead();
    });
    return () => {
      unsubscribe();
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [queryClient, bump]);

  // History: server-filtered first page and older pages.
  useEffect(() => {
    if (stream.items.length === 0) return;
    addToBuffer(bufferRef.current, stream.items, ACTIVITY_BUFFER_CAP);
    bump();
  }, [stream.items, bump]);

  const all = useMemo(
    () => [...bufferRef.current.values()].sort(compareNewestFirst),
    // `version` is the change signal of the ref-held buffer
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version],
  );

  const [frozen, setFrozen] = useState<ReadonlySet<string> | null>(null);
  const filtered = useMemo(() => {
    const now = Date.now();
    return all.filter((event) => matchesFilters(event, filters, now));
    // the clock is read once per recompute on purpose
  }, [all, filters]);

  const events = useMemo(() => (frozen ? filtered.filter((event) => frozen.has(event.id)) : filtered), [filtered, frozen]);
  const pending = frozen ? filtered.length - events.length : 0;

  // Loading, error and freshness come from the head list: changing a filter must not blank the page.
  const head = stream.head;
  return {
    events,
    all,
    paused: frozen !== null,
    pending,
    pause: () => setFrozen(new Set(filtered.map((event) => event.id))),
    resume: () => setFrozen(null),
    loading: head.isPending && head.data === undefined,
    error: head.error,
    hasMore: stream.hasMore,
    loadMore: stream.loadMore,
    loadingMore: stream.loadingMore,
    loadMoreError: stream.loadMoreError,
    refetch: () => void head.refetch(),
    refetching: head.isFetching,
    freshness: head.data?.freshness,
    sources: head.data?.sources,
    hasData: head.data !== undefined,
    historyLoading: stream.historyLoading,
  };
}
