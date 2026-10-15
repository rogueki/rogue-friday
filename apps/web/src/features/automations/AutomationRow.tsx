"use client";

import type { AutomationDto as Automation } from "@/lib/api/domains/automations";
import { IconTile, StatusChip, Switch } from "@friday/ui";
import { AlertTriangle, CalendarClock, CheckCircle2 } from "lucide-react";
import { useT } from "@/i18n";
import { useFormat } from "../memory/kit/hooks";
import { ACTION_ICON, automationState, STATE_TONE, stateKey, triggerTypeKey } from "./labels";

export interface AutomationRowProps {
  automation: Automation;
  selected: boolean;
  canToggle: boolean;
  toggling: boolean;
  onOpen: (id: string) => void;
  onToggle: (automation: Automation, enable: boolean) => void;
}

/** List row: state, trigger, last success/error, next run (PLAN §35.3). The row itself opens the detail; the switch toggles. */
export function AutomationRow({ automation, selected, canToggle, toggling, onOpen, onToggle }: AutomationRowProps) {
  const { t } = useT();
  const format = useFormat();
  const state = automationState(automation);
  const Icon = ACTION_ICON[automation.actions[0]?.type ?? "notify"];
  return (
    <li className={`aut-row${selected ? " aut-row--selected" : ""}${state === "inactive" ? " aut-row--inactive" : ""}`} data-automation-id={automation.id} data-state={state}>
      <button type="button" className="aut-row__open" onClick={() => onOpen(automation.id)} aria-label={t("automations.openDetails", { name: automation.name })}>
        <IconTile icon={<Icon size={16} strokeWidth={1.5} />} tone={STATE_TONE[state]} size="md" />
        <span className="aut-row__main">
          <span className="mk-row__title">{automation.name}</span>
          {automation.description ? <span className="mk-row__text">{automation.description}</span> : null}
          <span className="mk-row__meta">
            <span>
              {t(triggerTypeKey(automation.trigger.type))}: {automation.trigger.description}
            </span>
          </span>
          <span className="aut-row__facts">
            <span className="aut-fact aut-fact--ok">
              <CheckCircle2 size={12} strokeWidth={1.75} aria-hidden="true" /> {t("automations.fact.success")}: {automation.lastSuccess ? format.relative(automation.lastSuccess.at) : t("automations.never")}
            </span>
            {automation.lastError ? (
              <span className="aut-fact aut-fact--error" title={automation.lastError.message}>
                <AlertTriangle size={12} strokeWidth={1.75} aria-hidden="true" /> {t("automations.fact.error")}: {format.relative(automation.lastError.at)}
              </span>
            ) : null}
            <span className="aut-fact">
              <CalendarClock size={12} strokeWidth={1.75} aria-hidden="true" /> {t("automations.fact.next")}: {automation.nextRunAt && state === "active" ? format.dateTime(automation.nextRunAt) : t("automations.noNext")}
            </span>
            <span className="aut-fact">{t("automations.fact.runs", { count: automation.runCount })}</span>
          </span>
        </span>
      </button>
      <div className="aut-row__side">
        <StatusChip tone={STATE_TONE[state]}>{t(stateKey(state))}</StatusChip>
        <Switch
          label={t("automations.toggleLabel", { name: automation.name })}
          checked={automation.enabled}
          disabled={!canToggle || toggling}
          stateLabels={[t("memory.kit.on"), t("memory.kit.off")]}
          onCheckedChange={(next) => onToggle(automation, next)}
          className="aut-row__switch"
        />
      </div>
    </li>
  );
}
