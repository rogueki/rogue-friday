"use client";

import { Button, StatusChip, TextField } from "@friday/ui";
import type { ContentStudioKeyPatch, ContentStudioKeysResponse } from "@friday/sdk";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { call } from "@/lib/api/call";
import { getApiClient } from "@/lib/api/client";
import { useSettingsDrafts } from "./SettingsDrafts";
import { Section } from "./controls";

const providers = [
  { id: "kie", label: "kie.ai", env: "KIE_API_KEY", support: "Serverseitige Bild- und Video-API vorhanden. Bezahlte Aufträge brauchen eine ausdrückliche Bestätigung; Medienablage fehlt noch.", connected: true },
  { id: "elevenlabs", label: "ElevenLabs", env: "ELEVENLABS_API_KEY", support: "Serverseitige MP3-API und Download im Content Studio vorhanden. Bezahlte Aufträge brauchen eine ausdrückliche Bestätigung.", connected: true },
  { id: "capcut", label: "CapCut", env: "CAPCUT_API_KEY", support: "Nicht angebunden: Es gibt keine öffentliche CapCut-Schnittstelle für den Schnittworkflow. Der Schnitt läuft lokal mit FFmpeg; CapCut bleibt optionale manuelle Nachbearbeitung.", connected: false },
] as const;

export function ContentStudioKeysArea() {
  const { readOnly } = useSettingsDrafts();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["content-studio", "keys"], queryFn: (): Promise<ContentStudioKeysResponse> => call(getApiClient().GET("/api/v1/settings/content-studio-keys")), enabled: !readOnly });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const save = async (provider: ContentStudioKeyPatch["provider"], key: string): Promise<void> => {
    setBusy(provider); setMessage("");
    try {
      await call(getApiClient().PATCH("/api/v1/settings/content-studio-keys", { body: { provider, key } }));
      setDraft((current) => ({ ...current, [provider]: "" }));
      await queryClient.invalidateQueries({ queryKey: ["content-studio", "keys"] });
      setMessage(key ? "Schlüssel verschlüsselt auf dem Server gespeichert." : "Gespeicherten Schlüssel entfernt. Ein gesetzter Umgebungswert bleibt aktiv.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Speichern fehlgeschlagen."); }
    finally { setBusy(null); }
  };

  return <Section title="Anbieterzugänge" description="Schlüssel werden serverseitig verschlüsselt gespeichert und niemals zurückgegeben. Server-Umgebungsvariablen dienen als Fallback. Sichere den lokalen Serverschlüssel gemeinsam mit der Datenbank.">
    {query.isError && <p role="alert">Schlüsselstatus konnte nicht geladen werden.</p>}
    {providers.map(({ id, label, env, support, connected }) => <div key={id} className="st-studio-key">
      <div><strong>{label}</strong> <StatusChip tone={!connected || !query.data?.data[id] ? "muted" : "green"}>{!connected ? "Nicht angebunden" : query.data?.data[id] ? "Konfiguriert" : "Nicht konfiguriert"}</StatusChip><p>{support}</p><small>Server-Variable: <code>{env}</code></small></div>
      {!readOnly && connected && <div className="st-studio-key__input"><TextField label={`${label} API-Schlüssel`} type="password" autoComplete="off" value={draft[id] ?? ""} onChange={(event) => setDraft((current) => ({ ...current, [id]: event.target.value }))} /><Button type="button" disabled={busy !== null || !(draft[id] ?? "").trim()} onClick={() => void save(id, draft[id] ?? "")}>Speichern</Button><Button type="button" variant="ghost" disabled={busy !== null} onClick={() => void save(id, "")}>Gespeicherten Schlüssel löschen</Button></div>}
      {!readOnly && !connected && query.data?.data[id] && <Button type="button" variant="ghost" disabled={busy !== null} onClick={() => void save(id, "")}>Gespeicherten Schlüssel löschen</Button>}
    </div>)}
    {message && <p role="status">{message}</p>}
  </Section>;
}
