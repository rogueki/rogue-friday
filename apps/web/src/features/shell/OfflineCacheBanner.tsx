"use client";

import { FreshnessBadge, useNow } from "@friday/ui";
import { CloudOff } from "lucide-react";
import { useT } from "@/i18n";
import { useSession } from "@/lib/session";

/**
 * Shown while the Control API is unreachable and the page runs on the stored offline cache (PLAN §12.5): what the user
 * sees is the last known state, not live data, and nothing can be changed. Disappears when the session is back.
 */
export function OfflineCacheBanner() {
  const { t, locale } = useT();
  const { offline, offlineSavedAt } = useSession();
  const now = useNow(30_000);
  if (!offline) return null;
  return (
    <div className="jv-stale offline-cache-banner" role="status" data-testid="offline-cache-banner">
      <CloudOff size={14} strokeWidth={1.75} aria-hidden="true" />
      <span className="jv-stale__msg">{t("offline.banner")}</span>
      <FreshnessBadge
        state="offline-cache"
        {...(offlineSavedAt !== null ? { asOf: new Date(offlineSavedAt).toISOString() } : {})}
        now={now}
        locale={locale === "de" ? "de-DE" : "en-GB"}
        labels={{ "offline-cache": t("offline.badge") }}
      />
    </div>
  );
}
