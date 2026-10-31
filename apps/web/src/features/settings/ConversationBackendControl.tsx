"use client";

import type { VoiceStatus } from "@friday/sdk";
import { Select } from "@friday/ui";
import { useState } from "react";

type ConversationStatus = NonNullable<VoiceStatus["conversation"]>;
type ConversationBackend = ConversationStatus["backend"];
type ConversationError = NonNullable<ConversationStatus["lastError"]>;

const ERROR_TEXT: Record<ConversationError, string> = {
  auth: "Schlüssel wird nicht akzeptiert",
  quota: "Kontingent aufgebraucht",
  rate: "Anfragen werden gedrosselt",
  model: "Modell im Tarif nicht verfügbar",
  idle: "Sitzung wegen Leerlauf beendet",
  network: "nicht erreichbar",
  protocol: "unerwartete Antwort",
};

export function ConversationBackendControl({ value, status, readOnly, onSelect }: {
  value: ConversationBackend;
  status: VoiceStatus["conversation"] | undefined;
  readOnly: boolean;
  onSelect: (value: ConversationBackend) => void;
}) {
  const [missingKey, setMissingKey] = useState(false);
  const select = (next: ConversationBackend): void => {
    if (next === "qwen" && status?.keyConfigured !== true) {
      setMissingKey(true);
      return;
    }
    setMissingKey(false);
    onSelect(next);
  };
  const statusText = !status ? "Status des Sprachdienstes wird geladen…"
    : status.backend === "local" ? "Aktiv: lokales Gespräch."
      : status.lastError === null ? "Aktiv: Qwen Audio."
        : `Qwen Audio: ${ERROR_TEXT[status.lastError]}. Der Assistent antwortet bis dahin lokal.`;
  return (
    <div>
      <Select
        label="Gespräch"
        value={value}
        disabled={readOnly}
        options={[
          { value: "local", label: "Lokal" },
          { value: "qwen", label: "Qwen Audio Live-Gespräch (Alibaba Token Plan)" },
        ]}
        onChange={(event) => select(event.target.value as ConversationBackend)}
      />
      {missingKey && status?.keyConfigured !== true ? <p role="alert">Für Qwen Audio fehlt der Alibaba-Token-Plan-Schlüssel. Hinterlege ihn über „Sprache ändern“ im Installer (Seite „Sprache & Stimme“).</p> : null}
      <p role="status">{statusText}</p>
    </div>
  );
}
