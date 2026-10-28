# DASH-15.03/15.04 und DASH-16: Domain-Agenten als Worker, Routing und Grenzen

Stand 2026-10-28, Hermes Agent v0.22.2 auf `FRIDAY-2`, Modell `deepseek-v4-pro` (Alibaba Token Plan, `provider: custom`).

## 1. Ausführungsmodell (Entscheidung)

Friday baut **keine eigene Queue**. Die sieben Domain-Profile (`tasks`, `communication`, `calendar`, `automations`,
`research`, `alerts`, `audit`) sind Assignees des Hermes-Kanban-Boards. Der im Gateway eingebettete Dispatcher
(`kanban.dispatch_in_gateway: true`, Tick alle 60 s) startet für jede bereite Aufgabe einen Worker-Prozess des
zugewiesenen Profils und beendet ihn nach Abschluss. Es laufen also keine sieben dauerhaft kostenden Prozesse, und kein Worker
hält den Chat- oder HTTP-Request: `POST /api/v1/tasks` endet, sobald Hermes die Aufgabe gespeichert hat.

Hermes übernimmt dabei:

- atomaren Claim
- Heartbeat
- Laufzeitgrenze `--max-runtime`, danach SIGTERM/SIGKILL und erneutes Einreihen
- Fehlerzähler `failure_limit` bzw. `--max-retries`
- Idempotenzschlüssel
- Eltern/Kind-Verknüpfung (`--parent`, `link`)
- Rückholen hängender Läufe
- Abgleich verwaister Worker beim Neustart (`reconcile_orphans`)

## 2. Routing-Regeln

| Aufgabe betrifft | Profil | Begründung |
|---|---|---|
| Aufgabenliste, Zerlegung, Fortschritt | `tasks` | einzige Stelle für Aufgabenstatus |
| Mail, Messenger, Telefon | `communication` | Entwürfe; Versand nur nach Freigabe |
| Termine, freie Zeitfenster | `calendar` | Termine nur nach Freigabe anlegen |
| Zeitpläne, Auslöser, Cron | `automations` | |
| Web-/Dokumentrecherche | `research` | |
| Schwellenwerte, Systemmeldungen | `alerts` | meldet, repariert nicht |
| Prüfprotokoll, Nachweise | `audit` | liest nur; schreibt keine Auditbeweise um |

- **Eindeutig:** Die Aufgabe geht direkt an das Profil (`agentId` → `assignee`, `adapters/hermes/src/tasks-adapter.ts`).
- **Mehrdeutig:** Die Aufgabe geht in die Triage (`--triage`). Der Hermes-Decomposer (`kanban.auto_decompose`) zerlegt sie
  und verteilt die Teile. Die Elternaufgabe bleibt bei `kanban.orchestrator_profile` (leer = Standardprofil).
- **Mehrere Bereiche:** Die Elternaufgabe gehört `tasks`, je Bereich gibt es eine Kindaufgabe beim zuständigen Profil
  (`--parent`). Ein Profil ändert nie Daten eines fremden Bereichs, sondern legt dafür eine Kindaufgabe an.
- **Rückfrage:** Fehlt eine Angabe, blockiert die Aufgabe mit Frage (`block`) und rät nicht.

## 3. Grenzen (DASH-16.03) und wo sie eingestellt werden

| Grenze | Hermes-Schlüssel | Dashboard | Live gesetzt |
|---|---|---|---|
| gleichzeitig insgesamt | `kanban.max_in_progress` | Hermes-Einstellungen → Betrieb | 4 |
| gleichzeitig je Agent | `kanban.max_in_progress_per_profile` | dito | 1 |
| gleichzeitig je Board | `kanban.max_spawn` | dito | leer |
| Fehlversuche bis Sperre | `kanban.failure_limit` / `--max-retries` | dito | 2 |
| hängender Lauf (ohne Heartbeat seit 1 h) | `kanban.dispatch_stale_timeout_seconds` | dito | 14400 |
| Laufzeit je Aufgabe | `--max-runtime` | je Aufgabe | 15 min im Test |
| Laufbudget je Agent-Lauf | `agent.run_budget_seconds` | Hermes-Einstellungen → Agent | – |

**Wirksamkeit:** Der Dispatcher liest `kanban.*` nur beim Gateway-Start (`gateway/kanban_watchers.py:270`). Nach
`config set kanban.max_in_progress 4` liefen ohne Neustart weiterhin sieben Aufgaben gleichzeitig. Das Dashboard nennt
deshalb „next Hermes gateway start“ als Wirkungszeitpunkt.

**Nicht in Hermes vorhanden (offen):** eine Grenze je Modellanbieter und eine maximale Kindtiefe. Laut
`kanban_db_dispatch.py` begrenzt Hermes nur global, je Profil und je Board.

## 4. Belege

### DASH-15.04: sieben Profile als echte Worker

Lauf `dash15-20261028-222515`, je Profil eine rein lesende Testaufgabe:

| Profil | Aufgabe | Ergebnis |
|---|---|---|
| tasks | `t_1a42974f` | completed |
| communication | `t_86654486` | completed |
| calendar | `t_e75322eb` | completed |
| automations | `t_786e9ef4` | completed |
| research | `t_fde7049f` | completed |
| alerts | `t_d0528c41` | completed |
| audit | `t_88dcb3a4` | completed |

- Alle Starts lagen innerhalb von 10 s, die Enden etwa 70 s später. Das belegt sieben gleichzeitig laufende,
  unabhängige Worker.
- Sechs Ergebnisse beginnen mit der Korrelationskennung. Audit hat die Kennung weggelassen und ist über die Aufgaben-ID
  zugeordnet.

### DASH-16.03: Grenzen nach Gateway-Neustart

Gateway-Neustart um 22:31:55, danach sechs Aufgaben in einem Durchgang:

| Profil | Aufgabe | Start (Unix) | Ende (Unix) |
|---|---|---|---|
| audit | `t_e95e68a5` | 1793223405 | 1793223469 |
| audit | `t_e062cf4a` | 1793223472 | 1793223515 |
| tasks | `t_b1952844` | 1793223409 | 1793223480 |
| calendar | `t_15644d68` | 1793223409 | 1793223503 |
| research | `t_6d064eab` | 1793223410 | 1793223491 |
| alerts | `t_a4008e55` | 1793223533 | 1793223573 |

- Höchste Gleichzeitigkeit war 4 (`max_in_progress=4`).
- `alerts` startete erst, nachdem ein Platz frei wurde.
- Die zweite Audit-Aufgabe startete erst nach dem Ende der ersten (`max_in_progress_per_profile=1`).
- Alle sechs Läufe endeten mit `completed`.
- Konfig-Sicherung vor der Änderung: `~/friday/backups/dash15-acceptance-20261028-222515/`.

## 5. Offene Punkte

- **Harte Bereichstrennung (DASH-15.04 „verbotene bereichsfremde Mutation auf Backendebene“):** Alle Worker laufen unter
  demselben Linux-Benutzer. Profil-Home (`terminal.home_mode: auto`), Profil-`.env` (`agent/secret_scope.py`), eigene
  Skill-Sets und Toolsets je Profil grenzen ab. Ein Profil mit `terminal` kann Zugangsdaten anderer Bereiche aber über
  absolute Pfade lesen (z. B. `~/.config/friday/{mail,calendar}`). Eine harte Grenze verlangt eigene Linux-Benutzer je
  Profil oder `terminal.backend: docker`. Das ist eine Architekturentscheidung für den Betreiber und nicht umgesetzt.
- **DASH-16.02/16.05:** Sprache und Chat routen noch nicht in Domain-Aufgaben. `installer/voice/friday_voice.py`
  `_ask_hermes` ruft synchron `/v1/chat/completions` auf (Timeout 900 s). Ein Rechercheauftrag per Sprache blockiert damit
  das Gespräch.
- **Abbruch an Kinder weitergeben (DASH-16.04):** Im Hermes-Adapter umgesetzt. Erst wird der ganze Baum gelesen
  (höchstens 64 Nachkommen, Tiefe 8), dann werden offene Nachkommen von unten nach oben archiviert, zuletzt die
  Elternaufgabe. Abgeschlossene Kinder bleiben `done`. Scheitert ein Kind, bleibt die Elternaufgabe offen und der Abbruch
  lässt sich wiederholen. Die Reihenfolge ist Pflicht: Hermes setzt Kinder eines archivierten Elternteils auf `ready`
  (`hermes_cli/kanban_db.py` archive_task). Offen N-095: Vorschautext und Mock-Parität.
