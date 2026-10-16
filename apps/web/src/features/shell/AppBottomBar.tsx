"use client";

import { BottomCommandBar, useToast, type ContextChip } from "@friday/ui";
import { Cloud, MapPin, Wifi, Zap } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useMemo } from "react";
import { EXECUTIVE_BRIEFING_COMMAND, useVoiceUi } from "@/features/voice/useVoiceUi";
import { useRunCommand } from "@/features/palette/commandRunner";
import { useOrbSnapshot } from "@/features/orb/useOrbSnapshot";
import { useT } from "@/i18n";
import { useCommandControl } from "@/lib/api/domains/commands";
import { useSystemMetrics } from "@/lib/api/domains/system";
import { useCapability } from "@/lib/capabilities";

const CHIP_ICON = { size: 16, strokeWidth: 1.5 } as const;

export function AppBottomBar() {
  const { t, assistantName } = useT();
  const { toast } = useToast();
  const pathname = usePathname();
  const voice = useVoiceUi();
  const run = useRunCommand();
  const orb = useOrbSnapshot().snapshot;
  const metrics = useSystemMetrics().data?.data;
  const canStop = useCapability("commands", "stop");
  const canPause = useCapability("commands", "pause");
  const canResume = useCapability("commands", "resume");
  const canExecute = useCapability("commands", "execute");
  const stop = useCommandControl("stop");
  const pause = useCommandControl("pause");
  const resume = useCommandControl("resume");
  const paused = orb?.status.mode === "paused" || voice.voice?.microphone.state === "muted";
  const compact = pathname !== "/";

  // PLAN §58: a missing value is never a bare dash; the chip carries the reason (tooltip + accessible name).
  const chips = useMemo<ContextChip[]>(() => {
    const noSource = t("context.noSource");
    const latency = metrics?.network.latencyMs;
    return [
      { id: "location", icon: <MapPin {...CHIP_ICON} />, label: t("context.location"), value: "—", hint: noSource },
      { id: "weather", icon: <Cloud {...CHIP_ICON} />, label: t("context.weather"), value: "—", hint: noSource },
      latency !== null && latency !== undefined
        ? { id: "network", icon: <Wifi {...CHIP_ICON} />, label: t("context.network"), value: `${Math.round(latency)} ms` }
        : { id: "network", icon: <Wifi {...CHIP_ICON} />, label: t("context.network"), value: "—", hint: t("context.noMeasurement") },
    ];
  }, [metrics?.network.latencyMs, t]);

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
      onStop={() => (canStop ? stop.mutate({ scope: "all" }) : unavailable())}
      onPause={() => {
        if (paused) return canResume ? resume.mutate({ scope: "all" }) : unavailable();
        return canPause ? pause.mutate({ scope: "all" }) : unavailable();
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
