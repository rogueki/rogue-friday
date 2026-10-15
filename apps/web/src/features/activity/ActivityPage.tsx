"use client";

import type { ActivityEvent } from "@friday/sdk";
import { ActivityRow, Button, FilterBar, LivePill, Switch, TagPill, type FilterChip, type FilterDef } from "@friday/ui";
import { ChevronDown, ChevronRight, ListTree, Pause, Play, Rows3 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PanelFrame } from "@/components/PanelFrame";
import { DataOrigin, DateFormatterProvider, resolvePanelState, SegmentedControl, useDateFormatter, useModuleSection, useQueryParams } from "@/features/tasks/moduleKit";
import { useModulePanelGate } from "@/features/shared/useAvailability";
import { useT, type MessageKey } from "@/i18n";
import { useAgents } from "@/lib/api/domains/agents";
import { useRealtimeStatus } from "@/lib/realtime/store";
import { ActivityDrawer } from "./ActivityDrawer";
import { VirtualList } from "./VirtualList";
import { ACTIVITY_STATUSES, EMPTY_FILTERS, KIND_ICON, KIND_TONE, SEVERITIES, SEVERITY_TONE, STATUS_TONE, TIME_RANGES, buildActivityTree, fallbackKindIcon, isFiltered, type ActivityFilterState, type ActivityRowModel, type TimeRange } from "./model";
import { useActivityBuffer } from "./useActivityBuffer";
import "./activity.css";

const ROW_HEIGHT = 58;
const ACTIVITY_SECTIONS = ["activity", "Live-Aktivität"] as const;
type FeedView = "list" | "tree";

const sortedDistinct = (values: Iterable<string | null | undefined>): string[] => [...new Set([...values].filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b));
const shortId = (id: string): string => (id.length > 14 ? `…${id.slice(-8)}` : id);

interface FeedRowProps {
  event: ActivityEvent;
  agentNames: ReadonlyMap<string, string>;
  selected: boolean;
  onSelect: (id: string) => void;
  depth?: number;
  toggle?: ToggleModel;
}
type ToggleModel = { childCount: number; collapsed: boolean; onToggle: () => void } | null;

function FeedRow({ event, agentNames, selected, onSelect, depth, toggle }: FeedRowProps) {
  const { t } = useT();
  const format = useDateFormatter();
  const agent = event.agentId ? (agentNames.get(event.agentId) ?? shortId(event.agentId)) : null;
  const meta = [
    t(`activity.kind.${event.kind}` as MessageKey),
    agent,
    event.tool,
    event.adapterId ?? event.source.adapterId,
    event.model,
    event.taskId ? shortId(event.taskId) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const tree = depth !== undefined;
  return (
    <div
      className="ac-row"
      role={tree ? "treeitem" : undefined}
      aria-level={tree ? depth + 1 : undefined}
      aria-expanded={tree && toggle && toggle.childCount > 0 ? !toggle.collapsed : undefined}
      aria-selected={tree ? selected : undefined}
      style={tree ? { paddingLeft: depth * 22 } : undefined}
    >
      {tree ? (
        toggle && toggle.childCount > 0 ? (
          <button type="button" className="ac-row__toggle" onClick={toggle.onToggle} aria-label={t(toggle.collapsed ? "activity.tree.expand" : "activity.tree.collapse", { count: toggle.childCount })} aria-expanded={!toggle.collapsed}>
            {toggle.collapsed ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
          </button>
        ) : (
          <span className="ac-row__toggle ac-row__toggle--leaf" aria-hidden="true" />
        )
      ) : null}
      <ActivityRow
        data-row-focus=""
        className="ac-row__main"
        icon={KIND_ICON[event.kind] ?? fallbackKindIcon}
        tone={KIND_TONE[event.kind]}
        title={event.title}
        meta={event.error ? `${event.error.message} · ${meta}` : meta}
        selected={selected}
        action={
          <span className="ac-side">
            <TagPill tone={SEVERITY_TONE[event.severity]}>{t(`activity.severity.${event.severity}` as MessageKey)}</TagPill>
            <span className={`ac-side__status jv-tone-${STATUS_TONE[event.status]}`}>{t(`activity.status.${event.status}` as MessageKey)}</span>
          </span>
        }
        time={`${format.time(event.occurredAt)}${event.durationMs !== null ? ` · ${format.duration(event.durationMs)}` : ""}`}
        onClick={() => onSelect(event.id)}
      />
      {tree && toggle && toggle.childCount > 0 && toggle.collapsed ? <span className="ac-row__hidden">{t("activity.tree.hidden", { count: toggle.childCount })}</span> : null}
    </div>
  );
}

/** Live Activity (PLAN §29): realtime feed or activity tree, eight filters, pause, autoscroll, detail drawer. */
function ActivityPageContent() {
  const { t } = useT();
  const { get: getParam, set: setParams } = useQueryParams();
  const eventId = getParam("event");
  const [view, setView] = useState<FeedView>("list");
  const [filters, setFilters] = useState<ActivityFilterState>(EMPTY_FILTERS);
  // Deep links from other pages ("Open Activity" on an agent, "zur Aktivität" on a task) preset a filter once.
  const agentParam = getParam("agent");
  const taskParam = getParam("task");
  useEffect(() => {
    if (!agentParam && !taskParam) return;
    setFilters((previous) => {
      const next = { ...previous, ...(agentParam ? { agentId: agentParam } : {}), ...(taskParam ? { taskId: taskParam } : {}) };
      return next.agentId === previous.agentId && next.taskId === previous.taskId ? previous : next;
    });
    setParams({ agent: null, task: null });
  }, [agentParam, taskParam, setParams]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const section = useModuleSection(ACTIVITY_SECTIONS);
  const stream = useRealtimeStatus();
  const buffer = useActivityBuffer(filters);
  const agents = useAgents({ limit: 200 });

  const agentNames = useMemo(() => new Map((agents.data?.items ?? []).map((agent) => [agent.id, agent.name])), [agents.data]);
  const setFilter = useCallback(<K extends keyof ActivityFilterState>(key: K, value: ActivityFilterState[K]) => setFilters((previous) => ({ ...previous, [key]: value })), []);

  const options = useMemo(
    () => ({
      agents: sortedDistinct(buffer.all.map((event) => event.agentId)),
      tasks: sortedDistinct(buffer.all.map((event) => event.taskId)),
      tools: sortedDistinct(buffer.all.map((event) => event.tool)),
      adapters: sortedDistinct(buffer.all.map((event) => event.adapterId ?? event.source.adapterId)),
      models: sortedDistinct(buffer.all.map((event) => event.model)),
    }),
    [buffer.all],
  );

  const all = { value: "", label: t("activity.filter.all") };
  const filterDefs: FilterDef[] = [
    { id: "agent", label: t("activity.filter.agent"), value: filters.agentId, onChange: (v) => setFilter("agentId", v), options: [{ ...all, label: t("activity.filter.allAgents") }, ...options.agents.map((id) => ({ value: id, label: agentNames.get(id) ?? shortId(id) }))] },
    { id: "task", label: t("activity.filter.task"), value: filters.taskId, onChange: (v) => setFilter("taskId", v), options: [{ ...all, label: t("activity.filter.allTasks") }, ...options.tasks.map((id) => ({ value: id, label: shortId(id) }))] },
    { id: "tool", label: t("activity.filter.tool"), value: filters.tool, onChange: (v) => setFilter("tool", v), options: [{ ...all, label: t("activity.filter.allTools") }, ...options.tools.map((id) => ({ value: id, label: id }))] },
    { id: "adapter", label: t("activity.filter.adapter"), value: filters.adapterId, onChange: (v) => setFilter("adapterId", v), options: [{ ...all, label: t("activity.filter.allAdapters") }, ...options.adapters.map((id) => ({ value: id, label: id }))] },
    { id: "severity", label: t("activity.filter.severity"), value: filters.severity, onChange: (v) => setFilter("severity", v), options: [{ ...all, label: t("activity.filter.allSeverities") }, ...SEVERITIES.map((id) => ({ value: id, label: t(`activity.severity.${id}` as MessageKey) }))] },
    { id: "model", label: t("activity.filter.model"), value: filters.model, onChange: (v) => setFilter("model", v), options: [{ ...all, label: t("activity.filter.allModels") }, ...options.models.map((id) => ({ value: id, label: id }))] },
    { id: "status", label: t("activity.filter.status"), value: filters.status, onChange: (v) => setFilter("status", v), options: [{ ...all, label: t("activity.filter.allStatus") }, ...ACTIVITY_STATUSES.map((id) => ({ value: id, label: t(`activity.status.${id}` as MessageKey) }))] },
    { id: "range", label: t("activity.filter.range"), value: filters.range, onChange: (v) => setFilter("range", v as TimeRange), options: TIME_RANGES.map((id) => ({ value: id, label: t(`activity.range.${id}` as MessageKey) })) },
  ];
  const chip = (id: keyof ActivityFilterState, label: string, value: string): FilterChip[] =>
    value && value !== EMPTY_FILTERS[id] ? [{ id, label: `${label}: ${value}`, onRemove: () => setFilter(id, EMPTY_FILTERS[id] as never) }] : [];
  const chips: FilterChip[] = [
    ...chip("q", t("activity.filter.search"), filters.q),
    ...chip("agentId", t("activity.filter.agent"), agentNames.get(filters.agentId) ?? filters.agentId),
    ...chip("taskId", t("activity.filter.task"), shortId(filters.taskId)),
    ...chip("tool", t("activity.filter.tool"), filters.tool),
    ...chip("adapterId", t("activity.filter.adapter"), filters.adapterId),
    ...chip("severity", t("activity.filter.severity"), filters.severity ? t(`activity.severity.${filters.severity}` as MessageKey) : ""),
    ...chip("model", t("activity.filter.model"), filters.model),
    ...chip("status", t("activity.filter.status"), filters.status ? t(`activity.status.${filters.status}` as MessageKey) : ""),
    ...chip("range", t("activity.filter.range"), filters.range === "all" ? "" : t(`activity.range.${filters.range}` as MessageKey)),
  ];

  const treeRows = useMemo<ActivityRowModel[]>(() => (view === "tree" ? buildActivityTree(buffer.events, collapsed) : []), [view, buffer.events, collapsed]);
  const toggleNode = useCallback(
    (id: string) =>
      setCollapsed((previous) => {
        const next = new Set(previous);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );
  const selectEvent = useCallback((id: string) => setParams({ event: id }, "push"), [setParams]);

  const gate = useModulePanelGate("activity", { moduleName: t("nav.activity"), error: buffer.error, hasData: buffer.hasData, onRetry: buffer.refetch });
  const state = resolvePanelState({
    pending: buffer.loading,
    error: buffer.error,
    hasData: buffer.hasData,
    empty: buffer.hasData && buffer.all.length === 0 && !isFiltered(filters),
    emptyState: { title: t("activity.empty.title"), description: t("activity.empty.hint") },
    gate,
    section,
    freshness: buffer.freshness,
    onRetry: buffer.refetch,
    retrying: buffer.refetching,
    refreshFailedLabel: t("activity.refreshFailed"),
  });

  const live = stream.state === "online" || stream.state === "degraded";
  const streamLabel = buffer.paused ? t("activity.stream.paused") : t(`activity.stream.${stream.state}` as MessageKey);
  const filteredEmpty = state.kind === "ready" && buffer.events.length === 0;

  return (
    <div className="web-page ac-page">
      <PanelFrame
        state={state}
        title={t("nav.activity")}
        subtitle={t("page.activity.description")}
        className="web-page__panel ac-panel"
        bodyClassName="ac-panel__body"
        padding="md"
        actions={
          <>
            {live && !buffer.paused ? <LivePill label={t("activity.live")} /> : <TagPill tone={buffer.paused ? "amber" : "muted"}>{streamLabel}</TagPill>}
            <DataOrigin sources={buffer.sources} freshness={buffer.freshness} />
          </>
        }
        skeletonRows={8}
      >
        <div className="ac-toolbar">
          <SegmentedControl
            label={t("activity.view.label")}
            value={view}
            onChange={setView}
            options={[
              { value: "list", label: t("activity.view.list"), icon: <Rows3 size={14} /> },
              { value: "tree", label: t("activity.view.tree"), icon: <ListTree size={14} /> },
            ]}
          />
          <Button size="sm" variant={buffer.paused ? "primary" : "ghost"} icon={buffer.paused ? <Play size={14} /> : <Pause size={14} />} aria-pressed={buffer.paused} onClick={buffer.paused ? buffer.resume : buffer.pause}>
            {buffer.paused ? (buffer.pending > 0 ? t("activity.resumeNew", { count: buffer.pending }) : t("activity.resume")) : t("activity.pause")}
          </Button>
          <Switch label={t("activity.autoscroll")} checked={autoScroll && !buffer.paused} disabled={buffer.paused} onCheckedChange={setAutoScroll} stateLabels={[t("activity.on"), t("activity.off")]} />
          <DataOrigin slot="body" sources={buffer.sources} freshness={buffer.freshness} />
          <span className="ac-toolbar__count" aria-live="polite">
            {t("activity.count", { shown: buffer.events.length, loaded: buffer.all.length })}
            {buffer.historyLoading ? ` · ${t("activity.historyLoading")}` : ""}
          </span>
        </div>
        <FilterBar
          className="ac-filters"
          search={{ value: filters.q, onChange: (v) => setFilter("q", v), placeholder: t("activity.filter.searchPlaceholder"), label: t("activity.filter.search") }}
          filters={filterDefs}
          chips={chips}
          onReset={() => setFilters(EMPTY_FILTERS)}
          resetLabel={t("activity.filter.reset")}
        />
        {filteredEmpty ? (
          <div className="ac-empty">
            <p>{t("activity.empty.filtered")}</p>
            <Button size="sm" variant="ghost" onClick={() => setFilters(EMPTY_FILTERS)}>
              {t("activity.filter.reset")}
            </Button>
          </div>
        ) : view === "list" ? (
          <VirtualList
            items={buffer.events}
            getKey={(event) => event.id}
            rowHeight={ROW_HEIGHT}
            label={t("activity.list.label")}
            autoScroll={autoScroll && !buffer.paused}
            onUserScroll={() => setAutoScroll(false)}
            onEndReached={buffer.hasMore ? buffer.loadMore : undefined}
            renderRow={(event) => <FeedRow event={event} agentNames={agentNames} selected={eventId === event.id} onSelect={selectEvent} />}
          />
        ) : (
          <VirtualList
            role="tree"
            items={treeRows}
            getKey={(row) => row.event.id}
            rowHeight={ROW_HEIGHT}
            label={t("activity.tree.label")}
            autoScroll={autoScroll && !buffer.paused}
            onUserScroll={() => setAutoScroll(false)}
            onEndReached={buffer.hasMore ? buffer.loadMore : undefined}
            renderRow={(row) => (
              <FeedRow
                event={row.event}
                agentNames={agentNames}
                selected={eventId === row.event.id}
                onSelect={selectEvent}
                depth={row.depth}
                toggle={{ childCount: row.childCount, collapsed: row.collapsed, onToggle: () => toggleNode(row.event.id) }}
              />
            )}
          />
        )}
        {buffer.hasMore || buffer.loadMoreError ? (
          <div className="ac-more">
            {buffer.loadMoreError ? <span className="jv-tone-red ac-more__error">{t("activity.loadMoreError")}</span> : null}
            <Button size="sm" variant="ghost" loading={buffer.loadingMore} onClick={buffer.loadMore}>
              {t("activity.loadMore")}
            </Button>
          </div>
        ) : null}
      </PanelFrame>
      <ActivityDrawer
        eventId={eventId}
        events={buffer.all}
        agentNames={agentNames}
        onClose={() => setParams({ event: null })}
        onSelect={(id) => setParams({ event: id })}
        onFilterCorrelation={(correlationId) => {
          setFilters({ ...EMPTY_FILTERS, q: correlationId });
          setView("tree");
          setParams({ event: null });
        }}
      />
    </div>
  );
}

export function ActivityPage() {
  return (
    <DateFormatterProvider>
      <ActivityPageContent />
    </DateFormatterProvider>
  );
}
