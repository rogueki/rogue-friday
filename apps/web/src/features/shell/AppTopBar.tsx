"use client";

import { TopStatusBar, useMediaQuery, useNow, type ConnectionState, type TopBarAction } from "@friday/ui";
import { Bell, BellOff, Compass, Download, LayoutGrid, Settings } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { quietModeStatusLabel } from "@/features/settings/QuietModeControl";
import { formatRelative } from "@/features/shared/time";
import { toneFromHealth } from "@/features/shared/presentation";
import { useTour } from "@/features/tour/DashboardTour";
import { useT, type MessageKey } from "@/i18n";
import { useFridayStatus } from "@/lib/api/domains/core";
import { useNotifications, useQuietMode } from "@/lib/api/domains/notifications";
import { useRealtimeStatus, type RealtimeStatus } from "@/lib/realtime/store";
import { useSession } from "@/lib/session";
import { useAppSettings } from "@/lib/settings";
import { useUiStore } from "@/lib/uiStore";
import { useDashboardUpdateStatus } from "@/lib/api/dashboardUpdate";

const STREAM_KEYS: Record<RealtimeStatus["state"], MessageKey> = {
  online: "stream.online",
  degraded: "stream.degraded",
  offline: "stream.offline",
  connecting: "stream.connecting",
  polling: "stream.polling",
};

const CONNECTION: Record<RealtimeStatus["state"], ConnectionState> = {
  online: "online",
  degraded: "degraded",
  offline: "offline",
  connecting: "connecting",
  polling: "degraded",
};

/** "Event-Stream online · 28 ms · vor 2 s" (PLAN §12.6). */
export function streamLabel(status: RealtimeStatus, now: number, locale: string, t: (key: MessageKey) => string, compact = false): string {
  const state = t(STREAM_KEYS[status.state]);
  const parts: string[] = [compact ? state : `${t("stream.label")} ${state}`];
  if (status.state === "online" || status.state === "degraded") {
    if (status.roundtripMs !== null) parts.push(`${Math.round(status.roundtripMs)} ms`);
    if (status.lastEventAt !== null) parts.push(formatRelative(status.lastEventAt, now, locale));
  }
  return parts.join(" · ");
}

export function AppTopBar() {
  const router = useRouter();
  const { t, locale } = useT();
  const { timeZone, hour12, settings } = useAppSettings();
  const status = useFridayStatus();
  const session = useSession();
  const dashboardUpdate = useDashboardUpdateStatus(session.role === "owner");
  const realtime = useRealtimeStatus();
  const now = useNow(1000);
  const notifications = useNotifications({ status: ["open"], limit: 20 });
  const quietMode = useQuietMode(Boolean(session.role));
  const compact = useMediaQuery("(max-width: 1599px)");
  const narrow = useMediaQuery("(max-width: 699px)");
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen);
  const setNotificationsOpen = useUiStore((s) => s.setNotificationsOpen);
  const tour = useTour();

  const notificationCount = notifications.data?.pageInfo.totalCount ?? notifications.data?.items.length ?? 0;
  const friday = status.data?.data;
  const quiet = quietMode.data?.data;

  const actions = useMemo<TopBarAction[]>(() => {
    const quietModeAction: TopBarAction[] = quiet?.active
      ? [{
          id: "quiet-mode",
          label: quietModeStatusLabel(quiet.source, quiet.until, t, locale, timeZone),
          icon: <BellOff size={17} strokeWidth={1.5} />,
          onClick: () => router.push("/settings?area=notifications"),
        }]
      : [];
    const bell: TopBarAction = {
      id: "notifications",
      label: t("top.notifications"),
      icon: <Bell size={17} strokeWidth={1.5} />,
      badge: notificationCount,
      onClick: () => setNotificationsOpen(true),
    };
    const update: TopBarAction = { id: "dashboard-update", label: t("settings.update.available"), icon: <Download size={17} strokeWidth={1.5} />, badge: 1,
      onClick: () => router.push("/settings?area=dashboard#dashboard-update-title") };
    const tourAction: TopBarAction[] = session.role === "owner"
      ? [{ id: "dashboard-tour", label: "Dashboard-Tour", icon: <Compass size={17} strokeWidth={1.5} />, onClick: () => tour.start() }]
      : [];
    if (narrow) return [...(dashboardUpdate.data?.available ? [update] : []), ...quietModeAction, bell];
    return [
      ...(dashboardUpdate.data?.available ? [update] : []),
      { id: "layout", label: t("top.layout"), icon: <LayoutGrid size={17} strokeWidth={1.5} />, onClick: () => router.push("/settings") },
      ...tourAction,
      ...quietModeAction,
      bell,
      { id: "settings", label: t("top.settings"), icon: <Settings size={17} strokeWidth={1.5} />, onClick: () => router.push("/settings") },
    ];
  }, [t, locale, timeZone, router, notificationCount, setNotificationsOpen, narrow, dashboardUpdate.data?.available, quiet, tour, session.role]);

  const statusLabel = friday ? friday.label.toUpperCase() : status.isError ? t("top.status.unknown") : "…";
  const statusTone = friday ? toneFromHealth(friday.status) : "muted";
  const roleText = session.role ? t(`role.${session.role}` as MessageKey) : undefined;
  const displayName = settings?.profile.displayName || session.displayName;

  return (
    <TopStatusBar
      statusLabel={t("top.systemStatus")}
      status={{ label: statusLabel, tone: statusTone }}
      connection={{ state: CONNECTION[realtime.state], label: streamLabel(realtime, now.getTime(), locale, t, compact) }}
      locale={locale === "de" ? "de-DE" : "en-GB"}
      timeZone={timeZone}
      hour12={hour12}
      onSearchClick={() => setPaletteOpen(true)}
      searchLabel={t("top.search")}
      actions={actions}
      operator={displayName ? { name: displayName, role: roleText ?? "" } : undefined}
      menuLabel={t("top.openNav")}
    />
  );
}
