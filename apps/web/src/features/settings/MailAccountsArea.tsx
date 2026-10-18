"use client";

import { useQuery } from "@tanstack/react-query";
import type { MailAccount, MailAccountWrite, MailAccountsResponse } from "@friday/sdk";
import { useEffect, useState } from "react";
import { call } from "@/lib/api/call";
import { getApiClient } from "@/lib/api/client";

const blank: MailAccountWrite = {
  displayName: "Mail Postfach", email: "", senderName: "", aliases: [], signature: "",
  imapHost: "", imapPort: 993, imapSecurity: "tls", imapLogin: "",
  smtpHost: "", smtpPort: 587, smtpSecurity: "start-tls", smtpLogin: "",
  sentFolder: "Sent", draftsFolder: "Drafts", trashFolder: "Trash", archiveFolder: "Archive", spamFolder: "Spam",
  authMode: "password", oauthClientId: "", oauthTenant: "",
};

function fromAccount(account: MailAccount): MailAccountWrite {
  const { id: _id, revision: _revision, secretState: _secretState, ...values } = account;
  return values;
}

export function MailAccountsArea({ owner }: { owner: boolean }) {
  const query = useQuery({ queryKey: ["mail-accounts"], queryFn: (): Promise<MailAccountsResponse> => call(getApiClient().GET("/api/v1/integrations/mail/accounts")), enabled: owner });
  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState<MailAccountWrite>(blank);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [check, setCheck] = useState("");
  const [dirty, setDirty] = useState(false);
  const [oauthFlow, setOAuthFlow] = useState<{ accountId: string; flowId: string; authorizationUrl: string | null; verificationUri: string | null; userCode: string | null } | null>(null);
  const accounts = query.data?.data.accounts ?? [];
  const current = accounts.find((item) => item.id === selected);
  useEffect(() => { if (current && !dirty) setForm(fromAccount(current)); }, [current, dirty]);
  const set = <K extends keyof MailAccountWrite>(key: K, value: MailAccountWrite[K]) => { setDirty(true); setCheck(""); setForm((old) => ({ ...old, [key]: value })); };
  const text = (key: keyof MailAccountWrite, label: string, type = "text") =>
    <label key={key}>{label}<input type={type} autoComplete="off" value={String(form[key] ?? "")}
      onChange={(event) => set(key, (type === "number" ? Number(event.target.value) : event.target.value) as never)} disabled={busy} /></label>;
  const run = async (operation: () => Promise<unknown>, success: string) => {
    setBusy(true); setMessage("");
    try { await operation(); await query.refetch(); setDirty(false); setForm((old) => ({ ...old, secrets: undefined })); setMessage(success); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Aktion fehlgeschlagen."); }
    finally { setBusy(false); }
  };
  if (!owner) return null;
  return <section aria-label="Mail Postfach Konten">
    <h3>Mail Postfach</h3>
    <p>Mehrere IMAP-/SMTP-Konten; Zugangsdaten werden getrennt gespeichert und nie zurückgegeben. Prüfung sendet keine E-Mail.</p>
    {query.isError && <p role="alert">Konten konnten nicht geladen werden.</p>}
    <label>Konto<select value={selected ?? ""} onChange={(event) => { const id = event.target.value || null; setSelected(id); const found = accounts.find((item) => item.id === id); setForm(found ? fromAccount(found) : blank); setDirty(false); setCheck(""); setOAuthFlow(null); }}>
      <option value="">Neues Konto</option>{accounts.map((item) => <option key={item.id} value={item.id}>{item.displayName} · {item.email}</option>)}
    </select></label>
    {current && <p>Revision {current.revision}; {current.authMode === "password" ? `IMAP-Passwort ${current.secretState.imapPassword ? "vorhanden" : "fehlt"}; SMTP-Passwort ${current.secretState.smtpPassword ? "vorhanden" : "fehlt"}` : `OAuth ${current.secretState.oauthRefreshToken ? "autorisiert; IMAP/SMTP noch separat prüfen" : "nicht autorisiert"}`}. {query.data?.data.defaultAccountId === current.id ? "Standardkonto." : ""}</p>}
    <form onSubmit={(event) => { event.preventDefault(); void run(async () => {
      if (current) return call(getApiClient().PUT("/api/v1/integrations/mail/accounts/{accountId}", { params: { path: { accountId: current.id }, header: { "If-Match": String(current.revision) } }, body: form }));
      return call(getApiClient().POST("/api/v1/integrations/mail/accounts", { body: form }));
    }, "Konto gespeichert. Verbindung noch nicht geprüft."); }}>
      <div className="st-grid">
        {text("displayName", "Name")}{text("email", "Adresse", "email")}{text("senderName", "Absendername")}
        <label>Anmeldung<select value={form.authMode ?? "password"} onChange={(event) => {
          const mode = event.target.value as "password" | "google-oauth" | "microsoft-oauth";
          const hosts = mode === "google-oauth" ? { imapHost: "imap.gmail.com", imapPort: 993, imapSecurity: "tls" as const,
            smtpHost: "smtp.gmail.com", smtpPort: 465, smtpSecurity: "tls" as const } : mode === "microsoft-oauth" ?
            { imapHost: "outlook.office365.com", imapPort: 993, imapSecurity: "tls" as const,
              smtpHost: "smtp.office365.com", smtpPort: 587, smtpSecurity: "start-tls" as const } : {};
          setDirty(true); setForm((old) => ({ ...old, ...hosts, authMode: mode, oauthTenant: mode === "microsoft-oauth" ? "common" : "" }));
        }} disabled={busy}><option value="password">Passwort / App-Passwort</option><option value="google-oauth">Google OAuth</option><option value="microsoft-oauth">Microsoft OAuth</option></select></label>
        {form.authMode !== "password" && <>
          {text("oauthClientId", "Registrierte OAuth Client-ID")}
          {form.authMode === "microsoft-oauth" && text("oauthTenant", "Microsoft Tenant (common, organizations, consumers oder ID)")}
          <p>Google: <a href="https://developers.google.com/identity/protocols/oauth2/native-app" target="_blank" rel="noreferrer">Desktop-Client registrieren</a>, Gmail-Berechtigung https://mail.google.com/ freigeben und ggf. Testnutzer zulassen. Microsoft: <a href="https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code" target="_blank" rel="noreferrer">Public Client und Gerätecode-Flow</a> erlauben; delegated IMAP.AccessAsUser.All und SMTP.Send eintragen. Client-Secrets hier nicht eingeben.</p>
        </>}
        <label>Aliasse (Komma getrennt)<input value={form.aliases.join(", ")} onChange={(event) => set("aliases", event.target.value.split(",").map((part) => part.trim()).filter(Boolean))} disabled={busy} /></label>
        <label>Signatur<textarea value={form.signature} onChange={(event) => set("signature", event.target.value)} disabled={busy} /></label>
        {text("imapHost", "IMAP Host")}{text("imapPort", "IMAP Port", "number")}{text("imapLogin", "IMAP Login")}
        <label>IMAP Sicherheit<select value={form.imapSecurity} onChange={(event) => set("imapSecurity", event.target.value as "tls" | "start-tls")}><option value="tls">TLS</option><option value="start-tls">STARTTLS</option></select></label>
        {text("smtpHost", "SMTP Host")}{text("smtpPort", "SMTP Port", "number")}{text("smtpLogin", "SMTP Login")}
        <label>SMTP Sicherheit<select value={form.smtpSecurity} onChange={(event) => set("smtpSecurity", event.target.value as "tls" | "start-tls")}><option value="tls">TLS</option><option value="start-tls">STARTTLS</option></select></label>
        {text("sentFolder", "Gesendet")}{text("draftsFolder", "Entwürfe")}{text("trashFolder", "Papierkorb")}{text("archiveFolder", "Archiv")}{text("spamFolder", "Spam")}
        {form.authMode === "password" && <>
        <label>IMAP Passwort / App-Passwort<input type="password" autoComplete="new-password" value={form.secrets?.imapPassword ?? ""} onChange={(event) => set("secrets", { ...form.secrets, imapPassword: event.target.value || undefined })} disabled={busy} /></label>
        <label>SMTP Passwort / App-Passwort<input type="password" autoComplete="new-password" value={form.secrets?.smtpPassword ?? ""} onChange={(event) => set("secrets", { ...form.secrets, smtpPassword: event.target.value || undefined })} disabled={busy} /></label>
        {current?.secretState.imapPassword && <label><input type="checkbox" checked={form.secrets?.imapPassword === null}
          onChange={(event) => set("secrets", { ...form.secrets, imapPassword: event.target.checked ? null : undefined })} disabled={busy} />Gespeichertes IMAP Passwort entfernen</label>}
        {current?.secretState.smtpPassword && <label><input type="checkbox" checked={form.secrets?.smtpPassword === null}
          onChange={(event) => set("secrets", { ...form.secrets, smtpPassword: event.target.checked ? null : undefined })} disabled={busy} />Gespeichertes SMTP Passwort entfernen</label>}
        </>}
      </div>
      <button type="submit" disabled={busy}>Konto speichern</button>
    </form>
    {current && <div>
      {current.authMode !== "password" && <>
        <button type="button" disabled={busy || dirty} onClick={() => void run(async () => {
          const started = await call(getApiClient().POST("/api/v1/integrations/mail/accounts/{accountId}/oauth/start", { params: { path: { accountId: current.id } } }));
          setOAuthFlow({ accountId: current.id, flowId: started.data.flowId, authorizationUrl: started.data.authorizationUrl,
            verificationUri: started.data.verificationUri, userCode: started.data.userCode });
        }, "Autorisierung gestartet. Nach dem Login Kontostatus neu laden.")}>OAuth verbinden</button>
        {current.secretState.oauthRefreshToken && <button type="button" disabled={busy} onClick={() => void run(async () => {
          await call(getApiClient().POST("/api/v1/integrations/mail/accounts/{accountId}/oauth/revoke", { params: { path: { accountId: current.id }, header: { "If-Match": String(current.revision) } } }));
        }, "Lokales OAuth-Token entfernt. Provider-Einwilligung bei Google oder Microsoft separat widerrufen.")}>Lokales OAuth-Token entfernen</button>}
        {oauthFlow?.accountId === current.id && oauthFlow.authorizationUrl && <p>Google: <a href={oauthFlow.authorizationUrl} target="_blank" rel="noreferrer">Autorisierung öffnen</a>. Nach dem Rückruf den Kontostatus neu laden.</p>}
        {oauthFlow?.accountId === current.id && oauthFlow.verificationUri && <p>Microsoft: <a href={oauthFlow.verificationUri} target="_blank" rel="noreferrer">Anmeldeseite öffnen</a> und Code <strong>{oauthFlow.userCode}</strong> eingeben.
          <button type="button" disabled={busy} onClick={() => void run(async () => {
            const result = await call(getApiClient().POST("/api/v1/integrations/mail/accounts/{accountId}/oauth/poll", { params: { path: { accountId: current.id } }, body: { flowId: oauthFlow.flowId } }));
            setCheck(result.data.authorized ? "OAuth-Autorisierung gespeichert. IMAP und SMTP separat prüfen." : "Freigabe noch ausstehend; später erneut prüfen.");
          }, "Autorisierungsstatus abgefragt.")}>Freigabe prüfen</button></p>}
        <button type="button" disabled={busy} onClick={() => void query.refetch()}>OAuth-Status neu laden</button>
      </>}
      <button type="button" disabled={busy} onClick={() => void run(async () => call(getApiClient().POST("/api/v1/integrations/mail/accounts/{accountId}/default", { params: { path: { accountId: current.id }, header: { "If-Match": String(query.data?.data.revision ?? 0) } } })), "Standardkonto geändert.")}>Als Standard</button>
      <button type="button" disabled={busy || dirty} onClick={() => void run(async () => { const result = await call(getApiClient().POST("/api/v1/integrations/mail/accounts/{accountId}/check", { params: { path: { accountId: current.id }, query: { protocol: "imap" } } })); setCheck(result.data.ok ? `IMAP authentifiziert; ${result.data.folders?.length ?? 0} Ordner gefunden.` : "IMAP fehlgeschlagen."); }, "IMAP geprüft; keine E-Mail gesendet.")}>IMAP prüfen</button>
      <button type="button" disabled={busy || dirty} onClick={() => void run(async () => { const result = await call(getApiClient().POST("/api/v1/integrations/mail/accounts/{accountId}/check", { params: { path: { accountId: current.id }, query: { protocol: "smtp" } } })); setCheck(result.data.ok ? "SMTP authentifiziert." : "SMTP fehlgeschlagen."); }, "SMTP geprüft; keine E-Mail gesendet.")}>SMTP prüfen</button>
      <button type="button" disabled={busy} onClick={() => { if (window.confirm(`Konto ${current.displayName} lokal entfernen?`)) void run(async () => { await call(getApiClient().DELETE("/api/v1/integrations/mail/accounts/{accountId}", { params: { path: { accountId: current.id }, header: { "If-Match": String(current.revision) } } })); setSelected(null); setForm(blank); }, "Konto lokal entfernt."); }}>Entfernen</button>
    </div>}
    {check && <p role="status">{check}</p>}{message && <p role="status">{message}</p>}
  </section>;
}
