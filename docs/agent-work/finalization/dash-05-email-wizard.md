# DASH-05.03 - Gefuehrter E-Mail-Wizard

Stand: 2026-10-22. Nachweisbasis: aktueller Arbeitsbaum auf `feat/friday-finalization-20261021`.

## 1 Ist-Stand vor der Umsetzung

- `MailAccountsArea.tsx` zeigte ein flaches Formular mit allen Feldern gleichzeitig; der Submit erzeugte
  direkt ein Konto, ohne Vorschlaege, ohne Schrittfolge und ohne Verbindungstest vor dem Speichern.
- `HimalayaAccountSetup.tsx` ist die alte Einzelkonto-Einrichtung und prueft nur das **gespeicherte** Profil
  (`check-imap`/`check-smtp` ueber `configure_himalaya.py`); ein Entwurf liess sich damit nicht testen.
- `mailAccounts.check(accountId, protocol)` verbindet nur ein bereits gespeichertes Konto. Fuer die Anforderung
  "getrennte Verbindungstests vor dem Uebernehmen" fehlte damit eine Operation, die einen ungespeicherten
  Kandidaten einmalig verbindet.

## 2 Umsetzung

### 2.1 Contract (zuerst)

- Neu: `packages/contracts/schemas/settings/mail-connection-test-request.schema.json` (protocol, host, port,
  security, username, password; `additionalProperties: false`, Laengen begrenzt).
- Neu: `packages/contracts/schemas/settings/mail-connection-test-response.schema.json`
  (`data: { ok, reason }` mit `reason` aus `ok|auth|tls|network|protocol`).
- `packages/contracts/openapi/friday-api.yaml`: `POST /api/v1/settings/mail-connection-test`,
  `operationId: testMailConnection`, `x-capability: meta.read`, `x-required-role: owner`, CSRF, 8 KiB Body-Limit.
  Der Vertrag zaehlt damit 272 Operationen.
- `pnpm contracts:generate` erzeugte `MailConnectionTestRequest`/`MailConnectionTestResponse` im SDK;
  `apps/control-api` Route-Tabelle wurde mit `pnpm --filter @friday/control-api generate:routes` neu erzeugt.

### 2.2 Bridge (`installer/wsl/mail_accounts.py`)

- Neue Aktion `check-candidate`: baut aus dem Entwurf ein validiertes Konto (`validate()`), verbindet genau ein
  Protokoll mit dem uebergebenen Passwort und gibt ausschliesslich `{ok, reason}` zurueck. Es wird nichts
  gespeichert, kein Secret ausgegeben und keine Nachricht gesendet.
- `candidate_connection()` kennt nur `login()` und `ehlo()`/`STARTTLS`; ein `sendmail` existiert darin nicht.
- Fehlerabbildung: `ssl.SSLError -> tls`, `SMTPAuthenticationError`/`IMAP4.error -> auth`,
  sonstige `SMTPException -> protocol`, `OSError -> network`. Reihenfolge bewusst: TLS vor `OSError`
  (SSLError ist ein OSError), Auth vor der allgemeinen SMTP-Exception.
- Nur `run()` behandelt die Aktion vor `load()`, damit kein Konto vorausgesetzt wird.

### 2.3 Control API

- `mail-accounts.ts`: `checkCandidate(account, protocol, password)`; `invalid_*`-Fehler der Bridge werden als
  Validierungsfehler mit Feldhinweis gemeldet statt als "nicht verfuegbar".
- `handlers/settings.ts`: `testMailConnection` spiegelt die gepruefte Anmeldung in beide Protokollfelder
  (verbunden wird nur das gewaehlte), auditet `settings.mail_connection_tested` mit `{protocol, ok, reason}`
  und gibt das Ergebnis als regulaere Antwort zurueck. Ein 503 der Bridge bleibt ein 503.

### 2.4 Web-Wizard

- Neu `features/settings/mailPresets.ts`: Domain-basierte Vorschlaege fuer GMX, WEB.DE, Gmail, Outlook/Microsoft,
  T-Online, Posteo, mailbox.org, Yahoo und iCloud. Unbekannte Domains ergeben `null`; es wird nie aus
  Teilstrings geraten. Jeder Vorschlag nennt den Anbieterhinweis (z. B. App-Passwort).
- Neu `features/settings/MailAccountWizard.tsx` mit sieben Schritten:
  Adresse -> Absendername/Aliase -> Server (Vorschlag, editierbar, manuelle Einrichtung erklaert) ->
  Anmeldung (IMAP-Passwort, optional getrenntes SMTP-Passwort) -> getrennte Verbindungstests ->
  Ordnerzuordnung + Standardkonto -> Zusammenfassung.
- Speichern ausschliesslich im letzten Schritt ueber `POST /api/v1/integrations/mail/accounts`
  (ein Aufruf, Secrets im Body). "Als Standard" ruft danach `GET .../accounts` fuer die Katalogrevision und
  `POST .../accounts/{id}/default` mit `If-Match`; scheitert das, bleibt das Konto bestehen und die Meldung
  benennt den Teilfehler.
- In `MailAccountsArea.tsx` laeuft "Neues Konto" jetzt durch den Wizard; das Formular bleibt fuer das Bearbeiten
  bestehender Konten (inklusive OAuth).
- Der Testschritt laesst sich nur mit zwei bestaetigten Verbindungen verlassen. Ist die Bridge nicht vorhanden
  (503 `ADAPTER_UNAVAILABLE`, z. B. Entwicklungs-/Mock-Betrieb), sagt die Oberflaeche das ausdruecklich und
  verlangt eine bewusste Bestaetigung "Ohne Pruefung fortfahren"; ein stiller Sprung ist nicht moeglich.

## 3 Nachweise (alle am 2026-10-22 im aktuellen Baum ausgefuehrt)

| Pruefung | Ergebnis |
| --- | --- |
| `py -3.11 installer/wsl/tests/test_mail_accounts_candidate.py` | 11 Pruefungen: Erfolg, auth, tls, protocol, echter Netzwerkfehler gegen geschlossenen lokalen Port, ungueltige Eingaben vor jedem Verbindungsversuch, kein `sendmail` im Kandidatenaufbau |
| `pnpm contracts:check` | lint, validate, check-generated, breaking gruen |
| `tsc -p apps/control-api` | 0 Fehler |
| `tsc -p apps/web` | 0 Fehler |
| `vitest --project node mail-connection-test` | 5 Tests: einmaliger Aufruf ohne Speichern, alle fuenf Gruende, ungueltige Daten ohne Verbindung, 403 fuer viewer/operator, 503 bleibt 503 |
| `vitest --project web MailAccountWizard` | 6 Tests: kompletter Durchlauf inkl. Default-Konto und `If-Match`, unbekannte Domain ohne Vorschlag, unvollstaendige Adresse, abgelehnte Anmeldung ohne stillen Sprung, Umgebung ohne Bridge, Verzicht auf Default |
| `vitest --project web mailPresets` | 5 Tests: Domainlesen, Vorschlag, Kopie statt Mutationsleak, kein Raten, eindeutige Domainliste |
| `vitest --project web --maxWorkers=2` | 83 Dateien / 659 Tests gruen |
| `vitest --project node --maxWorkers=2` | 192 Dateien / 2794 Tests gruen, 60 skipped, Exitcode 0 |
| `pnpm lint` | 0 Fehler (3 bestehende Warnungen) |
| `pnpm typecheck` | alle Pakete gruen |
| `pnpm build:app` | Web-Export und Control-API-Build 0 |
| `playwright test tests/e2e/mail-wizard.spec.ts` | 2/2 gruen in 33,2 s: Schrittfolge, keine Server-Raterei, editierbarer Vorschlag; getrennte Tests, ehrlicher 503-Hinweis, erzwungene Bestaetigung, 390/1024/1920 px ohne Overflow |

Nebenbei behoben: `apps/control-api/src/db/database.ts` hatte eine ungenutzte Initialisierung
(`let integrity = ""`), die `pnpm lint` mit `no-useless-assignment` rot machte; jetzt `let integrity: string`.

## 4 Offene Punkte

- DASH-05.04: Mehrkonten/Alias/Folder/UIDVALIDITY/Anhaenge/UTF-8/Entwuerfe/Sent-Kopie und Sendjournal muessen
  gegen die Anforderung abgenommen werden (Datenmodell und Bridge koennen es bereits, die Abnahme fehlt).
- DASH-05.05: zwei echte kontrollierte Testpostfaecher getrennt lesen/suchen/antworten; falsches Passwort,
  TLS-Fehler und Tokenablauf muessen im echten Betrieb erklaerbar sein. Nur in der installierten Umgebung
  moeglich, nicht in Mock/E2E.
- DASH-05.06: Wizardabbruch ohne teilaktivierte Verbindung ist konstruktiv erfuellt (nichts wird vor dem letzten
  Schritt geschrieben), muss aber als Abnahme mit echtem Abbruch belegt werden; Sendetimeout-Abgleich folgt.
- Der Standardkonto-Aufruf setzt die Katalogrevision voraus; nach parallelen Aenderungen kann er mit 409
  scheitern. Das ist bewusst sichtbar (Konto bleibt bestehen, Meldung nennt den Grund).

## 5 Fallstricke

- `mail_accounts.py` importiert `fcntl`; ein Test unter Windows muss das Modul vor dem Laden ersetzen.
- Ein Kandidatentest darf keine Bruecken-Ausnahme nach `main()` durchlassen, sonst wird jeder Verbindungsfehler
  zu "nicht verfuegbar"; deshalb faengt `check_candidate()` selbst.
- `validate()` erwartet den vollstaendigen Kontosatz (beide Hosts, Logins, Ordner, Revision); der Handler spiegelt
  die Anmeldung deshalb in beide Protokollfelder.
- Im Browser-Test liegt der Request-Body in einem `Request`-Objekt, nicht in `init.body`; `JSON.parse(String(...))`
  erzeugt sonst `"undefined" is not valid JSON` und der SDK meldet faelschlich `ADAPTER_UNAVAILABLE`.
- Neue Operationen erhoehen die Vertragszahlen: `openapi-additions.test.ts` (272), `contract.test.ts`
  (Route-Tabelle 272, fokussierte Routen 79) und die Live-Only-Liste in `packages/mock-data/test/api.test.ts`
  muessen mitgezogen werden.