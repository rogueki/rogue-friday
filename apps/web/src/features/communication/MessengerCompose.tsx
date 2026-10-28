"use client";

import type { MessengerDraft, MessengerPreviewResponse, MessengerReceiptResponse, MessengerReceiptsResponse, MessengerTargetsResponse, NotificationListResponse } from "@friday/sdk";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { call } from "@/lib/api/call";
import { getApiClient } from "@/lib/api/client";
import { useRunStagedWrite } from "@/lib/api/stagedWrite";
import { useSettings } from "@/lib/api/domains/settings";
import { useSession } from "@/lib/session";

const platforms = ["telegram", "discord", "whatsapp", "slack", "signal", "matrix", "mattermost", "sms",
  "irc", "line", "feishu", "wecom", "photon", "buzz", "ntfy"] as const;

export function MessengerCompose() {
  const { role } = useSession();
  const [notificationId] = useState(() => typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("messengerNotification"));
  const [notificationStep] = useState(() => {
    if (typeof window === "undefined") return null;
    const raw = new URLSearchParams(window.location.search).get("messengerStep");
    const parsed = raw === null ? NaN : Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  });
  const settings = useSettings(role === "owner" && Boolean(notificationId));
  const notifications = useQuery({ queryKey: ["notifications", "messenger-handoff", notificationId],
    enabled: role === "owner" && Boolean(notificationId), retry: false,
    queryFn: async (): Promise<NotificationListResponse> => {
      let cursor: string | undefined;
      const items: NotificationListResponse["items"] = [];
      let response: NotificationListResponse | undefined;
      do {
        response = await call(getApiClient().GET("/api/v1/notifications", { params: { query: { limit: 100, ...(cursor ? { cursor } : {}) } } }));
        items.push(...response.items);
        if (items.some((item) => item.id === notificationId)) break;
        cursor = response.pageInfo.nextCursor ?? undefined;
      } while (cursor);
      return response ? { ...response, items } : { contractVersion: "2.0.0", items, pageInfo: { nextCursor: null, hasNextPage: false }, freshness: { state: "fresh", asOf: new Date().toISOString() }, sources: [] };
    } });
  const hydratedNotification = useRef<string | null>(null);
  const [platform, setPlatform] = useState<(typeof platforms)[number]>("telegram");
  const [recipient, setRecipient] = useState("");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<MessengerPreviewResponse["data"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const sendKey = useRef<string | null>(null);
  const runStagedWrite = useRunStagedWrite();
  const receipts = useQuery({ queryKey: ["messenger", "receipts"], enabled: role === "owner",
    queryFn: (): Promise<MessengerReceiptsResponse> => call(getApiClient().GET("/api/v1/messenger/receipts")), retry: false });
  const targets = useQuery({ queryKey: ["messenger", "targets"], enabled: role === "owner",
    queryFn: (): Promise<MessengerTargetsResponse> => call(getApiClient().GET("/api/v1/messenger/targets")), retry: false });
  useEffect(() => {
    if (!notificationId || hydratedNotification.current === notificationId || !settings.data || !notifications.data) return;
    hydratedNotification.current = notificationId;
    const notification = notifications.data.items.find((item) => item.id === notificationId);
    const step = notificationStep === null ? undefined : notification?.escalation.find((item) => item.step === notificationStep && item.state === "awaiting_approval");
    const platform = step?.channel;
    if (!notification || !platform || !["telegram", "whatsapp", "sms"].includes(platform)) {
      setMessage("Für diese Meldung liegt kein freigabepflichtiger Messenger-Schritt vor.");
      return;
    }
    const channel = settings.data.data.notifications.channels.find((item) => item.kind === platform);
    if (!channel?.enabled || !channel.recipient?.trim()) {
      setMessage("Kanal aktivieren und exakten Empfänger in den Benachrichtigungseinstellungen hinterlegen.");
      return;
    }
    if (channel.accountId && channel.accountId !== "default") {
      setMessage("Für diesen Kanal unterstützt der Versanddienst aktuell nur das Konto „default“.");
      return;
    }
    setPlatform(platform as typeof platforms[number]);
    setRecipient(channel.recipient.trim());
    setText(`${notification.title}\n\n${notification.body}`);
    setMessage(`Meldung ${notification.id} vorbereitet. Prüfe die Vorschau ausdrücklich; es wurde nichts gesendet.`);
  }, [notificationId, notificationStep, notifications.data, settings.data]);
  if (role !== "owner") return null;
  const draft = (): MessengerDraft => ({ accountId: "default", platform, recipient: recipient.trim(), text,
    ...(notificationId && notificationStep ? { notificationId, notificationStep } : {}) });
  const change = (update: () => void) => { update(); setPreview(null); sendKey.current = null; setMessage(""); };
  async function registerTarget() {
    setBusy(true); setMessage("");
    try {
      await call(getApiClient().POST("/api/v1/messenger/targets", { body: {
        accountId: "default", platform, recipient: recipient.trim(),
      } }));
      await targets.refetch();
      setMessage("Exakte Empfänger-ID für dieses Konto registriert. Die Registrierung prüft keine Zustellung.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Empfänger konnte nicht registriert werden."); }
    finally { setBusy(false); }
  }
  async function removeTarget(id: string) {
    setBusy(true); setMessage(""); setPreview(null);
    try {
      await call(getApiClient().DELETE("/api/v1/messenger/targets/{id}", { params: { path: { id } } }));
      await targets.refetch();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Empfänger konnte nicht entfernt werden."); }
    finally { setBusy(false); }
  }
  async function prepare() {
    setBusy(true); setMessage("");
    try {
      const response: MessengerPreviewResponse = await call(getApiClient().POST("/api/v1/messenger/preview", { body: draft() }));
      setPreview(response.data);
      sendKey.current = response.data.idempotencyKey ?? crypto.randomUUID();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Empfänger oder Kanal ist nicht bereit."); }
    finally { setBusy(false); }
  }
  async function confirm() {
    if (!preview) return;
    setBusy(true); setMessage("");
    try {
      if (!notificationId) {
        // Plain sends run through the native staged pipeline: the server-staged preview binds the exact
        // draft, and the journal key derives from the preview id.
        const staged = preview;
        await runStagedWrite({
          send: (previewId) => call(getApiClient().POST("/api/v1/messenger/confirm", {
            body: { draft: staged.draft, token: staged.token },
            ...(previewId ? { headers: { "X-Action-Preview-Id": previewId } } : {}) })),
          successMessage: "Nachricht versendet.",
          subject: `Nachricht über ${staged.draft.platform}`,
          invalidateKeys: [["messenger", "receipts"]],
          onExecuted: (response) => {
            const data = (response as MessengerReceiptResponse).data;
            setMessage(data.state === "sent" ? "Der Adapter hat die Zustellung bestätigt." :
              "Zustellung unklar. Friday sendet diesen Versuch nicht erneut; bitte den Kanal prüfen.");
            setPreview(null);
          },
        });
        return;
      }
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
  return <section className="mk-panel" aria-label="Nachricht über den gewählten Kanal">
    <h2>Nachricht über den gewählten Kanal</h2>
    <p>Ausgehende Ziele werden hier ausdrücklich registriert. Hermes’ Listen erlaubter Absender gelten nur für eingehende Nachrichten. Eine Vorschau sendet noch nichts.</p>
    <label>Kanal <select value={platform} disabled={Boolean(notificationId)} onChange={(event) => change(() => setPlatform(event.target.value as typeof platform))}>
      {platforms.map((item) => <option key={item} value={item}>{item}</option>)}
    </select></label>
    <label>Empfänger-ID <input value={recipient} readOnly={Boolean(notificationId)} onChange={(event) => change(() => setRecipient(event.target.value))} /></label>
    <button type="button" disabled={busy || !recipient.trim()} onClick={() => void registerTarget()}>Empfänger-ID registrieren</button>
    {targets.data?.data.items.length ? <ul aria-label="Registrierte Empfänger">
      {targets.data.data.items.map((item) => <li key={item.id}>
        <button type="button" onClick={() => change(() => { setPlatform(item.platform as typeof platform); setRecipient(item.recipient); })}>
          {item.platform}: {item.recipient}
        </button>{" "}<button type="button" disabled={busy} onClick={() => void removeTarget(item.id)}>Entfernen</button>
      </li>)}
    </ul> : null}
    <label>Nachricht <textarea value={text} readOnly={Boolean(notificationId)} onChange={(event) => change(() => setText(event.target.value))} /></label>
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
