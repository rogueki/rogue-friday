"use client";

import type { AutomationDto as Automation } from "@/lib/api/domains/automations";
import { Button, Drawer, StatusChip, Switch, Tabs } from "@jarvis/ui";
import { Pencil } from "lucide-react";
import { useT } from "@/i18n";
import { useAutomationRuns, useToggleAutomation } from "@/lib/api/domains/automations";
import { useCapability } from "@/lib/capabilities";
import { DataBadges } from "../memory/kit/Badges";
import { useFormat } from "../memory/kit/hooks";
import { AutomationFlow } from "./AutomationFlow";
import { RunHistory } from "./RunHistory";
import { automationState, STATE_TONE, stateKey } from "./labels";
import { TestPanel } from "./TestPanel";

export interface AutomationDrawerProps {
  automation: Automation | undefined;
  id: string | null;
  loading: boolean;
  onClose: () => void;
  onEdit: (automation: Automation) => void;
}

export function AutomationDrawer({ automation, id, loading, onClose, onEdit }: AutomationDrawerProps) {
  const { t } = useT();
  return (
    <Drawer
      open={id !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={automation?.name ?? t("automations.drawer.title")}
      subtitle={automation ? t("automations.version", { version: automation.version }) : undefined}
      closeLabel={t("common.close")}
      width={640}
    >
      {automation ? <Detail automation={automation} onEdit={onEdit} /> : loading ? <p className="mk-note">{t("common.loading")}</p> : <p className="mk-note">{t("automations.drawer.notFound")}</p>}
    </Drawer>
  );
}

function Detail({ automation, onEdit }: { automation: Automation; onEdit: (automation: Automation) => void }) {
  const { t } = useT();
  const format = useFormat();
  const canUpdate = useCapability("automations", "update");
  const canEnable = useCapability("automations", "enable");
  const canDisable = useCapability("automations", "disable");
  const enable = useToggleAutomation(true);
  const disable = useToggleAutomation(false);
  const state = automationState(automation);
  const runs = useAutomationRuns(automation.id, { limit: 25 });
  const byVersion = new Map<number, number>();
  for (const run of runs.data?.items ?? []) byVersion.set(run.automationVersion, (byVersion.get(run.automationVersion) ?? 0) + 1);
  const toggleAllowed = automation.enabled ? canDisable : canEnable;

  const overview = (
    <div className="mk-stack">
      <p>{automation.description}</p>
      <dl className="mk-dl">
        <dt>{t("automations.field.lastSuccess")}</dt>
        <dd>{automation.lastSuccess ? format.dateTime(automation.lastSuccess.at) : t("automations.never")}</dd>
        <dt>{t("automations.field.lastError")}</dt>
        <dd>
          {automation.lastError ? (
            <>
              {format.dateTime(automation.lastError.at)} · {automation.lastError.message}
            </>
          ) : (
            t("automations.none")
          )}
        </dd>
        <dt>{t("automations.field.nextRun")}</dt>
        <dd>{automation.nextRunAt && state === "active" ? format.dateTime(automation.nextRunAt) : t("automations.noNext")}</dd>
        <dt>{t("automations.field.runCount")}</dt>
        <dd>{automation.runCount}</dd>
      </dl>
      <AutomationFlow automation={automation} />
    </div>
  );

  const version = (
    <div className="mk-stack">
      <p className="mk-note">{t("automations.version.intro")}</p>
      <dl className="mk-dl">
        <dt>{t("automations.version.current")}</dt>
        <dd className="mk-strong">v{automation.version}</dd>
        <dt>{t("automations.version.created")}</dt>
        <dd>{format.dateTime(automation.createdAt)}</dd>
        <dt>{t("automations.version.changed")}</dt>
        <dd>{format.dateTime(automation.updatedAt)}</dd>
        <dt>{t("automations.version.runs")}</dt>
        <dd>
          {byVersion.size === 0
            ? t("automations.none")
            : Array.from(byVersion.entries())
                .sort((a, b) => b[0] - a[0])
                .map(([number, count]) => t("automations.version.runsFor", { version: number, count }))
                .join(" · ")}
        </dd>
      </dl>
      <p className="mk-note">{t("automations.version.noHistory")}</p>
    </div>
  );

  return (
    <div className="mk-stack" data-automation-id={automation.id}>
      <DataBadges sources={[automation.source]} />
      <div className="mk-actions">
        <StatusChip tone={STATE_TONE[state]}>{t(stateKey(state))}</StatusChip>
        <Switch
          label={automation.enabled ? t("automations.enabled") : t("automations.disabled")}
          checked={automation.enabled}
          disabled={!toggleAllowed || enable.isPending || disable.isPending}
          stateLabels={[t("memory.kit.on"), t("memory.kit.off")]}
          onCheckedChange={(next) => (next ? enable : disable).mutate({ id: automation.id, version: automation.version })}
        />
        <Button size="sm" variant="ghost" icon={<Pencil size={14} />} disabled={!canUpdate} title={!canUpdate ? t("automations.kit.noUpdate") : undefined} onClick={() => onEdit(automation)}>
          {t("automations.edit")}
        </Button>
      </div>
      <Tabs
        label={t("automations.drawer.tabs")}
        items={[
          { id: "overview", label: t("automations.tab.overview"), content: overview },
          { id: "runs", label: t("automations.tab.runs"), count: automation.runCount, content: <RunHistory automation={automation} /> },
          { id: "test", label: t("automations.tab.test"), content: <TestPanel automation={automation} /> },
          { id: "version", label: t("automations.tab.version"), content: version },
        ]}
      />
    </div>
  );
}
