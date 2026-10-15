"use client";

import { JarvisShell, LeftCommandNav } from "@jarvis/ui";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { CommandConfirmHost } from "@/features/palette/commandRunner";
import { CreateTaskDialog } from "@/features/palette/CreateTaskDialog";
import { GlobalCommandPalette, usePaletteShortcuts } from "@/features/palette/GlobalCommandPalette";
import { useT } from "@/i18n";
import { useUpdateSettings } from "@/lib/api/domains/settings";
import { useAppSettings } from "@/lib/settings";
import { AppBottomBar } from "./AppBottomBar";
import { AppTopBar } from "./AppTopBar";
import { OfflineCacheBanner } from "./OfflineCacheBanner";
import { ErrorDetailDrawer, LiveActivityDrawer, NotificationsDrawer } from "./drawers";
import { pageRoute, useNavItems } from "./navModel";
import { VoiceNavPanel } from "./VoiceNavPanel";

/** Dashboard frame: left navigation, top status bar, persistent command bar and the global overlays. */
export function AppShell({ children }: { children: ReactNode }) {
  const { t, assistantName } = useT();
  const router = useRouter();
  const { settings } = useAppSettings();
  const { items, activeId } = useNavItems();
  const updateSettings = useUpdateSettings();
  usePaletteShortcuts();

  // The nav width follows settings.navigation.mode; toggling writes it back (reversible, applied optimistically).
  const [collapsed, setCollapsed] = useState(false);
  const storedMode = settings?.navigation.mode;
  useEffect(() => {
    if (storedMode) setCollapsed(storedMode === "compact");
  }, [storedMode]);

  const onCollapsedChange = (next: boolean): void => {
    setCollapsed(next);
    if (settings) updateSettings.mutate({ version: settings.version, patch: { navigation: { ...settings.navigation, mode: next ? "compact" : "expanded" } } });
  };

  return (
    <>
      <JarvisShell
        drawerBreakpoint={1100}
        navCollapsed={collapsed}
        onNavCollapsedChange={onCollapsedChange}
        skipLinkLabel={t("shell.skip")}
        mainLabel={t("shell.main")}
        navDrawerLabel={t("shell.nav")}
        nav={
          <LeftCommandNav
            items={items}
            activeId={activeId}
            onNavigate={(id) => router.push(pageRoute(id))}
            navLabel={t("shell.nav")}
            collapseLabel={t("shell.nav.collapse")}
            expandLabel={t("shell.nav.expand")}
            brand={{ title: assistantName, subtitle: t("brand.subtitle") }}
            footer={<VoiceNavPanel />}
          />
        }
        topBar={<AppTopBar />}
        bottomBar={<AppBottomBar />}
      >
        <OfflineCacheBanner />
        {children}
      </JarvisShell>
      <GlobalCommandPalette />
      <CreateTaskDialog />
      <CommandConfirmHost />
      <NotificationsDrawer />
      <LiveActivityDrawer />
      <ErrorDetailDrawer />
    </>
  );
}
