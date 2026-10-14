"use client";

import type { Priority, Task, TaskStatus } from "@jarvis/sdk";
import { Button, FilterBar, type FilterChip, type FilterDef } from "@jarvis/ui";
import { CalendarClock, KanbanSquare, List, Plus, UserCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PanelFrame } from "@/components/PanelFrame";
import { useCreateTaskDialog } from "@/features/palette/CreateTaskDialog";
import { useT, type MessageKey } from "@/i18n";
import { useAgents } from "@/lib/api/domains/agents";
import { useTaskPages, type TaskFilters } from "@/lib/api/domains/tasks";
import { TaskBoard } from "./TaskBoard";
import { TaskDecisions } from "./TaskDecisions";
import { TaskDrawer, TASK_TABS, type TaskTab } from "./TaskDrawer";
import { TaskList } from "./TaskList";
import { TaskTimeline } from "./TaskTimeline";
import { ALL_STATUSES, PRIORITIES } from "./model";
import { DataOrigin, DateFormatterProvider, GatedButton, ReadOnlyNotice, resolvePanelState, SegmentedControl, useModuleAccess, useModuleSection, useQueryParam, useQueryParams } from "./moduleKit";
import { useTaskCommands, useTaskGates } from "./useTaskCommands";
import "./tasks.css";

const VIEWS = ["board", "list", "timeline", "decisions"] as const;
type TaskView = (typeof VIEWS)[number];
const TASK_WRITE_ACTIONS = ["create", "update", "cancel", "retry", "pause", "resume"] as const;
const TASK_SECTIONS = ["tasks", "Aufgaben"] as const;
const PAGE_SIZE = 100;

const isView = (value: string | null): value is TaskView => VIEWS.includes(value as TaskView);
const isTab = (value: string | null): value is TaskTab => TASK_TABS.includes(value as TaskTab);

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/** Tasks module (PLAN §28): Kanban, list, timeline and "Meine Entscheidungen" with a detail drawer in `?task=…`. */
function TasksPageContent() {
  const { t } = useT();
  const [viewParam, setView] = useQueryParam("view");
  const { get: getParam, set: setParams } = useQueryParams();
  const taskId = getParam("task");
  const tabParam = getParam("tab");
  const [newParam, setNewParam] = useQueryParam("new");
  const setCreateOpen = useCreateTaskDialog((state) => state.setOpen);
  const view: TaskView = isView(viewParam) ? viewParam : "board";
  const tab: TaskTab = isTab(tabParam) ? tabParam : "overview";

  // The quick command "Neue Aufgabe" links to /tasks?new=1: open the dialog once and clean the URL.
  useEffect(() => {
    if (newParam !== "1") return;
    setCreateOpen(true);
    setNewParam(null);
  }, [newParam, setCreateOpen, setNewParam]);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [agentId, setAgentId] = useState("");
  const q = useDebounced(search.trim(), 250);
  const filters = useMemo<TaskFilters>(
    () => ({
      limit: PAGE_SIZE,
      sort: "-updatedAt",
      ...(q ? { q } : {}),
      ...(status ? { status: [status as TaskStatus] } : {}),
      ...(priority ? { priority: [priority as Priority] } : {}),
      ...(agentId ? { agentId } : {}),
    }),
    [q, status, priority, agentId],
  );
  const filtered = Boolean(q || status || priority || agentId);

  const access = useModuleAccess("tasks", TASK_WRITE_ACTIONS);
  const gates = useTaskGates();
  const commands = useTaskCommands();
  const section = useModuleSection(TASK_SECTIONS);
  const agents = useAgents({ limit: 200 });
  const pages = useTaskPages(filters);
  const { first } = pages;

  const resetFilters = (): void => {
    setSearch("");
    setStatus("");
    setPriority("");
    setAgentId("");
  };

  const filterDefs: FilterDef[] = [
    {
      id: "status",
      label: t("tasks.filter.status"),
      value: status,
      onChange: setStatus,
      options: [{ value: "", label: t("tasks.filter.allStatus") }, ...ALL_STATUSES.map((value) => ({ value, label: t(`tasks.status.${value}` as MessageKey) }))],
    },
    {
      id: "priority",
      label: t("tasks.filter.priority"),
      value: priority,
      onChange: setPriority,
      options: [{ value: "", label: t("tasks.filter.allPriority") }, ...PRIORITIES.map((value) => ({ value, label: `${value} · ${t(`priority.${value}` as MessageKey)}` }))],
    },
    {
      id: "agent",
      label: t("tasks.filter.agent"),
      value: agentId,
      onChange: setAgentId,
      options: [{ value: "", label: t("tasks.filter.allAgents") }, ...(agents.data?.items ?? []).map((agent) => ({ value: agent.id, label: agent.name }))],
    },
  ];
  const chips: FilterChip[] = [
    ...(q ? [{ id: "q", label: `${t("tasks.filter.search")}: ${q}`, onRemove: () => setSearch("") }] : []),
    ...(status ? [{ id: "status", label: t(`tasks.status.${status}` as MessageKey), onRemove: () => setStatus("") }] : []),
    ...(priority ? [{ id: "priority", label: priority, onRemove: () => setPriority("") }] : []),
    ...(agentId ? [{ id: "agent", label: agents.data?.items.find((agent) => agent.id === agentId)?.name ?? agentId, onRemove: () => setAgentId("") }] : []),
  ];

  const tasks = pages.items;
  const state = resolvePanelState({
    pending: first.isPending,
    error: first.error,
    hasData: first.data !== undefined,
    empty: first.data !== undefined && tasks.length === 0,
    emptyState: filtered
      ? { title: t("tasks.empty.filtered"), description: t("tasks.empty.filteredHint"), action: <Button size="sm" variant="ghost" onClick={resetFilters}>{t("tasks.filter.reset")}</Button> }
      : {
          title: t("tasks.empty.title"),
          description: t("tasks.empty.hint"),
          action: <GatedButton size="sm" variant="primary" icon={<Plus size={14} />} gate={gates.create} onClick={() => setCreateOpen(true)}>{t("tasks.create")}</GatedButton>,
        },
    unavailable: access.readable === "unavailable" ? t("tasks.unavailable") : undefined,
    section,
    freshness: first.data?.freshness,
    onRetry: () => void first.refetch(),
    retrying: first.isFetching,
    refreshFailedLabel: t("tasks.refreshFailed"),
  });

  const openTask = (task: Task): void => setParams({ task: task.id, tab: null }, "push");
  const canMove = gates.update === "available";
  const lockedReason = gates.update === "read-only" ? t("tasks.kit.reason.readOnly") : gates.update === "missing" ? t("tasks.kit.reason.missing") : undefined;

  const onMove = (task: Task, next: TaskStatus): void => {
    if (!canMove || next === task.status) return;
    commands.move(task, next);
  };

  return (
    <div className="web-page tk-page" data-view={view}>
      <PanelFrame
        state={view === "decisions" ? { kind: "ready" } : state}
        title={t("nav.tasks")}
        subtitle={t("page.tasks.description")}
        padding="md"
        className="web-page__panel tk-panel"
        bodyClassName="tk-panel__body"
        actions={
          <>
            <DataOrigin sources={first.data?.sources} freshness={first.data?.freshness} />
            <GatedButton size="sm" variant="primary" icon={<Plus size={14} />} gate={gates.create} onClick={() => setCreateOpen(true)}>
              {t("tasks.create")}
            </GatedButton>
          </>
        }
        skeletonRows={6}
      >
        <div className="tk-toolbar">
          <SegmentedControl
            label={t("tasks.views.label")}
            value={view}
            onChange={(next) => setView(next === "board" ? null : next)}
            options={[
              { value: "board", label: t("tasks.view.board"), icon: <KanbanSquare size={14} /> },
              { value: "list", label: t("tasks.view.list"), icon: <List size={14} /> },
              { value: "timeline", label: t("tasks.view.timeline"), icon: <CalendarClock size={14} /> },
              { value: "decisions", label: t("tasks.view.decisions"), icon: <UserCheck size={14} /> },
            ]}
          />
          <ReadOnlyNotice access={access} />
          <DataOrigin slot="body" sources={first.data?.sources} freshness={first.data?.freshness} />
        </div>
        {view !== "decisions" ? (
          <FilterBar
            className="tk-filters"
            search={{ value: search, onChange: setSearch, placeholder: t("tasks.filter.searchPlaceholder"), label: t("tasks.filter.search") }}
            filters={filterDefs}
            chips={chips}
            onReset={resetFilters}
            resetLabel={t("tasks.filter.reset")}
            resultCount={tasks.length}
            totalCount={pages.totalCount}
          />
        ) : null}
        {view === "board" ? (
          <TaskBoard tasks={tasks} freshness={first.data?.freshness} canMove={canMove} lockedReason={lockedReason} selectedId={taskId} onOpen={openTask} onMove={onMove} />
        ) : null}
        {view === "list" ? <TaskList tasks={tasks} totalCount={pages.totalCount} freshness={first.data?.freshness} selectedId={taskId} onOpen={openTask} /> : null}
        {view === "timeline" ? <TaskTimeline tasks={tasks} onOpen={openTask} /> : null}
        {view !== "decisions" && pages.hasMore ? (
          <div className="tk-more">
            <span className="tk-muted">{t("tasks.loaded", { shown: tasks.length, total: pages.totalCount ?? tasks.length })}</span>
            <Button size="sm" variant="ghost" loading={pages.loadingMore} onClick={pages.loadMore}>
              {t("tasks.loadMore")}
            </Button>
          </div>
        ) : null}
      </PanelFrame>
      {view === "decisions" ? <TaskDecisions onOpen={openTask} /> : null}
      <TaskDrawer taskId={taskId} tab={tab} onTabChange={(next) => setParams({ tab: next === "overview" ? null : next })} onClose={() => setParams({ task: null, tab: null })} />
    </div>
  );
}

export function TasksPage() {
  return (
    <DateFormatterProvider>
      <TasksPageContent />
    </DateFormatterProvider>
  );
}
