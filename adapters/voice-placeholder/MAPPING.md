# Mapping: Friday Voice -> Voice

Vollständige Zustands- und Ereignistabellen (Dienstzustände -> `VoiceStatus.mode` -> `OrbLayers.voice`, `voice.jsonl` -> `friday.voice.*`):
[`docs/MAPPING/voice.md`](../../docs/MAPPING/voice.md).

| Feld             | Typ     | Bedeutung                                                                                             |
| ---------------- | ------- | ----------------------------------------------------------------------------------------------------- |
| `baseUrl`        | URI     | lokale Voice-HTTP-Bridge bzw. (heute) Health-Server `127.0.0.1:<health_port>` aus `config/voice.json` |
| `apiToken`       | Secret  | optional, Token der Bridge (nur über `getSecret`)                                                     |
| `logPath`        | String  | optional: `logs/voice.jsonl` als Ereignisquelle                                                       |
| `timeoutMs`      | Integer | Timeout je Versuch (Standard 3 000)                                                                   |
| `pollIntervalMs` | Integer | Statuspolling (Standard 500)                                                                          |

Solange `baseUrl` fehlt: `offline` / "Nicht konfiguriert".
