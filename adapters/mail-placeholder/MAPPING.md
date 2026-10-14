# Mapping: GMX Mail -> Communication

Vollständige Feldtabellen: [`docs/MAPPING/mail-gmx.md`](../../docs/MAPPING/mail-gmx.md).

| Feld                                     | Standard                          | Bedeutung                                   |
| ---------------------------------------- | --------------------------------- | ------------------------------------------- |
| `imapHost` / `imapPort` / `imapSecurity` | `imap.gmx.net` / 993 / `tls`      | Lesen                                       |
| `smtpHost` / `smtpPort` / `smtpSecurity` | `mail.gmx.net` / 587 / `starttls` | Senden (nur nach Freigabe)                  |
| `username`                               | -                                 | GMX-Adresse                                 |
| `password`                               | Secret                            | Passwort/App-Passwort, nur über `getSecret` |
| `mailbox`                                | `INBOX`                           |                                             |
| `syncIntervalSeconds`, `timeoutMs`       | 120, 15 000                       |                                             |

Solange `username` oder `password` fehlen: `offline` / "Nicht konfiguriert".
