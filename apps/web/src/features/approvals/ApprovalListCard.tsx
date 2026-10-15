"use client";

import type { Approval } from "@friday/sdk";
import { Button, IconTile, StatusDot, TagPill, cx } from "@friday/ui";
import { Bot, Clock3, KeyRound, ListChecks, ShieldAlert } from "lucide-react";
import { useT, type MessageKey } from "@/i18n";
import { useDateFormatter } from "@/features/tasks/moduleKit";
import { AUTH_TONE, IMPACT_TONE, STATUS_TONE, TIER_TONE, expiryMs, isExpired } from "./model";
import "./approvals.css";

export interface ApprovalListCardProps {
  approval: Approval;
  agentName?: string;
  taskTitle?: string;
  selected?: boolean;
  onOpen: (approval: Approval) => void;
}

/** Approval card of the list (PLAN §32.2): action, risk tier, agent, task, rationale, impacts, preview, expiry, required auth. */
export function ApprovalListCard({ approval, agentName, taskTitle, selected, onOpen }: ApprovalListCardProps) {
  const { t } = useT();
  const format = useDateFormatter();
  const expired = isExpired(approval, format.now);
  const status = expired && approval.status === "pending" ? "expired" : approval.status;
  const remaining = expiryMs(approval, format.now);
  const tierTone = TIER_TONE[approval.riskTier];
  return (
    <article
      className={cx("jv-card jv-approval ap-card", `jv-tone-${tierTone}`, selected && "jv-card--selected")}
      data-status={status}
      data-tier={approval.riskTier}
      aria-label={`${t("approvals.card.label")}: ${approval.action}`}
    >
      <div className="jv-approval__head">
        <IconTile icon={<ShieldAlert size={16} strokeWidth={1.5} />} tone={tierTone} size="md" active={approval.riskTier === 3 && status === "pending"} />
        <div className="jv-approval__titles">
          <button type="button" className="ap-card__title" onClick={() => onOpen(approval)}>
            {approval.action}
          </button>
          <span className="jv-approval__meta">
            <span>{t(`approvals.type.${approval.type}` as MessageKey)}</span>
            <span className={cx("ap-card__status", `jv-tone-${STATUS_TONE[status]}`)}>
              <StatusDot tone={STATUS_TONE[status]} />
              {t(`approvals.status.${status}` as MessageKey)}
            </span>
          </span>
        </div>
        <TagPill tone={tierTone}>{t(`approvals.tier.${approval.riskTier}` as MessageKey)}</TagPill>
      </div>

      <p className="ap-card__rationale">{approval.rationale}</p>

      <div className="ap-card__facts">
        <span title={t("approvals.field.agent")}>
          <Bot size={12} strokeWidth={1.75} aria-hidden="true" />
          <span className="jv-sr-only">{t("approvals.field.agent")}: </span>
          {agentName ?? (approval.agentId ? approval.agentId : "—")}
        </span>
        <span title={t("approvals.field.task")}>
          <ListChecks size={12} strokeWidth={1.75} aria-hidden="true" />
          <span className="jv-sr-only">{t("approvals.field.task")}: </span>
          {taskTitle ?? (approval.taskId ? approval.taskId : "—")}
        </span>
        <span title={t("approvals.field.auth")}>
          <KeyRound size={12} strokeWidth={1.75} aria-hidden="true" />
          <span className="jv-sr-only">{t("approvals.field.auth")}: </span>
          <TagPill tone={AUTH_TONE[approval.requiredAuth]}>{t(`approvals.auth.${approval.requiredAuth}` as MessageKey)}</TagPill>
        </span>
        <span className={cx(status === "pending" && remaining !== null && remaining < 5 * 60_000 && "jv-tone-red")} title={approval.expiresAt ? format.dateTime(approval.expiresAt) : undefined}>
          <Clock3 size={12} strokeWidth={1.75} aria-hidden="true" />
          <span className="jv-sr-only">{t("approvals.field.expires")}: </span>
          {approval.expiresAt ? (expired ? t("approvals.expired") : t("approvals.expiresIn", { time: format.relative(approval.expiresAt) })) : t("approvals.noExpiry")}
        </span>
      </div>

      {approval.impacts.length > 0 ? (
        <ul className="ap-card__impacts" aria-label={t("approvals.field.impacts")}>
          {approval.impacts.slice(0, 3).map((impact) => (
            <li key={`${impact.kind}-${impact.description}`}>
              <TagPill tone={IMPACT_TONE[impact.severity ?? "none"]}>{t(`approvals.impact.${impact.kind}` as MessageKey)}</TagPill>
              <span>{impact.description}</span>
            </li>
          ))}
          {approval.impacts.length > 3 ? <li className="tk-muted">{t("approvals.moreImpacts", { count: approval.impacts.length - 3 })}</li> : null}
        </ul>
      ) : null}

      <div className="ap-card__preview" aria-label={t("approvals.field.preview")}>
        <span className="ap-card__preview-kind">{t(`approvals.preview.${approval.preview.kind}` as MessageKey)}</span>
        <span className="ap-card__preview-title">{approval.preview.title}</span>
      </div>

      <div className="jv-approval__actions">
        <Button size="sm" variant={status === "pending" ? "primary" : "ghost"} onClick={() => onOpen(approval)}>
          {status === "pending" ? t("approvals.review") : t("approvals.details")}
        </Button>
      </div>
    </article>
  );
}
