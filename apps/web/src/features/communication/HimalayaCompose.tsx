"use client";

import { createIdempotencyKey, isFridayApiError, type HimalayaSendResponse } from "@friday/sdk";
import { useRef, useState } from "react";
import { call } from "@/lib/api/call";
import { getApiClient } from "@/lib/api/client";

export function HimalayaCompose() {
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<"sent" | "unknown" | null>(null);
  const [error, setError] = useState("");
  const sendKey = useRef<string | null>(null);
  const recipients = to.split(",").map((address) => address.trim()).filter(Boolean);

  function edit(setter: (value: string) => void, value: string) {
    setter(value);
    setConfirming(false);
    setOutcome(null);
    setError("");
    sendKey.current = null;
  }

  async function send() {
    setSending(true);
    setError("");
    sendKey.current ??= createIdempotencyKey();
    try {
      const response: HimalayaSendResponse = await call(getApiClient().POST("/api/v1/communication/himalaya/send", {
        params: { header: { "Idempotency-Key": sendKey.current } }, body: { to: recipients, subject, body },
      }));
      setOutcome(response.data.state);
    } catch (failure) {
      if (isFridayApiError(failure) && ([400, 401, 403, 409, 422].includes(failure.status) || failure.details.stage === "preflight")) {
        setError(failure.message);
      } else {
        // A disconnected browser cannot know whether SMTP accepted the request.
        setOutcome("unknown");
      }
    } finally {
      setSending(false);
      setConfirming(false);
    }
  }

  return <section className="com-live-mail__compose" aria-label="E-Mail verfassen">
    <h3>E-Mail verfassen (SMTP)</h3>
    <p>Friday sendet erst nach deiner ausdrücklichen Bestätigung. Keine Anhänge; maximal 10 Empfänger und 100 KB Text.</p>
    <label>Empfänger (durch Komma trennen)
      <input type="text" value={to} onChange={(event) => edit(setTo, event.target.value)} disabled={sending} maxLength={2600} />
    </label>
    <label>Betreff
      <input type="text" value={subject} onChange={(event) => edit(setSubject, event.target.value)} disabled={sending} maxLength={200} />
    </label>
    <label>Nachricht
      <textarea value={body} onChange={(event) => edit(setBody, event.target.value)} disabled={sending} maxLength={100000} rows={6} />
    </label>
    {!confirming && <button type="button" disabled={sending || outcome !== null || recipients.length < 1 || !subject || !body}
      onClick={() => setConfirming(true)}>Versand prüfen</button>}
    {confirming && <div className="com-live-mail__preview" role="group" aria-label="Versand bestätigen">
      <p><strong>Empfänger:</strong> {recipients.join(", ")}</p>
      <p><strong>Betreff:</strong> {subject}</p>
      <pre>{body}</pre>
      <button type="button" disabled={sending} onClick={send}>Genau diese E-Mail senden</button>
      <button type="button" disabled={sending} onClick={() => setConfirming(false)}>Abbrechen</button>
    </div>}
    {sending && <p role="status">Versand läuft …</p>}
    {outcome === "sent" && <p role="status">SMTP hat den Versand bestätigt.</p>}
    {outcome === "unknown" && <p role="alert">Der Versandstatus ist unbekannt. Prüfe das Postfach beim Anbieter, bevor du eine neue Nachricht verfasst. Friday sendet diesen Versuch nicht erneut.</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
