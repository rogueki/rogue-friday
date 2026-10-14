"use client";

import type { ActivityEvent, ActivityKind } from "@jarvis/sdk";
import { ActivityRow, Button, Drawer, EmptyState, ErrorState, IconButton, PanelLink, Skeleton } from "@jarvis/ui";
import { isJarvisApiError } from "@jarvis/sdk";
import { Activity as ActivityIcon, Bot, Check, FileText, Globe, ListChecks, MessageSquare, Plug, Terminal, Wrench } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useOrbSnapshot } from "@/features/orb/useOrbSnapshot";
import { formatClockTime } from "@/features/shared/time";
import { notificationIcon, severityFromPriority, severityFromWire } from "@/features/shared/presentation";
import { useT } from "@/i18n";
import { useActivity } from "@/lib/api/domains/activity";
import { useAcknowledgeNotification, useNotifications } from "@/lib/api/domains/notifications";
import { useCapability } from "@/lib/capabilities";
import { useAppSettings } from "@/lib/settings";
import { useUiStore } from "@/lib/uiStore";

const ICON = { size: 18, strokeWidth: 1.5 } as const;

const ACTIVITY_ICONS: Record<ActivityKind, ReactNode> = {
  user_request: <MessageSquare {...ICON} />,
  task: <ListChecks {...ICON} />,
  agent: <Bot {...ICON} />,
  tool_call: <Wrench {...ICON} />,
  source_read: <Globe {...ICON} />,
  result: <Check {...ICON} />,
  artifact: <FileText {...ICON} />,
  adapter: <Plug {...ICON} />,
  system: <Terminal {...ICON} />,
};

function ActivityList({ events, onNavigate }: { events: readonly ActivityEvent[]; onNavigate: () => void }) {
  const { locale } = useT();
  const { timeZone, hour12 } = useAppSettings();
  const router = useRouter();
  return (
    <div className="web-drawer-list">
      {events.map((event) => (
        <ActivityRow
          key={event.id}
          icon={ACTIVITY_ICONS[event.kind] ?? <ActivityIcon {...ICON} />}
          title={event.title}
          meta={event.summary ?? event.error?.message}
          severity={event.severity === "info" && event.status === "running" ? "live" : severityFromWire(event.severity)}
          time={formatClockTime(event.occurredAt, { locale, timeZone, hour12 })}
          onClick={
            event.taskId
              ? () => {
                  onNavigate();
                  router.push(`/tasks?task=${encodeURIComponent(event.taskId ?? "")}`);
                }
              : undefined
          }
        />
      ))}
    </div>
  );
}

/** Orb click (working/default): the latest activity without leaving the current page (PLAN §21). */
export function LiveActivityDrawer() {
  const { t } = useT();
  const router = useRouter();
  const open = useUiStore((s) => s.activityDrawerOpen);
  const setOpen = useUiStore((s) => s.setActivityDrawerOpen);
  const query = useActivity({ limit: 30 });
  const orb = useOrbSnapshot().snapshot;
  return (
    <Drawer
      open={open}
      onOpenChange={setOpen}
      title={t("drawer.activity.title")}
      subtitle={orb?.status.activityText}
      closeLabel={t("common.close")}
      footer={
        <PanelLink
          onClick={() => {
            setOpen(false);
            router.push("/activity");
          }}
        >
          {t("drawer.activity.all")}
        </PanelLink>
      }
    >
      {query.isPending ? (
        <Skeleton variant="row" height={48} label={t("common.loading")} />
      ) : query.isError ? (
        <ErrorState compact title={t("common.loadError")} description={isJarvisApiError(query.error) ? query.error.message : undefined} code={isJarvisApiError(query.error) ? query.error.code : undefined} correlationId={isJarvisApiError(query.error) ? query.error.correlationId : undefined} onRetry={() => void query.refetch()} retryLabel={t("common.retry")} />
      ) : query.data.items.length === 0 ? (
        <EmptyState compact title={t("drawer.activity.empty")} />
      ) : (
        <ActivityList events={query.data.items} onNavigate={() => setOpen(false)} />
      )}
    </Drawer>
  );
}

/** Orb click in `error` mode: the error context (orb detail text, failing activities, critical alerts). */
export function ErrorDetailDrawer() {
  const { t } = useT();
  const router = useRouter();
  const open = useUiStore((s) => s.errorDetailOpen);
  const setOpen = useUiStore((s) => s.setErrorDetailOpen);
  const orb = useOrbSnapshot().snapshot;
  const failures = useActivity({ severity: ["error", "critical"], limit: 8 });
  const alerts = useNotifications({ status: ["open"], priority: ["P0", "P1"], limit: 5 });
  return (
    <Drawer open={open} onOpenChange={setOpen} title={t("drawer.error.title")} subtitle={orb?.status.activityText} closeLabel={t("common.close")}>
      <div className="web-drawer-list">
        {orb?.status.detailText ? <p className="web-drawer-note">{orb.status.detailText}</p> : null}
        {failures.data?.items.map((event) => (
          <ActivityRow
            key={event.id}
            icon={ACTIVITY_ICONS[event.kind]}
            title={event.title}
            meta={event.error ? `${event.error.code} · ${event.error.correlationId}` : event.summary}
            severity={severityFromWire(event.severity)}
          />
        ))}
        {alerts.data?.items.map((n) => (
          <ActivityRow
            key={n.id}
            icon={notificationIcon(n.category)}
            title={n.title}
            meta={n.body}
            severity={severityFromPriority(n.priority)}
            onClick={() => {
              setOpen(false);
              router.push(n.targetRoute ?? "/alerts");
            }}
          />
        ))}
        {!failures.isPending && !alerts.isPending && (failures.data?.items.length ?? 0) + (alerts.data?.items.length ?? 0) === 0 && !orb?.status.detailText ? (
          <EmptyState compact title={t("drawer.error.empty")} />
        ) : null}
        <Button
          variant="ghost"
          onClick={() => {
            setOpen(false);
            router.push("/alerts");
          }}
        >
          {t("drawer.error.alerts")}
        </Button>
      </div>
    </Drawer>
  );
}

/** Bell in the top bar: latest open notifications with inline acknowledge. */
export function NotificationsDrawer() {
  const { t, locale } = useT();
  const { timeZone, hour12 } = useAppSettings();
  const router = useRouter();
  const open = useUiStore((s) => s.notificationsOpen);
  const setOpen = useUiStore((s) => s.setNotificationsOpen);
  const query = useNotifications({ status: ["open"], limit: 20 });
  const acknowledge = useAcknowledgeNotification();
  const canAcknowledge = useCapability("notifications", "acknowledge");
  return (
    <Drawer
      open={open}
      onOpenChange={setOpen}
      title={t("drawer.notifications.title")}
      closeLabel={t("common.close")}
      footer={
        <PanelLink
          onClick={() => {
            setOpen(false);
            router.push("/alerts");
          }}
        >
          {t("overview.attention.all")}
        </PanelLink>
      }
    >
      {query.isPending ? (
        <Skeleton variant="row" height={48} label={t("common.loading")} />
      ) : query.isError ? (
        <ErrorState compact title={t("common.loadError")} onRetry={() => void query.refetch()} retryLabel={t("common.retry")} />
      ) : query.data.items.length === 0 ? (
        <EmptyState compact title={t("drawer.notifications.empty")} />
      ) : (
        <div className="web-drawer-list">
          {query.data.items.map((n) => (
            <ActivityRow
              key={n.id}
              icon={notificationIcon(n.category)}
              title={n.title}
              meta={n.body}
              severity={severityFromPriority(n.priority)}
              time={formatClockTime(n.createdAt, { locale, timeZone, hour12 })}
              onClick={
                n.targetRoute
                  ? () => {
                      setOpen(false);
                      router.push(n.targetRoute ?? "/alerts");
                    }
                  : undefined
              }
              action={
                canAcknowledge ? (
                  <IconButton
                    label={t("drawer.notifications.acknowledge")}
                    icon={<Check size={14} />}
                    size="sm"
                    onClick={(event) => {
                      event.stopPropagation();
                      acknowledge.mutate({ id: n.id, version: n.version });
                    }}
                  />
                ) : undefined
              }
            />
          ))}
        </div>
      )}
    </Drawer>
  );
}
