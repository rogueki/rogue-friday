"use client";

import type { OrbMode, Settings } from "@jarvis/sdk";
import { Button, Select, Slider, StatusChip, Switch } from "@jarvis/ui";
import { RotateCcw } from "lucide-react";
import { useT, type MessageKey } from "@/i18n";
import { FieldGrid, Section } from "./controls";
import { useAreaDraft } from "./SettingsDrafts";
import { DEFAULT_STATUS_COLORS, ORB_MODES, ORB_PRESETS } from "./settingsLogic";

/** Orb settings (PLAN §23.2, §42.3). The gold core is invariant: status colours are secondary accents only. */
export function OrbArea() {
  const { t } = useT();
  const { value, update, readOnly } = useAreaDraft("orb");
  if (!value) return null;
  const onOff = [t("settings.state.on"), t("settings.state.off")] as const;
  const presets = (ORB_PRESETS as readonly string[]).includes(value.preset) ? [...ORB_PRESETS] : [value.preset, ...ORB_PRESETS];
  const colorModes = ORB_MODES.filter((mode) => mode !== "booting" && mode !== "idle");
  const setColor = (mode: OrbMode, color: string): void => update({ statusColors: { ...value.statusColors, [mode]: color } });

  return (
    <>
      <Section title={t("settings.orb.look")} description={t("settings.orb.lookDesc")}>
        <FieldGrid>
          <Select
            label={t("settings.orb.preset")}
            value={value.preset}
            disabled={readOnly}
            options={presets.map((preset) => ({ value: preset, label: (ORB_PRESETS as readonly string[]).includes(preset) ? t(`settings.orb.preset.${preset}` as MessageKey) : preset }))}
            onChange={(event) => update({ preset: event.target.value })}
          />
          <Select
            label={t("settings.orb.renderMode")}
            hint={t("settings.orb.renderModeHint")}
            value={value.renderMode}
            disabled={readOnly}
            options={[
              { value: "auto", label: t("settings.orb.render.auto") },
              { value: "3d", label: t("settings.orb.render.3d") },
              { value: "2d", label: t("settings.orb.render.2d") },
            ]}
            onChange={(event) => update({ renderMode: event.target.value as Settings["orb"]["renderMode"] })}
          />
          <Slider label={t("settings.orb.size")} min={0.5} max={2} step={0.05} value={value.size} disabled={readOnly} formatValue={(v) => `${Math.round(v * 100)} %`} onValueChange={(size) => update({ size })} />
          <Slider label={t("settings.orb.intensity")} min={0} max={100} step={1} value={value.intensity} disabled={readOnly} formatValue={(v) => `${v} %`} onValueChange={(intensity) => update({ intensity: Math.round(intensity) })} />
          <Slider label={t("settings.orb.speed")} min={0.1} max={3} step={0.05} value={value.speed} disabled={readOnly} formatValue={(v) => `${v.toFixed(2)}×`} onValueChange={(speed) => update({ speed })} />
          <Slider label={t("settings.orb.particles")} min={0} max={100} step={1} value={value.particleDensity} disabled={readOnly} formatValue={(v) => `${v} %`} onValueChange={(particleDensity) => update({ particleDensity: Math.round(particleDensity) })} />
        </FieldGrid>
      </Section>

      <Section title={t("settings.orb.behaviour")}>
        <FieldGrid>
          <Switch label={t("settings.orb.audio")} description={t("settings.orb.audioDesc")} checked={value.audioReactive} disabled={readOnly} stateLabels={onOff} onCheckedChange={(audioReactive) => update({ audioReactive })} />
          <Switch label={t("settings.orb.parallax")} description={t("settings.orb.parallaxDesc")} checked={value.mouseParallax} disabled={readOnly} stateLabels={onOff} onCheckedChange={(mouseParallax) => update({ mouseParallax })} />
          <Switch label={t("settings.orb.bloom")} description={t("settings.orb.bloomDesc")} checked={value.bloom} disabled={readOnly} stateLabels={onOff} onCheckedChange={(bloom) => update({ bloom })} />
          <Select
            label={t("settings.orb.motion")}
            hint={t("settings.orb.motionHint")}
            value={value.animations}
            disabled={readOnly}
            options={[
              { value: "full", label: t("settings.orb.motion.full") },
              { value: "reduced", label: t("settings.orb.motion.reduced") },
              { value: "off", label: t("settings.orb.motion.off") },
            ]}
            onChange={(event) => update({ animations: event.target.value as Settings["orb"]["animations"] })}
          />
          <Select
            label={t("settings.orb.quality")}
            hint={t("settings.orb.qualityHint")}
            value={value.quality}
            disabled={readOnly}
            options={(["auto", "low", "medium", "high", "ultra"] as const).map((quality) => ({ value: quality, label: t(`settings.orb.quality.${quality}` as MessageKey) }))}
            onChange={(event) => update({ quality: event.target.value as Settings["orb"]["quality"] })}
          />
        </FieldGrid>
      </Section>

      <Section
        title={t("settings.orb.colors")}
        description={t("settings.orb.colorsDesc")}
        actions={
          readOnly ? null : (
            <Button type="button" size="sm" variant="ghost" icon={<RotateCcw size={14} />} onClick={() => update({ statusColors: { ...DEFAULT_STATUS_COLORS } })}>
              {t("settings.orb.colorsReset")}
            </Button>
          )
        }
      >
        <StatusChip tone="gold">{t("settings.orb.coreInvariant")}</StatusChip>
        <ul className="st-colors__list st-colors__list--grid">
          {colorModes.map((mode) => {
            const color = value.statusColors[mode] ?? DEFAULT_STATUS_COLORS[mode] ?? "#4DD6FF";
            const label = t(`settings.orb.mode.${mode}` as MessageKey);
            return (
              <li key={mode} className="st-color">
                <label className="st-color__label">
                  <input type="color" className="st-color__input" aria-label={t("settings.orb.colorFor", { mode: label })} value={color.toLowerCase()} disabled={readOnly} onChange={(event) => setColor(mode, event.target.value.toUpperCase())} />
                  <span>{label}</span>
                </label>
                <code className="st-mono st-muted">{color.toUpperCase()}</code>
              </li>
            );
          })}
        </ul>
      </Section>
    </>
  );
}
