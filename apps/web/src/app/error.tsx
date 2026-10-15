"use client";

import { ErrorState } from "@friday/ui";
import { isFridayApiError } from "@friday/sdk";
import { useT } from "@/i18n";

/** Route-level error boundary: a crash in one page never takes the shell of the app down with it. */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useT();
  const api = isFridayApiError(error) ? error : null;
  return (
    <div className="web-fullscreen jv-bg-stage">
      <ErrorState
        title={t("error.title")}
        description={api?.message ?? error.message}
        code={api?.code ?? error.digest}
        correlationId={api?.correlationId}
        onRetry={reset}
        retryLabel={t("common.retry")}
        labels={{ copy: t("common.copy"), copied: t("common.copied"), correlation: t("common.correlationId") }}
      />
    </div>
  );
}
