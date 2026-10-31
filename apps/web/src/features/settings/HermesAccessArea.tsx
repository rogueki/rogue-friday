"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useHermesAccess, useHermesProviderOAuthFlow, useManageHermesProviderOAuth, type HermesOAuthProvider }
  from "@/lib/api/domains/settings";

const TYPE_LABEL: Record<string, string> = {
  api_key: "API-Key",
  oauth: "Abo-Anmeldung",
};

export function HermesAccessArea() {
  const observed = useHermesAccess();

  if (observed.isPending) return <p role="status">Hermes-Zugänge werden gelesen …</p>;
  if (observed.isError)
    return (
      <section aria-label="Hermes-Zugänge">
        <h3>KI-Zugänge</h3>
        <p role="alert">
          {observed.error instanceof Error ? observed.error.message
            : "Die Hermes-Zugänge konnten nicht gelesen werden. Erneut prüfen."}{" "}
          <button type="button" onClick={() => void observed.refetch()}>Erneut lesen</button>
        </p>
      </section>
    );

  const providers = observed.data.data.providers;
  return (
    <section aria-label="Hermes-Zugänge">
      <h3>KI-Zugänge</h3>
      <p>
        Diese Liste kommt aus <code>hermes auth list</code>. Gezeigt werden nur Anbieter, Typ und Herkunft der
        Anmeldung; ein Schlüsselwert verlässt die Bridge nie.
      </p>
      {providers.length === 0
        ? <p role="status">Kein Anbieter ist angemeldet.</p>
        : (
          <ul aria-label="Angemeldete Anbieter">
            {providers.map((provider) => (
              <li key={provider.provider}>
                <strong>{provider.provider}</strong>{" "}
                <span>{provider.count === 1 ? "1 Zugang" : `${provider.count} Zugänge`}</span>
                <ul>
                  {provider.credentials.map((credential) => (
                    <li key={`${provider.provider}-${credential.index}`}>
                      <span>#{credential.index} {credential.label}</span>{" "}
                      <span>{TYPE_LABEL[credential.type] ?? credential.type}</span>{" "}
                      <code>{credential.source}</code>
                      {credential.active ? <span> aktiv</span> : <span> nicht aktiv</span>}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      <ProviderLogin />
    </section>
  );
}

const LOGIN_PROVIDERS: { id: HermesOAuthProvider; label: string }[] = [
  { id: "nous", label: "Nous Portal" },
  { id: "openai-codex", label: "OpenAI Codex (ChatGPT-Abo)" },
  { id: "xai-oauth", label: "xAI Grok" },
  { id: "minimax-oauth", label: "MiniMax" },
];

const FAILURE_TEXT: Record<string, string> = {
  oauth_cancelled: "abgebrochen",
  oauth_timeout: "Zeit abgelaufen",
  oauth_expired: "Code abgelaufen",
  oauth_denied: "beim Anbieter abgelehnt",
  oauth_start_failed: "Anbieter hat den Start abgelehnt",
  oauth_worker_unconfirmed: "Hermes-Anmeldeprozess wurde beendet",
};

/** Hermes runs the device-code flow and stores the token; Friday only shows the code, the link and the expiry. */
function ProviderLogin() {
  const manage = useManageHermesProviderOAuth();
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState<HermesOAuthProvider>("nous");
  const [flowId, setFlowId] = useState<string | null>(null);
  const flow = useHermesProviderOAuthFlow(flowId);
  const state = flow.data?.data ?? (manage.data?.data.flowId === flowId ? manage.data?.data : undefined);
  const status = state?.status;
  const running = status === "starting" || status === "awaiting_approval" || status === "cancelling";

  useEffect(() => {
    if (status === "configured") void queryClient.invalidateQueries({ queryKey: ["settings", "hermes-access"] });
  }, [status, queryClient]);

  return (
    <section aria-label="Anbieter anmelden">
      <h4>Anbieter anmelden</h4>
      <p>
        Die Anmeldung läuft über den Device-Code-Ablauf von Hermes. Friday zeigt nur Code und Adresse; den Zugang
        speichert Hermes selbst. Anbieter mit API-Key werden in der Hermes-Konfiguration hinterlegt.
      </p>
      <select aria-label="Anbieter" value={provider} disabled={running || manage.isPending}
        onChange={(event) => setProvider(event.target.value as HermesOAuthProvider)}>
        {LOGIN_PROVIDERS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
      </select>{" "}
      <button type="button" disabled={running || manage.isPending}
        onClick={() => manage.mutate({ action: "start", provider }, { onSuccess: (response) => setFlowId(response.data.flowId) })}>
        Anmeldung starten
      </button>
      {manage.isError && !running
        ? <p role="alert">{manage.error instanceof Error ? manage.error.message : "Die Anmeldung konnte nicht gestartet werden."}</p>
        : null}
      {state ? (
        <div role="status">
          {status === "starting" ? <p>Hermes fordert den Anmeldecode an …</p> : null}
          {status === "awaiting_approval" && state.userCode && state.verificationUrl ? (
            <>
              <p>
                Code <strong><code>{state.userCode}</code></strong> auf der Seite des Anbieters eingeben:{" "}
                <a href={state.verificationUrl} target="_blank" rel="noopener noreferrer">{state.verificationUrl}</a>
              </p>
              {state.expiresAt
                ? <p>Gültig bis {new Date(state.expiresAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr.</p>
                : null}
            </>
          ) : null}
          {status === "cancelling" ? <p>Anmeldung wird abgebrochen …</p> : null}
          {status === "configured" ? <p>Angemeldet. Hermes hat den Zugang gespeichert.</p> : null}
          {status === "failed"
            ? <p>Anmeldung fehlgeschlagen ({FAILURE_TEXT[state.failureClass ?? ""] ?? state.failureClass ?? "unbekannt"}).</p>
            : null}
          {(status === "starting" || status === "awaiting_approval") && flowId ? (
            <button type="button" disabled={manage.isPending}
              onClick={() => manage.mutate({ action: "cancel", flowId }, { onSuccess: () => void flow.refetch() })}>
              Anmeldung abbrechen
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}