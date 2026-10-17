"use client";

import type { OrbMode, OrbSnapshot, VoiceStatus } from "@friday/sdk";
import type { VoiceState } from "@friday/ui";
import { useToast } from "@friday/ui";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { browserAudio } from "./browserAudio";
import { useAudioSamples, type AudioSample } from "@/features/orb/audioStore";
import { useOrbSnapshot } from "@/features/orb/useOrbSnapshot";
import { useExecuteCommand } from "@/lib/api/domains/commands";
import { useOverview } from "@/lib/api/domains/core";
import { useStopVoice, useVoiceStatus } from "@/lib/api/domains/voice";
import { useModuleAvailability } from "@/features/shared/useAvailability";
import type { Availability } from "@/features/shared/availability";
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
  /** Why voice is unusable (service offline vs. nothing configured vs. fine); the status text names it. */
  availability: Availability;
  state: VoiceState;
  statusText: string;
  voice: VoiceStatus | null | undefined;
  audio: AudioSample;
  focusMode: boolean;
  /** Start listening, or stop listening/speaking when already active. */
  toggle: () => void;
  toggleFocus: () => void;
  canToggle: boolean;
  browserAudioActive: boolean;
  browserAudioPaused: boolean;
  stopBrowserAudio: () => void;
  pauseBrowserAudio: () => void;
  resumeBrowserAudio: () => void;
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
  const browser = useSyncExternalStore(browserAudio.subscribe, browserAudio.snapshot, browserAudio.snapshot);
  useEffect(() => {
    void browserAudio.check();
    const timer = window.setInterval(() => { void browserAudio.check(); }, 10_000);
    return () => window.clearInterval(timer);
  }, []);

  const availability = useModuleAvailability("voice", { error: voiceQuery.error });
  const outage = availability.kind === "outage" ? availability.outage : null;
  const unavailable = outage !== null || availability.kind === "not-configured";
  // A voice outage must show as such, not as the orb's last mode ("Wartet auf Freigabe") or a missing capability.
  const state: VoiceState = browser.active ? (browser.paused ? "muted" : browser.speaking ? "speaking" : "listening") : outage ? "error" : unavailable ? "disabled" : deriveVoiceState(snapshot, voice, voiceRead || commandsExecute);
  const statusText = browser.error ?? (browser.active ? (browser.paused ? "Sprachaufnahme pausiert" : browser.speaking ? "F.R.I.D.A.Y. spricht …" : "Ich höre zu …") : outage ? t(outage.recovering ? "voice.nav.recovering" : "voice.nav.offline") : unavailable ? t("voice.nav.notConfigured") : t(orbStatusKey(snapshot?.status.mode)));
  const active = state === "listening" || state === "speaking";
  const audio = useAudioSamples(active);

  const toggle = useCallback(() => {
    if (browser.active) { browserAudio.stop(); return; }
    if (unavailable) {
      toast({ title: statusText, tone: "amber" });
      return;
    }
    if (browser.available) {
      void browserAudio.start().catch((error: unknown) => toast({ title: error instanceof Error ? error.message : "Mikrofon konnte nicht gestartet werden.", tone: "red" }));
      return;
    }
    if (active && voiceStop) {
      stopVoice.mutate({}, { onError: (error) => toast({ title: error.message, tone: "red" }) });
      return;
    }
    if (!commandsExecute) {
      toast({ title: t("voice.startUnavailable"), tone: "amber" });
      return;
    }
    execute.mutate({ text: VOICE_START_COMMAND, source: "voice" }, {
      onSuccess: (response) => {
        if (response.status === "rejected" || response.status === "failed")
          toast({ title: response.result?.message ?? t("voice.startUnavailable"), tone: "red" });
      },
      onError: (error) => toast({ title: error.message, tone: "red" }),
    });
  }, [browser.active, browser.available, unavailable, statusText, active, voiceStop, commandsExecute, stopVoice, execute, toast, t]);

  const toggleFocus = useCallback(() => {
    if (!commandsExecute) {
      toast({ title: t("voice.focusUnavailable"), tone: "amber" });
      return;
    }
    execute.mutate({ text: FOCUS_MODE_COMMAND, source: "quick_command" });
  }, [commandsExecute, execute, toast, t]);

  return useMemo<VoiceUi>(
    () => ({
      availability,
      state,
      statusText,
      voice,
      audio,
      focusMode: voice?.focusMode ?? false,
      toggle,
      toggleFocus,
      canToggle: !unavailable && state !== "disabled",
      browserAudioActive: browser.active,
      browserAudioPaused: browser.paused,
      stopBrowserAudio: browserAudio.stop,
      pauseBrowserAudio: browserAudio.pause,
      resumeBrowserAudio: browserAudio.resume,
    }),
    [availability, state, statusText, unavailable, voice, audio, toggle, toggleFocus, browser.active, browser.paused],
  );
}
