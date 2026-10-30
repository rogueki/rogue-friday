# Mapping: Hermes Agent -> Tasks, Activity, Agents

Zielpaket: `adapters/hermes-placeholder` (drei Adapter `hermes-tasks`, `hermes-activity`, `hermes-agents`).
Entscheidung bleibt: **ein Adapter je Kategorie**, ein Paket, je Kategorie einzeln `mock`/`live`, eigene Health, Capabilities und
Circuit Breaker (PLAN §10.10). Direkter Zugriff auf Hermes-Datenbanken (`state.db`, `kanban.db`) bleibt verboten (PLAN §1.1 Nr. 17).

Stand dieses Dokuments: **verifiziert gegen Quellcode und eine laufende Instanz** (Phase B.2). Alles, was nicht belegt ist, steht
ausschließlich in Abschnitt 9 „Annahmen (unbelegt)".

## 1. Quelle, Version, Methode

| Punkt | Wert |
| --- | --- |
| Projekt | Hermes Agent, Nous Research, MIT |
| Repository | <https://github.com/NousResearch/hermes-agent> |
| Untersuchter Commit | `0e427d788d253630d38a3a51cd76849e73cd6925` (main, 2026-10-13, Tag `v0.22.0+canary.20261014T070054Z`) |
| `hermes --version` (live) | `Hermes Agent vgit.0e427d7 (2026.9.24)` |
| Python | 3.14.6 (`requires-python >=3.11,<3.15`) |
| Installationsweg | Installer ruft `curl https://hermes-agent.nousresearch.com/install.sh` und `--skip-setup` auf (`installer/wsl/setup_hermes.sh`). `scripts/install.sh` im Repo klont `BRANCH="main"` (Zeile 24), `--skip-setup` ist akzeptiert (Zeile 62). |

**Wichtig: der Installer pinnt keine Version.** Es wird immer der aktuelle `main` installiert. Der Adapter darf sich daher nicht auf
Feldreihenfolgen oder Versionsnummern verlassen, sondern muss defensiv parsen (unbekannte Felder ignorieren, fehlende Felder
tolerieren) und die Version beim Start über `/api/health` (Dashboard) protokollieren.

Methode und Grenzen der Verifikation:

- Quellcode: `git clone` des Commits; Dateien/Zeilen unten beziehen sich auf diesen Commit
  (Permalink-Schema `https://github.com/NousResearch/hermes-agent/blob/0e427d788d253630d38a3a51cd76849e73cd6925/<Datei>#L<Zeile>`).
- Live: Installation in der Cloud-VM (`uv venv --python 3.14`, `uv pip install -e ".[all]"`, `HERMES_HOME` im Scratch-Verzeichnis), Gateway mit
  den **Installer-Variablen** (`API_SERVER_ENABLED=true`, `API_SERVER_HOST=127.0.0.1`, `API_SERVER_PORT=43693`, `API_SERVER_KEY=<Dummy, 64 Hex>`,
  `API_SERVER_MODEL_NAME=friday`) und Dashboard mit dem Installer-Aufruf (`hermes dashboard --host 127.0.0.1 --port 43691 --no-open --skip-build`).
  Als LLM diente ein lokaler Fake-OpenAI-Server (`model.provider=custom`), kein echter Kimi-Key.
- **BLOCKED (nur Ausnahmen):** `https://hermes-agent.nousresearch.com/` (install.sh und Docs-Seite) ist über den Cloud-Proxy mit 403 gesperrt.
  Die dokumentierte Kanban-Seite (<https://hermes-agent.nousresearch.com/docs/user-guide/features/kanban>, in `hermes kanban --help` genannt)
  konnte deshalb nicht gelesen werden; Ersatz ist der Quelltext (`website/docs` liegt im Repo, `hermes_cli/kanban.py`, `plugins/kanban/`).
  Ob die vom Proxy gesperrte `install.sh` identisch mit `scripts/install.sh` im Repo ist, ist **nicht belegt**.
  Echtes Kimi (`kimi-coding`, Modell `k3`) wurde nicht getestet; der Provider-Pfad scheitert ohne gültigen Key/Paket (siehe 9.8).

## 2. Architektur: drei Schnittstellen, nicht eine

Hermes bietet **nicht** eine HTTP-API mit allem, sondern drei Zugänge mit unterschiedlicher Auth. Das ist die wichtigste Abweichung vom
alten Dokument.

| Zugang | Adresse (Installer) | Auth | Liefert |
| --- | --- | --- | --- |
| **API-Server** (Gateway-Plattform `api_server`, aiohttp) | `127.0.0.1:43693` | `Authorization: Bearer <API_SERVER_KEY>` (= Inhalt von `C:\Friday\config\hermes_api.key`) | Chat (OpenAI-kompatibel), Runs mit SSE, Sessions + Nachrichten (inkl. Tool-Calls), Health |
| **Dashboard** (FastAPI/uvicorn) | `127.0.0.1:43691` | Header `X-Hermes-Session-Token: <Token>`; Token steht **pro Prozessstart zufällig** im HTML von `GET /` | Kanban-REST (Plugin), Sessions, Analytics, Profile, Cron, Logs, Status |
| **CLI** `hermes kanban ...` | im WSL-Linux-Benutzer | lokales Dateisystem (`HERMES_HOME`) | Kanban mit `--json` |

Der **Kanban ist nicht über den API-Server (43693) erreichbar** (`GET /api/kanban/tasks` -> 404, keine Kanban-Route in der Routentabelle).
Kanban-Daten gibt es nur über Dashboard-REST (43691) oder CLI.

## 3. API-Server (Port 43693)

### 3.1 Start, Bind, Auth

| Punkt | Befund | Beleg |
| --- | --- | --- |
| Start | Kein eigener Befehl: die Plattform `api_server` startet **im Gateway** (`hermes gateway run`, vom Installer als systemd-Dienst `hermes-gateway`), sobald `API_SERVER_ENABLED=true`. | Live: `hermes gateway run` -> Log „API server listening", `gateway/platforms/api_server.py:4569` |
| Host/Port | `API_SERVER_HOST` (Default `127.0.0.1`), `API_SERVER_PORT` (Default `8642`). **43693 setzt der Installer** über `~/.hermes/.env`. | `api_server.py:216-230`; `setup_hermes.sh` Zeile „API-Server" |
| Modellname | `API_SERVER_MODEL_NAME=friday` -> `GET /v1/models` liefert genau `friday`. | Live |
| Auth | **Nur** `Authorization: Bearer <key>`; Vergleich konstantzeitig. `X-API-Key` o. ä. wird **nicht** akzeptiert (401). Ohne/falscher Key: HTTP 401, Body `{"error":{"message":"Invalid gateway API key (API_SERVER_KEY)","type":"gateway_auth_error","code":"gateway_auth_failed"}}`. | `api_server.py:1559-1581`; Live |
| Schlüsselstärke | Server startet nicht, wenn der Key fehlt oder < 16 Zeichen/Platzhalter ist. Der Installer erzeugt Zufalls-Hex (`hermes_api.key`), erfüllt das. | `api_server.py:4421-4450` |
| Ohne Auth erreichbar | nur `GET /health` und `GET /v1/health` | Live |
| Profil-Spiegel | Jede Route existiert zusätzlich unter `/p/<profile>/...` (Multiplex); für uns irrelevant. | `api_server.py:4487-4492` |
| CORS | aus (`features.cors=false`) | `/v1/capabilities` live |

Die Datei `hermes_api.key` wird im Installer als Bearer-Token für `/v1/...` verwendet; der Adapter muss sie als Secret-Referenz lesen (nie in Config-Klartext).

### 3.2 Endpunkte (Auszug; vollständige Tabelle `api_server.py:1718-1768`, plus Runs `api_server_runs.py:234-240`)

Legende Beleg: **L** = live getestet in dieser Session, **Q** = nur aus Quelltext.

| Endpoint | Methode | Auth | Request | Response | Beleg |
| --- | --- | --- | --- | --- | --- |
| `/health`, `/v1/health` | GET | keine | - | 200 `{"status":"ok","platform":"hermes-agent","version":"unknown"}` (**version ist hier nicht brauchbar**, `unknown`) | L |
| `/health/detailed` | GET | Bearer | - | 200 `{status, readiness:{status, checks:{state_db,session_store,config,model,disk{used_percent,free_bytes},gateway{state,connected_platforms,platforms},background_queues{active_api_runs,process_completions,active_delegations}}}, platform, version, gateway_state, platforms{api_server{state,error_code,error_message,updated_at,listener_base,metrics{host,port,active_runs,stored_runs,last_request_at,last_heartbeat,metrics_today{day,requests,messages,tokens,latency_p95_ms}}}}, active_agents, gateway_busy, gateway_drainable, exit_reason, updated_at, pid, last_heartbeat}` | L |
| `/v1/models` | GET | Bearer | - | 200 `{"object":"list","data":[{"id":"friday","object":"model","created":<unix>,"owned_by":"hermes","permission":[],"root":"friday","parent":null}]}` (das **Installer-Healthcheck-Ziel**) | L |
| `/v1/capabilities` | GET | Bearer | - | 200 `{"object":"hermes.api_server.capabilities","platform","model","auth":{"type":"bearer","required":true},"runtime":{...},"features":{chat_completions, responses_api, run_submission, run_events_sse, run_stop, run_steer, run_approval_response, tool_progress_events, approval_events, session_resources, session_chat, jobs_admin:false, admin_config_rw:false, memory_write_api:false, skills_api:true, session_continuity_header:"X-Hermes-Session-Id", ...},"endpoints":{<name>:{method,path}}}` - **Feature-Detection nutzen** | L |
| `/v1/chat/completions` | POST | Bearer | OpenAI-Format `{model, messages[], stream?}`; Header `X-Hermes-Session-Id` setzt die Konversation fort | 200 `{id:"chatcmpl-...",object:"chat.completion",created,model:"friday",choices:[{index,message:{role,content},finish_reason}],usage:{prompt_tokens,completion_tokens,total_tokens}}`; mit `stream:true` SSE `data: {chat.completion.chunk}` ... `data: [DONE]` und zusätzliche Events `event: hermes.tool.progress` mit `data: {"tool","emoji","label","toolCallId","status":"running"\|"completed"}` | L |
| `/v1/responses`, `/v1/responses/{id}` (GET/DELETE) | POST/GET/DELETE | Bearer | OpenAI Responses | OpenAI-Responses-Format | Q |
| `/v1/runs` | POST | Bearer | `{input, session_id?, model?, instructions?, conversation_history?, previous_response_id?}`; Header `X-Hermes-Session-Key` optional | **202** `{"run_id":"run_<32hex>","status":"started","replayed":false}` | L |
| `/v1/runs/{run_id}` | GET | Bearer | - | 200 `{"object":"hermes.run","run_id","status":"queued\|running\|completed\|failed\|interrupted\|stopping","updated_at","created_at","session_id","model","last_event","output","usage{input_tokens,output_tokens,total_tokens,cache_read_tokens,cache_write_tokens}","runtime{provider,model,route_source}","completed","partial","interrupted","error"}`; unbekannt: 404 `{"error":{"message":"Run not found: <id>","type":"invalid_request_error","code":"run_not_found"}}`. **Es gibt keine Run-Liste.** | L |
| `/v1/runs/{run_id}/events` | GET (SSE) | Bearer | - | `text/event-stream`: `: open`, dann je Event `id: <seq>` + `data: {...}`; Ende `: stream closed`. Ereignisse siehe 3.3. | L |
| `/v1/runs/{run_id}/approval` | POST | Bearer | `{choice: once\|session\|always\|deny, request_id?, all?}` | 200 `{"object":"hermes.run.approval_response","run_id","choice","resolved"}`; 409 `approval_not_active`/`approval_not_pending` | Q (`api_server_runs.py:1170-1225`) |
| `/v1/runs/{run_id}/steer`, `/stop` | POST | Bearer | `{input}` / - | steer: Text; stop: `{"run_id","status":"stopping"}` | Q |
| `/api/sessions` | GET | Bearer | Query `limit` (<=200, Default 50), `offset`, `source`, `include_children`, `title`, `include_hidden` | 200 `{"object":"list","data":[Session],"limit","offset","has_more"}` | L |
| `/api/sessions` | POST | Bearer | `{title?}` | **201** `{"object":"hermes.session","session":Session}` | L |
| `/api/sessions/{id}` | GET/PATCH/DELETE | Bearer | - | `{"object":"hermes.session","session":Session}` | L (GET) |
| `/api/sessions/{id}/messages` | GET | Bearer | Query `limit`, `offset`, `order`, `include_compacted` | 200 `{"object":"list","session_id","data":[Message]}` | L |
| `/api/sessions/{id}/chat`, `/chat/stream`, `/fork`, `/model` | POST | Bearer | - | Chat in Session / Fork / Modell-Lock | Q |
| `/api/jobs` ... (Cron) | GET/POST/... | Bearer | - | `{"jobs":[]}` (GET leer); `POST {}` -> `{"error":"Name is required"}`. `features.jobs_admin=false` | L (GET), Q |
| `/v1/toolsets` | GET | Bearer | - | `{"object":"list","platform":"api_server","data":[{name,label,description,enabled,configured,tools[]}]}`; `kanban`-Toolset ist **per Default `enabled:false`** | L |
| `/v1/skills` | GET | Bearer | - | in dieser Umgebung **500** `Failed to enumerate skills` (Umgebungs-/Paketproblem, nicht ausgewertet) | L |
| `/api/model/options` | GET | Bearer | - | `{"providers":[{slug,name,is_current,models[],authenticated,auth_type,key_env,...}]}` | L |

Session-Objekt (live, `GET /api/sessions`): `id` (z. B. `api_<unix>_<8hex>` oder frei gewählte `session_id`), `source` (`api_server`, `oneshot`, ...), `user_id`, `model`, `title`,
`started_at`/`ended_at` (**Float, Unix-Sekunden**), `end_reason`, `message_count`, `tool_call_count`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`,
`reasoning_tokens`, `estimated_cost_usd`, `actual_cost_usd`, `api_call_count`, `parent_session_id`, `last_active`, `preview`, `pinned`, `archived`, `hidden`,
`has_system_prompt`, `has_model_config`, `is_internal_child`.

Message-Objekt: `id` (Integer, aufsteigend, geeignet als Cursor), `session_id`, `role` (`user`/`assistant`/`tool`), `content`, `tool_call_id`,
`tool_calls` (`[{id,call_id,response_item_id,type:"function",function:{name,arguments}}]` bei Assistant-Nachrichten), `tool_name`, `timestamp` (Float),
`token_count`, `finish_reason`, `reasoning`, `reasoning_content`, `display_kind`.

**Sprachaufrufe sind sichtbar:** ein `POST /v1/chat/completions` (so ruft `friday_voice.py` Hermes) erzeugt eine Session mit `source:"api_server"` (live beobachtet, ID `api-<16hex>`),
samt Nachrichten und Tool-Calls. Der Aktivitätsadapter kann damit Voice-Aktivität ohne eigenen Run lesen.

### 3.3 Run-Ereignisse (SSE `/v1/runs/{id}/events`)

Live aufgezeichnet (Fake-LLM, ein Tool-Call):

```
: open

id: 0
data: {"event": "tool.started", "run_id": "run_6965...", "timestamp": 1791988318.97, "tool": "skills_list", "preview": null, "seq": 0}

id: 1
data: {"event": "tool.completed", "run_id": "run_6965...", "timestamp": 1791988319.14, "tool": "skills_list", "duration": 0.173, "error": false, "preview": "{\"success\": true, ...", "seq": 1}

id: 2
data: {"event": "message.delta", "run_id": "run_6965...", "timestamp": 1791988319.15, "delta": "\n\nHallo, das ist die Fake-Antwort.", "seq": 2}

id: 3
data: {"event": "reasoning.available", "run_id": "run_6965...", "timestamp": 1791988319.16, "text": "Hallo, das ist die Fake-Antwort.", "seq": 3}

id: 4
data: {"event": "run.completed", "run_id": "run_6965...", "timestamp": 1791988319.18, "output": "Hallo, das ist die Fake-Antwort.", "usage": {"input_tokens": 20, "output_tokens": 10, "total_tokens": 30, "cache_read_tokens": 0, "cache_write_tokens": 0}, "runtime": {"provider": "custom", "model": "fake-model", "route_source": "global"}, "completed": true, "partial": false, "interrupted": false, "seq": 4}

: stream closed
```

Fehlerfall (live, ohne nutzbaren Provider): `data: {"event":"run.failed","run_id":...,"timestamp":...,"error":"<Text>","seq":0}`.
Weitere Eventtypen laut Quelle (`api_server_runs.py`): `message.interim`, `approval.request`, `approval.responded`, `run.stopping`, `run.steered`, `run.interrupted` (Q).
Reconnect: Event-IDs sind `seq` ab 0; `Last-Event-ID` für Replay wurde nicht getestet (siehe 9.7).

**Für das Dashboard nicht nutzbar als globaler Eventstrom:** die Run-Events gibt es nur pro Run, und Runs, die die Sprachsteuerung per `chat/completions` startet, haben keine `run_id`.
Es existiert **kein** globaler SSE/WebSocket-Strom am API-Server.

## 4. Dashboard (Port 43691)

### 4.1 Was es ist

`hermes dashboard` startet eine FastAPI-Anwendung (uvicorn) mit einer React-SPA (`hermes_cli/web_dist`) **und** einer JSON-REST-API unter `/api/...`
(301 Pfade in `GET /openapi.json`, Swagger unter `/docs`, dort aus CDN geladen). Die SPA nutzt exakt diese API; wir können sie ebenfalls nutzen.
`--skip-build` ohne vorhandenes `web_dist` löst einen einmaligen Recovery-Build aus (npm nötig; live funktionierte das, dauert Minuten) - das ist ein
Installer-Risiko in WSL ohne Node (siehe 9.9).

### 4.2 Auth (Abweichung von „API-Key")

| Punkt | Befund | Beleg |
| --- | --- | --- |
| Header | `X-Hermes-Session-Token: <token>` (alternativ `Authorization: Bearer <token>`, live 200) | `web_server.py:406,476-487`; Live |
| Token-Herkunft | zufällig pro Prozessstart (`secrets.token_urlsafe(32)`), **oder fest über Umgebungsvariable `HERMES_DASHBOARD_SESSION_TOKEN`** | `web_server.py:399-405` |
| Token holen | steht im HTML von `GET /`: `window.__HERMES_SESSION_TOKEN__="<43 Zeichen>"`. Bei Loopback-Bind (`window.__HERMES_AUTH_REQUIRED__=false`) wird er injiziert; im „gated"-Modus (Nicht-Loopback) **nicht**. | `web_server_dashboard.py:134,154,165`; Live |
| Ohne/falsches Token | 401 `{"detail":"Unauthorized"}` | Live |
| Ohne Auth erreichbar | `GET /`, `/assets/*`, `/openapi.json`, `/docs`, `GET /api/status`, `GET /api/health` | Live |
| WebSocket | `?token=<token>` (oder `?ticket=`) als Query; ohne -> HTTP 403 beim Upgrade | `plugin_api.py:50-58`; Live |

Der Installer setzt `HERMES_DASHBOARD_SESSION_TOKEN` **nicht**. Ein Neustart des Dashboards (`Restart=on-failure`) macht jedes gemerkte Token ungültig.
Zwei Wege: (a) Adapter holt das Token per `GET /` und holt es bei jedem 401 neu (ohne Installer-Änderung); (b) Installer schreibt ein festes Token aus einer
Schlüsseldatei in `Environment=HERMES_DASHBOARD_SESSION_TOKEN=...` der Unit (sauberer; **Installer-Änderung nötig**, nicht Teil dieser Aufgabe).

### 4.3 Endpunkte, die wir brauchen (alle live getestet, sofern nicht anders markiert)

Alle Kanban-Routen unter `/api/plugins/kanban`, Quelle `plugins/kanban/dashboard/plugin_api.py`. Board-Auswahl über Query `?board=<slug>` (ohne = aktives Board, Default `default`;
unbekanntes Board -> 404 `board '<slug>' does not exist`).

| Endpoint | Methode | Auth | Request | Response | Beleg |
| --- | --- | --- | --- | --- | --- |
| `/api/health` | GET | keine | - | `{"ok":true,"version":"unknown","displayVersion":"git.0e427d7","commit":"0e427d78...","auth_required":false}` | L |
| `/api/status` | GET | keine | - | `{"version","release_date":"2026.9.24","config_version","latest_config_version","can_update_hermes","gateway_running":true,"gateway_state":"running","gateway_platforms":{"api_server":{"state":"connected","metrics":{...}}},"gateway_exit_reason","gateway_updated_at",...}` | L |
| `/api/plugins/kanban/boards` | GET | Token | - | `{"boards":[{slug,name,description,icon,color,default_workdir,project_id,created_at,archived,db_path,is_current,counts:{<status>:n},total,default_workspace_kind,project_name}],"current":"default"}` | L (`plugin_api.py:1411`) |
| `/api/plugins/kanban/board` | GET | Token | Query `board`, `tenant`, `include_archived`, `workflow_template_id`, `current_step_key` | `{"columns":[{"name":"triage\|todo\|scheduled\|ready\|running\|blocked\|review\|done","tasks":[TaskCard]}],"tenants":[],"assignees":["default","kira"],"latest_event_id":7,"now":<unix>}` | L (`:359`) |
| `/api/plugins/kanban/tasks/{id}` | GET | Token | Query `board` | `{"task":TaskDetail,"comments":[{id,task_id,author,body,created_at}],"events":[{id,task_id,kind,payload,created_at,run_id}],"attachments":[],"links":{"parents":[],"children":[]},"link_tasks":[],"child_results":[],"runs":[Run]}`; unbekannt: 404 `{"detail":"task <id> not found"}` | L (`:379`) |
| `/api/plugins/kanban/tasks` | POST | Token | `{title (Pflicht), body?, assignee?, tenant?, priority:int=0, workspace_kind?, parents[], triage:bool, idempotency_key?, max_runtime_seconds?, skills?, goal_mode?, model_override?, provider_override?, reasoning_effort?, project_id?}` | 200 `{"task":TaskDetail}` (+ `"warning"` wenn ready+assigned und kein Dispatcher läuft); `created_by` = `"dashboard"` | L (`:414-460`) |
| `/api/plugins/kanban/tasks/{id}` | PATCH | Token | `{status?, assignee?, priority?, title?, body?, result?, block_reason?, summary?, metadata?, model_override?, provider_override?, reasoning_effort?, clear_*?}` | 200 `{"task":TaskDetail}`; ungültiger Status 400 `{"detail":"unknown status: bogus"}`; nicht erlaubter Übergang -> Fehler (Matrix in `kanban_workflow.py:117-139`); unbekannte ID 404 | L (`:533,692`) |
| `/api/plugins/kanban/tasks/{id}/comments` | POST | Token | `{body, author?}` | 200 `{"ok":true}` | L |
| `/api/plugins/kanban/tasks/{id}` | DELETE | Token | - | (Löschen/Archivieren) | Q (`:719`) |
| `/api/plugins/kanban/tasks/bulk` | POST | Token | `{ids[], status?, assignee?, priority?, archive:bool, result?}` | Bulk-Ergebnis | Q (`:554,858`) |
| `/api/plugins/kanban/tasks/{id}/reclaim`, `/reassign`, `/specify`, `/decompose` | POST | Token | siehe Quelle | - | Q |
| `/api/plugins/kanban/stats` | GET | Token | Query `board` | `{"by_status":{"done":1,"triage":1},"by_assignee":{"kira":{"done":1}},"oldest_ready_age_seconds":null,"now":...}` | L |
| `/api/plugins/kanban/assignees` | GET | Token | Query `board` | `{"assignees":[{"name":"default","on_disk":true,"counts":{}},{"name":"kira","on_disk":false,"counts":{"done":1}}]}` | L |
| `/api/plugins/kanban/profiles` | GET | Token | - | `{"profiles":[{name,is_default,model,provider,description,description_auto,skill_count}]}` | L |
| `/api/plugins/kanban/workers/active` | GET | Token | Query `board` | `{"workers":[{run_id,task_id,task_title,task_status,task_assignee,profile,worker_pid,started_at,claim_lock,claim_expires,last_heartbeat_at,max_runtime_seconds}],"count":0,"checked_at":...}` (leer, weil kein Worker lief) | L (Form aus Q `:920-933`) |
| `/api/plugins/kanban/runs/{run_id}` | GET | Token | Query `board` | `{"run":Run}` | L |
| `/api/plugins/kanban/tasks/{id}/log` | GET | Token | Query `board` | `{"task_id","path","exists":false,"size_bytes":0,"content":"","truncated":false}` | L |
| `/api/plugins/kanban/diagnostics` | GET | Token | Query `board` | `{"diagnostics":[],"count":0}` | L |
| `/api/plugins/kanban/config` | GET | Token | - | `{"default_tenant":"","lane_by_profile":true,"include_archived_by_default":false,"render_markdown":true}` | L |
| **`/api/plugins/kanban/events`** | **WebSocket** | `?token=` | Query `board`, `since=<event_id>` (fehlt es: ab jetzt, kein Replay) | Server sendet bei neuen Events `{"events":[{id,task_id,run_id,kind,payload,created_at}],"cursor":<int>}` (Polling-Intervall serverseitig, max 200 je Nachricht); Client-Nachrichten werden ignoriert | L (`:1802-1850`) |
| `/api/sessions` | GET | Token | Query `limit`, `offset`, ... | `{"sessions":[SessionExt],"total","limit","offset","storage":{}}` - SessionExt = Session + `profile`, `is_active`, `unread`, `preview`, `last_active`, `tool_names`, ... | L |
| `/api/sessions/stats` | GET | Token | - | `{"total","active_store","archived","messages","by_source":{"api_server":1}}` | L |
| `/api/sessions/{id}/messages`, `/timeline` | GET | Token | - | Nachrichten bzw. `{"session_id","profile","entries":[{row_id,preview,timestamp}],"pagination":{...}}` | L (timeline) |
| `/api/analytics/usage` | GET | Token | Query `days` | `{"daily":[...],"by_model":[...],"by_task":[...],"totals":{...},"tools":[{"tool","count","percentage"}],"skills":{...}}` | L |
| `/api/logs` | GET | Token | Query `lines`, `file` | `{"file":"agent","lines":["<Logzeile>\n",...]}` (Rohtext, **nicht** für strukturierte Aktivität geeignet) | L |
| `/api/profiles` | GET | Token | - | `{"profiles":[{name,path,is_default,model,provider,has_env,skill_count,gateway_running,description,display_name,...}]}` | L |
| `/api/cron/jobs` | GET | Token | - | `[]` (Array, nicht Objekt) | L |

TaskCard/TaskDetail-Felder (live, Task `t_a90d372a`): `id` (`t_<8hex>`), `title`, `body`, `assignee`, `status`, `priority` (**Integer**, Default 0), `created_by`, `created_at`,
`started_at`, `completed_at` (**Integer Unix-Sekunden**, nullable), `workspace_kind`, `workspace_path`, `claim_lock`, `claim_expires`, `tenant`, `branch_name`, `project_id`, `result`,
`idempotency_key`, `consecutive_failures`, `worker_pid`, `last_failure_error`, `max_runtime_seconds`, `last_heartbeat_at`, `current_run_id`, `workflow_template_id`, `current_step_key`,
`skills`, `model_override`, `provider_override`, `reasoning_effort`, `max_retries`, `goal_mode`, `goal_max_turns`, `session_id`, `block_kind`, `block_recurrences`, `completion_contract`,
`age{created_age_seconds,started_age_seconds,time_to_complete_seconds}`, `latest_summary`, `current_run_started_at`; nur auf der Karte: `link_counts{parents,children}`, `comment_count`,
`progress` (**Fortschritt der Kind-Tasks**, `null` ohne Kinder - kein Agenten-Fortschritt), `diagnostics`.
Run-Felder: `id` (Integer), `task_id`, `profile`, `step_key`, `status` (`running\|done\|blocked\|crashed\|timed_out\|failed\|released\|completed`), `claim_lock`, `claim_expires`, `worker_pid`,
`max_runtime_seconds`, `last_heartbeat_at`, `started_at`, `ended_at`, `outcome` (`completed\|blocked\|crashed\|timed_out\|spawn_failed\|gave_up\|reclaimed\|null`), `summary`, `error`, `metadata`.
Event-`kind`-Werte, live gesehen: `created`, `commented`, `blocked`, `unblocked`, `completed`; laut Quelle zusätzlich u. a. `edited`, `archived`, `reclaimed`, `review_requested`, `scheduled`,
`promoted_manual`, `claim_rejected`, `spawned`, `crashed`, `timed_out`, `gave_up`, `auto_blocked`, `rate_limited` (`kanban_db.py:235`, `kanban.py watch --kinds`). Vollständigkeit nicht garantiert (siehe 9.6).

## 5. Kanban-CLI

Aufruf im WSL-Benutzer (`wsl.exe -d <Distro> -u <user> -- hermes kanban ...`); `--board <slug>` steht **vor** dem Unterbefehl (`hermes kanban --board business create ...`).
Datenablage: SQLite `~/.hermes/kanban.db` (Board `default`), weitere Boards `~/.hermes/kanban/boards/<slug>/kanban.db`; Logs `.../boards/<slug>/logs/<task>.log`.
Installer-Befehle verifiziert: `hermes kanban init` (idempotent), `hermes kanban boards create <slug> --name <Name>`, `hermes kanban boards list` (Tabelle, kein JSON-Flag).

| Befehl | Zweck | JSON? | Beleg |
| --- | --- | --- | --- |
| `kanban list [--status S] [--assignee A] [--tenant T] [--archived] [--sort ...] [--json]` | Tasks | ja: Array von Task-Objekten (Felder wie 4.3, ohne `age`/`latest_summary`) | L |
| `kanban show <id> [--json]` | Task mit Kommentaren, Events, Runs | ja: `{"task","latest_summary","parents","children","comments","events":[{kind,payload,created_at,run_id}],"runs"}`; unbekannt: Text `no such task: <id>`, Exit 1 | L |
| `kanban create "<Titel>" [--body --assignee --priority N --triage --parent --tenant --idempotency-key --created-by --model ...] [--json]` | anlegen | ja: Task-Objekt (Status `ready` wenn assigned, sonst je nach Flags; `--triage` -> `triage`) | L |
| `kanban comment <id> "<Text>"` | Kommentar | nein (`Comment added to <id>`) | L |
| `kanban block <id> [reason...] [--kind capability\|dependency\|needs_input\|transient]` / `unblock <id>` | blockieren / freigeben | nein | L |
| `kanban complete <id> [--result R]` | erledigen | nein | L |
| `kanban request-review <id> [--summary --reviewer]`, `reopen-review`, `request-changes` | Review | nein | Q (Hilfe live) |
| `kanban archive <id>...` | archivieren (= unser „abbrechen") | nein | Q |
| `kanban stats [--json]` | Zählung je Status/Assignee | ja | L |
| `kanban runs <id> [--json]` | Läufe | ja: Array `[{id,profile,status,outcome,started_at,ended_at,summary,error,metadata,worker_pid,step_key}]` | L |
| `kanban assignees [--json]`, `diagnostics [--json]` | Profile / Probleme | ja | L |
| `kanban watch [--assignee --tenant --kinds --interval]` / `tail <id>` | Live-Eventfolge im Terminal | nein (Text) | Q/Hilfe |
| `kanban dispatch`, `daemon` | Dispatcher (jetzt im Gateway) | - | Hilfe |

**Verschieben zwischen Spalten gibt es nur als Statusübergang** (`PATCH ... status`), erlaubt laut Matrix (`kanban_workflow.py:117-139`):
`triage -> todo, ready`; `todo -> triage, scheduled, ready`; `ready -> triage, todo, scheduled, blocked, review, done`; `running -> ...`; `blocked -> triage, todo, scheduled, ready, done`;
`review -> triage, todo, ready, done`; `done -> triage, todo, ready`. `running`, `review`, `scheduled` sind keine Drag-Ziele. Live bewiesen: `ready -> blocked`, `blocked -> ready` (unblock), `ready -> done`.
Der **Dispatcher läuft im Gateway** (Tick alle 60 s, `kanban.dispatch_interval_seconds`); ohne laufendes Gateway bleiben Tasks in `ready` (CLI-Ausgabe von `kanban init`).

## 6. Mapping Hermes -> kanonische Modelle

Alle IDs über `createIdCodec` (`task`, `agent`, `act`), `source.externalId` hält die Hermes-ID. Zeitstempel: Hermes liefert **Unix-Sekunden** (Integer bei Kanban, Float bei Sessions) -> ISO-8601 UTC.

### 6.1 `Task` (aus Kanban, Dashboard-REST bevorzugt)

| `Task`-Feld | Hermes-Quelle | Regel / Lücke |
| --- | --- | --- |
| `id`, `source.externalId` | `task.id` (`t_<8hex>`), ggf. mit Board: `<board>/<id>` | Task-IDs sind **pro Board** eindeutig (je Board eine DB) -> Codec muss `board` einschließen. |
| `title` | `title` | auf 300 Zeichen kürzen |
| `description` | `body` | `null` -> weglassen |
| `status` | `status` | siehe 6.4 |
| `priority` | `priority` (Integer) | Konvention (Annahme): `P0=4, P1=3, P2=2, P3=1, P4=0`; Rückrichtung `>=4 -> P0`, `<=0 -> P4`. Hermes nutzt es nur als Tiebreaker (`--priority "Priority tiebreaker"`). |
| `agentId`, `agentName` | `assignee` (Profil-/Assignee-Name) | `null` -> `agentId: null`, `agentName` weglassen; ID über Agent-Codec |
| `model` | `model_override` (nur wenn gesetzt) sonst Profil-Modell aus `/api/plugins/kanban/profiles` | `null` erlaubt; zeigt die konfigurierte Route, nicht das in einem vergangenen Lauf genutzte Modell (Versionssemantik: `docs/agent-work/finalization/dash-15-16-orchestrierung.md`) |
| `progress` | `progress` der Karte (Kind-Fortschritt) | nur wenn nicht `null`, sonst `indeterminate` bei `running`, sonst `none` (Form von `progress` bei Kindern nicht live gesehen) |
| `startedAt` | `started_at` bzw. `current_run_started_at` | `current_run_started_at` bevorzugen (läuft nach Retry neu) |
| `runtimeMs` | `(now - current_run_started_at)*1000` bei `running`, sonst `(completed_at - started_at)*1000` | abgeleitet |
| `dueAt`, `estimatedCompletionAt` | - | `null` (Hermes kennt keine) |
| `blockers[]` | `status=blocked` + letztes `blocked`-Event `payload.reason`, `block_kind`; `parents` offen -> `kind=dependency` | `needs_input`/`capability` -> `kind=approval`/`input` je kanonischem Enum |
| `lastActivityAt` | max(`created_at`, letztes Event `created_at`, `last_heartbeat_at`) | abgeleitet |
| `artifacts[]`, `artifactCount` | `attachments[]` aus Task-Detail | nur im Detail, nicht auf der Karte |
| `steps[]` | `runs[]` (je Run ein Schritt: `profile`, `status`, `summary`) | Vorschlag |
| `toolCalls[]` | **nicht im Kanban.** Nur über Sessions: `task.session_id` -> `/api/sessions/{id}/messages` (`tool_calls`/`role=tool`) | nur wenn `session_id` gesetzt (bei ACP-Tasks); sonst leer |
| `sourceRefs[]` | `session_id`, `parents`, `children` | |
| `approvalIds[]` | - | Kanban hat keine Approval-Objekte; `blocked` + `block_kind=needs_input` ist das Nächste. Run-Approvals (`approval.request`) gehören zu `/v1/runs`, nicht zu Tasks. |
| `errors[]` | `last_failure_error`, `runs[].error` | als `ErrorDetail` normalisieren |
| `createdBy` | `created_by` (`user`, `dashboard`, Agentenname) | `user`/`dashboard` -> `{type:"user"}`, sonst `{type:"agent"}` |
| `parentTaskId` | erstes Element von `links.parents` | nur im Detail |
| `labels` | - | **Hermes hat kein Label-Feld.** `tenant` (Namespace) kann `board`/Bereich abbilden; das alte `background`/`effort:*`-Label hat keine Entsprechung. |
| `version`, `updatedAt` | - | `updatedAt` = `lastActivityAt`; `version` hub-seitig |

### 6.2 `ActivityEvent`

Es gibt **keinen einheitlichen Aktivitätsfeed** in Hermes. Der Adapter bildet ihn aus drei Quellen; Reihenfolge der Qualität:

| Quelle | Zugang | `kind` | Felder |
| --- | --- | --- | --- |
| Kanban-`task_events` | WS `/api/plugins/kanban/events?since=<id>` (Live) bzw. `GET .../tasks/{id}` -> `events` (Backfill); Cursor = Event-`id` (pro Board) | `task` | `taskId`, `occurredAt = created_at`, `title` aus `kind` (z. B. „Aufgabe blockiert"), `summary` aus `payload.reason`/`summary`, `correlationId = task_id`, `status = kind`, `severity`: `crashed`/`timed_out`/`gave_up`/`auto_blocked` -> `warning`/`error`, sonst `info` |
| Sessions + Nachrichten | Poll `GET /api/sessions` (Cursor `last_active`), dann `GET /api/sessions/{id}/messages` (Cursor Message-`id`) | `user_request` (`role=user`), `agent` (`role=assistant` ohne Tool-Calls), `tool_call` (je `tool_calls[]`-Eintrag; Ergebnis aus `role=tool`), `result` | `tool = function.name`, `model = session.model`, `parentId = session.id`, `correlationId = session.id`, `details.source = session.source` (`api_server` = Sprache/Chat); **Inhalte (`content`, `arguments`) nicht in `details` übernehmen**, nur gekürzt in `summary` |
| Run-SSE | `/v1/runs/{id}/events` | `tool_call`, `agent`, `result` | nur für Runs, die der Adapter selbst startet |
| Adapter-Fehler | intern | `adapter` | `ErrorDetail` |

`sequence` vergibt der Hub. `Artifact`/`source_read` haben keine eigene Quelle (lassen sich aus Tool-Namen wie `read_file`/`web_extract` heuristisch ableiten, Annahme).
Dauer eines Tool-Calls: nur im Run-SSE (`tool.completed.duration` in Sekunden), nicht in der gespeicherten Session.

### 6.3 `Agent`

Hermes kennt „Profile" (Konfigurations-/Persönlichkeitsverzeichnisse); der Installer legt nur das Profil `default` an. Die im Kanban verwendeten Assignees (z. B. `kira`) sind
**freie Namen**, nicht notwendigerweise Profile (`on_disk:false` im Live-Test).

| `Agent`-Feld | Hermes-Quelle | Regel |
| --- | --- | --- |
| `id`, `name` | `GET /api/profiles` `profiles[].name` und `kanban/assignees` | Vereinigung beider Listen; `default` -> Anzeigename aus `display_name` oder „Hermes" |
| `role` | `description`, sonst „Assistent" | Annahme |
| `status` | siehe 6.4 | abgeleitet |
| `currentTaskId` | `kanban/workers/active` -> `task_id` mit `profile == name` oder `task_assignee == name` | nur bei laufendem Worker |
| `model` | `profiles[].model` (z. B. `k3`) | |
| `reasoningLevel` | Profil/Config `agent.reasoning_effort` (Installer: `low`); je Task `reasoning_effort` | Werte `none\|minimal\|low\|...\|ultra` laut Quellkommentar; Abbildung auf `low/high/max` ist Annahme |
| `heartbeatAt` | `workers/active[].last_heartbeat_at` (je Worker), sonst `/health/detailed.last_heartbeat` (Gateway) | |
| `startedAt`, `runtimeMs` | `workers/active[].started_at` | |
| `activeTools` | aktive Run-/Session-Tool-Calls | nur bei eigenen Runs belegbar, sonst `[]` |
| `capabilities` | `/v1/toolsets` (`enabled:true` -> Namen) | |
| `successRate`, `performance` | aus `kanban/stats` + Run-Outcomes (`completed` / (`completed`+`crashed`+`timed_out`+`gave_up`)) | abgeleitet, sonst `null` |
| `lastError` | `diagnostics` / `last_failure_error` | |

### 6.4 Statusabbildung

Hermes-Statuswerte laut `kanban_workflow.py:141` (`DEFAULT_STATUSES`): `triage, todo, scheduled, ready, running, blocked, review, done, archived`.

| Hermes `tasks.status` | `TaskStatus` | Anmerkung |
| --- | --- | --- |
| `triage` | `triage` | |
| `todo` | `todo` | wartet auch auf offene Eltern-Tasks (Block-Art `dependency`) |
| `scheduled` | `waiting` | wartet auf Zeit, nicht auf Mensch (Blocker `kind=time`) |
| `ready` | `ready` | |
| `running` | `running` | nur der Dispatcher setzt es (Worker-Claim) |
| `blocked` | `waiting` | `block_kind=needs_input\|capability` -> wartet auf Mensch; `transient` -> `failed`-Kandidat (siehe 9.5) |
| `review` | `review` | |
| `done` | `done` | |
| `archived` (nur mit `--archived`/`include_archived`) | `cancelled` | Archivieren ist das einzige „Abbrechen" |
| Task mit `last_failure_error != null` oder letztem Run-`outcome` in `crashed\|timed_out\|spawn_failed\|gave_up` und Status `blocked`/`ready` | `failed` | **abgeleitet**, nicht aus Statusfeld; Details in 9.5 |

`AgentStatus`: Gateway/Dashboard nicht erreichbar -> `offline`; Worker mit `profile==name` in `workers/active` -> `working`; Task `blocked` mit `needs_input` und Assignee == name -> `waiting`;
sonst `idle`. `starting`/`paused`/`error` haben keine belegte Hermes-Quelle (`error` ggf. aus `/health/detailed.readiness.status != ok`).

## 7. Unterstützbare Dashboard-Fähigkeiten

| Fähigkeit | Lesen | Schreiben | Weg |
| --- | --- | --- | --- |
| `tasks.read` (Liste, Detail, Filter nach Status/Assignee) | ja, live belegt | - | Dashboard-REST `board` + `tasks/{id}`; Alternative CLI `list/show --json` |
| `tasks.create` | - | ja, live belegt | `POST /api/plugins/kanban/tasks` (oder CLI `create --json`) |
| `tasks.update` (Titel, Beschreibung, Priorität, Assignee, Status) | - | ja, live belegt | `PATCH .../tasks/{id}`; Statusmatrix beachten (409/400) |
| `tasks.cancel` | - | ja, Quelle | Archivieren (`bulk archive:true` / `DELETE` / CLI `archive`); **nicht live getestet** |
| `tasks.retry` | - | teilweise, Quelle | `PATCH status=ready` aus `blocked`/`done`; `reclaim` für hängende Worker; nicht live getestet |
| `tasks.pause`/`resume` | - | nein | Hermes hat kein Pausieren; `block`/`unblock` ist semantisch „wartet auf Eingabe", nicht Pause |
| `tasks.stream` | ja, live belegt | - | WebSocket `/api/plugins/kanban/events` (Cursor `since`) |
| `activity.read` | ja (Sessions + Kanban-Events) | - | Polling/WS; kein globaler Strom |
| `agents.read` | ja (Profile + Worker + Assignees) | - | |
| `agents.pause/resume/stop` | - | nein | keine belegte Schnittstelle (Run-Stop existiert nur pro `run_id`) |
| Chat/Befehl an Hermes | - | ja, live belegt | `POST /v1/chat/completions` oder `/v1/runs` (+SSE) |
| Approvals beantworten | - | Quelle | `POST /v1/runs/{id}/approval`, nur für selbst gestartete Runs |

## 8. Fake-Upstream für Konformanztests

Es müssen **zwei** Listener emuliert werden (zwei Basis-URLs, zwei Credentials). Beide nur auf `127.0.0.1`. Zeitstempel/IDs deterministisch machen. Beispiele sind aus
den Live-Antworten abgeleitet (Pfade, Schlüssel, Namen anonymisiert).

### 8.1 Fake A: API-Server (`43693`-Äquivalent)

Auth: `Authorization: Bearer <fake-key>`; sonst 401 mit dem Body aus 3.1. `/health` und `/v1/health` ohne Auth.

| Route | Antwort (Beispiel) |
| --- | --- |
| `GET /health` | `{"status":"ok","platform":"hermes-agent","version":"unknown"}` |
| `GET /health/detailed` | `{"status":"ok","readiness":{"status":"ok","checks":{"state_db":{"status":"ok"},"session_store":{"status":"ok"},"config":{"status":"ok"},"model":{"status":"ok"},"disk":{"status":"ok","used_percent":4.7,"free_bytes":29229363200},"gateway":{"status":"ok","state":"running","connected_platforms":1,"platforms":1},"background_queues":{"status":"ok","active_api_runs":0,"process_completions":0,"active_delegations":0}}},"platform":"hermes-agent","version":"unknown","gateway_state":"running","active_agents":0,"gateway_busy":false,"last_heartbeat":"2026-10-14T14:29:31.151724+00:00","pid":5065}` |
| `GET /v1/models` | `{"object":"list","data":[{"id":"friday","object":"model","created":1791988171,"owned_by":"hermes","permission":[],"root":"friday","parent":null}]}` |
| `GET /v1/capabilities` | Objekt wie in 3.2 (mindestens `object`, `platform`, `model`, `auth`, `features`, `endpoints`) |
| `GET /api/sessions?limit=&offset=` | `{"object":"list","data":[{"id":"sess-demo-1","source":"api_server","user_id":null,"model":"fake-model","title":"Sag hallo","started_at":1791988318.9,"ended_at":null,"end_reason":null,"message_count":4,"tool_call_count":1,"input_tokens":20,"output_tokens":10,"cache_read_tokens":0,"cache_write_tokens":0,"reasoning_tokens":0,"estimated_cost_usd":0.0,"actual_cost_usd":null,"api_call_count":2,"parent_session_id":null,"last_active":1791988319.157,"preview":"Sag hallo","pinned":false,"archived":false,"hidden":false,"has_system_prompt":true,"has_model_config":true,"is_internal_child":false}],"limit":50,"offset":0,"has_more":false}` |
| `GET /api/sessions/{id}` | `{"object":"hermes.session","session":{<wie oben ohne last_active/preview>}}`; unbekannt 404 (Form nicht erfasst) |
| `GET /api/sessions/{id}/messages` | `{"object":"list","session_id":"sess-demo-1","data":[{"id":5,"session_id":"sess-demo-1","role":"user","content":"Sag hallo","tool_call_id":null,"tool_calls":null,"tool_name":null,"timestamp":1791988318.87,"token_count":null,"finish_reason":null,"reasoning":null,"reasoning_content":null,"display_kind":null},{"id":6,"role":"assistant","content":"","tool_calls":[{"id":"call_1","call_id":"call_1","response_item_id":"fc_1","type":"function","function":{"name":"skills_list","arguments":"{}"}}],"finish_reason":"tool_calls","timestamp":1791988318.95},{"id":7,"role":"tool","tool_call_id":"call_1","tool_name":"skills_list","content":"{\"success\": true}","timestamp":1791988319.0},{"id":8,"role":"assistant","content":"Hallo, das ist die Fake-Antwort.","finish_reason":"stop","timestamp":1791988319.15}]}` (fehlende Felder je Eintrag wie im ersten Objekt mit `null`) |
| `POST /api/sessions` | 201 `{"object":"hermes.session","session":{...}}` |
| `POST /v1/chat/completions` | nicht-streamend: `{"id":"chatcmpl-abc","object":"chat.completion","created":1791988324,"model":"friday","choices":[{"index":0,"message":{"role":"assistant","content":"Hallo, das ist die Fake-Antwort."},"finish_reason":"stop"}],"usage":{"prompt_tokens":20,"completion_tokens":10,"total_tokens":30}}`; streamend: Chunks wie in 3.2 |
| `POST /v1/runs` | 202 `{"run_id":"run_<32hex>","status":"started","replayed":false}` |
| `GET /v1/runs/{id}` | wie 3.2; unbekannt 404 `{"error":{"message":"Run not found: x","type":"invalid_request_error","param":null,"code":"run_not_found"}}` |
| `GET /v1/runs/{id}/events` | SSE exakt wie in 3.3, auch der Fehlerfall `run.failed` |

Fehlerfälle für Tests: 401 (kein/falscher Key), 404 `run_not_found`, 500 `{"error":{"message":"Failed to enumerate skills","type":"server_error","param":null,"code":null}}`, Verbindungsabbruch, Timeout.

### 8.2 Fake B: Dashboard (`43691`-Äquivalent)

- `GET /` liefert HTML mit `<script>window.__HERMES_SESSION_TOKEN__="fake-token-0001";window.__HERMES_AUTH_REQUIRED__=false;</script>` (Token optional bei jedem Neustart rotieren, damit der 401-Neuholen-Pfad getestet wird).
- Auth für `/api/*` (außer `/api/health`, `/api/status`): Header `X-Hermes-Session-Token` oder Bearer; sonst 401 `{"detail":"Unauthorized"}`. WS: `?token=`; sonst HTTP 403 beim Upgrade.
- Fehlerform durchgehend FastAPI: `{"detail":"<Text>"}` (400 `unknown status: bogus`, 404 `task nope not found`, 404 `board 'x' does not exist`).

Routen und Beispiele:

```json
// GET /api/health  (ohne Auth)
{"ok":true,"version":"unknown","displayVersion":"git.0e427d7","commit":"0e427d788d253630d38a3a51cd76849e73cd6925","auth_required":false}

// GET /api/plugins/kanban/boards
{"boards":[{"slug":"default","name":"Default","description":"","icon":"","color":"","default_workdir":null,"project_id":null,"created_at":null,"archived":false,"db_path":"/home/friday/.hermes/kanban.db","is_current":true,"counts":{},"total":0,"default_workspace_kind":"scratch","project_name":null},{"slug":"business","name":"Business","description":"","icon":"","color":"","default_workdir":null,"project_id":null,"created_at":1791988093,"archived":false,"db_path":"/home/friday/.hermes/kanban/boards/business/kanban.db","is_current":false,"counts":{"done":1,"triage":1},"total":2,"default_workspace_kind":"scratch","project_name":null}],"current":"default"}

// GET /api/plugins/kanban/board?board=business   (Spalten immer in dieser Reihenfolge, auch leere)
{"columns":[{"name":"triage","tasks":[{"id":"t_b21c53e3","title":"Zweite Aufgabe","body":null,"assignee":null,"status":"triage","priority":0,"created_by":"user","created_at":1791988097,"started_at":null,"completed_at":null,"workspace_kind":"scratch","workspace_path":null,"claim_lock":null,"claim_expires":null,"tenant":null,"branch_name":null,"project_id":null,"result":null,"idempotency_key":null,"consecutive_failures":0,"worker_pid":null,"last_failure_error":null,"max_runtime_seconds":null,"last_heartbeat_at":null,"current_run_id":null,"workflow_template_id":null,"current_step_key":null,"skills":null,"model_override":null,"provider_override":null,"reasoning_effort":null,"max_retries":null,"goal_mode":false,"goal_max_turns":null,"session_id":null,"block_kind":null,"block_recurrences":0,"completion_contract":"local-only","age":{"created_age_seconds":177,"started_age_seconds":null,"time_to_complete_seconds":null},"latest_summary":null,"current_run_started_at":null,"link_counts":{"parents":0,"children":0},"comment_count":0,"progress":null}]},{"name":"todo","tasks":[]},{"name":"scheduled","tasks":[]},{"name":"ready","tasks":[]},{"name":"running","tasks":[]},{"name":"blocked","tasks":[]},{"name":"review","tasks":[]},{"name":"done","tasks":[]}],"tenants":[],"assignees":["default","kira"],"latest_event_id":7,"now":1791988274}

// GET /api/plugins/kanban/tasks/t_a90d372a?board=business
{"task":{"id":"t_a90d372a","title":"Angebot für Kunde prüfen","body":"Details","assignee":"kira","status":"done","priority":2,"created_by":"user","created_at":1791988096,"started_at":null,"completed_at":1791988118,"result":"fertig","...":"restliche Felder wie TaskCard","latest_summary":"fertig","current_run_started_at":null},"comments":[{"id":1,"task_id":"t_a90d372a","author":"default","body":"Hallo Kommentar","created_at":1791988109}],"events":[{"id":1,"task_id":"t_a90d372a","kind":"created","payload":{"assignee":"kira","status":"ready","parents":[],"creator_task_id":null,"tenant":null,"workspace_kind":"scratch","workspace_path":null,"branch_name":null,"project_id":null,"skills":null,"goal_mode":null,"model_override":null,"provider_override":null},"created_at":1791988096,"run_id":null},{"id":5,"task_id":"t_a90d372a","kind":"blocked","payload":{"reason":"Warte auf Freigabe","kind":null,"recurrences":1,"source_status":"ready"},"created_at":1791988111,"run_id":1},{"id":6,"task_id":"t_a90d372a","kind":"unblocked","payload":null,"created_at":1791988115,"run_id":null},{"id":7,"task_id":"t_a90d372a","kind":"completed","payload":{"result_len":6,"summary":"fertig"},"created_at":1791988118,"run_id":2}],"attachments":[],"links":{"parents":[],"children":[]},"link_tasks":[],"child_results":[],"runs":[{"id":1,"task_id":"t_a90d372a","profile":"kira","step_key":null,"status":"blocked","claim_lock":null,"claim_expires":null,"worker_pid":null,"max_runtime_seconds":null,"last_heartbeat_at":null,"started_at":1791988111,"ended_at":1791988111,"outcome":"blocked","summary":"Warte auf Freigabe","metadata":null,"error":null}]}

// POST /api/plugins/kanban/tasks?board=business   Body {"title":"Per API angelegt","body":"x","assignee":"kira","priority":3}
{"task":{"id":"t_231603ac","title":"Per API angelegt","body":"x","assignee":"kira","status":"ready","priority":3,"created_by":"dashboard","...":"wie TaskDetail"}}

// PATCH .../tasks/t_231603ac?board=business   Body {"status":"blocked","block_reason":"Rückfrage"}  -> {"task":{... "status":"blocked","block_recurrences":1 ...}}
// POST  .../tasks/t_231603ac/comments          Body {"body":"Kommentar"}                              -> {"ok":true}
// GET   /api/plugins/kanban/stats              -> {"by_status":{"done":1,"triage":1},"by_assignee":{"kira":{"done":1}},"oldest_ready_age_seconds":null,"now":1791988274}
// GET   /api/plugins/kanban/assignees          -> {"assignees":[{"name":"default","on_disk":true,"counts":{}},{"name":"kira","on_disk":false,"counts":{"done":1}}]}
// GET   /api/plugins/kanban/profiles           -> {"profiles":[{"name":"default","is_default":true,"model":"k3","provider":"kimi-coding","description":"","description_auto":false,"skill_count":58}]}
// GET   /api/plugins/kanban/workers/active     -> {"workers":[{"run_id":3,"task_id":"t_x","task_title":"T","task_status":"running","task_assignee":"kira","profile":"kira","worker_pid":4711,"started_at":1791988300,"claim_lock":"lock","claim_expires":1791988900,"last_heartbeat_at":1791988350,"max_runtime_seconds":null}],"count":1,"checked_at":1791988360}
// GET   /api/sessions?limit=50                 -> {"sessions":[{... Session + "profile":"default","is_default_profile":true,"is_active":true,"unread":false,"preview":"Sag hallo","last_active":1791988319.157,"tool_names":null}],"total":1,"limit":50,"offset":0,"storage":{}}
```

WebSocket `ws://.../api/plugins/kanban/events?board=business&since=5&token=<t>`: bei Verbindung sofort alle Events mit `id > since` (max 200), danach bei neuen Events jeweils
`{"events":[{"id":8,"task_id":"t_231603ac","run_id":null,"kind":"created","payload":{...},"created_at":1791988287}],"cursor":11}`. Ohne `since` kein Replay, nur neue Events. Reconnect = neue Verbindung mit letztem `cursor`.

Fake-Steuerhaken, die der Test braucht: Token rotieren, Gateway „down" (Fake A antwortet nicht), Task-Status ändern (löst WS-Event aus), neue Session/Nachricht anhängen, `block_kind`, `last_failure_error` setzen.

## 9. Annahmen (unbelegt)

Nichts hiervon darf ohne weitere Prüfung als Tatsache in Code oder UI-Text stehen.

1. **Eventtypen vollständig?** Die Liste der Kanban-Event-`kind`-Werte (4.3) und der Run-Eventtypen ist aus Quelltext/Stichprobe; weitere Werte möglich. Adapter muss unbekannte `kind` als generisches `task`-Ereignis behandeln.
2. **`Last-Event-ID`-Replay am Run-SSE** nicht getestet; nur `id: <seq>` beobachtet.
3. **Prioritäts-Konvention** `P0..P4 <-> 4..0` ist ein Vorschlag; Hermes definiert nur „Tiebreaker, höher zuerst" (Sortierung `priority-desc` in der CLI-Hilfe; Richtung der Default-Sortierung nicht live verifiziert).
4. **`failed`-Ableitung** (6.4) aus `last_failure_error`/Run-`outcome`: Dispatcher-Verhalten bei Worker-Absturz (Status danach `ready`/`blocked`?, `failure_limit` Default 2) wurde **nicht live** getestet, weil kein Worker (LLM-Lauf eines Kanban-Tasks) gestartet wurde.
5. **Assignee `kira` ohne Profil:** ob der Dispatcher einen Task für einen Assignee ohne gleichnamiges Profil überhaupt startet (`on_disk:false`; `dispatch_profiles: any` in `diagnostics`), ist unbelegt. Der Installer legt nur `default` an. Ohne Klärung bleiben Tasks evtl. in `ready`. **Das betrifft die Produktfunktion, nicht nur den Adapter.**
6. **Status `waiting`/`failed`/`cancelled` und `approvalIds`:** kein 1:1-Gegenstück in Hermes (siehe 6.4, 6.1).
7. **Progress bei Kind-Tasks:** Form von `progress` wurde nur als `null` gesehen.
8. **Echtes Kimi/`kimi-coding`:** ungetestet. Ohne Key scheiterte der Provider im Test mit „The 'anthropic' package is required for the Anthropic provider ... restart Hermes to activate it" (Umgebungseffekt der Nachinstallation, kein Beleg für das WSL-Setup). Modellname `k3` und Provider stammen aus dem Installer, nicht aus eigener Prüfung.
9. **Installer-Risiken (nicht geändert, nur vermerkt):** (a) `--skip-build` löst ohne vorgebautes `web_dist` einen npm-Recovery-Build aus; (b) das Dashboard-Token rotiert (4.2); (c) die `install.sh` der Webseite ist nicht mit der im Repo verglichen; (d) kein Pinning der Version.
10. **Tier-2/3-Verhalten („nur Entwurf + Bestätigung"), Router-Stufen `K1/K2/K3`, `BG=1`:** stammen aus `friday_voice.py`/Persona, sind Hermes-seitig nicht nachgewiesen und haben im Kanban keine Felder.
11. **Gateway-Neustart nach `.env`-Änderung:** der Installer schreibt `API_SERVER_*` vor `hermes gateway install` und startet den Dienst neu - plausibel, im Test wurde das Gateway nur einmal gestartet.
12. **`/api/sessions/{id}` bei unbekannter ID** (Fehlerform) und Pagination-Verhalten über 200 Einträge nicht erfasst.
13. **Modellfeld im Chat-Request:** wir sendeten `friday`; ob ein anderer Wert (`kira`, wie in `friday_voice.py`) abgelehnt oder ignoriert wird, ist nicht getestet (Run-Status zeigt `model:"friday"`).
14. **Windows/WSL-Erreichbarkeit** der Ports vom Windows-Host (localhost-Forwarding) ist nicht Teil dieser Cloud-Verifikation.

### Prüfung der Aussagen des alten Dokuments

| Alte Aussage | Urteil | Begründung |
| --- | --- | --- |
| Hermes bietet OpenAI-kompatible Chat-Schnittstelle, Body `{model,messages}`, Antwort `choices[0].message.content` | **bestätigt** | Live `POST /v1/chat/completions` 200 |
| `Authorization: Bearer <hermes_key_file>` | **bestätigt** | Live 200 mit Key, 401 ohne/falsch; nur Bearer |
| Modell heißt standardmäßig `kira` | **falsch für den Installer** (`API_SERVER_MODEL_NAME=friday`); `kira` stammt aus dem Voice-Skript. Ob `kira` akzeptiert wird: unbelegt (9.13) | `GET /v1/models` -> `friday` |
| Router-Stufen `K1/K2/K3`, `BG`, Tier-2/3-Entwurf | **nicht prüfbar** | nicht Teil von Hermes-Schnittstellen |
| „Endpunkte für Aufgabenliste, Aktivität, Agentenstatus nicht verifiziert" | **jetzt aufgelöst** | Aufgaben: Dashboard-REST/CLI; Aktivität: Sessions + Kanban-Events; Agenten: Profile/Worker (Abschnitte 4-6) |
| Quellenreihenfolge „HTTP-API -> CLI -> Eventstrom/Logdatei" | **angepasst** | HTTP gibt es, aber auf zwei Ports mit zwei Auth-Verfahren; Logdatei (`/api/logs`) liefert Rohtext und ist ungeeignet |
| Platzhalter-Config `baseUrl`, `apiToken`, `timeoutMs`, `eventsPath` | **unzureichend** | nötig: `apiBaseUrl` + `apiKeyRef` (43693), `dashboardBaseUrl` (43691) + Token-Beschaffung (Scrape oder feste Env-Variable), `board`-Liste; `eventsPath` -> fester WS-Pfad `/api/plugins/kanban/events` |
| Kanban-Spalten Backlog/bereit/läuft/wartet/Review/fertig/Fehler/abgebrochen | **teilweise falsch** | echte Spalten: triage, todo, scheduled, ready, running, blocked, review, done (+archived); Fehler/abgebrochen sind keine Spalten |
| Priorität `P0..P4` direkt | **falsch** | Hermes-Priorität ist Integer-Tiebreaker |
| Label `background`, `effort:*` | **falsch** | Task hat kein Label-Feld |
| `model`: Kimi-Stufe `kimi_low/high/max` | **unbelegt** | Hermes hat `reasoning_effort` und `model_override`, keine „Kimi-Stufen" |
| `toolCalls[]` am Task | **falsch für Kanban** | nur über Sessions/Run-Events |
| `approvalIds`/`blockers[kind=approval]` | **teilweise** | `blocked` + `block_kind=needs_input`; Run-Approvals nur für Runs |
| `createdBy = {user, owner}` | **unbelegt** | `created_by` ist Freitext (`user`, `dashboard`, Agent) |
| `correlationId` aus `task_id` | **bestätigt, mit Einschränkung** | Task-IDs sind pro Board eindeutig |
| Heartbeats `friday.agent.heartbeat` aus Hermes | **teilweise** | nur `workers/active[].last_heartbeat_at` und Gateway-Heartbeat; Agenten-Heartbeat pro Profil nicht vorhanden |
| SSE/Polling an `eventsPath`, Reconnect mit Cursor | **teilweise** | WebSocket (nicht SSE) mit `since=<event_id>`; Run-SSE nur pro Run |
| Dashboard 43691 zeigt „Kanban-Boards, Einstellungen, Verlauf" (Anleitung) | **bestätigt** | SPA + REST, Kanban-Plugin, Sessions |

## 10. Empfehlung für die Umsetzung

1. `hermes-tasks`: Dashboard-REST (4.3) lesend und schreibend; Capabilities `tasks.read`, `tasks.create`, `tasks.update`, `tasks.stream` (WS); `cancel` erst nach Live-Test von Archivieren.
   CLI nur als Fallback (nicht über Windows-Prozessgrenzen im Dauerbetrieb).
2. `hermes-activity`: Kanban-WS-Events + Session-Polling (API-Server `/api/sessions` + `/messages` mit Cursor `Message.id`); Backfill über `sinceSequence` aus eigenem Puffer.
3. `hermes-agents`: `GET /api/profiles` + `kanban/workers/active` + `kanban/assignees`; Status abgeleitet (6.3).
4. Health: `/health` (API-Server, ohne Auth) und `/api/health` (Dashboard, mit Version/Commit) getrennt melden; `/health/detailed` für Gateway-Zustand.
5. Installer-Änderungen für das Lead-Team (außerhalb des Schreibbereichs dieser Aufgabe): `HERMES_DASHBOARD_SESSION_TOKEN` aus eigener Schlüsseldatei setzen; Version pinnen (`--commit`); Klärung Assignee `kira` vs. Profil (9.5).
