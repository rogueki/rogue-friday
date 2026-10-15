# Mapping: ExampleTasks API (`adapters/example-http`) -> `Task`

Referenzimplementierung für alle HTTP-Adapter. Code: `adapters/example-http/src/mapping.ts`.
Das fiktive Fremdsystem liefert bewusst andere Namen und Wertebereiche als der Vertrag.

## Endpunkte

| ExampleTasks                                                                                     | Port-Methode    | Capability     | Hinweise                                                                        |
| ------------------------------------------------------------------------------------------------ | --------------- | -------------- | ------------------------------------------------------------------------------- |
| `GET /items?page_token=&limit=&state=&prio=&owner_bot=&tag=&q=&updated_since=&due_before=&sort=` | `listTasks`     | `tasks.read`   | `page_token` <-> `cursor`; `next_page_token = null` <-> `hasNextPage = false`   |
| `GET /items/:id`                                                                                 | `getTask`       | `tasks.read`   | 404 -> `NOT_FOUND`                                                              |
| `POST /items` (`Idempotency-Key`)                                                                | `createTask`    | `tasks.create` | Key wird durchgereicht; Wiederholung ohne Key wird nicht automatisch wiederholt |
| `PATCH /items/:id` (`If-Match: <rev>`)                                                           | `updateTask`    | `tasks.update` | 409/412 -> `CONFLICT`                                                           |
| `POST /items/:id/cancel`                                                                         | `cancelTask`    | `tasks.cancel` | setzt `state = closed`, `closed_reason = cancelled`                             |
| `GET /events?after=<seq>`                                                                        | `pollEvents()`  | `tasks.stream` | Cursor `seq` wird erst nach erfolgreichem Emit vorgerückt                       |
| `GET /items?limit=1`                                                                             | `healthCheck()` | -              | eine Anfrage, kein Retry                                                        |

Nicht unterstützt (nicht deklariert): `tasks.retry`, `tasks.pause`, `tasks.resume`.

## Felder (Fremdsystem -> kanonisch)

| ExampleTasks (`RawItem`)    | `Task`                                                                                                     | Regel                                                                                                                                                                               |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `item_id`                   | `id`                                                                                                       | `createIdCodec("task").encode(item_id)`; `source.externalId = item_id`                                                                                                              |
| `rev`                       | `version`                                                                                                  | 1:1; `If-Match` trägt dieselbe Zahl zurück                                                                                                                                          |
| `created_at` / `updated_at` | `createdAt` / `updatedAt`                                                                                  | ISO-8601 UTC                                                                                                                                                                        |
| `title`                     | `title`                                                                                                    |                                                                                                                                                                                     |
| `body`                      | `description`                                                                                              | nur wenn vorhanden                                                                                                                                                                  |
| `state` + `closed_reason`   | `status`                                                                                                   | `open` -> `todo`; `in_progress` -> `running`; `blocked` -> `waiting`; `closed` + `completed`/leer -> `done`; `closed` + `cancelled` -> `cancelled`; `closed` + `failed` -> `failed` |
| `prio` 1..5                 | `priority`                                                                                                 | 1 -> `P0`, 2 -> `P1`, 3 -> `P2`, 4 -> `P3`, 5 -> `P4`; unbekannt -> `P3`                                                                                                            |
| `owner_bot`                 | `agentId` / `agentName`                                                                                    | `createIdCodec("agent")`; `null` -> `agentId = null`                                                                                                                                |
| `pct` 0..100                | `progress`                                                                                                 | Zahl -> `{determinate, pct/100}`; `null` und `running` -> `{indeterminate, null}`; sonst `{none, null}` (nie ein erfundener Prozentwert)                                            |
| `started_at`                | `startedAt`, `runtimeMs`                                                                                   | `runtimeMs` nur bei `running`: `now - started_at`                                                                                                                                   |
| `due`                       | `dueAt`                                                                                                    |                                                                                                                                                                                     |
| `tags`                      | `labels`                                                                                                   |                                                                                                                                                                                     |
| `state = blocked`           | `blockers[0]`                                                                                              | `kind = other`, Text "Vom Fremdsystem als blockiert gemeldet."                                                                                                                      |
| (nicht vorhanden)           | `model`, `estimatedCompletionAt`, `artifacts`, `steps`, `toolCalls`, `sourceRefs`, `approvalIds`, `errors` | `null` / leere Listen                                                                                                                                                               |
| (Adapter)                   | `createdBy`                                                                                                | `{type: "adapter", id: <adapterId>}`                                                                                                                                                |

## Schreibzugriffe (kanonisch -> Fremdsystem)

`TaskCreateRequest`: `description -> body`, `priority -> prio`, `agentId -> owner_bot` (unbekannte ID -> `NOT_FOUND`),
`dueAt -> due`, `labels -> tags`. `TaskUpdateRequest.status`: `triage/todo/ready -> open`, `running/review -> in_progress`,
`waiting -> blocked`, `done -> closed/completed`, `failed -> closed/failed`, `cancelled -> closed/cancelled`.

## Ereignisse (`RawEvent.kind` -> `friday.task.*`)

| `kind`          | Ereignis                                                                | Payload                                                   |
| --------------- | ----------------------------------------------------------------------- | --------------------------------------------------------- |
| `item.created`  | `friday.task.created`                                                   | `Task`                                                    |
| `item.updated`  | `friday.task.updated`                                                   | `Task`                                                    |
| `item.progress` | `friday.task.progress`                                                  | `TaskProgressEvent {taskId, progress, message?, agentId}` |
| `item.closed`   | `friday.task.completed` / `cancelled` / `failed` (nach `closed_reason`) | `Task`                                                    |
| unbekannt       | verworfen (bewusst, mit Log)                                            | -                                                         |

## Fehler

HTTP 400/422 -> `VALIDATION_FAILED`, 401 -> `UNAUTHENTICATED`, 403 -> `FORBIDDEN`, 404 -> `NOT_FOUND`, 409/412 -> `CONFLICT`,
429 -> `RATE_LIMITED` (retryable), 5xx -> `ADAPTER_UNAVAILABLE` (retryable), 504/Timeout -> `ADAPTER_TIMEOUT`, Netzwerkfehler -> `ADAPTER_UNAVAILABLE`.
