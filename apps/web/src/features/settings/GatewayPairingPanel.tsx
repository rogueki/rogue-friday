"use client";

import type { GatewayPairingResponse } from "@friday/sdk";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { call } from "@/lib/api/call";
import { getApiClient } from "@/lib/api/client";

type Platform = "telegram" | "discord" | "whatsapp";
const platformNames: Record<Platform, string> = { telegram: "Telegram", discord: "Discord", whatsapp: "WhatsApp" };

export function GatewayPairingPanel({ owner }: { owner: boolean }) {
  const pairing = useQuery<GatewayPairingResponse>({ queryKey: ["settings", "gateway-pairing"], enabled: owner,
    refetchInterval: 15000, queryFn: () => call(getApiClient().GET("/api/v1/settings/gateway-pairing")) });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function approve(platform: Platform, requestId: string) {
    setBusy(true); setMessage("");
    try {
      await call(getApiClient().POST("/api/v1/settings/gateway-pairing/approve", { body: { platform, requestId } }));
      await pairing.refetch();
      setMessage("Freigegeben. Hermes antwortet dieser Person ab sofort.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Freigabe nicht möglich."); }
    finally { setBusy(false); }
  }

  async function revoke(platform: Platform, userId: string, name: string) {
    if (!window.confirm(`Freigabe für ${name} wirklich entziehen? Hermes beantwortet dessen Nachrichten danach nicht mehr.`)) return;
    setBusy(true); setMessage("");
    try {
      await call(getApiClient().POST("/api/v1/settings/gateway-pairing/revoke", { body: { platform, userId } }));
      await pairing.refetch();
      setMessage("Freigabe entzogen.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Freigabe konnte nicht entzogen werden."); }
    finally { setBusy(false); }
  }

  return <section aria-labelledby="gateway-pairing-title">
    <h3 id="gateway-pairing-title">Kopplungsanfragen (Telegram, Discord, WhatsApp)</h3>
    <p>Wer dem Bot zum ersten Mal schreibt, bekommt von Hermes einen Kopplungscode – aber nur, solange für die Plattform keine Liste erlaubter Nutzer-IDs eingetragen ist. Hier gibst du solche Anfragen frei oder entziehst Freigaben wieder. Den Code selbst zeigt Friday nie an; prüfe den Namen, bevor du freigibst.</p>
    {owner ? <>
      {pairing.isError && <p role="alert">Kopplungsanfragen sind nicht erreichbar. <button type="button" disabled={busy} onClick={() => void pairing.refetch()}>Erneut prüfen</button></p>}
      {pairing.data?.data.platforms.map((entry) => <div key={entry.platform}>
        <h4>{platformNames[entry.platform]}</h4>
        {entry.pending.length > 0 ? <ul>
          {entry.pending.map((item) => <li key={item.requestId}>
            {item.userName || "ohne Namen"} (ID {item.userId}), seit {item.ageMinutes} Min.{" "}
            <button type="button" disabled={busy} aria-label={`${item.userName || item.userId} auf ${platformNames[entry.platform]} freigeben`}
              onClick={() => void approve(entry.platform, item.requestId)}>Freigeben</button>
          </li>)}
        </ul> : <p>Keine offenen Anfragen.</p>}
        {entry.approved.length > 0 ? <ul>
          {entry.approved.map((item) => <li key={item.userId}>
            {item.userName || "ohne Namen"} (ID {item.userId}){item.approvedAt ? ` – freigegeben am ${new Date(item.approvedAt).toLocaleString("de-DE")}` : ""}{" "}
            <button type="button" disabled={busy} aria-label={`Freigabe für ${item.userName || item.userId} auf ${platformNames[entry.platform]} entziehen`}
              onClick={() => void revoke(entry.platform, item.userId, item.userName || item.userId)}>Entziehen</button>
          </li>)}
        </ul> : <p>Niemand per Kopplung freigegeben.</p>}
      </div>)}
      {message && <p role="status">{message}</p>}
    </> : <p>Nur der Owner kann Kopplungsanfragen freigeben.</p>}
  </section>;
}
