"use client";

import type { AutomationDto as Automation } from "@/lib/api/domains/automations";
import { Button, ConfirmDialog, FilterBar, HudPanel, StatusChip, useToast } from "@jarvis/ui";
import { PauseCircle, PlayCircle, Plus, Workflow } from "lucide-react";
import { Suspense, useMemo, useState } from "react";
import { PanelFrame } from "@/components/PanelFrame";
import { useT } from "@/i18n";
import { useAutomations, usePauseAllAutomations, useToggleAutomation } from "@/lib/api/domains/automations";
import { useCapability, useCapabilityState } from "@/lib/capabilities";
import { CapabilityNote, DataBadges } from "../memory/kit/Badges";
import { useDebounced, useUrlParam } from "../memory/kit/hooks";
import { effectiveFreshness, usePanelState } from "../memory/kit/panelState";
import { AutomationDrawer } from "./AutomationDrawer";
import { AutomationRow } from "./AutomationRow";
import { AutomationWizard } from "./AutomationWizard";
import { automationState, type AutomationState } from "./labels";
import "./automations.css";

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
  const [confirmPause, setConfirmPause] = useState<"pause" | "resume" | null>(null);

  const term = useDebounced(search.trim(), 250);
  const query = useAutomations({ limit: 200, ...(term !== "" ? { q: term } : {}) });
  const readState = useCapabilityState("automations", "read");
  const writeState = useCapabilityState("automations", "update");
  const canCreate = useCapability("automations", "create");
  const canEnable = useCapability("automations", "enable");
  const canDisable = useCapability("automations", "disable");
  const canPauseAll = useCapability("automations", "pauseAll");
  const enable = useToggleAutomation(true);
  const disable = useToggleAutomation(false);
  const pauseAll = usePauseAllAutomations();

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
    read: readState,
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

  const runPauseAll = (): void => {
    if (!confirmPause) return;
    pauseAll.mutate(
      { targets: targets.map((automation) => ({ id: automation.id, version: automation.version })), paused: confirmPause === "pause" },
      {
        onSuccess: (result) => {
          setConfirmPause(null);
          toast({
            title: result.failed.length === 0 ? t(confirmPause === "pause" ? "automations.pauseAll.done" : "automations.resumeAll.done") : t("automations.pauseAll.partial"),
            description: t("automations.pauseAll.result", { ok: result.succeeded.length, total: result.succeeded.length + result.failed.length }),
            tone: result.failed.length === 0 ? "green" : "amber",
          });
        },
      },
    );
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
              disabled={!canPauseAll || targets.length === 0}
              title={!canPauseAll ? t("automations.kit.noPauseAll") : undefined}
              onClick={() => setConfirmPause(mode)}
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
              toggling={enable.isPending || disable.isPending}
              onOpen={(id) => setSelectedId(id, { push: true })}
              onToggle={(target, next) => (next ? enable : disable).mutate({ id: target.id, version: target.version })}
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
        onSaved={(saved) => {
          toast({ title: wizard?.automation ? t("automations.wizard.savedEdit") : t("automations.wizard.savedCreate"), description: t("automations.version", { version: saved.version }), tone: "green" });
          setSelectedId(saved.id, { push: true });
        }}
      />
      <ConfirmDialog
        open={confirmPause !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmPause(null);
        }}
        tone={confirmPause === "pause" ? "danger" : "default"}
        title={confirmPause === "resume" ? t("automations.resumeAll.title") : t("automations.pauseAll.title")}
        description={confirmPause === "resume" ? t("automations.resumeAll.description", { count: targets.length }) : t("automations.pauseAll.description", { count: targets.length })}
        details={targets.slice(0, 8).map((automation) => automation.name)}
        confirmLabel={confirmPause === "resume" ? t("automations.resumeAll") : t("automations.pauseAll")}
        cancelLabel={t("common.cancel")}
        loading={pauseAll.isPending}
        onConfirm={runPauseAll}
      />
    </div>
  );
}
