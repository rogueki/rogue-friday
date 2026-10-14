"use client";

import { BottomCommandBar, Tooltip, useToast, type ContextChip } from "@jarvis/ui";
import { Cloud, MapPin, Wifi, Zap } from "lucide-react";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { EXECUTIVE_BRIEFING_COMMAND, useVoiceUi } from "@/features/voice/useVoiceUi";
import { useRunCommand } from "@/features/palette/commandRunner";
import { useOrbSnapshot } from "@/features/orb/useOrbSnapshot";
import { useT } from "@/i18n";
import { useCommandControl } from "@/lib/api/domains/commands";
import { useSystemMetrics } from "@/lib/api/domains/system";
import { useCapability } from "@/lib/capabilities";

const CHIP_ICON = { size: 16, strokeWidth: 1.5 } as const;

/** A context chip whose data source does not exist yet: shows "—" and explains why instead of inventing a value. */
function unavailableIcon(icon: React.ReactNode, reason: string): React.ReactNode {
  return (
    <Tooltip content={reason}>
      <span tabIndex={0} aria-label={reason} style={{ display: "inline-flex" }}>
        {icon}
      </span>
    </Tooltip>
  );
}

export function AppBottomBar() {
  const { t } = useT();
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
  const paused = orb?.status.mode === "paused";
  const compact = pathname !== "/";

  const chips = useMemo<ContextChip[]>(() => {
    const na = t("common.unavailable");
    const latency = metrics?.network.latencyMs;
    return [
      { id: "location", icon: unavailableIcon(<MapPin {...CHIP_ICON} />, na), label: t("context.location"), value: "—" },
      { id: "weather", icon: unavailableIcon(<Cloud {...CHIP_ICON} />, na), label: t("context.weather"), value: "—" },
      latency !== null && latency !== undefined
        ? { id: "network", icon: <Wifi {...CHIP_ICON} />, label: t("context.network"), value: `${Math.round(latency)} ms` }
        : { id: "network", icon: unavailableIcon(<Wifi {...CHIP_ICON} />, na), label: t("context.network"), value: "—" },
    ];
  }, [metrics?.network.latencyMs, t]);

  const unavailable = (): void => {
    toast({ title: t("command.capabilityMissing"), tone: "amber" });
  };

  return (
    <BottomCommandBar
      chips={chips}
      compact={compact}
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
      talkLabel={t("bottom.talk")}
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
