"use client";

import type { HermesConfigPatch } from "@friday/sdk";
import { useState } from "react";
import { useHermesConfig, usePatchHermesConfig } from "@/lib/api/domains/settings";

const LABELS: Record<string, string> = {
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

export function HermesConfigArea() {
  const observed = useHermesConfig();
  const patch = usePatchHermesConfig();
  const [draft, setDraft] = useState<Record<string, number | boolean>>({});
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
        const value = draft[field.key] ?? field.value;
        return (
          <div key={field.key} className="st-field">
            <label htmlFor={`hermes-${field.key}`}>{LABELS[field.key] ?? field.key}</label>
            {field.type === "boolean" ? (
              <input
                id={`hermes-${field.key}`}
                type="checkbox"
                checked={value === true}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, [field.key]: event.target.checked }))
                }
              />
            ) : (
              <input
                id={`hermes-${field.key}`}
                type="number"
                value={typeof value === "number" ? value : ""}
                min={field.key === "max_live_sessions" ? 0 : field.key === "agent.gateway_timeout" ? 60 : 1}
                max={
                  field.key === "agent.api_max_retries"
                    ? 10
                    : field.key === "agent.gateway_timeout"
                      ? 86400
                      : field.key === "max_live_sessions"
                        ? 10000
                        : 100000
                }
                onChange={(event) =>
                  setDraft((current) => ({ ...current, [field.key]: Number(event.target.value) }))
                }
              />
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
                draft[field.key] === field.value
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
