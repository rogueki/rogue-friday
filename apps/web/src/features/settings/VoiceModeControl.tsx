"use client";

import type { VoiceStatus } from "@friday/sdk";
import { Button, ConfirmDialog } from "@friday/ui";
import { useState } from "react";
import { useStartVoiceModeSwitch } from "@/lib/api/domains/voice";

type VoiceModeTarget = NonNullable<VoiceStatus["voiceMode"]>;

const MODE_TEXT: Record<VoiceModeTarget, string> = {
  local: "Lokal: Spracherkennung und Stimme laufen auf der NVIDIA-Grafikkarte dieses PCs.",
  elevenlabs: "ElevenLabs: die Stimme kommt aus der ElevenLabs-Cloud; Wake Word und Sprecherprüfung bleiben auf diesem PC.",
};

const DETAILS: Record<VoiceModeTarget, readonly string[]> = {
  local: [
    "Windows fragt nach Administratorrechten; die Abfrage muss am PC bestätigt werden.",
    "Lokal braucht eine NVIDIA-Grafikkarte mit mindestens 6 GB Speicher.",
    "Fehlende Sprachmodelle werden geladen (mehrere GB); das kann einige Minuten dauern.",
    "Name, Konten, KI-Zugang und Dashboard bleiben unverändert. Bis zum Abschluss bleibt der bisherige Sprachbetrieb aktiv.",
  ],
  elevenlabs: [
    "Windows fragt nach Administratorrechten; die Abfrage muss am PC bestätigt werden.",
    "Der Installer fragt nach dem ElevenLabs-Schlüssel und der gewünschten Stimme.",
    "Gesprochene Antworten werden zur Sprachausgabe an ElevenLabs gesendet.",
    "Name, Konten, KI-Zugang und Dashboard bleiben unverändert. Bis zum Abschluss bleibt der bisherige Sprachbetrieb aktiv.",
  ],
};

export function VoiceModeControl({ status, readOnly }: { status: VoiceStatus | undefined; readOnly: boolean }) {
  const [confirm, setConfirm] = useState(false);
  const [waitingFor, setWaitingFor] = useState<VoiceModeTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const start = useStartVoiceModeSwitch();
  const mode = status?.voiceMode;
  if (!mode) {
    return <p>Der Sprachdienst meldet den Sprachbetrieb nicht. Nach dem nächsten Dashboard-Update steht er hier.</p>;
  }
  const target: VoiceModeTarget = mode === "local" ? "elevenlabs" : "local";
  const linuxHost = status.audioPath?.host === "linux";
  const finished = waitingFor !== null && waitingFor === mode;
  return (
    <>
      <p role="status">Aktuell: {MODE_TEXT[mode]}</p>
      {linuxHost ? <p>Auf einem Linux-Server lässt sich der Sprachbetrieb nur über eine neue Installation ändern.</p> : (
        <Button type="button" variant="primary" disabled={readOnly || start.isPending}
          onClick={() => { setError(null); setConfirm(true); }}>
          {target === "local" ? "Zu lokaler Stimme wechseln" : "Zu ElevenLabs wechseln"}
        </Button>
      )}
      {waitingFor !== null && !finished ? (
        <p role="status">Das Installationsfenster öffnet sich am PC. Bitte die Windows-Abfrage bestätigen und den Assistenten
          abschließen; sobald der Wechsel fertig ist, steht hier der neue Sprachbetrieb.</p>
      ) : null}
      {finished ? <p role="status">Wechsel abgeschlossen.</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={target === "local" ? "Zu lokaler Stimme wechseln?" : "Zu ElevenLabs wechseln?"}
        description="Der Installer richtet nur die Sprachteile neu ein."
        details={DETAILS[target]}
        confirmLabel="Installer öffnen"
        loading={start.isPending}
        onConfirm={() => {
          start.mutate({ target }, {
            onSuccess: () => { setConfirm(false); setWaitingFor(target); },
            onError: (cause) => { setConfirm(false); setError(cause.message); },
          });
        }}
      />
    </>
  );
}
