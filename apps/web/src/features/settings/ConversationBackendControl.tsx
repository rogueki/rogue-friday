"use client";

import type { VoiceStatus } from "@friday/sdk";
import { Button, Select, TextField } from "@friday/ui";
import { useState } from "react";
import { useSetVoiceConversationKey } from "@/lib/api/domains/voice";

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
  const [apiKey, setApiKey] = useState("");
  const [replaceKey, setReplaceKey] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [keySaved, setKeySaved] = useState(false);
  const mutation = useSetVoiceConversationKey();
  const select = (next: ConversationBackend): void => {
    if (next === "qwen" && status?.keyConfigured !== true) {
      setMissingKey(true);
      return;
    }
    setMissingKey(false);
    onSelect(next);
  };
  const saveKey = (): void => {
    setKeyError(null);
    setKeySaved(false);
    mutation.mutate(
      { apiKey: apiKey.trim() },
      {
        onSuccess: () => {
          setApiKey("");
          setReplaceKey(false);
          setMissingKey(false);
          setKeySaved(true);
        },
        onError: (error) => setKeyError(error.message),
      },
    );
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
      {missingKey && status?.keyConfigured !== true ? <p role="alert">Für Qwen Audio fehlt der Alibaba-Token-Plan-Schlüssel. Bitte unten eingeben.</p> : null}
      <p role="status">{statusText}</p>
      {keySaved ? <p role="status">Schlüssel gespeichert.</p> : null}
      {keyError ? <p role="alert">{keyError}</p> : null}
      {!readOnly && status && (!status.keyConfigured || replaceKey) ? (
        <div>
          <TextField
            label="Alibaba-Token-Plan-Schlüssel"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
          <p>Der Schlüssel wird vor dem Speichern bei Qwen Audio geprüft und nur auf diesem PC verschlüsselt abgelegt.</p>
          <Button type="button" size="sm" disabled={apiKey.trim().length < 8 || mutation.isPending} onClick={saveKey}>
            {mutation.isPending ? "Wird geprüft …" : "Prüfen und speichern"}
          </Button>
        </div>
      ) : null}
      {!readOnly && status?.keyConfigured === true && !replaceKey ? (
        <Button type="button" size="sm" variant="ghost" onClick={() => setReplaceKey(true)}>Schlüssel ersetzen</Button>
      ) : null}
    </div>
  );
}
