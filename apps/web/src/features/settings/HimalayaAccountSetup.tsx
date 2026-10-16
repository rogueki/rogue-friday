"use client";

import type { HimalayaAccountPatch, HimalayaAccountResponse } from "@friday/sdk";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { call } from "@/lib/api/call";
import { getApiClient } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/queryKeys";

const empty: HimalayaAccountPatch = {
  email: "", displayName: "", imapHost: "", imapPort: 993, imapLogin: "", imapPassword: "",
  smtpHost: "", smtpPort: 587, smtpLogin: "", smtpPassword: "", smtpEncryption: "start-tls",
  sentFolder: "Sent", draftsFolder: "Drafts", trashFolder: "Trash",
};

export function HimalayaAccountSetup({ owner }: { owner: boolean }) {
  const client = useQueryClient();
  const [form, setForm] = useState<HimalayaAccountPatch>(empty);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const status = useQuery({
    queryKey: ["settings", "himalaya-account"],
    queryFn: (): Promise<HimalayaAccountResponse> => call(getApiClient().GET("/api/v1/settings/himalaya-account")),
    enabled: owner,
  });
  const field = (key: keyof HimalayaAccountPatch, label: string, type = "text") =>
    <label key={key}>{label} <input type={type} required min={type === "number" ? 1 : undefined} max={type === "number" ? 65535 : undefined} autoComplete="off" value={form[key]}
      onChange={(event) => setForm((old) => ({ ...old, [key]: type === "number" ? Number(event.target.value) : event.target.value }))} /></label>;

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!status.data) return;
    setBusy(true);
    setMessage("");
    try {
      const result: HimalayaAccountResponse = await call(getApiClient().PUT("/api/v1/settings/himalaya-account", {
        params: { header: { "If-Match": String(status.data.data.revision) } }, body: form,
      }));
      setForm((old) => ({ ...old, imapPassword: "", smtpPassword: "" }));
      await status.refetch();
      await client.invalidateQueries({ queryKey: queryKeys.skills });
      setMessage(result.data.readyForLocalUse
        ? "Profil lokal gespeichert; IMAP- und SMTP-Verbindung noch nicht geprüft."
        : "Profil lokal gespeichert. Himalaya-CLI fehlt; E-Mail ist noch nicht nutzbar.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Postfach konnte nicht gespeichert werden.");
    } finally { setBusy(false); }
  }

  return <section aria-labelledby="himalaya-account-title">
    <h3 id="himalaya-account-title">E-Mail-Postfach für Himalaya</h3>
    <p>Ein IMAP/SMTP-Postfach für Hermes. Gib Server und Ordnernamen deines Anbieters ein. Gerade der Gesendet-Ordner muss exakt stimmen; bei manchen Anbietern kann sonst eine Wiederholung eine E-Mail doppelt senden. Friday verwaltet ein Postfach namens <code>friday</code> und speichert Passwörter nur in Friday-Ubuntu. Eine vorhandene fremde Himalaya-Konfiguration wird nicht überschrieben. Es erfolgt beim Speichern keine Verbindung zum Anbieter.</p>
    <p>Diese Einrichtung verwendet IMAP und SMTP mit Passwort oder App-Passwort über TLS. Gmail benötigt ein App-Passwort statt des normalen Kontopassworts. Konten, die nur OAuth erlauben, etwa viele Microsoft-Postfächer, benötigen eine gesonderte Anmeldung und funktionieren mit diesem Formular nicht.</p>
    {!owner ? <p>Nur der Owner kann das Postfach einrichten.</p> : <>
      {status.isPending && <p role="status">Postfachstatus wird geladen.</p>}
      {status.isError && <p role="alert">Postfachstatus nicht erreichbar. <button type="button" onClick={() => void status.refetch()}>Erneut prüfen</button></p>}
      {status.data && <p role="status">{status.data.data.configPresent && !status.data.data.managed
        ? "Fremde Himalaya-Konfiguration vorhanden; Friday überschreibt sie nicht."
        : status.data.data.readyForLocalUse ? "Profil und CLI vorhanden; Anbieterzugriff nicht geprüft."
        : status.data.data.managed ? "Profil gespeichert, aber die Himalaya-CLI oder Zugangsdaten fehlen."
        : "Noch kein Friday-Postfach eingerichtet."} {status.data.data.cliInstalled ? "CLI erkannt." : "Himalaya-CLI fehlt in Friday-Ubuntu."}</p>}
      <form onSubmit={(event) => void save(event)}>
        {field("email", "E-Mail-Adresse", "email")}
        {field("displayName", "Anzeigename")}
        {field("imapHost", "IMAP-Server")}
        {field("imapPort", "IMAP-Port", "number")}
        {field("imapLogin", "IMAP-Benutzername")}
        {field("imapPassword", "IMAP-Passwort oder App-Passwort", "password")}
        {field("smtpHost", "SMTP-Server")}
        {field("smtpPort", "SMTP-Port", "number")}
        {field("smtpLogin", "SMTP-Benutzername")}
        {field("smtpPassword", "SMTP-Passwort oder App-Passwort", "password")}
        <label>SMTP-Verschlüsselung <select value={form.smtpEncryption} onChange={(event) => setForm((old) => ({ ...old, smtpEncryption: event.target.value as "tls" | "start-tls" }))}>
          <option value="start-tls">STARTTLS</option><option value="tls">TLS</option>
        </select></label>
        {field("sentFolder", "Gesendet-Ordner")}
        {field("draftsFolder", "Entwürfe-Ordner")}
        {field("trashFolder", "Papierkorb-Ordner")}
        <button type="submit" disabled={busy || !status.data || (status.data.data.configPresent && !status.data.data.managed)}>Postfach speichern</button>
      </form>
      {message && <p role="status">{message}</p>}
      <p>Erst nach Installation der Himalaya-CLI sowie getrennten Lese- und Sendeproben ist das Postfach praktisch geprüft. Senden kann Kosten oder andere Folgen auslösen.</p>
    </>}
  </section>;
}
