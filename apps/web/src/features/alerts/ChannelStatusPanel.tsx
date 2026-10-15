"use client";

import type { Channel, ChannelStatus, EscalationStep } from "@friday/sdk";
import { Button, IconTile, StatusChip } from "@friday/ui";
import { Settings2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { PanelFrame } from "@/components/PanelFrame";
import { useT } from "@/i18n";
import { useChannels } from "@/lib/api/domains/communication";
import { useSettings } from "@/lib/api/domains/settings";
import { useRealtimeStatus } from "@/lib/realtime/store";
import { CHANNEL_ICON, CHANNEL_STATUS_TONE, channelKindKey, channelStatusKey } from "../memory/kit/channelStatus";
import { DataBadges } from "../memory/kit/Badges";
import { useFormat } from "../memory/kit/hooks";

type EscalationChannel = EscalationStep["channel"];
const ORDER: readonly EscalationChannel[] = ["dashboard", "telegram", "whatsapp", "sms", "phone", "email"];

interface Row {
  kind: EscalationChannel;
  status: ChannelStatus | null;
  detail?: string;
  enabled: boolean | null;
  minPriority: string | null;
  lastSyncAt: string | null;
}

/** Status of every escalation channel (PLAN §39.2 "Kanalstatus"): dashboard from the event stream, the rest from the communication adapter. */
export function ChannelStatusPanel() {
  const { t } = useT();
  const format = useFormat();
  const router = useRouter();
  const channels = useChannels();
  const settings = useSettings();
  const realtime = useRealtimeStatus();

  const rows = useMemo<Row[]>(() => {
    const byKind = new Map<string, Channel>();
    for (const channel of channels.data?.items ?? []) if (!byKind.has(channel.kind)) byKind.set(channel.kind, channel);
    const config = new Map((settings.data?.data.notifications.channels ?? []).map((entry) => [entry.kind, entry]));
    return ORDER.map((kind): Row => {
      const entry = config.get(kind);
      const base = { kind, enabled: entry?.enabled ?? null, minPriority: entry?.minPriority ?? null };
      if (kind === "dashboard") {
        const status: ChannelStatus = realtime.state === "online" ? "online" : realtime.state === "offline" ? "offline" : "degraded";
        return { ...base, status, lastSyncAt: realtime.lastEventAt ? new Date(realtime.lastEventAt).toISOString() : null };
      }
      const channel = byKind.get(kind);
      return { ...base, status: channel?.status ?? null, lastSyncAt: channel?.lastSyncAt ?? null, detail: channel?.address };
    });
  }, [channels.data, settings.data, realtime.state, realtime.lastEventAt]);

  const loading = channels.isPending && settings.isPending;
  const degraded = channels.isError
    ? { reason: t("alerts.channels.unavailable"), affected: ORDER.filter((kind) => kind !== "dashboard").map((kind) => t(channelKindKey(kind))) }
    : undefined;

  return (
    <PanelFrame
      title={t("alerts.channels.title")}
      state={loading ? { kind: "loading" } : { kind: "ready", degraded, freshness: channels.data?.freshness }}
      skeletonRows={5}
      className="mk-narrow alr-channels-panel"
    >
      <p className="mk-note alr-channels__intro">{t("alerts.channels.subtitle")}</p>
      <DataBadges sources={channels.data?.sources} className="alr-channels__badges" />
      <ul className="mk-list alr-channels" aria-label={t("alerts.channels.title")}>
        {rows.map((row) => {
          const Icon = CHANNEL_ICON[row.kind];
          const tone = row.status ? CHANNEL_STATUS_TONE[row.status] : "muted";
          return (
            <li key={row.kind} className="mk-row alr-channel">
              <IconTile icon={<Icon size={16} strokeWidth={1.5} />} tone={tone} size="md" />
              <span className="mk-row__main">
                <span className="mk-row__title">{t(channelKindKey(row.kind))}</span>
                <span className="mk-row__meta">
                  {row.minPriority ? <span>{t("alerts.channels.minPriority", { priority: row.minPriority })}</span> : null}
                  {row.enabled === false ? <span>{t("alerts.channels.disabled")}</span> : null}
                  {row.lastSyncAt ? <span title={format.dateTime(row.lastSyncAt)}>{t("alerts.channels.sync", { when: format.relative(row.lastSyncAt) })}</span> : null}
                </span>
              </span>
              <span className="mk-row__side">
                <StatusChip tone={tone}>{row.status ? t(channelStatusKey(row.status)) : t("alerts.channels.unknown")}</StatusChip>
                {row.status === "not_configured" ? (
                  <Button size="sm" variant="ghost" icon={<Settings2 size={13} />} onClick={() => router.push("/settings")}>
                    {t("panel.configureAdapter")}
                  </Button>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </PanelFrame>
  );
}
