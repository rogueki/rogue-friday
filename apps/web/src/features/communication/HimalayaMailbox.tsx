"use client";

import type { HimalayaEnvelopeListResponse, HimalayaMailboxListResponse, HimalayaMessageResponse } from "@friday/sdk";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { call } from "@/lib/api/call";
import { getApiClient } from "@/lib/api/client";
import { useSession } from "@/lib/session";
import { HimalayaCompose } from "./HimalayaCompose";

const KEY = ["himalaya-mail"] as const;

export function HimalayaMailbox() {
  const { role } = useSession();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [mailbox, setMailbox] = useState<string | null>(null);
  const [messageId, setMessageId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  useEffect(() => {
    if (role !== "owner") client.removeQueries({ queryKey: KEY });
  }, [client, role]);
  const folders = useQuery({
    queryKey: [...KEY, "mailboxes"], enabled: role === "owner" && open,
    queryFn: (): Promise<HimalayaMailboxListResponse> => call(getApiClient().GET("/api/v1/communication/himalaya/mailboxes")),
    retry: false,
  });
  const envelopes = useQuery({
    queryKey: [...KEY, "envelopes", mailbox, page], enabled: role === "owner" && open && Boolean(mailbox),
    queryFn: (): Promise<HimalayaEnvelopeListResponse> => call(getApiClient().GET("/api/v1/communication/himalaya/envelopes", {
      params: { query: { mailbox: mailbox ?? "", page } },
    })), retry: false,
  });
  const message = useQuery({
    queryKey: [...KEY, "message", mailbox, messageId], enabled: role === "owner" && open && Boolean(mailbox && messageId),
    queryFn: (): Promise<HimalayaMessageResponse> => call(getApiClient().GET("/api/v1/communication/himalaya/message", {
      params: { query: { mailbox: mailbox ?? "", id: messageId ?? "" } },
    })), retry: false,
  });
  if (role !== "owner") return null;
  function close() {
    setOpen(false);
    setMailbox(null);
    setMessageId(null);
    client.removeQueries({ queryKey: KEY });
  }
  return <section className="com-live-mail" aria-label="Live-Postfach über Himalaya">
    <h2>Live-Postfach (IMAP/SMTP)</h2>
    <p>Optionaler Zugriff auf das unter Einstellungen → Skill-Konten eingerichtete Friday-Postfach. Die Verbindung wird erst nach dem Öffnen geprüft. Lesen markiert Nachrichten nicht als gelesen; Textmails werden erst nach deiner Bestätigung gesendet.</p>
    {!open ? <button type="button" onClick={() => setOpen(true)}>Live-Postfach öffnen</button> : <>
      <button type="button" onClick={close}>Live-Postfach schließen</button>
      {folders.isPending && <p role="status">Postfach wird verbunden …</p>}
      {folders.isError && <p role="alert">Postfach nicht eingerichtet oder IMAP nicht erreichbar. Prüfe die Angaben unter Einstellungen → Skill-Konten.</p>}
      {folders.data && <div>
        <label>Ordner <select value={mailbox ?? ""} onChange={(event) => { setMailbox(event.target.value || null); setMessageId(null); setPage(1); }}>
          <option value="">Ordner auswählen</option>
          {folders.data.data.mailboxes.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
        </select></label>
        {folders.data.data.mailboxes.length === 0 && <p>Keine Ordner gefunden.</p>}
      </div>}
      {mailbox && envelopes.isPending && <p role="status">Nachrichten werden geladen …</p>}
      {mailbox && envelopes.isError && <p role="alert">Nachrichten konnten nicht geladen werden.</p>}
      {envelopes.data && <div>
        <ul>{envelopes.data.data.items.map((item) => <li key={item.id}>
          <button type="button" onClick={() => setMessageId(item.id)}>{item.subject || "(ohne Betreff)"} · {item.date || "Datum unbekannt"}</button>
        </li>)}</ul>
        {envelopes.data.data.items.length === 0 && <p>Keine Nachrichten in diesem Ordner.</p>}
        <button type="button" disabled={page <= 1} onClick={() => { setPage((old) => old - 1); setMessageId(null); }}>Vorherige Seite</button>
        <button type="button" disabled={page >= 20 || envelopes.data.data.items.length < 25} onClick={() => { setPage((old) => old + 1); setMessageId(null); }}>Nächste Seite</button>
      </div>}
      {messageId && message.isPending && <p role="status">Nachricht wird geladen …</p>}
      {messageId && message.isError && <p role="alert">Nachricht konnte nicht gelesen werden.</p>}
      {message.data && <article className="com-live-mail__message">
        <h3>{message.data.data.subject || "(ohne Betreff)"}</h3>
        <p>Von: {message.data.data.from}</p>
        <pre>{message.data.data.bodyText}</pre>
      </article>}
      <HimalayaCompose />
    </>}
  </section>;
}
