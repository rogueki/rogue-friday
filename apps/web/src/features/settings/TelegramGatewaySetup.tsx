"use client";

import type { TelegramGatewayResponse } from "@friday/sdk";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { call } from "@/lib/api/call";
import { getApiClient } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/queryKeys";

const BOT_AUTH_LABELS: Record<string, string> = { verified: "bestätigt", invalid: "von Telegram abgelehnt", missing: "kein Token", unknown: "nicht prüfbar" };
const RECEIVE_MODE_LABELS: Record<string, string> = { polling: "Polling", webhook: "Webhook", unknown: "unbekannt" };

export function TelegramGatewaySetup({ owner }: { owner: boolean }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const [ids, setIds] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [clearToken, setClearToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const status = useQuery({
    queryKey: ["settings", "telegram-gateway"],
    queryFn: (): Promise<TelegramGatewayResponse> => call(getApiClient().GET("/api/v1/settings/telegram-gateway")),
    enabled: owner,
  });
  const current = status.data?.data;
  useEffect(() => {
    if (current) { setIds(current.allowedUserIds.join(", ")); setEnabled(current.enabled === true); }
  }, [current]);

  async function save() {
    if (!current) return;
    setBusy(true);
    setMessage("");
    try {
      const response: TelegramGatewayResponse = await call(getApiClient().PUT("/api/v1/settings/telegram-gateway", {
        params: { header: { "If-Match": String(current.revision) } },
        body: { token, clearToken, allowedUserIds: ids.split(",").map((id) => id.trim()).filter(Boolean), enabled },
      }));
      setToken("");
      setClearToken(false);
      await status.refetch();
      await queryClient.invalidateQueries({ queryKey: queryKeys.skills });
      setMessage(response.data.applied === true
        ? response.data.botAuthentication === "verified"
          ? `Gespeichert, Bot @${response.data.botUsername ?? response.data.botId} von Telegram bestätigt und Hermes-Gateway neu gestartet.`
          : "Gespeichert und Hermes-Gateway neu gestartet."
        : response.data.applied === false ? "Gespeichert, Gateway-Neustart nicht bestätigt. Dienst prüfen."
        : "Konfiguration unverändert.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Telegram-Konfiguration konnte nicht gespeichert werden.");
    } finally { setBusy(false); }
  }

  return <section aria-labelledby="telegram-gateway-setup-title">
    <h3 id="telegram-gateway-setup-title">Telegram-Bot für Hermes</h3>
    <ol>
      <li>In Telegram den Chat mit @BotFather öffnen, <code>/newbot</code> senden und Namen sowie Benutzernamen (endet auf „bot“) wählen.</li>
      <li>Das angezeigte Token unten einfügen. Friday prüft es vor dem Speichern bei Telegram; ein abgelehntes Token ersetzt das bisherige nicht.</li>
      <li>Deine numerische Telegram-User-ID ermitteln (z. B. mit einem ID-Bot wie @userinfobot) und unten eintragen. Nur eingetragene IDs dürfen Friday schreiben.</li>
    </ol>
    <p>Das Bot-Token bleibt im lokalen Hermes-Profil. Ob die User-ID stimmt, zeigt sich erst bei deiner ersten Nachricht an den Bot.</p>
    {!owner ? <p>Nur der Owner kann den Telegram-Bot einrichten.</p> : <>
      {status.isPending && <p role="status">Telegram-Konfiguration wird gelesen.</p>}
      {status.isError && <p role="alert">Telegram-Status nicht erreichbar. <button type="button" onClick={() => void status.refetch()}>Erneut prüfen</button></p>}
      {current && <>
        <p role="status">{current.tokenConfigured ? "Bot-Token hinterlegt" : "Kein Bot-Token hinterlegt"} · {current.enabled ? "Gateway aktiviert" : current.enabled === false ? "Gateway deaktiviert" : "Aktivierung unbekannt"} · {current.gatewayRunning ? "Gateway-Dienst läuft" : "Gateway-Dienst nicht bestätigt"} · Laufzeitverbindung: {current.connectionState}.</p>
        <p role="status">Bot-Authentisierung: {current.botAuthentication === "verified" ? `bestätigt (@${current.botUsername ?? current.botId})` : BOT_AUTH_LABELS[current.botAuthentication] ?? current.botAuthentication} · Empfangsmodus: {RECEIVE_MODE_LABELS[current.receiveMode] ?? current.receiveMode}.
          {current.receiveMode === "webhook" ? " Ein vorhandener Webhook muss vor Hermes-Polling entfernt werden." : ""}</p>
        <label>Bot-Token <input type="password" autoComplete="off" value={token} disabled={clearToken || busy} onChange={(event) => setToken(event.target.value)} placeholder="Neues BotFather-Token" /></label>
        <label>Erlaubte numerische User-IDs <input type="text" value={ids} onChange={(event) => setIds(event.target.value)} placeholder={current.allowedUserIds.join(", ") || "123456789"} /></label>
        <label><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> Telegram aktivieren</label>
        <label><input type="checkbox" checked={clearToken} onChange={(event) => setClearToken(event.target.checked)} /> Gespeichertes Bot-Token entfernen</label>
        <button type="button" disabled={busy} onClick={() => void save()}>Telegram-Konfiguration speichern</button>
      </>}
      {message && <p role="status">{message}</p>}
    </>}
  </section>;
}
