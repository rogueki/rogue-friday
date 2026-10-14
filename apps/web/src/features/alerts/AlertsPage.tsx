"use client";

import type { Notification, Priority } from "@jarvis/sdk";
import { Button, ConfirmDialog, HudPanel, Select, StatusChip, Tabs } from "@jarvis/ui";
import { BellRing, CheckCheck } from "lucide-react";
import { Suspense, useMemo, useState } from "react";
import { PanelFrame } from "@/components/PanelFrame";
import { useT } from "@/i18n";
import { useNotifications } from "@/lib/api/domains/notifications";
import { CapabilityNote, DataBadges } from "../memory/kit/Badges";
import { useUrlParam } from "../memory/kit/hooks";
import { effectiveFreshness, usePanelState } from "../memory/kit/panelState";
import { AlertDrawer } from "./AlertDrawer";
import { AlertItem } from "./AlertItem";
import { ChannelStatusPanel } from "./ChannelStatusPanel";
import { SnoozeDialog } from "./SnoozeDialog";
import { ACTIVE_STATUSES, CATEGORIES, categoryKey, compareNotifications, PRIORITIES, PRIORITY_TONE, priorityKey, type NotificationCategory } from "./labels";
import { useAlertActions } from "./useAlertActions";
import "./alerts.css";

const PAGE_SIZE = 100;
type Tab = "active" | "history";

export function AlertsPage() {
  return (
    <Suspense fallback={null}>
      <AlertsPageInner />
    </Suspense>
  );
}

function AlertsPageInner() {
  const { t } = useT();
  const [selectedId, setSelectedId] = useUrlParam("alert");
  const [tab, setTab] = useState<Tab>("active");
  const [priority, setPriority] = useState<"all" | Priority>("all");
  const [category, setCategory] = useState<"all" | NotificationCategory>("all");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [snoozing, setSnoozing] = useState<Notification | null>(null);
  const [resolving, setResolving] = useState<Notification | null>(null);

  const actions = useAlertActions();

  const active = useNotifications({ status: ACTIVE_STATUSES, limit });
  const selectedInActive = active.data?.items.some((item) => item.id === selectedId) ?? false;
  const history = useNotifications({ status: ["resolved"], limit }, tab === "history" || (selectedId !== null && active.isSuccess && !selectedInActive));
  const query = tab === "active" ? active : history;

  const items = useMemo(
    () =>
      (query.data?.items ?? [])
        .filter((item) => (priority === "all" || item.priority === priority) && (category === "all" || item.category === category))
        .sort(compareNotifications),
    [query.data, priority, category],
  );
  const counts = useMemo(() => {
    const result: Record<Priority, number> = { P0: 0, P1: 0, P2: 0, P3: 0, P4: 0 };
    for (const item of active.data?.items ?? []) if (item.status !== "resolved") result[item.priority] += 1;
    return result;
  }, [active.data]);
  const openCount = (active.data?.items ?? []).filter((item) => item.status === "open").length;

  const selected = [...(active.data?.items ?? []), ...(history.data?.items ?? [])].find((item) => item.id === selectedId);
  const filtered = priority !== "all" || category !== "all";

  const state = usePanelState(query, {
    module: "notifications",
    moduleName: t("nav.alerts"),
    adapterId: query.data?.sources[0]?.adapterId,
    empty: items.length === 0,
    emptyTitle: filtered ? t("alerts.empty.filtered") : tab === "active" ? t("alerts.empty.active") : t("alerts.empty.history"),
    emptyDescription: filtered ? t("alerts.empty.filteredHint") : tab === "active" ? t("alerts.empty.activeHint") : t("alerts.empty.historyHint"),
    emptyIcon: <CheckCheck size={22} strokeWidth={1.5} />,
  });

  const requestResolve = (notification: Notification): void => {
    if (notification.priority === "P0" || notification.priority === "P1") setResolving(notification);
    else actions.resolve(notification);
  };

  return (
    <div className="mk-page alr-page">
      <HudPanel
        title={t("nav.alerts")}
        subtitle={t("page.alerts.description")}
        icon={<BellRing size={18} strokeWidth={1.5} />}
        actions={<DataBadges sources={query.data?.sources} freshness={effectiveFreshness(query)} />}
      >
        <div className="mk-stack">
          <CapabilityNote state={actions.writeState} readText={t("alerts.kit.readOnly")} writeText={t("alerts.kit.writeUnavailable")} />
          <div className="alr-priorities" role="group" aria-label={t("alerts.filter.priority")}>
            <button type="button" className="alr-prio alr-prio--all" aria-pressed={priority === "all"} onClick={() => setPriority("all")}>
              <span className="alr-prio__label">{t("alerts.filter.all")}</span>
              <span className="alr-prio__count">{openCount}</span>
              <span className="alr-prio__sub">{t("alerts.filter.openCount")}</span>
            </button>
            {PRIORITIES.map((value) => (
              <button
                key={value}
                type="button"
                className={`alr-prio alr-prio--${PRIORITY_TONE[value]}`}
                aria-pressed={priority === value}
                onClick={() => setPriority(priority === value ? "all" : value)}
              >
                <span className="alr-prio__label">{value}</span>
                <span className="alr-prio__count">{counts[value]}</span>
                <span className="alr-prio__sub">{t(priorityKey(value))}</span>
              </button>
            ))}
          </div>
          <div className="alr-toolbar">
            <Tabs
              label={t("alerts.tabs")}
              variant="boxed"
              value={tab}
              onValueChange={(value) => {
                setTab(value as Tab);
                setLimit(PAGE_SIZE);
              }}
              items={[
                { id: "active", label: t("alerts.tab.active"), count: active.data ? active.data.items.filter((item) => item.status !== "resolved").length : undefined },
                { id: "history", label: t("alerts.tab.history") },
              ]}
            />
            <Select
              label={t("alerts.filter.category")}
              hideLabel
              value={category}
              onChange={(event) => setCategory(event.target.value as "all" | NotificationCategory)}
              options={[{ value: "all", label: t("alerts.filter.allCategories") }, ...CATEGORIES.map((value) => ({ value, label: t(categoryKey(value)) }))]}
              className="alr-toolbar__select"
            />
            {filtered ? (
              <Button size="sm" variant="ghost" onClick={() => { setPriority("all"); setCategory("all"); }}>
                {t("alerts.filter.reset")}
              </Button>
            ) : null}
            <StatusChip tone="muted" dot={false}>
              {t("alerts.count", { count: items.length })}
            </StatusChip>
          </div>
        </div>
      </HudPanel>

      <div className="alr-layout">
        <PanelFrame title={tab === "active" ? t("alerts.list.active") : t("alerts.list.history")} state={state} skeletonRows={5} className="alr-list-panel">
          <ul className="mk-list alr-list" aria-label={tab === "active" ? t("alerts.list.active") : t("alerts.list.history")}>
            {items.map((notification) => (
              <AlertItem
                key={notification.id}
                notification={notification}
                actions={actions}
                selected={notification.id === selectedId}
                onOpen={(id) => setSelectedId(id, { push: true })}
                onSnooze={setSnoozing}
                onResolve={requestResolve}
              />
            ))}
          </ul>
          {query.data?.pageInfo.hasNextPage ? (
            <div className="mk-more">
              <Button variant="ghost" size="sm" loading={query.isFetching} onClick={() => setLimit((current) => current + PAGE_SIZE)}>
                {t("memory.kit.more")}
              </Button>
            </div>
          ) : null}
        </PanelFrame>
        <ChannelStatusPanel />
      </div>

      <AlertDrawer
        id={selectedId}
        notification={selected}
        loading={active.isPending || history.isFetching}
        actions={actions}
        onClose={() => setSelectedId(null)}
        onSnooze={setSnoozing}
        onResolve={requestResolve}
      />
      <SnoozeDialog
        notification={snoozing}
        busy={actions.pending}
        onClose={() => setSnoozing(null)}
        onConfirm={(notification, minutes) => actions.snooze(notification, minutes, () => setSnoozing(null))}
      />
      <ConfirmDialog
        open={resolving !== null}
        onOpenChange={(open) => {
          if (!open) setResolving(null);
        }}
        title={t("alerts.resolve.title")}
        description={t("alerts.resolve.description", { title: resolving?.title ?? "" })}
        details={[t("alerts.resolve.detail.escalation"), t("alerts.resolve.detail.history")]}
        confirmLabel={t("alerts.action.resolve")}
        cancelLabel={t("common.cancel")}
        loading={actions.pending}
        onConfirm={() => {
          if (resolving) actions.resolve(resolving, () => setResolving(null));
        }}
      />
    </div>
  );
}
