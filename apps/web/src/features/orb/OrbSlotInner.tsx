"use client";

import { FridayOrb, orbSettingsFromWire, type FridayOrbProps } from "@friday/orb";
import type { OrbSnapshot } from "@friday/sdk";
import { useEffect, useMemo, useState } from "react";
import { useT } from "@/i18n";
import { useMeta } from "@/lib/api/domains/core";
import { useAppSettings } from "@/lib/settings";
import { useOrbDebugSettings } from "./debug/orbDebugStore";
import { installOrbDevHook } from "./orbDevHook";
import { createOrbFrameInputs } from "./orbApi";
import { getOrbRuntime } from "./orbRuntime";
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
  /** Reports the effective renderer (3d, or 2d when WebGL is unavailable/disabled) so the panel can say so. */
  onRendererChange?: (renderer: "3d" | "2d") => void;
}

/**
 * The single place where the app mounts `@friday/orb`: wires the controller singleton (fed by the realtime router, the
 * browser audio path and the server snapshot), `settings.orb` and the click/Space routing (PLAN §21).
 */
export function OrbSlotInner({ className, onRendererChange }: OrbSlotProps) {
  const { snapshot: live, isError } = useOrbSnapshot();
  const { settings } = useAppSettings();
  const { locale, assistantName } = useT();
  const features = useMeta().data?.features;
  const { onActivate, onVoiceToggle } = useOrbActions();
  const testOverrides = useOrbTestOverrides(Boolean(features?.["devScenarios"]));

  // Scenario hint (PLAN §45.14 "WebGL Failure"): the server may force the 2D fallback through a meta feature flag.
  const forceFallback2D = Boolean(features?.["forceOrbFallback2D"] ?? features?.["uiHints.forceOrbFallback2D"]);
  const debugSettings = useOrbDebugSettings(Boolean(features?.["devScenarios"]));

  // The controller is the orb's single source of truth. The server snapshot (query cache, also updated by realtime
  // events) is the truth for work, approvals and health; local voice facts arrive through the event bridge.
  const runtime = useMemo(() => getOrbRuntime(), []);
  const snapshot = useMemo<OrbSnapshot | undefined>(() => live ?? (isError ? offlineSnapshot() : undefined), [live, isError]);
  useEffect(() => {
    if (snapshot) runtime.controller.applySnapshot(snapshot);
  }, [runtime, snapshot]);
  useEffect(() => (features?.["devScenarios"] ? installOrbDevHook(runtime, createOrbFrameInputs) : undefined), [runtime, features]);

  const orbSettings = useMemo<FridayOrbProps["settings"]>(() => {
    const base = settings?.orb ? orbSettingsFromWire(settings.orb) : {};
    return { ...base, ...(forceFallback2D ? { renderer: "2d" as const } : {}), ...orbSettingsFromTestOverrides(testOverrides), ...debugSettings };
  }, [settings?.orb, forceFallback2D, testOverrides, debugSettings]);

  if (!snapshot) return null;
  return <FridayOrb controller={runtime.controller} settings={orbSettings} showPerf={Boolean(features?.scenarioControls && settings?.developer.orbPerfOverlay)} onActivate={onActivate} onVoiceToggle={onVoiceToggle} assistantName={assistantName} onRendererChange={onRendererChange} locale={locale} className={className} />;
}
