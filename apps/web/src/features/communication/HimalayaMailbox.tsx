"use client";

import type { MailAccountsResponse, MailEnvelopesResponse, MailFolderResponse, MailMessageResponse, MailReceiptsResponse } from "@friday/sdk";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { call } from "@/lib/api/call";
import { getApiClient } from "@/lib/api/client";
import { useSession } from "@/lib/session";
import { MailCompose } from "./MailCompose";

const KEY = ["mail-accounts"] as const;

export function HimalayaMailbox() {
  const { role } = useSession();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [mailbox, setMailbox] = useState<string | null>(null);
  const [uidValidity, setUidValidity] = useState<string | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [compose, setCompose] = useState<"new" | "reply" | "reply-all" | "forward" | null>(null);
  const [actionStatus, setActionStatus] = useState("");
  useEffect(() => { if (role !== "owner") client.removeQueries({ queryKey: KEY }); }, [client, role]);
  const accounts = useQuery({ queryKey: [...KEY, "list"], enabled: role === "owner" && open,
    queryFn: (): Promise<MailAccountsResponse> => call(getApiClient().GET("/api/v1/integrations/mail/accounts")), retry: false });
  const selectedAccount = accounts.data?.data.accounts.find((item) => item.id === accountId);
  const receipts = useQuery({ queryKey: [...KEY, accountId, "receipts"], enabled: Boolean(open && accountId),
    queryFn: (): Promise<MailReceiptsResponse> => call(getApiClient().GET("/api/v1/integrations/mail/accounts/{accountId}/receipts", {
      params: { path: { accountId: accountId! } },
    })), retry: false });
  const folders = useQuery({ queryKey: [...KEY, accountId, "folders"], enabled: Boolean(open && accountId),
    queryFn: (): Promise<MailFolderResponse> => call(getApiClient().GET("/api/v1/integrations/mail/accounts/{accountId}/folders", { params: { path: { accountId: accountId! } } })), retry: false });
  const envelopes = useQuery({ queryKey: [...KEY, accountId, mailbox, page, searchTerm, "envelopes"], enabled: Boolean(open && accountId && mailbox),
    queryFn: (): Promise<MailEnvelopesResponse> => searchTerm
      ? call(getApiClient().GET("/api/v1/integrations/mail/accounts/{accountId}/search", {
        params: { path: { accountId: accountId! }, query: { mailbox: mailbox!, q: searchTerm, page } },
      }))
      : call(getApiClient().GET("/api/v1/integrations/mail/accounts/{accountId}/envelopes", {
        params: { path: { accountId: accountId! }, query: { mailbox: mailbox!, page } },
      })), retry: false });
  const message = useQuery({ queryKey: [...KEY, accountId, mailbox, uidValidity, uid, "message"], enabled: Boolean(open && accountId && mailbox && uidValidity && uid),
    queryFn: (): Promise<MailMessageResponse> => call(getApiClient().GET("/api/v1/integrations/mail/accounts/{accountId}/message", {
      params: { path: { accountId: accountId! }, query: { mailbox: mailbox!, uid: uid!, uidValidity: uidValidity! } },
    })), retry: false });
  if (role !== "owner") return null;
  const chooseAccount = (id: string | null) => { setAccountId(id); setMailbox(null); setUidValidity(null); setUid(null); setPage(1); setSearchTerm(""); setSearchInput(""); setCompose(null); };
  const chooseFolder = (id: string | null) => { setMailbox(id); setUidValidity(null); setUid(null); setPage(1); setSearchTerm(""); setSearchInput(""); setCompose(null); };
  async function downloadAttachment(index: number) {
    if (!accountId || !mailbox || !uid || !uidValidity) return;
    setActionStatus("");
    try {
      const response = await call(getApiClient().GET("/api/v1/integrations/mail/accounts/{accountId}/attachment", {
        params: { path: { accountId }, query: { mailbox, uid, uidValidity, index } },
      }));
      const bytes = Uint8Array.from(atob(response.data.data), (character) => character.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: response.data.contentType }));
      const link = document.createElement("a");
      link.href = url;
      link.download = response.data.filename;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setActionStatus(error instanceof Error ? error.message : "Anhang konnte nicht geladen werden."); }
  }
  async function reviewReceipt(receiptId: string) {
    if (!accountId) return;
    try {
      const result = await call(getApiClient().POST("/api/v1/integrations/mail/accounts/{accountId}/receipts/{receiptId}/review", {
        params: { path: { accountId, receiptId } },
      }));
      setActionStatus(result.data.state === "sent" ? "Gesendet-Kopie bestätigt." :
        "Kein eindeutiger Nachweis im Gesendet-Ordner. Versand bleibt unklar; bitte beim Anbieter prüfen.");
      await receipts.refetch();
    } catch (error) { setActionStatus(error instanceof Error ? error.message : "Gesendet-Ordner nicht erreichbar."); }
  }
  async function change(kind: "move" | "flag", destination?: string) {
    if (!accountId || !mailbox || !uid || !uidValidity) return;
    setActionStatus("");
    try {
      await call(getApiClient().POST("/api/v1/integrations/mail/accounts/{accountId}/change", {
        params: { path: { accountId } }, body: { mailbox, uid, uidValidity, kind, destination },
      }));
      setActionStatus(kind === "move" ? "Nachricht verschoben." : "Nachricht markiert.");
      setUid(null);
      await client.invalidateQueries({ queryKey: [...KEY, accountId, mailbox] });
    } catch (error) { setActionStatus(error instanceof Error ? error.message : "Änderung nicht bestätigt."); }
  }
  return <section className="com-live-mail" aria-label="Mail Postfach">
    <h2>Mail Postfach (IMAP/SMTP)</h2>
    <p>Jedes Konto und jeder Ordner bleiben getrennt. Lesen markiert Nachrichten nicht als gelesen.</p>
    {!open ? <button type="button" onClick={() => setOpen(true)}>Mail Postfach öffnen</button> : <>
      <button type="button" onClick={() => { setOpen(false); chooseAccount(null); client.removeQueries({ queryKey: KEY }); }}>Schließen</button>
      {accounts.isPending && <p role="status">Konten werden geladen …</p>}
      {accounts.isError && <p role="alert">Konten nicht erreichbar. Einrichtung unter Einstellungen → Skill-Konten prüfen.</p>}
      {accounts.data && <label>Konto<select value={accountId ?? ""} onChange={(event) => chooseAccount(event.target.value || null)}>
        <option value="">Konto auswählen</option>{accounts.data.data.accounts.map((item) => <option key={item.id} value={item.id}>{item.displayName} · {item.email}</option>)}
      </select></label>}
      {accounts.data && accounts.data.data.accounts.length === 0 && <p>Kein Konto eingerichtet. Einstellungen → Skill-Konten öffnen.</p>}
      {selectedAccount && <button type="button" onClick={() => setCompose("new")}>Neue E-Mail</button>}
      {receipts.data && receipts.data.data.items.some((item) => item.state !== "sent" || item.archivePending) &&
        <section aria-label="Offene Versandbelege"><h3>Offene Versandbelege</h3><ul>
          {receipts.data.data.items.filter((item) => item.state !== "sent" || item.archivePending).map((item) => <li key={item.receiptId}>
            {item.createdAt}: {item.state === "sent" ? "SMTP bestätigt, Gesendet-Kopie offen" : "Versand unklar"}.
            {item.state !== "sent" && <button type="button" onClick={() => void reviewReceipt(item.receiptId)}>Gesendet-Ordner prüfen</button>}
            {item.state === "sent" && item.archivePending && <span> Nur die ursprüngliche Nachricht kann als Sent-Kopie nachgetragen werden; im noch offenen Versanddialog prüfen oder beim Anbieter manuell archivieren.</span>}
          </li>)}
        </ul></section>}
      {accountId && folders.isError && <p role="alert">IMAP oder Ordnerliste nicht erreichbar.</p>}
      {folders.data && <label>Ordner<select value={mailbox ?? ""} onChange={(event) => chooseFolder(event.target.value || null)}>
        <option value="">Ordner auswählen</option>{folders.data.data.folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
      </select></label>}
      {mailbox && envelopes.isError && <p role="alert">Nachrichten konnten nicht gelesen werden.</p>}
      {mailbox && <form onSubmit={(event) => { event.preventDefault(); setSearchTerm(searchInput.trim()); setPage(1); setUid(null); }}>
        <label>Nachrichten in diesem Ordner suchen<input value={searchInput} maxLength={100}
          onChange={(event) => setSearchInput(event.target.value)} /></label>
        <button type="submit">Suchen</button>
        {searchTerm && <button type="button" onClick={() => { setSearchInput(""); setSearchTerm(""); setPage(1); }}>Suche löschen</button>}
      </form>}
      {envelopes.data && <div>
        <ul>{envelopes.data.data.items.map((item) => <li key={item.id}><button type="button" onClick={() => { setUidValidity(envelopes.data.data.uidValidity); setUid(item.id); setCompose(null); }}>{item.subject || "(ohne Betreff)"} · {item.from}</button></li>)}</ul>
        {!envelopes.data.data.items.length && <p>Keine Nachrichten.</p>}
        <button type="button" disabled={page <= 1} onClick={() => { setPage((old) => old - 1); setUid(null); }}>Vorherige Seite</button>
        <button type="button" disabled={envelopes.data.data.items.length < 25 || page >= 20} onClick={() => { setPage((old) => old + 1); setUid(null); }}>Nächste Seite</button>
      </div>}
      {uid && message.isError && <p role="alert">Nachricht nicht verfügbar oder Ordner-UIDVALIDITY geändert. Liste neu laden.</p>}
      {message.data && <article className="com-live-mail__message"><h3>{message.data.data.subject}</h3>
        <p>Von {message.data.data.from}</p><pre>{message.data.data.bodyText}</pre>
        {message.data.data.attachments.length > 0 && <ul aria-label="Anhänge">
          {message.data.data.attachments.map((item, index) => <li key={index}>
            <button type="button" onClick={() => void downloadAttachment(index)} disabled={item.size > 5 * 1024 * 1024}>
              {item.filename} ({item.size} Bytes) herunterladen</button>
          </li>)}
        </ul>}
        <button type="button" onClick={() => setCompose("reply")}>Antworten</button>
        <button type="button" onClick={() => setCompose("reply-all")}>Allen antworten</button>
        <button type="button" onClick={() => setCompose("forward")}>Weiterleiten</button>
        <button type="button" onClick={() => void change("flag")}>Markieren</button>
        <label>Verschieben nach<select defaultValue="" onChange={(event) => { if (event.target.value) void change("move", event.target.value); }}><option value="">Ordner wählen</option>
          {folders.data?.data.folders.filter((item) => item.id !== mailbox).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
      </article>}
      {selectedAccount && compose && <MailCompose account={selectedAccount} original={compose === "new" ? undefined : message.data?.data} mode={compose} onClose={() => setCompose(null)} />}
      {actionStatus && <p role="status">{actionStatus}</p>}
    </>}
  </section>;
}
