# Mapping: Windows + WSL -> System

Vollständige Feldtabellen: [`docs/MAPPING/system.md`](../../docs/MAPPING/system.md).

| Feld                                 | Standard | Bedeutung                              |
| ------------------------------------ | -------- | -------------------------------------- |
| `distro`                             | `Ubuntu` | WSL-Distribution von Hermes/TTS        |
| `metricsEndpoint`                    | -        | optionaler lokaler Metrik-Agent (JSON) |
| `monitoredServices[]`                | `[]`     | `{id, name, kind, healthUrl?, unit?}`  |
| `sampleIntervalSeconds`, `timeoutMs` | 5, 5 000 |                                        |

Kein Secret. Solange weder `metricsEndpoint` noch `monitoredServices` gesetzt sind: `offline` / "Nicht konfiguriert".
