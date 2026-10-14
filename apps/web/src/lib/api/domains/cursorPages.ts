"use client";

import { useQueries, type QueryKey, type UseQueryOptions } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

interface PagedResponse<TItem> {
  items: TItem[];
  pageInfo: { nextCursor: string | null; hasNextPage: boolean; totalCount?: number };
}

export interface CursorPages<TItem> {
  /** First page plus every loaded follow-up page, de-duplicated by id (the newest copy, i.e. the first page, wins). */
  items: TItem[];
  totalCount: number | undefined;
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreError: unknown;
  loadMore: () => void;
}

/**
 * Cursor pagination on top of the per-page query options of a domain module (PLAN §8.4). The first page is the normal
 * list query (patched live by `applyEvent`); every further page is its own cached query below the same list prefix, so
 * realtime edits reach it as well. `resetKey` drops the loaded follow-up pages when the filters change.
 */
export function useCursorPages<TItem extends { id: string }, TResponse extends PagedResponse<TItem>, TKey extends QueryKey>(
  first: TResponse | undefined,
  pageOptions: (cursor: string) => UseQueryOptions<TResponse, Error, TResponse, TKey>,
  resetKey: string,
): CursorPages<TItem> {
  const [state, setState] = useState<{ key: string; cursors: string[] }>({ key: resetKey, cursors: [] });
  const cursors = useMemo(() => (state.key === resetKey ? state.cursors : []), [state, resetKey]);
  const results = useQueries({ queries: cursors.map((cursor) => pageOptions(cursor)) });

  // `useQueries` returns a new array on every render; only a change of the loaded data may rebuild the merged items,
  // otherwise every consumer effect keyed on `items` would fire after each render.
  const loaded = results.map((result) => result.dataUpdatedAt).join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `loaded` is the change signal of `results`
  const pages = useMemo(() => results.map((result) => result.data), [loaded]);
  const items = useMemo(() => {
    const seen = new Set<string>();
    const merged: TItem[] = [];
    for (const page of [first, ...pages]) {
      for (const item of page?.items ?? []) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        merged.push(item);
      }
    }
    return merged;
  }, [first, pages]);

  const lastLoaded = pages.length > 0 ? pages[pages.length - 1] : first;
  const lastResult = results.length > 0 ? results[results.length - 1] : undefined;
  const loadingMore = lastResult?.isFetching === true && lastResult.data === undefined;
  const nextCursor = lastLoaded?.pageInfo.nextCursor ?? null;
  const hasMore = lastLoaded !== undefined && lastLoaded.pageInfo.hasNextPage && nextCursor !== null;

  const loadMore = useCallback(() => {
    if (!hasMore || loadingMore || nextCursor === null) return;
    setState((previous) => {
      const base = previous.key === resetKey ? previous.cursors : [];
      return base.includes(nextCursor) ? previous : { key: resetKey, cursors: [...base, nextCursor] };
    });
  }, [hasMore, loadingMore, nextCursor, resetKey]);

  return {
    items,
    totalCount: first?.pageInfo.totalCount,
    hasMore,
    loadingMore,
    loadMoreError: lastResult?.error ?? null,
    loadMore,
  };
}
