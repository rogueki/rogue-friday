import io

doc = """# DASH-17.04 — Abnahme der Automationen gegen eine laufende Hermes-Installation (2026-10-23)

**Status:** PASS. Belegt durch zwei echte Läufe über F.R.I.D.A.Y. gegen den Hermes-Dashboard-Dienst auf
`127.0.0.1:43791` (Hermes 0.22.2, WSL2 `FRIDAY-2`), inklusive API-Neustart.

## 1. Prüfaufbau

`apps/control-api/test/automations-live-hermes.test.ts` startet die echte Control-API (`dataMode: live`, Auth `local`,
Owner-Passwort), mit einer `adapters.yaml`, die ausschließlich `hermes-automations` real bindet. Ist kein Dashboard
erreichbar, überspringt sich die Datei selbst (`describe.skipIf`), damit CI und Rechner ohne Hermes grün bleiben.

Der Lauf führt zwei Skript-Automationen (`no_agent`) aus: ein Skript, das mit 0 endet, und eines, das mit 3 abbricht.
Damit wird die volle Kette ohne Modellaufruf und ohne Providerkosten geprüft — der Agentenpfad ist derselbe Port, nur
die Ausführung ist billiger.

## 2. Ergebnis

| Kriterium | Nachweis im Lauf |
| --- | --- |
| eigene echte Automation erstellen | `POST /api/v1/automations` nach Vorschau-Bestätigung → 201, `source.adapterId = hermes-automations`; Job liegt real in Hermes (`/api/cron/jobs`) |
| auslösen | `POST /api/v1/automations/{id}/test` → Lauf mit `dryRun: false`, `status: succeeded` |
| Lauf verfolgen | `GET …/runs?limit=5` liefert **genau einen** Lauf mit passender `automationId` |
| pausieren/deaktivieren | `POST …/disable` → `enabled: false`; Hermes-Job steht danach pausiert |
| nach Neustart wiederfinden | API-Instanz beendet und neu gestartet → `GET /api/v1/automations/{id}` → 200, gleiche ID, `paused: true` (ID-Abbildung ist deterministisch, kein In-Memory-Zustand nötig) |
| Aktionsfehler | Skript mit Exitcode 3 → Lauf `status: "failed"`, kein erfundener Erfolg |
| doppelte Zustellung | ein Trigger erzeugt genau einen Lauf; der Adapter hat keinen eigenen Scheduler (`pollCycle` → 0, kein Event-Stream) und wiederholt den Trigger nicht |
| DST | Ausdruck `30 2 * * *` (die bei Zeitumstellung kritische Stunde) kommt byte-identisch zurück; die Auswertung liegt bei Hermes, F.R.I.D.A.Y. verschiebt nichts und behauptet keine eigene Zeitzonenlogik |
| 429 | `adapters/hermes/test/automations.test.ts` erzwingt 429 über den Fake → `RATE_LIMITED`, `retryable: true`; nach Wegfall des Fehlers ist die Liste wieder normal, nichts wurde zwischengespeichert |
| leere Installation | nach dem Aufräumen enthält Hermes keine Jobs (`[]`); die API-Liste ist leer, es gibt keine Demo-Automation |

```
vitest apps/control-api/test/automations-live-hermes.test.ts   2 bestanden (8,5 s)
vitest adapters/hermes/test/automations.test.ts                8 bestanden
vitest adapters/hermes + real-adapters + live                   214 bestanden, 4 übersprungen (11 Dateien)
pnpm typecheck / pnpm lint                                      bestanden
```

## 3. Was der Lauf über den Vertrag hinaus gezeigt hat

1. **Jeder Automations-Schreibzugriff ist zweistufig.** Der erste Aufruf antwortet `403 APPROVAL_REQUIRED` mit
   `details.previewId`; erst der Wiederholungsaufruf mit `x-action-preview-id` führt die unveränderte Aktion aus. Bei
   aktiver Tier-2-Bestätigung kommt zusätzlich `stage: "approval"` mit `approvalId`. Das ist gewollt und wird nicht
   umgangen — der Test bildet den regulären Weg ab.
2. **Der Contract kennt kein Löschen.** `DELETE /api/v1/automations/{id}` gibt es nicht (405). Deaktivieren ist der
   Produktweg; Entfernen passiert in Hermes. Bewusst nicht erfunden, als Lücke dokumentiert.
3. **Hermes führt `POST /api/cron/jobs/{id}/trigger` synchron aus.** Ein Agentenlauf mit Modellaufruf überschreitet das
   konfigurierte `timeoutMs` von 10 s deutlich (im ersten Versuch: `ADAPTER_TIMEOUT` nach 10 000 ms). Für Agentenjobs
   muss der Timeout in `adapters.yaml` erhöht werden; Skriptjobs laufen in unter einer Sekunde.