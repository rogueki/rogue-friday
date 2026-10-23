# DASH-17.02 — Automations-Adapter auf der Hermes-Cron-API (2026-10-23)

**Status:** PASS — der Automations-Port wird im Live-Betrieb von `hermes-automations` bedient; die Mock-Herkunft ist
aus dem Live-Pfad entfernt. Die Abnahme mit echter Automation (17.04) ist davon getrennt und weiter offen.

## 1. Was gebaut wurde

| Datei | Inhalt |
| --- | --- |
| `adapters/hermes/src/cron-api.ts` | Client für `/api/cron/jobs` (Liste, Detail, Runs, Anlegen, Ändern, Pause, Resume, Trigger, Delete, Zustellziele) über den dashboard-token-authentifizierten `AuthedClient` |
| `adapters/hermes/src/automations-adapter.ts` | `HermesAutomationsAdapter` mit `AutomationPort`: Liste/Detail/Runs/Anlegen/Ändern/Test/Enable/Disable |
| `adapters/hermes/src/manifest.ts` | vierte Kategorie `automations` mit eigenen Capabilities |
| `adapters/hermes/src/index.ts` | Factory `hermes-automations` |
| `config/adapters.live.example.yaml`, `config/adapters.hybrid.example.yaml`, `installer/install-friday.ps1` | Allowlist + Adaptereintrag |
| `adapters/hermes/test/fake/{state,routes}.ts` | Cron-Endpunkte im Fake-Hermes (Auth wie im Original, Jobs starten pausiert) |
| `adapters/hermes/test/automations.test.ts` | 7 Tests |

## 2. Abbildung

- **Trigger:** `schedule.kind` `cron`/`interval` → `{type:"schedule", schedule: expr, description: "Hermes-Zeitplan (kind): display"}`.
  Eine Zeitzone wird **nicht** behauptet: Hermes plant in der lokalen Zone seiner Installation und liefert keinen
  IANA-Namen; das Contract-Feld bleibt deshalb leer, statt einen erfunden Wert zu setzen.
- **Aktionen:** Agenten-/Skriptlauf → `run_agent` (Parameter `prompt`, `script`, `skills`, `model`, `provider`, `workdir`,
  `mode:"script"` für `no_agent`); Zustellung ≠ `local` → zusätzlich `notify` mit `channel`, wenn Hermes den Kanal kennt.
- **Läufe:** `runs[]` mit `started_at`/`ended_at` (Epoche → ISO), `preview` als Ergebnis, Status aus `last_status`
  (`ok` → `succeeded`, `error` → `failed`). `dryRun` ist **false**, wenn wirklich ausgelöst wurde; als Simulation
  gekennzeichnet wird nur, was Simulation ist.
- **Version:** deterministischer Fingerabdruck des Jobs (`id`, Zeitplan, Name, enabled, Laufzähler) → `If-Match`-Konflikt
  bei parallelen Änderungen; keine erfundene Versionshistorie (`automations.versions` bleibt nicht angeboten).
- **Rechte:** F.R.I.D.A.Y.-Rollen bleiben vorgelagert (`automations.read/create/update/test/enable/disable`); Hermes kennt
  nur das Dashboard-Token.
- **Keine Exactly-once-Behauptung:** Trigger-Antwort enthält Lauf und Folgeplan; die Doku sagt ausdrücklich, dass Hermes
  den nächsten Termin plant, nicht dass F.R.I.D.A.Y. eine Zustellung garantiert.

## 3. Nachweise

```
vitest adapters/hermes (9 Dateien)          200 bestanden, 4 übersprungen
vitest adapters/hermes/test/automations     7 bestanden
vitest apps/control-api/test/real-adapters  11 bestanden (Wiring: automations -> hermes-automations)
pnpm typecheck                              bestanden
pnpm lint                                   bestanden
```

Die sieben Automations-Tests belegen: Contract-gültige Liste (`validatePortResult`), Trigger-/Aktions-/Paused-Abbildung,
Filter `enabled`/`q`, `NOT_FOUND` bei unbekannter ID, Laufhistorie nach Trigger (Status `succeeded`, `correlationId`
`corr_…`), Anlegen mit anschließendem Resume nur bei `enabled:true`, Testlauf als echter Lauf (`dryRun:false`),
Pause/Resume und `CONFLICT` bei veraltetem `If-Match`, sowie den leeren Zustand ohne erfundene Einträge.

## 4. Bewusst offen

- **17.04 (Abnahme):** braucht eine echte F.R.I.D.A.Y.-Automation gegen den laufenden Hermes-Dienst inklusive
  Neustart-Wiederfinden und Fehlerfällen (DST/429/Aktionsfehler). Die Datenquelle dafür steht (siehe
  `dash-17-02-hermes-cron-api.md` §5).
- **`pauseAllAutomations`:** Hermes bietet dafür keinen eigenen Endpunkt; die Capability wird nicht angeboten, statt sie
  über eine Schleife als „Pause-all" auszugeben.
