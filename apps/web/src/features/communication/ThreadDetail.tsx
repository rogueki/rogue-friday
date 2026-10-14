"use client";

import type { Channel, Message, Thread } from "@jarvis/sdk";
import { Button, IconTile, Skeleton, StatusChip, TagPill, useToast } from "@jarvis/ui";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, FileText, ListChecks, Paperclip, Reply, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "@/i18n";
import { useCapability } from "@/lib/capabilities";
import { seedDraftCache, useCachedDraft, useCreateDraft, useDrafts } from "@/lib/api/domains/communication";
import { PRIORITY_TONE, priorityKey } from "../alerts/labels";
import { DataBadges } from "../memory/kit/Badges";
import { CHANNEL_ICON, CHANNEL_STATUS_TONE, channelKindKey, channelStatusKey } from "../memory/kit/channelStatus";
import { useFormat } from "../memory/kit/hooks";
import { DraftEditor } from "./DraftEditor";
import { formatBytes, THREAD_STATUS_TONE, threadStatusKey } from "./labels";
import { useChannelAccess } from "./useChannelAccess";

export interface ThreadDetailProps {
  thread: Thread;
  channel: Channel | undefined;
  freshness?: { state: "fresh" | "stale" | "unknown" | "offline-cache"; asOf: string | null };
}

/** E-mail / message detail of PLAN §33.3: thread, attachments, AI summary, extracted dates and tasks, suggested reply, send approval, source. */
export function ThreadDetail({ thread, channel, freshness }: ThreadDetailProps) {
  const { t } = useT();
  const format = useFormat();
  const router = useRouter();
  const messages = thread.messages ?? [];
  const ChannelIcon = CHANNEL_ICON[thread.channelKind];
  return (
    <div className="mk-stack com-detail" data-thread-id={thread.id}>
      <header className="com-detail__head">
        <IconTile icon={<ChannelIcon size={18} strokeWidth={1.5} />} tone={channel ? CHANNEL_STATUS_TONE[channel.status] : "cyan"} size="md" />
        <div className="com-detail__headtext">
          <h2 className="com-detail__subject">{thread.subject}</h2>
          <div className="mk-actions">
            <TagPill tone={PRIORITY_TONE[thread.priority]}>
              {thread.priority} · {t(priorityKey(thread.priority))}
            </TagPill>
            <StatusChip tone={THREAD_STATUS_TONE[thread.status]}>{t(threadStatusKey(thread.status))}</StatusChip>
            <TagPill tone="muted">{channel?.name ?? t(channelKindKey(thread.channelKind))}</TagPill>
            {channel ? <StatusChip tone={CHANNEL_STATUS_TONE[channel.status]}>{t(channelStatusKey(channel.status))}</StatusChip> : null}
            {thread.needsReply ? <StatusChip tone="amber">{t("communication.needsReply")}</StatusChip> : null}
          </div>
        </div>
      </header>

      <dl className="mk-dl">
        <dt>{t("communication.field.participants")}</dt>
        <dd>
          {thread.participants.map((participant) => (
            <span key={participant.address} className="com-person">
              {participant.name} <span className="mk-mono">{participant.address}</span>
            </span>
          ))}
        </dd>
        <dt>{t("communication.field.deadline")}</dt>
        <dd>{thread.deadline ? format.dateTime(thread.deadline) : t("communication.none")}</dd>
        <dt>{t("communication.field.linkedTask")}</dt>
        <dd>
          {thread.linkedTaskId ? (
            <button type="button" className="mk-link" onClick={() => router.push(`/tasks?task=${encodeURIComponent(thread.linkedTaskId ?? "")}`)}>
              {thread.linkedTaskId}
            </button>
          ) : (
            t("communication.none")
          )}
        </dd>
        <dt>{t("communication.field.source")}</dt>
        <dd>
          <DataBadges sources={[thread.source]} freshness={freshness} />
        </dd>
      </dl>

      <section aria-labelledby={`sum-${thread.id}`}>
        <h3 className="mk-section-title" id={`sum-${thread.id}`}>
          <Sparkles size={12} strokeWidth={1.5} aria-hidden="true" /> {t("communication.summary")}
        </h3>
        <div className="mk-block">
          <p>{thread.summary ?? t("communication.summary.none")}</p>
        </div>
      </section>

      {thread.extractedEvents.length > 0 || thread.extractedTasks.length > 0 ? (
        <div className="mk-grid-2 com-extracted">
          <section>
            <h3 className="mk-section-title">
              <CalendarDays size={12} strokeWidth={1.5} aria-hidden="true" /> {t("communication.extracted.events")}
            </h3>
            {thread.extractedEvents.length === 0 ? (
              <p className="mk-note">{t("communication.none")}</p>
            ) : (
              <ul className="mk-list">
                {thread.extractedEvents.map((event) => (
                  <li key={`${event.title}:${event.start}`} className="mk-block com-extract">
                    <span className="mk-strong">{event.title}</span>
                    <span className="mk-muted">
                      {format.dateTime(event.start)}
                      {event.end ? ` – ${format.time(event.end)}` : ""}
                    </span>
                    <button type="button" className="mk-link" onClick={() => router.push(`/calendar?date=${encodeURIComponent(event.start.slice(0, 10))}`)}>
                      {t("communication.extracted.openCalendar")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h3 className="mk-section-title">
              <ListChecks size={12} strokeWidth={1.5} aria-hidden="true" /> {t("communication.extracted.tasks")}
            </h3>
            {thread.extractedTasks.length === 0 ? (
              <p className="mk-note">{t("communication.none")}</p>
            ) : (
              <ul className="mk-list">
                {thread.extractedTasks.map((task) => (
                  <li key={`${task.title}:${task.dueAt ?? ""}`} className="mk-block com-extract">
                    <span className="mk-strong">{task.title}</span>
                    <span className="mk-muted">{task.dueAt ? t("communication.extracted.due", { when: format.dateTime(task.dueAt) }) : t("communication.extracted.noDue")}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}

      <section>
        <h3 className="mk-section-title">{t("communication.messages", { count: messages.length })}</h3>
        {messages.length === 0 ? (
          <p className="mk-note">{t("communication.messages.none")}</p>
        ) : (
          <ol className="mk-list com-messages">
            {messages.map((message) => (
              <MessageItem key={message.id} message={message} />
            ))}
          </ol>
        )}
      </section>

      <ReplySection thread={thread} channel={channel} />
    </div>
  );
}

function MessageItem({ message }: { message: Message }) {
  const { t, locale } = useT();
  const format = useFormat();
  const inbound = message.direction === "inbound";
  return (
    <li className={`com-message com-message--${message.direction}`}>
      <div className="com-message__head">
        <span className="mk-strong">
          {message.from.name} <span className="mk-mono">{message.from.address}</span>
        </span>
        <span className="mk-muted com-message__time">
          {inbound ? t("communication.inbound") : t("communication.outbound")} · {format.dateTime(message.sentAt)}
        </span>
      </div>
      <p className="com-message__body">{message.bodyText}</p>
      {message.aiSummary ? (
        <p className="com-message__ai">
          <Sparkles size={12} strokeWidth={1.5} aria-hidden="true" /> {message.aiSummary}
        </p>
      ) : null}
      {message.attachments.length > 0 ? (
        <ul className="mk-tags com-attachments" aria-label={t("communication.attachments")}>
          {message.attachments.map((attachment) => (
            <li key={attachment.id}>
              <TagPill tone="blue" icon={attachment.mimeType.includes("pdf") ? <FileText size={11} aria-hidden="true" /> : <Paperclip size={11} aria-hidden="true" />}>
                {attachment.name} · {formatBytes(attachment.sizeBytes, locale === "de" ? "de-DE" : "en-GB")}
              </TagPill>
            </li>
          ))}
        </ul>
      ) : null}
      {message.originalRef ? <p className="mk-mono">{t("communication.original", { ref: message.originalRef })}</p> : null}
    </li>
  );
}

function ReplySection({ thread, channel }: { thread: Thread; channel: Channel | undefined }) {
  const { t } = useT();
  // Drafts created here show up immediately, even before the refreshed thread lists them in `draftIds`.
  const [createdIds, setCreatedIds] = useState<string[]>([]);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const access = useChannelAccess();
  const create = useCreateDraft();
  const canDraft = access.canDraftOn(channel);
  const messages = thread.messages ?? [];
  const lastInbound = messages.filter((message) => message.direction === "inbound").at(-1);
  const recipient = lastInbound?.from ?? thread.participants.find((participant) => participant.role !== "owner");

  const takeSuggestion = (): void => {
    if (!thread.suggestedReply || !recipient) return;
    create.mutate(
      {
        channelId: thread.channelId,
        threadId: thread.id,
        to: [recipient],
        subject: thread.subject.toLowerCase().startsWith("re:") ? thread.subject : `Re: ${thread.subject}`,
        body: thread.suggestedReply,
        ...(lastInbound ? { replyToMessageId: lastInbound.id } : {}),
      },
      {
        onSuccess: (response) => {
          seedDraftCache(queryClient, response);
          setCreatedIds((ids) => (ids.includes(response.data.id) ? ids : [...ids, response.data.id]));
          toast({ title: t("communication.draftCreated"), description: t("communication.draftCreated.description"), tone: "green" });
        },
      },
    );
  };

  return (
    <section className="mk-stack">
      <h3 className="mk-section-title">
        <Reply size={12} strokeWidth={1.5} aria-hidden="true" /> {t("communication.reply")}
      </h3>
      {thread.suggestedReply ? (
        <div className="mk-block">
          <p className="mk-muted com-suggestion__label">{t("communication.suggestedReply")}</p>
          <p className="com-suggestion">{thread.suggestedReply}</p>
          <div className="mk-actions com-suggestion__actions">
            <Button size="sm" icon={<Reply size={14} />} disabled={!canDraft || !recipient} loading={create.isPending} title={!canDraft ? t("communication.draft.unavailable") : undefined} onClick={takeSuggestion}>
              {t("communication.takeSuggestion")}
            </Button>
            {!canDraft ? <span className="mk-note">{t("communication.draft.unavailable")}</span> : null}
          </div>
        </div>
      ) : (
        <p className="mk-note">{t("communication.suggestedReply.none")}</p>
      )}
      <ThreadDrafts threadId={thread.id} draftIds={Array.from(new Set([...thread.draftIds, ...createdIds]))} channel={channel} />
    </section>
  );
}

/**
 * The drafts of a thread come from `GET /communication/drafts?threadId=` (capability `communication.draft`). Ids the thread
 * mentions but the list does not return (older adapters, a failed request) fall back to the cached draft or a note.
 */
function ThreadDrafts({ threadId, draftIds, channel }: { threadId: string; draftIds: readonly string[]; channel: Channel | undefined }) {
  const { t } = useT();
  const canList = useCapability("communication", "draft");
  const list = useDrafts({ threadId, limit: 50 }, canList);
  const listed = canList ? (list.data?.items ?? []) : [];
  const listedIds = new Set(listed.map((draft) => draft.id));
  const missing = draftIds.filter((id) => !listedIds.has(id));
  if (canList && list.isPending && draftIds.length > 0) return <Skeleton lines={3} />;
  if (listed.length === 0 && missing.length === 0) return null;
  return (
    <>
      {canList && list.isError && list.data === undefined ? (
        <p className="mk-block mk-block--amber mk-note" role="alert">
          {t("communication.draft.listError")}{" "}
          <button type="button" className="mk-link" onClick={() => void list.refetch()}>
            {t("common.retry")}
          </button>
        </p>
      ) : null}
      <ul className="mk-list" aria-label={t("communication.drafts")}>
        {listed.map((draft) => (
          <li key={draft.id} className="mk-block">
            <DraftEditor key={`${draft.id}:${draft.version}`} draft={draft} channel={channel} />
          </li>
        ))}
        {missing.map((id) => (
          <li key={id}>
            <CachedDraft id={id} channel={channel} />
          </li>
        ))}
      </ul>
    </>
  );
}

function CachedDraft({ id, channel }: { id: string; channel: Channel | undefined }) {
  const { t } = useT();
  const query = useCachedDraft(id);
  if (!query.data) {
    return (
      <div className="mk-block">
        <p className="mk-strong">{t("communication.draft.remote")}</p>
        <p className="mk-note">{t("communication.draft.remoteHint")}</p>
        <p className="mk-mono">{id}</p>
      </div>
    );
  }
  return (
    <div className="mk-block">
      <DraftEditor key={`${query.data.data.id}:${query.data.data.version}`} draft={query.data.data} channel={channel} />
    </div>
  );
}
