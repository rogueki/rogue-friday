"use client";

import type { Freshness, SourceDescriptor } from "@jarvis/sdk";
import { FreshnessBadge, SourceBadge, StatusChip } from "@jarvis/ui";
import { Eye } from "lucide-react";
import { useT } from "@/i18n";
import type { CapabilityState } from "@/lib/capabilities";
import "./kit.css";

export interface DataBadgesProps {
  sources?: readonly SourceDescriptor[] | null;
  freshness?: Freshness | null;
  className?: string;
}

/** Source + freshness of a list/detail response (PLAN §8.8/§8.9): the user always sees where data comes from and how old it is. */
export function DataBadges({ sources, freshness, className }: DataBadgesProps) {
  const { t, locale } = useT();
  const systems = Array.from(new Set((sources ?? []).map((source) => source.adapterId)));
  const isMock = (sources ?? []).length > 0 && (sources ?? []).every((source) => source.system === "mock");
  const mode = freshness?.state === "offline-cache" ? "cache" : isMock ? "mock" : "live";
  return (
    <span className={["mk-badges", className].filter(Boolean).join(" ")}>
      {systems.length > 0 ? (
        <SourceBadge
          source={systems.join(", ")}
          mode={mode}
          prefix={t("memory.kit.source")}
          modeLabels={{ live: t("memory.kit.mode.live"), mock: t("memory.kit.mode.mock"), cache: t("memory.kit.mode.cache") }}
        />
      ) : null}
      {freshness ? (
        <FreshnessBadge
          state={freshness.state}
          asOf={freshness.asOf ?? undefined}
          locale={locale === "de" ? "de-DE" : "en-GB"}
          labels={{
            fresh: t("memory.kit.fresh.fresh"),
            stale: t("memory.kit.fresh.stale"),
            unknown: t("memory.kit.fresh.unknown"),
            "offline-cache": t("memory.kit.fresh.offlineCache"),
          }}
        />
      ) : null}
    </span>
  );
}

/** "Lesen verfügbar / Senden nicht verfügbar" (PLAN §9.3). Renders nothing when the write capability is available. */
export function CapabilityNote({ state, readText, writeText }: { state: CapabilityState; readText: string; writeText: string }) {
  if (state === "available") return null;
  return (
    <span className="mk-capnote" role="note">
      <StatusChip tone="amber" icon={<Eye size={12} strokeWidth={1.75} aria-hidden="true" />}>
        {readText}
      </StatusChip>
      <StatusChip tone="muted">{writeText}</StatusChip>
    </span>
  );
}
