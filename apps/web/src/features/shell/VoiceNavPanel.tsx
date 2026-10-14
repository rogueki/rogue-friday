"use client";

import { Tooltip, VoiceStatusPanel } from "@jarvis/ui";
import { AudioLines, Fingerprint, KeyRound, Mic, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useVoiceUi } from "@/features/voice/useVoiceUi";
import { useT, type MessageKey } from "@/i18n";

interface Flag {
  id: string;
  icon: ReactNode;
  label: string;
  value: string;
  tone: "ok" | "warn" | "off";
}

/** Voice status in the nav footer (PLAN §27.12): wake word, mic, speaker verification, trusted session, waveform, PTT, focus. */
export function VoiceNavPanel() {
  const { t } = useT();
  const router = useRouter();
  const voice = useVoiceUi();
  const status = voice.voice;

  const flags: Flag[] = status
    ? [
        {
          id: "wake",
          icon: <AudioLines size={13} strokeWidth={1.6} />,
          label: t("voice.wakeWord"),
          value: status.wakeWord.enabled ? t(`voice.wake.${status.wakeWord.state}` as MessageKey) : t("voice.disabled"),
          tone: status.wakeWord.state === "armed" || status.wakeWord.state === "triggered" ? "ok" : status.wakeWord.state === "error" ? "warn" : "off",
        },
        {
          id: "mic",
          icon: <Mic size={13} strokeWidth={1.6} />,
          label: t("voice.microphone"),
          value: t(`voice.mic.${status.microphone.state}` as MessageKey),
          tone: status.microphone.state === "listening" || status.microphone.state === "idle" ? "ok" : "warn",
        },
        {
          id: "speaker",
          icon: <Fingerprint size={13} strokeWidth={1.6} />,
          label: t("voice.speaker"),
          value: status.speakerVerification.enabled ? t(`voice.speakerState.${status.speakerVerification.state}` as MessageKey) : t("voice.disabled"),
          tone: status.speakerVerification.state === "verified" ? "ok" : status.speakerVerification.state === "rejected" ? "warn" : "off",
        },
        {
          id: "trusted",
          icon: <ShieldCheck size={13} strokeWidth={1.6} />,
          label: t("voice.trusted"),
          value: status.trustedSession.active ? t("voice.active") : t("voice.inactive"),
          tone: status.trustedSession.active ? "ok" : "off",
        },
      ]
    : [];

  return (
    <div className="web-voicenav">
      <VoiceStatusPanel
        state={voice.state}
        statusText={voice.statusText}
        levels={voice.audio.level > 0 ? voice.audio.levels : undefined}
        title={t("voice.title")}
        hint=""
        onToggle={voice.toggle}
        onOpen={() => router.push("/voice")}
        focusMode={voice.focusMode}
        onFocusModeToggle={voice.toggleFocus}
        focusLabel={t("voice.focus")}
      />
      {flags.length > 0 ? (
        <ul className="web-voicenav__flags" aria-label={t("voice.flags")}>
          {flags.map((flag) => (
            <li key={flag.id}>
              <Tooltip content={`${flag.label}: ${flag.value}`}>
                <span className={`web-flag web-flag--${flag.tone}`} tabIndex={0} aria-label={`${flag.label}: ${flag.value}`}>
                  {flag.icon}
                </span>
              </Tooltip>
            </li>
          ))}
          {status?.pushToTalk.enabled ? (
            <li>
              <Tooltip content={t("voice.pushToTalkActive", { state: status.pushToTalk.active ? t("voice.active") : t("voice.inactive") })}>
                <span className={`web-flag web-flag--${status.pushToTalk.active ? "ok" : "off"}`} tabIndex={0} aria-label={t("voice.pushToTalk")}>
                  <KeyRound size={13} strokeWidth={1.6} />
                </span>
              </Tooltip>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
