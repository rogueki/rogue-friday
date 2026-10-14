"use client";

import {
  applyTheme,
  defaultTheme,
  getTheme,
  setMotionMode,
  type JarvisTheme,
  type ThemeSettings as RuntimeThemeSettings,
} from "@jarvis/design-tokens";
import type { Settings, Theme } from "@jarvis/sdk";
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useSettings, useThemes } from "./api/domains/settings";
import { useMeta } from "./api/domains/core";
import { I18nProvider, type Locale } from "@/i18n";

export interface AppSettingsValue {
  settings: Settings | undefined;
  isLoading: boolean;
  locale: Locale;
  timeZone: string | undefined;
  hour12: boolean | undefined;
}

const AppSettingsContext = createContext<AppSettingsValue>({
  settings: undefined,
  isLoading: true,
  locale: "de",
  timeZone: undefined,
  hour12: undefined,
});

/** Server theme (wire shape) -> design-tokens theme. Invalid results fall back to the default theme inside applyTheme. */
function fromWireTheme(theme: Theme): JarvisTheme {
  return {
    id: theme.id,
    name: theme.name,
    version: 1,
    tokens: theme.tokens,
    orb: theme.orb,
    panels: { ...theme.panels, cornerStyle: theme.panels.cornerStyle === "rounded" ? "soft-cut" : theme.panels.cornerStyle },
    effects: { gridVisibility: 1, cyanIntensity: 1 },
  } as unknown as JarvisTheme;
}

export function runtimeThemeSettings(settings: Settings): Partial<RuntimeThemeSettings> {
  return {
    cyanIntensity: settings.theme.cyanIntensity,
    // 0.88 is the reference panel opacity of the default theme (PLAN §25.3); lower opacity = more transparency.
    panelTransparency: Math.min(1, Math.max(0, 1 - settings.theme.panelOpacity / 0.88)),
    orbGoldIntensity: settings.theme.goldIntensity,
    gridVisibility: settings.dashboard.backgroundGrid ? 1 : 0,
    fontScale: settings.dashboard.fontScale,
  };
}

/**
 * Loads /settings and applies theme, theme knobs, motion mode and locale to the document live (PLAN §25.2): a PATCH
 * (or an optimistic cache edit) re-runs the effects, no reload and no rebuild.
 */
export function AppSettingsProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const settingsQuery = useSettings(enabled);
  const themesQuery = useThemes(enabled);
  const meta = useMeta();
  const settings = settingsQuery.data?.data;
  const themes = themesQuery.data?.items;

  useEffect(() => {
    if (!settings) return;
    const base = getTheme(settings.theme.activeThemeId) ?? themes?.map(fromWireTheme).find((t) => t.id === settings.theme.activeThemeId) ?? defaultTheme;
    const overrides = settings.theme.overrides;
    const theme = overrides ? { ...base, tokens: { ...base.tokens, ...overrides } } : base;
    applyTheme(theme, { settings: runtimeThemeSettings(settings) });
  }, [settings, themes]);

  // A scenario can force reduced motion (PLAN §45.13) through the meta feature flags; it never raises the user's setting.
  const forceReducedMotion = Boolean(meta.data?.features.reducedMotion);
  useEffect(() => {
    if (!settings) return;
    setMotionMode(forceReducedMotion && settings.orb.animations === "full" ? "reduced" : settings.orb.animations);
  }, [settings, forceReducedMotion]);

  const locale: Locale = settings?.profile.locale ?? meta.data?.defaultLocale ?? "de";
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<AppSettingsValue>(
    () => ({
      settings,
      isLoading: enabled && settingsQuery.isPending,
      locale,
      timeZone: settings?.profile.timeZone,
      hour12: settings ? settings.profile.timeFormat === "12h" : undefined,
    }),
    [settings, enabled, settingsQuery.isPending, locale],
  );

  return (
    <AppSettingsContext.Provider value={value}>
      <I18nProvider locale={locale}>{children}</I18nProvider>
    </AppSettingsContext.Provider>
  );
}

export function useAppSettings(): AppSettingsValue {
  return useContext(AppSettingsContext);
}
