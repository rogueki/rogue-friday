"use client";

import type { CloudTalkCallResponse, CloudTalkPreviewResponse, CloudTalkStatusResponse } from "@friday/sdk";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { call } from "@/lib/api/call";
import { getApiClient } from "@/lib/api/client";

export function CloudTalkDesktopSetup({ owner }: { owner: boolean }) {
  const status = useQuery<CloudTalkStatusResponse>({ queryKey: ["settings", "cloudtalk"], enabled: owner,
    queryFn: () => call(getApiClient().GET("/api/v1/settings/cloudtalk")) });
  const [agentId, setAgentId] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [accessKeySecret, setAccessKeySecret] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
  const [ownerPhoneConfirmed, setOwnerPhoneConfirmed] = useState(false);
  const [voiceAgentId, setVoiceAgentId] = useState("");
  const [reminderMinutes, setReminderMinutes] = useState("15");
  const [remindersEnabled, setRemindersEnabled] = useState(false);
  const [destination, setDestination] = useState("");
  const [preview, setPreview] = useState<CloudTalkPreviewResponse["data"] | null>(null);
  const [result, setResult] = useState<CloudTalkCallResponse["data"] | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!status.data) return;
    setBusy(true); setMessage(""); setPreview(null);
    try {
      await call(getApiClient().PUT("/api/v1/settings/cloudtalk", {
        params: { header: { "If-Match": String(status.data.data.revision) } },
        body: { ...(agentId ? { agentId: Number(agentId) } : {}), accessKeyId, accessKeySecret,
          ...(ownerPhone ? { ownerPhone } : {}), ownerPhoneConfirmed, ...(voiceAgentId ? { voiceAgentId } : {}),
          reminderMinutes: Number(reminderMinutes), remindersEnabled },
      }));
      setAccessKeyId(""); setAccessKeySecret("");
      await status.refetch();
      setMessage("CloudTalk-Zugang verschlüsselt gespeichert. API-Berechtigung und Agentenstatus sind noch nicht geprüft.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "CloudTalk-Konfiguration konnte nicht gespeichert werden."); }
    finally { setBusy(false); }
  }

  async function prepare() {
    setBusy(true); setMessage(""); setPreview(null); setResult(null);
    try {
      const response: CloudTalkPreviewResponse = await call(getApiClient().POST("/api/v1/telephony/cloudtalk/preview", { body: { destination } }));
      setPreview(response.data);
    } catch (error) { setMessage(error instanceof Error ? error.message : "CloudTalk-Vorschau konnte nicht erstellt werden."); }
    finally { setBusy(false); }
  }

  async function dial() {
    if (!preview) return;
    setBusy(true); setMessage("");
    try {
      const response: CloudTalkCallResponse = await call(getApiClient().POST("/api/v1/telephony/cloudtalk/calls", {
        params: { header: { "Idempotency-Key": crypto.randomUUID() } },
        body: { destination: preview.destination, previewToken: preview.token },
      }));
      setResult(response.data); setPreview(null);
      setMessage(response.data.state === "requested"
        ? "CloudTalk hat die Anfrage angenommen. Der Agent muss binnen 20 Sekunden abheben; danach wird erst das Ziel gewählt. Eine Verbindung ist nicht bestätigt."
        : response.data.state === "rejected"
          ? "CloudTalk hat die Anfrage abgewiesen. Prüfe API-Berechtigung und Agentenstatus."
          : "Ausgang unklar. Nicht erneut auslösen, bevor der Ruf im CloudTalk-Dashboard abgeglichen wurde.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "CloudTalk-Anfrage konnte nicht sicher bestätigt werden."); }
    finally { setBusy(false); }
  }

  return <section aria-labelledby="cloudtalk-setup-title">
    <h3 id="cloudtalk-setup-title">CloudTalk Desktop und API</h3>
    <p><strong>Desktop-Sprachruf:</strong> Installiere die CloudTalk-Windows-App, melde dich an, stelle den Agenten auf Online und prüfe die zugewiesene Rufnummer. Aktiviere in CloudTalk Phone unter <strong>Settings → Calls → Call Automation</strong> die Option <strong>Automatically dial Click-to-call numbers</strong>. Sage dann „Rufe +491701234567 über CloudTalk an“. Friday liest die normalisierte Nummer vollständig vor. Erst ein zweites, sprechergeprüftes „Ja“ öffnet den <code>ct+tel:</code>-Link. Bei aktivierter Auto-Dial-Option wählt CloudTalk ohne weiteren Klick. „Nein“, Stopp, Unterbrechung oder Ablauf verwirft den Auftrag.</p>
    <p>Dieser Desktop-Weg wurde im lokalen Testprofil mit einer Mailbox bestätigt. Friday bekommt über den Link keinen Gesprächsstatus, kein Anruf-Audio und keine Auflegen-Funktion. Ob Auto-Dial auf anderen Installationen aktiv ist, muss dort jeweils in CloudTalk geprüft werden.</p>
    <h4>Friday erinnert dich per VoiceAgent-Anruf</h4>
    <p>Nach deiner Aktivierung ruft Friday deine Owner-Nummer vor einem Termin im lokalen Friday-Kalender selbstständig an. Der CloudTalk VoiceAgent nennt den Termin und kann im Gespräch zuhören und antworten. Richte dafür den deutschen Friday-Prompt mit 15 Sekunden Zuhören im VoiceAgent ein. Die API-Annahme bestätigt weder Klingeln noch ein angenommenes Gespräch; es können Kosten entstehen.</p>
    <p>Standardmäßig aus. Ruhezeit 20–8 Uhr in der Termin-Zeitzone, höchstens fünf Erinnerungsversuche pro Stunde. Nach Terminänderungen gilt eine neue Version; unklare Anrufergebnisse werden nicht blind wiederholt.</p>
    <h4>Alternative: CloudTalk-API</h4>
    <p>Friday kann über die CloudTalk-API einen Ruf anfragen. CloudTalk ruft zuerst den ausgewählten Agenten an; er muss binnen 20 Sekunden abheben. Erst danach wird die Zielnummer gewählt. Für ein Gespräch ohne Agentenabnahme ist dieser API-Weg nicht geeignet.</p>
    <p>Für diesen API-Weg reicht ein CloudTalk-Desktop-Login nicht. Ein Admin benötigt API-Zugriff ab Essential, eine Access Key ID, ein Access Key Secret und die Agent-ID; der Agent muss online sein und eine Rufnummer zugewiesen haben. Im aktuellen CloudTalk-Konto meldete die Schlüsselerstellung <code>API_STATUS_IS_NOT_ENABLED</code>. Ohne Freischaltung kann Friday keinen CloudTalk-API-Ruf auslösen; der Desktop-Weg bleibt davon unabhängig.</p>
    {owner ? <>
      {status.isError && <p role="alert">CloudTalk-Status nicht erreichbar. <button type="button" onClick={() => void status.refetch()}>Erneut prüfen</button></p>}
      {status.data && <p role="status">{status.data.data.configured ? "API-Zugang gespeichert" : "Kein API-Zugang gespeichert"} · Agent-ID {status.data.data.agentId ?? "unbekannt"}. Gespeicherte Werte belegen weder API-Freischaltung noch einen möglichen Anruf.</p>}
      {status.data && <p>Erinnerungsanrufe: {status.data.data.remindersEnabled ? "aktiv" : "aus"}. Owner-Nummer {status.data.data.ownerPhone ?? "nicht hinterlegt"}, VoiceAgent-ID {status.data.data.voiceAgentId ?? "nicht hinterlegt"}, Vorlauf {status.data.data.reminderMinutes} Minuten.</p>}
      {status.data?.data.lastReminderState && <p>Letzte Anfrage: {status.data.data.lastReminderState} am {status.data.data.lastReminderAt}. „requested“ bedeutet nur, dass CloudTalk die Anfrage angenommen hat.</p>}
      <details><summary>API-Zugang einrichten oder ersetzen</summary>
        <p>Admin: CloudTalk → Account → Settings → API Keys. Erstelle ein eigenes Friday-Schlüsselpaar. Die Schlüssel werden hier verschlüsselt gespeichert und danach nicht mehr angezeigt.</p>
        <label>Agent-ID (nur für klassische API-Rufe) <input type="number" min="1" step="1" value={agentId} onChange={(event) => setAgentId(event.target.value)} /></label>
        <label>Access Key ID <input autoComplete="off" value={accessKeyId} onChange={(event) => setAccessKeyId(event.target.value)} /></label>
        <label>Access Key Secret <input type="password" autoComplete="new-password" value={accessKeySecret} onChange={(event) => setAccessKeySecret(event.target.value)} /></label>
        <label>Deine Rufnummer (E.164) <input type="tel" autoComplete="tel" value={ownerPhone} onChange={(event) => setOwnerPhone(event.target.value)} placeholder="+491701234567" /></label>
        <label><input type="checkbox" checked={ownerPhoneConfirmed} onChange={(event) => setOwnerPhoneConfirmed(event.target.checked)} /> Ich bestätige, dass diese Rufnummer mir gehört und dort Erinnerungsanrufe ankommen dürfen.</label>
        <label>VoiceAgent-ID <input value={voiceAgentId} onChange={(event) => setVoiceAgentId(event.target.value)} /></label>
        <label>Minuten vor dem Termin <input type="number" min="1" max="120" value={reminderMinutes} onChange={(event) => setReminderMinutes(event.target.value)} /></label>
        <label><input type="checkbox" checked={remindersEnabled} onChange={(event) => setRemindersEnabled(event.target.checked)} /> Automatische Anrufe für lokale Owner-Termine einschalten</label>
        <button type="button" disabled={busy || !status.data || !accessKeyId || !accessKeySecret ||
          (remindersEnabled && (!/^\+[1-9]\d{7,14}$/.test(ownerPhone) || !voiceAgentId || !ownerPhoneConfirmed))} onClick={() => void save()}>CloudTalk-Zugang speichern</button>
      </details>
      {status.data?.data.configured && status.data.data.agentId && <>
        <label>Zielnummer (E.164, z. B. +491701234567) <input type="tel" autoComplete="off" value={destination} onChange={(event) => { setDestination(event.target.value); setPreview(null); }} /></label>
        <button type="button" disabled={busy || !/^\+[1-9]\d{7,14}$/.test(destination)} onClick={() => void prepare()}>Rufvorschau erstellen</button>
        {preview && <div role="group" aria-label="CloudTalk-Ruf bestätigen">
          <p>CloudTalk-Agent {preview.agentId}, Ziel <strong>{preview.destination}</strong>. Zuerst klingelt der Agent; nach seinem Abheben wird das Ziel gewählt. Es können Kosten entstehen. Vorschau gültig bis {new Date(preview.expiresAt).toLocaleTimeString()}.</p>
          <button type="button" disabled={busy} onClick={() => void dial()}>Diesen CloudTalk-Ruf anfragen</button>{" "}
          <button type="button" onClick={() => setPreview(null)}>Abbrechen</button>
        </div>}
      </>}
      {result && <p role="status">Anfrage {result.id}: {result.state}. Ein Zielgespräch ist damit nicht bestätigt.</p>}
      {message && <p role="status">{message}</p>}
    </> : <p>Nur der Owner kann den CloudTalk-Zugang einrichten oder einen Ruf bestätigen.</p>}
  </section>;
}
