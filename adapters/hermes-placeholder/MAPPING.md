# Mapping: Hermes -> Tasks / Activity / Agents

Vollständige Feldtabellen: [`docs/MAPPING/hermes.md`](../../docs/MAPPING/hermes.md).

| Adapter           | Provider-ID       | Kategorie  | Zielobjekt                                     |
| ----------------- | ----------------- | ---------- | ---------------------------------------------- |
| `hermes-tasks`    | `hermes-tasks`    | `tasks`    | `Task` (+ `jarvis.task.*`)                     |
| `hermes-activity` | `hermes-activity` | `activity` | `ActivityEvent` (+ `jarvis.activity.appended`) |
| `hermes-agents`   | `hermes-agents`   | `agents`   | `Agent` (+ `jarvis.agent.*`)                   |

Ein Adapter je Kategorie in einem Paket (`hermesFactories`): jede Kategorie ist einzeln zwischen Mock und Live umschaltbar.

## Konfiguration (alle drei)

| Feld         | Typ     | Bedeutung                                                         |
| ------------ | ------- | ----------------------------------------------------------------- |
| `baseUrl`    | URI     | Basis-URL der Hermes-API                                          |
| `apiToken`   | Secret  | Hermes-API-Key; kommt aus dem Secret-Provider, nie aus der Config |
| `timeoutMs`  | Integer | Timeout je Versuch (Standard 10 000)                              |
| `eventsPath` | String  | Pfad der Event-/Aktivitätsquelle (Standard `/events`)             |

Solange `baseUrl` oder `apiToken` fehlen, meldet der Adapter `offline` / "Nicht konfiguriert" und bewirbt keine Capabilities.
