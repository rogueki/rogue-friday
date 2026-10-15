# @friday/adapter-system-local

System-Adapter (Kategorie `system`, Provider-ID `local-system`) für **den Rechner, auf dem die Control API läuft**: CPU/RAM/Speicher/GPU, Dienststatus per Health-Probe,
Modellliste. Plattformneutral (Windows und Linux), ohne native Module. Lesend; einzige Aktion ist `system.healthcheck` (erneute Prüfung eines Dienstes).

Ein nicht erreichbarer **Dienst** ist ein Zustand (`Service.status = offline`) und kein Fehler des Adapters. Der Adapter selbst ist `online`, solange er die lokale Maschine lesen kann.

## Konfiguration

JSON Schema: `configSchema` in `src/manifest.ts` (`$id` `urn:friday:adapter:local-system:config`, PLAN §42.2). Secrets sind `writeOnly` und werden nie zurückgegeben.

| Feld                 | Standard                 | Bedeutung                                                                                                                 |
| -------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `qwenUrl`            | `http://127.0.0.1:43692` | llama-server (Qwen-Router)                                                                                                |
| `hermesApiUrl`       | `http://127.0.0.1:43693` | Hermes API-Server                                                                                                         |
| `hermesDashboardUrl` | `http://127.0.0.1:43691` | Hermes-Dashboard                                                                                                          |
| `voiceUrl`           | `http://127.0.0.1:43694` | Status-Server des Voice-Dienstes                                                                                          |
| `hermesApiKey`       | -                        | **Secret** (`env:HERMES_API_KEY` o. Ä.): Bearer-Key nur für `GET /v1/models`                                              |
| `hermesApiKeyFile`   | -                        | Alternative: Pfad zur Installer-Datei (`C:\Friday\config\hermes_api.key`), Inhalt wird je Abfrage gelesen; Secret gewinnt |
| `storagePaths`       | `C:\` (Windows), `/`     | Laufwerke/Verzeichnisse für `statfs`; nicht lesbare Pfade werden übersprungen und geloggt                                 |
| `enableGpuProbe`     | `true`                   | `nvidia-smi` abfragen, wenn vorhanden                                                                                     |
| `nvidiaSmiPath`      | `nvidia-smi`             | Name oder Pfad                                                                                                            |
| `enableWsl`          | `true`                   | nur Windows: `wsl.exe -l -v`                                                                                              |
| `wslDistro`          | `Ubuntu`                 | Distribution, in der Hermes läuft                                                                                         |
| `timeoutMs`          | `2000`                   | je Probe, **ein Versuch**, keine Wiederholung                                                                             |

Alle Ports sind Installer-Standard (`docs/INSTALLER_INTEGRATION_REVIEW.md` §3.1) und überschreibbar. Factory: `localSystemFactory`; Eintrag z. B.
`adapters.system: { provider: local-system, config: { hermesApiKey: "env:HERMES_API_KEY" } }`.

## Capability-Matrix

| Capability              | Deklariert | Methode                 | Quelle                                                                             |
| ----------------------- | :--------: | ----------------------- | ---------------------------------------------------------------------------------- |
| `system.read`           |     ja     | `getSystemMetrics`      | `node:os` (CPU, RAM), `statfs` (Speicher), `nvidia-smi` (GPU/VRAM), Netzwerkzähler |
|                         |            | `listServices`          | Health-Probes (siehe unten)                                                        |
|                         |            | `listStorageVolumes`    | `fs.statfs` je konfiguriertem Pfad                                                 |
|                         |            | `listModelProviders`    | Qwen `GET /v1/models`, Hermes `GET /v1/models` (Bearer)                            |
| `system.healthcheck`    |     ja     | `runServiceHealthcheck` | genau ein Dienst, erneute Probe, keine Wiederholung                                |
| `system.restartAdapter` |    nein    | -                       | braucht Approval-Fluss und Audit                                                   |
| `system.openLogs`       |    nein    | -                       | wie oben                                                                           |

Keine Events (`system.stream` existiert nicht in der Kategorie).

## Hardware

| Wert               | Quelle                                                                                                                          | Fehlt die Quelle                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `cpu.usagePercent` | Tick-Deltas aller Kerne aus `os.cpus()` zwischen zwei Aufrufen; erster Aufruf misst ca. 150 ms                                  | -                                                                                          |
| `cpu.cores`        | `os.cpus().length`                                                                                                              | mindestens 1                                                                               |
| `cpu.temperatureC` | keine portable Quelle                                                                                                           | `null`                                                                                     |
| `ram.*`            | `os.totalmem()` / `os.freemem()` (Linux: `MemAvailable`)                                                                        | -                                                                                          |
| `gpu`, `vram`      | `nvidia-smi --query-gpu=name,utilization.gpu,temperature.gpu,memory.used,memory.total --format=csv,noheader,nounits`, erste GPU | `null` (nie `0`); Grund im Log (`ENOENT`, unlesbare Ausgabe); Fehlschlag wird 30 s gemerkt |
| `temperatures`     | GPU-Temperatur, wenn gemeldet                                                                                                   | leere Liste                                                                                |
| Speicher           | `used = (blocks - bfree) * bsize`, `free = bavail * bsize`, Prozent wie `df`                                                    | Pfad entfällt in der Liste                                                                 |
| `network.*PerSec`  | Linux: `/proc/net/dev` (ohne `lo`); Windows: `netstat -e` (Zeile `Bytes`, englisch/deutsch); jeweils Delta zwischen Aufrufen    | **0** (Vertragslücke, siehe unten); Grund im Log                                           |

## Dienste (`listServices`, `kind`)

Jede Probe ist ein Versuch mit `timeoutMs`; Antwortzeit = gemessene Dauer. Fremdtexte der Dienste gelangen nie in `detail`.

| Dienst (`kind`)             | Probe                                   | online                     | degraded                                                         | offline                                                                            |
| --------------------------- | --------------------------------------- | -------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Qwen lokal (`llm`)          | `GET /v1/models` (belegt, `IP:348`)     | 2xx                        | Timeout, 5xx, kaputtes JSON, 4xx; 503 mit `/health` 503 = "lädt" | Verbindung verweigert                                                              |
| Hermes API (`hermes`)       | `GET /health`, ohne Auth (belegt)       | `{"status":"ok"}`          | Timeout, 5xx, anderer Status, kaputtes JSON                      | Verbindung verweigert                                                              |
| Hermes Dashboard (`hermes`) | `GET /api/health`                       | 2xx; auch 401/403          | Timeout, 5xx                                                     | Verbindung verweigert; 404 = `unknown`                                             |
| Voice-Dienst (`voice`)      | `GET /` (Pfad egal, belegt)             | `state` ausser `starting`  | `starting`, Timeout, unbekannter `state`                         | Port zu: lädt Modelle (bis ca. 3 min) oder gestoppt                                |
| WSL (`wsl`, nur Windows)    | `wsl.exe -l -v` (UTF-16LE, Best Effort) | Distribution läuft         | -                                                                | gestoppt, nicht gefunden, `wsl.exe` fehlt; unbekannter Zustand/Timeout = `unknown` |
| Control API (`api`)         | keine (dieser Prozess)                  | immer, `detail` = Laufzeit | -                                                                | -                                                                                  |

`lastSuccessAt` = letzter Zeitpunkt mit `online` seit Adapterstart (nicht persistent); `createdAt` = Adapterstart.

## Modelle (`listModelProviders`)

- **Qwen (lokal, llama.cpp)**: `providerKind local`, Modelle aus `/v1/models` (Alias `qwen3-router`, `start-qwen-server.ps1`).
- **Hermes (API-Server)**: `providerKind local`, Modelle aus `/v1/models` mit Bearer-Key (erwartet `friday`, `API_SERVER_MODEL_NAME`). Ohne Key: Status aus `/health`, Modelle leer.
  Falscher Key (401): `degraded`, Modelle leer, der Key erscheint nirgends.
- **Kimi** wird bewusst **nicht** aufgeführt: dass Hermes zu Kimi routet, ist aus `/v1/models` nicht belegbar.
- `activeRequests` ist immer `0` (keine Datenquelle: `/slots` ist optional und unbelegt); `contextWindow` entfällt.

## Verifiziert / Annahme (unbelegt)

Verifiziert (Doku mit Quellcodebelegen bzw. live getestet in `docs/MAPPING/hermes.md`): Ports und Bindung an `127.0.0.1`, Qwen-Bereitschaft über `GET /v1/models` und Alias `qwen3-router`,
Hermes `GET /health` ohne Auth und `GET /v1/models` mit Bearer, Voice-Status-Server (ein Handler, Pfad egal, Port beim Laden geschlossen), `wsl.exe -l -v` als Installer-Werkzeug (`-d Ubuntu`).

**Annahme (unbelegt):** Qwen `GET /health` (nur zur Verfeinerung bei 5xx, Fehlschlag wird ignoriert) und 503 beim Laden; Form der `/v1/models`-Antwort von llama-server (gelesen wird nur `data[].id`);
Hermes-Dashboard `GET /api/health` samt Authentifizierung; lokalisierte Zustandsworte von `wsl.exe` (englisch und deutsch bekannt, andere = `unknown`); Bezeichnung `Bytes` in `netstat -e` für andere Sprachen als Englisch/Deutsch.
Der Dienstlauf selbst (Windows) wurde nicht ausgeführt; Windows-Pfade (`wsl.exe`, `netstat`) sind über eine injizierte `HostApi` mit Beispielausgaben getestet.

## Sicherheit

Befehle: ausschließlich `nvidia-smi`, `wsl.exe -l -v`, `netstat -e` mit festen Argumenten ohne Shell; `nvidiaSmiPath` ist Betreiberkonfiguration, keine Anfrageeingabe.
Der Hermes-Key geht nur im `Authorization`-Header an `/v1/models`, wird in Fehlertexten maskiert und erscheint in keinem Ergebnis, Log oder Health-Report (Conformance-Test mit Canary-Secret).

## Tests

```bash
pnpm --filter @friday/adapter-system-local typecheck
pnpm exec vitest run adapters/system-local
pnpm test:conformance
```

- `test/parsers.test.ts`: CPU-Deltas, `nvidia-smi` (inkl. `[N/A]`), `/proc/net/dev`, `netstat -e`, `wsl.exe` (UTF-16LE, deutsch), Modellliste.
- `test/adapter.test.ts`: Hardware, Speicher, jeder Dienst in jedem Zustand, WSL (simulierter Windows-Host), Healthcheck-Aktion, Modelle, Key aus Secret/Datei, echter Rechner (`node:os`, `statfs`).
- `test/conformance.test.ts`: Prüfpunkte aus PLAN §11.1 mit den Namen der Conformance-Suite.
- Fakes in `test/fake/`: `voice-status-server.ts` (byte-genau wie `friday_voice.py`), `llama-server.ts` (`/v1/models`), `hermes-server.ts` (`/health`, `/v1/models` mit Bearer-Prüfung, Dashboard), jeweils mit `setOffline`, Latenz/Timeout, Statuscodes und Ungültig-Daten-Schaltern (Testkit-`FakeUpstream`).

### Conformance: Abweichung von `runConformanceSuite`

Die Standard-Suite seedet N paginierte Fremd-Items und erwartet bei Ausfall des Fremdsystems einen geworfenen `ADAPTER_UNAVAILABLE`. Hier liefert die lokale Maschine die Daten und ein ausgefallener
Dienst ist ein Wert (`offline`/`degraded`). `test/conformance.test.ts` prüft deshalb dieselben Punkte mit angepassten Erwartungen (z. B. "offline behaviour" = Adapter bleibt `online`, Dienste melden `offline`,
nichts wirft). Hilfen: `test/support/conformance-kit.ts`.

## Vertragslücken

- `SystemMetrics.network.rxBytesPerSec/txBytesPerSec` sind Pflicht und nicht nullable; ohne Zähler (macOS, unbekannte Windows-Sprache) bleibt nur `0`.
- `ModelProvider.activeRequests` ist Pflicht und nicht nullable (hier immer `0`).
- `IdPrefix` in `@friday/adapter-core` kennt `vol` und `mdl` nicht (Verträge verlangen sie); `src/ids.ts` castet.
