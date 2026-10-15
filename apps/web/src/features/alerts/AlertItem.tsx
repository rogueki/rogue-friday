"use client";

import type { Notification } from "@friday/sdk";
import { Button, IconTile, StatusChip, TagPill } from "@friday/ui";
import { Check, ExternalLink, Moon, PanelRightOpen, Undo2 } from "lucide-react";
import { useT } from "@/i18n";
import { useFormat } from "../memory/kit/hooks";
import { EscalationSummary } from "./EscalationChain";
import { CATEGORY_ICON, categoryKey, isProminent, PRIORITY_ICON, PRIORITY_TONE, priorityKey, statusKey, STATUS_TONE } from "./labels";
import type { AlertActions } from "./useAlertActions";

export interface AlertItemProps {
  notification: Notification;
  actions: AlertActions;
  selected: boolean;
  onOpen: (id: string) => void;
  onSnooze: (notification: Notification) => void;
  onResolve: (notification: Notification) => void;
}

/**
 * One alert. P0/P1 are prominent through a coloured edge, tinted body and a static icon; nothing blinks (PLAN §39.3).
 * Every state is a word as well as a colour.
 */
export function AlertItem({ notification, actions, selected, onOpen, onSnooze, onResolve }: AlertItemProps) {
  const { t } = useT();
  const format = useFormat();
  const tone = PRIORITY_TONE[notification.priority];
  const Icon = PRIORITY_ICON[notification.priority];
  const CategoryIcon = CATEGORY_ICON[notification.category];
  const prominent = isProminent(notification);
  const open = notification.status === "open";
  const handled = notification.status === "resolved";
  return (
    <li>
      <article
        className={`alr-card alr-card--${tone}${prominent ? " alr-card--prominent" : ""}${selected ? " alr-card--selected" : ""}${handled ? " alr-card--handled" : ""}`}
        data-priority={notification.priority}
        data-status={notification.status}
        aria-label={`${notification.priority} · ${notification.title}`}
      >
        <IconTile icon={<Icon size={18} strokeWidth={1.5} />} tone={tone} size="md" />
        <div className="alr-card__main">
          <div className="alr-card__top">
            <TagPill tone={tone} solid={notification.priority === "P0"}>
              {notification.priority} · {t(priorityKey(notification.priority))}
            </TagPill>
            <StatusChip tone={STATUS_TONE[notification.status]}>
              {t(statusKey(notification.status))}
              {notification.status === "snoozed" && notification.snoozedUntil ? ` ${t("alerts.until", { time: format.time(notification.snoozedUntil) })}` : ""}
            </StatusChip>
            <span className="alr-card__time" title={format.dateTime(notification.createdAt)}>
              {format.relative(notification.createdAt)}
            </span>
          </div>
          <h3 className="alr-card__title">{notification.title}</h3>
          <p className="alr-card__body">{notification.body}</p>
          <div className="alr-card__meta">
            <span className="alr-card__cat">
              <CategoryIcon size={13} strokeWidth={1.5} aria-hidden="true" /> {t(categoryKey(notification.category))}
            </span>
            <span className="mk-mono">{notification.source.system}</span>
            {!handled ? <EscalationSummary escalation={notification.escalation} /> : null}
          </div>
          <div className="mk-actions alr-card__actions">
            {open ? (
              <Button size="sm" variant={prominent ? "primary" : "ghost"} icon={<Check size={14} />} disabled={!actions.can.acknowledge || actions.pending} title={!actions.can.acknowledge ? t("alerts.kit.noAction") : undefined} onClick={() => actions.acknowledge(notification)}>
                {t("alerts.action.acknowledge")}
              </Button>
            ) : null}
            {notification.status !== "resolved" && notification.status !== "snoozed" ? (
              <Button size="sm" variant="ghost" icon={<Moon size={14} />} disabled={!actions.can.snooze || actions.pending} title={!actions.can.snooze ? t("alerts.kit.noAction") : undefined} onClick={() => onSnooze(notification)}>
                {t("alerts.action.snooze")}
              </Button>
            ) : null}
            {notification.status !== "resolved" ? (
              <Button size="sm" variant="ghost" icon={<Undo2 size={14} />} disabled={!actions.can.resolve || actions.pending} title={!actions.can.resolve ? t("alerts.kit.noAction") : undefined} onClick={() => onResolve(notification)}>
                {t("alerts.action.resolve")}
              </Button>
            ) : null}
            {notification.targetRoute ? (
              <Button size="sm" variant="ghost" icon={<ExternalLink size={14} />} onClick={() => actions.openSource(notification)}>
                {t("alerts.action.openSource")}
              </Button>
            ) : null}
            <Button size="sm" variant="subtle" icon={<PanelRightOpen size={14} />} onClick={() => onOpen(notification.id)} aria-label={t("alerts.action.detailsFor", { title: notification.title })}>
              {t("alerts.action.details")}
            </Button>
          </div>
        </div>
      </article>
    </li>
  );
}
