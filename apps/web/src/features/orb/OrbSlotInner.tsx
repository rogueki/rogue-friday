"use client";

import { JarvisOrb, orbSettingsFromWire, type JarvisOrbProps } from "@jarvis/orb";
import type { OrbSnapshot } from "@jarvis/sdk";
import { useMemo } from "react";
import { useT } from "@/i18n";
import { useMeta } from "@/lib/api/domains/core";
import { useAppSettings } from "@/lib/settings";
import { useAudioSamples } from "./audioStore";
import { useOrbActions } from "./useOrbActions";
import { useOrbSnapshot } from "./useOrbSnapshot";

const offlineSnapshot = (): OrbSnapshot => ({
  status: { mode: "offline", health: "offline", since: new Date().toISOString(), urgency: "none", progressMode: "none" },
  layers: { voice: "idle", work: "idle", attention: "none", health: "offline", activeAgentIds: [] },
});

export interface OrbSlotProps {
  className?: string;
}

/**
 * The single place where the app mounts `@jarvis/orb`: wires the snapshot (query cache + realtime), `settings.orb`, the
 * audio level feed and the click/Space routing (PLAN §21).
 */
export function OrbSlotInner({ className }: OrbSlotProps) {
  const { snapshot: live, isError } = useOrbSnapshot();
  const { settings } = useAppSettings();
  const { locale, assistantName } = useT();
  const features = useMeta().data?.features;
  const { onActivate, onVoiceToggle } = useOrbActions();

  // Scenario hint (PLAN §45.14 "WebGL Failure"): the server may force the 2D fallback through a meta feature flag.
  const forceFallback2D = Boolean(features?.["forceOrbFallback2D"] ?? features?.["uiHints.forceOrbFallback2D"]);
  const voiceActive = live?.layers.voice === "listening" || live?.layers.voice === "speaking";
  // Bounded-rate sampling: the audio feed never re-renders anything above this component.
  const audio = useAudioSamples(voiceActive, 12);

  const snapshot = useMemo<OrbSnapshot | undefined>(() => {
    if (!live) return isError ? offlineSnapshot() : undefined;
    return voiceActive && audio.level > 0 ? { ...live, status: { ...live.status, audioLevel: audio.level } } : live;
  }, [live, isError, voiceActive, audio.level]);

  const orbSettings = useMemo<JarvisOrbProps["settings"]>(() => {
    const base = settings?.orb ? orbSettingsFromWire(settings.orb) : {};
    return forceFallback2D ? { ...base, renderer: "2d" as const } : base;
  }, [settings?.orb, forceFallback2D]);

  if (!snapshot) return null;
  return <JarvisOrb snapshot={snapshot} settings={orbSettings} onActivate={onActivate} onVoiceToggle={onVoiceToggle} assistantName={assistantName} locale={locale} className={className} />;
}
