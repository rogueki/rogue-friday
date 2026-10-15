"use client";

import { createIdempotencyKey } from "@friday/sdk";
import {
  useMutation,
  useQueryClient,
  type MutationMeta,
  type QueryClient,
  type QueryKey,
  type UseMutationResult,
} from "@tanstack/react-query";
import { useCallback } from "react";

/** Variables of every mutation carry an optional Idempotency-Key that is generated once per user intent. */
export interface IntentVars {
  idempotencyKey?: string;
}

export interface ApiMutationOptions<TData, TVars extends IntentVars> {
  mutationFn: (vars: TVars & { idempotencyKey: string }) => Promise<TData>;
  /** Targeted invalidation after success (prefix match). */
  invalidate?: readonly QueryKey[] | ((data: TData, vars: TVars) => readonly QueryKey[]);
  /** Queries refetched after a 409 CONFLICT so the user sees the newer state (If-Match mismatch). */
  conflictKeys?: readonly QueryKey[];
  /**
   * Optimistic cache edit for SAFE, REVERSIBLE actions only (PLAN §48.8/9: never approvals, never anything with
   * external side effects). Returns the rollback function that is called when the request fails.
   */
  optimistic?: (queryClient: QueryClient, vars: TVars) => (() => void) | void;
  /** Suppress the global error toast, e.g. when the caller renders the error inline. */
  silent?: boolean;
  /** Human-readable action name used by the global error toast ("Aufgabe abbrechen"). */
  label?: string;
}

export interface ApiMutationMeta extends MutationMeta {
  silent?: boolean;
  label?: string;
  conflictKeys?: readonly QueryKey[];
}

export type ApiMutation<TData, TVars extends IntentVars> = UseMutationResult<
  TData,
  Error,
  TVars,
  { rollback?: () => void } | undefined
>;

/**
 * Thin wrapper around `useMutation` that implements the data rules of PLAN §48: Idempotency-Key per intent, targeted
 * invalidation, optional optimistic edit with rollback, conflict refetch. Error toasts come from the QueryClient's
 * MutationCache (see `createQueryClient`).
 */
export function useApiMutation<TData, TVars extends IntentVars = IntentVars>(
  options: ApiMutationOptions<TData, TVars>,
): ApiMutation<TData, TVars> {
  const queryClient = useQueryClient();
  const meta: ApiMutationMeta = { silent: options.silent, label: options.label, conflictKeys: options.conflictKeys };
  const mutation = useMutation<TData, Error, TVars, { rollback?: () => void } | undefined>({
    meta,
    mutationFn: (vars) => options.mutationFn({ ...vars, idempotencyKey: vars.idempotencyKey ?? createIdempotencyKey() }),
    onMutate: (vars) => {
      const rollback = options.optimistic?.(queryClient, vars);
      return rollback ? { rollback } : undefined;
    },
    onError: (_error, _vars, context) => context?.rollback?.(),
    onSuccess: (data, vars) => {
      const keys = typeof options.invalidate === "function" ? options.invalidate(data, vars) : (options.invalidate ?? []);
      for (const key of keys) void queryClient.invalidateQueries({ queryKey: key });
    },
  });

  // Pin the Idempotency-Key at call time so a re-submit of the same intent (retry button) replays the stored response.
  const { mutate, mutateAsync } = mutation;
  const withKey = useCallback((vars: TVars): TVars => ({ ...vars, idempotencyKey: vars.idempotencyKey ?? createIdempotencyKey() }), []);
  const pinnedMutate = useCallback(
    (vars: TVars, callbacks?: Parameters<typeof mutate>[1]) => mutate(withKey(vars), callbacks),
    [mutate, withKey],
  );
  const pinnedMutateAsync = useCallback(
    (vars: TVars, callbacks?: Parameters<typeof mutateAsync>[1]) => mutateAsync(withKey(vars), callbacks),
    [mutateAsync, withKey],
  );
  return { ...mutation, mutate: pinnedMutate, mutateAsync: pinnedMutateAsync } as ApiMutation<TData, TVars>;
}

/** Writes `updater(old)` into every cache entry below `key` and returns a function that restores the previous values. */
export function patchQueries<T>(
  queryClient: QueryClient,
  key: QueryKey,
  updater: (old: T) => T,
): () => void {
  const snapshots = queryClient.getQueriesData<T>({ queryKey: key });
  queryClient.setQueriesData<T>({ queryKey: key }, (old) => (old === undefined ? old : updater(old)));
  return () => {
    for (const [snapshotKey, value] of snapshots) queryClient.setQueryData(snapshotKey, value);
  };
}
