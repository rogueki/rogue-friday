"use client";

import { defaultTheme, getTheme, parseColor } from "@friday/design-tokens";
import { OrbFallback2D } from "@friday/orb";
import type { OrbStatus, Theme } from "@friday/sdk";
import { Button, EmptyState, HudPanel, Slider, StatusChip, Switch, TagPill } from "@friday/ui";
import { Download, FileUp, RotateCcw, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useT } from "@/i18n";
import { useImportTheme, useThemes } from "@/lib/api/domains/settings";
import { PanelFrame, type PanelState } from "@/components/PanelFrame";
import { FieldGrid, Section, TextAreaField } from "./controls";
import { useAreaDraft } from "./SettingsDrafts";
import { downloadJson, parseThemeImport, resolveRuntimeTheme, slugify } from "./settingsLogic";
import type { MessageKey } from "@/i18n";

/** Static idle orb for the preview: the real orb identity (gold core, circuit shell) drawn once, no animation loop. */
const PREVIEW_ORB_STATUS: OrbStatus = { mode: "idle", health: "online", since: "2026-01-01T00:00:00.000Z", urgency: "none", progressMode: "none" };
const PREVIEW_ORB_SETTINGS = { animations: "off" } as const;

/** Tokens a user can recolour in the editor (all of them exist in the design-token map, so they apply live). */
const EDITABLE_TOKENS = [
  { key: "color.primary", label: "settings.theme.token.primary" },
  { key: "color.primaryBright", label: "settings.theme.token.primaryBright" },
  { key: "color.background", label: "settings.theme.token.background" },
  { key: "color.orb", label: "settings.theme.token.orb" },
  { key: "color.orbHot", label: "settings.theme.token.orbHot" },
  { key: "color.success", label: "settings.theme.token.success" },
  { key: "color.warning", label: "settings.theme.token.warning" },
  { key: "color.error", label: "settings.theme.token.error" },
] as const satisfies readonly { key: string; label: MessageKey }[];

const hex2 = (n: number): string => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0");

/** `<input type=color>` only accepts #rrggbb; theme tokens may carry alpha or rgb(). */
export function toColorInput(value: string | undefined): string {
  const parsed = value ? parseColor(value) : null;
  return parsed ? `#${hex2(parsed.r)}${hex2(parsed.g)}${hex2(parsed.b)}` : "#000000";
}

function Swatches({ theme }: { theme: Theme }) {
  const colors = [theme.tokens["color.background"], theme.tokens["color.primary"], theme.tokens["color.orb"] ?? theme.tokens["color.accent.gold"]].filter((c): c is string => Boolean(c));
  return (
    <span className="st-swatches" aria-hidden="true">
      {colors.map((color, index) => (
        <span key={index} className="st-swatch" style={{ background: color }} />
      ))}
    </span>
  );
}

export function ThemeArea() {
  const { t } = useT();
  const { value, update, set, readOnly } = useAreaDraft("theme");
  const themes = useThemes();
  const importTheme = useImportTheme();
  const library = themes.data?.items;
  const fileRef = useRef<HTMLInputElement>(null);
  const [importText, setImportText] = useState("");
  const [activate, setActivate] = useState(true);
  const [importErrors, setImportErrors] = useState<string[] | null>(null);
  const [imported, setImported] = useState<string | null>(null);

  const defaultId = library?.find((theme) => theme.builtIn)?.id ?? defaultTheme.id;
  const known = useMemo(() => Boolean(value && (getTheme(value.activeThemeId) || library?.some((theme) => theme.id === value.activeThemeId))), [value, library]);
  if (!value) return null;

  const active = resolveRuntimeTheme(value.activeThemeId, undefined, library);
  const overrides = value.overrides ?? {};
  const setOverride = (key: string, color: string | null): void => {
    const next = { ...overrides };
    if (color === null) delete next[key];
    else next[key] = color;
    const { overrides: _old, ...rest } = value;
    set(Object.keys(next).length > 0 ? { ...rest, overrides: next } : rest);
  };
  const pickTheme = (id: string): void => {
    const { overrides: _old, ...rest } = value;
    set({ ...rest, activeThemeId: id });
  };

  const runImport = async (): Promise<void> => {
    setImported(null);
    const parsed = parseThemeImport(importText);
    if (!parsed.ok) {
      setImportErrors(parsed.errors);
      return;
    }
    setImportErrors(null);
    try {
      const response = await importTheme.mutateAsync({ theme: parsed.value, activate });
      setImported(response.data.name);
      setImportText("");
    } catch (error) {
      setImportErrors([error instanceof Error ? error.message : t("settings.theme.import.failed")]);
    }
  };

  const exportActive = (): void => {
    const source = library?.find((theme) => theme.id === value.activeThemeId);
    const tokens = { ...(source?.tokens ?? active.tokens), ...overrides };
    const theme: Theme = {
      id: source?.id ?? active.id,
      name: source?.name ?? active.name,
      ...(source?.description ? { description: source.description } : {}),
      builtIn: false,
      tokens: tokens as Theme["tokens"],
      orb: source?.orb ?? { preset: "gold", particleDensity: 0.72, fragmentDensity: 0.82, glowIntensity: 0.78, motionSpeed: 1, mouseParallax: true },
      panels: source?.panels ?? { cornerStyle: "technical-cut", borderIntensity: 0.55, backgroundOpacity: 0.88 },
    };
    downloadJson(`${slugify(theme.id) || "theme"}.theme.json`, theme);
  };

  let libraryState: PanelState;
  if (themes.isPending) libraryState = { kind: "loading" };
  else if (themes.isError) libraryState = { kind: "error", error: themes.error, onRetry: () => void themes.refetch(), retrying: themes.isFetching };
  else if ((library ?? []).length === 0) libraryState = { kind: "empty", title: t("settings.theme.library.empty") };
  else libraryState = { kind: "ready", freshness: themes.data?.freshness, onRefresh: () => void themes.refetch() };

  return (
    <>
      {!known ? (
        <div className="st-warning" role="alert">
          <span>{t("settings.theme.unknown", { id: value.activeThemeId })}</span>
          <Button type="button" size="sm" variant="ghost" icon={<RotateCcw size={14} />} disabled={readOnly} onClick={() => pickTheme(defaultId)}>
            {t("settings.theme.useDefault")}
          </Button>
        </div>
      ) : null}

      <Section title={t("settings.theme.library")} description={t("settings.theme.libraryDesc")}>
        <PanelFrame state={libraryState} skeletonRows={2} className="st-inner-panel" padding="sm" brackets={false}>
          <div className="st-themes" role="radiogroup" aria-label={t("settings.theme.library")}>
            {(library ?? []).map((theme) => {
              const selected = theme.id === value.activeThemeId;
              return (
                <button key={theme.id} type="button" role="radio" aria-checked={selected} disabled={readOnly} className="st-theme" data-selected={selected || undefined} onClick={() => pickTheme(theme.id)}>
                  <Swatches theme={theme} />
                  <span className="st-theme__name">{theme.name}</span>
                  {theme.description ? <span className="st-theme__desc">{theme.description}</span> : null}
                  <span className="st-theme__tags">
                    {theme.builtIn ? <TagPill tone="muted">{t("settings.theme.builtIn")}</TagPill> : <TagPill tone="violet">{t("settings.theme.custom")}</TagPill>}
                    {selected ? <TagPill tone="cyan">{t("settings.theme.active")}</TagPill> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </PanelFrame>
      </Section>

      <Section title={t("settings.theme.editor")} description={t("settings.theme.editorDesc")}>
        <div className="st-theme-editor">
          <div className="st-theme-editor__controls">
            <Slider label={t("settings.theme.cyan")} min={0} max={1} step={0.05} value={value.cyanIntensity} disabled={readOnly} formatValue={(v) => `${Math.round(v * 100)} %`} onValueChange={(cyanIntensity) => update({ cyanIntensity })} />
            <Slider label={t("settings.theme.panelOpacity")} min={0} max={1} step={0.02} value={value.panelOpacity} disabled={readOnly} formatValue={(v) => `${Math.round(v * 100)} %`} onValueChange={(panelOpacity) => update({ panelOpacity })} />
            <Slider label={t("settings.theme.gold")} min={0} max={1} step={0.05} value={value.goldIntensity} disabled={readOnly} formatValue={(v) => `${Math.round(v * 100)} %`} onValueChange={(goldIntensity) => update({ goldIntensity })} />
            <div className="st-colors">
              <span className="jv-field__label">{t("settings.theme.tokens")}</span>
              <ul className="st-colors__list">
                {EDITABLE_TOKENS.map(({ key, label }) => {
                  const effective = overrides[key] ?? active.tokens[key] ?? defaultTheme.tokens[key];
                  const overridden = key in overrides;
                  return (
                    <li key={key} className="st-color">
                      <label className="st-color__label">
                        <input
                          type="color"
                          className="st-color__input"
                          aria-label={t(label)}
                          value={toColorInput(effective)}
                          disabled={readOnly}
                          onChange={(event) => setOverride(key, event.target.value)}
                        />
                        <span>{t(label)}</span>
                      </label>
                      <code className="st-mono st-muted">{overridden ? overrides[key] : (effective ?? "—")}</code>
                      {overridden && !readOnly ? (
                        <button type="button" className="st-iconbtn" aria-label={t("settings.theme.resetToken", { name: t(label) })} onClick={() => setOverride(key, null)}>
                          <RotateCcw size={13} strokeWidth={1.75} aria-hidden="true" />
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
          <HudPanel className="st-preview" title={t("settings.theme.preview")} subtitle={t("settings.theme.previewDesc")} level={2} padding="md">
            <div className="st-preview__body">
              <span className="st-preview__orb" aria-hidden="true">
                <OrbFallback2D status={PREVIEW_ORB_STATUS} settings={PREVIEW_ORB_SETTINGS} />
              </span>
              <div className="st-preview__chips">
                <StatusChip tone="cyan">{t("settings.theme.preview.chip")}</StatusChip>
                <StatusChip tone="green">{t("settings.theme.preview.ok")}</StatusChip>
                <StatusChip tone="amber">{t("settings.theme.preview.warn")}</StatusChip>
                <StatusChip tone="red">{t("settings.theme.preview.err")}</StatusChip>
              </div>
              <div className="st-preview__actions">
                <Button size="sm">{t("settings.theme.preview.primary")}</Button>
                <Button size="sm" variant="ghost">
                  {t("settings.theme.preview.ghost")}
                </Button>
                <Button size="sm" variant="friday">
                  {t("settings.theme.preview.gold")}
                </Button>
              </div>
            </div>
          </HudPanel>
        </div>
        <div className="st-row">
          <Button type="button" variant="ghost" icon={<RotateCcw size={14} />} disabled={readOnly} onClick={() => pickTheme(defaultId)}>
            {t("settings.theme.useDefault")}
          </Button>
          <Button type="button" variant="ghost" icon={<Download size={14} />} onClick={exportActive}>
            {t("settings.theme.export")}
          </Button>
        </div>
      </Section>

      <Section title={t("settings.theme.import.title")} description={t("settings.theme.import.desc")}>
        {readOnly ? (
          <EmptyState compact title={t("settings.readOnly")} />
        ) : (
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="st-file"
              aria-label={t("settings.theme.import.file")}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                void file.text().then((text) => {
                  setImportText(text);
                  setImportErrors(null);
                  setImported(null);
                });
              }}
            />
            <TextAreaField
              label={t("settings.theme.import.json")}
              value={importText}
              rows={7}
              placeholder='{ "id": "mein-theme", "name": "Mein Theme", … }'
              onValueChange={(text) => {
                setImportText(text);
                setImportErrors(null);
                setImported(null);
              }}
            />
            <FieldGrid>
              <Switch label={t("settings.theme.import.activate")} checked={activate} stateLabels={[t("settings.state.on"), t("settings.state.off")]} onCheckedChange={setActivate} />
              <div className="st-row">
                <Button type="button" variant="ghost" icon={<FileUp size={14} />} onClick={() => fileRef.current?.click()}>
                  {t("settings.theme.import.choose")}
                </Button>
                <Button type="button" icon={<Upload size={14} />} disabled={importText.trim() === ""} loading={importTheme.isPending} onClick={() => void runImport()}>
                  {t("settings.theme.import.run")}
                </Button>
              </div>
            </FieldGrid>
            {importErrors ? (
              <div className="st-errorlist" role="alert">
                <strong>{t("settings.theme.import.invalid")}</strong>
                <ul>
                  {importErrors.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <span className="st-muted">{t("settings.theme.import.fallback")}</span>
              </div>
            ) : null}
            {imported ? <p className="st-success" role="status">{t("settings.theme.import.done", { name: imported })}</p> : null}
          </>
        )}
      </Section>
    </>
  );
}
