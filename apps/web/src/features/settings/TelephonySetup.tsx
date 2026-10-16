"use client";

import type { TelephonyCallResponse, TelephonyPreviewResponse, TelephonyStatusResponse } from "@friday/sdk";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { call } from "@/lib/api/call";
import { getApiClient } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/queryKeys";

type Mode = "trunk" | "local";

export function TelephonySetup({ owner }: { owner: boolean }) {
  const queryClient = useQueryClient();
  const status = useQuery<TelephonyStatusResponse>({ queryKey: ["settings", "telephony"], enabled: owner,
    queryFn: () => call(getApiClient().GET("/api/v1/settings/telephony")) });
  const current = status.data?.data;
  const [mode, setMode] = useState<Mode>("trunk");
  const [ariUser, setAriUser] = useState("friday");
  const [ariPassword, setAriPassword] = useState("");
  const [ariPort, setAriPort] = useState("8088");
  const [ownerEndpoint, setOwnerEndpoint] = useState("friday-owner");
  const [callerId, setCallerId] = useState("");
  const [sipHost, setSipHost] = useState("");
  const [sipUser, setSipUser] = useState("");
  const [sipPassword, setSipPassword] = useState("");
  const [destination, setDestination] = useState("");
  const [preview, setPreview] = useState<TelephonyPreviewResponse["data"] | null>(null);
  const [activeCall, setActiveCall] = useState<TelephonyCallResponse["data"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function save() {
    if (!current) return;
    setBusy(true); setMessage(""); setPreview(null);
    try {
      await call(getApiClient().PUT("/api/v1/settings/telephony", {
        params: { header: { "If-Match": String(current.revision) } },
        body: { mode, ariUser, ariPassword, ariPort: Number(ariPort), ownerEndpoint, callerId,
          ...(mode === "trunk" ? { sipHost, sipUser, sipPassword } : {}) },
      }));
      setAriPassword(""); setSipPassword("");
      await status.refetch();
      await queryClient.invalidateQueries({ queryKey: queryKeys.skills });
      setMessage("Privat in Friday-Ubuntu gespeichert. Asterisk-Konfigurationsdateien müssen noch eingebunden und der Dienst geprüft werden.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Telefonieprofil konnte nicht gespeichert werden."); }
    finally { setBusy(false); }
  }

  async function prepare() {
    setBusy(true); setMessage(""); setPreview(null);
    try {
      const result: TelephonyPreviewResponse = await call(getApiClient().POST("/api/v1/telephony/preview", { body: { destination } }));
      setPreview(result.data);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Anrufvorschau konnte nicht erstellt werden."); }
    finally { setBusy(false); }
  }

  async function dial() {
    if (!preview) return;
    setBusy(true); setMessage("");
    try {
      const result: TelephonyCallResponse = await call(getApiClient().POST("/api/v1/telephony/calls", {
        params: { header: { "Idempotency-Key": crypto.randomUUID() } },
        body: { destination: preview.destination, previewToken: preview.token },
      }));
      setActiveCall(result.data); setPreview(null);
      setMessage("Anruf bei Asterisk angefragt. Erst der beobachtete Kanalstatus bestätigt die Owner-Nebenstelle; die Zielverbindung wird derzeit nicht gesondert nachgewiesen.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Anruf konnte nicht angefragt werden."); }
    finally { setBusy(false); }
  }

  async function refreshCall() {
    if (!activeCall) return;
    setBusy(true);
    try {
      const result: TelephonyCallResponse = await call(getApiClient().GET("/api/v1/telephony/calls/{callId}",
        { params: { path: { callId: activeCall.id } } }));
      setActiveCall(result.data);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Anrufstatus nicht erreichbar."); }
    finally { setBusy(false); }
  }

  async function hangup() {
    if (!activeCall) return;
    setBusy(true);
    try {
      const result: TelephonyCallResponse = await call(getApiClient().POST("/api/v1/telephony/calls/{callId}/hangup",
        { params: { path: { callId: activeCall.id } } }));
      setActiveCall(result.data);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Auflegen nicht bestätigt."); }
    finally { setBusy(false); }
  }

  return <section aria-labelledby="telephony-setup-title">
    <h3 id="telephony-setup-title">Telefonie über Asterisk und SIP</h3>
    <p>Friday kann eine SIP-Nebenstelle des Owners zuerst anrufen und nach Abheben die bestätigte Zielnummer verbinden. Ein SIP-Anbieter ist nur für externe Nummern nötig. Für einen lokalen Test können zwei eigene SIP-Nebenstellen verwendet werden. Der Telefonanruf nutzt Asterisk-Audio; Fridays Sprachdialog ist daran noch nicht angeschlossen.</p>
    {!owner ? <p>Nur der Owner kann Telefonie einrichten.</p> : <>
      {status.isError && <p role="alert">Telefonie-Status nicht erreichbar. <button type="button" onClick={() => void status.refetch()}>Erneut prüfen</button></p>}
      {current && <>
        <p role="status">{current.configured ? "Profil gespeichert" : "Kein Profil"} · Asterisk-ARI {current.ariReachable ? "erreichbar" : "nicht erreichbar"} · SIP-Registrierung {current.registration} · Owner-Nebenstelle {current.ownerEndpoint} · Dateien {current.configurationApplied ? "angewendet" : "nicht angewendet"} · Dialplan {current.dialplanLoaded ? "geladen" : "nicht geladen"} · {current.ready ? "Rufpfad bereit" : "Rufpfad nicht bereit"}. Ein erfolgreiches Gespräch mit dem Ziel ist damit noch nicht bestätigt.</p>
        <details><summary>SIP und Asterisk einrichten</summary>
          <p>Optional Asterisk in Friday-Ubuntu installieren und einen eigenen SIP-Softphone-Endpunkt für den Owner konfigurieren. Friday legt private Konfigurationsschnipsel unter <code>~/.config/friday/telephony/</code> an. Diese in Asterisks <code>ari.conf</code>, <code>http.conf</code>, <code>pjsip.conf</code> und <code>extensions.conf</code> einbinden; danach Asterisk neu laden. Nur ARI auf 127.0.0.1 freigeben. Die SIP-Registrierung muss danach tatsächlich „registered“ melden.</p>
          <label>Modus <select value={mode} onChange={(event) => setMode(event.target.value as Mode)}><option value="trunk">SIP-Trunk für externe Nummern</option><option value="local">Lokale SIP-Nebenstellen</option></select></label>
          <label>ARI-Benutzer <input value={ariUser} onChange={(event) => setAriUser(event.target.value)} autoComplete="off" /></label>
          <label>ARI-Passwort <input type="password" value={ariPassword} onChange={(event) => setAriPassword(event.target.value)} autoComplete="new-password" /></label>
          <label>Lokaler ARI-Port <input type="number" min="1" max="65535" value={ariPort} onChange={(event) => setAriPort(event.target.value)} /></label>
          <label>Owner-SIP-Nebenstelle <input value={ownerEndpoint} onChange={(event) => setOwnerEndpoint(event.target.value)} /></label>
          <label>Angezeigte Rufnummer {mode === "trunk" ? "(+ mit Ländervorwahl)" : "(lokale Nebenstelle)"}<input value={callerId} onChange={(event) => setCallerId(event.target.value)} /></label>
          {mode === "trunk" && <>
            <label>SIP-Server <input value={sipHost} onChange={(event) => setSipHost(event.target.value)} /></label>
            <label>SIP-Benutzername <input value={sipUser} onChange={(event) => setSipUser(event.target.value)} /></label>
            <label>SIP-Passwort <input type="password" value={sipPassword} onChange={(event) => setSipPassword(event.target.value)} autoComplete="new-password" /></label>
          </>}
          <button type="button" disabled={busy} onClick={() => void save()}>Telefonieprofil privat speichern</button>
        </details>
        <button type="button" disabled={busy} onClick={() => void status.refetch()}>Adapterstatus erneut prüfen</button>
        {current.ready && <div>
          <label>Zielnummer {current.mode === "trunk" ? "(E.164, z. B. +491701234567)" : "(lokale Nebenstelle)"}<input value={destination} onChange={(event) => { setDestination(event.target.value); setPreview(null); }} /></label>
          <button type="button" disabled={busy || !destination} onClick={() => void prepare()}>Anrufvorschau erstellen</button>
          {preview && <div role="group" aria-label="Anruf bestätigen">
            <p>Owner-Nebenstelle wird zuerst angerufen. Danach verbindet Asterisk von <strong>{preview.callerId}</strong> zu <strong>{preview.destination}</strong>. Bei externen Nummern können Gebühren entstehen. Vorschau gültig bis {new Date(preview.expiresAt).toLocaleTimeString()}.</p>
            <button type="button" disabled={busy} onClick={() => void dial()}>Diesen Anruf jetzt auslösen</button>
            <button type="button" onClick={() => setPreview(null)}>Abbrechen</button>
          </div>}
        </div>}
        {activeCall && <div role="status"><p>Anruf {activeCall.id}: {activeCall.state}. „owner_answered“ bestätigt nur die Owner-Nebenstelle, nicht die Verbindung zur Zielnummer.</p>
          <button type="button" disabled={busy} onClick={() => void refreshCall()}>Anrufstatus prüfen</button>
          <button type="button" disabled={busy || activeCall.state === "ended"} onClick={() => void hangup()}>Auflegen</button></div>}
      </>}
      {message && <p role="status">{message}</p>}
    </>}
  </section>;
}
