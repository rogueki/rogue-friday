"use client";

import type { DurableMemorySearchResponse, DurableMemoryStatusResponse, DurableMemoryBackupResponse, DurableMemoryRestoreResponse, DurableMemorySettings, DurableMemorySettingsResponse } from "@friday/sdk";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, HudPanel, StatusChip, Switch, TextArea, TextField } from "@friday/ui";
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
  const saveSettingsBlocked = !settingsDraft ? "Keine geänderten Einstellungen." : undefined;
  const searchBlocked = !term.trim() ? "Zuerst einen Suchbegriff eingeben." : undefined;
  return <HudPanel title="Obsidian-Gedächtnis" subtitle="Dauerhaftes Gesprächsarchiv" className="mem-durable">
    {status.isPending && <p role="status">Gedächtnisstatus wird geladen …</p>}
    {status.isError && <p role="alert">Gedächtnisstatus nicht erreichbar.</p>}
    {status.data && <>
      <div className="mem-durable__status" role="status">
        <StatusChip tone={status.data.data.ready ? "green" : "red"}>{status.data.data.ready ? "Vault bereit" : "Vault nicht bereit"}</StatusChip>
        <StatusChip tone={status.data.data.pending ? "amber" : "muted"}>{status.data.data.pending} ausstehend</StatusChip>
        <StatusChip tone={status.data.data.indexState === "ready" ? "green" : "amber"}>Index: {status.data.data.indexState}</StatusChip>
      </div>
      <p className="mem-durable__path">Vault: {status.data.data.vaultPath}</p>
      {status.data.data.lastError && <p role="alert">Letzter Schreibfehler: {status.data.data.lastError}</p>}
      <p className="mem-durable__note">Letzter Schreibvorgang: {status.data.data.lastWrittenAt ?? "noch keiner"} · Letzter Restore-Test: {status.data.data.lastRestoreTestAt ?? "noch keiner"}</p>
      <div className="mem-durable__actions">
        <Button size="sm" variant="ghost" loading={retry.isPending} onClick={() => retry.mutate()}>Ausstehende Einträge erneut schreiben</Button>
        <Button size="sm" variant="ghost" loading={reindex.isPending} onClick={() => reindex.mutate()}>Vault neu indexieren</Button>
      </div>
      <p className="mem-durable__note">Vault-Wechsel und vorhandenen Ordner einrichten: <a href="/settings?area=skillAccounts#obsidian-setup-title">Obsidian-Einstellungen</a>.</p>
    </>}
    {settings && <form className="mem-durable__section" onSubmit={(event) => { event.preventDefault(); saveSettings.mutate(settings); }}>
      <h3>Aufnahme und Privatsphäre</h3>
      <div className="mem-durable__switches">
        <Switch label="Standard-Gedächtnis aktiv" checked={settings.enabled} onCheckedChange={(enabled) => changeSettings({ enabled })} />
        <Switch label="Privater Modus" description="Neue Ereignisse nicht speichern" checked={settings.privateMode} onCheckedChange={(privateMode) => changeSettings({ privateMode })} />
      </div>
      <p className="mem-durable__note">Messenger-Erfassung ist standardmäßig aus. Sie benötigt den lokalen Gateway-Hook, eine Owner-Verknüpfung für die genaue Absender-ID und eine private Direktnachricht.</p>
      <div className="mem-durable__switches">
        {(["dashboard", "voice", "hermes", "messenger"] as const).map((channel) => <Switch key={channel}
          label={channel === "dashboard" ? "Dashboard" : channel === "voice" ? "Stimme" : channel === "hermes" ? "Hermes-CLI" : "Messenger"}
          checked={settings.channels[channel]} onCheckedChange={(enabled) =>
            changeSettings({ channels: { ...settings.channels, [channel]: enabled } })} />)}
      </div>
      <p className="mem-durable__note">Aufbewahrung: unbegrenzt. Ausgeschlossen: private Eingaben, „nicht speichern“, erkannte Zugangsdaten-Muster und Roh-Audio. Bereits gesicherte Einträge bleiben bei Deaktivierung erhalten.</p>
      <div className="mem-durable__actions"><Button type="submit" size="sm" disabled={saveSettingsBlocked !== undefined} title={saveSettingsBlocked} loading={saveSettings.isPending}>Einstellungen speichern</Button></div>
      {saveSettings.isError && <p role="alert">Gedächtniseinstellungen konnten nicht gespeichert werden.</p>}
    </form>}
    <form className="mem-durable__section" onSubmit={(event) => { event.preventDefault(); setSearchTerm(term.trim()); }}>
      <h3>Gesprächsarchiv</h3>
      <div className="mem-durable__search">
        <TextField id="durable-memory-search" label="Gesprächsarchiv durchsuchen" value={term} onChange={(event) => setTerm(event.target.value)} />
        <Button type="submit" size="sm" disabled={searchBlocked !== undefined} title={searchBlocked}>Suchen</Button>
      </div>
    </form>
    {search.isPending && searchTerm && <p role="status">Suche läuft …</p>}
    {search.isError && <p role="alert">Gesprächsarchiv konnte nicht durchsucht werden.</p>}
    {search.data && <ul className="mem-durable__results">{search.data.data.items.map((item) => <li key={item.eventId}>
      <p>{item.text}</p><small>{item.occurredAt} · {item.channel} · {item.source}</small>
      <div className="mem-durable__actions">
        <Button size="sm" variant="danger" disabled={forget.isPending} onClick={() => forget.mutate(item.eventId)}>Vergessen</Button>
        <Button size="sm" variant="ghost" onClick={() => { setEditingId(item.eventId); setCorrection(item.text); }}>Korrigieren</Button>
      </div>
      {editingId === item.eventId && <form className="mem-durable__section" onSubmit={(event) => { event.preventDefault(); if (correction.trim()) correct.mutate({ eventId: item.eventId, text: correction.trim() }); }}>
        <TextArea id={`correction-${item.eventId}`} label="Korrigierter Eintrag" value={correction} onChange={(event) => setCorrection(event.target.value)} />
        <div className="mem-durable__actions">
          <Button type="submit" size="sm" disabled={!correction.trim()} loading={correct.isPending}>Korrektur speichern</Button>
          <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Abbrechen</Button>
        </div>
      </form>}
    </li>)}</ul>}
    {search.data?.data.items.length === 0 && <p>Keine passenden Einträge.</p>}
    <div className="mem-durable__section">
      <h3>Vault-Sicherung</h3>
      <div className="mem-durable__actions"><Button size="sm" loading={backup.isPending} onClick={() => backup.mutate()}>Vault-Backup erstellen</Button>
        {backupPath && <Button size="sm" variant="ghost" loading={restore.isPending} onClick={() => restore.mutate()}>Restore in separatem Vault testen</Button>}
      </div>
      {backupPath && <p className="mem-durable__path">Backup: {backupPath}</p>}
      {restoreResult && <p role="status">Restore geprüft: {restoreResult}</p>}
      {(backup.isError || restore.isError || forget.isError || correct.isError || retry.isError || reindex.isError) && <p role="alert">Aktion fehlgeschlagen. Der Gedächtnisstatus zeigt den aktuellen Stand.</p>}
    </div>
  </HudPanel>;
}
