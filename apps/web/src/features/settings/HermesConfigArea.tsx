"use client";

import type { HermesConfigPatch } from "@friday/sdk";
import { useState } from "react";
import { useHermesConfig, useHermesModelCatalog, usePatchHermesConfig, useProbeHermesMcp,
  useManageHermesMcpOAuth, useHermesMcpOAuthFlow } from "@/lib/api/domains/settings";

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
  "terminal.timeout": "Terminal-Befehlslimit (Sekunden)",
  "terminal.backend": "Terminal-Ausfuehrungsort",
  "terminal.docker_network": "Netzwerk im Docker-Sandbox-Container",
  "terminal.docker_mount_cwd_to_workspace": "Arbeitsordner in Docker einbinden",
  "browser.command_timeout": "Browser-Befehlslimit (Sekunden)",
  "browser.snapshot_threshold": "Browser-Snapshot-Grenze (Zeichen)",
  "browser.allow_private_urls": "Private Adressen im Browser erlauben",
  "browser.use_real_profile": "Echtes Browserprofil als Snapshot verwenden",
  "browser.real_profile_pin": "Browserprofil-Verzeichnis",
  "browser.restrict_evaluate": "Browser-Konsole einschraenken",
  "browser.allow_unsafe_evaluate": "Unsichere Browser-Auswertung erlauben",
  "code_execution.mode": "Code-Ausfuehrungsmodus",
  "computer_use.permission_mode": "Computer-Use-Berechtigung",
  "computer_use.capability_manifest": "Computer-Use-Capability-Manifest",
  "terminal.cwd": "Terminal-Arbeitsordner",
  "terminal.docker_volumes": "Docker-Mounts (Host:Container)",
  toolsets: "Hermes-Toolsets",
  command_allowlist: "Dauerhaft erlaubte Befehlsmuster (nur entfernen)",
  "approvals.mode": "Hermes-Befehlsfreigabe",
  "approvals.timeout": "Freigabefenster (Sekunden)",
  "approvals.single_query_mode": "Unbeaufsichtigte Einzelanfragen",
  "approvals.unattended_mode": "Unbeaufsichtigte Gateway-Aufrufe",
  "security.protected_instruction_files": "Agent-Anweisungsdateien schuetzen",
  "skills.disabled": "Deaktivierte Hermes-Skills",
  "cron.catch_up_missed": "Verpassten Hermes-Cron-Termin nachholen",
  "cron.allow_agent_scheduling": "Cron-Agenten dürfen Hermes-Jobs planen",
  "cron.preflight": "Cron-Konfiguration vor Ausführung prüfen",
  "cron.max_parallel_jobs": "Gleichzeitige Hermes-Cron-Jobs je Profil",
  "cron.output_retention": "Cron-Ausgaben je Job behalten",
  "cron.script_timeout_seconds": "Cron-Skriptlimit (Sekunden)",
  "cron.session_db_timeout_seconds": "Cron-Datenbanklimit (Sekunden)",
  "cron.failure_repeat_alert_hours": "Gleichen Cron-Fehler nach Stunden erneut melden",
  "cron.require_restart_safe_scope": "Cron nur in neustartsicherem Scope",
  "gateway.loop_watchdog": "Gateway-Ereignisschleife überwachen",
  "gateway.startup_watchdog": "Gateway-Start überwachen",
  "gateway.startup_watchdog_timeout_seconds": "Gateway-Startlimit (Sekunden)",
  "gateway.restart_loop_guard.max_restarts": "Gateway-Neustartkette begrenzen",
  "gateway.respawn_storm.max_starts": "Gateway-Starts pro Zeitfenster begrenzen",
  "gateway.signal_interrupt_grace_timeout": "Gateway-Signalablauf (Sekunden)",
  "logging.level": "Hermes-Dateilogstufe",
  "logging.max_size_mb": "Hermes-Logdatei (MiB)",
  "logging.backup_count": "Hermes-Logrotationen",
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
  "terminal.timeout": [1, 3600, 1],
  "browser.command_timeout": [5, 600, 1],
  "browser.snapshot_threshold": [1000, 200000, 1000],
  "approvals.timeout": [15, 600, 1],
  "cron.max_parallel_jobs": [1, 64, 1],
  "cron.output_retention": [0, 10000, 1],
  "cron.script_timeout_seconds": [1, 86400, 1],
  "cron.session_db_timeout_seconds": [0, 3600, 1],
  "cron.failure_repeat_alert_hours": [0, 168, 1],
  "gateway.startup_watchdog_timeout_seconds": [30, 3600, 1],
  "gateway.restart_loop_guard.max_restarts": [0, 20, 1],
  "gateway.respawn_storm.max_starts": [0, 100, 1],
  "gateway.signal_interrupt_grace_timeout": [0, 60, 0.1],
  "logging.max_size_mb": [1, 100, 1],
  "logging.backup_count": [0, 50, 1],
};
const EXECUTION_OPTIONS: Record<string, Array<[string, string]>> = {
  "terminal.backend": [["local", "Lokaler WSL-Host"], ["docker", "Docker-Sandbox"]],
  "code_execution.mode": [["project", "Projektumgebung"], ["strict", "Isoliertes Verzeichnis"]],
  "computer_use.permission_mode": [["standard", "Treiber fragt nach Freigaben"],
    ["bounded", "Nur Capability-Manifest"]],
  "approvals.mode": [["manual", "Immer bei Gefahr fragen"], ["smart", "Smart-Guardian und Freigabe"]],
  "approvals.single_query_mode": [["deny", "Gefaehrliche Befehle ablehnen"]],
  "approvals.unattended_mode": [["deny", "Gefaehrliche Befehle ablehnen"]],
};

export function HermesConfigArea() {
  const observed = useHermesConfig();
  const patch = usePatchHermesConfig();
  const mcpProbe = useProbeHermesMcp();
  const mcpOAuth = useManageHermesMcpOAuth();
  const [oauthFlow, setOAuthFlow] = useState<{ flowId: string; revision: number; name: string } | null>(null);
  const oauthStatus = useHermesMcpOAuthFlow(oauthFlow?.flowId ?? null, oauthFlow?.revision ?? null);
  const [showCatalog, setShowCatalog] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [probeProvider, setProbeProvider] = useState<string | null>(null);
  const catalog = useHermesModelCatalog(undefined, showCatalog);
  const selectedCatalog = useHermesModelCatalog(probeProvider ?? undefined, probeProvider !== null);
  const [draft, setDraft] = useState<Record<string, number | boolean | string | string[] |
    Array<{ provider: string; model: string }> | null>>({});
  const [credentialDraft, setCredentialDraft] = useState<Record<string, string>>({});
  const [mcpName, setMcpName] = useState("");
  const [mcpUrl, setMcpUrl] = useState("");
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
  const effectiveProvider = String(draft["model.provider"] ??
    data.fields.find((field) => field.key === "model.provider")?.value ?? "");
  const skillField = data.fields.find((field) => field.key === "skills.disabled");
  const disabledSkills = Array.isArray(skillField?.value) && skillField.value.every((name) => typeof name === "string")
    ? skillField.value as string[] : null;
  return (
    <div className="st-stack">
      {patch.isError ? <p role="alert">{patch.error instanceof Error ? patch.error.message :
        "Hermes-Einstellung konnte nicht bestätigt werden. Status neu laden."}</p> : null}
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
      {(["models", "agent", "execution", "operations"] as const).map((family) => <section key={family} aria-label={LABELS[family]}>
        <h4>{LABELS[family]}</h4>
      {data.fields.filter((field) => field.family === family && field.type !== "skillNames").map((field) => {
        const value = field.key in draft ? draft[field.key] : field.value;
        const fallbackValue = Array.isArray(value) ? value.filter((entry): entry is { provider: string; model: string } =>
          typeof entry === "object" && entry !== null && "provider" in entry && "model" in entry) : [];
        return (
          <div key={field.key} className="st-field">
            <label htmlFor={`hermes-${field.key}`}>{LABELS[field.key] ?? field.key}</label>
            {field.key === "logging.level" ? (
              <select id={`hermes-${field.key}`} value={String(value ?? "INFO")}
                onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))}>
                <option value="DEBUG">DEBUG</option><option value="INFO">INFO</option><option value="WARNING">WARNING</option>
              </select>
            ) : field.key === "compression.tail_mode" ? (
              <select id={`hermes-${field.key}`} value={String(value ?? "lean")}
                onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))}>
                <option value="lean">Kompakt</option><option value="legacy">Verbatim-Verlauf</option>
              </select>
            ) : field.type === "fallback" ? (
              <div>
                {fallbackValue.map((entry, index) => (
                  <div key={index} className="st-field">
                    <input aria-label={`Fallback ${index + 1} Anbieter`} value={entry.provider}
                      onChange={(event) => setDraft((current) => ({ ...current, [field.key]:
                        fallbackValue.map((item, position) => position === index ? { ...item, provider: event.target.value } : item),
                      }))} />
                    <input aria-label={`Fallback ${index + 1} Modell`} value={entry.model}
                      onChange={(event) => setDraft((current) => ({ ...current, [field.key]:
                        fallbackValue.map((item, position) => position === index ? { ...item, model: event.target.value } : item),
                      }))} />
                    <button type="button" onClick={() => setDraft((current) => ({ ...current, [field.key]:
                        fallbackValue.filter((_, position) => position !== index),
                    }))}>Entfernen</button>
                  </div>
                ))}
                <button type="button" disabled={fallbackValue.length >= 8}
                  onClick={() => setDraft((current) => ({ ...current, [field.key]:
                    [...fallbackValue, { provider: "", model: "" }],
                  }))}>Fallback hinzufügen</button>
                <small>Leere Kette deaktiviert den Fallback. Hermes prüft Anbieter und Modell beim nächsten Aufruf.</small>
              </div>
            ) : field.type === "textList" ? (
              <textarea id={`hermes-${field.key}`} rows={Math.max(3, Math.min(8, Array.isArray(value) ? value.length + 1 : 3))}
                value={Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").join("\n") : ""}
                onChange={(event) => setDraft((current) => ({ ...current, [field.key]:
                  event.target.value.split("\n").map((line) => line.trim()).filter(Boolean) }))} />
            ) : EXECUTION_OPTIONS[field.key] ? (
              <select id={`hermes-${field.key}`} value={String(value ?? "")}
                onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))}>
                {EXECUTION_OPTIONS[field.key]!.map(([option, label]) =>
                  <option key={option} value={option}>{label}</option>)}
              </select>
            ) : field.key === "agent.reasoning_effort" ? (
              <select id={`hermes-${field.key}`} value={String(value ?? "")}
                onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))}>
                {["", "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"].map((effort) =>
                  <option key={effort} value={effort}>{effort || "Anbietervorgabe"}</option>)}
              </select>
            ) : field.type === "string" ? (
              <>
                <input id={`hermes-${field.key}`} type="text" value={String(value ?? "")}
                  list={field.key === "model.provider" ? "hermes-provider-ids" :
                    field.key === "model.default" && selectedCatalog.data?.data.selected?.id === effectiveProvider ?
                      "hermes-model-ids" : undefined}
                  maxLength={field.key === "model.provider" ? 64 : 200}
                  onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))} />
                {field.key === "model.provider" ? <datalist id="hermes-provider-ids">
                  {(catalog.data?.data.providers ?? data.modelProviders).map((provider) => <option key={provider.id} value={provider.id} />)}
                </datalist> : null}
                {field.key === "model.default" && selectedCatalog.data?.data.selected?.id === effectiveProvider ?
                  <datalist id="hermes-model-ids">
                    {selectedCatalog.data.data.selected.models.map((model) => <option key={model} value={model} />)}
                  </datalist> : null}
              </>
            ) : field.type === "boolean" ? (
              <input
                id={`hermes-${field.key}`}
                type="checkbox"
                checked={value === true}
                disabled={field.key === "security.protected_instruction_files" && value === true}
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
            {field.key === "browser.use_real_profile" && value === true ?
              <small>Neue Browsersitzungen können einen Snapshot Ihrer lokalen Logins verwenden. Zuerst den Profilverzeichnisnamen festlegen; Ausschalten entfernt den Hermes-Profilsnapshot.</small> : null}
            {field.key === "browser.allow_private_urls" && value === true ?
              <small>Der Browser darf damit interne und lokale Adressen erreichen.</small> : null}
            {field.key === "terminal.docker_mount_cwd_to_workspace" && value === true ?
              <small>Der aktuelle Host-Arbeitsordner wird im Container unter /workspace erreichbar.</small> : null}
            {field.key === "terminal.backend" && value === "local" ?
              <small>Terminalbefehle laufen im Friday-Ubuntu-Benutzerkonto mit dessen Dateirechten. Vor Docker-Wechsel Netzwerk deaktivieren und Mounts entfernen.</small> : null}
            {field.key === "terminal.docker_network" && value === true ?
              <small>Neue Docker-Sandboxes erhalten Netzwerkzugriff.</small> : null}
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
      </section>)}
      {data.write ? (
        <p role="status">
          {data.write.persisted ? "Gespeichert und rückgelesen" : "Rücklesung abweichend"}; laufender
          Hermes-Prozess: unbekannt.
        </p>
      ) : null}
      <section aria-label="Modellanbieter-Zugänge">
        <h3>Modellanbieter-Zugänge</h3>
        <p>Schlüssel werden nur beim Speichern gesendet und nie zurückgegeben. „Hinterlegt“ bestätigt die lokale Speicherung; Anmeldung und Modellzugriff bleiben ungeprüft.</p>
        {data.secretStates.filter((state) => state.key !== "model.api_key").map((state) => (
          <div key={state.key} className="st-field">
            <label htmlFor={`hermes-secret-${state.key}`}>{state.key}</label>
            <input id={`hermes-secret-${state.key}`} type="password" autoComplete="off"
              value={credentialDraft[state.key] ?? ""} maxLength={4096}
              onChange={(event) => setCredentialDraft((current) => ({ ...current, [state.key]: event.target.value }))} />
            <small>{state.configFileSet ? "Lokal hinterlegt" : "Nicht lokal hinterlegt"} · Anbieterprüfung ausstehend</small>
            <button type="button" disabled={patch.isPending || !credentialDraft[state.key] || data.fields.every((field) => !field.writable)}
              onClick={() => patch.mutate({ revision, patch: { key: state.key as "OPENROUTER_API_KEY", value: credentialDraft[state.key] ?? "" } },
                { onSuccess: () => setCredentialDraft((current) => ({ ...current, [state.key]: "" })) })}>Schlüssel speichern</button>
            <button type="button" disabled={patch.isPending || !state.configFileSet || data.fields.every((field) => !field.writable)}
              onClick={() => patch.mutate({ revision, patch: { key: state.key as "OPENROUTER_API_KEY", value: null } },
                { onSuccess: () => setCredentialDraft((current) => ({ ...current, [state.key]: "" })) })}>Schlüssel entfernen</button>
          </div>
        ))}
      </section>
      <section aria-label="Hermes-Modellkatalog">
        <h3>Hermes-Modellkatalog</h3>
        <p>Die Anbieterliste kommt aus dem installierten Hermes-Picker. Die ausdrückliche Modellprüfung fragt einen Anbieter-Katalogendpunkt ab, ohne eine Modellanfrage zu senden. Ein Katalogtreffer bestätigt die Nutzbarkeit des Modells noch nicht.</p>
        <button type="button" disabled={catalog.isFetching}
          onClick={() => showCatalog ? void catalog.refetch() : setShowCatalog(true)}>
          {showCatalog ? "Anbieterliste neu laden" : "Anbieter laden"}
        </button>
        {catalog.isError ? <p role="alert">Anbieterliste nicht erreichbar.</p> : null}
        {catalog.data ? <>
          <p>{catalog.data.data.providers.length} Anbieterkennungen im aktuellen Picker; die Vollständigkeit externer Plugin-Profile ist unbekannt.</p>
          <label htmlFor="hermes-catalog-provider">Anbieter für Modellprüfung</label>
          <select id="hermes-catalog-provider" value={selectedProvider ?? ""}
            onChange={(event) => { setSelectedProvider(event.target.value || null); setProbeProvider(null); }}>
            <option value="">Anbieter wählen</option>
            {catalog.data.data.providers.map((provider) =>
              <option key={provider.id} value={provider.id}>{provider.label} ({provider.id})</option>)}
          </select>
          {selectedProvider ? <button type="button" disabled={selectedCatalog.isFetching}
            onClick={() => probeProvider === selectedProvider ? void selectedCatalog.refetch() : setProbeProvider(selectedProvider)}>
            Modellliste prüfen
          </button> : null}
        </> : null}
        {selectedCatalog.isError ? <p role="alert">Modellkatalog nicht erreichbar.</p> : null}
        {selectedCatalog.data?.data.selected ? <>
          <p role="status">
            {selectedCatalog.data.data.selected.probeStatus === "succeeded" ?
              "Anbieter-Katalogendpunkt hat geantwortet" :
              selectedCatalog.data.data.selected.probeStatus === "failed" ?
                "Katalogabfrage fehlgeschlagen; nur kuratierte Kandidaten" :
                "Keine verifizierende Abfrage für diesen Anbieter; nur kuratierte Kandidaten"}.
            Modellnutzung bleibt ungeprüft.
          </p>
          <p>Modellkandidaten: {selectedCatalog.data.data.selected.models.length ?
            selectedCatalog.data.data.selected.models.join(", ") : "keine"}</p>
        </> : null}
      </section>
      <h3>Weitere Hermes-Bereiche</h3>
      <p>
        Im Profil konfigurierte Anbieterkennungen: {data.modelProviders.length ? data.modelProviders.map((provider) => provider.id).join(", ") : "keine"}.
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
        Weitere Credential-Quellen und die tatsächliche Anbieteranmeldung sind ungeprüft.
      </p>
      <details>
        <summary>Installierte Skills ({data.skills.length})</summary>
        <ul>
          {data.skills.map((skill) => (
            <li key={skill.id}>
              {skill.id}: {skill.enabled === null ? "Aktivierung unbekannt" : skill.enabled ? "nicht deaktiviert" : "deaktiviert"} · Nutzbarkeit ungeprüft
              {skill.id !== "hermes-agent" && skill.enabled !== null && disabledSkills && skillField?.writable &&
                data.inventory.skillsComplete ? <button type="button" disabled={patch.isPending}
                  onClick={() => patch.mutate({ revision, patch: { key: "skills.disabled",
                    value: skill.enabled ? [...disabledSkills, skill.id] : disabledSkills.filter((name) => name !== skill.id),
                  } })}>
                  {skill.enabled ? "Deaktivieren" : "Aktivieren"}
                </button> : null}
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
              {plugin.enabled !== null && data.inventory.pluginsComplete ?
                <button type="button" disabled={patch.isPending}
                  onClick={() => patch.mutate({ revision, patch: { key: "plugin.activation", pluginId: plugin.id,
                    enabled: !plugin.enabled } })}>
                  {plugin.enabled ? "Plugin deaktivieren" : "Installierten Plugin-Code aktivieren"}
                </button> : null}
            </li>
          ))}
        </ul>
      </details>
      <section aria-label="Hermes-MCP-Server">
        <h3>Hermes-MCP-Server</h3>
        <p>Friday kann HTTPS-MCP-Endpunkte und zugehoerige Bearer-Schluessel im Hermes-Profil hinterlegen. Ein gespeicherter Eintrag bestaetigt keine Verbindung; Hermes laedt ihn erst in einer neuen Sitzung oder nach einem MCP-Reload.</p>
        <label htmlFor="hermes-mcp-name">Serverkennung</label>
        <input id="hermes-mcp-name" value={mcpName} maxLength={64} onChange={(event) => setMcpName(event.target.value)} />
        <label htmlFor="hermes-mcp-url">HTTPS-Endpunkt</label>
        <input id="hermes-mcp-url" type="url" value={mcpUrl} maxLength={2048} placeholder="https://example.org/mcp"
          onChange={(event) => setMcpUrl(event.target.value)} />
        <button type="button" disabled={patch.isPending || !data.mcpComplete || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(mcpName) || !mcpUrl.startsWith("https://")}
          onClick={() => patch.mutate({ revision, patch: { key: "mcp.httpServer", name: mcpName, url: mcpUrl, enabled: true } })}>
          HTTPS-Server hinterlegen und fuer neue Hermes-Sitzungen aktivieren
        </button>
        <p role={data.mcpComplete ? "status" : "alert"}>{data.mcpComplete ? "Konfigurierte Server gelesen" : "MCP-Inventar unvollstaendig"}</p>
        <ul>{data.mcpServers.map((server) => <li key={server.id}>
          {server.id}: {server.transport}, {server.enabled === null ? "Aktivierung unbekannt" : server.enabled ? "konfiguriert aktiviert" : "konfiguriert deaktiviert"}; Konfiguration ohne Verbindungsnachweis
          {server.endpoint ? ` (${server.endpoint}; Pfad ausgeblendet)` : ""}
          {server.authMode === "bearer" ? `; Bearer-Schluessel ${server.credentialConfigured ? "hinterlegt" : "fehlt"}` :
            server.authMode === "oauth" ? `; OAuth-Token-Datei ${server.credentialConfigured ? "hinterlegt" : "fehlt"}` :
            server.authMode === "unknown" ? "; Authentifizierung unbekannt" : ""}
          {server.transport === "http" && (server.authMode === "none" || server.authMode === "bearer") &&
            /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(server.id) ? <div>
              <label htmlFor={`hermes-mcp-token-${server.id}`}>Bearer-Schluessel fuer {server.id}</label>
              <input id={`hermes-mcp-token-${server.id}`} type="password" autoComplete="off" maxLength={4096}
                value={credentialDraft[`mcp:${server.id}`] ?? ""}
                onChange={(event) => setCredentialDraft((current) => ({ ...current,
                  [`mcp:${server.id}`]: event.target.value }))} />
              <button type="button" disabled={patch.isPending || !/^[\x21-\x7e]{1,4096}$/.test(credentialDraft[`mcp:${server.id}`] ?? "")}
                onClick={() => patch.mutate({ revision, patch: { key: "mcp.bearerCredential", name: server.id,
                  token: credentialDraft[`mcp:${server.id}`] ?? "" } },
                { onSuccess: () => setCredentialDraft((current) => ({ ...current, [`mcp:${server.id}`]: "" })) })}>
                Bearer-Schluessel hinterlegen
              </button>
              {server.authMode === "bearer" ? <button type="button" disabled={patch.isPending}
                onClick={() => patch.mutate({ revision, patch: { key: "mcp.bearerCredential", name: server.id, token: null } })}>
                Bearer-Schluessel entfernen
              </button> : null}
            </div> : null}
          {(server.editable || server.authMode === "bearer" && server.credentialConfigured) && server.enabled ?
            <button type="button" disabled={mcpProbe.isPending}
            onClick={() => mcpProbe.mutate({ name: server.id, revision })}>
            MCP-Protokollverbindung pruefen
          </button> : null}
          {mcpProbe.data?.data.name === server.id && mcpProbe.data.data.revision === revision ?
            <p role="status">Probe {mcpProbe.data.data.connected ?
              `verbunden; ${mcpProbe.data.data.toolCount} Werkzeuge${mcpProbe.data.data.toolCountComplete ? "" : " (weitere Seiten nicht geprueft)"}` :
              `fehlgeschlagen (${mcpProbe.data.data.failureClass})`}. Zeitpunkt: {mcpProbe.data.data.checkedAt}.
              Uebernahme in laufende Hermes-Sitzungen ungeprueft.</p> : null}
          {server.transport === "http" && (server.authMode === "none" && server.editable ||
            server.authMode === "oauth" && server.credentialConfigured === false) && server.enabled &&
            /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(server.id) ? <button type="button" disabled={mcpOAuth.isPending}
            onClick={() => mcpOAuth.mutate({ action: "start", name: server.id, revision },
              { onSuccess: (response) => setOAuthFlow({ flowId: response.data.flowId, revision, name: server.id }) })}>
            {server.authMode === "oauth" ? "Unvollstaendige OAuth-Anmeldung wiederholen" : "OAuth-Anmeldung starten"}
          </button> : null}
          {oauthFlow?.name === server.id && oauthStatus.data ? <div role="status">
            <p>OAuth: {oauthStatus.data.data.status === "configured" ?
              "Hermes-Zugangsdaten und Konfiguration gespeichert; neue Sitzung oder MCP-Reload erforderlich" :
              oauthStatus.data.data.status === "failed" ? `fehlgeschlagen (${oauthStatus.data.data.failureClass})` :
              oauthStatus.data.data.status === "awaiting_approval" ? "Freigabe im Browser erwartet" :
              oauthStatus.data.data.status}.</p>
            {oauthStatus.data.data.status === "awaiting_approval" && oauthStatus.data.data.authorizationUrl ?
              <a href={oauthStatus.data.data.authorizationUrl} target="_blank" rel="noopener noreferrer">
                OAuth-Freigabe im Browser oeffnen
              </a> : null}
            {["starting", "awaiting_approval"].includes(oauthStatus.data.data.status) ?
              <button type="button" disabled={mcpOAuth.isPending}
                onClick={() => mcpOAuth.mutate({ action: "cancel", flowId: oauthFlow.flowId,
                  revision: oauthFlow.revision }, { onSuccess: () => void oauthStatus.refetch() })}>
                Anmeldung abbrechen
              </button> : null}
          </div> : null}
          {server.editable && server.enabled !== null ? <button type="button" disabled={patch.isPending}
            onClick={() => patch.mutate({ revision, patch: { key: "mcp.activation", name: server.id,
              enabled: !server.enabled } })}>
            {server.enabled ? "Server fuer neue Sitzungen deaktivieren" : "Server fuer neue Sitzungen aktivieren"}
          </button> : null}
          {server.editable ? <button type="button" disabled={patch.isPending}
            onClick={() => patch.mutate({ revision, patch: { key: "mcp.httpServer", name: server.id, url: null, enabled: false } })}>
            HTTP-Servereintrag entfernen
          </button> : null}
        </li>)}</ul>
        {mcpProbe.isError ? <p role="alert">MCP-Probe nicht bestaetigt: {mcpProbe.error.message}.
          Konfiguration neu laden und den gewuenschten Server erneut pruefen.</p> : null}
        {mcpOAuth.isError ? <p role="alert">OAuth-Vorgang nicht bestaetigt: {mcpOAuth.error.message}.</p> : null}
        {oauthStatus.isError ? <p role="alert">OAuth-Status nicht lesbar: {oauthStatus.error.message}.</p> : null}
      </section>
    </div>
  );
}
