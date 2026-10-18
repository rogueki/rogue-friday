"use client";

import type { DurableMemorySearchResponse, DurableMemoryStatusResponse, DurableMemoryBackupResponse, DurableMemoryRestoreResponse, DurableMemorySettings, DurableMemorySettingsResponse } from "@friday/sdk";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { call } from "@/lib/api/call";
import { getApiClient } from "@/lib/api/client";
import { useSession } from "@/lib/session";

const KEY = ["durable-memory"] as const;

export function DurableMemoryPanel() {
  const { role, session, offline } = useSession();
  const identityId = session?.user?.id;
  const queryClient = useQueryClient();
  const [term, setTerm] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [backupPath, setBackupPath] = useState<string | null>(null);
  const [restoreResult, setRestoreResult] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [correction, setCorrection] = useState("");
  const [settingsDraft, setSettingsDraft] = useState<DurableMemorySettings | null>(null);
  const status = useQuery({ queryKey: [...KEY, "status"], enabled: role === "owner" && !offline,
    queryFn: (): Promise<DurableMemoryStatusResponse> => call(getApiClient().GET("/api/v1/integrations/memory/status")), retry: false });
  const search = useQuery({ queryKey: [...KEY, "search", identityId, searchTerm], enabled: role === "owner" && !offline && Boolean(identityId && searchTerm),
    queryFn: (): Promise<DurableMemorySearchResponse> => call(getApiClient().GET("/api/v1/integrations/memory/search", {
      params: { query: { query: searchTerm, identityId: identityId!, limit: 20 } },
    })), retry: false });
  const retry = useMutation({ mutationFn: () => call(getApiClient().POST("/api/v1/integrations/memory/retry")),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: KEY }) });
  const reindex = useMutation({ mutationFn: () => call(getApiClient().POST("/api/v1/integrations/memory/reindex")),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: KEY }) });
  const saveSettings = useMutation({ mutationFn: (value: DurableMemorySettings): Promise<DurableMemorySettingsResponse> =>
    call(getApiClient().PUT("/api/v1/integrations/memory/settings", { body: {
      enabled: value.enabled, privateMode: value.privateMode, channels: value.channels,
    } })), onSuccess: () => { setSettingsDraft(null); void queryClient.invalidateQueries({ queryKey: KEY }); } });
  const forget = useMutation({ mutationFn: (eventId: string) => call(getApiClient().DELETE("/api/v1/integrations/memory/events/{eventId}", {
    params: { path: { eventId } },
  })), onSuccess: () => void queryClient.invalidateQueries({ queryKey: KEY }) });
  const correct = useMutation({ mutationFn: ({ eventId, text }: { eventId: string; text: string }) =>
    call(getApiClient().PATCH("/api/v1/integrations/memory/events/{eventId}", { params: { path: { eventId } }, body: { text } })),
    onSuccess: () => { setEditingId(null); setCorrection(""); void queryClient.invalidateQueries({ queryKey: KEY }); } });
  const backup = useMutation({ mutationFn: (): Promise<DurableMemoryBackupResponse> =>
    call(getApiClient().POST("/api/v1/integrations/memory/backup")), onSuccess: (result) => setBackupPath(result.data.path) });
  const restore = useMutation({ mutationFn: (): Promise<DurableMemoryRestoreResponse> =>
    call(getApiClient().POST("/api/v1/integrations/memory/restore", { body: {
      backupPath: backupPath!, targetVaultPath: `${backupPath}-restore-${Date.now()}`,
    } })), onSuccess: (result) => { setRestoreResult(result.data.targetVaultPath); void queryClient.invalidateQueries({ queryKey: KEY }); } });
  if (role !== "owner") return null;
  const settings = settingsDraft ?? status.data?.data.settings;
  const changeSettings = (change: Partial<DurableMemorySettings>) => {
    if (settings) setSettingsDraft({ ...settings, ...change });
  };
  return <section className="mem-durable" aria-label="Dauerhaftes Obsidian-Gedächtnis">
    <h2>Obsidian-Gedächtnis</h2>
    {status.isPending && <p role="status">Gedächtnisstatus wird geladen …</p>}
    {status.isError && <p role="alert">Gedächtnisstatus nicht erreichbar.</p>}
    {status.data && <>
      <p role="status">Vault-Schreiber: {status.data.data.ready ? "bereit" : "nicht bereit"} · {status.data.data.pending} ausstehende Ereignisse · Vault: {status.data.data.vaultPath}</p>
      {status.data.data.lastError && <p role="alert">Letzter Schreibfehler: {status.data.data.lastError}</p>}
      <p>Letzter Schreibvorgang: {status.data.data.lastWrittenAt ?? "noch keiner"} · Letzter Restore-Test: {status.data.data.lastRestoreTestAt ?? "noch keiner"}</p>
      <button type="button" disabled={retry.isPending} onClick={() => retry.mutate()}>Ausstehende Einträge erneut schreiben</button>
      <button type="button" disabled={reindex.isPending} onClick={() => reindex.mutate()}>Vault neu indexieren</button>
      <p>Index: {status.data.data.indexState}. Vault-Wechsel und vorhandenen Ordner einrichten: <a href="/settings?area=skillAccounts#obsidian-setup-title">Obsidian-Einstellungen</a>.</p>
    </>}
    {settings && <form onSubmit={(event) => { event.preventDefault(); saveSettings.mutate(settings); }}>
      <h3>Aufnahme und Privatsphäre</h3>
      <label><input type="checkbox" checked={settings.enabled} onChange={(event) => changeSettings({ enabled: event.target.checked })} />Standard-Gedächtnis aktiv</label>
      <label><input type="checkbox" checked={settings.privateMode} onChange={(event) => changeSettings({ privateMode: event.target.checked })} />Privater Modus: neue Ereignisse nicht speichern</label>
      <p>Erfasste Kanäle: Dashboard-Befehle und Antworten; Stimme bei lokaler Voice-Verbindung; eigenständige Hermes-CLI mit installiertem Plugin. Messenger-Verknüpfung ist derzeit nicht aktiv.</p>
      {(["dashboard", "voice", "hermes"] as const).map((channel) => <label key={channel}>
        <input type="checkbox" checked={settings.channels[channel]} onChange={(event) =>
          changeSettings({ channels: { ...settings.channels, [channel]: event.target.checked } })} />{channel === "dashboard" ? "Dashboard" : channel === "voice" ? "Stimme" : "Hermes-CLI"}
      </label>)}
      <p>Aufbewahrung: unbegrenzt. Ausgeschlossen: private Eingaben, „nicht speichern“, erkannte Zugangsdaten-Muster und Roh-Audio. Bereits gesicherte Einträge bleiben bei Deaktivierung erhalten.</p>
      <button type="submit" disabled={!settingsDraft || saveSettings.isPending}>Einstellungen speichern</button>
      {saveSettings.isError && <p role="alert">Gedächtniseinstellungen konnten nicht gespeichert werden.</p>}
    </form>}
    <form onSubmit={(event) => { event.preventDefault(); setSearchTerm(term.trim()); }}>
      <label htmlFor="durable-memory-search">Gesprächsarchiv durchsuchen</label>
      <input id="durable-memory-search" value={term} onChange={(event) => setTerm(event.target.value)} />
      <button type="submit" disabled={!term.trim()}>Suchen</button>
    </form>
    {search.isPending && searchTerm && <p role="status">Suche läuft …</p>}
    {search.isError && <p role="alert">Gesprächsarchiv konnte nicht durchsucht werden.</p>}
    {search.data && <ul>{search.data.data.items.map((item) => <li key={item.eventId}>
      <p>{item.text}</p><small>{item.occurredAt} · {item.channel} · {item.source}</small>{" "}
      <button type="button" disabled={forget.isPending} onClick={() => forget.mutate(item.eventId)}>Vergessen</button>
      <button type="button" onClick={() => { setEditingId(item.eventId); setCorrection(item.text); }}>Korrigieren</button>
      {editingId === item.eventId && <form onSubmit={(event) => { event.preventDefault(); if (correction.trim()) correct.mutate({ eventId: item.eventId, text: correction.trim() }); }}>
        <label htmlFor={`correction-${item.eventId}`}>Korrigierter Eintrag</label>
        <textarea id={`correction-${item.eventId}`} value={correction} onChange={(event) => setCorrection(event.target.value)} />
        <button type="submit" disabled={!correction.trim() || correct.isPending}>Korrektur speichern</button>
        <button type="button" onClick={() => setEditingId(null)}>Abbrechen</button>
      </form>}
    </li>)}</ul>}
    {search.data?.data.items.length === 0 && <p>Keine passenden Einträge.</p>}
    <div>
      <button type="button" disabled={backup.isPending} onClick={() => backup.mutate()}>Vault-Backup erstellen</button>
      {backupPath && <><p>Backup: {backupPath}</p><button type="button" disabled={restore.isPending} onClick={() => restore.mutate()}>Restore in separatem Vault testen</button></>}
      {restoreResult && <p role="status">Restore geprüft: {restoreResult}</p>}
      {(backup.isError || restore.isError || forget.isError || correct.isError || retry.isError || reindex.isError) && <p role="alert">Aktion fehlgeschlagen. Der Gedächtnisstatus zeigt den aktuellen Stand.</p>}
    </div>
  </section>;
}
