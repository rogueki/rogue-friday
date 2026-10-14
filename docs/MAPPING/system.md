# Mapping: Windows + WSL -> System

Zielpaket: `adapters/system-placeholder` (Provider `windows-wsl-system`, Kategorie `system`).

## Quellen

| Quelle                                        | Zugriff                                                           | Liefert                                                           |
| --------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------- |
| Metrik-Agent (`metricsEndpoint`)              | HTTP-GET, JSON                                                    | CPU, RAM, GPU, VRAM, Temperaturen, Netzwerk, Speicher             |
| Windows-Dienste / Prozesse                    | `Get-Service` / `tasklist /FO CSV /NH` (wie `_game_mode_watcher`) | Status von Diensten und Spielen                                   |
| WSL (`distro`)                                | `wsl.exe -d <distro> --exec ...`                                  | `systemctl --user is-active <unit>` für Dienste wie `kira-tts`    |
| Health-URLs (`monitoredServices[].healthUrl`) | HTTP-GET                                                          | Latenz, Erreichbarkeit (z. B. Voice-Health-Server, TTS `/health`) |
| Modell-Server (llama.cpp/Qwen-Router, Hermes) | Health-/Models-Endpunkt                                           | Provider, Modelle, Latenz, laufende Anfragen                      |

Befehle werden nur aus festen Vorlagen mit validierten Parametern (`unit`, `distro` aus der Config, nie aus Anfrage-Eingaben) gebaut;
es gibt keine freie Shell. `system.restartAdapter`/`system.openLogs` bleiben bis zur Freigabe-Logik undeklariert.

## Felder

| Quelle                         | Kanonisch                                                                                             | Regel                                                                                                                                                              |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `monitoredServices[i]`         | `Service` (`id` via `createIdCodec("svc")`)                                                           | `name`, `kind` (`windows_service`/`process` -> `other`, `wsl_systemd_user` -> `wsl`, `http` -> `api`; Hermes -> `hermes`, Modellserver -> `llm`, Voice -> `voice`) |
| Dienst aktiv / Health 200      | `Service.status`                                                                                      | `online`; langsam -> `degraded`; nicht erreichbar -> `offline`; absichtlich gestoppt (Gaming-Modus) -> `paused`                                                    |
| Antwortzeit                    | `Service.latencyMs`, `lastCheckAt`, `lastSuccessAt`                                                   |                                                                                                                                                                    |
| CPU %                          | `SystemMetrics.cpu`                                                                                   | `usagePercent`, `cores`, `temperatureC?`                                                                                                                           |
| RAM                            | `SystemMetrics.ram`                                                                                   | `usedBytes`, `totalBytes`, `usagePercent`                                                                                                                          |
| GPU / VRAM (NVML o. ä.)        | `SystemMetrics.gpu {name, usagePercent, temperatureC}` / `vram {usedBytes, totalBytes, usagePercent}` | nicht vorhanden -> `null` (nie `0` erfinden)                                                                                                                       |
| Laufwerke                      | `StorageVolume`                                                                                       | `mount`, `label`, `fileSystem`, `totalBytes`, `usedBytes`, `freeBytes`, `usagePercent`                                                                             |
| Netzwerk                       | `SystemMetrics.network`                                                                               | `rxBytesPerSec`, `txBytesPerSec`, `latencyMs`                                                                                                                      |
| Modell-Server                  | `ModelProvider`                                                                                       | `providerKind`: lokal (`qwen3-router`, `faster-whisper`, Piper/Qwen3-TTS) vs. `cloud` (Kimi); `models[]`, `latencyMs`, `activeRequests`                            |
| Spiel läuft (`game_processes`) | `Service` `kira-tts` = `paused`                                                                       | `jarvis.system.service_status_changed`                                                                                                                             |

`SystemMetrics.source` ist ein `SourceDescriptor` (`system = "windows-wsl"`); `sampledAt` ist der Messzeitpunkt (kein Cache als live ausgeben).

## Ereignisse

Metrik-Takt (`sampleIntervalSeconds`) -> `jarvis.system.metrics`; Statusänderung eines Dienstes -> `jarvis.system.service_status_changed`.
`runServiceHealthcheck` (Capability `system.healthcheck`) führt genau eine Prüfung des konfigurierten Dienstes aus und liefert `HealthcheckResult`.

## Fehler

WSL nicht installiert/Distribution gestoppt -> Service `offline` (kein Fehler des Gesamtadapters); Metrik-Agent nicht erreichbar -> `ADAPTER_UNAVAILABLE`
(Services bleiben ggf. lesbar -> Health `degraded`); Timeout -> `ADAPTER_TIMEOUT`.
