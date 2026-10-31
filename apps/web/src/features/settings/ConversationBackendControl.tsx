"use client";

import type { VoiceStatus } from "@friday/sdk";
import { Button, Select, TextField } from "@friday/ui";
import { useState } from "react";
import { useAdoptVoiceConversationKeyFromBrain, useSetVoiceConversationKey } from "@/lib/api/domains/voice";

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

export function ConversationBackendControl({ value, consent, status, readOnly, regionPending = false, onSelect }: {
  value: ConversationBackend;
  consent: boolean;
  status: VoiceStatus["conversation"] | undefined;
  readOnly: boolean;
  regionPending?: boolean;
  onSelect: (value: ConversationBackend, consent: boolean) => void;
}) {
  const [consentChecked, setConsentChecked] = useState(consent);
  const [missingKey, setMissingKey] = useState(false);
  const [missingConsent, setMissingConsent] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [replaceKey, setReplaceKey] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [keySaved, setKeySaved] = useState(false);
  const mutation = useSetVoiceConversationKey();
  const adopt = useAdoptVoiceConversationKeyFromBrain();
  const select = (next: ConversationBackend): void => {
    if (next === "qwen") {
      if (status?.keyConfigured !== true) {
        setMissingKey(true);
        return;
      }
      setMissingKey(false);
      if (!consentChecked) {
        setMissingConsent(true);
        return;
      }
      setMissingConsent(false);
      onSelect("qwen", true);
      return;
    }
    setMissingKey(false);
    setMissingConsent(false);
    onSelect("local", consentChecked);
  };
  const toggleConsent = (checked: boolean): void => {
    setConsentChecked(checked);
    if (checked) {
      setMissingConsent(false);
    } else {
      // A withdrawn consent is saved at once and ends a running Qwen conversation.
      onSelect("local", false);
    }
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
  const adoptBrainKey = (): void => {
    setKeyError(null);
    setKeySaved(false);
    adopt.mutate(
      {},
      {
        onSuccess: () => {
          setReplaceKey(false);
          setMissingKey(false);
          setKeySaved(true);
        },
        onError: (error) => setKeyError(error.message),
      },
    );
  };
  const statusText = !status ? "Status des Sprachdienstes wird geladen…"
    : status.consent === false && value === "qwen" ? "Qwen Audio wartet auf deine Zustimmung; bis dahin antwortet der Assistent lokal."
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
      {!readOnly ? (
        <label>
          <input
            type="checkbox"
            checked={consentChecked}
            onChange={(event) => toggleConsent(event.target.checked)}
          />
          {" "}Ich stimme zu: Für das Live-Gespräch gehen Sprache und Gesprächsinhalte an Alibaba Cloud (Qwen Audio, Token Plan).
        </label>
      ) : null}
      {missingKey && status?.keyConfigured !== true ? <p role="alert">Für Qwen Audio fehlt der Alibaba-Token-Plan-Schlüssel. Bitte unten eingeben.</p> : null}
      {missingConsent ? <p role="alert">Für Qwen Audio ist deine Zustimmung zur Datenübertragung an Alibaba Cloud nötig.</p> : null}
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
          {regionPending ? <p role="alert">Zuerst die geänderte Region speichern: Der Schlüssel wird gegen die gespeicherte Region geprüft.</p> : null}
          <Button type="button" size="sm" disabled={apiKey.trim().length < 8 || mutation.isPending || regionPending} onClick={saveKey}>
            {mutation.isPending ? "Wird geprüft …" : "Prüfen und speichern"}
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={adopt.isPending || mutation.isPending || regionPending} onClick={adoptBrainKey}>
            {adopt.isPending ? "Wird geprüft …" : "Schlüssel des Denkmodells übernehmen"}
          </Button>
          <p>Nutzt das Denkmodell einen Alibaba Token Plan, übernimmt F.R.I.D.A.Y. dessen Schlüssel direkt auf diesem PC; er erscheint nicht im Browser.</p>
        </div>
      ) : null}
      {!readOnly && status?.keyConfigured === true && !replaceKey ? (
        <Button type="button" size="sm" variant="ghost" onClick={() => setReplaceKey(true)}>Schlüssel ersetzen</Button>
      ) : null}
    </div>
  );
}
