# DASH-17 — Stand und offene Arbeit (Automationen, Meldungen, Audit)

**Datum:** 2026-10-23 · **Status:** 17.01/17.02/17.03/17.04/17.05 offen; Voruntersuchung abgeschlossen

Diese Notiz hält den belegten Ausgangszustand fest, damit die nächste Session nicht neu suchen muss.

## 1. Vertragsfläche ist vollständig

`packages/adapter-core/src/port-spec.ts` definiert den Automations-Port bereits vollständig:
`listAutomations`, `getAutomation`, `listAutomationRuns`, `createAutomation`, `updateAutomation`, `testAutomation`,
`enableAutomation`/`disableAutomation` (Scopes `automations.read/create/update/test/enable`). Es fehlt **kein**
Vertrag, nur ein Adapter.

## 2. Es gibt keinen Live-Adapter für Automationen

`adapters/` enthält calendar-, mail-placeholder, hermes, mock, system-local, system-placeholder, voice-http und
voice-placeholder — **kein** `automations`-Adapter. In `config/adapters.live.example.yaml` fehlt der Eintrag
konsequenterweise; `mock-automations` steht nur in `config/adapters.example.yaml` (Mock-Beispiel) und in
`packages/mock-data/src/world/services/automations.ts` (Entwicklungswelt) sowie in den Vertragsbeispielen
`packages/contracts/examples/automations/*.json`.

Damit gilt für den Live-Betrieb: der Automationsbereich ist **nicht angebunden** und liefert keine erfundenen
Automationen — das ist die richtige, aber noch nicht abgenommene Seite von 17.02/17.04 („leere Installation enthält
keine Demoautomation").

## 3. Die reale Quelle wäre `hermes cron`

Auf `FRIDAY-2` (Hermes v0.22.2) gibt es den vollständigen Cron-Unterbau:

```
hermes cron {list,create,add,edit,pause,resume,run,remove,rm,delete,status,runs,history,incidents,notepad,doctor,tick}
hermes cron list [--all]
hermes cron create <schedule> [prompt] [--name] [--deliver] [--failure-deliver] [--repeat] [--skill]
                   [--script] [--no-agent] [--workdir] [--model] [--provider] [--reasoning-effort] [--paused]
hermes cron runs [--limit N] [job_id]
```

Das deckt Zeitpläne, Pausieren, manuelles Auslösen, Historie und Incidents ab — also genau die Vorgänge, die der Port
verlangt.

**Korrektur (2026-10-23):** Die CLI hat keinen JSON-Modus, der **HTTP-API-Server** aber sehr wohl. Auf `FRIDAY-2`
läuft ein Dashboard-Prozess auf `127.0.0.1:43791`; `GET /api/cron/jobs?profile=all` liefert JSON (ohne Credential
`401`), und die Endpunkte decken Liste, Detail, Laufhistorie, Anlegen, Ändern, Pausieren, Fortsetzen, Auslösen und
Löschen ab. Details: `dash-17-02-hermes-cron-api.md`. Damit ist Textparsing vom Tisch; offen ist nur noch ein
Web-Credential für den Adapter (und damit die Laufzeitabnahme von 17.04).

## 4. Was für die Abnahme fehlt

- ein `automations`-Adapter (Zeitplan/Trigger/Aktionen/Rechte/Testlauf/Historie) mit belastbarer Datenquelle,
- Kennzeichnung eines simulierten Testlaufs als Simulation (§17.02) und Verzicht auf Exactly-once-Behauptungen,
- Nachweis „eigene Automation anlegen → auslösen → Lauf verfolgen → pausieren → nach Neustart wiederfinden" (17.04),
- DST-/429-/Aktionsfehler-/Doppelzustellungsfälle (17.04) und das Verhalten bei schadhaftem Scheduling (17.05).

## 5. Was bereits belegt ist (Audit-Seite von 17.03)

- `apps/control-api/test/audit.test.ts` (23 Tests): Akteur/Aktion/Ergebnis/**Correlation-ID**, verworfene Versuche,
  fehlgeschlagene Logins **ohne Passwort**, Hash-Kette, Tamper-Erkennung, Anker über Neustarts, Migration.
- `audit-archive.ts` + Tests: Aufbewahrung/Archivierung als zusammenhängendes Präfix mit Integritätsprüfung.
- `GET /api/v1/audit/export` mit CSV/NDJSON (`handlers/ports.ts`), Scopes `audit.read`.
- Offen bleibt der Meldungs-/Alarmpfad mit echten Ereignisquellen: `NotificationStore` und die durable Tabelle
  `notifications` existieren, die Produzenten und die Anbindung an Live-Ereignisse sind aber nicht abgenommen.
