"use client";

import type { MailAccountsResponse, MailEnvelopesResponse, MailFolderResponse, MailMessageResponse, MailReceiptsResponse } from "@friday/sdk";
import { Button, EmptyState, HudPanel, Select, TextField } from "@friday/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Flag, Forward, Mail, MailPlus, Paperclip, Reply, ReplyAll, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { call } from "@/lib/api/call";
import { getApiClient } from "@/lib/api/client";
import { useSession } from "@/lib/session";
import { MailCompose } from "./MailCompose";

const KEY = ["mail-accounts"] as const;

export function HimalayaMailbox({ autoOpen = false }: { autoOpen?: boolean } = {}) {
  const { role } = useSession();
  const client = useQueryClient();
  const [open, setOpen] = useState(autoOpen);
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
  const folderItems = folders.data?.data.folders ?? [];
  // Nested IMAP folders may share a display name; the full folder id tells them apart.
  const folderLabel = (folder: (typeof folderItems)[number]) =>
    folderItems.filter((other) => other.name === folder.name).length > 1 ? folder.id : folder.name;
  const accountOptions = [
    { value: "", label: "Konto auswählen" },
    ...(accounts.data?.data.accounts.map((item) => ({ value: item.id, label: `${item.displayName} · ${item.email}` })) ?? []),
  ];
  const folderOptions = [
    { value: "", label: "Ordner auswählen" },
    ...folderItems.map((folder) => ({ value: folder.id, label: folderLabel(folder) })),
  ];
  const moveOptions = [
    { value: "", label: "Ordner wählen" },
    ...folderItems.filter((item) => item.id !== mailbox).map((item) => ({ value: item.id, label: folderLabel(item) })),
  ];
  const actions = open ? <>
    <Button size="sm" variant="ghost" onClick={() => { setOpen(false); chooseAccount(null); client.removeQueries({ queryKey: KEY }); }}>Schließen</Button>
    {selectedAccount && <Button size="sm" icon={<MailPlus size={14} />} onClick={() => setCompose("new")}>Neue E-Mail</Button>}
  </> : <Button size="sm" icon={<Mail size={14} />} onClick={() => setOpen(true)}>E-Mail Postfach öffnen</Button>;
  return <HudPanel title="E-Mail-Postfach" subtitle="Jedes Konto und jeder Ordner bleiben getrennt. Lesen markiert Nachrichten nicht als gelesen." icon={<Mail size={18} strokeWidth={1.5} />} className="com-live-mail" aria-label="E-Mail Postfach" actions={actions}>
    {open && <>
      {accounts.isPending && <p role="status">Konten werden geladen …</p>}
      {accounts.isError && <p role="alert" className="com-live-mail__alert">Konten nicht erreichbar. Einrichtung unter Einstellungen → Skill-Konten prüfen.</p>}
      {accounts.data && <div className="com-live-mail__pickers">
        <Select label="Konto" value={accountId ?? ""} onChange={(event) => chooseAccount(event.target.value || null)} options={accountOptions} />
        {folders.data && <Select label="Ordner" value={mailbox ?? ""} onChange={(event) => chooseFolder(event.target.value || null)} options={folderOptions} unknownLabel={() => "Ordner nicht mehr vorhanden"} />}
      </div>}
      {accounts.data && accounts.data.data.accounts.length === 0 && <EmptyState compact icon={<Mail size={22} strokeWidth={1.5} />} title="Kein Mail-Konto eingerichtet" description="Konten richtest du unter Einstellungen → Skill-Konten ein." action={<a className="jv-btn jv-btn--primary jv-btn--sm" href="/settings?area=skillAccounts#himalaya-account-title">Mail-Konto einrichten</a>} />}
      {receipts.data && receipts.data.data.items.some((item) => item.state !== "sent" || item.archivePending) &&
        <section aria-label="Offene Versandbelege"><h3>Offene Versandbelege</h3><ul>
          {receipts.data.data.items.filter((item) => item.state !== "sent" || item.archivePending).map((item) => <li key={item.receiptId}>
            {item.createdAt}: {item.state === "sent" ? "SMTP bestätigt, Gesendet-Kopie offen" : "Versand unklar"}.
            {item.state !== "sent" && <Button size="sm" variant="ghost" onClick={() => void reviewReceipt(item.receiptId)}>Gesendet-Ordner prüfen</Button>}
            {item.state === "sent" && item.archivePending && <span> Nur die ursprüngliche Nachricht kann als Sent-Kopie nachgetragen werden; im noch offenen Versanddialog prüfen oder beim Anbieter manuell archivieren.</span>}
          </li>)}
        </ul></section>}
      {accountId && folders.isError && <p role="alert" className="com-live-mail__alert">IMAP oder Ordnerliste nicht erreichbar.</p>}
      {folders.data && folderItems.length === 0 && <EmptyState compact title="Keine Ordner gefunden." />}
      {mailbox && envelopes.isError && <p role="alert" className="com-live-mail__alert">Nachrichten konnten nicht gelesen werden.</p>}
      {mailbox && <form className="com-live-mail__search" onSubmit={(event) => { event.preventDefault(); setSearchTerm(searchInput.trim()); setPage(1); setUid(null); }}>
        <TextField label="Nachrichten in diesem Ordner suchen" value={searchInput} maxLength={100}
          onChange={(event) => setSearchInput(event.target.value)} />
        <Button type="submit" size="sm" icon={<Search size={14} />}>Suchen</Button>
        {searchTerm && <Button type="button" size="sm" variant="ghost" icon={<X size={14} />} onClick={() => { setSearchInput(""); setSearchTerm(""); setPage(1); }}>Suche löschen</Button>}
      </form>}
      {envelopes.data && <div>
        <ul className="com-live-mail__list">{envelopes.data.data.items.map((item) => <li key={item.id}>
          <button type="button" className="com-live-mail__row" aria-current={uid === item.id ? "true" : undefined} onClick={() => { setUidValidity(envelopes.data.data.uidValidity); setUid(item.id); setCompose(null); }}>
            <strong>{item.subject || "(ohne Betreff)"}</strong>
            <span className="com-live-mail__from">{item.from}</span>
          </button>
        </li>)}</ul>
        {!envelopes.data.data.items.length && <EmptyState compact title="Keine Nachrichten." />}
        <div className="com-live-mail__paging">
          <Button size="sm" variant="ghost" icon={<ChevronLeft size={14} />} disabled={page <= 1} onClick={() => { setPage((old) => old - 1); setUid(null); }}>Vorherige Seite</Button>
          <Button size="sm" variant="ghost" icon={<ChevronRight size={14} />} disabled={envelopes.data.data.items.length < 25 || page >= 20} onClick={() => { setPage((old) => old + 1); setUid(null); }}>Nächste Seite</Button>
        </div>
      </div>}
      {uid && message.isError && <p role="alert" className="com-live-mail__alert">Nachricht nicht verfügbar oder Ordner-UIDVALIDITY geändert. Liste neu laden.</p>}
      {message.data && <article className="com-live-mail__message"><h3>{message.data.data.subject}</h3>
        <p>Von {message.data.data.from}</p><pre>{message.data.data.bodyText}</pre>
        {message.data.data.attachments.length > 0 && <ul aria-label="Anhänge">
          {message.data.data.attachments.map((item, index) => <li key={index}>
            <Button size="sm" variant="ghost" icon={<Paperclip size={14} />} onClick={() => void downloadAttachment(index)} disabled={item.size > 5 * 1024 * 1024}>
              {item.filename} ({item.size} Bytes) herunterladen</Button>
          </li>)}
        </ul>}
        <div className="com-live-mail__actions">
          <Button size="sm" variant="ghost" icon={<Reply size={14} />} onClick={() => setCompose("reply")}>Antworten</Button>
          <Button size="sm" variant="ghost" icon={<ReplyAll size={14} />} onClick={() => setCompose("reply-all")}>Allen antworten</Button>
          <Button size="sm" variant="ghost" icon={<Forward size={14} />} onClick={() => setCompose("forward")}>Weiterleiten</Button>
          <Button size="sm" variant="ghost" icon={<Flag size={14} />} onClick={() => void change("flag")}>Markieren</Button>
        </div>
        <Select label="Verschieben nach" defaultValue="" onChange={(event) => { if (event.target.value) void change("move", event.target.value); }} options={moveOptions} />
      </article>}
      {selectedAccount && compose && <MailCompose account={selectedAccount} original={compose === "new" ? undefined : message.data?.data} mode={compose} onClose={() => setCompose(null)} />}
      {actionStatus && <p role="status">{actionStatus}</p>}
    </>}
  </HudPanel>;
}
