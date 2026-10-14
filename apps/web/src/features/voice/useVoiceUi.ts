"use client";

import type { OrbMode, OrbSnapshot, VoiceStatus } from "@jarvis/sdk";
import type { VoiceState } from "@jarvis/ui";
import { useToast } from "@jarvis/ui";
import { useCallback, useMemo } from "react";
import { useAudioSamples, type AudioSample } from "@/features/orb/audioStore";
import { useOrbSnapshot } from "@/features/orb/useOrbSnapshot";
import { useExecuteCommand } from "@/lib/api/domains/commands";
import { useOverview } from "@/lib/api/domains/core";
import { useStopVoice, useVoiceStatus } from "@/lib/api/domains/voice";
import { useCapability } from "@/lib/capabilities";
import { useT, type MessageKey } from "@/i18n";

/** Intent texts for POST /commands; the Control API maps them to the voice pipeline / focus mode. */
export const VOICE_START_COMMAND = "Sprachaufnahme starten";
export const FOCUS_MODE_COMMAND = "Fokus-Modus umschalten";
export const EXECUTIVE_BRIEFING_COMMAND = "Executive Briefing";

const ORB_STATUS_KEYS: Record<OrbMode, MessageKey> = {
  booting: "orb.status.booting",
  idle: "orb.status.idle",
  listening: "orb.status.listening",
  transcribing: "orb.status.transcribing",
  thinking: "orb.status.thinking",
  syncing: "orb.status.working",
  working: "orb.status.working",
  speaking: "orb.status.speaking",
  waiting_approval: "orb.status.waiting_approval",
  success: "orb.status.idle",
  warning: "orb.status.warning",
  error: "orb.status.error",
  offline: "orb.status.offline",
  paused: "orb.status.paused",
};

/** Status line derived from the orb mode ("Bereit", "Ich höre zu …", "F.R.I.D.A.Y. arbeitet …", "F.R.I.D.A.Y. spricht …"). */
export function orbStatusKey(mode: OrbMode | undefined): MessageKey {
  return mode ? ORB_STATUS_KEYS[mode] : "orb.status.idle";
}

export function deriveVoiceState(snapshot: OrbSnapshot | undefined, voice: VoiceStatus | null | undefined, voiceAvailable: boolean): VoiceState {
  const layer = snapshot?.layers.voice;
  if (layer === "speaking") return "speaking";
  if (layer === "transcribing") return "transcribing";
  if (layer === "listening") return "listening";
  if (voice) {
    if (voice.mode === "error") return "error";
    if (voice.mode === "listening" || voice.mode === "speaking" || voice.mode === "transcribing") return voice.mode;
    if (voice.microphone.state === "muted" || voice.microphone.state === "off") return "muted";
    if (voice.mode === "thinking") return "thinking";
  }
  return voiceAvailable ? "idle" : "disabled";
}

export interface VoiceUi {
  state: VoiceState;
  statusText: string;
  voice: VoiceStatus | null | undefined;
  audio: AudioSample;
  focusMode: boolean;
  /** Start listening, or stop listening/speaking when already active. */
  toggle: () => void;
  toggleFocus: () => void;
  canToggle: boolean;
}

export function useVoiceUi(): VoiceUi {
  const { t } = useT();
  const { toast } = useToast();
  const snapshot = useOrbSnapshot().snapshot;
  const overview = useOverview().data?.data;
  const voiceQuery = useVoiceStatus();
  const voice = voiceQuery.data?.data ?? overview?.voice;
  const voiceRead = useCapability("voice", "read");
  const voiceStop = useCapability("voice", "stop");
  const commandsExecute = useCapability("commands", "execute");
  const execute = useExecuteCommand();
  const stopVoice = useStopVoice();

  const state = deriveVoiceState(snapshot, voice, voiceRead || commandsExecute);
  const active = state === "listening" || state === "speaking";
  const audio = useAudioSamples(active);

  const toggle = useCallback(() => {
    if (active) {
      if (!voiceStop) {
        toast({ title: t("voice.stopUnavailable"), tone: "amber" });
        return;
      }
      stopVoice.mutate({});
      return;
    }
    if (!commandsExecute) {
      toast({ title: t("voice.startUnavailable"), tone: "amber" });
      return;
    }
    execute.mutate({ text: VOICE_START_COMMAND, source: "voice" });
  }, [active, voiceStop, commandsExecute, stopVoice, execute, toast, t]);

  const toggleFocus = useCallback(() => {
    if (!commandsExecute) {
      toast({ title: t("voice.focusUnavailable"), tone: "amber" });
      return;
    }
    execute.mutate({ text: FOCUS_MODE_COMMAND, source: "quick_command" });
  }, [commandsExecute, execute, toast, t]);

  return useMemo<VoiceUi>(
    () => ({
      state,
      statusText: t(orbStatusKey(snapshot?.status.mode)),
      voice,
      audio,
      focusMode: voice?.focusMode ?? false,
      toggle,
      toggleFocus,
      canToggle: state !== "disabled",
    }),
    [state, snapshot?.status.mode, voice, audio, toggle, toggleFocus, t],
  );
}
