# Control API (`@jarvis/control-api`)

Entwurf für das Kapitel "Control API" der Projektdokumentation. Die Control API ist der einzige Server des Command
Centers: eine Fastify-Anwendung (NestJS-Hülle), die die REST-Operationen aus `packages/contracts/openapi`, den
WebSocket-Ereignisstrom und das statische Web (`apps/web/out`) auf **einem Port** ausliefert (Standard
`127.0.0.1:3100`). Alle Daten kommen über Adapter-Ports (`@jarvis/adapter-core`); im Mock-Modus liefert
`@jarvis/adapter-mock` die Daten aus einer simulierten Welt (`@jarvis/mock-data`).

## Aufbau

| Pfad | Aufgabe |
|---|---|
| `src/main.ts` | Start: Konfiguration laden, Dev-Fallback, `listen`, geordnetes Beenden (SIGINT/SIGTERM) |
| `src/app.ts` | Nest-Modul mit expliziten Tokens (läuft unter `tsx` und `tsup`), schließt WebSockets vor dem HTTP-Server |
| `src/http/route-table.generated.ts` | **generiert** aus dem gebündelten OpenAPI (`pnpm --filter @jarvis/control-api generate:routes`): 109 Operationen mit Rolle, Capability, CSRF, Body-Limit, Body-/Antwortschema |
| `src/http/pipeline.ts` | Anfragepipeline je Operation: Korrelations-ID, Sitzung, Rollenmatrix, CSRF, Query-/Body-Validierung, `If-Match`, `Idempotency-Key`, Audit, Antwortvalidierung |
| `src/http/server.ts`, `static.ts` | Host-/Origin-Prüfung, Security-Header, CSP mit Hashes der Inline-Skripte, SPA-Fallback ohne Ausbruch aus dem Web-Root |
| `src/handlers/*` | Handler je Operation; portbasierte Operationen werden aus `PORT_SPEC` (`@jarvis/adapter-core`) abgeleitet, Sonderfälle (Freigaben, Auth, Befehle, Einstellungen, Dev-Konsole) liegen in eigenen Dateien |
| `src/security/*` | Sitzungen, Login-Drosselung, Re-Auth, Approval-Tokens (`@jarvis/auth`); Aktion-Berechtigungsmatrix |
| `src/realtime/hub.ts` | Ereignis-Hub: globale Sequenz, Ringpuffer, Replay (`?since=`), `resync_required`, Heartbeat, Backpressure |
| `src/runtime/*` | Verdrahtung: Konfiguration, Welt, Adapter-Registry, Dienste, SQLite, Timer |
| `src/services/*` | Einstellungen, Adapter-Einstellungen (Secrets write-only, Version/`If-Match`), Orb-/Status-/Overview-Ableitung, Befehls-Intents, Frontend-Telemetrie |
| `src/db/*` | `node:sqlite`: Einstellungen, Sitzungen, Audit-Hashkette samt Kopf-Anker (`audit-anchor.ts`), Idempotenz-Schlüssel, Befehlsverlauf, Themes/Layouts |

Verbindliche Regeln: Modelle kommen aus `@jarvis/sdk` (nie handgeschrieben), Antworten werden in Dev/Test gegen das
Vertragsschema geprüft (`dev.responseValidation`), interne Namen (`@jarvis/*`, `jarvis.*`, `/api/v1`) bleiben stabil.

## Starten

```bash
pnpm dev:api                                  # tsx watch, Mock-Modus, Dev-Login
pnpm --filter @jarvis/control-api build       # tsup -> apps/control-api/dist/main.js (ein Bundle)
pnpm start                                    # node apps/control-api/dist/main.js
pnpm scenario -- list                         # Szenario-CLI (apps/mock-console), siehe unten
```

Ohne `config/dashboard.yaml` laufen Standardwerte (Mock-Modus, Loopback). Ohne `JARVIS_OWNER_PASSWORD_HASH` schaltet der
Start im Mock-Modus auf Loopback auf feste Dev-Konten um (`dev-owner`, `dev-operator`, `dev-viewer`, Passwort `dev`) und
warnt dabei. Für den Echtbetrieb: `auth.mode: local` und den Hash mit `pnpm --filter @jarvis/auth hash-password` erzeugen.

### Umgebungsvariablen

| Variable | Wirkung |
|---|---|
| `JARVIS_CONFIG_DIR` | Verzeichnis mit `dashboard.yaml` / `adapters.yaml` (Standard `<Projektwurzel>/config`) |
| `JARVIS_DATA_MODE` | `mock` \| `hybrid` \| `live` (überschreibt `dataMode`) |
| `JARVIS_HOST`, `JARVIS_PORT` | Bind-Adresse (nur Loopback, sonst `server.allowRemote: true` + TLS/VPN) |
| `JARVIS_DATA_DIR`, `JARVIS_LOG_DIR` | SQLite-Datenbank (`dashboard.sqlite`, `auth.key`) und Logdateien |
| `JARVIS_AUTH_MODE` | `dev` erzwingt Dev-Login (nur Mock + Loopback) |
| `JARVIS_OWNER_PASSWORD_HASH` | scrypt-Hash des Owner-Passworts (Standardreferenz `env:JARVIS_OWNER_PASSWORD_HASH`) |
| `JARVIS_BUILD_VERSION` | Versionsanzeige in `/meta` und `/status` |

Adapter-Secrets stehen nie im Klartext in Dateien: `env:NAME` oder `wincred:ZIEL`; über die API sind sie write-only.

## Verhalten, auf das sich Clients verlassen können

- **Auth**: HttpOnly-/SameSite=Strict-Cookie `jarvis_session`, lesbares CSRF-Cookie, `X-CSRF-Token` auf jeder mutierenden
  Anfrage (an die Sitzung gebundener HMAC). Rollen `owner` > `operator` > `viewer` (Vertrag `x-required-role`).
  Login-Drosselung: 5 Fehlversuche je Benutzer+IP, danach `429` mit `Retry-After`.
- **Idempotenz**: `Idempotency-Key` (8 bis 128 Zeichen) wird je Benutzer, Methode und Pfad gespeichert (SQLite, übersteht
  Neustarts); Wiederholung liefert dieselbe Antwort mit `Idempotent-Replayed: true`, anderer Body `409 IDEMPOTENCY_CONFLICT`.
  Adapter sehen einen abgeleiteten, pro Benutzer/Ressource eindeutigen Schlüssel. Der Antwort-Header `Idempotent-Replayed`
  ist an allen betroffenen Erfolgsantworten im Vertrag deklariert.
- **Versionen**: `If-Match: <version>` (auch `"3"`, `W/"3"`) -> `409 CONFLICT` bei Abweichung. Gilt auch für
  `PATCH /settings/adapters/{id}`: `AdapterConfigSettings.version` startet bei 1, steigt mit jeder gespeicherten Änderung
  (SQLite, übersteht Neustarts) und wird ohne `If-Match` nicht erzwungen.
- **Freigaben (PLAN §32.5)**: `GET /approvals/{id}` liefert den kurzlebigen Einmal-Token im Antwort-Header
  `X-Approval-Token`; `POST …/approve` braucht ihn als Request-Header. Tier 3: nur Owner, nie per Sprache, frische
  Re-Auth (`POST /auth/reauth`) und `reauthToken` im Body. Bereits entschiedene oder abgelaufene Freigaben -> `409`.
- **Teilausfall**: fällt ein Adapter aus, antworten nur dessen Endpunkte mit `503 ADAPTER_UNAVAILABLE`; `/health`,
  `/adapters`, `/capabilities`, `/status`, `/orb/status` spiegeln das, alles andere läuft weiter. Eine fehlende Capability
  ergibt `403 CAPABILITY_MISSING`.
- **Ereignisse**: `GET /api/v1/events` (WebSocket; Pfad aus `/meta`). Umschläge nach AsyncAPI mit globaler `sequence`;
  `?since=<n>` spielt Verpasstes aus dem Ringpuffer nach, sonst kommt `jarvis.status.resync_required`. Steuerframes
  `{"kind":"ping","ts":…}` alle `realtime.heartbeatSeconds`, Antwort `{"kind":"pong","ts":…}`; stille Clients werden getrennt.
- **Audit**: jede mutierende Anfrage (auch verweigerte) landet in einer SHA-256-Hashkette (`audit_log`). Beim Start wird
  sie geprüft; `/health` zeigt `audit-chain` als `offline`, wenn sie gebrochen ist. Die Kette erkennt Änderungen, Löschungen
  in der Mitte und Umsortierung. Das **Abschneiden am Ende** erkennt der Kopf-Anker: Länge und Hash des letzten Eintrags
  stehen nach jedem Anhängen HMAC-signiert (Schlüssel aus `auth.key`) in `<dataDir>/audit-head.json` und in der Tabelle `kv`
  (`audit.head`). `verify()` meldet `truncated` (Kette kürzer als der Anker), `head_mismatch` (anderer Hash an der
  verankerten Stelle, z. B. älteres Datenbank-Backup) oder `anchor_tampered` (Signatur ungültig). Fehlt ein Anker, wird er
  aus der Kette neu angelegt (erster Start nach dem Upgrade); fehlen beide, gilt die aktuelle Kette als Ausgangspunkt. Wer
  die Datenbank bewusst aus einem Backup wiederherstellt, löscht `audit-head.json` vor dem Start. Grenze: wer Datenbank
  **und** beide Anker löscht oder den `auth.key` kennt, kann die Spur unbemerkt kürzen.
- **Branding**: `settings.profile.assistantName` (Standard "F.R.I.D.A.Y.") steuert servergenerierte Texte
  (Orb-Aktivitätstexte, Statuszeile); Änderungen wirken sofort. Die Mock-Welt formuliert diese Texte selbst mit dem
  konfigurierten Namen (`MockWorld({ assistantName })`), `brandText()` ist nur noch ein Sicherheitsnetz für fremde Adapter.
- **Sequenz**: Im Mock-Modus nummeriert die Welt Ereignisse und `ActivityEvent.sequence` mit der globalen Sequenz des
  Ereignis-Hubs (`MockWorld({ nextSequence })`). Der Umschlag von `jarvis.activity.appended` trägt dieselbe Zahl wie
  `data.sequence`, und `GET /activity?sinceSequence=` füllt Lücken mit den Zahlen des Stroms. Die Mock-Welt-Daten aus dem
  Seed liegen unter jeder Live-Nummer.
- **Befehls-Intents**: `POST /commands` mit dem Text "Sprachaufnahme starten" bzw. "Fokus-Modus umschalten" steuert die
  Sprachpipeline (Mock-Modus), alle anderen Texte gehen als Auftrag an den Befehls-Adapter.

## Metriken und Frontend-Telemetrie (PLAN §50.3)

- `GET /api/v1/metrics` (nur `owner`, `text/plain; version=0.0.4`): Anfragedauer (`jarvis_http_request_duration_seconds`),
  Fehlerquote (`jarvis_http_error_ratio`, Anteil 5xx), WebSocket-Verbindungen (`jarvis_ws_connections`), Ereignisse pro
  Sekunde (`jarvis_events_per_second`, `jarvis_events_total`), Adapter-Gesundheit (`jarvis_adapter_health`: 1 gesund, 0,5
  eingeschränkt, 0 aus, -1 unbekannt), Cache-Treffer (`jarvis_cache_requests_total`, `jarvis_cache_hit_ratio`; Cache =
  Idempotenz-Speicher: Wiederholung = Treffer) und die Frontend-Reihen (`jarvis_frontend_orb_fps`,
  `jarvis_frontend_orb_frame_time_ms`/`_seconds`, `jarvis_frontend_webgl_memory_bytes`, `jarvis_frontend_errors_total`).
  Keine Personendaten, Label-Kardinalität begrenzt (500 Serien je Metrik).
- `POST /api/v1/telemetry/frontend` (`operator`+, CSRF): bis zu 20 Fehler (`kind` aus fester Liste, kurze Meldung,
  Route ohne Query, Anzahl) und 60 Orb-Messwerte (FPS, Frame-Zeit, WebGL-Speicher) je Anfrage; Body höchstens 32 KiB
  (`413`), 30 Anfragen je Minute und Sitzung (`429` mit `Retry-After`). Antwort `202` mit der Zahl der übernommenen Einträge.
  Meldungstexte werden serverseitig bereinigt (URLs, E-Mail-Adressen, Zahlenfolgen, Tokens) und nur als Logzeile
  festgehalten; in Metriken und Audit landet kein Text. Telemetrie erzeugt keine Audit-Einträge.

## Dev-Konsole und Szenarien

`/api/v1/dev/*` existiert nur mit Mock-Daten und `dev.scenarioConsole` (sonst `404`) und nur für `owner`. Die CLI
`apps/mock-console` (`pnpm scenario -- <befehl>`) meldet sich als `dev-owner` an und steuert Szenarien, Uhr, Adapter-
Ausfälle, Latenz/Fehlerquote, Capabilities, Orb und Reset (`pnpm scenario -- --help`; `watch` liest den Ereignisstrom).

## Tests

```bash
pnpm --filter @jarvis/control-api test        # vitest, test/*.test.ts
```

| Datei | Prüft |
|---|---|
| `contract.test.ts` | alle 109 Operationen aus der Routentabelle mit vertragsgültiger Antwort (Status, Body, Header); schlägt fehl, wenn eine Operation fehlt |
| `security.test.ts` | Sitzungen, Cookies, CSRF, Origin/Host, Rollenmatrix über alle Operationen, Login-Drosselung, Sitzungsablauf |
| `mutations.test.ts` | Idempotenz (Replay, Konflikt, parallel, Neustart), `If-Match`, `assistantName` |
| `approvals.test.ts` | Approval-Token, Einmaligkeit, Ablauf, Doppel-Approve, Tier 3 mit Re-Auth, Sprachkanal, Rollen |
| `degradation.test.ts` | Teilausfall (Mock und Hybrid), Capability fehlt, Latenz/Fehlerquote |
| `realtime.test.ts` | WebSocket: Umschläge, `?since`, `resync_required`, Ping/Pong, Sitzungsende, Sequenz über Neustarts |
| `audit.test.ts` | Hashkette, Manipulationserkennung, abgeschnittenes Ende (Kopf-Anker), Neustart mit manipulierter Datenbank |
| `observability.test.ts` | `/metrics` (Format, Rollen, Reihen), Frontend-Telemetrie (Validierung, Größe, Rate, Bereinigung) |
| `sequence.test.ts` | Hub-Sequenz = Aktivitäts-Sequenz, `sinceSequence`-Nachfüllung |
| `adapter-settings.test.ts` | `version` und `If-Match` an den Adapter-Einstellungen |
| `scenario-console.test.ts` | `release_orb_state`, `play_event` |
| `config-files.test.ts` | alle Dateien in `config/layouts` und `config/themes` gegen ihre Schemas, Start ohne Warnung |
| `secrets.test.ts` | keine Secrets in Antworten, Audit, Ereignissen, Logs und Datenbank |
| `static.test.ts` | statisches Web: SPA-Fallback, CSP-Hashes, Path-Traversal |
| `branding-commands.test.ts`, `mock-console.test.ts` | Branding, Befehls-Intents, Szenario-CLI gegen den echten Server |

`test/helpers.ts` startet die komplette App in einem temporären Verzeichnis (`startTestApi`) mit einstellbarer Uhr
(`now`), Ringpuffer, Heartbeat und Log-Mitschnitt.

## Bekannte Lücken (Vertrag und Betrieb)

Siehe `docs/PROJECT_STATUS.md`: `?speed=` an `playScenario` ist eine Erweiterung; die Control-Plane-Audit-Kette ist von
`GET /audit/events` (Audit-Adapter) getrennt; das Abschneiden der Audit-Spur samt beider Anker ist nicht erkennbar.
