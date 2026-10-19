"use client";

import type { MessengerCatalogResponse, MessengerProviderResponse, MessengerProviderUpdate, MessengerSendersResponse } from "@friday/sdk";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { call } from "@/lib/api/call";
import { getApiClient } from "@/lib/api/client";
import { useSession } from "@/lib/session";

const managed = new Set(["bluebubbles", "buzz", "dingtalk", "feishu", "google_chat", "irc", "line", "matrix",
  "mattermost", "ntfy", "photon", "qqbot", "signal", "simplex", "slack", "sms", "teams", "wecom", "weixin",
  "whatsapp_cloud", "yuanbao"]);
const omitted = new Set(["BUZZ_CLI_PATH", "BUZZ_CREDENTIALS_FILE", "HERMES_SIMPLEX_TEXT_BATCH_DELAY"]);

function MessengerSenderLinks() {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const senders = useQuery({ queryKey: ["messenger", "senders"], enabled: open, retry: false,
    queryFn: (): Promise<MessengerSendersResponse> => call(getApiClient().GET("/api/v1/messenger/senders")) });
  async function change(id: string, link: boolean) {
    setBusy(id); setMessage("");
    try {
      if (link) await call(getApiClient().POST("/api/v1/messenger/senders/{id}/link", { params: { path: { id } } }));
      else await call(getApiClient().DELETE("/api/v1/messenger/senders/{id}/link", { params: { path: { id } } }));
      await senders.refetch();
      setMessage(link ? "Absender mit Owner-Identität verknüpft." : "Absender-Verknüpfung entfernt.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Absender-Verknüpfung fehlgeschlagen."); }
    finally { setBusy(null); }
  }
  return <details onToggle={(event) => setOpen(event.currentTarget.open)}><summary>Beobachtete private Absender und Identitätslinks</summary>
    <p>Nur nach Hermes-Zulassung beobachtete Direktnachrichten erscheinen hier. Verknüpfe eine genaue Absender-ID nur, wenn sie zu dir gehört. Gruppen und unbekannte Absender werden nicht dem Owner-Gedächtnis zugeordnet.</p>
    {senders.isPending && open ? <p role="status">Absender werden gelesen.</p> : null}
    {senders.isError ? <p role="alert">Absenderliste nicht erreichbar. <button type="button" onClick={() => void senders.refetch()}>Erneut prüfen</button></p> : null}
    {senders.data ? <ul>{senders.data.data.items.map((sender) => <li key={sender.id}>
      <strong>{sender.platform}</strong> ({sender.accountId}): {sender.senderId} · Chat {sender.chatId} · {sender.linked ? "Owner-verknüpft" : "nicht verknüpft"}
      <button type="button" disabled={busy !== null} onClick={() => void change(sender.id, !sender.linked)}>
        {sender.linked ? "Verknüpfung entfernen" : "Mit Owner verknüpfen"}</button>
    </li>)}</ul> : null}
    {message ? <p role="status">{message}</p> : null}
  </details>;
}

function ProviderFields({ item }: { item: MessengerCatalogResponse["data"]["items"][number] }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [clear, setClear] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const status = useQuery({ queryKey: ["messenger", "provider", item.platform], enabled: open, retry: false,
    queryFn: (): Promise<MessengerProviderResponse> => call(getApiClient().GET("/api/v1/messenger/providers/{platform}",
      { params: { path: { platform: item.platform } } })) });
  const editable = item.fields.filter((field) => !omitted.has(field.name) && !field.name.endsWith("_ALLOW_ALL_USERS"));
  async function save() {
    if (!status.data) return;
    const patch: Record<string, string | null> = {};
    for (const field of editable) {
      if (clear[field.name]) patch[field.name] = null;
      else if (values[field.name]) patch[field.name] = values[field.name]!;
    }
    if (!Object.keys(patch).length) { setResult("Bitte mindestens ein Feld ändern."); return; }
    if (Object.keys(patch).length > 10) { setResult("Bitte höchstens zehn Felder je Speichervorgang ändern."); return; }
    setBusy(true);
    setResult("");
    try {
      const body = { platform: item.platform, revision: status.data.data.revision, values: patch } as MessengerProviderUpdate;
      const saved: MessengerProviderResponse = await call(getApiClient().PUT("/api/v1/messenger/providers/{platform}",
        { params: { path: { platform: item.platform } }, body }));
      setValues({}); setClear({});
      await status.refetch();
      await queryClient.invalidateQueries({ queryKey: ["messenger", "catalog"] });
      setResult(saved.data.state === "saved" ? "Werte gespeichert. Gateway-Neustart und Verbindung sind noch nicht bestätigt."
        : saved.data.state === "partial" ? "Ein Teil der Werte wurde gespeichert. Bitte Status neu prüfen und gezielt korrigieren."
          : "Speicherergebnis ungewiss. Bitte Status prüfen und nicht blind erneut speichern.");
    } catch (error) { setResult(error instanceof Error ? error.message : "Provider-Konfiguration nicht erreichbar."); }
    finally { setBusy(false); }
  }
  async function apply() {
    if (!status.data) return;
    setBusy(true); setResult("");
    try {
      const applied: MessengerProviderResponse = await call(getApiClient().POST("/api/v1/messenger/providers/{platform}/apply",
        { params: { path: { platform: item.platform } }, body: { revision: status.data.data.revision } }));
      await status.refetch();
      await queryClient.invalidateQueries({ queryKey: ["messenger", "catalog"] });
      setResult(applied.data.state === "applied"
        ? `Gateway-Neustart bestätigt. Verbindung dieses Kanals: ${applied.data.connectionState ?? "unknown"}.`
        : "Gateway-Neustart nicht bestätigt. Dienststatus prüfen; Verbindung unbekannt.");
    } catch (error) { setResult(error instanceof Error ? error.message : "Gateway-Neustart nicht erreichbar."); }
    finally { setBusy(false); }
  }
  return <details onToggle={(event) => setOpen(event.currentTarget.open)}><summary>Provider-Felder einrichten</summary>
    {status.isPending ? <p role="status">Konfigurationsrevision wird gelesen.</p> : null}
    {status.isError ? <p role="alert">Provider-Konfiguration nicht erreichbar. <button type="button" onClick={() => void status.refetch()}>Erneut prüfen</button></p> : null}
    {status.data ? <>
      <p>Änderungen werden in Hermes gespeichert. Der Gateway-Dienst wird dadurch nicht gestartet oder neu verbunden.</p>
      {editable.map((field) => <div key={field.name}>
        <label>{field.name} <input type={field.secret ? "password" : "text"} autoComplete="off" disabled={busy || !!clear[field.name]}
          value={values[field.name] ?? ""} onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}
          placeholder={field.present ? "Vorhandenen Wert ersetzen" : "Wert eingeben"} /></label>
        <label><input type="checkbox" checked={!!clear[field.name]} disabled={busy}
          onChange={(event) => setClear({ ...clear, [field.name]: event.target.checked })} /> Wert entfernen</label>
      </div>)}
      <button type="button" disabled={busy} onClick={() => void save()}>Provider-Felder speichern</button>
      <button type="button" disabled={busy} onClick={() => void apply()}>Hermes-Gateway mit gespeicherter Konfiguration neu starten</button>
    </> : null}
    {result ? <p role="status">{result}</p> : null}
  </details>;
}

export function MessengerCatalogPanel() {
  const { role } = useSession();
  const catalog = useQuery({ queryKey: ["messenger", "catalog"], enabled: role === "owner", retry: false,
    queryFn: (): Promise<MessengerCatalogResponse> => call(getApiClient().GET("/api/v1/messenger/catalog")) });
  if (role !== "owner") return null;
  return <section className="mk-panel" aria-label="Hermes-Messenger-Kanäle">
    <h2>Hermes-Messenger-Kanäle</h2>
    <MessengerSenderLinks />
    <p>Das Inventar stammt aus der gepinnten lokalen Hermes-Version. „Konfiguriert“ bedeutet nur, dass Hermes die Voraussetzungen erkennt. Ein erfolgreicher Empfang oder Versand ist damit nicht belegt.</p>
    {catalog.isPending ? <p role="status">Kanalvoraussetzungen werden gelesen.</p> : null}
    {catalog.isError ? <p role="alert">Kanalinventar nicht erreichbar. <button type="button" onClick={() => void catalog.refetch()}>Erneut prüfen</button></p> : null}
    {catalog.data ? <details><summary>{catalog.data.data.items.length} native Nachrichtenkanäle anzeigen</summary><ul>
      {catalog.data.data.items.map((item) => <li key={item.platform}>
        <strong>{item.platform}</strong>: {item.configured ? "konfiguriert" : "Voraussetzungen fehlen"};
        {" "}Gateway: {item.gatewayRunning ? "läuft" : "nicht bestätigt"}; Verbindung: {item.connectionState};
        {" "}Friday-Versand: {item.exactSendSupported ? "exakte Ziele möglich" : "noch nicht freigegeben"};
        {" "}native Friday-Einrichtung: {item.nativeSetupAvailable ? "vorhanden" : "ausstehend"}.
        {item.fields.length ? <details><summary>Voraussetzungen</summary><ul>
          {item.fields.map((field) => <li key={field.name}>{field.name}: {field.present ? "vorhanden" : "fehlt"}
            {field.required ? " (erforderlich)" : " (optional)"}{field.secret ? ", geheimer Wert wird nicht angezeigt" : ""}</li>)}
        </ul></details> : null}
        {managed.has(item.platform) ? <ProviderFields item={item} /> : null}
      </li>)}
    </ul></details> : null}
  </section>;
}
