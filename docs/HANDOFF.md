# Übergabe an den Kollegen: F.R.I.D.A.Y. Command Center

Diese Seite beschreibt, was du bekommst, wie du eine neue Anbindung (Adapter) ohne Frontendänderung baust, wie der Stand
der echten Adapter einzuordnen ist und wie du das System gegen echte Dienste startest. Grundlage ist PLAN §56 und §56.1
(`docs/PLAN.md`). Alle Befehle stammen aus der Root-`package.json`; alle Pfade wurden im Repository geprüft.

Für Begriffe und Schichten siehe [`ARCHITECTURE.md`](ARCHITECTURE.md). Für Adapter-Schnittstellen siehe
[`ADAPTER_SDK.md`](ADAPTER_SDK.md), für die Prüfsuite [`ADAPTER_CONFORMANCE.md`](ADAPTER_CONFORMANCE.md), für Installation und
Betrieb [`DEPLOYMENT.md`](DEPLOYMENT.md), für Tests [`TESTING.md`](TESTING.md).

## 1. Übergabepaket (PLAN §56)

| #   | Bestandteil                         | Pfad im Repository                                                                                                                         | Hinweis                                                                                                |
| --- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| 1   | Lauffähiges Dashboard im Mock-Modus | `apps/web` (Next.js, statischer Export nach `apps/web/out`), ausgeliefert von `apps/control-api`; Vorlage `config/dashboard.example.yaml`  | Standard ist `dataMode: mock`. Start: `pnpm dev` (Entwicklung) oder `pnpm build:app` und `pnpm start`. |
| 2   | Jarvis Control API                  | `apps/control-api` (Quellcode in `src/`, Bundle `dist/main.js` über `tsup`)                                                                | 122 Operationen, Routentabelle generiert nach `src/http/route-table.generated.ts`.                     |
| 3   | OpenAPI Contract                    | `packages/contracts/openapi/jarvis-api.yaml` (OpenAPI 3.1.1), gebündelt nach `packages/contracts/dist/jarvis-api.bundled.yaml`             | Quelle der Wahrheit für REST. Schemas unter `packages/contracts/schemas/`.                             |
| 4   | AsyncAPI Contract                   | `packages/contracts/asyncapi/jarvis-events.yaml` (AsyncAPI 3.1.0)                                                                          | 44 Ereignistypen (`jarvis.*`), WebSocket `/api/v1/events`.                                             |
| 5   | Generated SDK                       | `packages/generated-sdk` (`@jarvis/sdk`), generiert nach `src/generated/`                                                                  | Nie von Hand ändern. Neu erzeugen: `pnpm contracts:generate`.                                          |
| 6   | Adapter SDK                         | `packages/adapter-core` (`@jarvis/adapter-core`)                                                                                           | Ports, Registry, Timeout/Retry/Breaker, Health, Mapping-Helfer. Doku: `docs/ADAPTER_SDK.md`.           |
| 7   | Conformance Tests                   | `packages/adapter-testkit` (`@jarvis/adapter-testkit`), Runner `packages/adapter-testkit/scripts/run-conformance.mjs`                      | Ausführen: `pnpm test:conformance`. Doku: `docs/ADAPTER_CONFORMANCE.md`.                               |
| 8   | Beispieladapter                     | `adapters/example-http` (Kategorie `tasks`, fiktive REST-API), Vorlage `packages/adapter-core/template`                                    | Referenz mit Polling, Mutationen und Idempotenz; Vorlage mit nummerierten Schritten.                   |
| 9   | Adapter-Konfigurationsschema        | `packages/config/src/schemas/adapters.schema.json` und `dashboard.schema.json`; je Adapter ein JSON Schema in `adapters/*/src/manifest.ts` | Die Konfiguration wird beim Start gegen die Schemas geprüft.                                           |
| 10  | Mock-Szenario-Konsole               | CLI `apps/mock-console` (`pnpm scenario -- …`), Web-Seite `apps/web/src/app/(dashboard)/dev/scenarios`, API `/api/v1/dev/*`                | Nur mit `dataMode: mock` und `dev.scenarioConsole: true`.                                              |
| 11  | Mapping-Dokumente                   | `docs/MAPPING/` (Index `README.md`; `hermes.md`, `voice.md`, `system.md`, `qwen.md`, `calendar.md`, `mail-gmx.md`, `example-tasks.md`)     | Feldtabellen je Fremdsystem.                                                                           |
| 12  | Deployment-Dokumentation            | `docs/DEPLOYMENT.md`; Testdokumentation `docs/TESTING.md`                                                                                  | DEPLOYMENT beschreibt die Installation unter Windows 11.                                               |

## 2. Neue Anbindung erstellen (PLAN §56.1)

Ziel: ein neues Fremdsystem wird als Adapter angebunden. Das Frontend, die Routen, die UI-Typen und der Vertrag bleiben unverändert,
solange das kanonische Modell das Fremdobjekt ausdrückt. Passt es nicht, beginnt die Änderung im Vertrag
(`packages/contracts`, siehe `docs/CONTRACT_FIRST.md`), nicht im Adapter.

Das Beispiel unten legt einen Task-Adapter `things-http` an (Ordner `adapters/things-http`, Provider-ID `things-http`).

### Schritt 1: Vorlage kopieren (PLAN 1)

```bash
cp -r packages/adapter-core/template adapters/things-http          # POSIX
# PowerShell: Copy-Item -Recurse packages/adapter-core/template adapters/things-http
```

In `adapters/things-http/package.json` den Namen auf `@jarvis/adapter-things-http` setzen (steht schon so in der Vorlage), dann
im Root `pnpm install`. Die Vorlage liegt außerhalb des Workspace-Musters (`adapters/*`), wird also erst nach dem Kopieren gebaut
und getestet. Für Polling, Events und Mutationen zusätzlich `adapters/example-http/src/adapter.ts` lesen.

### Schritt 2: Manifest anpassen (PLAN 2)

Datei: `adapters/things-http/src/index.ts` (Vorlage) oder `src/manifest.ts` (Muster `example-http`).

- `id`: Muster `^[a-z0-9][a-z0-9-]*$`, identisch mit dem Provider-Schlüssel in der Allowlist (Schritt 9).
- `category`: eine der Kategorien aus `packages/config` (`tasks`, `activity`, `memory`, `agents`, `voice`, `system`, ...).
- `contractVersion: CONTRACT_VERSION` (aus `@jarvis/sdk`), `apiVersion: "v1"`.
- `capabilities`: nur, was umgesetzt ist. Zuerst `<modul>.read`.
- `configSchemaRef` muss gleich der `$id` des Config-Schemas sein.
- `secretFields`: Namen der Secret-Felder (Beispiel: `["apiToken"]`).

### Schritt 3: Config-Schema definieren (PLAN 3)

JSON Schema 2020-12 mit `$id` = `configSchemaRef`, `additionalProperties: false`, Defaults im Schema. Secret-Felder sind
`writeOnly: true`. Die Registry prüft die Konfiguration mit AJV, wendet Defaults an und reicht Secrets nur über
`context.getSecret(field)` weiter; sie tauchen nicht in `context.config` auf. Vorlage: `configSchema` in `src/index.ts`.

### Schritt 4: Healthcheck implementieren (PLAN 4)

`healthCheck()` wirft nie. Es führt einen billigen Aufruf mit genau einem Versuch aus (`retry: false`) und liefert
`{ status: "online" | "degraded" | "offline", latencyMs, message, errorCode? }`. Die Meldung ist deutsch und enthält keine
Secrets oder Fremdtexte. Vorlage: `GET /things?limit=1`.

### Schritt 5: Capabilities melden (PLAN 5)

`getCapabilities()` liefert eine Teilmenge von `manifest.capabilities`. Jede deklarierte Capability braucht ihre Port-Methode
(Zuordnung in `packages/adapter-core/src/port-spec.ts`); eine optionale Methode ohne Capability ist ein Fehler. Die Conformance-Suite
prüft beide Richtungen (Prüfpunkt 3).

### Schritt 6: Fremddaten auf kanonische Modelle mappen (PLAN 6)

- `defineMapper<Raw, Canonical>({ name, schema: "Task", toCanonical })` je Objekt. Das Ergebnis wird gegen das SDK-Schema
  geprüft; Fremdfelder führen zu `VALIDATION_FAILED`.
- IDs über `createIdCodec("task")` (Präfix plus 26 Zeichen, reversibel bis 15 Byte, sonst Hash mit Merktabelle).
- `source` über `context.source(externalId)` (`createMapContext`).
- Unbekanntes wird `null` oder leer, nie erfunden.
- Port-Methoden über `createHttpClient` (Timeout, Fehlercodes nach ADAPTER_SDK §3, Redaktion). Mutationen weiterhin nur mit
  Idempotency-Key wiederholen; `Idempotency-Key` und `If-Match` an das Fremdsystem durchreichen (Muster `example-http`).

Typen kommen ausschließlich aus `@jarvis/sdk` (`Task`, `TaskResponse`, ...). Keine eigenen DTOs.

### Schritt 7: Events mappen (PLAN 7)

- Fremdereignisse mit `defineEventMapper({ name, toCanonical })` in `{ type, subject, data }` übersetzen. Typ und `data` werden gegen
  die AsyncAPI-Ereignisse geprüft (`JARVIS_EVENT_DATA_SCHEMA_IDS`). `null` verwirft ein Ereignis bewusst.
- Bei Polling den Cursor erst nach erfolgreichem `emit` weiterschieben. Sonst gehen Ereignisse verloren oder entstehen Dubletten
  (Prüfpunkt 18). Muster: `pollEvents()` in `adapters/example-http/src/adapter.ts`.
- Eine `*.stream`-Capability nur deklarieren, wenn `pollEvents()` implementiert ist.

### Schritt 8: Conformance-Tests ausführen (PLAN 8)

`adapters/things-http/test/conformance.test.ts` (Vorlage vorhanden) auf das Fremdsystem anpassen: `seedThings` mit den echten
Routen, `fixtures.list`, `fixtures.get`, `invalidListBody`, `providerFields`. `mutation` und `events` sind optional; fehlen sie,
werden die zugehörigen Prüfungen als übersprungen gemeldet (nicht als bestanden).

```bash
pnpm test:conformance                       # alle Adapter, findet adapters/*/test/conformance.test.ts
pnpm exec vitest run adapters/things-http   # nur dieser Adapter
```

Muss grün sein, bevor du weitermachst. Fehlerbilder: `docs/ADAPTER_CONFORMANCE.md`.

### Schritt 9: In der Registry konfigurieren (PLAN 9)

Drei Stellen, alle im Backend:

1. **Allowlist** in `config/adapters.yaml` (Kopie aus einer Vorlage, siehe Abschnitt 4):

   ```yaml
   allowlist:
     things-http: "@jarvis/adapter-things-http"
   ```

   Provider, die nicht in der Allowlist stehen, werden beim Start abgelehnt
   (`"<provider>" is not in the adapter allowlist`).

2. **Paket einbinden**: `"@jarvis/adapter-things-http": "workspace:*"` in `apps/control-api/package.json`, danach `pnpm install`.

3. **Factory registrieren**: In `apps/control-api/src/runtime/adapter-wiring.ts` das Factory-Objekt importieren und in
   `packageFactories()` unter dem Paketnamen eintragen:

   ```ts
   "@jarvis/adapter-things-http": [thingsFactory],
   ```

   Die Control API bündelt die Factories statisch (kein dynamischer Import). Ein Paket, das in der Allowlist steht, aber hier fehlt,
   erzeugt die Warnung „Provider ist in der Allowlist, aber nicht im Build enthalten“ und wird nicht geladen.

Danach den Eintrag in `adapters.tasks` setzen (Schlüssel = Kategorie):

```yaml
adapters:
  tasks:
    provider: things-http
    enabled: true
    timeoutMs: 8000
    config:
      baseUrl: http://127.0.0.1:8099
      apiToken: env:THINGS_API_TOKEN # Secret-Referenz, nie Klartext
```

### Schritt 10: Mock-Adapter der Kategorie deaktivieren (PLAN 10)

Den Provider `mock-tasks` durch `things-http` ersetzen (Schritt 9). Wichtig: Im Modus `mock` werden Nicht-Mock-Provider ignoriert
(Warnung „ignored: data mode is mock“). Der Wechsel wirkt daher nur in `hybrid` (andere Kategorien bleiben Mock) oder `live`
(andere Kategorien sind deaktiviert). Dafür `dataMode` in `config/dashboard.yaml` setzen und neu starten.

### Abnahme

```bash
pnpm typecheck
pnpm test:conformance
pnpm build:app
git diff --stat -- apps/web packages/ui packages/orb     # muss leer sein: keine Frontendänderung
```

Zusätzlich im Live-Betrieb prüfen: `GET /api/v1/adapters` (Sitzung nötig) zeigt den Adapter als `online`; `GET /api/v1/capabilities`
enthält nur die tatsächlich deklarierten Capabilities.

## 3. Stand der echten Adapter

Die Tabelle fasst die Adapter-READMEs zusammen. Verifiziert heißt: gegen Quellcode, Fake-Upstream oder die Entwicklungs-VM
belegt (Details in den jeweiligen READMEs). Annahme (unbelegt) heißt: nicht live getestet und nicht als Capability freigeschaltet
oder ausdrücklich als Annahme markiert.

| Provider            | Kategorie  | Paket                   | Deklarierte Capabilities                                     | Nicht deklariert (Grund)                                                                                                                                                                                                                | Stand                                                                                                                                                                                                             |
| ------------------- | ---------- | ----------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hermes-tasks`      | `tasks`    | `adapters/hermes`       | `tasks.read`, `tasks.create`, `tasks.update`, `tasks.stream` | `tasks.cancel`, `tasks.retry`, `tasks.pause`, `tasks.resume`: Abbrechen nur aus dem Quelltext (`PATCH status=archived`), Wiederholen nur teilweise, Pausieren hat kein Hermes-Konzept; nichts davon live getestet                       | Verifiziert gegen Quellcode `0e427d7` und eine laufende Instanz (Kanban-REST, WebSocket mit `since`, 401-Verhalten). Annahme: Prioritätsabbildung, `failed`-Ableitung, Ereignis-Typen über Versionen.             |
| `hermes-activity`   | `activity` | `adapters/hermes`       | `activity.read`, `activity.stream`, `activity.backfill`      | keine Mutationen                                                                                                                                                                                                                        | Sitzungen und Nachrichten belegt. Inhalte und Tool-Argumente werden bewusst nicht übernommen.                                                                                                                     |
| `hermes-agents`     | `agents`   | `adapters/hermes`       | `agents.read`                                                | `agents.pause`, `agents.resume`, `agents.stop`, `agents.assignTask`: keine belegte Schnittstelle. Zuweisen läuft über `tasks.update` mit `agentId`.                                                                                     | Profile, Assignees und Worker belegt. `starting`, `paused`, `error` und der Reasoning-Level sind nicht ableitbar.                                                                                                 |
| `jarvis-voice-http` | `voice`    | `adapters/voice-http`   | `voice.read`                                                 | `voice.test`, `voice.stop`: der Dienst hat keine Steuerschnittstelle (kein POST). `voice.enroll`: läuft in `voice_setup.py`, nicht über HTTP. Geräte, Profile und Metriken: keine Datenquelle, leere Antworten mit Freshness `unknown`. | Status-JSON (ein Handler, Pfad egal) statisch gegen `jarvis_voice.py` geprüft; Dienst selbst nicht ausgeführt. Annahme: Wake Phrase, Engine-Namen, Erreichbarkeit des llama-servers (503 beim Laden), Inputpegel. |
| `local-system`      | `system`   | `adapters/system-local` | `system.read`, `system.healthcheck`                          | `system.restartAdapter`, `system.openLogs`: deklariert der Adapter nicht. Die Control API stellt beide selbst bereit (nur `owner`).                                                                                                     | Host-Metriken (CPU, RAM, Speicher), Dienstprobes, Modelllisten. Annahme: Qwen-`/health`, Hermes-Dashboard-`/api/health` mit Auth, lokalisierte `wsl.exe`-Ausgaben, `netstat -e` außerhalb Englisch/Deutsch.       |
| `mock-*`            | alle       | `adapters/mock`         | alle Port-Methoden                                           | –                                                                                                                                                                                                                                       | Vollständig, Standard in `mock`.                                                                                                                                                                                  |

Hinweise zur Einordnung:

- Die Adapter sind gegen Fake-Upstreams getestet (`pnpm test:conformance`, `pnpm exec vitest run adapters/<name>`). Das belegt die
  Verdrahtung und das Fehlerverhalten, nicht die Treue zu echten Antworten.
- Der Windows-Pfad (WSL-Portweiterleitung, `wsl.exe`, Windows-Dienststart) ist nicht geprüft. Die Entwicklungs-VM ist Linux.
- Der Hermes-Installer pinnt keine Version (`main`). Abweichende Hermes-Versionen zeigen sich als `VALIDATION_FAILED`.

## 4. Gegen echte Dienste ausführen (Hybrid-Modus)

Der Installer richtet die Dienste auf Loopback-Ports ein. Das Command Center verbindet sich nur mit diesen Ports:

| Port  | Dienst                                            | Verwendet von                                                 |
| ----- | ------------------------------------------------- | ------------------------------------------------------------- |
| 3100  | Command Center (Control API und Web, eine Origin) | Browser                                                       |
| 43691 | Hermes-Dashboard (Kanban, Profile, Status)        | `hermes-tasks`, `hermes-activity`, `hermes-agents`            |
| 43692 | Qwen3 (llama-server, Router-Alias `qwen3-router`) | `jarvis-voice-http`, `local-system`                           |
| 43693 | Hermes-API-Server (Bearer-Key)                    | `hermes-activity`, `hermes-agents` (optional), `local-system` |
| 43694 | Voice-Statusserver                                | `jarvis-voice-http`, `local-system`                           |

Port 43699 gehört nur dem Fake-Steuerendpunkt aus Abschnitt 5, nicht dem Produktivbetrieb.

**Konfiguration.** Die Hybrid-Vorlagen kopieren, nicht editieren:

```bash
cp config/dashboard.hybrid.example.yaml config/dashboard.yaml   # PowerShell: copy
cp config/adapters.hybrid.example.yaml config/adapters.yaml
```

Pfade in `dashboard.yaml` sind relativ zum Config-Verzeichnis (`JARVIS_CONFIG_DIR`, Standard `<Projektwurzel>/config`).
Für den Vollbetrieb gibt es zusätzlich `config/adapters.live.example.yaml` und `config/dashboard.live.example.yaml` (nur konfigurierte
Kategorien aktiv). Fehlt `config/adapters.yaml`, läuft im Modus `hybrid` jede Kategorie als `mock-*`; im Modus `live` ist sie dann deaktiviert.

**Geheimnisse.** Config-Dateien enthalten nur Referenzen:

| Schema                  | Beispiel                                         | Verhalten                                                                                                                                                                                   |
| ----------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `file:<absoluter Pfad>` | `apiKey: "file:C:/Jarvis/config/hermes_api.key"` | Wird bei jedem Zugriff serverseitig gelesen (Schlüsseltausch wirkt sofort). BOM und umgebende Leerzeichen werden entfernt. Der Inhalt wird nie ausgegeben. Relative Pfade werden abgelehnt. |
| `env:NAME`              | `apiToken: env:THINGS_API_TOKEN`                 | Aus der Umgebung (auch aus `.env` im Projektwurzelverzeichnis, geladen über `process.loadEnvFile`).                                                                                         |
| `wincred:ZIEL`          | `password: wincred:jarvis-caldav`                | Windows Credential Manager über das PowerShell-Modul `CredentialManager`. Nur Windows.                                                                                                      |

Ein Klartextwert in einem Feld mit Credential-Namen (`token`, `apiKey`, `password` ...) wird beim Laden abgelehnt. Die Hermes-Vorlage
nutzt `HERMES_API_KEY_FILE` als Override für den Pfad der Schlüsseldatei (`${HERMES_API_KEY_FILE:-C:/Jarvis/config/hermes_api.key}`).

**Owner-Passwort.** Ohne auflösbaren Owner-Hash schlägt jede Anmeldung fehl. Den Dev-Login (`dev-owner`, Passwort `dev`) gibt es nur im
Mock-Modus auf Loopback. Hash erzeugen (interaktive Eingabe, mindestens 12 Zeichen):

```bash
pnpm --filter @jarvis/auth hash-password
```

Das Ergebnis in `.env` eintragen (in Single Quotes, der Hash enthält `$`):

```text
JARVIS_OWNER_PASSWORD_HASH='...'
```

**Starten.**

```bash
pnpm install
pnpm build:app          # baut apps/web (statischer Export) und apps/control-api (dist/main.js)
pnpm start:hybrid       # setzt JARVIS_DATA_MODE=hybrid und startet dist/main.js
```

`pnpm start` startet ohne Modus-Override und nimmt `dataMode` aus `dashboard.yaml`. Der Server bindet nur an `127.0.0.1`
(`server.allowRemote: false`). Ein Zugriff von außen gehört hinter TLS oder VPN, nie über eine offene Portfreigabe (PLAN §49.7).

**Prüfen.**

```bash
curl -sS http://127.0.0.1:3100/api/v1/health
curl -sS http://127.0.0.1:43693/health          # Hermes-API (ohne Auth)
curl -sS http://127.0.0.1:43694/               # Voice-Status (Antwort nur, wenn Modelle geladen sind)
```

Danach im Browser auf `http://127.0.0.1:3100` als `owner` anmelden. Die Seiten zeigen pro Modul die Quelle (Badge) und den Zustand.

## 5. Fake-Upstreams und Integrationssuite

**Fake-Upstreams** (`scripts/fake-upstreams`, Ports wie oben, alles im Speicher und fiktiv):

```bash
pnpm fake:upstreams                              # Hermes (43691/43693), Voice (43694), llama (43692), Steuerport 43699
pnpm fake:upstreams --key-file <pfad>            # schreibt den API-Schlüssel in eine Datei (für file:-Referenzen)
pnpm fake:upstreams --stopped voice,hermes       # startet mit gestoppten Diensten
pnpm fake:upstreams --no-seed                    # ohne Beispieldaten
```

Ausfälle zur Laufzeit (Dienstnamen: `voice`, `llama`, `hermes-api`, `hermes-dashboard`, `hermes` für beide Hermes-Dienste):

```bash
curl -X POST http://127.0.0.1:43699/services/voice/stop
curl -X POST http://127.0.0.1:43699/services/voice/start
```

Ein gestoppter Dienst schließt seinen Port (ECONNREFUSED), genau wie ein echter gestoppter Dienst.

**Integrationssuite** (`pnpm test:integration`):

```bash
pnpm build:app                 # Voraussetzung: dist/main.js und apps/web/out müssen existieren
pnpm test:integration          # Playwright, playwright.integration.config.ts
```

Der Lauf startet `tests/integration/stack.ts`: Fake-Upstreams, Konfiguration aus den Hybrid-Vorlagen, dann die gebaute Control API
im Hybrid-Modus auf 127.0.0.1:3100. Die Spezifikation `tests/integration/hybrid.spec.ts` umfasst 9 Tests: Übersicht, Aufgaben, Agenten,
Sprache, System sowie Ausfall und Wiederanlauf von Voice und Hermes (jeweils nur das betroffene Modul ist offline).
Umgebungsvariablen: `JARVIS_INTEGRATION_DIR`, `JARVIS_EVIDENCE_DIR`, `JARVIS_CHROMIUM` (Browserpfad). Ergebnis und Screenshots:
[`docs/evidence/integration/README.md`](evidence/integration/README.md).

Zusätzlich prüfen Unit-Tests ohne Browser die Registrierung, Mock-Fallbacks, `file:`-Secrets und das Schwärzen der Logs:

```bash
pnpm --filter @jarvis/control-api test          # u. a. test/real-adapters.test.ts
```

## 6. Fehlersuche

| Symptom                                                                              | Ursache                                                                                                                                      | Lösung                                                                                                                                            |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"<provider>" is not in the adapter allowlist` beim Start                            | Provider fehlt unter `allowlist` in `config/adapters.yaml`                                                                                   | Eintrag `<provider>: "@jarvis/<paket>"` ergänzen.                                                                                                 |
| Warnung „Provider ist in der Allowlist, aber nicht im Build enthalten“               | Factory fehlt in `packageFactories()` (`apps/control-api/src/runtime/adapter-wiring.ts`) oder Paket fehlt in `apps/control-api/package.json` | Schritt 9.2 und 9.3 aus Abschnitt 2 nachholen, `pnpm install`, neu bauen.                                                                         |
| Warnung `adapters.<cat>.provider "…" ignored: data mode is "mock"`                   | Provider wird im Modus `mock` ignoriert                                                                                                      | `dataMode: hybrid` oder `live` in `config/dashboard.yaml` setzen.                                                                                 |
| `invalid secret reference (expected env:NAME, file:ABSOLUTE_PATH or wincred:TARGET)` | Tippfehler, relativer `file:`-Pfad oder fehlender Präfix                                                                                     | Absoluten Pfad mit Schrägstrichen verwenden, z. B. `file:C:/Jarvis/config/hermes_api.key`.                                                        |
| `credential-looking field must be a secret reference`                                | Klartextwert in einem Feld wie `apiKey` oder `password`                                                                                      | Durch `file:`, `env:` oder `wincred:` ersetzen.                                                                                                   |
| Modul zeigt „Nicht verbunden“, Health `offline`, `ECONNREFUSED`                      | Dienst gestoppt oder Port falsch                                                                                                             | Port prüfen (`curl` aus Abschnitt 4). Hermes: `http://127.0.0.1:43693/health`. Voice: `http://127.0.0.1:43694/`.                                  |
| Voice-Port 43694 bleibt zu, kurz nach dem Start                                      | Dienst lädt die Modelle (bis ca. 3 Minuten). Der Status-Server öffnet den Port erst danach.                                                  | Warten. Der Adapter meldet „lädt noch Modelle oder gestoppt“, weil beides von außen nicht zu unterscheiden ist.                                   |
| Voice `degraded` mit `STARTING`                                                      | Antwort mit `state: "starting"`                                                                                                              | Wie oben, warten.                                                                                                                                 |
| Hermes-Aufgaben nach Dashboard-Neustart `UNAUTHENTICATED`                            | Session-Token des Dashboards hat sich geändert                                                                                               | Mit `dashboardAuth: scrape` (Standard) liest der Adapter die Seite neu. Bei `secret` oder `file` den festen Token prüfen.                         |
| Hermes-Aufrufe `UNAUTHENTICATED` (401)                                               | API-Schlüssel falsch oder rotiert                                                                                                            | Inhalt der Schlüsseldatei prüfen. `file:` wird je Aufruf gelesen, ein Neustart ist nicht nötig.                                                   |
| `VALIDATION_FAILED` bei Aufgaben oder Agenten                                        | Unbekannter Hermes-Status oder abweichende Hermes-Version                                                                                    | Log prüfen, Abbildung in `docs/MAPPING/hermes.md` gegenprüfen. Die Liste schlägt bewusst fehl, statt falsch einzusortieren.                       |
| `409 CONFLICT` bei `PATCH` einer Aufgabe                                             | `If-Match` veraltet (Hermes kennt keine Revision, Version = letzter Zeitstempel)                                                             | Aufgabe neu laden und erneut ändern.                                                                                                              |
| `403 CSRF_INVALID`                                                                   | `X-CSRF-Token` fehlt oder passt nicht zur Sitzung                                                                                            | Token aus dem Cookie `jarvis_csrf` in den Header `X-CSRF-Token` übernehmen.                                                                       |
| `403` mit `host_not_allowed`                                                         | Host-Header ist nicht `localhost`, `127.0.0.1`, `[::1]` oder der konfigurierte Host                                                          | Über `http://127.0.0.1:3100` aufrufen.                                                                                                            |
| `403` mit `origin_not_allowed`                                                       | Schreibende Anfrage von fremder Origin                                                                                                       | Aus der eigenen Oberfläche aufrufen. Anfragen ohne `Origin`-Header (z. B. `curl`) sind erlaubt.                                                   |
| Anmeldung schlägt immer fehl (401)                                                   | `JARVIS_OWNER_PASSWORD_HASH` fehlt oder der Verweis ist nicht auflösbar                                                                      | Hash erzeugen (Abschnitt 4), in `.env` eintragen, Server neu starten.                                                                             |
| `429 RATE_LIMITED` beim Anmelden                                                     | 5 Fehlversuche je Benutzer und IP oder 20 je IP im Fenster von 15 Minuten                                                                    | `Retry-After` abwarten.                                                                                                                           |
| `/health` meldet `audit-chain` als `offline`                                         | Audit-Kette gebrochen (`truncated`, `head_mismatch` oder `anchor_tampered`)                                                                  | Ursache prüfen. Nach bewusster Wiederherstellung aus einem Backup `audit-head.json` vor dem Start löschen (siehe `apps/control-api/README.md`).   |
| Mehrfache Wiederholungen bei Ausfällen (Last am Dienst)                              | Adapter-HTTP-Client und Registry wiederholen beide (Konfigurationsdefault `retry.maxAttempts: 3`)                                            | Registry-Ebene begrenzen: `retry: { maxAttempts: 1 }` im Kategorieeintrag (nicht im Betrieb getestet). Der Adapter-HTTP-Client wiederholt weiter. |
| `Control API (pnpm build:app) fehlt` beim Integrationstest                           | Build fehlt                                                                                                                                  | `pnpm build:app` vor `pnpm test:integration` ausführen.                                                                                           |
| Playwright findet keinen Browser                                                     | Chromium nicht installiert                                                                                                                   | `pnpm exec playwright install chromium` oder `JARVIS_CHROMIUM` auf eine vorhandene Chrome-Binary setzen.                                          |
| Orb nicht sichtbar, leere Fläche in Headless-Browsern                                | WebGL ohne Software-Renderer                                                                                                                 | Flags `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`. Ohne WebGL zeigt die Oberfläche den 2D-Fallback.              |
| `pnpm`-Befehle auf Windows: „Der Befehl node … konnte nicht gefunden werden“         | Anführungszeichen im PATH (nur auf dem Entwicklungsrechner)                                                                                  | `$env:Path = $env:Path.Replace('"','')` in PowerShell vor dem Befehl.                                                                             |

## 7. Bekannte Lücken dieser Übergabe

- Die echten Dienste (Hermes, Voice, Qwen) sind in dieser Übergabe nicht live gestartet. Belegt ist die Verdrahtung gegen Fakes und
  der Stand laut `docs/PROJECT_STATUS.md`.
- Der Windows-Lauf (PowerShell, WSL-Portweiterleitung, Dienststart) ist offen. Ziel ist `C:\Jarvis` (Installer) bzw.
  `D:\Jarvis\dashboard` (Planpfad), siehe `docs/DEPLOYMENT.md` §1.
- Die Adapter-Factories sind statisch in der Control API eingetragen. Ein neuer Adapter braucht deshalb einen Eintrag im Backend,
  nicht nur die Allowlist.
- Mehrfachwiederholungen (Adapter-HTTP-Client und Registry) sind nicht aufeinander abgestimmt (siehe Fehlersuche).
- Verbleibende offene Punkte je Adapter stehen in den READMEs unter „Offene Punkte“ bzw. „Annahme (unbelegt)“.
