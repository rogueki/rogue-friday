"use client";

import type { AutomationDto as Automation } from "@/lib/api/domains/automations";
import { StatusChip } from "@friday/ui";
import { ArrowDown, Hand, Radio, Timer, Zap, type LucideIcon } from "lucide-react";
import { Fragment } from "react";
import { useT } from "@/i18n";
import { ACTION_ICON, actionTypeKey, afterLabel, channelKey, operatorKey, triggerTypeKey } from "./labels";

const TRIGGER_ICON: Record<Automation["trigger"]["type"], LucideIcon> = { event: Radio, schedule: Timer, manual: Hand, condition: Zap };

const show = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value));

/** Trigger → Bedingungen → Aktionen → Eskalation of one automation as a readable chain (PLAN §35.1). */
export function AutomationFlow({ automation }: { automation: Automation }) {
  const { t } = useT();
  const TriggerIcon = TRIGGER_ICON[automation.trigger.type];
  const units = { minutes: t("time.minutes"), hours: t("time.hours") };
  const stage = (title: string, count: number | null, children: React.ReactNode) => (
    <li className="aut-stage">
      <h4 className="aut-stage__title">
        {title}
        {count !== null ? <span className="aut-stage__count">{count}</span> : null}
      </h4>
      {children}
    </li>
  );
  return (
    <ol className="aut-flow" aria-label={t("automations.flow.label")}>
      {stage(
        t("automations.flow.trigger"),
        null,
        <div className="mk-block aut-stage__box">
          <p className="mk-strong aut-line">
            <TriggerIcon size={14} strokeWidth={1.5} aria-hidden="true" /> {t(triggerTypeKey(automation.trigger.type))}
          </p>
          <p>{automation.trigger.description}</p>
          {automation.trigger.event ? <p className="mk-mono">{automation.trigger.event}</p> : null}
          {automation.trigger.schedule ? (
            <p className="mk-mono">
              {automation.trigger.schedule}
              {automation.trigger.timeZone ? ` · ${automation.trigger.timeZone}` : ""}
            </p>
          ) : null}
        </div>,
      )}
      <li className="aut-flow__arrow" aria-hidden="true">
        <ArrowDown size={16} strokeWidth={1.5} />
      </li>
      {stage(
        t("automations.flow.conditions"),
        automation.conditions.length,
        automation.conditions.length === 0 ? (
          <p className="mk-note mk-block">{t("automations.flow.noConditions")}</p>
        ) : (
          <ul className="mk-list">
            {automation.conditions.map((condition) => (
              <li key={condition.id} className="mk-block">
                <p>{condition.description}</p>
                <p className="mk-mono">
                  {condition.field} {t(operatorKey(condition.operator))} {show(condition.value)}
                </p>
              </li>
            ))}
          </ul>
        ),
      )}
      <li className="aut-flow__arrow" aria-hidden="true">
        <ArrowDown size={16} strokeWidth={1.5} />
      </li>
      {stage(
        t("automations.flow.actions"),
        automation.actions.length,
        <ul className="mk-list">
          {automation.actions.map((action) => {
            const Icon = ACTION_ICON[action.type];
            return (
              <li key={action.id} className="mk-block">
                <p className="mk-strong aut-line">
                  <Icon size={14} strokeWidth={1.5} aria-hidden="true" /> {t(actionTypeKey(action.type))}
                  {action.channel ? <span className="mk-muted"> · {t(channelKey(action.channel))}</span> : null}
                </p>
                <p>{action.description}</p>
                {action.requiresApproval ? (
                  <StatusChip tone="amber" dot={false}>
                    {t("automations.flow.needsApproval")}
                  </StatusChip>
                ) : null}
              </li>
            );
          })}
        </ul>,
      )}
      <li className="aut-flow__arrow" aria-hidden="true">
        <ArrowDown size={16} strokeWidth={1.5} />
      </li>
      {stage(
        t("automations.flow.escalation"),
        automation.escalation.length,
        automation.escalation.length === 0 ? (
          <p className="mk-note mk-block">{t("automations.flow.noEscalation")}</p>
        ) : (
          <ol className="mk-list">
            {automation.escalation.map((step, index) => (
              <Fragment key={`${step.afterSeconds}:${step.channel}:${index}`}>
                <li className="mk-block">
                  <p className="mk-strong">
                    {t("automations.flow.after", { after: afterLabel(step.afterSeconds, units) })} → {t(channelKey(step.channel))}
                  </p>
                  <p>{step.description}</p>
                  {step.stopOnAcknowledge ? <p className="mk-muted">{t("automations.flow.stopsOnAck")}</p> : null}
                </li>
              </Fragment>
            ))}
          </ol>
        ),
      )}
    </ol>
  );
}
