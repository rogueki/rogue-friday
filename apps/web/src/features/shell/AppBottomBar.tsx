"use client";

import { BottomCommandBar, useToast, type ContextChip } from "@friday/ui";
import { Cloud, MapPin, Wifi, Zap } from "lucide-react";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { EXECUTIVE_BRIEFING_COMMAND, useVoiceUi } from "@/features/voice/useVoiceUi";
import { useRunCommand } from "@/features/palette/commandRunner";
import { useOrbSnapshot } from "@/features/orb/useOrbSnapshot";
import { useT } from "@/i18n";
import { useCommandControl } from "@/lib/api/domains/commands";
import { useCapability } from "@/lib/capabilities";
import { useSettings } from "@/lib/api/domains/settings";

const CHIP_ICON = { size: 16, strokeWidth: 1.5 } as const;

export function AppBottomBar() {
  const { t, assistantName } = useT();
  const { toast } = useToast();
  const pathname = usePathname();
  const router = useRouter();
  const voice = useVoiceUi();
  const run = useRunCommand();
  const orb = useOrbSnapshot().snapshot;
  const location = useSettings().data?.data.dashboard.location;
  const weather = useQuery({
    queryKey: ["context-weather", location?.latitude, location?.longitude],
    enabled: !!location && pathname === "/",
    queryFn: async () => {
      const response = await fetch("/api/v1/weather/current", { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(7_000) });
      if (!response.ok) throw new Error("Wetterdienst nicht erreichbar");
      const data = (await response.json() as { data: { location: { latitude: number; longitude: number }; temperatureC: number; weatherCode: number;
        observedAt: string; fetchedAt: string; stale: boolean; provider: string } | null }).data;
      if (!data || data.location.latitude !== location?.latitude || data.location.longitude !== location?.longitude)
        throw new Error("Wetter wird nach dem Speichern des Standorts geladen");
      return data;
    },
    retry: false,
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
  });
  const network = useQuery({
    queryKey: ["dashboard-network-ping"],
    enabled: pathname === "/",
    queryFn: async () => {
      const start = performance.now();
      const response = await fetch("/api/v1/health", { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(5_000) });
      if (!response.ok) throw new Error("Dashboard nicht erreichbar");
      return Math.max(0, Math.round(performance.now() - start));
    },
    retry: false,
    refetchInterval: 30_000,
  });
  const canStop = useCapability("commands", "stop");
  const canPause = useCapability("commands", "pause");
  const canResume = useCapability("commands", "resume");
  const canExecute = useCapability("commands", "execute");
  const stop = useCommandControl("stop");
  const pause = useCommandControl("pause");
  const resume = useCommandControl("resume");
  const paused = voice.browserAudioActive ? voice.browserAudioPaused : orb?.status.mode === "paused" || voice.voice?.microphone.state === "muted";
  const compact = pathname !== "/";

  // PLAN §58: a missing value is never a bare dash; the chip carries the reason (tooltip + accessible name).
  const chips = useMemo<ContextChip[]>(() => {
    const noSource = t("context.locationSet");
    const weatherHint = weather.isError ? t("context.weatherUnavailable") : weather.data?.stale ?
      t("context.weatherStaleObserved", { time: weather.data.fetchedAt }) :
      weather.data ? t("context.weatherObserved", { provider: weather.data.provider, time: weather.data.observedAt }) : t("context.weatherLoading");
    return [
      { id: "location", icon: <MapPin {...CHIP_ICON} />, label: t("context.location"), value: location?.label ?? "—", hint: location ? t("context.locationChange") : noSource,
        onClick: () => router.push("/settings?area=dashboard") },
      { id: "weather", icon: <Cloud {...CHIP_ICON} />, label: t("context.weather"),
        value: location && weather.data && !weather.isError ? `${Math.round(weather.data.temperatureC)} °C${weather.data.stale ? ` · ${t("context.weatherStaleShort")}` : ""}` : "—",
        hint: location ? weatherHint : noSource, onClick: () => router.push("/settings?area=dashboard") },
      { id: "network", icon: <Wifi {...CHIP_ICON} />, label: t("context.network"),
        value: network.isError ? t("context.networkDisconnected") : network.data === undefined ? t("context.networkChecking") : t("context.networkConnected", { ms: network.data }),
        hint: t("context.networkHint") },
    ];
  }, [location, weather.data, weather.isError, network.data, network.isError, router, t]);

  const unavailableToast = useCallback((): void => {
    toast({ title: t("command.capabilityMissing"), tone: "amber" });
  }, [toast, t]);

  const submitText = useCallback(
    async (text: string): Promise<boolean> => {
      if (!canExecute) {
        unavailableToast();
        return false;
      }
      // Same flow as the palette: write/critical commands answer with a server preview that needs confirmation.
      return (await run({ text, source: "text" })) !== null;
    },
    [canExecute, run, unavailableToast],
  );

  const unavailable = unavailableToast;

  return (
    <BottomCommandBar
      chips={chips}
      compact={compact}
      onSubmitText={submitText}
      textLabel={t("bottom.text.label")}
      textPlaceholder={t("bottom.text.placeholder")}
      textSubmitLabel={t("bottom.text.submit")}
      textDisabled={!canExecute}
      state={voice.state}
      statusText={voice.statusText}
      levels={voice.audio.level > 0 ? voice.audio.levels : undefined}
      onTalk={voice.toggle}
      onStop={() => (voice.browserAudioActive ? voice.stopBrowserAudio() : canStop ? stop.mutate({ scope: "voice" }) : unavailable())}
      onPause={pathname === "/" ? undefined : () => {
        if (voice.browserAudioActive) return paused ? voice.resumeBrowserAudio() : voice.pauseBrowserAudio();
        if (paused) return canResume ? resume.mutate({ scope: "voice" }) : unavailable();
        return canPause ? pause.mutate({ scope: "voice" }) : unavailable();
      }}
      paused={paused}
      talkLabel={t("bottom.talk", { assistant: assistantName.toUpperCase() })}
      stopLabel={t("bottom.stop")}
      pauseLabel={t("bottom.pause")}
      resumeLabel={t("bottom.resume")}
      quickAction={{
        label: t("bottom.briefing"),
        icon: <Zap size={14} />,
        disabled: !canExecute,
        onClick: () => void run({ text: EXECUTIVE_BRIEFING_COMMAND, source: "quick_command" }),
      }}
    />
  );
}
