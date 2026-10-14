"use client";

import type { NavItem } from "@jarvis/ui";
import {
  Activity,
  Bell,
  Bot,
  CalendarDays,
  Cpu,
  Database,
  FlaskConical,
  FolderOpen,
  History,
  LayoutDashboard,
  ListChecks,
  Mail,
  Mic,
  Settings,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { useMemo, type ReactNode } from "react";
import { useOverview } from "@/lib/api/domains/core";
import { useAppSettings } from "@/lib/settings";
import { useT, type MessageKey } from "@/i18n";

export type NavPageId =
  | "overview"
  | "tasks"
  | "activity"
  | "memory"
  | "agents"
  | "approvals"
  | "communication"
  | "calendar"
  | "automations"
  | "research"
  | "files"
  | "voice"
  | "alerts"
  | "system"
  | "audit"
  | "settings";

interface NavPage {
  id: NavPageId;
  route: string;
  labelKey: MessageKey;
  icon: ReactNode;
  badge?: "tasks" | "approvals" | "mail" | "alerts";
}

const ICON = { size: 18, strokeWidth: 1.5 } as const;

/** The 16 pages of PLAN §26 in their default order; settings.navigation overrides order and visibility. */
export const NAV_PAGES: readonly NavPage[] = [
  { id: "overview", route: "/", labelKey: "nav.overview", icon: <LayoutDashboard {...ICON} /> },
  { id: "tasks", route: "/tasks", labelKey: "nav.tasks", icon: <ListChecks {...ICON} />, badge: "tasks" },
  { id: "activity", route: "/activity", labelKey: "nav.activity", icon: <Activity {...ICON} /> },
  { id: "memory", route: "/memory", labelKey: "nav.memory", icon: <Database {...ICON} /> },
  { id: "agents", route: "/agents", labelKey: "nav.agents", icon: <Bot {...ICON} /> },
  { id: "approvals", route: "/approvals", labelKey: "nav.approvals", icon: <ShieldCheck {...ICON} />, badge: "approvals" },
  { id: "communication", route: "/communication", labelKey: "nav.communication", icon: <Mail {...ICON} />, badge: "mail" },
  { id: "calendar", route: "/calendar", labelKey: "nav.calendar", icon: <CalendarDays {...ICON} /> },
  { id: "automations", route: "/automations", labelKey: "nav.automations", icon: <Workflow {...ICON} /> },
  { id: "research", route: "/research", labelKey: "nav.research", icon: <FlaskConical {...ICON} /> },
  { id: "files", route: "/files", labelKey: "nav.files", icon: <FolderOpen {...ICON} /> },
  { id: "voice", route: "/voice", labelKey: "nav.voice", icon: <Mic {...ICON} /> },
  { id: "alerts", route: "/alerts", labelKey: "nav.alerts", icon: <Bell {...ICON} />, badge: "alerts" },
  { id: "system", route: "/system", labelKey: "nav.system", icon: <Cpu {...ICON} /> },
  { id: "audit", route: "/audit", labelKey: "nav.audit", icon: <History {...ICON} /> },
  { id: "settings", route: "/settings", labelKey: "nav.settings", icon: <Settings {...ICON} /> },
];

/** Applies the stored order; unknown ids are ignored and pages missing from the list are appended (never lost). */
export function orderNavPages(order: readonly string[] | undefined, hidden: readonly string[] | undefined): NavPage[] {
  const byId = new Map(NAV_PAGES.map((page) => [page.id as string, page]));
  const ordered: NavPage[] = [];
  for (const id of order ?? []) {
    const page = byId.get(id);
    if (page && !ordered.includes(page)) ordered.push(page);
  }
  for (const page of NAV_PAGES) if (!ordered.includes(page)) ordered.push(page);
  // The settings page stays reachable even if someone hid it, otherwise the setting could never be undone.
  return ordered.filter((page) => page.id === "settings" || !(hidden ?? []).includes(page.id));
}

export function activePageId(pathname: string): NavPageId {
  const clean = pathname.replace(/\/+$/, "") || "/";
  const match = NAV_PAGES.find((page) => (page.route === "/" ? clean === "/" : clean === page.route || clean.startsWith(`${page.route}/`)));
  return match?.id ?? "overview";
}

export function pageRoute(id: string): string {
  return NAV_PAGES.find((page) => page.id === id)?.route ?? "/";
}

export function useNavItems(): { items: NavItem[]; activeId: NavPageId } {
  const pathname = usePathname();
  const { t } = useT();
  const { settings } = useAppSettings();
  const counters = useOverview().data?.data.counters;
  const order = settings?.navigation.order;
  const hidden = settings?.navigation.hidden;

  const items = useMemo<NavItem[]>(
    () =>
      orderNavPages(order, hidden).map((page) => {
        const count = page.badge ? counters?.[page.badge] : undefined;
        return {
          id: page.id,
          label: t(page.labelKey),
          icon: page.icon,
          href: page.route,
          badge: count || undefined,
          badgeLabel: count ? t(`nav.badge.${page.badge}` as MessageKey, { count }) : undefined,
          badgeTone: page.badge === "alerts" ? "red" : page.badge === "approvals" ? "amber" : undefined,
        };
      }),
    [order, hidden, counters, t],
  );
  return { items, activeId: activePageId(pathname) };
}
