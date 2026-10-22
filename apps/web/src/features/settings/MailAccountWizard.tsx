"use client";

import type { MailAccount, MailAccountWrite, MailAccountsResponse, MailConnectionTestRequest } from "@friday/sdk";
import { isFridayApiError } from "@friday/sdk";
import { useState } from "react";
import { call } from "@/lib/api/call";
import { getApiClient } from "@/lib/api/client";
import { detectMailPreset, type MailServerPreset } from "./mailPresets";

type StepId = "address" | "sender" | "servers" | "auth" | "test" | "folders" | "summary";
type Protocol = "imap" | "smtp";
type CheckOutcome = "idle" | "running" | "ok" | "failed" | "unavailable";

interface Step {
  id: StepId;
  label: string;
}

const STEPS: readonly Step[] = [
  { id: "address", label: "Adresse" },
  { id: "sender", label: "Absendername" },
  { id: "servers", label: "Server" },
  { id: "auth", label: "Anmeldung" },
  { id: "test", label: "Verbindungen prüfen" },
  { id: "folders", label: "Ordner" },
  { id: "summary", label: "Zusammenfassung" },
];

const HOST = /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;
const ADDRESS = /^[^\s@]+@[^\s@]+$/;

interface Draft {
  email: string;
  displayName: string;
  senderName: string;
  aliases: string;
  imapHost: string;
  imapPort: string;
  imapSecurity: "tls" | "start-tls";
  imapLogin: string;
  smtpHost: string;
  smtpPort: string;
  smtpSecurity: "tls" | "start-tls";
  smtpLogin: string;
  imapPassword: string;
  smtpPassword: string;
  samePassword: boolean;
  sentFolder: string;
  draftsFolder: string;
  trashFolder: string;
  archiveFolder: string;
  spamFolder: string;
  makeDefault: boolean;
}

const emptyDraft: Draft = {
  email: "", displayName: "", senderName: "", aliases: "",
  imapHost: "", imapPort: "993", imapSecurity: "tls", imapLogin: "",
  smtpHost: "", smtpPort: "587", smtpSecurity: "start-tls", smtpLogin: "",
  imapPassword: "", smtpPassword: "", samePassword: true,
  sentFolder: "Sent", draftsFolder: "Drafts", trashFolder: "Trash", archiveFolder: "Archive", spamFolder: "Spam",
  makeDefault: true,
};

interface CheckState {
  outcome: CheckOutcome;
  text: string;
}

const idleCheck: CheckState = { outcome: "idle", text: "" };

function reasonText(protocol: Protocol, reason: "auth" | "tls" | "network" | "protocol"): string {
  const name = protocol === "imap" ? "IMAP" : "SMTP";
  if (reason === "auth") return `${name}: Anmeldung abgelehnt. Prüfe Benutzername und Passwort; viele Anbieter verlangen ein App-Passwort.`;
  if (reason === "tls") return `${name}: TLS-Verhandlung fehlgeschlagen. Prüfe Verschlüsselung und Port (993 bzw. 465 für TLS, 587 für STARTTLS).`;
  if (reason === "network") return `${name}: Server nicht erreichbar. Prüfe Host, Port und die Netzwerkverbindung.`;
  return `${name}: Der Server hat unerwartet geantwortet. Prüfe die Einrichtung beim Anbieter.`;
}

function validPort(value: string): boolean {
  const port = Number(value);
  return Number.isSafeInteger(port) && port >= 1 && port <= 65535;
}

/** Geführte Einrichtung eines IMAP/SMTP-Postfachs nach PLAN DASH-05.03; speichert erst im letzten Schritt. */
export function MailAccountWizard({ onCreated }: { onCreated?: (account: MailAccount) => void } = {}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [preset, setPreset] = useState<MailServerPreset | null>(null);
  const [manual, setManual] = useState(false);
  const [checks, setChecks] = useState<Record<Protocol, CheckState>>({ imap: idleCheck, smtp: idleCheck });
  const [skipChecks, setSkipChecks] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [created, setCreated] = useState(false);

  const step = STEPS[stepIndex]!;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((old) => ({ ...old, [key]: value }));
    setChecks({ imap: idleCheck, smtp: idleCheck });
    setSkipChecks(false);
    setCreated(false);
    setMessage("");
  };

  function adoptAddress(address: string) {
    const found = detectMailPreset(address);
    setPreset(found);
    setDraft((old) => found
      ? { ...old, email: address, imapHost: found.imapHost, imapPort: String(found.imapPort), imapSecurity: found.imapSecurity,
        imapLogin: address.trim(), smtpHost: found.smtpHost, smtpPort: String(found.smtpPort),
        smtpSecurity: found.smtpSecurity, smtpLogin: address.trim() }
      : { ...old, email: address, imapLogin: address.trim(), smtpLogin: address.trim() });
    setChecks({ imap: idleCheck, smtp: idleCheck });
    setSkipChecks(false);
    setCreated(false);
    setMessage("");
  }

  const addressOk = ADDRESS.test(draft.email.trim());
  const nameOk = draft.displayName.trim().length > 0 && draft.senderName.trim().length > 0 && draft.email.trim().length > 0;
  const serversOk = HOST.test(draft.imapHost.trim()) && validPort(draft.imapPort)
    && HOST.test(draft.smtpHost.trim()) && validPort(draft.smtpPort)
    && draft.imapLogin.trim().length > 0 && draft.smtpLogin.trim().length > 0;
  const authOk = draft.imapPassword.length > 0 && (draft.samePassword || draft.smtpPassword.length > 0);
  const testsOk = (checks.imap.outcome === "ok" && checks.smtp.outcome === "ok")
    || (skipChecks && checks.imap.outcome === "unavailable" && checks.smtp.outcome === "unavailable");
  const foldersOk = draft.sentFolder.trim().length > 0;
  const stepOk: Record<StepId, boolean> = {
    address: addressOk, sender: nameOk, servers: serversOk, auth: authOk, test: testsOk, folders: foldersOk, summary: true,
  };

  async function runCheck(protocol: Protocol) {
    const body: MailConnectionTestRequest = protocol === "imap"
      ? { protocol, host: draft.imapHost.trim(), port: Number(draft.imapPort), security: draft.imapSecurity,
        username: draft.imapLogin.trim(), password: draft.imapPassword }
      : { protocol, host: draft.smtpHost.trim(), port: Number(draft.smtpPort), security: draft.smtpSecurity,
        username: draft.smtpLogin.trim(), password: draft.samePassword ? draft.imapPassword : draft.smtpPassword };
    setChecks((old) => ({ ...old, [protocol]: { outcome: "running", text: "Verbindung wird geprüft …" } }));
    try {
      const response = await call(getApiClient().POST("/api/v1/settings/mail-connection-test", { body }));
      const { ok, reason } = response.data;
      setChecks((old) => ({ ...old, [protocol]: ok
        ? { outcome: "ok", text: `${protocol === "imap" ? "IMAP" : "SMTP"}: Verbindung und Anmeldung bestätigt. Es wurde keine E-Mail gesendet.` }
        : { outcome: "failed", text: reasonText(protocol, reason === "ok" ? "protocol" : reason) } }));
    } catch (error) {
      if (isFridayApiError(error) && error.code === "ADAPTER_UNAVAILABLE") {
        setChecks((old) => ({ ...old, [protocol]: { outcome: "unavailable",
          text: "Die Verbindungsprüfung ist nur in der installierten F.R.I.D.A.Y.-Umgebung verfügbar. Hier wurde nichts geprüft." } }));
        return;
      }
      setChecks((old) => ({ ...old, [protocol]: { outcome: "failed",
        text: error instanceof Error ? error.message : "Prüfung fehlgeschlagen." } }));
    }
  }

  async function apply() {
    setBusy(true);
    setMessage("");
    const aliases = draft.aliases.split(",").map((value) => value.trim()).filter(Boolean);
    const body: MailAccountWrite = {
      displayName: draft.displayName.trim(), email: draft.email.trim(), senderName: draft.senderName.trim(),
      aliases, signature: "", imapHost: draft.imapHost.trim(), imapPort: Number(draft.imapPort),
      imapSecurity: draft.imapSecurity, imapLogin: draft.imapLogin.trim(), smtpHost: draft.smtpHost.trim(),
      smtpPort: Number(draft.smtpPort), smtpSecurity: draft.smtpSecurity, smtpLogin: draft.smtpLogin.trim(),
      sentFolder: draft.sentFolder.trim(), draftsFolder: draft.draftsFolder.trim(), trashFolder: draft.trashFolder.trim(),
      archiveFolder: draft.archiveFolder.trim(), spamFolder: draft.spamFolder.trim(), authMode: "password",
      secrets: { imapPassword: draft.imapPassword, smtpPassword: draft.samePassword ? draft.imapPassword : draft.smtpPassword },
    };
    try {
      const response = await call(getApiClient().POST("/api/v1/integrations/mail/accounts", { body }));
      if (draft.makeDefault) {
        try {
          const catalog = await call<MailAccountsResponse>(getApiClient().GET("/api/v1/integrations/mail/accounts"));
          await call(getApiClient().POST("/api/v1/integrations/mail/accounts/{accountId}/default", {
            params: { path: { accountId: response.data.id } }, headers: { "If-Match": String(catalog.data.revision) },
          }));
        } catch (error) {
          setMessage(`Postfach angelegt, aber nicht als Standard gesetzt: ${error instanceof Error ? error.message : "unbekannter Fehler"}`);
          setCreated(true);
          onCreated?.(response.data);
          return;
        }
      }
      setCreated(true);
      setMessage("Postfach angelegt. Die Zugangsdaten sind gespeichert und werden nicht zurückgegeben.");
      onCreated?.(response.data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Postfach konnte nicht angelegt werden.");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setDraft(emptyDraft);
    setPreset(null);
    setManual(false);
    setChecks({ imap: idleCheck, smtp: idleCheck });
    setSkipChecks(false);
    setStepIndex(0);
    setCreated(false);
    setMessage("");
  }

  const field = (id: string, label: string, value: string, onChange: (value: string) => void, options: { type?: string; hint?: string } = {}) =>
    <div key={id} className="st-wizard__field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type={options.type ?? "text"} value={value} autoComplete="off"
        aria-describedby={options.hint ? `${id}-hint` : undefined}
        onChange={(event) => onChange(event.target.value)} disabled={busy} />
      {options.hint ? <span id={`${id}-hint`} className="mk-note">{options.hint}</span> : null}
    </div>;

  const checkRow = (protocol: Protocol) => <li key={protocol}>
    <span>{protocol === "imap" ? "IMAP (Posteingang)" : "SMTP (Versand)"}</span>
    <button type="button" disabled={busy || checks[protocol].outcome === "running"}
      onClick={() => void runCheck(protocol)}>
      {protocol === "imap" ? "IMAP-Verbindung prüfen" : "SMTP-Verbindung prüfen"}
    </button>
    <span role={checks[protocol].outcome === "failed" ? "alert" : "status"}>{checks[protocol].text}</span>
  </li>;

  return <section aria-label="Postfach einrichten" className="st-wizard">
    <h3>Neues Postfach einrichten</h3>
    <p>Der Assistent speichert erst im letzten Schritt. Verbindungsprüfungen senden keine E-Mail.</p>
    <ol className="st-wizard__steps">
      {STEPS.map((entry, index) => <li key={entry.id} aria-current={index === stepIndex ? "step" : undefined}>
        <span>{index + 1}. {entry.label}</span>
      </li>)}
    </ol>

    <fieldset>
      <legend>Schritt {stepIndex + 1} von {STEPS.length}: {step.label}</legend>

      {step.id === "address" && <>
        {field("mail-wizard-email", "E-Mail-Adresse", draft.email,
          (value) => { adoptAddress(value); }, { type: "email", hint: "Aus der Adresse werden bekannte Servervorschläge abgeleitet; unbekannte Domains werden nicht geraten." })}
        {preset ? <p role="status">Erkannt: {preset.label}. Die Serverwerte werden im nächsten Schritt vorgeschlagen und sind dort änderbar.</p>
          : draft.email.trim().length > 0 && !addressOk ? <p role="alert">Bitte eine vollständige E-Mail-Adresse angeben.</p>
            : draft.email.trim().length > 0 ? <p role="status">Kein Vorschlag für diese Domain. Die Server trägst du im nächsten Schritt aus der Anleitung deines Anbieters ein.</p>
              : null}
      </>}

      {step.id === "sender" && <>
        {field("mail-wizard-name", "Kontoname", draft.displayName, (value) => set("displayName", value), { hint: "Zum Beispiel „Geschäftliches Postfach“; der Name unterscheidet mehrere Konten." })}
        {field("mail-wizard-sender", "Absendername", draft.senderName, (value) => set("senderName", value), { hint: "Dieser Name erscheint bei Empfängern." })}
        {field("mail-wizard-aliases", "Alias-Adressen (kommagetrennt, optional)", draft.aliases, (value) => set("aliases", value))}
        {!nameOk ? <p role="alert">Kontoname und Absendername dürfen nicht leer sein.</p> : null}
      </>}

      {step.id === "servers" && <>
        <p>{preset ? `Vorschlag für ${preset.label}. Alle Werte sind änderbar.` : "Manuelle Einrichtung: trage die Server aus der Anleitung deines Anbieters ein."}</p>
        {preset?.hint ? <p className="mk-note">{preset.hint}</p> : null}
        {field("mail-wizard-imap-host", "IMAP-Server", draft.imapHost, (value) => set("imapHost", value))}
        {field("mail-wizard-imap-port", "IMAP-Port", draft.imapPort, (value) => set("imapPort", value), { type: "number" })}
        <label htmlFor="mail-wizard-imap-security">IMAP-Verschlüsselung
          <select id="mail-wizard-imap-security" value={draft.imapSecurity} disabled={busy}
            onChange={(event) => set("imapSecurity", event.target.value as Draft["imapSecurity"])}>
            <option value="tls">TLS (meist Port 993)</option>
            <option value="start-tls">STARTTLS (meist Port 143)</option>
          </select>
        </label>
        {field("mail-wizard-smtp-host", "SMTP-Server", draft.smtpHost, (value) => set("smtpHost", value))}
        {field("mail-wizard-smtp-port", "SMTP-Port", draft.smtpPort, (value) => set("smtpPort", value), { type: "number" })}
        <label htmlFor="mail-wizard-smtp-security">SMTP-Verschlüsselung
          <select id="mail-wizard-smtp-security" value={draft.smtpSecurity} disabled={busy}
            onChange={(event) => set("smtpSecurity", event.target.value as Draft["smtpSecurity"])}>
            <option value="start-tls">STARTTLS (meist Port 587)</option>
            <option value="tls">TLS (meist Port 465)</option>
          </select>
        </label>
        <label htmlFor="mail-wizard-manual">
          <input id="mail-wizard-manual" type="checkbox" checked={manual} onChange={(event) => setManual(event.target.checked)} />
          Erweiterte manuelle Einrichtung: ich prüfe Host, Port und Verschlüsselung selbst gegen die Anleitung des Anbieters.
        </label>
        {!serversOk ? <p role="alert">Host und Port müssen gültig sein; Anmeldungen dürfen nicht leer sein.</p> : null}
      </>}

      {step.id === "auth" && <>
        <p>Für neue Konten wird ein Passwort oder App-Passwort benötigt. Das Passwort wird gespeichert und nie zurückgegeben.</p>
        {field("mail-wizard-imap-login", "Benutzername IMAP", draft.imapLogin, (value) => set("imapLogin", value))}
        {field("mail-wizard-imap-password", "Passwort / App-Passwort", draft.imapPassword, (value) => set("imapPassword", value), { type: "password" })}
        <label htmlFor="mail-wizard-same">
          <input id="mail-wizard-same" type="checkbox" checked={draft.samePassword}
            onChange={(event) => set("samePassword", event.target.checked)} />
          Gleiches Passwort für den Versand (SMTP)
        </label>
        {!draft.samePassword && <>
          {field("mail-wizard-smtp-login", "Benutzername SMTP", draft.smtpLogin, (value) => set("smtpLogin", value))}
          {field("mail-wizard-smtp-password", "Passwort SMTP", draft.smtpPassword, (value) => set("smtpPassword", value), { type: "password" })}
        </>}
        {!authOk ? <p role="alert">Ohne Passwort kann kein Postfach angelegt werden.</p> : null}
        <p className="mk-note">OAuth für Gmail und Microsoft wird unter „Erweitert“ an einem bestehenden Konto eingerichtet.</p>
      </>}

      {step.id === "test" && <>
        <p>Beide Verbindungen werden getrennt geprüft. Der SMTP-Test baut nur eine Verbindung auf und sendet keine Nachricht.</p>
        <ul className="st-wizard__checks">{checkRow("imap")}{checkRow("smtp")}</ul>
        {checks.imap.outcome === "unavailable" || checks.smtp.outcome === "unavailable" ? <>
          <label htmlFor="mail-wizard-skip">
            <input id="mail-wizard-skip" type="checkbox" checked={skipChecks}
              onChange={(event) => setSkipChecks(event.target.checked)} />
            Ohne Prüfung fortfahren (Umgebung ohne Postfach-Brücke)
          </label>
          <p className="mk-note">Die Verbindung ist dann ungeprüft; nach dem Anlegen kannst du sie im Konto erneut prüfen.</p>
        </> : null}
        {!testsOk ? <p role="alert">Beide Verbindungen müssen bestätigt sein, bevor es weitergeht.</p> : null}
      </>}

      {step.id === "folders" && <>
        <p>Ordnerzuordnung des Anbieters. Die Namen sind Vorschläge und müssen zum Postfach passen; nach dem Speichern lassen sie sich mit der echten Ordnerliste abgleichen.</p>
        {field("mail-wizard-sent", "Gesendet-Ordner", draft.sentFolder, (value) => set("sentFolder", value))}
        {field("mail-wizard-drafts", "Entwürfe-Ordner", draft.draftsFolder, (value) => set("draftsFolder", value))}
        {field("mail-wizard-trash", "Papierkorb-Ordner", draft.trashFolder, (value) => set("trashFolder", value))}
        {field("mail-wizard-archive", "Archiv-Ordner", draft.archiveFolder, (value) => set("archiveFolder", value))}
        {field("mail-wizard-spam", "Spam-Ordner", draft.spamFolder, (value) => set("spamFolder", value))}
        <label htmlFor="mail-wizard-default">
          <input id="mail-wizard-default" type="checkbox" checked={draft.makeDefault}
            onChange={(event) => set("makeDefault", event.target.checked)} />
          Dieses Konto als Standard für neue Nachrichten verwenden
        </label>
        {!foldersOk ? <p role="alert">Der Gesendet-Ordner darf nicht leer sein; sonst landet keine Sent-Kopie.</p> : null}
      </>}

      {step.id === "summary" && <div className="st-wizard__summary">
        <dl>
          <dt>Adresse</dt><dd>{draft.email.trim()}</dd>
          <dt>Kontoname</dt><dd>{draft.displayName.trim()}</dd>
          <dt>Absendername</dt><dd>{draft.senderName.trim()}</dd>
          <dt>Aliase</dt><dd>{draft.aliases.trim() || "keine"}</dd>
          <dt>IMAP</dt><dd>{draft.imapHost.trim()}:{draft.imapPort} ({draft.imapSecurity === "tls" ? "TLS" : "STARTTLS"}), Anmeldung {draft.imapLogin.trim()}</dd>
          <dt>SMTP</dt><dd>{draft.smtpHost.trim()}:{draft.smtpPort} ({draft.smtpSecurity === "tls" ? "TLS" : "STARTTLS"}), Anmeldung {draft.smtpLogin.trim()}</dd>
          <dt>Passwort</dt><dd>{draft.samePassword ? "für IMAP und SMTP gespeichert" : "getrennt für IMAP und SMTP gespeichert"}</dd>
          <dt>Ordner</dt><dd>Gesendet {draft.sentFolder.trim()}, Entwürfe {draft.draftsFolder.trim() || "–"}, Papierkorb {draft.trashFolder.trim() || "–"}</dd>
          <dt>Standardkonto</dt><dd>{draft.makeDefault ? "ja, für neue Nachrichten" : "nein"}</dd>
          <dt>Verbindungen</dt><dd>{checks.imap.outcome === "ok" && checks.smtp.outcome === "ok" ? "IMAP und SMTP geprüft"
            : "ungeprüft fortgefahren"}</dd>
        </dl>
        <button type="button" disabled={busy} onClick={() => void apply()}>Postfach übernehmen</button>
        <button type="button" disabled={busy} onClick={reset}>Zurücksetzen</button>
      </div>}
    </fieldset>

    {message ? <p role={created ? "status" : "alert"}>{message}</p> : null}

    <div className="st-wizard__nav">
      <button type="button" disabled={stepIndex === 0 || busy}
        onClick={() => setStepIndex((index) => Math.max(0, index - 1))}>Zurück</button>
      <button type="button" disabled={!stepOk[step.id] || busy || step.id === "summary"}
        onClick={() => setStepIndex((index) => Math.min(STEPS.length - 1, index + 1))}>Weiter</button>
    </div>
  </section>;
}