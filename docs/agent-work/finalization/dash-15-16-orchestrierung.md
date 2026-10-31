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

### Versionssemantik bei Modell- und Profiländerung (DASH-15.04)

Eine Profilkonfiguration (`~/.hermes/profiles/<p>/config.yaml`, z. B. `model.default`, `fallback_model`, Grenzen) hat
keine eigene Versionsnummer. Maßgeblich ist der Stand der Datei **beim Start des Worker-Prozesses**:

- Ein laufender Lauf behält Modell und Konfiguration, mit denen sein Worker gestartet wurde, bis er endet.
- Jeder danach gestartete Lauf, auch ein Retry oder ein erneut eingereihter Lauf, liest die Profilkonfiguration neu
  (`hermes -p <p> … chat`, eigener Prozess je Lauf, `hermes_cli/kanban_db_dispatch.py` `_worker_argv`).
- Ein Modell-Override an der Aufgabe (`model`/`provider` bei `POST /api/v1/tasks` -> `model_override`) geht der
  Profilroute immer vor.
- Ist das Profilmodell beim Provider nicht verfügbar, wechselt Hermes im selben Lauf auf `fallback_model` (der Reihe
  nach); das tatsächlich genutzte Modell steht in der Hermes-Session des Laufs (`state.db`, Spalte `sessions.model`).
- `kanban.*` liest der Dispatcher nur beim Gateway-Start (siehe Abschnitt 3); Modell und Profilgrenzen brauchen keinen
  Neustart.
- `Task.model` im Command Center zeigt die konfigurierte Route (Override, sonst das aktuelle Profilmodell), nicht das
  tatsächlich genutzte Modell eines vergangenen Laufs. Nach einer Profiländerung zeigt eine noch laufende oder
  abgeschlossene Aufgabe daher schon die neue Route; Belege für den Lauf liefert die Hermes-Session.

Live-Abnahme 2026-10-30 (Profil `research`, Lauf `sem-20261030-105235`, Sicherung
`~/friday/backups/dash15-semantics-20261030-105235/`): Aufgabe A startete mit `deepseek-v4-pro`; während A lief, wurde
`model.default` auf den nicht existierenden Wert `deepseek-v4-pro-semprobe` gesetzt. A lief mit `deepseek-v4-pro` zu Ende.
Die danach angelegte Aufgabe B startete mit `deepseek-v4-pro-semprobe`, bekam vom Provider `NotFoundError` und lief
über den Fallback `qwen3.8-max` fertig. Nach dem Zurücksetzen startete Aufgabe C wieder mit `deepseek-v4-pro`. Alle drei
Läufe `completed`; die Profilkonfiguration ist danach bitgleich mit der Sicherung.

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
| Schritte je Agent-Lauf | `agent.max_turns` | Hermes-Einstellungen → Agent | – |
| Tiefe von Unteragenten | `delegation.max_spawn_depth` (1–3, Default 1 = flach) | Hermes-Einstellungen → Agent | – |
| gleichzeitige Unteragenten je Lauf | `delegation.max_concurrent_children` (1–16, Default 10) | dito | – |
| Schrittbudget je Unteragent | `delegation.max_iterations` (10–1000, Default 250) | dito | – |
| Unteragent ohne Fortschritt | `delegation.child_timeout_seconds` (0 = aus) | dito | – |

**Wirksamkeit:** Der Dispatcher liest `kanban.*` nur beim Gateway-Start (`gateway/kanban_watchers.py:270`). Nach
`config set kanban.max_in_progress 4` liefen ohne Neustart weiterhin sieben Aufgaben gleichzeitig. Das Dashboard nennt
deshalb „next Hermes gateway start“ als Wirkungszeitpunkt.

Die `delegation.*`-Grenzen liest Hermes beim nächsten `delegate_task`-Aufruf, ein Gateway-Neustart ist nicht nötig.

**Kindtiefe:** Unteragenten (`delegate_task`) begrenzt `delegation.max_spawn_depth`. Kanban-Unteraufgaben, die ein
Worker selbst anlegt, haben in Hermes keine Tiefengrenze. Sie zählen aber gegen die Kanban-Grenzen oben, und der
Abbruch liest höchstens 64 Nachkommen bis Tiefe 8.

**Nicht in Hermes vorhanden:**

- eine Grenze je Modellanbieter. Solange alle Profile denselben Anbieter nutzen (FRIDAY-2: ein Anbieter), wirkt
  `kanban.max_in_progress` als Anbietergrenze.
- ein Kostenlimit in Euro. Kosten begrenzen Schritt- und Zeitbudgets (`agent.max_turns`, `agent.run_budget_seconds`,
  `delegation.max_iterations`) zusammen mit den Parallelitätsgrenzen. Ein echtes Geldlimit bräuchte die Abrechnungsdaten
  des Anbieters.

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

- **Harte Bereichstrennung (DASH-15.04):** Umgesetzt nach `n-094-profil-benutzer-entwurf.md` (eigene Linux-Benutzer je
  Domain-Profil, SSH-Terminal-Backend) und am 2026-10-30 live abgenommen (N-094, Kanban-Lauf `dash15ssh-20261030-091152`).
- **DASH-16.02 Sprache -> Domain-Aufgabe:** Umgesetzt. Bei `background` legt `installer/voice/domain_task_voice.py`
  ueber `POST /api/v1/voice/tasks` eine Aufgabe beim Profil an (Einordnung nach Stichworten: Pruefen -> audit,
  Warnen/Ueberwachen -> alerts, Recherche -> research, sonst tasks), sagt "Ich gebe das an den ...-Agenten" und fragt
  den Status alle 10 s ab (hoechstens 30 min). Das Ergebnis kommt aus `Task.resultSummary` (Hermes `latest_summary`).
  Ohne erreichbare Control API bleibt der alte synchrone Weg.
- **DASH-16.02 Text-Chat -> Domain-Aufgabe (2026-10-31, #159):** Ohne commands-Adapter (Live) wird Freitext der
  Textleiste mit derselben Einordnung (`services/domain-routing.ts`) nach Vorschau und Bestaetigung als Aufgabe beim
  Profil angelegt (Label `tenant:chat-<bereich>`); `POST /api/v1/commands` antwortet sofort mit `accepted` und
  `taskId`, das Ergebnis steht unter Aufgaben. Kein Request wartet auf den Worker.
- **DASH-16.05 Messung (2026-10-31, #160):** Der Sprachdienst meldet `latency` (letzte 200 Werte) fuer
  Sprecherpruefung, STT, Router, Modellantwort (Hermes, extern) und Antwortbeginn (Ende der Aufnahme bis zum ersten
  ausgegebenen Audio). Die Sprachseite zeigt aktuell/Mittel/p95; die Abnahme p95 <= 2 s erfolgt live.
- **DASH-16.04-16.06 im Sprachdienst:** Benannter Abbruch ("brich die Recherche ab") ueber
  `POST /api/v1/voice/tasks/{taskId}/cancel`; bei mehreren passenden Auftraegen fragt Friday nach. "Stopp" beendet
  nur Dialog und Audio, die Aufgabe laeuft weiter. Statusfragen werden aus dem lokalen Stand beantwortet (kein Netz,
  kein Modell). Ergebnisse werden 3 s gebuendelt und erst nach einer laufenden Ansage gesprochen. Offene Auftraege
  stehen in `<data>/voice-bridge/domain-tasks.json` und werden nach einem Neustart weiter beobachtet.
- **Abbruch an Kinder weitergeben (DASH-16.04):** Im Hermes-Adapter umgesetzt. Erst wird der ganze Baum gelesen
  (höchstens 64 Nachkommen, Tiefe 8), dann werden offene Nachkommen von unten nach oben archiviert, zuletzt die
  Elternaufgabe. Abgeschlossene Kinder bleiben `done`. Scheitert ein Kind, bleibt die Elternaufgabe offen und der Abbruch
  lässt sich wiederholen. Die Reihenfolge ist Pflicht: Hermes setzt Kinder eines archivierten Elternteils auf `ready`
  (`hermes_cli/kanban_db.py` archive_task). Die Abbruchvorschau nennt mitabgebrochene Unteraufgaben (N-095).
