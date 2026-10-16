"use client";

import { createIdempotencyKey, type CodingRun, type CodingRunResponse, type CodingVoiceRepositoryResponse, type SkillCatalogEntry } from "@friday/sdk";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { call } from "@/lib/api/call";
import { getApiClient } from "@/lib/api/client";

const cliNames = { codex: "Codex", opencode: "OpenCode", "claude-code": "Claude Code" } as const;
type Cli = keyof typeof cliNames;
const terminal = new Set(["completed", "failed", "interrupted", "cancelled", "timed_out"]);

export function CodingRunsArea({ skills }: { skills: SkillCatalogEntry[] }) {
  const [cli, setCli] = useState<"auto" | Cli>("auto");
  const [repository, setRepository] = useState("");
  const [task, setTask] = useState("");
  const [voiceAlias, setVoiceAlias] = useState("");
  const [voiceRepository, setVoiceRepository] = useState("");
  const [voiceSaved, setVoiceSaved] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [started, setStarted] = useState<CodingRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const stored = window.localStorage.getItem("friday.nativeCodingRunId");
    if (stored && /^run_[a-f0-9]{32}$/.test(stored)) setRunId(stored);
  }, []);
  const voiceProject = useQuery({
    queryKey: ["coding-voice-repository"],
    queryFn: (): Promise<CodingVoiceRepositoryResponse> => call(getApiClient().GET("/api/v1/coding-runs/voice-repository")),
  });
  useEffect(() => {
    if (!voiceProject.data || typeof voiceProject.data.data.alias !== "string" || typeof voiceProject.data.data.repository !== "string") return;
    setVoiceAlias(voiceProject.data.data.alias);
    setVoiceRepository(voiceProject.data.data.repository);
  }, [voiceProject.data]);
  const status = useQuery({
    queryKey: ["coding-run", runId],
    queryFn: (): Promise<CodingRunResponse> => call(getApiClient().GET("/api/v1/coding-runs/{runId}", { params: { path: { runId: runId! } } })),
    enabled: Boolean(runId), refetchInterval: (query) => terminal.has(query.state.data?.data.status ?? "") ? false : 4000,
  });
  async function start() {
    setBusy(true); setError(null);
    try {
      const result: CodingRunResponse = await call(getApiClient().POST("/api/v1/coding-runs", {
        params: { header: { "Idempotency-Key": createIdempotencyKey() } }, body: { cli, repository: repository.trim(), task: task.trim() },
      }));
      setStarted(result.data); setRunId(result.data.runId);
      window.localStorage.setItem("friday.nativeCodingRunId", result.data.runId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Coding-Auftrag konnte nicht gestartet werden."); }
    finally { setBusy(false); }
  }
  async function stop() {
    if (!runId) return;
    setBusy(true); setError(null);
    try { await call(getApiClient().POST("/api/v1/coding-runs/{runId}/stop", { params: { path: { runId } } })); await status.refetch(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Run konnte nicht gestoppt werden."); }
    finally { setBusy(false); }
  }
  async function saveVoiceProject() {
    if (!voiceProject.data) return;
    setBusy(true); setError(null); setVoiceSaved(null);
    try {
      const saved: CodingVoiceRepositoryResponse = await call(getApiClient().PUT("/api/v1/coding-runs/voice-repository", {
        params: { header: { "If-Match": String(voiceProject.data.data.revision) } },
        body: { alias: voiceAlias.trim(), repository: voiceRepository.trim() },
      }));
      setVoiceSaved(`Sprachprojekt ${saved.data.alias} gespeichert.`);
      await voiceProject.refetch();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Sprachprojekt konnte nicht gespeichert werden."); }
    finally { setBusy(false); }
  }
  const active = status.data?.data ?? started;
  return <section className="sk-coding" aria-labelledby="sk-coding-title">
    <h2 id="sk-coding-title">Coding mit Hermes</h2>
    <p>Wähle eine CLI und den Root-Ordner eines lokalen Git-Repositories. Friday prüft den aktivierten Hermes-Skill und startet genau diese native CLI im gewählten, für Linux-Git lesbaren Repository. Anbieter-Anmeldung und mögliche Kosten sind vorab selbst zu prüfen.</p>
    <ul>{(Object.entries(cliNames) as Array<[Cli, string]>).map(([id, name]) => {
      const skill = skills.find((item) => item.id === `hermes:${id}`);
      return <li key={id}><strong>{name}</strong>: {skill?.discovered ? skill.enabled ? "Skill aktiviert" : "Skill deaktiviert" : "Skill nicht gefunden oder Status unbekannt"} · Native CLI und Version: {started?.requestedCli === id ? started.preflightVersion ?? "unbekannt" : "erst beim Start geprüft"} · Anmeldung: unbekannt · Ausführung: {active?.requestedCli === id && active.executionVerified ? "CLI-Prozess gestartet" : "noch nicht bestätigt"}</li>;
    })}</ul>
    <div className="sk-coding__fields">
      <label>CLI<select value={cli} onChange={(event) => setCli(event.target.value as "auto" | Cli)}><option value="auto">Automatisch: erste ausführbare CLI</option>{Object.entries(cliNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label>Git-Repository unter deinem Benutzerprofil oder Friday-Installationspfad<input value={repository} onChange={(event) => setRepository(event.target.value)} placeholder="C:\Users\Name\Projekte\mein-repo" /></label>
      <label>Auftrag<textarea value={task} onChange={(event) => setTask(event.target.value)} rows={4} maxLength={4000} placeholder="Beschreibe konkret, was im Repository geändert werden soll." /></label>
    </div>
    <div className="sk-coding__fields">
      <h3>Projekt für Sprachaufträge</h3>
      <p>Lege ein Git-Repository einmal im Dashboard fest. Beim Speichern prüft Friday, ob Friday-Ubuntu das Git-Root lesen kann; eine Coding-CLI oder ein Modell wird dabei nicht gestartet. Friday akzeptiert per Sprache nur diesen Projektnamen, liest CLI, Projekt und Auftrag vor und wartet nach Ende der Ansage höchstens 90 Sekunden auf ein erneut sprecherverifiziertes „Ja“. Anbieter können Kosten verursachen.</p>
      <label>Gesprochener Projektname<input value={voiceAlias} maxLength={32} onChange={(event) => setVoiceAlias(event.target.value)} placeholder="Mein Projekt" /></label>
      <label>Git-Repository für Sprachaufträge<input value={voiceRepository} onChange={(event) => setVoiceRepository(event.target.value)} placeholder="C:\Users\Name\Projekte\mein-repo" /></label>
      <button type="button" disabled={busy || !voiceProject.data || voiceAlias.trim().length < 2 || !voiceRepository.trim()} onClick={() => void saveVoiceProject()}>Sprachprojekt speichern</button>
      {voiceSaved && <p role="status">{voiceSaved}</p>}
      <p>Beispiel: „Starte Codex im Projekt {voiceAlias.trim() || "Mein Projekt"} mit dem Auftrag, korrigiere den Fehler in der Anmeldung.“</p>
    </div>
    <button type="button" disabled={busy || !repository.trim() || task.trim().length < 10} onClick={() => void start()}>Coding-Auftrag starten</button>
    {error && <p role="alert" className="sk-warning">{error}</p>}
    {runId && <div className="sk-coding__status" role="status"><strong>Run {runId}</strong> · {status.isError ? "Status derzeit nicht verfügbar" : active?.status ?? "Status wird geladen"} · Gewählte CLI: {active?.requestedCli ?? "unbekannt"} · CLI-Prozess: {active?.executionVerified ? "im gewählten Repository gestartet" : "noch nicht bestätigt"}
      {active?.output && <pre>{active.output}</pre>}{active?.error && <p className="sk-warning">{active.error}</p>}
      {active && !terminal.has(active.status) && <button type="button" disabled={busy} onClick={() => void stop()}>Run stoppen</button>}
    </div>}
  </section>;
}
