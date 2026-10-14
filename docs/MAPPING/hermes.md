# Mapping: Hermes -> Tasks, Activity, Agents

Zielpaket: `adapters/hermes-placeholder` (drei Adapter `hermes-tasks`, `hermes-activity`, `hermes-agents`).
Entscheidung: **ein Adapter je Kategorie**, ein Paket. Jede Kategorie ist einzeln zwischen `mock`/`live` umschaltbar, hat eigene Health,
Capabilities und Circuit Breaker und fällt isoliert aus (PLAN §10.10 Hybridbetrieb).

## Was über Hermes bekannt ist (verifiziert)

Aus `..\voice\jarvis_voice.py` (`_ask_hermes`): Hermes bietet eine **OpenAI-kompatible Chat-Schnittstelle** (`hermes_url`,
Body `{model, messages}`, Antwort `choices[0].message.content`) mit `Authorization: Bearer <hermes_key_file>`; das Modell heißt
standardmäßig `kira`. Der Router (`ROUTER_PROMPT`) kennt Kimi-Stufen `K1/K2/K3` (low/high/max), Aufgaben mit `BG = 1` laufen im
Hintergrund. Tier-2/3-Aktionen werden von Hermes nur als Entwurf plus Bestätigungsanfrage ausgeführt.

**Nicht verifiziert:** Endpunkte für Aufgabenliste, Aktivität und Agentenstatus. Die Tabellen unten beschreiben das Zielmodell
(PLAN §28/§30) und die Quelle, die in dieser Reihenfolge zu wählen ist: unterstützte HTTP-API -> CLI -> Eventstrom/Logdatei.
**Keine direkten Zugriffe auf interne Hermes-Datenbanken** (PLAN §1.1 Nr. 17). Vor der Implementierung ist die installierte
Hermes-Version festzustellen und deren Dokumentation zu verwenden (PLAN §29).

Platzhalter-Config (`baseUrl`, `apiToken` als Secret, `timeoutMs`, `eventsPath`): `apiToken` ist eine Referenz auf die Schlüsseldatei,
nie der Klartext in der Config.

## hermes-tasks -> `Task`

| Hermes-Konzept (Ziel)                         | `Task`                                   | Regel                                                                                                                                                                                   |
| --------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Aufgaben-/Kanban-Karte, Job-Id                | `id`, `source.externalId`                | `createIdCodec("task")`                                                                                                                                                                 |
| Titel / Anweisung                             | `title`, `description`                   | gekürzt auf 300 Zeichen im Titel                                                                                                                                                        |
| Spalte / Zustand                              | `status`                                 | Backlog -> `triage`/`todo`; bereit -> `ready`; läuft -> `running`; wartet auf Mensch -> `waiting`; Review -> `review`; fertig -> `done`; Fehler -> `failed`; abgebrochen -> `cancelled` |
| Priorität                                     | `priority`                               | Sprach-Router `P0..P4` direkt (`PRIO` im Router-Prompt)                                                                                                                                 |
| zuständiger Agent / Profil                    | `agentId`, `agentName`                   | `createIdCodec("agent")`                                                                                                                                                                |
| Aufwandsstufe (`kimi_low/high/max`)           | `model`                                  | Anzeigename des Modells; Stufe zusätzlich als Label `effort:low                                                                                                                         | high | max` |
| Hintergrundflag (`BG`)                        | `labels`                                 | `background`                                                                                                                                                                            |
| Fortschritt                                   | `progress`                               | nur wenn Hermes eine Zahl meldet; sonst `indeterminate` (laufend) bzw. `none`                                                                                                           |
| Tool-Aufrufe                                  | `toolCalls[]`                            | Name -> `tool`, Dauer -> `durationMs`, Ergebnis -> `status`                                                                                                                             |
| Bestätigung offen                             | `approvalIds`, `blockers[kind=approval]` | Tier-2/3-Aktion wartet auf Freigabe                                                                                                                                                     |
| Voice-Herkunft (`channel = voice`, `task_id`) | `sourceRefs`, `createdBy`                | `createdBy = {type: "user", id: "owner"}`                                                                                                                                               |

Capabilities (Ziel): `tasks.read` zuerst, danach `tasks.create`, `tasks.cancel`, `tasks.stream`. Pause/Resume nur, wenn Hermes sie anbietet.

## hermes-activity -> `ActivityEvent`

| Hermes-Ereignis (Ziel)                                 | `kind`         | Hinweise                                                   |
| ------------------------------------------------------ | -------------- | ---------------------------------------------------------- |
| Nutzeranfrage (Sprache/Chat)                           | `user_request` | `actor = {type: user}`; Voice: `channel = voice` im Detail |
| Aufgabe angelegt/geändert/beendet                      | `task`         | `taskId` gesetzt                                           |
| Agentenentscheidung, Router-Entscheidung, Modellaufruf | `agent`        | `model`, `durationMs`, `summary`                           |
| Tool-Aufruf                                            | `tool_call`    | `tool`, `status` started/running/succeeded/failed          |
| Lesezugriff auf eine Quelle (Datei, Web, Mail)         | `source_read`  | `details` ohne Inhalte                                     |
| Ergebnis / Antworttext                                 | `result`       | `result` gekürzt                                           |
| erzeugtes Artefakt                                     | `artifact`     | verweist auf `file_`-ID                                    |
| Adapter-Probleme (z. B. Hermes nicht erreichbar)       | `adapter`      | `adapterId`, `error` als `ErrorDetail`                     |
| Systemmeldung                                          | `system`       |                                                            |

`correlationId` aus der Hermes-Anfrage-ID übernehmen (`task_id`); `sequence` vergibt der Hub, nicht der Adapter. Fehler werden als
`ErrorDetail` normalisiert, nie als Rohtext oder Stacktrace weitergereicht.

## hermes-agents -> `Agent`

| Hermes-Konzept (Ziel)  | `Agent`                                   | Regel                                                                                                                                                                         |
| ---------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent-/Profilname      | `name`, `id`                              | `createIdCodec("agent")`                                                                                                                                                      |
| Rolle                  | `role`                                    | frei, z. B. "Assistentin (Kira)"                                                                                                                                              |
| Laufstatus             | `status`                                  | arbeitet -> `working`; frei -> `idle`; startet -> `starting`; wartet auf Mensch/Freigabe -> `waiting`; pausiert -> `paused`; Fehler -> `error`; nicht erreichbar -> `offline` |
| aktuelle Aufgabe       | `currentTaskId`                           | über `hermes-tasks`-Codec                                                                                                                                                     |
| Modell                 | `model`, `reasoningLevel`                 | `kimi_low/high/max` -> `low/high/max` (`none`/`medium` ohne Hermes-Entsprechung)                                                                                              |
| letztes Lebenszeichen  | `heartbeatAt`                             | -> `jarvis.agent.heartbeat`                                                                                                                                                   |
| Erfolgsquote, Laufzeit | `successRate`, `runtimeMs`, `performance` | aus Hermes-Statistik; fehlt sie -> `null`                                                                                                                                     |

## Ereignisse

Task-Änderungen -> `jarvis.task.*`; Aktivität -> `jarvis.activity.appended`; Agentenwechsel -> `jarvis.agent.status_changed`,
Heartbeats -> `jarvis.agent.heartbeat`. Quelle: SSE/Polling an `eventsPath`; Reconnect mit gemerktem Cursor wie in `example-tasks.md`.
