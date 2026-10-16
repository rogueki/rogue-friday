"use client";

import { FridayShell, LeftCommandNav } from "@friday/ui";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { CommandConfirmHost } from "@/features/palette/commandRunner";
import { CreateTaskDialog } from "@/features/palette/CreateTaskDialog";
import { GlobalCommandPalette, usePaletteShortcuts } from "@/features/palette/GlobalCommandPalette";
import { useT } from "@/i18n";
import { useUpdateSettings } from "@/lib/api/domains/settings";
import { useOnboarding } from "@/lib/api/domains/skills";
import { useAppSettings } from "@/lib/settings";
import { useSession } from "@/lib/session";
import { isOnboardingSnoozed, snoozeOnboarding } from "@/features/skills/onboardingSnooze";
import { OnboardingPage } from "@/features/skills/OnboardingPage";
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
  const pathname = usePathname();
  const session = useSession();
  const onboarding = useOnboarding(session.role === "owner" && !session.offline);
  const { settings } = useAppSettings();
  const { items, activeId } = useNavItems();
  const updateSettings = useUpdateSettings();
  const [onboardingClosed, setOnboardingClosed] = useState(false);
  usePaletteShortcuts();
  const onboardingState = onboarding.data?.data;
  const showOnboarding = session.role === "owner" && !session.offline && pathname === "/" && !onboardingClosed && !isOnboardingSnoozed() &&
    onboardingState?.completedAt === null && Object.values(onboardingState.steps).some((step) => step === "pending");

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
      <FridayShell
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
      </FridayShell>
      {showOnboarding && <aside className="sk-onboarding-popup" aria-labelledby="sk-onboarding-title" onKeyDown={(event) => {
        if (event.key === "Escape") { event.stopPropagation(); snoozeOnboarding(); setOnboardingClosed(true); }
      }}><OnboardingPage popup onClose={() => setOnboardingClosed(true)} /></aside>}
      <GlobalCommandPalette />
      <CreateTaskDialog />
      <CommandConfirmHost />
      <NotificationsDrawer />
      <LiveActivityDrawer />
      <ErrorDetailDrawer />
    </>
  );
}
