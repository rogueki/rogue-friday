"use client";

import type { Channel, Thread } from "@friday/sdk";
import { Badge, IconTile, StatusChip, TagPill } from "@friday/ui";
import { CalendarClock, FilePenLine, Link2, MessageSquare } from "lucide-react";
import { useT } from "@/i18n";
import { PRIORITY_TONE } from "../alerts/labels";
import { CHANNEL_ICON, CHANNEL_STATUS_TONE } from "../memory/kit/channelStatus";
import { useFormat } from "../memory/kit/hooks";
import { participantNames, THREAD_STATUS_TONE, threadStatusKey } from "./labels";

export interface ThreadRowProps {
  thread: Thread;
  channel: Channel | undefined;
  selected: boolean;
  onOpen: (id: string) => void;
}

/** Unified-inbox row (PLAN §33.2): priority, channel, sender, subject, summary, reply needed, draft, deadline, linked task, status. */
export function ThreadRow({ thread, channel, selected, onOpen }: ThreadRowProps) {
  const { t } = useT();
  const format = useFormat();
  const Icon = CHANNEL_ICON[thread.channelKind];
  const unread = thread.unreadCount > 0;
  return (
    <li>
      <button
        type="button"
        className={`mk-row com-thread com-thread--${PRIORITY_TONE[thread.priority]}${selected ? " mk-row--selected" : ""}${unread ? " com-thread--unread" : ""}`}
        aria-current={selected ? "true" : undefined}
        onClick={() => onOpen(thread.id)}
        data-thread-id={thread.id}
      >
        <IconTile icon={<Icon size={16} strokeWidth={1.5} />} tone={channel ? CHANNEL_STATUS_TONE[channel.status] : "cyan"} size="md" />
        <span className="mk-row__main">
          <span className="com-thread__top">
            <TagPill tone={PRIORITY_TONE[thread.priority]}>{thread.priority}</TagPill>
            <span className="com-thread__from">{participantNames(thread) || thread.participants[0]?.name}</span>
          </span>
          <span className="mk-row__title">{thread.subject}</span>
          {thread.summary ? <span className="mk-row__text">{thread.summary}</span> : null}
          <span className="mk-row__meta">
            <StatusChip tone={THREAD_STATUS_TONE[thread.status]}>{t(threadStatusKey(thread.status))}</StatusChip>
            {thread.needsReply ? <StatusChip tone="amber">{t("communication.needsReply")}</StatusChip> : null}
            {thread.hasDraft ? (
              <span className="com-thread__flag">
                <FilePenLine size={12} strokeWidth={1.5} aria-hidden="true" /> {t("communication.hasDraft")}
              </span>
            ) : null}
            {thread.deadline ? (
              <span className="com-thread__flag" title={format.dateTime(thread.deadline)}>
                <CalendarClock size={12} strokeWidth={1.5} aria-hidden="true" /> {t("communication.deadline", { when: format.date(thread.deadline) })}
              </span>
            ) : null}
            {thread.linkedTaskId ? (
              <span className="com-thread__flag">
                <Link2 size={12} strokeWidth={1.5} aria-hidden="true" /> {t("communication.linkedTask")}
              </span>
            ) : null}
            <span className="com-thread__flag">
              <MessageSquare size={12} strokeWidth={1.5} aria-hidden="true" /> {thread.messageCount}
            </span>
          </span>
        </span>
        <span className="mk-row__side">
          <span title={format.dateTime(thread.lastMessageAt)}>{format.relative(thread.lastMessageAt)}</span>
          {unread ? <Badge count={thread.unreadCount} label={t("communication.unread", { count: thread.unreadCount })} /> : null}
        </span>
      </button>
    </li>
  );
}
