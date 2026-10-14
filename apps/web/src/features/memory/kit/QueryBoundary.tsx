"use client";

import { isJarvisApiError } from "@jarvis/sdk";
import { ErrorState, OfflineState, Skeleton } from "@jarvis/ui";
import type { ReactNode } from "react";
import { useT } from "@/i18n";
import { isAdapterOutage, type QueryView } from "./panelState";

/** Loading / error / offline handling for the body of a drawer or dialog that shows one query's data. */
export function QueryBoundary<T>({ query, children, rows = 4 }: { query: QueryView<T>; children: (data: T) => ReactNode; rows?: number }) {
  const { t } = useT();
  if (query.data !== undefined) return <>{children(query.data)}</>;
  if (query.isPending) {
    return (
      <div className="mk-stack" aria-busy="true">
        {Array.from({ length: rows }, (_, index) => (
          <Skeleton key={index} variant="row" height={44} label={t("common.loading")} />
        ))}
      </div>
    );
  }
  if (isAdapterOutage(query.error)) {
    return (
      <OfflineState
        compact
        title={t("panel.offline.title")}
        description={isJarvisApiError(query.error) ? query.error.message : t("panel.offline.description")}
        onRetry={() => void query.refetch()}
        retryLabel={t("common.retry")}
      />
    );
  }
  const api = isJarvisApiError(query.error) ? query.error : null;
  return (
    <ErrorState
      compact
      title={t("common.loadError")}
      description={api?.message ?? (query.error instanceof Error ? query.error.message : undefined)}
      code={api?.code}
      correlationId={api?.correlationId}
      onRetry={() => void query.refetch()}
      retrying={query.isFetching}
      retryLabel={t("common.retry")}
      labels={{ copy: t("common.copy"), copied: t("common.copied"), correlation: t("common.correlationId") }}
    />
  );
}
