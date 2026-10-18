"use client";

import type { MessengerDraft, MessengerPreviewResponse, MessengerReceiptResponse, MessengerReceiptsResponse } from "@friday/sdk";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { call } from "@/lib/api/call";
import { getApiClient } from "@/lib/api/client";
import { useSession } from "@/lib/session";

const platforms = ["telegram", "discord", "whatsapp", "slack", "signal", "matrix", "mattermost", "sms",
  "irc", "line", "feishu", "teams", "google_chat", "wecom", "dingtalk", "simplex", "photon", "buzz", "ntfy"] as const;

export function MessengerCompose() {
  const { role } = useSession();
  const [platform, setPlatform] = useState<(typeof platforms)[number]>("telegram");
  const [recipient, setRecipient] = useState("");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<MessengerPreviewResponse["data"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const sendKey = useRef<string | null>(null);
  const receipts = useQuery({ queryKey: ["messenger", "receipts"], enabled: role === "owner",
    queryFn: (): Promise<MessengerReceiptsResponse> => call(getApiClient().GET("/api/v1/messenger/receipts")), retry: false });
  if (role !== "owner") return null;
  const draft = (): MessengerDraft => ({ accountId: "default", platform, recipient: recipient.trim(), text });
  const change = (update: () => void) => { update(); setPreview(null); sendKey.current = null; setMessage(""); };
  async function prepare() {
    setBusy(true); setMessage("");
    try {
      const response: MessengerPreviewResponse = await call(getApiClient().POST("/api/v1/messenger/preview", { body: draft() }));
      setPreview(response.data);
      sendKey.current = crypto.randomUUID();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Empfänger oder Kanal ist nicht bereit."); }
    finally { setBusy(false); }
  }
  async function confirm() {
    if (!preview) return;
    setBusy(true); setMessage("");
    try {
      const response: MessengerReceiptResponse = await call(getApiClient().POST("/api/v1/messenger/confirm", {
        params: { header: { "Idempotency-Key": sendKey.current ??= crypto.randomUUID() } }, body: { draft: preview.draft, token: preview.token },
      }));
      setMessage(response.data.state === "sent" ? "Der Adapter hat die Zustellung bestätigt." :
        "Zustellung unklar. Friday sendet diesen Versuch nicht erneut; bitte den Kanal prüfen.");
      setPreview(null);
      await receipts.refetch();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Zustellung unklar. Belege prüfen, bevor ein neuer Versuch gestartet wird."); }
    finally { setBusy(false); }
  }
  return <section className="mk-panel" aria-label="Messenger-Nachricht">
    <h2>Messenger-Nachricht</h2>
    <p>Nur exakt eingerichtete Empfänger-IDs sind zulässig. Eine Vorschau sendet noch nichts.</p>
    <label>Kanal <select value={platform} onChange={(event) => change(() => setPlatform(event.target.value as typeof platform))}>
      {platforms.map((item) => <option key={item} value={item}>{item}</option>)}
    </select></label>
    <label>Empfänger-ID <input value={recipient} onChange={(event) => change(() => setRecipient(event.target.value))} /></label>
    <label>Nachricht <textarea value={text} onChange={(event) => change(() => setText(event.target.value))} /></label>
    <button type="button" disabled={busy || !recipient.trim() || !text.trim()} onClick={() => void prepare()}>Vorschau prüfen</button>
    {preview ? <div role="group" aria-label="Versandfreigabe">
      <p>Kanal: {preview.draft.platform}; Empfänger: {preview.draft.recipient}; Konto: {preview.draft.accountId}</p>
      <p style={{ whiteSpace: "pre-wrap" }}>{preview.draft.text}</p>
      <p>Freigabe gültig bis {new Date(preview.expiresAt).toLocaleString()}.</p>
      <button type="button" disabled={busy} onClick={() => void confirm()}>Genau diese Nachricht senden</button>
      <button type="button" disabled={busy} onClick={() => setPreview(null)}>Abbrechen</button>
    </div> : null}
    {message ? <p role="status">{message}</p> : null}
    {receipts.data?.data.items.length ? <details><summary>Versandbelege</summary><ul>
      {receipts.data.data.items.map((item) => <li key={item.receiptId}>{item.platform} an {item.recipient}: {item.state}</li>)}
    </ul></details> : null}
  </section>;
}
