"use client";

import type { Notification } from "@friday/sdk";
import { Button, Drawer, EmptyState, StatusChip, TagPill } from "@friday/ui";
import { Check, ExternalLink, Moon, Undo2 } from "lucide-react";
import { useT } from "@/i18n";
import { DataBadges } from "../memory/kit/Badges";
import { useFormat } from "../memory/kit/hooks";
import { EscalationChain } from "./EscalationChain";
import { categoryKey, PRIORITY_TONE, priorityKey, statusKey, STATUS_TONE } from "./labels";
import type { AlertActions } from "./useAlertActions";

export interface AlertDrawerProps {
  id: string | null;
  notification: Notification | undefined;
  /** True while the lists that could contain `id` are still loading. */
  loading: boolean;
  actions: AlertActions;
  onClose: () => void;
  onSnooze: (notification: Notification) => void;
  onResolve: (notification: Notification) => void;
}

export function AlertDrawer({ id, notification, loading, actions, onClose, onSnooze, onResolve }: AlertDrawerProps) {
  const { t } = useT();
  const format = useFormat();
  return (
    <Drawer
      open={id !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={notification?.title ?? t("alerts.drawer.title")}
      subtitle={notification ? `${notification.priority} · ${t(priorityKey(notification.priority))}` : undefined}
      closeLabel={t("common.close")}
      width={520}
    >
      {notification ? (
        <div className="mk-stack">
          <DataBadges sources={[notification.source]} />
          <div className="mk-actions">
            <TagPill tone={PRIORITY_TONE[notification.priority]}>{notification.priority}</TagPill>
            <StatusChip tone={STATUS_TONE[notification.status]}>{t(statusKey(notification.status))}</StatusChip>
            <TagPill tone="muted">{t(categoryKey(notification.category))}</TagPill>
          </div>
          <div className="mk-block">
            <p>{notification.body}</p>
          </div>
          <dl className="mk-dl">
            <dt>{t("alerts.field.created")}</dt>
            <dd>{format.dateTime(notification.createdAt)}</dd>
            {notification.acknowledgedAt ? (
              <>
                <dt>{t("alerts.field.acknowledged")}</dt>
                <dd>{format.dateTime(notification.acknowledgedAt)}</dd>
              </>
            ) : null}
            {notification.snoozedUntil ? (
              <>
                <dt>{t("alerts.field.snoozedUntil")}</dt>
                <dd>{format.dateTime(notification.snoozedUntil)}</dd>
              </>
            ) : null}
            {notification.resolvedAt ? (
              <>
                <dt>{t("alerts.field.resolved")}</dt>
                <dd>{format.dateTime(notification.resolvedAt)}</dd>
              </>
            ) : null}
            <dt>{t("alerts.field.source")}</dt>
            <dd>
              {notification.source.system} <span className="mk-mono">({notification.source.adapterId})</span>
            </dd>
            {notification.sourceRef ? (
              <>
                <dt>{t("alerts.field.reference")}</dt>
                <dd>
                  {notification.sourceRef.label ?? notification.sourceRef.id} <span className="mk-mono">({notification.sourceRef.type})</span>
                </dd>
              </>
            ) : null}
          </dl>
          <section>
            <h3 className="mk-section-title">{t("alerts.escalation.title")}</h3>
            <EscalationChain escalation={notification.escalation} status={notification.status} />
          </section>
          <div className="mk-actions" role="group" aria-label={t("alerts.drawer.actions")}>
            {notification.status === "open" ? (
              <Button size="sm" icon={<Check size={14} />} disabled={!actions.can.acknowledge || actions.pending} onClick={() => actions.acknowledge(notification)}>
                {t("alerts.action.acknowledge")}
              </Button>
            ) : null}
            {notification.status !== "resolved" && notification.status !== "snoozed" ? (
              <Button size="sm" variant="ghost" icon={<Moon size={14} />} disabled={!actions.can.snooze || actions.pending} onClick={() => onSnooze(notification)}>
                {t("alerts.action.snooze")}
              </Button>
            ) : null}
            {notification.status !== "resolved" ? (
              <Button size="sm" variant="ghost" icon={<Undo2 size={14} />} disabled={!actions.can.resolve || actions.pending} onClick={() => onResolve(notification)}>
                {t("alerts.action.resolve")}
              </Button>
            ) : null}
            {notification.targetRoute ? (
              <Button size="sm" variant="ghost" icon={<ExternalLink size={14} />} onClick={() => actions.openSource(notification)}>
                {t("alerts.action.openSource")}
              </Button>
            ) : null}
            {notification.escalation.some((step) => step.state === "awaiting_approval" && ["telegram", "whatsapp", "sms"].includes(step.channel)) ? (
              <Button size="sm" variant="primary" onClick={() => actions.openSource({
                ...notification,
                targetRoute: `/communication?messengerNotification=${encodeURIComponent(notification.id)}`,
              })}>
                {t("alerts.action.reviewSend")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : loading ? (
        <p className="mk-note" aria-busy="true">
          {t("common.loading")}
        </p>
      ) : (
        <EmptyState compact title={t("alerts.drawer.notFound")} description={t("alerts.drawer.notFoundHint")} />
      )}
    </Drawer>
  );
}
