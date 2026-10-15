"use client";

import type { Channel } from "@friday/sdk";
import { Badge, Button, IconTile, StatusChip } from "@friday/ui";
import { Check, Inbox, Minus, Settings2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { PanelFrame, type PanelState } from "@/components/PanelFrame";
import { useT } from "@/i18n";
import { CHANNEL_ICON, CHANNEL_STATUS_TONE, channelStatusKey } from "../memory/kit/channelStatus";
import { useFormat } from "../memory/kit/hooks";

export interface ChannelRailProps {
  channels: readonly Channel[];
  state: PanelState;
  selectedId: string | null;
  totalUnread: number;
  onSelect: (id: string | null) => void;
  /** Horizontal strip for tablet widths. */
  compact?: boolean;
}

function Capability({ label, allowed }: { label: string; allowed: boolean }) {
  return (
    <span className={`com-cap${allowed ? " com-cap--on" : ""}`}>
      {allowed ? <Check size={11} strokeWidth={2} aria-hidden="true" /> : <Minus size={11} strokeWidth={2} aria-hidden="true" />}
      {label}
    </span>
  );
}

/** Channel list with the status vocabulary of PLAN §33.4 and what each channel may do (read / draft / send). */
export function ChannelRail({ channels, state, selectedId, totalUnread, onSelect, compact }: ChannelRailProps) {
  const { t } = useT();
  const router = useRouter();
  const format = useFormat();
  return (
    <PanelFrame title={t("communication.channels.title")} state={state} skeletonRows={4} className={`mk-narrow com-rail${compact ? " com-rail--compact" : ""}`}>
      <ul className="mk-list com-channels" aria-label={t("communication.channels.title")}>
        <li>
          <button type="button" className={`mk-row com-channel${selectedId === null ? " mk-row--selected" : ""}`} aria-pressed={selectedId === null} onClick={() => onSelect(null)}>
            <IconTile icon={<Inbox size={16} strokeWidth={1.5} />} tone="cyan" size="md" />
            <span className="mk-row__main">
              <span className="mk-row__title">{t("communication.channels.all")}</span>
              <span className="mk-row__meta">{t("communication.channels.allHint")}</span>
            </span>
            {totalUnread > 0 ? <Badge count={totalUnread} label={t("communication.unread", { count: totalUnread })} /> : null}
          </button>
        </li>
        {channels.map((channel) => {
          const Icon = CHANNEL_ICON[channel.kind];
          const tone = CHANNEL_STATUS_TONE[channel.status];
          const selected = selectedId === channel.id;
          return (
            <li key={channel.id}>
              <button type="button" className={`mk-row com-channel${selected ? " mk-row--selected" : ""}`} aria-pressed={selected} onClick={() => onSelect(selected ? null : channel.id)} data-channel-status={channel.status}>
                <IconTile icon={<Icon size={16} strokeWidth={1.5} />} tone={tone} size="md" />
                <span className="mk-row__main">
                  <span className="mk-row__title">{channel.name}</span>
                  <span className="mk-row__meta">
                    <StatusChip tone={tone}>{t(channelStatusKey(channel.status))}</StatusChip>
                    {channel.lastSyncAt ? <span title={format.dateTime(channel.lastSyncAt)}>{t("communication.channels.sync", { when: format.relative(channel.lastSyncAt) })}</span> : null}
                  </span>
                  <span className="com-caps" aria-label={t("communication.channels.capabilities")}>
                    <Capability label={t("communication.cap.read")} allowed={channel.capabilities.read} />
                    <Capability label={t("communication.cap.draft")} allowed={channel.capabilities.draft} />
                    <Capability label={t("communication.cap.send")} allowed={channel.capabilities.send} />
                  </span>
                  {channel.status === "read_only" ? <span className="mk-note com-channel__note">{t("communication.channels.readOnlyNote")}</span> : null}
                  {channel.status === "degraded" ? <span className="mk-note com-channel__note">{t("communication.channels.degradedNote")}</span> : null}
                  {channel.status === "offline" ? <span className="mk-note com-channel__note">{t("communication.channels.offlineNote")}</span> : null}
                </span>
                {channel.unreadCount > 0 ? <Badge count={channel.unreadCount} label={t("communication.unread", { count: channel.unreadCount })} /> : null}
              </button>
              {channel.status === "not_configured" || channel.status === "offline" ? (
                <div className="com-channel__action">
                  <Button size="sm" variant="ghost" icon={<Settings2 size={13} />} onClick={() => router.push(`/settings?adapter=${encodeURIComponent(channel.source.adapterId)}`)}>
                    {t("panel.configureAdapter")}
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </PanelFrame>
  );
}
