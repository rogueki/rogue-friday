"use client";

import type { AutomationRun } from "@friday/sdk";
import type { AutomationDto as Automation } from "@/lib/api/domains/automations";
import { EmptyState, StatusChip, TagPill } from "@friday/ui";
import { Check, ChevronDown, ChevronRight, X } from "lucide-react";
import { useState } from "react";
import { useT } from "@/i18n";
import { useAutomationRuns } from "@/lib/api/domains/automations";
import { useFormat } from "../memory/kit/hooks";
import { QueryBoundary } from "../memory/kit/QueryBoundary";
import { ACTION_TONE, actionStatusKey, formatDurationMs, RUN_TONE, runStatusKey } from "./labels";

/** Run history of one automation (PLAN §35.3), newest first. */
export function RunHistory({ automation }: { automation: Automation }) {
  const { t } = useT();
  const query = useAutomationRuns(automation.id, { limit: 25 });
  return (
    <QueryBoundary query={query} rows={3}>
      {(response) =>
        response.items.length === 0 ? (
          <EmptyState compact title={t("automations.runs.empty")} description={t("automations.runs.emptyHint")} />
        ) : (
          <ul className="mk-list aut-runs" aria-label={t("automations.tab.runs")}>
            {response.items
              .slice()
              .sort((a, b) => b.triggeredAt.localeCompare(a.triggeredAt))
              .map((run) => (
                <RunItem key={run.id} run={run} automation={automation} />
              ))}
          </ul>
        )
      }
    </QueryBoundary>
  );
}

export function RunItem({ run, automation, defaultOpen = false }: { run: AutomationRun; automation: Automation; defaultOpen?: boolean }) {
  const { t } = useT();
  const format = useFormat();
  const [open, setOpen] = useState(defaultOpen);
  const duration = run.finishedAt ? formatDurationMs(Date.parse(run.finishedAt) - Date.parse(run.triggeredAt)) : null;
  return (
    <li className="aut-run" data-run-status={run.status}>
      <button type="button" className="aut-run__head" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {open ? <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" /> : <ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" />}
        <StatusChip tone={RUN_TONE[run.status]}>{t(runStatusKey(run.status))}</StatusChip>
        {run.dryRun ? <TagPill tone="blue">{t("automations.run.dryRun")}</TagPill> : null}
        <span className="aut-run__time">{format.dateTime(run.triggeredAt)}</span>
        {duration ? <span className="mk-muted">{duration}</span> : null}
        <span className="aut-run__result">{run.result}</span>
      </button>
      {open ? <RunDetail run={run} automation={automation} /> : null}
    </li>
  );
}

/**
 * "Keine Blackbox" (PLAN §35.4): why it fired, which conditions held, which actions ran, what came out.
 */
export function RunDetail({ run, automation }: { run: AutomationRun; automation: Automation }) {
  const { t } = useT();
  const format = useFormat();
  const conditionById = new Map(automation.conditions.map((condition) => [condition.id, condition]));
  const actionById = new Map(automation.actions.map((action) => [action.id, action]));
  return (
    <div className="aut-run__body mk-stack">
      <section>
        <h4 className="mk-section-title">{t("automations.run.why")}</h4>
        <div className="mk-block">
          <p>{run.triggerReason}</p>
        </div>
      </section>
      <section>
        <h4 className="mk-section-title">{t("automations.run.conditions")}</h4>
        {run.conditionsEvaluated.length === 0 ? (
          <p className="mk-note">{t("automations.run.noConditions")}</p>
        ) : (
          <ul className="mk-list">
            {run.conditionsEvaluated.map((entry) => (
              <li key={entry.conditionId} className={`mk-block ${entry.met ? "mk-block--green" : "mk-block--amber"}`}>
                <p className="mk-strong aut-line">
                  {entry.met ? <Check size={14} strokeWidth={2} aria-hidden="true" /> : <X size={14} strokeWidth={2} aria-hidden="true" />}
                  {conditionById.get(entry.conditionId)?.description ?? entry.conditionId} · {entry.met ? t("automations.run.met") : t("automations.run.notMet")}
                </p>
                <p className="mk-muted">{entry.detail}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h4 className="mk-section-title">{t("automations.run.actions")}</h4>
        {run.actionsExecuted.length === 0 ? (
          <p className="mk-note">{t("automations.run.noActions")}</p>
        ) : (
          <ul className="mk-list">
            {run.actionsExecuted.map((entry) => (
              <li key={entry.actionId} className="mk-block">
                <p className="aut-line">
                  <StatusChip tone={ACTION_TONE[entry.status]}>{t(actionStatusKey(entry.status))}</StatusChip>
                  <span className="mk-strong">{actionById.get(entry.actionId)?.description ?? entry.actionId}</span>
                </p>
                <p>{entry.resultSummary}</p>
                <p className="mk-muted">{format.dateTime(entry.executedAt)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h4 className="mk-section-title">{t("automations.run.result")}</h4>
        <div className={`mk-block${run.status === "failed" ? " mk-block--red" : ""}`}>
          <p>{run.result}</p>
          {run.error ? (
            <p className="mk-mono">
              {run.error.code} · {run.error.message} · {run.error.correlationId}
            </p>
          ) : null}
          <p className="mk-mono">{t("automations.run.correlation", { id: run.correlationId, version: run.automationVersion })}</p>
        </div>
      </section>
    </div>
  );
}
