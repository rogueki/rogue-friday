"use client";

import { TopStatusBar, useMediaQuery, useNow, type ConnectionState, type TopBarAction } from "@jarvis/ui";
import { Bell, LayoutGrid, Settings } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { formatRelative } from "@/features/shared/time";
import { toneFromHealth } from "@/features/shared/presentation";
import { useT, type MessageKey } from "@/i18n";
import { useMeta, useJarvisStatus } from "@/lib/api/domains/core";
import { useNotifications } from "@/lib/api/domains/notifications";
import { useRealtimeStatus, type RealtimeStatus } from "@/lib/realtime/store";
import { useSession } from "@/lib/session";
import { useAppSettings } from "@/lib/settings";
import { useUiStore } from "@/lib/uiStore";

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
  const { timeZone, hour12 } = useAppSettings();
  const status = useJarvisStatus();
  const meta = useMeta();
  const session = useSession();
  const realtime = useRealtimeStatus();
  const now = useNow(1000);
  const notifications = useNotifications({ status: ["open"], limit: 20 });
  const compact = useMediaQuery("(max-width: 1599px)");
  const narrow = useMediaQuery("(max-width: 699px)");
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen);
  const setNotificationsOpen = useUiStore((s) => s.setNotificationsOpen);

  const notificationCount = notifications.data?.pageInfo.totalCount ?? notifications.data?.items.length ?? 0;
  const jarvis = status.data?.data;
  const dataMode = jarvis?.dataMode ?? meta.data?.dataMode;

  const actions = useMemo<TopBarAction[]>(() => {
    const bell: TopBarAction = {
      id: "notifications",
      label: t("top.notifications"),
      icon: <Bell size={17} strokeWidth={1.5} />,
      badge: notificationCount,
      onClick: () => setNotificationsOpen(true),
    };
    if (narrow) return [bell];
    return [
      { id: "layout", label: t("top.layout"), icon: <LayoutGrid size={17} strokeWidth={1.5} />, onClick: () => router.push("/settings") },
      bell,
      { id: "settings", label: t("top.settings"), icon: <Settings size={17} strokeWidth={1.5} />, onClick: () => router.push("/settings") },
    ];
  }, [t, router, notificationCount, setNotificationsOpen, narrow]);

  const statusLabel = jarvis ? jarvis.label.toUpperCase() : status.isError ? t("top.status.unknown") : "…";
  const statusTone = jarvis ? toneFromHealth(jarvis.status) : "muted";
  const roleText = session.role ? t(`role.${session.role}` as MessageKey) : undefined;
  const modeText = dataMode ? t(`dataMode.${dataMode}` as MessageKey) : undefined;

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
      operator={session.displayName ? { name: session.displayName, role: [roleText, compact ? undefined : modeText].filter(Boolean).join(" · ") } : undefined}
      menuLabel={t("top.openNav")}
    />
  );
}
