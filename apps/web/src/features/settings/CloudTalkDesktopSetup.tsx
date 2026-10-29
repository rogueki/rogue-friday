"use client";

import type { CloudTalkCallResponse, CloudTalkPreviewResponse, CloudTalkStatusResponse } from "@friday/sdk";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { call } from "@/lib/api/call";
import { getApiClient } from "@/lib/api/client";

const CALL_STATE_LABELS: Record<string, string> = { pending: "wird angefragt", requested: "von CloudTalk angenommen",
  rejected: "von CloudTalk abgewiesen", unknown: "Ausgang unklar" };

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
  const [previewKey, setPreviewKey] = useState("");
  const [reconciled, setReconciled] = useState(false);
  const [result, setResult] = useState<CloudTalkCallResponse["data"] | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const loadedRevision = useRef<number | null>(null);

  useEffect(() => {
    const saved = status.data?.data;
    if (!saved || loadedRevision.current === saved.revision) return;
    loadedRevision.current = saved.revision;
    setAgentId(saved.agentId === null ? "" : String(saved.agentId));
    setOwnerPhone(saved.ownerPhone ?? "");
    setOwnerPhoneConfirmed(saved.ownerPhoneConfirmed);
    setVoiceAgentId(saved.voiceAgentId ?? "");
    setReminderMinutes(String(saved.reminderMinutes));
    setRemindersEnabled(saved.remindersEnabled);
  }, [status.data]);

  async function save() {
    if (!status.data) return;
    setBusy(true); setMessage(""); setPreview(null);
    try {
      await call(getApiClient().PUT("/api/v1/settings/cloudtalk", {
        params: { header: { "If-Match": String(status.data.data.revision) } },
        body: { ...(agentId ? { agentId: Number(agentId) } : {}),
          ...(accessKeyId.trim() && accessKeySecret.trim() ? { accessKeyId, accessKeySecret } : {}),
          ownerPhone, ownerPhoneConfirmed, voiceAgentId,
          reminderMinutes: Number(reminderMinutes), remindersEnabled },
      }));
      const rotated = Boolean(accessKeyId.trim() && accessKeySecret.trim());
      setAccessKeyId(""); setAccessKeySecret("");
      await status.refetch();
      setMessage(rotated ? "CloudTalk hat den API-Schlüssel bestätigt; er ist verschlüsselt gespeichert. Agentenstatus und Rufnummer sind damit nicht geprüft." : "CloudTalk-Einstellungen gespeichert.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "CloudTalk-Konfiguration konnte nicht gespeichert werden."); }
    finally { setBusy(false); }
  }

  async function disconnect() {
    if (!status.data) return;
    if (!window.confirm("CloudTalk-Zugang wirklich trennen? Die gespeicherten API-Schlüssel werden gelöscht, automatische Terminanrufe enden und offene Rufvorschauen verfallen. Bereits angefragte Anrufe laufen bei CloudTalk weiter.")) return;
    setBusy(true); setMessage(""); setPreview(null);
    try {
      await call(getApiClient().DELETE("/api/v1/settings/cloudtalk", {
        params: { header: { "If-Match": String(status.data.data.revision) } } }));
      await status.refetch();
      setMessage("CloudTalk getrennt. Die API-Schlüssel sind gelöscht.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "CloudTalk konnte nicht getrennt werden."); }
    finally { setBusy(false); }
  }

  async function prepare() {
    setBusy(true); setMessage(""); setPreview(null); setResult(null);
    try {
      const response: CloudTalkPreviewResponse = await call(getApiClient().POST("/api/v1/telephony/cloudtalk/preview", { body: { destination } }));
      setPreview(response.data);
      setPreviewKey(crypto.randomUUID()); setReconciled(false);
    } catch (error) { setMessage(error instanceof Error ? error.message : "CloudTalk-Vorschau konnte nicht erstellt werden."); }
    finally { setBusy(false); }
  }

  async function dial() {
    if (!preview) return;
    setBusy(true); setMessage("");
    try {
      const response: CloudTalkCallResponse = await call(getApiClient().POST("/api/v1/telephony/cloudtalk/calls", {
        params: { header: { "Idempotency-Key": previewKey } },
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

  const unresolved = result?.state === "unknown" && !reconciled;

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
      {status.data?.data.lastReminderState && <p>Letzte Erinnerung: {CALL_STATE_LABELS[status.data.data.lastReminderState] ?? status.data.data.lastReminderState}{status.data.data.lastReminderAt ? ` am ${new Date(status.data.data.lastReminderAt).toLocaleString("de-DE")}` : ""}. „Von CloudTalk angenommen“ heißt nur, dass CloudTalk die Anfrage angenommen hat.</p>}
      <details><summary>CloudTalk-Verbindung und Erinnerungsanrufe einstellen</summary>
        <p>Admin: CloudTalk → Account → Settings → API Keys. Gib bei der ersten Einrichtung beide Schlüssel ein. Bei späteren Änderungen bleiben die verschlüsselt gespeicherten Schlüssel erhalten, wenn beide Felder leer bleiben. Für einen Schlüsselwechsel müssen wieder beide eingetragen werden.</p>
        <label>Agent-ID (nur für klassische API-Rufe) <input type="number" min="1" step="1" value={agentId} onChange={(event) => setAgentId(event.target.value)} /></label>
        <label>Access Key ID <input autoComplete="off" value={accessKeyId} onChange={(event) => setAccessKeyId(event.target.value)} /></label>
        <label>Access Key Secret <input type="password" autoComplete="new-password" value={accessKeySecret} onChange={(event) => setAccessKeySecret(event.target.value)} /></label>
        <label>Deine Rufnummer (E.164) <input type="tel" autoComplete="tel" value={ownerPhone} onChange={(event) => { setOwnerPhone(event.target.value); setOwnerPhoneConfirmed(false); }} placeholder="+491701234567" /></label>
        <label><input type="checkbox" checked={ownerPhoneConfirmed} onChange={(event) => setOwnerPhoneConfirmed(event.target.checked)} /> Ich bestätige, dass diese Rufnummer mir gehört und dort Erinnerungsanrufe ankommen dürfen.</label>
        <label>VoiceAgent-ID <input value={voiceAgentId} onChange={(event) => setVoiceAgentId(event.target.value)} /></label>
        <label>Minuten vor dem Termin <input type="number" min="1" max="120" value={reminderMinutes} onChange={(event) => setReminderMinutes(event.target.value)} /></label>
        <label><input type="checkbox" checked={remindersEnabled} onChange={(event) => setRemindersEnabled(event.target.checked)} /> Automatische Anrufe für lokale Owner-Termine einschalten</label>
        <button type="button" disabled={busy || !status.data || (!status.data.data.configured && (!accessKeyId.trim() || !accessKeySecret.trim())) ||
          Boolean(accessKeyId.trim()) !== Boolean(accessKeySecret.trim()) ||
          (remindersEnabled && (!/^\+[1-9]\d{7,14}$/.test(ownerPhone) || !voiceAgentId || !ownerPhoneConfirmed))} onClick={() => void save()}>CloudTalk-Zugang speichern</button>
        {status.data?.data.configured && <>{" "}<button type="button" disabled={busy} onClick={() => void disconnect()}>CloudTalk trennen</button></>}
      </details>
      {status.data?.data.configured && status.data.data.agentId && <>
        <label>Zielnummer (E.164, z. B. +491701234567) <input type="tel" autoComplete="off" disabled={unresolved} value={destination} onChange={(event) => { setDestination(event.target.value); setPreview(null); }} /></label>
        <button type="button" disabled={busy || unresolved || !/^\+[1-9]\d{7,14}$/.test(destination)} onClick={() => void prepare()}>Rufvorschau erstellen</button>
        {preview && <div role="group" aria-label="CloudTalk-Ruf bestätigen">
          <p>CloudTalk-Agent {preview.agentId}, Ziel <strong>{preview.destination}</strong>. Zuerst klingelt der Agent; nach seinem Abheben wird das Ziel gewählt. Es können Kosten entstehen. Vorschau gültig bis {new Date(preview.expiresAt).toLocaleTimeString()}.</p>
          <button type="button" disabled={busy} onClick={() => void dial()}>Diesen CloudTalk-Ruf anfragen</button>{" "}
          <button type="button" onClick={() => setPreview(null)}>Abbrechen</button>
        </div>}
      </>}
      {result && <p role="status">Anfrage {result.id}: {CALL_STATE_LABELS[result.state] ?? result.state}. Ein Zielgespräch ist damit nicht bestätigt.</p>}
      {result?.state === "unknown" && <label><input type="checkbox" checked={reconciled} onChange={(event) => setReconciled(event.target.checked)} /> Ich habe im CloudTalk-Dashboard geprüft, ob dieser Ruf stattgefunden hat.</label>}
      {message && <p role="status">{message}</p>}
    </> : <p>Nur der Owner kann den CloudTalk-Zugang einrichten oder einen Ruf bestätigen.</p>}
  </section>;
}
