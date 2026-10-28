# DASH-05.04 - Mehrkonten, Alias, Ordner/UIDVALIDITY, Entwuerfe und Versandjournal

Stand: 2026-10-22. Nachweisbasis: aktueller Arbeitsbaum auf `feat/friday-finalization-20261021`.

## 1 Ist-Stand vor der Abnahme

Die Funktionen waren im Quellcode bereits angelegt (Bridge, API, Postfach-UI, Compose). Es fehlten belastbare
Nachweise fuer die einzelnen Zusagen, und zwei Stellen waren nachweisbar falsch:

- Die Groessenpruefung fuer Anhaenge testete zuerst die Gesamtsumme. Dadurch wurde die Meldung "je Datei" nie
  erreicht; eine einzelne 6-MB-Datei meldete "zusammen zu groß". Reihenfolge jetzt: Einzelgrenze, dann Summe.
- `invalid_sender`/`invalid_recipients` der Bridge fielen in die allgemeine Meldung "Verbindungsdaten
  unvollständig" mit Feldhinweis `account`. Jetzt nennen sie das Feld `from` bzw. `to`. Greift nur, wenn der
  Handler nicht schon vorher prueft (siehe unten).

## 2 Was die Abnahme belegt

### 2.1 Lesen markiert nichts als gelesen

- `installer/wsl/tests/test_mail_accounts_bridge.py` (neu, 24 Zusicherungen, ohne echten Server) zeigt am
  nachgebauten IMAP-Client: `envelopes` und `message` selektieren mit `readonly=True` und holen Kopfdaten
  ausschliesslich per `BODY.PEEK`; `BODY[]` kommt im Lesepfad nicht vor. Nur `change` selektiert schreibend.
- `HimalayaMailbox.test.tsx` belegt auf UI-Ebene: das Oeffnen einer Nachricht ruft die Nachricht mit der
  UIDVALIDITY des Ordners ab und setzt **keinen** `change`-Aufruf ab; die Oberflaeche sagt es ausdruecklich.
- Gegenprobe im Bridge-Test: `change` mit `kind=move` selektiert `readonly=False`, verlangt `MOVE` und ein
  Ziel aus der Ordnerliste; ein fehlendes Ziel wird abgelehnt.

### 2.2 Mehrere Konten bleiben getrennt

- Bridge: `account_for` bedient nur bekannte IDs; ein unbekanntes Konto liefert `account_not_found`, eine
  ungueltige ID `invalid_account` (beides im Bridge-Test).
- API: Routentest "reads every account only through its own id" prueft die Aufrufe `work` und `privat` mit
  ihren jeweiligen UIDVALIDITY-Werten und stellt sicher, dass genau zwei Brueckenaufrufe erfolgen.
- UI: derselbe Test waehlt nacheinander beide Konten, sieht je eigene Ordner (nur das Arbeitskonto hat
  "Gesendet") und je eigene Nachrichten; die Nachrichten des anderen Kontos erscheinen nicht.

### 2.3 Ordner und UIDVALIDITY

- Bridge: `select()` vergleicht die angeforderte UIDVALIDITY mit der des Ordners und wirft
  `uidvalidity_conflict`; ein unbekannter Ordner ergibt `invalid_mailbox`.
- API: `mail-account-errors.test.ts` (neu, 4 Tests mit injizierter Bruecke) belegt die Abbildung
  `uidvalidity_conflict -> 409` mit der Meldung "Der Ordner wurde neu aufgebaut. Bitte Nachrichten neu laden.",
  `revision_conflict -> 409`, `account_not_found -> 422` "existiert nicht" und unbekannte Runner-Fehler -> 503.
- UI: Wechsel des Ordners startet eine neue Abfrage mit dem gewaehlten Postfach; die Nachricht wird immer mit
  der UIDVALIDITY aus der Liste geholt, ein Wechsel der Liste macht alte UIDs unbrauchbar (409-Hinweis).

### 2.4 UTF-8, Anhaenge, Entwuerfe, Sent-Kopie

- Bridge-Test baut einen Entwurf mit Umlauten, Emoji, Signatur und Anhang: der Betreff kommt als UTF-8 an, der
  Anhang behaelt Dateiname (`Prüfbericht März.txt`) und Inhalt, die Signatur steht im Text.
- Entwurf: derselbe Message-ID wird nicht ein zweites Mal angehaengt (`alreadyPresent: true`, kein Append);
  ein fremder Absender wird abgelehnt, ein Alias akzeptiert; ein fehlender Empfaenger und eine ungueltige
  Message-ID werden vor jedem Verbindungsversuch abgelehnt.
- Sent-Kopie: nach SMTP-Erfolg wird die Nachricht mit `\Seen` in den Gesendet-Ordner gehaengt; scheitert das,
  bleibt der Zustand `sent` mit `archivePending: true`. Ein vorhandener Eintrag wird nicht dupliziert.
- API-Routentest: `send` bestaetigt genau die Vorschau, ein Replay mit derselben Kennung liefert
  `replayed: true`, ohne SMTP erneut aufzurufen; `archive` ergaenzt nur die Kopie und ruft SMTP nicht auf.
- Compose-UI: Entwurf wird mit `Idempotency-Key` gespeichert (zweiter Klick nutzt denselben Schluessel, kein
  Versand), Anhang ueber 5 MB wird ohne Anfrage abgelehnt, kleine Datei landet base64 im Entwurf; Antworten
  setzen `In-Reply-To`/`References` und nehmen die eigene Adresse nicht in die Empfaengerliste.

### 2.5 Versandjournal und Doppelversand

- Die Postfach-UI zeigt "Offene Versandbelege" fuer `uncertain` und `archivePending`, mit Aktion
  "Gesendet-Ordner pruefen" (nur `review`, kein Versand) und ohne Eintrag fuer abgeschlossene Belege.
- `mail-accounts-routes.test.ts` belegt am API-Rand: Vorschau-Bindung, Replay ohne zweiten SMTP-Aufruf,
  Archiv-Nachtrag ohne SMTP, Ablehnung manipulierter Vorschau (409).
- Compose-/Mailbox-Tests halten den Zustand "Versand unklar" sichtbar und bieten nur Pruefen/Nachtragen an.

## 3 Nachweise (alle am 2026-10-22 im aktuellen Baum ausgefuehrt)

| Pruefung | Ergebnis |
| --- | --- |
| `py -3.11 installer/wsl/tests/test_mail_accounts_bridge.py` | 24 Zusicherungen: Lesen ohne `\Seen`, UIDVALIDITY, MOVE-Regeln, UTF-8/Anhang, Entwurf idempotent, Alias, Versand genau einmal, `uncertain` ohne Wiederholung, Sent-Kopie idempotent |
| `vitest --project node mail-accounts-routes` | 5 Tests: Journal/Replay/Archiv-Nachtrag, OAuth, Entwurf-Replay, Kontotrennung, fremder Absender 422 vor der Vorschau und Alias-Entwurf 200 |
| `vitest --project node mail-account-errors` | 4 Tests: UIDVALIDITY 409, Absender-/Empfaengerfeld, unbekannt 503, Revision 409, fehlendes Konto 422 |
| `vitest --project node mail-bridge mail-action-intent` | 21 Tests unveraendert gruen |
| `vitest --project web MailCompose` | 7 Tests: Vorschau-Bindung, unklarer Versand, Validierung, Alias-Entwurf mit Idempotenz, Anhangsgrenzen, Antwort-Header, offene Sent-Kopie |
| `vitest --project web HimalayaMailbox` | 3 Tests: zwei Konten getrennt ohne stilles Lesen, Versandjournal mit Pruefung ohne Versand, Anhangsgrenze und einmaliger Download |
| `vitest --project web --maxWorkers=2` | 84 Dateien / 666 Tests gruen |
| `vitest --project node --maxWorkers=2` | 2800 Tests gruen, 60 skipped, Exitcode 0 |
| `pnpm lint` | 0 Fehler (3 bestehende Warnungen) |
| `pnpm typecheck` | alle Pakete gruen |
| `pnpm build:app` | 0 |
| `playwright test tests/e2e/mail-wizard.spec.ts` | 2/2 in 27,4 s (Wizard unveraendert) |

## 4 Offene Punkte

- DASH-05.05 verlangt zwei **echte** kontrollierte Testpostfaecher (Lesen, Suchen, Antworten getrennt) und
  erklaerbare Fehler bei falschem Passwort, TLS und abgelaufenem Token. Das ist in dieser Umgebung ohne
  Zugangsdaten nicht moeglich und bleibt offen; die Fehlerklassen selbst sind in Bridge und Wizard getestet.
- Der Handler prueft den Absender bereits vor der Vorschau gegen `email`/`aliases`; die neue
  `invalid_sender`-Abbildung im Service greift nur fuer Aufrufe, die diese Pruefung nicht passieren (z. B.
  kuenftige Pfade). Beide Meldungen sind jetzt feldspezifisch.
- Bei sehr vielen Konten ist die Kontenauswahl im Postfach ein einfaches `select`; eine Suche/Filterung waere
  erst bei realer Anzahl noetig (nicht Teil der Anforderung).

## 5 Fallstricke

- Der Bridge-Test muss `fcntl` vor dem Laden ersetzen (Windows) und `load()` durch synthetische Konten
  austauschen; sonst schreibt er in das echte Benutzerkonto.
- Fakes muessen die echten Antwortschemata nachbilden: `email.message_from_bytes(..., policy=policy.SMTP)`
  erzeugt fuer Anhaenge `application/octet-stream`, Inhalt nur ueber `get_payload(decode=True)`.
- Ein Spion auf `mailAccounts.message` umgeht die Fehlerabbildung des Service; Abbildungen deshalb mit
  injizierter Bruecke (`new MailAccountsService(dir, invoke)`) pruefen, nicht am oeffentlichen Methodenrand.
- `startTestApi` liefert bei `responseValidation: "throw"` einen 500er, wenn ein Mock unvollstaendige
  Nachrichten liefert; die Nachricht braucht `bodyText`, `attachments` und alle Kopffelder.
- In jsdom loest `link.click()` "Not implemented: navigation" aus; im Test `HTMLAnchorElement.prototype.click`
  stubben und die Zahl der Aufrufe pruefen.