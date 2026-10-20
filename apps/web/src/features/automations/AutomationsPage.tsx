"use client";

import type { AutomationDto as Automation } from "@/lib/api/domains/automations";
import type { AutomationPauseAllResponse, components } from "@friday/sdk";
import { createIdempotencyKey } from "@friday/sdk";
import { Button, FilterBar, HudPanel, StatusChip, useToast } from "@friday/ui";
import { PauseCircle, PlayCircle, Plus, Workflow } from "lucide-react";
import { Suspense, useMemo, useState } from "react";
import { PanelFrame } from "@/components/PanelFrame";
import { useT } from "@/i18n";
import { call } from "@/lib/api/call";
import { getApiClient } from "@/lib/api/client";
import { useAutomations } from "@/lib/api/domains/automations";
import { queryKeys } from "@/lib/api/queryKeys";
import { useRunStagedWrite, useStagedWriteBusy } from "@/lib/api/stagedWrite";
import { useCapability, useCapabilityState } from "@/lib/capabilities";
import { CapabilityNote, DataBadges } from "../memory/kit/Badges";
import { useDebounced, useUrlParam } from "../memory/kit/hooks";
import { effectiveFreshness, usePanelState } from "../memory/kit/panelState";
import { AutomationDrawer } from "./AutomationDrawer";
import { AutomationRow } from "./AutomationRow";
import { AutomationWizard } from "./AutomationWizard";
import { automationState, type AutomationState } from "./labels";
import "./automations.css";

type AutomationResponse = components["schemas"]["AutomationResponse"];

type StateFilter = "all" | AutomationState;

export function AutomationsPage() {
  return (
    <Suspense fallback={null}>
      <AutomationsPageInner />
    </Suspense>
  );
}

function AutomationsPageInner() {
  const { t } = useT();
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useUrlParam("automation");
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [wizard, setWizard] = useState<{ automation?: Automation } | null>(null);

  const term = useDebounced(search.trim(), 250);
  const query = useAutomations({ limit: 200, ...(term !== "" ? { q: term } : {}) });
  const writeState = useCapabilityState("automations", "update");
  const canCreate = useCapability("automations", "create");
  const canEnable = useCapability("automations", "enable");
  const canDisable = useCapability("automations", "disable");
  const canPauseAll = useCapability("automations", "pauseAll");
  const canUpdate = useCapability("automations", "update");
  const runStagedWrite = useRunStagedWrite();
  const stagedBusy = useStagedWriteBusy();

  const items = useMemo<Automation[]>(() => query.data?.items ?? [], [query.data]);
  const counts = useMemo(() => {
    const result: Record<AutomationState, number> = { active: 0, paused: 0, inactive: 0 };
    for (const automation of items) result[automationState(automation)] += 1;
    return result;
  }, [items]);
  const visible = items.filter((automation) => stateFilter === "all" || automationState(automation) === stateFilter);
  const selected = items.find((automation) => automation.id === selectedId);
  const filtered = stateFilter !== "all" || term !== "";

  const pausable = items.filter((automation) => automationState(automation) === "active");
  const resumable = items.filter((automation) => automationState(automation) === "paused");
  const mode: "pause" | "resume" = pausable.length > 0 || resumable.length === 0 ? "pause" : "resume";
  const targets = mode === "pause" ? pausable : resumable;

  const state = usePanelState(query, {
    module: "automations",
    moduleName: t("nav.automations"),
    adapterId: query.data?.sources[0]?.adapterId,
    empty: visible.length === 0,
    emptyTitle: filtered ? t("automations.empty.filtered") : t("automations.empty"),
    emptyDescription: filtered ? t("automations.empty.filteredHint") : t("automations.empty.hint"),
    emptyIcon: <Workflow size={22} strokeWidth={1.5} />,
    emptyAction: canCreate && !filtered ? (
      <Button size="sm" icon={<Plus size={14} />} onClick={() => setWizard({})}>
        {t("automations.new")}
      </Button>
    ) : undefined,
    degraded: counts.paused > 0 ? { reason: t("automations.pausedNotice", { count: counts.paused }), affected: [] } : undefined,
  });

  // Pausing is one bulk request with a result per automation; resuming has no bulk operation in the contract and runs
  // one staged write per target. The server preview is the binding confirmation for each.
  const mayRun = mode === "pause" ? canPauseAll : canPauseAll && canUpdate;
  const toggleTarget = (target: Automation, next: boolean): void => {
    void runStagedWrite({
      send: (previewId) =>
        call(getApiClient().POST(next ? "/api/v1/automations/{id}/enable" : "/api/v1/automations/{id}/disable", {
          params: { path: { id: target.id }, header: { "If-Match": String(target.version) } },
          ...(previewId ? { headers: { "X-Action-Preview-Id": previewId } } : {}) })) as Promise<AutomationResponse>,
      successMessage: t(next ? "automations.staged.enabled" : "automations.staged.disabled"),
      subject: target.name,
      invalidateKeys: [queryKeys.automations.all, queryKeys.overview],
    });
  };
  const runBulk = (): void => {
    if (mode === "pause") {
      const idempotencyKey = createIdempotencyKey();
      void runStagedWrite({
        send: (previewId) =>
          call(getApiClient().POST("/api/v1/automations/pause-all", {
            params: { header: { "Idempotency-Key": idempotencyKey } },
            ...(previewId ? { headers: { "X-Action-Preview-Id": previewId } } : {}) })) as Promise<AutomationPauseAllResponse>,
        successMessage: t("automations.staged.pausedAll"),
        subject: t("automations.pauseAll"),
        invalidateKeys: [queryKeys.automations.all, queryKeys.overview],
        onExecuted: (response) => {
          const data = (response as AutomationPauseAllResponse).data;
          toast({
            title: data.failedCount === 0 ? t("automations.pauseAll.done") : t("automations.pauseAll.partial"),
            description: t("automations.pauseAll.summary", { paused: data.pausedCount, unchanged: data.unchangedCount, failed: data.failedCount }),
            tone: data.failedCount === 0 ? "green" : "amber",
          });
        },
      });
      return;
    }
    void (async () => {
      let succeeded = 0;
      for (const target of targets) {
        const outcome = await runStagedWrite({
          send: (previewId) =>
            call(getApiClient().PATCH("/api/v1/automations/{id}", { body: { paused: false },
              params: { path: { id: target.id }, header: { "If-Match": String(target.version) } },
              ...(previewId ? { headers: { "X-Action-Preview-Id": previewId } } : {}) })) as Promise<AutomationResponse>,
          successMessage: t("automations.staged.resumed"),
          subject: target.name,
          invalidateKeys: [queryKeys.automations.all, queryKeys.overview],
        });
        if (outcome === "executed") succeeded += 1;
      }
      toast({
        title: succeeded === targets.length ? t("automations.resumeAll.done") : t("automations.pauseAll.partial"),
        description: t("automations.pauseAll.result", { ok: succeeded, total: targets.length }),
        tone: succeeded === targets.length ? "green" : "amber",
      });
    })();
  };

  return (
    <div className="mk-page aut-page">
      <HudPanel
        title={t("nav.automations")}
        subtitle={t("page.automations.description")}
        icon={<Workflow size={18} strokeWidth={1.5} />}
        actions={
          <span className="mk-actions">
            <DataBadges sources={query.data?.sources} freshness={effectiveFreshness(query)} />
            <Button
              size="sm"
              variant="ghost"
              icon={mode === "pause" ? <PauseCircle size={14} /> : <PlayCircle size={14} />}
              disabled={!mayRun || targets.length === 0 || stagedBusy}
              title={!mayRun ? t("automations.kit.noPauseAll") : undefined}
              onClick={runBulk}
            >
              {mode === "pause" ? t("automations.pauseAll") : t("automations.resumeAll")}
            </Button>
            <Button size="sm" icon={<Plus size={14} />} disabled={!canCreate} title={!canCreate ? t("automations.kit.noCreate") : undefined} onClick={() => setWizard({})}>
              {t("automations.new")}
            </Button>
          </span>
        }
      >
        <div className="mk-stack">
          <CapabilityNote state={writeState} readText={t("automations.kit.readOnly")} writeText={t("automations.kit.writeUnavailable")} />
          <FilterBar
            search={{ value: search, onChange: setSearch, placeholder: t("automations.search.placeholder"), label: t("automations.search.label") }}
            filters={[
              {
                id: "state",
                label: t("automations.filter.state"),
                value: stateFilter,
                onChange: (value) => setStateFilter(value as StateFilter),
                options: [
                  { value: "all", label: t("automations.filter.all") },
                  { value: "active", label: t("automations.state.active") },
                  { value: "paused", label: t("automations.state.paused") },
                  { value: "inactive", label: t("automations.state.inactive") },
                ],
              },
            ]}
            chips={stateFilter !== "all" ? [{ id: "state", label: t(`automations.state.${stateFilter}` as const), onRemove: () => setStateFilter("all") }] : []}
            onReset={() => {
              setSearch("");
              setStateFilter("all");
            }}
            resetLabel={t("memory.filter.reset")}
            resultCount={visible.length}
            totalCount={items.length}
            actions={
              <span className="aut-counts" role="group" aria-label={t("automations.counts")}>
                <StatusChip tone="green">{t("automations.count.active", { count: counts.active })}</StatusChip>
                <StatusChip tone={counts.paused ? "amber" : "muted"}>{t("automations.count.paused", { count: counts.paused })}</StatusChip>
                <StatusChip tone="muted">{t("automations.count.inactive", { count: counts.inactive })}</StatusChip>
              </span>
            }
          />
        </div>
      </HudPanel>

      <PanelFrame title={t("automations.list.title")} state={state} skeletonRows={5} className="aut-list-panel">
        <ul className="aut-list" aria-label={t("automations.list.title")}>
          {visible.map((automation) => (
            <AutomationRow
              key={automation.id}
              automation={automation}
              selected={automation.id === selectedId}
              canToggle={automation.enabled ? canDisable : canEnable}
              toggling={stagedBusy}
              onOpen={(id) => setSelectedId(id, { push: true })}
              onToggle={(target, next) => toggleTarget(target, next)}
            />
          ))}
        </ul>
      </PanelFrame>

      <AutomationDrawer
        id={selectedId}
        automation={selected}
        loading={query.isPending}
        onClose={() => setSelectedId(null)}
        onEdit={(automation) => setWizard({ automation })}
      />
      <AutomationWizard
        open={wizard !== null}
        onOpenChange={(open) => {
          if (!open) setWizard(null);
        }}
        automation={wizard?.automation}
        onSaved={(saved) => setSelectedId(saved.id, { push: true })}
      />
    </div>
  );
}
