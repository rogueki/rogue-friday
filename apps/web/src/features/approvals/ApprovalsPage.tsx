"use client";

import type { ApprovalStatus, ApprovalType, RiskTier } from "@friday/sdk";
import { Button, FilterBar, type FilterChip, type FilterDef } from "@friday/ui";
import { useMemo, useState } from "react";
import { PanelFrame } from "@/components/PanelFrame";
import { DataOrigin, DateFormatterProvider, ReadOnlyNotice, resolvePanelState, useModuleAccess, useModuleSection, useQueryParams } from "@/features/tasks/moduleKit";
import { useModulePanelGate } from "@/features/shared/useAvailability";
import { useT, type MessageKey } from "@/i18n";
import { useAgents } from "@/lib/api/domains/agents";
import { useApprovalPages, type ApprovalFilters } from "@/lib/api/domains/approvals";
import { useTasks } from "@/lib/api/domains/tasks";
import { ApprovalDrawer } from "./ApprovalDrawer";
import { ApprovalListCard } from "./ApprovalListCard";
import { APPROVAL_STATUSES, APPROVAL_TYPES, RISK_TIERS } from "./model";
import "./approvals.css";

const APPROVAL_WRITE = ["decide", "requestContext", "editBeforeApprove"] as const;
const APPROVAL_SECTIONS = ["approvals", "Freigaben"] as const;
const PAGE_SIZE = 50;

/** Approvals module (PLAN §32): one place for every action that needs a human decision. */
function ApprovalsPageContent() {
  const { t } = useT();
  const { get: getParam, set: setParams } = useQueryParams();
  const approvalId = getParam("approval");
  const [status, setStatus] = useState<string>("pending");
  const [type, setType] = useState("");
  const [tier, setTier] = useState("");

  const filters = useMemo<ApprovalFilters>(
    () => ({
      limit: PAGE_SIZE,
      ...(status ? { status: [status as ApprovalStatus] } : {}),
      ...(type ? { type: [type as ApprovalType] } : {}),
      ...(tier ? { riskTier: [Number(tier) as RiskTier] } : {}),
    }),
    [status, type, tier],
  );
  const filtered = status !== "pending" || Boolean(type || tier);

  const access = useModuleAccess("approvals", APPROVAL_WRITE);
  const section = useModuleSection(APPROVAL_SECTIONS);
  const agents = useAgents({ limit: 200 });
  const pages = useApprovalPages(filters);
  const { first } = pages;
  const taskIds = useMemo(() => new Set(pages.items.map((approval) => approval.taskId).filter((id): id is string => Boolean(id))), [pages.items]);
  // Task titles for the cards; one list request instead of one per card (cards fall back to the id).
  const tasks = useTasks({ limit: 200 });
  const taskTitles = useMemo(() => new Map((tasks.data?.items ?? []).filter((task) => taskIds.has(task.id)).map((task) => [task.id, task.title])), [tasks.data, taskIds]);
  const agentNames = useMemo(() => new Map((agents.data?.items ?? []).map((agent) => [agent.id, agent.name])), [agents.data]);

  const reset = (): void => {
    setStatus("pending");
    setType("");
    setTier("");
  };

  const filterDefs: FilterDef[] = [
    {
      id: "status",
      label: t("approvals.filter.status"),
      value: status,
      onChange: setStatus,
      options: [
        { value: "pending", label: t("approvals.filter.open") },
        ...APPROVAL_STATUSES.filter((value) => value !== "pending").map((value) => ({ value, label: t(`approvals.status.${value}` as MessageKey) })),
        { value: "", label: t("approvals.filter.allStatus") },
      ],
    },
    { id: "type", label: t("approvals.filter.type"), value: type, onChange: setType, options: [{ value: "", label: t("approvals.filter.allTypes") }, ...APPROVAL_TYPES.map((value) => ({ value, label: t(`approvals.type.${value}` as MessageKey) }))] },
    { id: "tier", label: t("approvals.filter.tier"), value: tier, onChange: setTier, options: [{ value: "", label: t("approvals.filter.allTiers") }, ...RISK_TIERS.map((value) => ({ value: String(value), label: t(`approvals.tier.${value}` as MessageKey) }))] },
  ];
  const chips: FilterChip[] = [
    ...(status !== "pending" ? [{ id: "status", label: status ? t(`approvals.status.${status}` as MessageKey) : t("approvals.filter.allStatus"), onRemove: () => setStatus("pending") }] : []),
    ...(type ? [{ id: "type", label: t(`approvals.type.${type}` as MessageKey), onRemove: () => setType("") }] : []),
    ...(tier ? [{ id: "tier", label: t(`approvals.tier.${tier}` as MessageKey), onRemove: () => setTier("") }] : []),
  ];

  const items = pages.items;
  const gate = useModulePanelGate("approvals", { moduleName: t("nav.approvals"), error: first.error, hasData: first.data !== undefined, onRetry: () => void first.refetch() });
  const state = resolvePanelState({
    pending: first.isPending,
    error: first.error,
    hasData: first.data !== undefined,
    empty: first.data !== undefined && items.length === 0,
    emptyState: filtered
      ? { title: t("approvals.empty.filtered"), description: t("approvals.empty.filteredHint"), action: <Button size="sm" variant="ghost" onClick={reset}>{t("approvals.filter.reset")}</Button> }
      : { title: t("approvals.empty.title"), description: t("approvals.empty.hint") },
    gate,
    section,
    freshness: first.data?.freshness,
    onRetry: () => void first.refetch(),
    retrying: first.isFetching,
    refreshFailedLabel: t("approvals.refreshFailed"),
  });

  return (
    <div className="web-page ap-page">
      <PanelFrame
        state={state}
        title={t("nav.approvals")}
        subtitle={t("page.approvals.description")}
        level={status === "pending" && items.length > 0 ? 3 : 1}
        tone={status === "pending" && items.length > 0 ? "amber" : "cyan"}
        padding="md"
        className="web-page__panel ap-panel"
        bodyClassName="ap-panel__body"
        actions={<DataOrigin sources={first.data?.sources} freshness={first.data?.freshness} />}
        skeletonRows={4}
      >
        <div className="ap-toolbar">
          <FilterBar className="ap-filters" filters={filterDefs} chips={chips} onReset={reset} resetLabel={t("approvals.filter.reset")} resultCount={items.length} totalCount={pages.totalCount} />
          <ReadOnlyNotice access={access} />
          <DataOrigin slot="body" sources={first.data?.sources} freshness={first.data?.freshness} />
        </div>
        <div className="ap-grid" role="list" aria-label={t("approvals.list.label")}>
          {items.map((approval) => (
            <div key={approval.id} role="listitem" className="ap-grid__cell">
              <ApprovalListCard
                approval={approval}
                agentName={approval.agentId ? agentNames.get(approval.agentId) : undefined}
                taskTitle={approval.taskId ? taskTitles.get(approval.taskId) : undefined}
                selected={approvalId === approval.id}
                onOpen={(entry) => setParams({ approval: entry.id }, "push")}
              />
            </div>
          ))}
        </div>
        {pages.hasMore ? (
          <div className="tk-more">
            <Button size="sm" variant="ghost" loading={pages.loadingMore} onClick={pages.loadMore}>
              {t("approvals.loadMore")}
            </Button>
          </div>
        ) : null}
      </PanelFrame>
      <ApprovalDrawer approvalId={approvalId} agentNames={agentNames} onClose={() => setParams({ approval: null })} />
    </div>
  );
}

export function ApprovalsPage() {
  return (
    <DateFormatterProvider>
      <ApprovalsPageContent />
    </DateFormatterProvider>
  );
}
