# P5 Kalender: Implementierung und Prüfnachweis

Stand: 2026-10-19. Dieser Nachweis betrifft den lokalen Quellbaum, nicht eine installierte Friday-Instanz oder ein externes Kalenderkonto.

## Zuständigkeit und Datenfluss

- `installer/wsl/calendar_accounts.py`: Friday-eigene CalDAV-/ICS-Konten, Discovery, Rechte, HTTPS-Transport, iCalendar-Mutationen und SQLite-Aktionsjournal. `installer/wsl/test_calendar_accounts.py` enthält einen kontrollierten lokalen HTTPS-CalDAV-Server.
- `apps/control-api/src/services/calendar-accounts.ts` und `calendar-memory.ts`: WSL-Aufruf, Lese-Cache und Übergabe bestätigter oder unsicherer Schreibresultate an P3 Durable Memory. `handlers/calendar-accounts.ts` ist der Owner-geschützte Dashboard-Einstieg. `handlers/connected-calendar-voice.ts` nutzt denselben Dienst für die Sprachvorschau und Bestätigung.
- `apps/control-api/src/handlers/local-calendar.ts`: führt lokale, verbundene und vorhandene Adapter-Ereignisse im normalen Kalender-Lesepfad zusammen. `adapters/calendar-placeholder/src/ics-calendar.ts` expandiert Serien und detached exceptions.
- `apps/web/src/features/calendar/CalendarAccounts.tsx` und `CalendarPage.tsx`: native Kontoanlage, Discovery, Auswahl/Standardkalender, Rechte/Status und Ereignisaktionen. `installer/voice/calendar_voice.py` nimmt benannte Kalender in bestehende Sprachdialoge auf; lokale Sprachaktionen bleiben erhalten.
- `packages/contracts/schemas/integrations/calendar-account-action.schema.json`, OpenAPI, generiertes SDK und Route-Tabelle enthalten die Konto- und Connected-Voice-Operationen. P4/P6 besitzen spätere gemeinsame Contract-Generierungsfenster; P5 benötigt derzeit keine weitere Generierung.

## Laufzeitdaten und Semantik

Die WSL-Dateien liegen unter `~/.config/friday/calendar/`: `accounts.json` mit Kontometadaten, `<account-id>.secret` für CalDAV-Passwort beziehungsweise vollständige private ICS-URL und `actions.sqlite` für Schreib- und Memory-Quittungen. Verzeichnis und Dateien werden mit restriktiven Unix-Rechten angelegt. Die ICS-URL wird in API-Antworten nicht zurückgegeben. Ein Wechsel von ICS zu CalDAV verlangt neue Zugangsdaten; bei Änderung von Server oder Benutzer werden zuvor entdeckte Kalender verworfen. Kontenlöschung löscht keine Anbietertermine.

CalDAV-Discovery folgt `current-user-principal` und `calendar-home-set`, liest Sammlungen samt Name, Farbe, Zeitzone und erfolgreichen `propstat`-Rechten und erlaubt Auswahl mehrerer Kalender sowie einen Standard-Schreibkalender. Schreibaktionen sind für ICS und Kalender ohne Schreibrecht gesperrt. Transport akzeptiert nur HTTPS auf Port 443, keine Redirects, literal/private IPs oder Originwechsel; XML-DTD/Entities und übergroße Antworten werden abgewiesen. Der Rechte-Check ist eine Provider-Abfrage, keine Erteilung fehlender Anbieterrechte. Eine ausdrücklich gestartete Schreibprobe ist nicht implementiert.

Create verwendet `If-None-Match: *`, Update/Delete `If-Match` mit vorherigem ETag-Abgleich. `scope=single` gilt für Einzeltermine; wiederkehrende Ressourcen verlangen `series` oder `occurrence`. Serienänderungen erhalten RRULE, Ausnahmen, Teilnehmer und unbekannte Eigenschaften. Ein Zeitversatz der Gesamtserie mit detached exceptions, EXDATE oder RDATE wird als `unsupported_series` abgewiesen, weil die Ausnahmezeiten sonst still falsch würden. `occurrence` verlangt `recurrenceId`: Update schreibt eine detached `RECURRENCE-ID`-VEVENT, Delete ergänzt `EXDATE`; TZID und `VALUE=DATE` bleiben erhalten. Ganztagsintervalle verwenden ein exklusives Ende. Komplexe RDATE-/Provider-Varianten und Einladungs-/Teilnehmerwirkung sind nicht bei realen Anbietern geprüft.

Vor jeder Anbieter-Mutation reserviert `actions.sqlite` einen aus Identität, Konto, Kalender, Aktion und Idempotency-Key abgeleiteten Schlüssel mit Nutzdaten-Hash und stabilem Zeitstempel. Wiederholung derselben Aktion löst keinen zweiten Schreibrequest aus. Ein Transportverlust nach Reservierung wird als `uncertain` gemeldet, nicht als Erfolg; die UI zeigt diesen Zustand. Nach dem Provider-Ergebnis wird ein redigiertes P3-IntegrationEvent übergeben. Wenn Memory nicht annimmt, bleibt die Quittung im Journal und wird beim nächsten Kalenderzugriff erneut zugestellt. Memory-Fehler machen einen bestätigten Provider-Erfolg nicht rückwirkend zum HTTP-Fehler. Es gibt noch keine automatische Anbieter-Reconciliation eines unsicheren Schreibens.

## Ausgeführte Prüfungen

Alle Befehle aus dem Repo-Root `rogue-friday-clean`, PowerShell-PATH bei Bedarf mit `$env:Path=$env:Path.Replace('"','')` bereinigt:

| Befehl | Ergebnis |
| --- | --- |
| `$repoWsl = (wsl -d Friday-Ubuntu --exec wslpath -u "$PWD").Trim(); wsl -d Friday-Ubuntu --cd "$repoWsl/installer/wsl" -- python3 -m unittest -q test_calendar_accounts.py` | 7/7 bestanden; letzter Lauf nach DAV-`all`-Rechteänderung. Aus PowerShell im Repository-Root ausführen. |
| `pnpm --filter @friday/adapter-calendar-placeholder test -- test/ics-calendar.test.ts` | 6/6 bestanden |
| `pnpm --filter @friday/control-api test -- test/local-calendar.test.ts test/calendar-bridge.test.ts test/voice-calendar.test.ts test/calendar-memory.test.ts` | 7/7 bestanden; drei gefundene Testdateien |
| `pnpm --filter @friday/control-api test -- src/services/calendar-memory.test.ts` | 2/2 bestanden |
| `python -m unittest -v test_connected_calendar_voice.py` aus `installer/voice` | 2/2 bestanden |
| `pnpm --filter @friday/control-api typecheck`, `pnpm --filter @friday/web typecheck`, `pnpm --filter @friday/adapter-calendar-placeholder typecheck` | jeweils bestanden |
| `pnpm --filter @friday/contracts check` | Lint, Validate, Generated und Breaking bestanden |

Der kontrollierte HTTPS-Test prüft Discovery, Read-only, conditional CRUD/ETag, Serienausnahmen mit Europa/Berlin-DST, Ganztag, Geheimnis-Redaktion sowie Verlust der PUT-Antwort und idempotentes Replay. Ein echter CalDAV-Anbieter, eine installierte Friday-/Hermes-Instanz, der tatsächliche Mikrofonpfad und externe Schreibrechte wurden **nicht ausgeführt**. Damit sind CAL-02 und CAL-06 als End-to-End-Abnahme noch offen; diese Tests belegen den lokalen Implementierungspfad.
