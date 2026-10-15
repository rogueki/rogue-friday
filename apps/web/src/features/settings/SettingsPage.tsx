"use client";

import { Button, EmptyState, ErrorState, HudPanel, Skeleton, StatusChip } from "@friday/ui";
import { isFridayApiError } from "@friday/sdk";
import {
  BadgeCheck,
  Bell,
  CircleDot,
  Code2,
  Cpu,
  Database,
  HardDriveDownload,
  LayoutDashboard,
  LayoutGrid,
  Lock,
  Menu,
  Mic,
  Palette,
  Plug,
  Save,
  Undo2,
  User,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { useT, type MessageKey } from "@/i18n";
import { useThemes } from "@/lib/api/domains/settings";
import { AdaptersArea } from "./AdaptersArea";
import { ApprovalsArea, BackupsArea, DashboardArea, DataRetentionArea, DeveloperArea, ModelsRoutingArea, NotificationsArea, ProfileArea, SecurityArea, VoiceArea } from "./BasicAreas";
import { LayoutArea } from "./LayoutArea";
import { NavigationArea } from "./NavigationArea";
import { OrbArea } from "./OrbArea";
import { SettingsDraftsProvider, useSettingsDrafts } from "./SettingsDrafts";
import { SettingsTransfer } from "./SettingsTransfer";
import { ThemeArea } from "./ThemeArea";
import { SETTINGS_AREAS, isSettingsArea, previewTheme, type DraftAreaId, type SettingsAreaId } from "./settingsLogic";
import "./settings.css";

const ICON = { size: 16, strokeWidth: 1.5 } as const;
const AREA_ICONS: Record<SettingsAreaId, ReactNode> = {
  profile: <User {...ICON} />,
  dashboard: <LayoutDashboard {...ICON} />,
  layout: <LayoutGrid {...ICON} />,
  theme: <Palette {...ICON} />,
  orb: <CircleDot {...ICON} />,
  navigation: <Menu {...ICON} />,
  adapters: <Plug {...ICON} />,
  modelsRouting: <Cpu {...ICON} />,
  voice: <Mic {...ICON} />,
  notifications: <Bell {...ICON} />,
  security: <Lock {...ICON} />,
  approvals: <BadgeCheck {...ICON} />,
  dataRetention: <Database {...ICON} />,
  backups: <HardDriveDownload {...ICON} />,
  developer: <Code2 {...ICON} />,
};

/** Draft areas whose unsaved edits the sidebar marks (Dashboard also edits the start page of Navigation). */
const AREA_DRAFTS: Partial<Record<SettingsAreaId, readonly DraftAreaId[]>> = {
  profile: ["profile"],
  dashboard: ["dashboard", "navigation"],
  theme: ["theme"],
  orb: ["orb"],
  navigation: ["navigation"],
  modelsRouting: ["modelsRouting"],
  voice: ["voice"],
  notifications: ["notifications"],
  security: ["security"],
  approvals: ["approvals"],
  dataRetention: ["dataRetention"],
  backups: ["backups"],
  developer: ["developer"],
};

const AREA_COMPONENTS: Partial<Record<SettingsAreaId, () => ReactNode>> = {
  profile: () => <ProfileArea />,
  dashboard: () => <DashboardArea />,
  theme: () => <ThemeArea />,
  orb: () => <OrbArea />,
  navigation: () => <NavigationArea />,
  modelsRouting: () => <ModelsRoutingArea />,
  voice: () => <VoiceArea />,
  notifications: () => <NotificationsArea />,
  security: () => <SecurityArea />,
  approvals: () => <ApprovalsArea />,
  dataRetention: () => <DataRetentionArea />,
  backups: () => <BackupsArea />,
  developer: () => <DeveloperArea />,
};

/** Applies the draft theme/dashboard knobs to the document while the page is open and restores the saved ones when it closes. */
function LivePreview() {
  const { settings, getValue } = useSettingsDrafts();
  const library = useThemes().data?.items;
  const theme = getValue("theme");
  const dashboard = getValue("dashboard");
  const saved = useRef({ settings, library });
  saved.current = { settings, library };

  useEffect(() => {
    if (theme && dashboard) previewTheme({ theme, dashboard }, library);
  }, [theme, dashboard, library]);

  useEffect(
    () => () => {
      const { settings: current, library: items } = saved.current;
      if (current) previewTheme(current, items);
    },
    [],
  );
  return null;
}

function SaveBar() {
  const { t } = useT();
  const { settings, readOnly, dirtyAreas, externalDirty, discard, save, saving, saveError, conflicts, resolveConflicts } = useSettingsDrafts();
  const label = (area: string): string => t(`settings.area.${area}` as MessageKey);
  const dirty = dirtyAreas.length > 0;
  return (
    <section className="st-savebar" aria-label={t("settings.save.region")} data-dirty={dirty || undefined}>
      <div className="st-savebar__status" role="status" aria-live="polite">
        {dirty ? (
          <>
            <StatusChip tone="amber" pulse>
              {t("settings.unsaved")}
            </StatusChip>
            <span>{t("settings.save.changed", { areas: dirtyAreas.map(label).join(", ") })}</span>
          </>
        ) : externalDirty.length > 0 ? (
          <StatusChip tone="amber" pulse>
            {t("settings.unsaved.local")}
          </StatusChip>
        ) : (
          <span className="st-muted">{settings ? t("settings.save.clean", { version: settings.version }) : ""}</span>
        )}
      </div>
      {conflicts.length > 0 ? (
        <div className="st-savebar__conflict" role="alert">
          <span>{t("settings.save.serverChanged", { areas: conflicts.map(label).join(", ") })}</span>
          <Button type="button" size="sm" variant="ghost" onClick={() => resolveConflicts("server")}>
            {t("settings.save.takeServer")}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => resolveConflicts("mine")}>
            {t("settings.save.keepMine")}
          </Button>
        </div>
      ) : null}
      {saveError ? (
        <p className="st-error st-savebar__error" role="alert">
          {saveError}
        </p>
      ) : null}
      <div className="st-savebar__actions">
        <Button type="button" variant="ghost" icon={<Undo2 size={15} />} disabled={!dirty || saving} onClick={() => discard()}>
          {t("settings.discardAll")}
        </Button>
        <Button type="button" icon={<Save size={15} />} loading={saving} disabled={readOnly || !dirty || conflicts.length > 0} onClick={() => void save()}>
          {t("settings.save")}
        </Button>
      </div>
    </section>
  );
}

function SettingsBody() {
  const { t } = useT();
  const router = useRouter();
  const params = useSearchParams();
  const drafts = useSettingsDrafts();
  const adapterParam = params.get("adapter");
  const requested = params.get("area");
  // `/settings?adapter=<id>` is the "Adapter konfigurieren" link of offline panels.
  const area: SettingsAreaId = isSettingsArea(requested) ? requested : adapterParam ? "adapters" : "profile";

  const go = (next: SettingsAreaId, extra?: Record<string, string>): void => {
    const query = new URLSearchParams({ area: next, ...extra });
    router.replace(`/settings?${query.toString()}`, { scroll: false });
  };

  const areaDirty = (id: SettingsAreaId): boolean => {
    if (id === "layout") return drafts.externalDirty.includes("layout");
    if (id === "adapters") return drafts.externalDirty.some((key) => key.startsWith("adapter:"));
    return (AREA_DRAFTS[id] ?? []).some((draftArea) => drafts.dirtyAreas.includes(draftArea));
  };

  let content: ReactNode;
  if (drafts.isLoading) {
    content = (
      <div className="web-panel-skeleton" aria-busy="true">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} variant="row" height={44} label={t("common.loading")} />
        ))}
      </div>
    );
  } else if (drafts.isError || !drafts.settings) {
    const api = isFridayApiError(drafts.error) ? drafts.error : null;
    content = (
      <ErrorState
        compact
        title={t("settings.loadError")}
        description={api?.message}
        code={api?.code}
        correlationId={api?.correlationId}
        onRetry={drafts.refetch}
        retryLabel={t("common.retry")}
        labels={{ copy: t("common.copy"), copied: t("common.copied"), correlation: t("common.correlationId") }}
      />
    );
  } else if (area === "adapters") {
    content = <AdaptersArea selectedId={adapterParam} onSelect={(id) => go("adapters", { adapter: id })} />;
  } else if (area === "layout") {
    content = <LayoutArea />;
  } else {
    content = AREA_COMPONENTS[area]?.() ?? <EmptyState title={t("common.empty")} />;
  }
  const framed = area === "adapters" || area === "layout";

  return (
    <div className="st-page">
      <LivePreview />
      <header className="st-header">
        <div>
          <h1 className="st-header__title">{t("nav.settings")}</h1>
          <p className="st-header__desc">{t("page.settings.description")}</p>
        </div>
        <SettingsTransfer />
      </header>
      {drafts.readOnly && drafts.settings ? (
        <p className="st-readonly" role="status">
          {t("settings.readOnlyRole", { role: drafts.role ? t(`settings.role.${drafts.role}` as MessageKey) : "—" })}
        </p>
      ) : null}
      <div className="st-shell">
        <nav className="st-areas" aria-label={t("settings.areas")}>
          <ul>
            {SETTINGS_AREAS.map((id) => (
              <li key={id} data-sub={id === "layout" || undefined}>
                <button type="button" className="st-areas__item" aria-current={area === id ? "page" : undefined} onClick={() => go(id)}>
                  <span className="st-areas__icon" aria-hidden="true">
                    {AREA_ICONS[id]}
                  </span>
                  <span>{t(`settings.area.${id}` as MessageKey)}</span>
                  {areaDirty(id) ? (
                    <span className="st-areas__dirty" role="img" aria-label={t("settings.unsaved")} title={t("settings.unsaved")} />
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        {framed ? (
          <div className="st-content st-content--bare" role="region" aria-label={t(`settings.area.${area}` as MessageKey)}>
            {content}
          </div>
        ) : (
          <HudPanel
            className="st-content"
            as="section"
            title={t(`settings.area.${area}` as MessageKey)}
            subtitle={t(`settings.area.${area}.desc` as MessageKey)}
            icon={AREA_ICONS[area]}
            padding="lg"
            scroll
          >
            {content}
          </HudPanel>
        )}
      </div>
      <SaveBar />
    </div>
  );
}

export function SettingsPage() {
  return (
    <SettingsDraftsProvider>
      <SettingsBody />
    </SettingsDraftsProvider>
  );
}
