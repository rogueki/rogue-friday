# @friday/adapter-hermes

Echter Adapter für **Hermes Agent** (Nous Research): Aufgaben/Kanban, Aktivität und Agenten.
Er ersetzt `@friday/adapter-hermes-placeholder` (gleiche Provider-IDs `hermes-tasks`, `hermes-activity`, `hermes-agents`).

Grundlage ist ausschließlich `docs/MAPPING/hermes.md` (verifiziert gegen Hermes-Quellcode `0e427d7` und eine laufende
Instanz). Die Lifecycle-Erweiterung ist gegen die gepinnten Hermes-Quellen und lokale HTTP-Tests geprueft;
ein echter Friday-Laufzeitnachweis steht noch aus.

## Aufbau

Ein Paket, **drei Adapter** (je Kategorie einer: eigener Health-Status, eigene Capabilities, eigener Circuit Breaker,
einzeln `mock`/`live` schaltbar):

| Provider-ID       | Klasse                  | Port           | Quellen in Hermes                                                                                                              |
| ----------------- | ----------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `hermes-tasks`    | `HermesTasksAdapter`    | `TaskPort`     | Dashboard (`:43691`): Kanban-Plugin REST + WebSocket `/api/plugins/kanban/events`                                              |
| `hermes-activity` | `HermesActivityAdapter` | `ActivityPort` | API-Server (`:43693`, Bearer): `/api/sessions` + `/messages`; Dashboard: Kanban-Ereignisse                                     |
| `hermes-agents`   | `HermesAgentsAdapter`   | `AgentPort`    | Dashboard: `/api/profiles`, `/api/status`, Kanban `board` (Assignees), `workers/active`; API-Server: `/v1/toolsets` (optional) |

Es gibt keinen direkten Zugriff auf `state.db`/`kanban.db` (PLAN §1.1 Nr. 17) und keine CLI-Aufrufe.

Registrierung (macht die Control API, nicht dieses Paket):

```ts
import { hermesFactories } from "@friday/adapter-hermes";
for (const factory of hermesFactories) registry.registerFactory(factory.providerId, factory);
```

`config/adapters.yaml`: `allowlist: { hermes-tasks: "@friday/adapter-hermes", hermes-activity: "@friday/adapter-hermes", hermes-agents: "@friday/adapter-hermes" }`.

## Konfiguration

JSON Schema je Adapter: `configSchemaFor("tasks" | "activity" | "agents")` (`$id` = `urn:friday:adapter:hermes-<kategorie>:config`).
Alle drei Adapter nehmen dieselben Felder; jeder liest nur, was er braucht.

```yaml
adapters:
  tasks:
    provider: hermes-tasks
    config:
      dashboardBaseUrl: http://127.0.0.1:43691
      dashboardAuth: scrape # scrape | secret | file
      boards: [default]
  activity:
    provider: hermes-activity
    config:
      apiBaseUrl: http://127.0.0.1:43693
      apiKey: env:HERMES_API_KEY # Secret-Referenz (env: oder wincred:), nie Klartext
      # apiKeyFile: C:\Friday\config\hermes_api.key   # Alternative, siehe unten
      dashboardBaseUrl: http://127.0.0.1:43691
  agents:
    provider: hermes-agents
    config:
      apiKey: env:HERMES_API_KEY # optional: nur für die Fähigkeiten (Toolsets)
```

| Feld                          | Standard                 | Bedeutung                                                                                                          |
| ----------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `apiBaseUrl`                  | `http://127.0.0.1:43693` | API-Server des Gateways (Bearer-Auth). Nur Aktivität (Sitzungen) und optional Agenten (Toolsets).                  |
| `apiKey` (**Secret**)         | –                        | `API_SERVER_KEY` = Inhalt von `hermes_api.key`. Wird über `getSecret` geliefert, nie in Config, Logs oder Browser. |
| `apiKeyFile`                  | –                        | Alternative zu `apiKey`: Pfad der Schlüsseldatei. Gelesen wird nur serverseitig, bei 401 erneut (Schlüsseltausch). |
| `dashboardBaseUrl`            | `http://127.0.0.1:43691` | Hermes-Dashboard (Kanban, Profile, Status).                                                                        |
| `dashboardAuth`               | `scrape`                 | Quelle des Session-Tokens, siehe unten.                                                                            |
| `dashboardToken` (**Secret**) | –                        | Fester Token für `dashboardAuth: secret` (z. B. `env:HERMES_DASHBOARD_SESSION_TOKEN`).                             |
| `dashboardTokenFile`          | –                        | Pfad einer Datei mit dem festen Token für `dashboardAuth: file`.                                                   |
| `boards`                      | `[default]`              | Kanban-Boards (Slugs). Das erste Board nimmt neue Aufgaben auf.                                                    |
| `timeoutMs`                   | `10000`                  | Timeout je Versuch.                                                                                                |
| `maxAttempts`                 | `3`                      | Versuche inkl. Erstversuch; `cancelTask`, `retryTask` und `stopAgent` werden wegen fehlender Upstream-Deduplizierung nie automatisch wiederholt. |
| `retryBaseDelayMs`            | `200`                    | Backoff-Basis.                                                                                                     |
| `pollIntervalMs`              | `2000`                   | Pause zwischen Event-Zyklen; `0` = kein Hintergrund-Polling (dann nur `pollEvents()` bzw. Listenaufrufe).          |
| `eventsStartCursor`           | `tail`                   | `tail` = nur Ereignisse ab Adapterstart; Zahl = Kanban-Event-ID/Nachrichten-ID, ab der gelesen wird (`0` = alles). |
| `eventsDrainMs`               | `900`                    | Wartezeit je Event-Zyklus auf Nachrichten des WebSockets (der Hermes-Server pollt alle 0,3 s).                     |
| `activitySessionWindow`       | `25`                     | Wie viele zuletzt aktive Sitzungen in die Aktivität einfließen (max. 200).                                         |
| `activityBufferSize`          | `2000`                   | Größe des Aktivitäts-Ringpuffers.                                                                                  |

Die Schlüsselnamen sind so gewählt, dass die Config-Prüfung (`packages/config`, Heuristik für Credential-Felder) sie akzeptiert:
`apiKey`/`dashboardToken` müssen Secret-Referenzen sein, `*File` sind gewöhnliche Pfade.

### Dashboard-Token (Auth des Dashboards)

Das Dashboard erwartet `X-Hermes-Session-Token`. Der Installer setzt `HERMES_DASHBOARD_SESSION_TOKEN` **nicht**; der Token ist
dann pro Dashboard-Start zufällig.

- **`scrape`** (Standard, keine Installer-Änderung nötig): Der Adapter holt `GET /` und liest
  `window.__HERMES_SESSION_TOKEN__="…"` aus dem HTML (nur bei Loopback-Bind vorhanden). Antwortet das Dashboard mit **401**
  (z. B. nach Neustart durch `Restart=on-failure`), wird die Seite erneut gelesen. Ist der neue Token **verschieden**, wird die Anfrage
  genau einmal wiederholt; ist er gleich, kommt `UNAUTHENTICATED` (keine Schleife). Beim WebSocket-Handshake genügt ein REST-Test,
  weil der Handshake den Ablehnungsgrund nicht verrät.
- **`secret`**: fester Token, z. B. `dashboardToken: env:HERMES_DASHBOARD_SESSION_TOKEN`. Hermes liest dieselbe Variable beim Start.
- **`file`**: fester Token aus `dashboardTokenFile` (wird bei 401 neu gelesen). Das ist der saubere Weg, sobald der Installer den Token aus einer
  Schlüsseldatei in die Dienst-Unit schreibt (Installer-Änderung, nicht Teil dieser Aufgabe).

## Capabilities

Genau das, was umgesetzt **und** belegt ist. Die Control API schaltet daran die UI-Aktionen frei.

| Capability                                             | hermes-tasks | hermes-activity | hermes-agents | Beleg (docs/MAPPING/hermes.md)                                                                                  |
| ------------------------------------------------------ | :----------: | :-------------: | :-----------: | --------------------------------------------------------------------------------------------------------------- |
| `tasks.read` (Liste, Detail, Filter, Paging)           |      ja      |        –        |       –       | live (§4.3)                                                                                                     |
| `tasks.create`                                         |      ja      |        –        |       –       | live (§4.3); `idempotency_key` im Request, Dedup laut Quelle                                                    |
| `tasks.update` (Titel, Text, Priorität, Agent, Status) |      ja      |        –        |       –       | live (§4.3, §5); Statusmatrix beachtet                                                                          |
| `tasks.stream`                                         |      ja      |        –        |       –       | live (WebSocket `?since=`)                                                                                      |
| `tasks.cancel` / `retry`                              |      ja      |        –        |       –       | gepinnter Hermes-Quelltext + lokale HTTP-Tests; Liveprobe noch offen                                             |
| `tasks.pause` / `resume`                              |   **nein**   |        –        |       –       | kein gepruefter Hermes-Vertrag                                                                                   |
| `activity.read`                                        |      –       |       ja        |       –       | live (Sitzungen/Nachrichten, Kanban-Ereignisse)                                                                 |
| `activity.stream`, `activity.backfill`                 |      –       |       ja        |       –       | Polling/WS (kein globaler Strom in Hermes); Backfill über adaptereigenen Puffer                                 |
| `agents.read`                                          |      –       |        –        |      ja       | live (Profile, Workers, Assignees)                                                                              |
| `agents.stop`                                         |      –       |        –        |      ja       | Friday-CAS-Patch und lokaler Run-Race-Test; nur bei positivem Patch-Probe-GET ausfuehrbar                        |
| `agents.pause` / `resume` / `assignTask`              |      –       |        –        |   **nein**    | keine gepruefte Schnittstelle; Zuweisen geht ueber `tasks.update` (`agentId`)                                     |

Nicht angebotene Port-Methoden sind nicht implementiert (die Conformance-Suite prüft das).
Events werden zusätzlich zu `*.stream` so geliefert: `friday.task.*` (tasks), `friday.activity.appended` (activity),
`friday.agent.status_changed` und `friday.agent.heartbeat` (agents; eine Capability dafür gibt es im Vertrag nicht).

## Abbildung (Kurzfassung, Details in `docs/MAPPING/hermes.md` §6)

- **IDs:** über den `createIdCodec` von adapter-core, Board inklusive. Standard-Board: reine Hermes-ID (`t_a90d372a`, rückwärts ohne Zustand
  auflösbar); andere Boards: `<board>/<id>` (gehasht). Nach einem Neustart ist die Merktabelle leer: ein unbekanntes `task_…` löst **einmal**
  eine Neuaufnahme aller konfigurierten Boards aus, danach `NOT_FOUND`. Agenten-IDs sind der Assignee-/Profilname und damit in allen drei Adaptern identisch.
- **Status (§6.4):** `triage→triage`, `todo→todo`, `scheduled→waiting`, `ready→ready`, `running→running`, `blocked→waiting`, `review→review`,
  `done→done`, `archived→cancelled`. `failed` wird **abgeleitet** (`last_failure_error` bei Status `ready`/`blocked`). Unbekannte Hermes-Status
  werden mit `VALIDATION_FAILED` abgelehnt (kein stilles Einsortieren), siehe „Offene Punkte“.
  Setzbar über `updateTask`: `triage`, `todo`, `ready`, `review`, `done`, `waiting` (→ `blocked`). `running`, `failed`, `cancelled` werden abgelehnt.
- **Priorität (Vorschlag, Annahme):** Hermes-Integer `4..0 ↔ P0..P4`, `>=4→P0`, `<=0→P4`.
- **Labels:** Hermes hat keine Labels. Ausgegeben werden `board:<slug>` und `tenant:<name>`. Beim Anlegen wählt `board:<slug>` das Board,
  `tenant:<name>` setzt den Mandanten; andere Labels und `dueAt` werden mit `VALIDATION_FAILED` abgelehnt (nichts wird stillschweigend verworfen).
- **`version`:** Hermes kennt keine Revision. Abgeleitet aus dem letzten Zeitstempel der Aufgabe (Sekunden); `If-Match` wird gegen diesen Wert geprüft
  (`CONFLICT`), erkennt aber reine Titel-/Prioritätsänderungen nicht.
- **Aktivität:** Nachrichten → `user_request` / `tool_call` (je Aufruf, Ergebnis aus der `tool`-Nachricht) / `agent` / `result`; Kanban-Ereignisse → `task`.
  Inhalte und Werkzeug-Argumente werden **nicht** übernommen, nur gekürzte Zusammenfassungen von Nutzer-/Assistententexten. `sequence` ist adaptereigen.
- **Agenten:** Vereinigung aus Profilen, Assignees und Workern; `working` bei laufendem Worker, `waiting` bei `blocked`+`needs_input`, `offline` wenn das
  Gateway nicht läuft, sonst `idle`. Erfolgsquote und Dauer aus den Aufgaben des Boards.
- **Fehler:** HTTP-Codes nach `ADAPTER_SDK.md` §3; FastAPI-Fehler `{"detail":…}` und API-Server-Fehler `{"error":{…}}` landen gekürzt und maskiert in `details`.

## Ereignisse

`pollEvents()` führt **einen Zyklus** aus (auch der Hintergrundtimer ruft ihn auf):

1. je Board WebSocket `…/events?board=&since=<Cursor>&token=` öffnen, Nachrichten `{events, cursor}` einsammeln, bis es still wird (`eventsDrainMs`), schließen;
2. betroffene Aufgaben einmal abrufen und jedes Rohereignis in ein kanonisches Ereignis mit Aufgaben-Schnappschuss übersetzen;
3. alles validieren, dann `emit`, **erst danach** die Cursor weiterschieben (Abbruch dazwischen verliert nichts und erzeugt keine Dubletten).

`tail` (Standard) liest beim ersten Zyklus den aktuellen Stand (`latest_event_id` bzw. höchste Nachrichten-ID) und liefert nur Neues; die Aktivität
puffert zusätzlich die letzten 100 Kanban-Ereignisse und die zuletzt aktiven Sitzungen als Historie (ohne Emit). Unbekannte Ereignis-`kind`-Werte
werden als `friday.task.updated` bzw. generisches `task`-Ereignis behandelt. Listenaufrufe der Aktivität lesen die Sitzungen ebenfalls und
senden Neues, sodass der Strom auch ohne Hintergrund-Polling lückenlos bleibt (Kanban-Ereignisse brauchen `pollIntervalMs > 0`).

## Verifiziert vs. Annahme (unbelegt)

**Belegt** (siehe `docs/MAPPING/hermes.md`): Kanban-REST (Boards, Board, Task-Detail, Anlegen, `PATCH`, Kommentar, Stats, Assignees, Profile, Workers),
Dashboard-Token im HTML und 401-Verhalten, WebSocket mit `since`, API-Server-Auth (nur Bearer), Sitzungen/Nachrichten mit Tool-Calls, `/health`, `/api/health`,
`/api/status`, FastAPI-/API-Server-Fehlerformen. Aus dem Quelltext (nicht live): Idempotenz über `idempotency_key`, Nachrichten-Paging (`order=oldest|latest`, ≤500),
`progress={done,total}`.

**Annahme (unbelegt) – bewusst nicht als Capability freigeschaltet oder als Annahme dokumentiert:**

1. **Abbrechen** (`tasks.cancel`): ein `PATCH status=archived`; Hermes archiviert atomar und beendet den zugehoerigen Worker vor der Antwort. Liveprobe noch offen.
2. **Wiederholen** (`tasks.retry`): `PATCH status=ready` nur fuer archivierte oder blockierte fehlgeschlagene/Friday-gestoppte Aufgaben. Ein bereits `ready`-markierter Fehler ist moeglicherweise schon im Dispatch und wird abgelehnt.
3. **Agent stoppen** (`agents.stop`): genau einen aktiven Run per `/runs/{id}/terminate`. Der Friday-Patch bindet Run-ID und Claim atomar und blockiert die Task bis zu einem expliziten Retry. Ohne Patch-Probe wird der Aufruf abgelehnt. Echte Laufzeitprobe noch offen.
4. **Priorität** `P0..P4 ↔ 4..0` ist ein Vorschlag (Hermes: „Tiebreaker“, Sortierrichtung nicht live verifiziert).
5. **`failed`-Ableitung** aus `last_failure_error`: Dispatcher-Verhalten bei Worker-Absturz nicht live getestet.
6. **Vollständigkeit der Ereignis-`kind`-Werte** und Reihenfolge der Spalten über Hermes-Versionen.
7. **Form von `progress`** bei Kind-Aufgaben nur aus dem Quelltext; unbekannte Formen gelten als „kein Fortschritt“.
8. **Assignee ohne Profil** (z. B. `kira`): ob der Dispatcher solche Aufgaben startet, ist offen (betrifft die Produktfunktion, nicht den Adapter).
9. **Tool-Aufrufe je Aufgabe** (`Task.toolCalls`) bleiben leer: Kanban führt keine; sie wären über `session_id` → Nachrichten auffindbar (nicht umgesetzt).
10. **Reasoning-Level je Agent**: nicht lesbar; der Adapter meldet `none` (der Vertrag hat keinen Wert „unbekannt“).
11. **Echtes Kimi/`kimi-coding`** und **Windows/WSL-Portweiterleitung** wurden nicht geprüft.

## Gegen ein echtes Hermes ausführen

1. Hermes starten wie der Installer: Gateway mit `API_SERVER_ENABLED=true`, `API_SERVER_PORT=43693`, `API_SERVER_KEY=<…>`; Dashboard
   `hermes dashboard --host 127.0.0.1 --port 43691 --no-open --skip-build`. Prüfen: `curl http://127.0.0.1:43691/api/health`, `curl http://127.0.0.1:43693/health`.
2. Nur-Lese-Rauchtest (legt nichts an):

   ```bash
   HERMES_API_KEY_FILE=/pfad/zu/hermes_api.key HERMES_BOARDS=default,business pnpm --filter @friday/adapter-hermes smoke
   ```

   Ausgabe je Adapter: Health, Capabilities, die ersten Einträge. `HERMES_DASHBOARD_TOKEN` setzt `dashboardAuth: secret`.

3. In der Control API: Provider in die Allowlist eintragen, Fabriken registrieren (siehe oben), `adapters.tasks|activity|agents.provider` auf
   `hermes-tasks|hermes-activity|hermes-agents` stellen und im Modus `hybrid`/`live` starten. WSL-Ports müssen vom Windows-Host erreichbar sein (localhost-Forwarding, nicht geprüft).
4. Beim ersten Lauf die Log-Zeile „Hermes Dashboard erkannt“ (Version/Commit) prüfen; weicht sie stark von `0e427d7` ab, `docs/MAPPING/hermes.md` gegenprüfen.

## Tests

```bash
pnpm --filter @friday/adapter-hermes typecheck
pnpm exec vitest run adapters/hermes          # Unit, Adapter-Tests (echter WebSocket), Registry, Conformance
pnpm test:conformance                          # alle Adapter, darunter adapters/hermes/test/conformance.test.ts
```

- `test/fake/` – **Fake-Upstream** nach `docs/MAPPING/hermes.md` §8: Fake A (API-Server, Bearer, `{"error":…}`) und Fake B (Dashboard: HTML mit Token, Rotation,
  `{"detail":…}`-Fehler, Kanban-REST, WebSocket mit `since`-Cursor). `createHermesFake()` startet beide Listener; Schalter: `setOffline`, `setLatency`,
  `forceStatus` (401/…), `state.rotateToken()`, `state.invalidData`, `state.gatewayRunning`, `wsCloseWith` (1008). `installHermes()` hängt dieselben Routen an den
  HTTP-Fake des Testkits.
- `test/conformance.test.ts` – `@friday/adapter-testkit` (alle Pflichtprüfungen aus PLAN §11.1) für alle drei Kategorien. Der Testkit-Fake spricht nur HTTP;
  deshalb liest der Adapter dort den Ereignisstrom über einen injizierten Transport (`HttpPollKanbanTransport`, HTTP-Zwilling der WebSocket-Nachricht). Den echten
  WebSocket-Pfad (Handshake, Token, Cursor, Abbruch, Rotation) prüfen `tasks.test.ts` und `agents.test.ts` gegen den eigenen Fake.
  Übersprungen werden die Mutationsprüfungen von Aktivität und Agenten (keine Mutationen vorhanden).
- `test/registry.test.ts` – alle drei Adapter hinter der echten `AdapterRegistry` (Config-Schema, Secret-Auflösung, Ergebnisprüfung, Capabilities).

## Offene Punkte / Vertragslücken

- **Secret-Referenz `file:`**: `packages/config` unterstützt inzwischen `file:<absoluter Pfad>` (z. B. `apiKey: file:C:/Friday/config/hermes_api.key`). `apiKeyFile`/`dashboardTokenFile` bleiben als gleichwertige Alternative erhalten.
  (als gewöhnlicher Pfad, nicht als Secret-Feld).
- **`ActivityEvent.sequence`** ist Pflicht; der Adapter vergibt eine lokale Folge je Prozess. Der Hub nummeriert eigene Ereignisse getrennt (`activity.backfill` über `sinceSequence`
  bezieht sich auf die Adapter-Folge).
- **`AgentStatus`/`ReasoningLevel`**: keine Quelle für `starting`, `paused`, `error` und den Reasoning-Level; letzteres hat im Vertrag keinen Wert „unbekannt“.
- **Kommentare** an Aufgaben sind in Hermes live belegt (`POST …/comments`), der `TaskPort` hat dafür keine Methode/Capability.
- **`agents.assignTask`** wird nicht deklariert (Zuweisen läuft über `tasks.update` mit `agentId`); ob die UI die Aktion am Agenten-Adapter oder am Task-Adapter freischalten soll, ist Sache der Control API.
- **Unbekannte Status**: ein künftiger Hermes-Status lässt die Aufgabenliste mit `VALIDATION_FAILED` scheitern (sichtbar statt falsch einsortiert). Alternative wäre ein Fallback auf `todo` mit Warnung – Entscheidung offen.
- **Performance**: `GET …/board` liefert das ganze Board inklusive Verlauf; es gibt keinen Cache. Bei großen Boards ein kurzes TTL-Caching ergänzen.
- **Hermes-Version**: Die Friday-Installer pruefen den Pin `d923a5eb` und wenden den hashgeprueften Run-Stop-Patch vor Dienststart an. Bestehende oder zukuenftige Hermes-Versionen mit abweichendem Quelltext muessen separat geprueft werden.
