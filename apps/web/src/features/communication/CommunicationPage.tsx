"use client";

import type { Channel, Priority } from "@friday/sdk";
import { Button, Drawer, EmptyState, FilterBar, HudPanel, useMediaQuery } from "@friday/ui";
import { MailPlus, MailSearch, MessagesSquare } from "lucide-react";
import { Suspense, useMemo, useState } from "react";
import { PanelFrame, type PanelState } from "@/components/PanelFrame";
import { useT } from "@/i18n";
import { useChannels, useThread, useThreads, type ThreadFilters } from "@/lib/api/domains/communication";
import { PRIORITIES, priorityKey } from "../alerts/labels";
import { CapabilityNote, DataBadges } from "../memory/kit/Badges";
import { useDebounced, useUrlParam } from "../memory/kit/hooks";
import { QueryBoundary } from "../memory/kit/QueryBoundary";
import { effectiveFreshness, usePanelState } from "../memory/kit/panelState";
import { ChannelRail } from "./ChannelRail";
import { channelGroup, partitionChannels } from "./channelList";
import { ComposeDialog } from "./ComposeDialog";
import { THREAD_STATUSES, threadStatusKey, type ThreadStatus } from "./labels";
import { ThreadDetail } from "./ThreadDetail";
import { ThreadRow } from "./ThreadRow";
import { HimalayaMailbox } from "./HimalayaMailbox";
import { MessengerCompose } from "./MessengerCompose";
import { useChannelAccess } from "./useChannelAccess";
import "./communication.css";

const PAGE_SIZE = 50;
type Flag = "all" | "needsReply" | "hasDraft";

export function CommunicationPage() {
  return (
    <Suspense fallback={null}>
      <CommunicationPageInner />
    </Suspense>
  );
}

function CommunicationPageInner() {
  const { t } = useT();
  const [threadId, setThreadId] = useUrlParam("thread");
  const [channelId, setChannelId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState<"all" | Priority>("all");
  const [status, setStatus] = useState<"all" | ThreadStatus>("all");
  const [flag, setFlag] = useState<Flag>("all");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [composing, setComposing] = useState(false);
  const wide = useMediaQuery("(min-width: 1500px)");

  const access = useChannelAccess();
  const term = useDebounced(search.trim(), 250);

  const channels = useChannels();
  const filters: ThreadFilters = {
    limit,
    ...(channelId ? { channelId } : {}),
    ...(priority !== "all" ? { priority: [priority] } : {}),
    ...(status !== "all" ? { status: [status] } : {}),
    ...(flag === "needsReply" ? { needsReply: true } : {}),
    ...(flag === "hasDraft" ? { hasDraft: true } : {}),
    ...(term !== "" ? { q: term } : {}),
  };
  const threads = useThreads(filters);

  const channelItems = useMemo<Channel[]>(() => channels.data?.items ?? [], [channels.data]);
  // Die Kommunikationsnavigation zeigt genau die Standardkanalliste; SMS und weitere Kanaele bleiben in den Daten.
  const partition = useMemo(() => partitionChannels(channelItems), [channelItems]);
  const visibleChannels = partition.visible;
  const channelById = useMemo(() => new Map(channelItems.map((channel) => [channel.id, channel])), [channelItems]);
  const totalUnread = channelItems.reduce((sum, channel) => sum + channel.unreadCount, 0);
  const selectedChannel = channelId ? channelById.get(channelId) : undefined;
  const filtered = priority !== "all" || status !== "all" || flag !== "all" || term !== "" || channelId !== null;

  const degradedChannels = channelItems.filter((channel) => (channelId ? channel.id === channelId : true) && (channel.status === "degraded" || channel.status === "offline"));
  const threadState = usePanelState(threads, {
    module: "communication",
    moduleName: t("nav.communication"),
    adapterId: threads.data?.sources[0]?.adapterId ?? channelItems[0]?.source.adapterId,
    empty: (threads.data?.items.length ?? 0) === 0,
    emptyTitle: filtered ? t("communication.empty.filtered") : t("communication.empty"),
    emptyDescription: filtered ? t("communication.empty.filteredHint") : t("communication.empty.hint"),
    emptyIcon: <MailSearch size={22} strokeWidth={1.5} />,
    degraded:
      degradedChannels.length > 0
        ? { reason: t("communication.degraded"), affected: degradedChannels.map((channel) => `${channel.name} · ${t(`communication.status.${channel.status}` as const)}`) }
        : undefined,
  });
  const channelState: PanelState = usePanelState(channels, { module: "communication", moduleName: t("nav.communication"), adapterId: channelItems[0]?.source.adapterId, empty: channelItems.length === 0, emptyTitle: t("communication.channels.empty"), emptyDescription: t("communication.channels.emptyHint") });

  // One adapter serves channels and threads: when both are unavailable, a single panel (offline / not connected) says it once.
  const blocked = (state: PanelState): boolean => state.kind === "offline" || state.kind === "not-configured" || state.kind === "unsupported";
  const fullOutage = blocked(threadState) && blocked(channelState);
  const notConfigured = threadState.kind === "not-configured" && channelState.kind === "not-configured";
  const detail = useThread(threadId);
  const threadItems = threads.data?.items ?? [];

  const resetFilters = (): void => {
    setSearch("");
    setPriority("all");
    setStatus("all");
    setFlag("all");
    setChannelId(null);
    setLimit(PAGE_SIZE);
  };
  const chips = [
    ...(selectedChannel ? [{ id: "channel", label: selectedChannel.name, onRemove: () => setChannelId(null) }] : []),
    ...(priority !== "all" ? [{ id: "priority", label: priority, onRemove: () => setPriority("all") }] : []),
    ...(status !== "all" ? [{ id: "status", label: t(threadStatusKey(status)), onRemove: () => setStatus("all") }] : []),
    ...(flag !== "all" ? [{ id: "flag", label: flag === "needsReply" ? t("communication.filter.needsReply") : t("communication.filter.hasDraft"), onRemove: () => setFlag("all") }] : []),
  ];

  const detailBody = (
    <QueryBoundary query={detail}>
      {(response) => <ThreadDetail thread={response.data} channel={channelById.get(response.data.channelId)} freshness={response.freshness} />}
    </QueryBoundary>
  );

  return (
    <div className="mk-page com-page">
      {notConfigured ? (
        <HimalayaMailbox autoOpen />
      ) : (
      <HudPanel
        title={t("nav.communication")}
        subtitle={t("page.communication.description")}
        icon={<MessagesSquare size={18} strokeWidth={1.5} />}
        actions={
          <span className="mk-actions">
            <DataBadges sources={threads.data?.sources ?? channels.data?.sources} freshness={effectiveFreshness(threads) ?? effectiveFreshness(channels)} />
            <Button size="sm" icon={<MailPlus size={14} />} disabled={!channelItems.some((channel) => access.canDraftOn(channel))} title={t("communication.compose.hint")} onClick={() => setComposing(true)}>
              {t("communication.compose")}
            </Button>
          </span>
        }
      >
        <div className="mk-stack">
          <CapabilityNote state={access.sendState} readText={t("communication.kit.readOnly")} writeText={t("communication.kit.sendUnavailable")} />
          <FilterBar
            search={{ value: search, onChange: (value) => { setSearch(value); setLimit(PAGE_SIZE); }, placeholder: t("communication.search.placeholder"), label: t("communication.search.label") }}
            filters={[
              { id: "priority", label: t("communication.filter.priority"), value: priority, onChange: (value) => setPriority(value as "all" | Priority), options: [{ value: "all", label: t("communication.filter.anyPriority") }, ...PRIORITIES.map((value) => ({ value, label: `${value} · ${t(priorityKey(value))}` }))] },
              { id: "status", label: t("communication.filter.status"), value: status, onChange: (value) => setStatus(value as "all" | ThreadStatus), options: [{ value: "all", label: t("communication.filter.anyStatus") }, ...THREAD_STATUSES.map((value) => ({ value, label: t(threadStatusKey(value)) }))] },
              { id: "flag", label: t("communication.filter.flag"), value: flag, onChange: (value) => setFlag(value as Flag), options: [{ value: "all", label: t("communication.filter.allThreads") }, { value: "needsReply", label: t("communication.filter.needsReply") }, { value: "hasDraft", label: t("communication.filter.hasDraft") }] },
            ]}
            chips={chips}
            onReset={resetFilters}
            resetLabel={t("memory.filter.reset")}
            resultCount={threadItems.length}
            totalCount={threads.data?.pageInfo.totalCount}
          />
        </div>
      </HudPanel>
      )}
      {!notConfigured && channelGroup(selectedChannel?.kind) === "email" ? <HimalayaMailbox /> : null}
      {!notConfigured && channelGroup(selectedChannel?.kind) === "messenger" ? <MessengerCompose /> : null}

      {notConfigured ? null : (
        <div className={`com-layout${wide && !fullOutage ? " com-layout--wide" : ""}`}>
          {fullOutage ? null : <ChannelRail channels={visibleChannels} hiddenCount={partition.hidden.length} state={channelState} selectedId={channelId} totalUnread={totalUnread} onSelect={(id) => { setChannelId(id); setLimit(PAGE_SIZE); }} compact={!wide} />}
          <PanelFrame title={t("communication.threads.title")} state={threadState} skeletonRows={6} className="com-threads-panel">
            <ul className="mk-list com-threads" aria-label={t("communication.threads.title")}>
              {threadItems.map((thread) => (
                <ThreadRow key={thread.id} thread={thread} channel={channelById.get(thread.channelId)} selected={thread.id === threadId} onOpen={(id) => setThreadId(id, { push: true })} />
              ))}
            </ul>
            {threads.data?.pageInfo.hasNextPage ? (
              <div className="mk-more">
                <Button variant="ghost" size="sm" loading={threads.isFetching} onClick={() => setLimit((current) => current + PAGE_SIZE)}>
                  {t("memory.kit.more")}
                </Button>
              </div>
            ) : null}
          </PanelFrame>
          {wide && !fullOutage ? (
            <HudPanel title={t("communication.detail.title")} level={threadId ? 2 : 1} className="com-detail-panel" bodyClassName="com-detail-panel__body">
              {threadId ? detailBody : <EmptyState compact icon={<MailSearch size={22} strokeWidth={1.5} />} title={t("communication.detail.empty")} description={t("communication.detail.emptyHint")} />}
            </HudPanel>
          ) : null}
        </div>
      )}

      {!wide && !fullOutage ? (
        <Drawer open={threadId !== null} onOpenChange={(open) => { if (!open) setThreadId(null); }} title={detail.data?.data.subject ?? t("communication.detail.title")} closeLabel={t("common.close")} width={680}>
          {detailBody}
        </Drawer>
      ) : null}
      <ComposeDialog open={composing} onOpenChange={setComposing} channels={visibleChannels} channelId={channelId ?? undefined} />
    </div>
  );
}
