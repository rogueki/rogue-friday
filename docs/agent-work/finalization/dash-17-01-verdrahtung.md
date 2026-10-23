# DASH-17.01 — Gesamtverdrahtung der Automationen (2026-10-23)

**Status:** PASS. Oberfläche, Routen, Adapter und Rechte bilden eine Kette: jede Aktion, die die Automationen-Seite
anbietet, hat eine echte Route, ein Capability-Gate und — beim Hermes-Adapter — eine ehrliche Antwort. Was Hermes nicht
kann, ist weder erfunden noch ein Serverfehler.

## 1. Prüfaufbau

`apps/control-api/test/automations-ui-wiring.test.ts` liest die UI-Quellen (`apps/web/src/features/automations/*.tsx`,
`lib/api/domains/automations.ts`), die generierte Route-Tabelle und das Hermes-Manifest und vergleicht sie:

| Prüfung | Ergebnis |
| --- | --- |
| Jeder von der UI gerufene Pfad existiert in `route-table.generated.ts` | 12 Pfade, alle vorhanden (Liste, Detail, Enable, Disable, Test, Runs, Versions, Pause-all) |
| Jede Aktion ist an eine Capability gebunden | `create`, `update`, `enable`, `disable`, `test`, `pauseAll`, `versions` — alle sieben Gates vorhanden |
| Das Manifest verspricht nur, was der Adapter kann | deklariert sind `read, create, update, test, enable, disable`; **nicht** `versions`, **nicht** `pauseAll` |
| Die abgeschalteten Aktionen behalten eine echte Route | `pauseAllAutomations` und `listAutomationVersions` stehen im Contract |

## 2. Live-Nachweis der ehrlichen Absage

Gegen Hermes 0.22.2 auf `127.0.0.1:43791`:

```
POST /api/v1/automations/pause-all              -> 403  error.code = CAPABILITY_MISSING
GET  /api/v1/automations/{id}/versions?limit=10 -> 403  error.code = CAPABILITY_MISSING
```

Kein 500, kein stilles Nichts-Tun: die Oberfläche blendet beide Aktionen über `useCapability("automations", …)` aus, und
wer die Route trotzdem aufruft, bekommt eine erklärte Absage.

Dieselbe Live-Suite belegt auf genau den Routen, die die UI benutzt: Anlegen (nach Vorschau-Bestätigung), Testlauf,
Laufhistorie, Deaktivieren, Wiederfinden nach API-Neustart, Wiederherstellen einer früheren Konfiguration, Fehlerlauf
bei Exitcode 3. Das sind die Aufrufe aus `AutomationsPage`, `AutomationDrawer`, `AutomationWizard` und `TestPanel`.

## 3. Nachweise

```
vitest apps/control-api/test/automations-ui-wiring.test.ts        4 bestanden
vitest apps/control-api/test/automations-live-hermes.test.ts      4 bestanden (live, 11,6 s)
vitest --project web apps/web/src/features/automations           32 bestanden
pnpm typecheck                                                    bestanden
pnpm lint                                                         0 Fehler (3 bestehende Warnungen)
```

Auditseitig sind alle Schreibwege abgedeckt (`automation.created`, `.updated`, `.test_run`, `.dry_run`, `.enabled`,
`.disabled`, `.paused_all`) — mit Quelle `control-api` und Korrelations-ID des auslösenden Requests (DASH-17.03).

## 4. Grenzen

- **Kein visueller Abnahmeschritt:** In dieser Umgebung läuft kein Browser, also gibt es keinen Screenshot der Seite. Die
  Konsistenz ist auf Quell- und Fetch-Ebene belegt (Routen, Capability-Gates, 32 UI-Tests mit gerouteten Antworten), nicht
  optisch.
- **`pauseAll` und Versionshistorie bleiben für Hermes abgeschaltet.** Beides ist eine Eigenschaft des Anbieters, keine
  Lücke der Verdrahtung; ein Adapter mit echter Sammelpause oder Historie kann sie über dieselben Routen liefern, ohne
  dass die UI sich ändert.
- **Löschen ist kein UI-Weg:** Der Contract hat keine Löschoperation für Automationen (siehe DASH-17.02/17.04). Die UI
  bietet deshalb kein Löschen an; Aufräumen passiert außerhalb über Hermes.