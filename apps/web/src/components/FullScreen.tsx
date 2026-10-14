"use client";

import { BrandMark, ErrorState } from "@jarvis/ui";
import { isJarvisApiError } from "@jarvis/sdk";
import { useT } from "@/i18n";

/** Full-viewport boot placeholder shown while the session / meta are resolved. */
export function BootScreen() {
  const { t, assistantName } = useT();
  return (
    <div className="web-fullscreen jv-bg-stage" role="status" aria-live="polite">
      <BrandMark size={64} />
      <span className="web-fullscreen__title">{assistantName}</span>
      <span className="web-fullscreen__sub">{t("boot.loading")}</span>
    </div>
  );
}

/** Control API unreachable or answering with a non-auth error: the whole app cannot work, so say so clearly. */
export function FatalErrorScreen({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useT();
  const api = isJarvisApiError(error) ? error : null;
  return (
    <div className="web-fullscreen jv-bg-stage">
      <ErrorState
        title={t("boot.unreachable.title")}
        description={api?.message ?? t("boot.unreachable.description")}
        code={api?.code}
        correlationId={api?.correlationId}
        onRetry={onRetry}
        retryLabel={t("common.retry")}
        labels={{ copy: t("common.copy"), copied: t("common.copied"), correlation: t("common.correlationId") }}
      />
    </div>
  );
}
