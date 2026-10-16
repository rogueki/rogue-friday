"use client";

import type { DiscordGatewayResponse, WhatsappGatewayResponse } from "@friday/sdk";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { call } from "@/lib/api/call";
import { getApiClient } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/queryKeys";

type Platform = "discord" | "whatsapp";

export function MessagingGatewaySetup({ owner, platform }: { owner: boolean; platform: Platform }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const [clearToken, setClearToken] = useState(false);
  const [ids, setIds] = useState("");
  const [channels, setChannels] = useState("");
  const [mode, setMode] = useState<"bot" | "self-chat">("bot");
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const name = platform === "discord" ? "Discord" : "WhatsApp";
  const status = useQuery<DiscordGatewayResponse | WhatsappGatewayResponse>({ queryKey: ["settings", `${platform}-gateway`], enabled: owner,
    queryFn: () => platform === "discord"
      ? call(getApiClient().GET("/api/v1/settings/discord-gateway"))
      : call(getApiClient().GET("/api/v1/settings/whatsapp-gateway")),
  });
  const current = status.data?.data as DiscordGatewayResponse["data"] | WhatsappGatewayResponse["data"] | undefined;
  useEffect(() => {
    if (!current) return;
    setIds(current.allowedUserIds.join(", "));
    setEnabled(current.enabled === true);
    if ("allowedChannelIds" in current) setChannels(current.allowedChannelIds.join(", "));
    if ("mode" in current && current.mode) setMode(current.mode);
  }, [current]);

  async function save() {
    if (!current) return;
    setBusy(true);
    setMessage("");
    const allowedUserIds = ids.split(",").map((item) => item.trim()).filter(Boolean);
    try {
      const result = platform === "discord"
        ? await call(getApiClient().PUT("/api/v1/settings/discord-gateway", {
          params: { header: { "If-Match": String(current.revision) } },
          body: { token, clearToken, allowedUserIds,
            allowedChannelIds: channels.split(",").map((item) => item.trim()).filter(Boolean), enabled },
        }))
        : await call(getApiClient().PUT("/api/v1/settings/whatsapp-gateway", {
          params: { header: { "If-Match": String(current.revision) } }, body: { mode, allowedUserIds, enabled },
        }));
      setToken("");
      setClearToken(false);
      await status.refetch();
      await queryClient.invalidateQueries({ queryKey: queryKeys.skills });
      setMessage(result.data.applied === false ? "Gespeichert, Gateway-Neustart nicht bestätigt. Dienst prüfen."
        : "Lokal gespeichert. Die Verbindung und autorisierte Nachrichten sind noch nicht geprüft.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `${name}-Konfiguration konnte nicht gespeichert werden.`);
    } finally { setBusy(false); }
  }

  return <section aria-labelledby={`${platform}-gateway-setup-title`}>
    <h3 id={`${platform}-gateway-setup-title`}>{name}-Gateway für Hermes</h3>
    {platform === "discord" ? <p>Erstelle im Discord Developer Portal einen Bot, aktiviere Message Content Intent und lade ihn mit den benötigten Rechten auf deinen Server ein. Trage seine Bot-Token und deine numerische User-ID ein; optional auf numerische Kanal-IDs begrenzen. Speichern bestätigt noch keine Bot-Verbindung.</p>
      : <p>Hermes koppelt WhatsApp per QR-Code. Öffne das lokale Hermes-Dashboard, melde dich dort an, gehe zu Channels → WhatsApp und scanne den QR-Code mit deinem Telefon. Danach hier deine eigene Telefonnummer als erlaubte ID und den Modus eintragen. Eine Session-Datei bestätigt allein keine aktive Verbindung.</p>}
    {!owner ? <p>Nur der Owner kann {name} einrichten.</p> : <>
      {status.isPending && <p role="status">{name}-Konfiguration wird gelesen.</p>}
      {status.isError && <p role="alert">{name}-Status nicht erreichbar. <button type="button" onClick={() => void status.refetch()}>Erneut prüfen</button></p>}
      {current && <>
        <p role="status">{platform === "discord"
          ? ((current as DiscordGatewayResponse["data"]).tokenConfigured ? "Bot-Token hinterlegt" : "Kein Bot-Token hinterlegt")
          : ((current as WhatsappGatewayResponse["data"]).sessionPresent ? "Kopplungsdatei vorhanden" : "Noch keine Kopplungsdatei")}
          {` · ${current.enabled === true ? "Gateway aktiviert" : current.enabled === false ? "Gateway deaktiviert" : "Aktivierung unbekannt"} · ${current.gatewayRunning ? "Gateway-Dienst läuft" : "Gateway-Dienst nicht bestätigt"}. Verbindung und berechtigte Zustellung nicht geprüft.`}</p>
        {platform === "discord" ? <>
          <label>Discord-Bot-Token <input type="password" autoComplete="off" value={token} disabled={clearToken || busy} onChange={(event) => setToken(event.target.value)} /></label>
          <label>Erlaubte Discord-User-IDs <input type="text" value={ids} onChange={(event) => setIds(event.target.value)} placeholder="123456789012345678" /></label>
          <label>Erlaubte Kanal-IDs (optional) <input type="text" value={channels} onChange={(event) => setChannels(event.target.value)} /></label>
          <label><input type="checkbox" checked={clearToken} onChange={(event) => setClearToken(event.target.checked)} /> Gespeichertes Bot-Token entfernen</label>
        </> : <>
          <p><a href={current.setupUrl} target="_blank" rel="noopener noreferrer">Kopplung im lokalen Hermes-Dashboard abschließen</a> (Anmeldung bei Hermes erforderlich).</p>
          <label>WhatsApp-Modus <select value={mode} onChange={(event) => setMode(event.target.value as "bot" | "self-chat")}><option value="bot">Bot</option><option value="self-chat">Eigener Chat</option></select></label>
          <label>Erlaubte Telefonnummern (Ländervorwahl, ohne +) <input type="text" value={ids} onChange={(event) => setIds(event.target.value)} placeholder="491701234567" /></label>
          <button type="button" onClick={() => void status.refetch()}>Kopplungsstatus erneut prüfen</button>
        </>}
        <label><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> {name} aktivieren</label>
        <button type="button" disabled={busy} onClick={() => void save()}>{name}-Konfiguration speichern</button>
      </>}
      {message && <p role="status">{message}</p>}
    </>}
  </section>;
}
