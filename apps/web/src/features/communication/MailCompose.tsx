"use client";

import { createIdempotencyKey, type MailAccount, type MailMessageResponse, type MailSendRequest, type MailSendResponse } from "@friday/sdk";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { call } from "@/lib/api/call";
import { getApiClient } from "@/lib/api/client";
import { useRunStagedWrite } from "@/lib/api/stagedWrite";

const address = (value: string) => (/<([^<>]+)>/.exec(value)?.[1] ?? value).trim();
const split = (value: string) => value.split(",").map(address).filter(Boolean);

export function MailCompose({ account, original, mode, onClose }: {
  account: MailAccount; original?: MailMessageResponse["data"]; mode: "new" | "reply" | "reply-all" | "forward"; onClose: () => void;
}) {
  const [to, setTo] = useState("");
  const [from, setFrom] = useState(account.email);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<MailSendRequest["attachments"]>([]);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [sendState, setSendState] = useState<"sent" | "uncertain" | null>(null);
  const [archivePending, setArchivePending] = useState(false);
  const [sentRequest, setSentRequest] = useState<MailSendRequest | null>(null);
  const draftKey = useRef<string | null>(null);
  const queryClient = useQueryClient();
  const runStagedWrite = useRunStagedWrite();
  useEffect(() => {
    if (!original) return;
    const recipients = mode === "reply-all" ? [...split(original.replyTo || original.from), ...split(original.to)] :
      mode === "reply" ? split(original.replyTo || original.from) : [];
    setTo([...new Set(recipients.filter((item) => item !== account.email && !account.aliases.includes(item)))].join(", "));
    setSubject(mode === "forward" ? `Fwd: ${original.subject}` : /^re:/i.test(original.subject) ? original.subject : `Re: ${original.subject}`);
  }, [account, original, mode]);
  const edit = (action: () => void) => { action(); setPreview(false); setResult(""); setReceiptId(null); setSentRequest(null); draftKey.current = null; };
  async function addFiles(files: FileList | null) {
    if (!files) return;
    const next: NonNullable<MailSendRequest["attachments"]> = [];
    for (const file of Array.from(files).slice(0, 5)) {
      if (file.size > 5 * 1024 * 1024) { setResult("Anhang zu groß (maximal 5 MB je Datei)."); return; }
      if (next.reduce((total, item) => total + Math.floor(item.data.length * 3 / 4), 0) + file.size > 5 * 1024 * 1024) {
        setResult("Anhänge zusammen zu groß (maximal 5 MB)."); return;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      next.push({ filename: file.name, data: btoa(binary) });
    }
    edit(() => setAttachments(next));
  }
  function composeMessage(): MailSendRequest {
    const recipients = split(to);
    const headers = original && (mode === "reply" || mode === "reply-all") ?
      { inReplyTo: original.messageId || undefined, references: [original.references, original.messageId].filter(Boolean).join(" ") || undefined } : {};
    return { to: recipients, from, subject, body, attachments, ...headers };
  }
  async function draft() {
    setBusy(true); setResult(""); draftKey.current ??= createIdempotencyKey();
    try {
      const response = await call(getApiClient().POST("/api/v1/integrations/mail/accounts/{accountId}/draft", {
        params: { path: { accountId: account.id }, header: { "Idempotency-Key": draftKey.current } }, body: composeMessage(),
      }));
      setResult(response.data.alreadyPresent ? "Entwurf ist bereits im Entwürfe-Ordner." : "Entwurf im Entwürfe-Ordner gespeichert. Keine E-Mail gesendet.");
      void queryClient.invalidateQueries({ queryKey: ["mail-accounts", account.id] });
    } catch (error) { setResult(error instanceof Error ? error.message : "Entwurf konnte nicht bestätigt werden. Ordner prüfen."); }
    finally { setBusy(false); }
  }
  async function send() {
    setBusy(true); setResult("");
    const request = composeMessage();
    const outcome = await runStagedWrite({
      // The staged pipeline binds the exact message to the server preview; the journal key comes from the preview id.
      send: (previewId) => call(getApiClient().POST("/api/v1/integrations/mail/accounts/{accountId}/send", {
        params: { path: { accountId: account.id } }, body: request,
        ...(previewId ? { headers: { "X-Action-Preview-Id": previewId } } : {}) })),
      successMessage: "E-Mail versendet.",
      subject: subject || "E-Mail",
      invalidateKeys: [["mail-accounts", account.id, "receipts"]],
      onExecuted: (response) => {
        const data = (response as MailSendResponse).data;
        setReceiptId(data.receiptId);
        setSendState(data.state);
        setArchivePending(data.archivePending);
        setSentRequest(request);
        setResult(data.state === "uncertain" ? "Versand unklar. Bitte beim Anbieter prüfen; Friday sendet diesen Versuch nicht erneut." :
          data.archivePending ? "SMTP-Versand bestätigt. Kopie in Gesendet ist noch ausstehend; nicht erneut senden." : "SMTP-Versand und Gesendet-Kopie bestätigt.");
      },
    });
    if (outcome === "failed") setResult("Antwort unbekannt. Bitte beim Anbieter prüfen, bevor du erneut sendest.");
    setBusy(false);
    if (outcome === "executed") setPreview(false);
  }
  async function review() {
    if (!receiptId) return;
    setBusy(true);
    try {
      const response = await call(getApiClient().POST("/api/v1/integrations/mail/accounts/{accountId}/receipts/{receiptId}/review", {
        params: { path: { accountId: account.id, receiptId } },
      }));
      setSendState(response.data.state === "pending" ? "uncertain" : response.data.state);
      setArchivePending(response.data.archivePending);
      void queryClient.invalidateQueries({ queryKey: ["mail-accounts", account.id, "receipts"] });
      setResult(response.data.state === "sent" ? "Gesendet-Kopie gefunden; Versandbeleg bestätigt." :
        "Keine bestätigte Gesendet-Kopie gefunden. Versand bleibt unklar; bitte beim Anbieter prüfen.");
    } catch (error) { setResult(error instanceof Error ? error.message : "Gesendet-Ordner nicht erreichbar."); }
    finally { setBusy(false); }
  }
  async function archive() {
    if (!receiptId || !sentRequest) return;
    setBusy(true);
    try {
      const response = await call(getApiClient().POST("/api/v1/integrations/mail/accounts/{accountId}/receipts/{receiptId}/archive", {
        params: { path: { accountId: account.id, receiptId } }, body: sentRequest,
      }));
      setArchivePending(response.data.archivePending);
      void queryClient.invalidateQueries({ queryKey: ["mail-accounts", account.id, "receipts"] });
      setResult("Gesendet-Kopie geprüft und archiviert. SMTP wurde nicht erneut aufgerufen.");
    } catch (error) { setResult(error instanceof Error ? error.message : "Gesendet-Kopie bleibt offen. SMTP wurde nicht erneut aufgerufen."); }
    finally { setBusy(false); }
  }
  return <section className="com-live-mail__compose" aria-label="Mail Postfach verfassen">
    <h3>{mode === "new" ? "E-Mail verfassen" : mode === "forward" ? "Weiterleiten" : "Antworten"}</h3>
    <p>Quelle: {account.displayName} ({account.email}). Versand erst nach ausdrücklicher Bestätigung.</p>
    <label>Absender<select value={from} onChange={(event) => edit(() => setFrom(event.target.value))}>
      {[account.email, ...account.aliases].map((item) => <option key={item} value={item}>{item}</option>)}
    </select></label>
    <label>Empfänger<input value={to} onChange={(event) => edit(() => setTo(event.target.value))} disabled={busy} /></label>
    <label>Betreff<input value={subject} onChange={(event) => edit(() => setSubject(event.target.value))} disabled={busy} maxLength={200} /></label>
    <label>Text<textarea value={body} onChange={(event) => edit(() => setBody(event.target.value))} disabled={busy} rows={6} /></label>
    <label>Anhänge (höchstens fünf, je 5 MB)<input type="file" multiple onChange={(event) => void addFiles(event.target.files)} disabled={busy} /></label>
    {attachments?.length ? <p>{attachments.map((item) => item.filename).join(", ")}</p> : null}
    <button type="button" disabled={busy} onClick={() => void draft()}>Entwurf speichern (ohne Versand)</button>
    {!preview && <button type="button" disabled={busy || !to || !subject || !body} onClick={() => setPreview(true)}>Versand prüfen</button>}
    {preview && <div role="group" aria-label="Versand bestätigen"><p>Von {from} an {to}</p><p>{subject}</p><pre>{body}</pre>
      <button type="button" disabled={busy} onClick={() => void send()}>Genau diese E-Mail senden</button>
      <button type="button" disabled={busy} onClick={() => setPreview(false)}>Zurück</button></div>}
    <button type="button" disabled={busy} onClick={onClose}>Schließen</button>
    {result && <p role="status">{result}</p>}
    {receiptId && <p>Versandbeleg: {receiptId.slice(0, 12)}…</p>}
    {receiptId && sendState === "uncertain" && <button type="button" disabled={busy} onClick={() => void review()}>Gesendet-Ordner prüfen (ohne Versand)</button>}
    {receiptId && sendState === "sent" && archivePending && sentRequest &&
      <button type="button" disabled={busy} onClick={() => void archive()}>Nur Gesendet-Kopie ergänzen</button>}
  </section>;
}
