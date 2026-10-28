/**
 * Erkannte Servervorschlaege fuer bekannte Anbieter (Stand 2026-10, vom Nutzer pruefbar).
 * Es wird ausschliesslich die Domain des Postfachs ausgewertet: keine Vermutung ueber unbekannte
 * Server, keine Ableitung aus Teilstrings, keine automatische Anmeldung.
 */
export interface MailServerPreset {
  /** Anzeigename des Anbieters. */
  label: string;
  imapHost: string;
  imapPort: number;
  imapSecurity: "tls" | "start-tls";
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: "tls" | "start-tls";
  /** Anbieterhinweis zur Anmeldung, z. B. App-Passwort. */
  hint: string;
}

const PRESETS: Record<string, MailServerPreset> = {
  "gmx.de": gmx(), "gmx.net": gmx(), "gmx.at": gmx(), "gmx.ch": gmx(),
  "web.de": {
    label: "WEB.DE", imapHost: "imap.web.de", imapPort: 993, imapSecurity: "tls",
    smtpHost: "smtp.web.de", smtpPort: 587, smtpSecurity: "start-tls",
    hint: "WEB.DE verlangt bei aktivierter Zwei-Faktor-Anmeldung ein App-Passwort.",
  },
  "gmail.com": gmail(), "googlemail.com": gmail(),
  "outlook.com": microsoft(), "outlook.de": microsoft(), "hotmail.com": microsoft(),
  "hotmail.de": microsoft(), "live.com": microsoft(), "live.de": microsoft(),
  "t-online.de": {
    label: "T-Online", imapHost: "secureimap.t-online.de", imapPort: 993, imapSecurity: "tls",
    smtpHost: "securesmtp.t-online.de", smtpPort: 587, smtpSecurity: "start-tls",
    hint: "T-Online verlangt ein eigenes E-Mail-Passwort, nicht das Zugangspasswort des Vertrags.",
  },
  "posteo.de": {
    label: "Posteo", imapHost: "posteo.de", imapPort: 993, imapSecurity: "tls",
    smtpHost: "posteo.de", smtpPort: 465, smtpSecurity: "tls",
    hint: "Posteo nutzt denselben Servernamen fuer IMAP und SMTP.",
  },
  "mailbox.org": {
    label: "mailbox.org", imapHost: "imap.mailbox.org", imapPort: 993, imapSecurity: "tls",
    smtpHost: "smtp.mailbox.org", smtpPort: 465, smtpSecurity: "tls", hint: "",
  },
  "yahoo.de": yahoo(), "yahoo.com": yahoo(),
  "icloud.com": {
    label: "iCloud", imapHost: "imap.mail.me.com", imapPort: 993, imapSecurity: "tls",
    smtpHost: "smtp.mail.me.com", smtpPort: 587, smtpSecurity: "start-tls",
    hint: "iCloud verlangt ein app-spezifisches Passwort.",
  },
};

function gmx(): MailServerPreset {
  return { label: "GMX", imapHost: "imap.gmx.net", imapPort: 993, imapSecurity: "tls",
    smtpHost: "mail.gmx.net", smtpPort: 587, smtpSecurity: "start-tls",
    hint: "GMX verlangt bei aktivierter Zwei-Faktor-Anmeldung ein App-Passwort." };
}

function gmail(): MailServerPreset {
  return { label: "Gmail", imapHost: "imap.gmail.com", imapPort: 993, imapSecurity: "tls",
    smtpHost: "smtp.gmail.com", smtpPort: 587, smtpSecurity: "start-tls",
    hint: "Gmail verlangt ein App-Passwort; der normale Kontozugang wird abgelehnt." };
}

function microsoft(): MailServerPreset {
  return { label: "Outlook / Microsoft", imapHost: "outlook.office365.com", imapPort: 993, imapSecurity: "tls",
    smtpHost: "smtp.office365.com", smtpPort: 587, smtpSecurity: "start-tls",
    hint: "Microsoft konten brauchen ein App-Passwort oder OAuth. OAuth wird unter Erweitert eingerichtet." };
}

function yahoo(): MailServerPreset {
  return { label: "Yahoo", imapHost: "imap.mail.yahoo.com", imapPort: 993, imapSecurity: "tls",
    smtpHost: "smtp.mail.yahoo.com", smtpPort: 465, smtpSecurity: "tls",
    hint: "Yahoo verlangt ein App-Passwort." };
}

/** Domain des Postfachs in Kleinschreibung; leere Zeichenkette, wenn keine Adresse erkennbar ist. */
export function mailboxDomain(address: string): string {
  const trimmed = address.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at < 1 || at === trimmed.length - 1) return "";
  return trimmed.slice(at + 1);
}

/** Bekannter Anbieter oder `null` - unbekannte Domains werden nie geraten. */
export function detectMailPreset(address: string): MailServerPreset | null {
  const domain = mailboxDomain(address);
  return domain && Object.prototype.hasOwnProperty.call(PRESETS, domain) ? { ...PRESETS[domain]! } : null;
}

export const KNOWN_PROVIDER_DOMAINS: readonly string[] = Object.keys(PRESETS);