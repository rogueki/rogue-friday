"use client";

import type { DiscordGatewayResponse, WhatsappGatewayResponse, WhatsappPairingResponse } from "@friday/sdk";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { call } from "@/lib/api/call";
import { getApiClient } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/queryKeys";
import QRCode from "qrcode";

type Platform = "discord" | "whatsapp";

const CONNECTION_LABELS: Record<string, string> = { connected: "verbunden", disconnected: "getrennt", unknown: "unbekannt" };
const PAIRING_LABELS: Record<string, string> = { idle: "keine laufende Kopplung", starting: "wird gestartet", waiting: "wartet auf QR-Scan",
  qr_expired: "QR-Code abgelaufen", connected: "gekoppelt", unverified: "nicht bestätigt", expired: "abgelaufen",
  cancelled: "abgebrochen", error: "fehlgeschlagen" };

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
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const name = platform === "discord" ? "Discord" : "WhatsApp";
  const status = useQuery<DiscordGatewayResponse | WhatsappGatewayResponse>({ queryKey: ["settings", `${platform}-gateway`], enabled: owner,
    queryFn: () => platform === "discord"
      ? call(getApiClient().GET("/api/v1/settings/discord-gateway"))
      : call(getApiClient().GET("/api/v1/settings/whatsapp-gateway")),
  });
  const current = status.data?.data as DiscordGatewayResponse["data"] | WhatsappGatewayResponse["data"] | undefined;
  const pairing = useQuery<WhatsappPairingResponse>({
    queryKey: ["settings", "whatsapp-pairing"], enabled: owner && platform === "whatsapp",
    queryFn: () => call(getApiClient().GET("/api/v1/settings/whatsapp-pairing")),
    refetchInterval: (query) => ["starting", "waiting"].includes(query.state.data?.data.state ?? "") ? 2000 : false,
    gcTime: 0, staleTime: 0,
  });
  useEffect(() => {
    let live = true;
    const qr = pairing.data?.data.qr;
    if (!qr) { setQrImage(null); return; }
    void QRCode.toDataURL(qr, { errorCorrectionLevel: "M", margin: 2, width: 320 })
      .then((image) => { if (live) setQrImage(image); })
      .catch(() => { if (live) setQrImage(null); });
    return () => { live = false; };
  }, [pairing.data?.data.qr]);
  const flowRunning = ["starting", "waiting", "qr_expired"].includes(pairing.data?.data.state ?? "");
  useEffect(() => {
    if (!flowRunning) return;
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [flowRunning]);
  const expiresAt = pairing.data?.data.expiresAt ?? null;
  // expiresAt is Unix time in seconds (contract); the countdown never goes below zero.
  const remainingSeconds = flowRunning && expiresAt !== null ? Math.max(0, Math.floor(expiresAt - nowMs / 1000)) : null;
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

  async function changePairing(action: "start" | "cancel" | "logout" | "reconnect") {
    setBusy(true); setMessage("");
    try {
      if (action === "start") await call(getApiClient().POST("/api/v1/settings/whatsapp-pairing", { body: { mode } }));
      else if (action === "cancel") await call(getApiClient().DELETE("/api/v1/settings/whatsapp-pairing"));
      else if (action === "logout") await call(getApiClient().DELETE("/api/v1/settings/whatsapp-session"));
      else await call(getApiClient().POST("/api/v1/settings/whatsapp-session/reconnect"));
      await pairing.refetch();
      await status.refetch();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "WhatsApp-Kopplung ist nicht erreichbar.");
    } finally { setBusy(false); }
  }

  return <section aria-labelledby={`${platform}-gateway-setup-title`}>
    <h3 id={`${platform}-gateway-setup-title`}>{name}-Gateway für Hermes</h3>
    {platform === "discord" ? <p>Erstelle im Discord Developer Portal einen Bot, aktiviere Message Content Intent und lade ihn mit den benötigten Rechten auf deinen Server ein. Trage seine Bot-Token und deine numerische User-ID ein; optional auf numerische Kanal-IDs begrenzen. Ein neues Token prüft Friday vor dem Speichern bei Discord; ein abgelehntes ersetzt das bisherige nicht.</p>
      : <p>Scanne den QR-Code hier mit WhatsApp unter Einstellungen → Verknüpfte Geräte. Die Kopplung läuft lokal über den Hermes-Connector.</p>}
    {!owner ? <p>Nur der Owner kann {name} einrichten.</p> : <>
      {status.isPending && <p role="status">{name}-Konfiguration wird gelesen.</p>}
      {status.isError && <p role="alert">{name}-Status nicht erreichbar. <button type="button" onClick={() => void status.refetch()}>Erneut prüfen</button></p>}
      {current && <>
        <p role="status">{platform === "discord"
          ? ((current as DiscordGatewayResponse["data"]).tokenConfigured ? "Bot-Token hinterlegt" : "Kein Bot-Token hinterlegt")
          : ((current as WhatsappGatewayResponse["data"]).sessionPresent ? "Kopplungsdatei vorhanden" : "Noch keine Kopplungsdatei")}
          {` · ${current.enabled === true ? "Gateway aktiviert" : current.enabled === false ? "Gateway deaktiviert" : "Aktivierung unbekannt"} · ${current.gatewayRunning ? "Gateway-Dienst läuft" : "Gateway-Dienst nicht bestätigt"} · Laufzeitverbindung: ${CONNECTION_LABELS[current.connectionState] ?? current.connectionState}. Berechtigte Zustellung nicht geprüft.`}</p>
        {platform === "discord" ? <>
          <label>Discord-Bot-Token <input type="password" autoComplete="off" value={token} disabled={clearToken || busy} onChange={(event) => setToken(event.target.value)} /></label>
          <label>Erlaubte Discord-User-IDs <input type="text" value={ids} onChange={(event) => setIds(event.target.value)} placeholder="123456789012345678" /></label>
          <label>Erlaubte Kanal-IDs (optional) <input type="text" value={channels} onChange={(event) => setChannels(event.target.value)} /></label>
          <label><input type="checkbox" checked={clearToken} onChange={(event) => setClearToken(event.target.checked)} /> Gespeichertes Bot-Token entfernen</label>
        </> : <>
          <p role="status">Kopplung: {PAIRING_LABELS[pairing.data?.data.state ?? ""] ?? "unbekannt"} · Verbindung: {CONNECTION_LABELS[pairing.data?.data.connectionState ?? ""] ?? "unbekannt"}
            {pairing.data?.data.linkedIdentity ? ` · Verknüpft: ${pairing.data.data.linkedIdentity}` : ""}</p>
          {qrImage && pairing.data?.data.state === "waiting" && <div><img src={qrImage} width={320} height={320} alt="WhatsApp-Kopplungs-QR-Code" />
            <p>Der QR-Code läuft nach kurzer Zeit ab. Danach neuen Code anfordern.</p></div>}
          {remainingSeconds !== null && <p role="timer" aria-live="off">
            {remainingSeconds > 0
              ? `Kopplungsvorgang endet in ${Math.floor(remainingSeconds / 60)}:${String(remainingSeconds % 60).padStart(2, "0")} Minuten.`
              : "Der Kopplungsvorgang ist abgelaufen. Kopplung neu starten."}</p>}
          {pairing.data?.data.state === "qr_expired" && <p role="status">Der QR-Code ist abgelaufen. Neuen Code anfordern oder die Kopplung abbrechen.</p>}
          {!(current as WhatsappGatewayResponse["data"]).sessionPresent &&
            <button type="button" disabled={busy} onClick={() => void changePairing("start")}>Kopplung starten / QR erneuern</button>}
          {(current as WhatsappGatewayResponse["data"]).sessionPresent && <>
            <p>Zum Neukoppeln zuerst abmelden; die bestehende Kopplung bleibt bis dahin unverändert.</p>
            <button type="button" disabled={busy} onClick={() => void changePairing("reconnect")}>Verbindung neu starten</button>
            <button type="button" disabled={busy} onClick={() => void changePairing("logout")}>WhatsApp abmelden</button>
          </>}
          {pairing.data?.data.state === "starting" || pairing.data?.data.state === "waiting" || pairing.data?.data.state === "qr_expired" ?
            <button type="button" disabled={busy} onClick={() => void changePairing("cancel")}>Kopplung abbrechen</button> : null}
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
