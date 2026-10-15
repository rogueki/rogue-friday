# Mapping: GMX Mail (IMAP/SMTP) -> Communication

Zielpaket: `adapters/mail-placeholder` (Provider `gmx-mail`, Kategorie `communication`). Der Adapter bedient die Module
`communication` **und** `mail` des Capability-Dokuments (Registry setzt `mail.read/draft/send` aus `communication.read/draft/send`).

## Verbindung

| Zweck         | Server         | Port | Sicherheit |
| ------------- | -------------- | ---- | ---------- |
| Lesen (IMAP)  | `imap.gmx.net` | 993  | TLS        |
| Senden (SMTP) | `mail.gmx.net` | 587  | STARTTLS   |

Login: vollständige Adresse (`username`) und Passwort bzw. App-Passwort (`password`, **Secret**, nie in Config/Log/Event).
Voraussetzung bei GMX: IMAP/SMTP-Zugriff im Postfach aktiviert. Eine Bibliothek (z. B. `imapflow` + `nodemailer`) wird erst bei der
Implementierung nach Dependency-Policy gewählt; sie ist hier bewusst nicht installiert.

## Objekte

| IMAP/SMTP                                                       | Kanonisch                                   | Regel                                                                                                                                      |
| --------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Postfach-Konto                                                  | `Channel` (`kind = email`)                  | `name` = Konto-Anzeigename, `address` = `username`, `unreadCount` = `UNSEEN`, `lastSyncAt` = letzter erfolgreicher Sync                    |
| Verbindungszustand                                              | `Channel.status`                            | ok -> `online`; Login fehlgeschlagen/keine Verbindung -> `offline`; nur Lesen (SMTP fehlt) -> `read_only`; ohne Config -> `not_configured` |
| Fähigkeiten                                                     | `Channel.capabilities`                      | `read` (IMAP ok), `draft` (APPEND in Entwürfe), `send` (SMTP ok **und** Freigabe-Workflow aktiv)                                           |
| Konversation                                                    | `Thread`                                    | Gruppierung nach `References`/`In-Reply-To`, Fallback: normalisierter Betreff + Teilnehmer                                                 |
| `Message-ID`                                                    | `Message.originalRef`                       |                                                                                                                                            |
| `Subject`                                                       | `Thread.subject`                            | `Re:`/`Fwd:` entfernt                                                                                                                      |
| `From`/`To`/`Cc`                                                | `Message.from/to/cc`, `Thread.participants` | `Participant` (Name + Adresse laut Vertrag)                                                                                                |
| `Date`                                                          | `Message.sentAt`, `Thread.lastMessageAt`    | UTC                                                                                                                                        |
| text/plain (sonst text/html -> Text)                            | `Message.bodyText`                          | HTML wird serverseitig zu Text reduziert, keine aktiven Inhalte                                                                            |
| Anhänge                                                         | `Message.attachments`                       | nur Metadaten (Name, Größe, Typ); Inhalte nur über `files` mit Freigabe                                                                    |
| Folder `Sent`                                                   | `Message.direction = outbound`              | übrige -> `inbound`                                                                                                                        |
| `\Seen`-Flag                                                    | `Thread.unreadCount`                        |                                                                                                                                            |
| `\Flagged`/Wichtigkeit                                          | `Thread.priority`                           | Standard `P3`; Hermes-Priorisierung kann überschreiben                                                                                     |
| Entwurf (IMAP `\Draft` oder lokal)                              | `Draft`                                     | `status = draft`; Versand: `requestDraftSend` -> `Approval` -> `pending_approval` -> `approved` -> `sent`                                  |
| Zusammenfassung, Antwortvorschlag, extrahierte Termine/Aufgaben | `Thread.summary/suggestedReply/extracted*`  | von Hermes-Agent erzeugt, nicht vom Adapter erfunden                                                                                       |

## Sicherheit

- **Senden nur über Freigabe:** `requestDraftSend` liefert immer ein `Approval` (Tier 2/3). SMTP wird erst nach `approveApproval` ausgeführt.
  Doppelklick = ein Versand: `Idempotency-Key` wird beim Versand gegen die gesendeten `Message-ID`s geprüft.
- Passwort nur über `getSecret("password")`; Fehlermeldungen des Servers laufen durch `createRedactor`.
- Eingehender Text ist nicht vertrauenswürdig (Prompt-Injection): der Adapter liefert Rohtext getrennt vom `aiSummary`; Agenten dürfen daraus keine Befehle ableiten.

## Ereignisse

`IDLE`/Polling (`syncIntervalSeconds`) -> `friday.communication.thread_updated` bei neuen/geänderten Threads;
Entwurfsänderungen -> `friday.communication.draft_updated`. Neue Nachrichten, die Antwort brauchen, zusätzlich `friday.notification.created`.
Reconnect: IMAP `UIDVALIDITY` + letzte `UID` merken; bei geänderter `UIDVALIDITY` Vollabgleich.

## Fehler

`LOGIN`-Fehler -> `UNAUTHENTICATED`; `NO [AUTHORIZATIONFAILED]` -> `UNAUTHENTICATED`; Verbindungsabbruch/Timeout -> `ADAPTER_UNAVAILABLE`/`ADAPTER_TIMEOUT`;
SMTP 5xx (Empfänger abgelehnt) -> `VALIDATION_FAILED`; SMTP 4xx -> `ADAPTER_UNAVAILABLE` (retryable, nur mit Idempotency-Key).
