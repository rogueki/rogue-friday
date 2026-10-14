"use client";

import type { AgentStatus } from "@jarvis/sdk";
import { Button, FilterBar, StatusDot, type FilterChip, type FilterDef } from "@jarvis/ui";
import { useEffect, useMemo, useState } from "react";
import { PanelFrame } from "@/components/PanelFrame";
import { DataOrigin, DateFormatterProvider, ReadOnlyNotice, resolvePanelState, useModuleAccess, useModuleSection, useQueryParams } from "@/features/tasks/moduleKit";
import { useModulePanelGate } from "@/features/shared/useAvailability";
import { useT, type MessageKey } from "@/i18n";
import { useAgents, type AgentFilters } from "@/lib/api/domains/agents";
import { useTasks } from "@/lib/api/domains/tasks";
import { AgentDrawer, AGENT_TABS, type AgentTab } from "./AgentDrawer";
import { AgentInfoCard } from "./AgentInfoCard";
import { AGENT_STATUSES, AGENT_STATUS_TONE } from "./model";
import "./agents.css";

const AGENT_WRITE = ["pause", "resume", "stop", "assignTask"] as const;
const AGENT_SECTIONS = ["agents", "Agenten"] as const;

const isTab = (value: string | null): value is AgentTab => AGENT_TABS.includes(value as AgentTab);

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/** Agents module (PLAN §31): cards with live status, detail drawer in `?agent=…`, capability-gated control actions. */
function AgentsPageContent() {
  const { t } = useT();
  const { get: getParam, set: setParams } = useQueryParams();
  const agentId = getParam("agent");
  const tabParam = getParam("tab");
  const tab: AgentTab = isTab(tabParam) ? tabParam : "overview";
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const q = useDebounced(search.trim(), 250);
  const filters = useMemo<AgentFilters>(() => ({ limit: 200, ...(q ? { q } : {}), ...(status ? { status: [status as AgentStatus] } : {}) }), [q, status]);
  const filtered = Boolean(q || status);

  const access = useModuleAccess("agents", AGENT_WRITE);
  const section = useModuleSection(AGENT_SECTIONS);
  const query = useAgents(filters);
  const all = useAgents({ limit: 200 });
  const tasks = useTasks({ status: ["running", "waiting", "ready", "review", "todo", "triage"], limit: 200 });
  const taskTitles = useMemo(() => new Map((tasks.data?.items ?? []).map((task) => [task.id, task.title])), [tasks.data]);

  const items = query.data?.items ?? [];
  const counts = useMemo(() => {
    const result = new Map<AgentStatus, number>();
    for (const agent of all.data?.items ?? []) result.set(agent.status, (result.get(agent.status) ?? 0) + 1);
    return result;
  }, [all.data]);

  const reset = (): void => {
    setSearch("");
    setStatus("");
  };
  const filterDefs: FilterDef[] = [
    { id: "status", label: t("agents.filter.status"), value: status, onChange: setStatus, options: [{ value: "", label: t("agents.filter.allStatus") }, ...AGENT_STATUSES.map((value) => ({ value, label: t(`agent.status.${value}` as MessageKey) }))] },
  ];
  const chips: FilterChip[] = [
    ...(q ? [{ id: "q", label: `${t("agents.filter.search")}: ${q}`, onRemove: () => setSearch("") }] : []),
    ...(status ? [{ id: "status", label: t(`agent.status.${status}` as MessageKey), onRemove: () => setStatus("") }] : []),
  ];

  const gate = useModulePanelGate("agents", { moduleName: t("nav.agents"), error: query.error, hasData: query.data !== undefined, onRetry: () => void query.refetch() });
  const state = resolvePanelState({
    pending: query.isPending,
    error: query.error,
    hasData: query.data !== undefined,
    empty: query.data !== undefined && items.length === 0,
    emptyState: filtered
      ? { title: t("agents.empty.filtered"), description: t("agents.empty.filteredHint"), action: <Button size="sm" variant="ghost" onClick={reset}>{t("agents.filter.reset")}</Button> }
      : { title: t("agents.empty.title"), description: t("agents.empty.hint") },
    gate,
    section,
    freshness: query.data?.freshness,
    onRetry: () => void query.refetch(),
    retrying: query.isFetching,
    refreshFailedLabel: t("agents.refreshFailed"),
  });

  return (
    <div className="web-page ag-page">
      <PanelFrame
        state={state}
        title={t("nav.agents")}
        subtitle={t("page.agents.description")}
        padding="md"
        className="web-page__panel ag-panel"
        bodyClassName="ag-panel__body"
        actions={<DataOrigin sources={query.data?.sources} freshness={query.data?.freshness} />}
        skeletonRows={4}
      >
        <div className="ag-toolbar">
          <ul className="ag-summary" aria-label={t("agents.summary.label")}>
            {AGENT_STATUSES.filter((value) => (counts.get(value) ?? 0) > 0).map((value) => (
              <li key={value} className="ag-summary__item">
                <StatusDot tone={AGENT_STATUS_TONE[value]} />
                <span>{t(`agent.status.${value}` as MessageKey)}</span>
                <strong>{counts.get(value)}</strong>
              </li>
            ))}
          </ul>
          <ReadOnlyNotice access={access} />
          <DataOrigin slot="body" sources={query.data?.sources} freshness={query.data?.freshness} />
        </div>
        <FilterBar
          className="ag-filters"
          search={{ value: search, onChange: setSearch, placeholder: t("agents.filter.searchPlaceholder"), label: t("agents.filter.search") }}
          filters={filterDefs}
          chips={chips}
          onReset={reset}
          resetLabel={t("agents.filter.reset")}
          resultCount={items.length}
        />
        <div className="ag-grid" role="list" aria-label={t("agents.list.label")}>
          {items.map((agent, index) => (
            <div key={agent.id} role="listitem" className="ag-grid__cell">
              <AgentInfoCard
                agent={agent}
                index={index}
                taskTitle={agent.currentTaskId ? taskTitles.get(agent.currentTaskId) : undefined}
                selected={agentId === agent.id}
                onOpen={(entry) => setParams({ agent: entry.id, tab: null }, "push")}
              />
            </div>
          ))}
        </div>
      </PanelFrame>
      <AgentDrawer agentId={agentId} tab={tab} onTabChange={(next) => setParams({ tab: next === "overview" ? null : next })} onClose={() => setParams({ agent: null, tab: null })} />
    </div>
  );
}

export function AgentsPage() {
  return (
    <DateFormatterProvider>
      <AgentsPageContent />
    </DateFormatterProvider>
  );
}
