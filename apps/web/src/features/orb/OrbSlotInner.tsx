"use client";

import { JarvisOrb, orbSettingsFromWire, type JarvisOrbProps } from "@jarvis/orb";
import type { OrbSnapshot } from "@jarvis/sdk";
import { useEffect, useMemo, useState } from "react";
import { useT } from "@/i18n";
import { useMeta } from "@/lib/api/domains/core";
import { useAppSettings } from "@/lib/settings";
import { readAudioLevel } from "./audioStore";
import { ORB_TEST_EVENT, orbSettingsFromTestOverrides, readOrbTestOverrides, type OrbTestOverrides } from "./orbTestHook";
import { useOrbActions } from "./useOrbActions";
import { useOrbSnapshot } from "./useOrbSnapshot";

const offlineSnapshot = (): OrbSnapshot => ({
  status: { mode: "offline", health: "offline", since: new Date().toISOString(), urgency: "none", progressMode: "none" },
  layers: { voice: "idle", work: "idle", attention: "none", health: "offline", activeAgentIds: [] },
});

/** Orb test clock overrides (PLAN §52.1); only honoured while the server enables the dev scenario features. */
function useOrbTestOverrides(enabled: boolean): OrbTestOverrides | undefined {
  const [overrides, setOverrides] = useState<OrbTestOverrides | undefined>();
  useEffect(() => {
    if (!enabled) {
      setOverrides(undefined);
      return;
    }
    const update = (): void => setOverrides(readOrbTestOverrides());
    update();
    window.addEventListener(ORB_TEST_EVENT, update);
    return () => window.removeEventListener(ORB_TEST_EVENT, update);
  }, [enabled]);
  return overrides;
}

export interface OrbSlotProps {
  className?: string;
  /**
   * Multiplier on `settings.orb.size` for panels that give the sphere the whole stage (AI-core panel). The orb's camera
   * fits its outer rings into the shorter canvas side; the globe itself then only fills ~60 % of it.
   */
  sizeBoost?: number;
  /** Reports the effective renderer (3d, or 2d when WebGL is unavailable/disabled) so the panel can say so. */
  onRendererChange?: (renderer: "3d" | "2d") => void;
}

/**
 * The single place where the app mounts `@jarvis/orb`: wires the snapshot (query cache + realtime), `settings.orb`, the
 * audio level feed and the click/Space routing (PLAN §21).
 */
export function OrbSlotInner({ className, sizeBoost = 1, onRendererChange }: OrbSlotProps) {
  const { snapshot: live, isError } = useOrbSnapshot();
  const { settings } = useAppSettings();
  const { locale, assistantName } = useT();
  const features = useMeta().data?.features;
  const { onActivate, onVoiceToggle } = useOrbActions();
  const testOverrides = useOrbTestOverrides(Boolean(features?.["devScenarios"]));

  // Scenario hint (PLAN §45.14 "WebGL Failure"): the server may force the 2D fallback through a meta feature flag.
  const forceFallback2D = Boolean(features?.["forceOrbFallback2D"] ?? features?.["uiHints.forceOrbFallback2D"]);
  // The audio feed is pulled by the orb inside its animation loop (display rate, no React state, no re-render).
  const snapshot = useMemo<OrbSnapshot | undefined>(() => live ?? (isError ? offlineSnapshot() : undefined), [live, isError]);

  const orbSettings = useMemo<JarvisOrbProps["settings"]>(() => {
    const base = settings?.orb ? orbSettingsFromWire(settings.orb) : {};
    const size = Math.min(1.5, (base.size ?? 1) * sizeBoost); // the orb clamps to 0.5..1.5 as well
    return { ...base, size, ...(forceFallback2D ? { renderer: "2d" as const } : {}), ...orbSettingsFromTestOverrides(testOverrides) };
  }, [settings?.orb, forceFallback2D, sizeBoost, testOverrides]);

  if (!snapshot) return null;
  return <JarvisOrb snapshot={snapshot} settings={orbSettings} onActivate={onActivate} onVoiceToggle={onVoiceToggle} assistantName={assistantName} getAudioLevel={readAudioLevel} onRendererChange={onRendererChange} locale={locale} className={className} />;
}
