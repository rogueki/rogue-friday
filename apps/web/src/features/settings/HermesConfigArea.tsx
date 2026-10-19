"use client";

import type { HermesConfigPatch } from "@friday/sdk";
import { useState } from "react";
import { useHermesConfig, usePatchHermesConfig } from "@/lib/api/domains/settings";

const LABELS: Record<string, string> = {
  "model.provider": "Hermes-Anbieterkennung",
  "model.default": "Hermes-Standardmodell",
  "agent.reasoning_effort": "Denkstufe für neue Anfragen",
  "fallback.min_switch_reset_seconds": "Fallback-Wechsel ab Resetzeit (Sekunden)",
  fallback_model: "Fallback-Kette",
  "agent.auto_recovery_cycles": "Automatische Erholungsrunden",
  "agent.run_budget_seconds": "Laufzeitbudget pro Agentenlauf (Sekunden)",
  "agent.budget_warning_ratio": "Warnung ab Budgetanteil",
  "agent.agent_cache.max_size": "Agenten im Gateway-Cache",
  max_concurrent_sessions: "Gleichzeitige Sitzungen (0 = unbegrenzt)",
  context_file_max_chars: "Kontextdatei-Zeichen (0 = dynamisch)",
  "compression.enabled": "Kontextkomprimierung",
  "compression.threshold": "Komprimierung ab Kontextanteil",
  "compression.target_ratio": "Erhaltener Kontextanteil",
  "compression.tail_mode": "Komprimierungsmodus",
  "compression.protect_last_n": "Geschützte letzte Nachrichten",
  "agent.max_turns": "Maximale Agent-Schritte",
  "agent.gateway_timeout": "Gateway-Leerlauf (Sekunden)",
  "agent.api_max_retries": "API-Wiederholungen",
  "session.terminal_continue": "Terminalsitzung lokal fortsetzen",
  max_live_sessions: "Sitzungen im Gateway-Speicher",
  models: "Modelle und Anbieter",
  agent: "Agent und Sitzungen",
  execution: "Ausführung und Werkzeuge",
  extensions: "Skills, Plugins und MCP",
  operations: "Zeitpläne und Betrieb",
};
const NUMERIC_LIMITS: Record<string, [number, number, number]> = {
  "fallback.min_switch_reset_seconds": [0, 3600, 1],
  "agent.auto_recovery_cycles": [0, 20, 1],
  "agent.run_budget_seconds": [1, 86400, 1],
  "agent.budget_warning_ratio": [0.01, 0.99, 0.01],
  "agent.agent_cache.max_size": [1, 4096, 1],
  max_concurrent_sessions: [0, 10000, 1],
  context_file_max_chars: [0, 1000000, 1],
  "compression.threshold": [0.1, 0.95, 0.01],
  "compression.target_ratio": [0.1, 0.8, 0.01],
  "compression.protect_last_n": [0, 100, 1],
  "agent.gateway_timeout": [60, 86400, 1],
  "agent.api_max_retries": [1, 10, 1],
  "agent.max_turns": [1, 100000, 1],
  max_live_sessions: [0, 10000, 1],
};

export function HermesConfigArea() {
  const observed = useHermesConfig();
  const patch = usePatchHermesConfig();
  const [draft, setDraft] = useState<Record<string, number | boolean | string | Array<{ provider: string; model: string }> | null>>({});
  if (observed.isPending) return <p role="status">Hermes-Konfiguration wird gelesen…</p>;
  if (observed.isError)
    return (
      <p role="alert">
        Hermes in Friday-Ubuntu ist nicht erreichbar.{" "}
        <button type="button" onClick={() => void observed.refetch()}>
          Erneut prüfen
        </button>
      </p>
    );
  const data = observed.data.data;
  if (!data.installed || data.revision === null)
    return (
      <p role="status">
        Hermes ist im ausgewählten Friday-Ubuntu-Konto nicht installiert. Einrichtung prüfen und danach erneut
        laden.
      </p>
    );
  const revision = data.revision;
  return (
    <div className="st-stack">
      <p role="status">
        Hermes-Quelle: <code>{data.sourceRevision?.slice(0, 12) ?? "unbekannt"}</code>. Konfigurationsversion:{" "}
        {data.revision}.
      </p>
      <p>
        Die Werte stammen aus <code>hermes config get</code>. Ein Speichern mit Rücklesung bestätigt die
        Datei; ob ein laufender Prozess den Wert übernommen hat, bleibt ungeprüft.
      </p>
      {data.fields.every((field) => !field.writable) ? (
        <p role="alert">
          Hermes-Quellstand weicht vom geprüften Stand ab. Schreibzugriffe sind bis zur Vertragsprüfung
          gesperrt.
        </p>
      ) : null}
      <h3>Freigegebene Einstellungen</h3>
      {data.fields.map((field) => {
        const value = field.key in draft ? draft[field.key] : field.value;
        return (
          <div key={field.key} className="st-field">
            <label htmlFor={`hermes-${field.key}`}>{LABELS[field.key] ?? field.key}</label>
            {field.key === "compression.tail_mode" ? (
              <select id={`hermes-${field.key}`} value={String(value ?? "lean")}
                onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))}>
                <option value="lean">Kompakt</option><option value="legacy">Verbatim-Verlauf</option>
              </select>
            ) : field.type === "fallback" ? (
              <div>
                {(Array.isArray(value) ? value : []).map((entry, index) => (
                  <div key={index} className="st-field">
                    <input aria-label={`Fallback ${index + 1} Anbieter`} value={entry.provider}
                      onChange={(event) => setDraft((current) => ({ ...current, [field.key]:
                        (Array.isArray(value) ? value : []).map((item, position) => position === index ? { ...item, provider: event.target.value } : item),
                      }))} />
                    <input aria-label={`Fallback ${index + 1} Modell`} value={entry.model}
                      onChange={(event) => setDraft((current) => ({ ...current, [field.key]:
                        (Array.isArray(value) ? value : []).map((item, position) => position === index ? { ...item, model: event.target.value } : item),
                      }))} />
                    <button type="button" onClick={() => setDraft((current) => ({ ...current, [field.key]:
                      (Array.isArray(value) ? value : []).filter((_, position) => position !== index),
                    }))}>Entfernen</button>
                  </div>
                ))}
                <button type="button" disabled={Array.isArray(value) && value.length >= 8}
                  onClick={() => setDraft((current) => ({ ...current, [field.key]:
                    [...(Array.isArray(value) ? value : []), { provider: "", model: "" }],
                  }))}>Fallback hinzufügen</button>
                <small>Leere Kette deaktiviert den Fallback. Hermes prüft Anbieter und Modell beim nächsten Aufruf.</small>
              </div>
            ) : field.key === "agent.reasoning_effort" ? (
              <select id={`hermes-${field.key}`} value={String(value ?? "")}
                onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))}>
                {["", "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"].map((effort) =>
                  <option key={effort} value={effort}>{effort || "Anbietervorgabe"}</option>)}
              </select>
            ) : field.type === "string" ? (
              <>
                <input id={`hermes-${field.key}`} type="text" value={String(value ?? "")}
                  list={field.key === "model.provider" ? "hermes-provider-ids" : undefined}
                  maxLength={field.key === "model.provider" ? 64 : 200}
                  onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))} />
                {field.key === "model.provider" ? <datalist id="hermes-provider-ids">
                  {data.modelProviders.map((provider) => <option key={provider.id} value={provider.id} />)}
                </datalist> : null}
              </>
            ) : field.type === "boolean" ? (
              <input
                id={`hermes-${field.key}`}
                type="checkbox"
                checked={value === true}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, [field.key]: event.target.checked }))
                }
              />
            ) : (
              <>
              <input
                id={`hermes-${field.key}`}
                type="number"
                value={typeof value === "number" ? value : ""}
                min={NUMERIC_LIMITS[field.key]?.[0] ?? 0}
                max={NUMERIC_LIMITS[field.key]?.[1] ?? 100000}
                step={NUMERIC_LIMITS[field.key]?.[2] ?? 1}
                onChange={(event) => setDraft((current) => ({ ...current,
                  [field.key]: event.target.value === "" &&
                    (field.type === "optionalInteger" || field.type === "optionalNumber")
                    ? null : Number(event.target.value),
                }))}
              />
              {field.type === "optionalInteger" || field.type === "optionalNumber" ?
                <button type="button" onClick={() => setDraft((current) => ({ ...current, [field.key]: null }))}>
                  Hermes-Standard
                </button> : null}
              </>
            )}
            <small>
              {field.explicit ? "In Hermes gesetzt" : "Hermes-Standard/Overlay"} · Verbraucher:{" "}
              {field.consumer} · Laufzeitbestätigung ausstehend
            </small>
            <button
              type="button"
              disabled={
                !field.writable ||
                patch.isPending ||
                draft[field.key] === undefined ||
                draft[field.key] === field.value ||
                (field.type === "fallback" && Array.isArray(draft[field.key]) &&
                  (draft[field.key] as Array<{ provider: string; model: string }>).some((entry) => !entry.provider || !entry.model))
              }
              onClick={() =>
                patch.mutate(
                  { revision, patch: { key: field.key, value: draft[field.key] } as HermesConfigPatch },
                  {
                    onSuccess: () =>
                      setDraft((current) => {
                        const next = { ...current };
                        delete next[field.key];
                        return next;
                      }),
                  },
                )
              }
            >
              Speichern
            </button>
          </div>
        );
      })}
      {data.write ? (
        <p role="status">
          {data.write.persisted ? "Gespeichert und rückgelesen" : "Rücklesung abweichend"}; laufender
          Hermes-Prozess: unbekannt.
        </p>
      ) : null}
      <h3>Weitere Hermes-Bereiche</h3>
      <p>
        Erfasste Anbieterkennungen: {data.modelProviders.length ? data.modelProviders.map((provider) => provider.id).join(", ") : "keine"}.
        Authentifizierung und Erreichbarkeit sind ungeprüft; Modelllisten erfordern eine anbieterspezifische Abfrage.
        {!data.inventory.modelProvidersComplete ? " Nicht alle Anbieterkennungen konnten dargestellt werden." : ""}
      </p>
      <p role={data.inventory.skillsComplete && data.inventory.pluginsComplete ? "status" : "alert"}>
        Profil-Inventar: {data.inventory.skillsComplete && data.inventory.pluginsComplete ? "vollständig" : "unvollständig"}
        {data.inventory.reasons.length ? ` (${data.inventory.reasons.join(", ")})` : ""}.
      </p>
      <p>
        Diese Bereiche sind für die angegebenen Pakete vorgemerkt. Ihre einzelnen Felder, Voraussetzungen und
        Verbraucher werden dort geprüft.
      </p>
      <ul>
        {data.families.map((family) => (
          <li key={family.id}>
            {LABELS[family.id] ?? family.id}:{" "}
            {family.configFileSet ? "expliziter Wert in config.yaml" : "kein expliziter Wert in config.yaml"}{" "}
            · {family.followup} · Konfiguration/Verfügbarkeit ungeprüft
          </li>
        ))}
      </ul>
      <p>
        Modell-API-Schlüssel in <code>config.yaml</code>:{" "}
        {data.secretStates[0]?.configFileSet ? "hinterlegt" : "nicht dort hinterlegt"}. Andere
        Credential-Quellen sind hier noch ungeprüft.
      </p>
      <details>
        <summary>Installierte Skills ({data.skills.length})</summary>
        <ul>
          {data.skills.map((skill) => (
            <li key={skill.id}>
              {skill.id}: {skill.enabled === null ? "Aktivierung unbekannt" : skill.enabled ? "nicht deaktiviert" : "deaktiviert"} · Nutzbarkeit ungeprüft
            </li>
          ))}
        </ul>
      </details>
      <details>
        <summary>Installierte Plugins ({data.plugins.length})</summary>
        <ul>
          {data.plugins.map((plugin) => (
            <li key={plugin.id}>
              {plugin.id}: {plugin.enabled === null ? "Aktivierung unbekannt" : plugin.enabled ? "in Hermes aktiviert" : "nicht aktiviert"} · Nutzbarkeit
              ungeprüft
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
