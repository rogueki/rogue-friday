"use client";

import type { Notification } from "@friday/sdk";
import { IconTile, StatusChip } from "@friday/ui";
import { Check, ChevronRight, CircleDashed, Clock3, SkipForward, TriangleAlert, type LucideIcon } from "lucide-react";
import { Fragment } from "react";
import { useT } from "@/i18n";
import { CHANNEL_ICON, channelKindKey } from "../memory/kit/channelStatus";
import { useFormat } from "../memory/kit/hooks";
import { ESCALATION_TONE, escalationStateKey, type EscalationState } from "./labels";

type Step = Notification["escalation"][number];

const STATE_ICON: Record<EscalationState, LucideIcon> = {
  pending: Clock3,
  awaiting_approval: TriangleAlert,
  sent: Check,
  acknowledged: Check,
  failed: TriangleAlert,
  skipped: SkipForward,
};

const sortSteps = (steps: readonly Step[]): Step[] => steps.slice().sort((a, b) => a.step - b.step);

/** One-line chain for list rows: Dashboard › Telegram › WhatsApp › Telefon, each with its state word (never colour-only). */
export function EscalationSummary({ escalation }: { escalation: readonly Step[] }) {
  const { t } = useT();
  const format = useFormat();
  if (escalation.length === 0) return <span className="mk-muted">{t("alerts.escalation.none")}</span>;
  return (
    <ol className="alr-summary" aria-label={t("alerts.escalation.title")}>
      {sortSteps(escalation).map((step, index) => {
        const Icon = CHANNEL_ICON[step.channel];
        const at = step.acknowledgedAt ?? step.sentAt ?? step.scheduledAt;
        return (
          <li key={`${step.step}:${step.channel}`} className="alr-summary__item">
            {index > 0 ? <ChevronRight size={12} strokeWidth={1.5} aria-hidden="true" className="alr-summary__sep" /> : null}
            <StatusChip tone={ESCALATION_TONE[step.state]} icon={<Icon size={12} strokeWidth={1.75} aria-hidden="true" />} title={format.dateTime(at)}>
              {t(channelKindKey(step.channel))} · {t(escalationStateKey(step.state))} {format.time(at)}
            </StatusChip>
          </li>
        );
      })}
    </ol>
  );
}

/** Escalation view of PLAN §39.4: Dashboard → Telegram → WhatsApp → Telefon with every timestamp. */
export function EscalationChain({ escalation, status }: { escalation: readonly Step[]; status: Notification["status"] }) {
  const { t } = useT();
  const format = useFormat();
  if (escalation.length === 0) return <p className="mk-note">{t("alerts.escalation.none")}</p>;
  const steps = sortSteps(escalation);
  return (
    <div className="mk-stack">
      <ol className="alr-chain" aria-label={t("alerts.escalation.title")}>
        {steps.map((step, index) => {
          const Icon = CHANNEL_ICON[step.channel];
          const StateIcon = STATE_ICON[step.state];
          const tone = ESCALATION_TONE[step.state];
          return (
            <Fragment key={`${step.step}:${step.channel}`}>
              {index > 0 ? <li className="alr-chain__link" aria-hidden="true" /> : null}
              <li className={`alr-chain__step alr-chain__step--${step.state}`}>
                <IconTile icon={<Icon size={16} strokeWidth={1.5} />} tone={tone} size="md" />
                <div className="alr-chain__body">
                  <div className="alr-chain__head">
                    <span className="mk-strong">
                      {t("alerts.escalation.step", { step: step.step })} · {t(channelKindKey(step.channel))}
                    </span>
                    <StatusChip tone={tone} icon={<StateIcon size={12} strokeWidth={1.75} aria-hidden="true" />}>
                      {t(escalationStateKey(step.state))}
                    </StatusChip>
                  </div>
                  <dl className="alr-chain__times">
                    <div>
                      <dt>{t("alerts.escalation.scheduled")}</dt>
                      <dd>{format.dateTime(step.scheduledAt)}</dd>
                    </div>
                    <div>
                      <dt>{t("alerts.escalation.sent")}</dt>
                      <dd>{step.sentAt ? format.dateTime(step.sentAt) : "—"}</dd>
                    </div>
                    <div>
                      <dt>{t("alerts.escalation.acknowledged")}</dt>
                      <dd>{step.acknowledgedAt ? format.dateTime(step.acknowledgedAt) : "—"}</dd>
                    </div>
                  </dl>
                </div>
              </li>
            </Fragment>
          );
        })}
      </ol>
      <p className="mk-note">
        <CircleDashed size={12} strokeWidth={1.5} aria-hidden="true" style={{ verticalAlign: "-2px" }} />{" "}
        {status === "open" ? t("alerts.escalation.runningHint") : t("alerts.escalation.stoppedHint")}
      </p>
    </div>
  );
}
