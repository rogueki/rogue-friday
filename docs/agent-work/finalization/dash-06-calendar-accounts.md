# DASH-06 - Kalenderkonten im Adapterdetail, Discovery und Schreibtest

Stand: 2026-10-22/23. Nachweisbasis: aktueller Arbeitsbaum auf `feat/friday-finalization-20261021`.

## 1 Ist-Stand und Umbau

Bisher stand der komplette Kontoblock (`CalendarAccounts`) **auf der Kalenderseite**: Kontoformular,
Discovery, Kalenderauswahl, Terminliste und Termin-CRUD in einem Abschnitt unter den Ansichten. Das war der in
§8.1 kritisierte Kontoeingabeblock an der Fachseite und doppelte die Terminfläche der Seite.

Jetzt:

- Die Kalenderseite enthält nur noch Ansichten, Termine und Filter; der Kontoblock ist entfernt
  (`CalendarAccounts.tsx` gelöscht, `CalendarPage.tsx` bereinigt). Ein Test der Seite bleibt unverändert grün.
- Neuer Assistent `features/settings/CalendarAccountWizard.tsx` im Kalender-Adapterdetail
  (`AdaptersArea`, nur wenn die Kalender-Kategorie ausgewählt ist) mit sechs Schritten:
  1. Typ (CalDAV oder ICS nur lesen), 2. Zugang, 3. Discovery, 4. Kalender und Rechte, 5. Standardkalender,
  Abgleichintervall, Zeitzone, Standardkonto, 6. Prüfen und übernehmen.
- Der Assistent schreibt erst nach dem Zugangsschritt (Anmeldung) und aktiviert Kalender erst mit
  "Kalender übernehmen". "Einrichtung verwerfen" entfernt einen bereits angelegten Entwurf wieder
  (`delete` mit erwarteter Revision) und meldet das ausdrücklich; vor dem Zugangsschritt wird nur lokal
  zurückgesetzt. Bisherige Standardkonten bleiben dabei unberührt.

## 2 Discovery, Rechte und ICS

- Die Bridge entdeckt Principal (`current-user-principal`) und Home-Set (`calendar-home-set`) und listet die
  Sammlung mit `displayname` und `current-user-privilege-set`. Der lokale CalDAV-Fixture liefert zwei Kalender
  ("Work" schreibbar, "Shared" nur lesbar); der Test prüft genau das.
- Ein `propstat` mit Fehlerstatus kann keine Rechte verleihen (`successful_property`); der Test
  `test_denied_propstat_cannot_grant_write_rights` hält das fest.
- ICS-Konten sind fest lesend: `kind=ics` wird beim Schreiben mit `read_only` abgelehnt, die Oberfläche bietet
  weder Kalenderauswahl noch Schreibziel noch Schreibtest und sagt das im Klartext.
- Kontoentfernen löscht nur den lokalen Eintrag und das Secret. Neuer Test: nach `delete` gibt es **keinen**
  `DELETE`/`PUT` gegen den Server, und die Kontenliste ist leer.

## 3 Ausdrücklicher Schreibtest

Neu in der Bridge: Aktion `write-test`.

- Nur für CalDAV und nur auf einem Kalender mit Schreibrecht; sonst `read_only`.
- Legt genau einen Termin mit eindeutiger Kennung (`friday-selftest-<16 hex>`) an, liest ihn zurück und
  vergleicht die Kennung im zurückgelesenen Dokument. Danach wird er mit dem ETag aus dem Rücklesen gelöscht
  (`finally`), auch wenn der Rücklesevergleich fehlschlägt. Antwort: `{ok, calendarId, uid, cleaned}`.
- Fehlerfälle sind unterscheidbar: `write_failed` (Anbieter lehnt ab), `write_not_confirmed` (nicht
  zurückgelesen), `cleanup_failed` (nicht aufgeräumt, Oberfläche verlangt manuelles Entfernen). Alle drei werden
  im Service in erklärende Meldungen abgebildet, in beiden Fehlerpfaden.
- Vertrag: `CalendarAccountAction.action` kennt `write-test`; SDK neu generiert. Service `writeTest()` läuft mit
  Schreib-Timeout.
- Oberfläche: eigener Knopf "Schreibtest im Testkalender ausführen" nur im letzten Schritt, mit Hinweis, dass
  ausschließlich dieser Testtermin angelegt und sofort entfernt wird. Ein Test belegt, dass vor dem Klick
  **kein** `write-test` gesendet wird und danach genau einer, und dass das Ergebnis "angelegt, zurückgelesen,
  aufgeräumt" angezeigt wird.

## 4 Was die Abnahme belegt

| Zusage | Beleg |
| --- | --- |
| kein Kontoblock auf der Kalenderseite | `CalendarAccounts.tsx` entfernt; `CalendarPage` rendert nur Ansichten/Termine/Filter; Web-Suite 85/674 |
| Wizard im Adapterdetail, sechs Schritte | `CalendarAccountWizard.test.tsx` (5 Tests) prüft Schrittfolge, Pflichtfelder, Discovery, Rechte, Standard, Übernehmen |
| mindestens zwei Kalender entdeckt | CalDAV-Fixture: `{"Work","Shared"}` mit Schreib-/Leserechten |
| echte CRUD im Testkalender | `test_discovery_privileges_read_only_and_etag_round_trip`: create → report → update (ETag) → delete, inklusive Replay ohne zweites PUT |
| read-only verhindert Schreiben | Bridge `read_only` für Shared und für ICS; UI bietet keinen Schreibtest |
| ETag-Konflikt verliert keine fremde Änderung | Test mit veraltetem ETag → `etag_conflict`, Serverdokument bleibt unverändert; erneutes Update nur mit aktuellem ETag |
| DST/Serien/Ganztag | Serien mit `EXDATE;TZID=Europe/Berlin`, Serienänderung nur ausdrücklich, Einzelvorkommen mit `VALUE=DATE`, Ganztag exklusiv; Zeitzone des Rechners wird im Wizard angezeigt |
| Schreibtest sauber | `write-test`-Tests: PUT → GET → DELETE, Kenngröße `cleaned`, Aufräumen auch bei fehlendem Rücklesen |
| Discovery-Fehler erhält aktiven Account | neuer Test: zweites Konto, Discovery scheitert (`discovery_failed`), Standardkonto und Kalender des ersten Kontos unverändert |
| Offlineänderung bleibt ausstehend | `test_transport_loss_replays_uncertain_without_second_put` (bestehend): Zustand `uncertain`, kein zweiter PUT, Journal |
| Abbruch löscht keine Termine | Abbruch entfernt nur den Entwurf (Konto), nie Termine; Kontoentfernen sendet kein `DELETE` an Kalender |

## 5 Nachweise (2026-10-22/23, aktueller Baum)

| Pruefung | Ergebnis |
| --- | --- |
| `python3 test_calendar_accounts.py` (WSL, echter lokaler CalDAV-Fixture) | 11 Tests grün (7 bestehende + Schreibtest, Aufräumen ohne Rücklesen, Kontoentfernen, Recovery) |
| `vitest --project web CalendarAccountWizard` | 5 Tests grün |
| `vitest --project node calendar` | 12 Dateien / 60 Tests grün |
| `vitest --project web --maxWorkers=2` | 85 Dateien / 674 Tests grün |
| `pnpm lint` / `pnpm typecheck` / `pnpm build:app` | 0 Fehler (3 bestehende Warnungen) / 0 / 0 |
| `playwright test settings.spec.ts settings-acceptance.spec.ts` | 10/10 in 1,1 min |

## 6 Offene Punkte

- **DASH-06.04 bleibt TEIL**: "echte CRUD im Testkalender" ist gegen den lokalen CalDAV-Fixture belegt
  (echtes HTTP/S, echte ETags, echter Server), aber nicht gegen einen **realen Anbieter** (Google/Nextcloud/
  mailbox.org). Dafür fehlen Zugangsdaten; ein weiterer Mock würde nichts belegen.
- Der Wizard speichert den Zugang vor der Discovery, damit die Bridge sich anmelden kann. Ein Abbruch entfernt
  diesen Entwurf wieder; scheitert auch das Entfernen, sagt die Oberfläche es und nennt keinen Erfolg.
- `makeDefault` und eine Änderung des Abgleichintervalls erhöhen die erwartete Revision; der Code rechnet die
  Revision aus den vorherigen Aktionen. Bei einem Fehler dazwischen bleibt das Konto konsistent, aber ohne
  Standardwechsel - die Meldung nennt den Fehler.

## 7 Fallstricke

- Die Bridge-Aktion läuft nur unter Linux (fcntl); der Test braucht WSL und `openssl` für den TLS-Fixture.
- `calendar_for(write=True)` wirft `read_only`, bevor der Schreibtest überhaupt startet; die Prüfung im
  Aktionsblock ist die zweite Sicherung.
- Der Fixture löscht nur mit passendem `If-Match`; der Schreibtest nimmt deshalb das ETag aus dem Rücklesen,
  nicht das aus dem PUT.
- `AdaptersArea` rendert den Assistenten nur bei ausgewählter Kalender-Kategorie; die Kalenderseite darf keinen
  zweiten Kontoblock erhalten.
- Im Web-Test sind `role="status"`-Meldungen mehrfach vorhanden; gezielt über den Text prüfen.