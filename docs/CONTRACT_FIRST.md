# Contract-First

`packages/contracts` ist die alleinige Quelle der Wahrheit für Requests, Responses, Events, Enums, Fehler,
Pagination, IDs, Zeitstempel, Capabilities und Orb-Zustände (PLAN §7). Nichts davon wird von Hand parallel in
Frontend, Backend oder Adaptern gepflegt.

## Ablauf einer Änderung

1. Schema in `packages/contracts/schemas/<domain>/<name>.schema.json` anlegen oder ändern.
2. Endpunkt in `openapi/jarvis-api.yaml` bzw. Event in `asyncapi/jarvis-events.yaml` ergänzen. Schemas werden
   ausschließlich per relativem `$ref` auf die Schema-Dateien eingebunden; in `components.schemas` steht ein Alias
   je Schema, damit die generierten Namen stabil bleiben (`Task` statt `task.schema`).
3. Beispiel in `examples/<domain>/` anlegen (`{ "$schema": "<$id>", ... }`).
4. `pnpm contracts:generate` ausführen und das Ergebnis in `packages/generated-sdk/src/generated/` einchecken.
5. `pnpm contracts:check` muss grün sein, bevor implementiert wird (Mock-Handler, UI, Backend, Adapter).

## Inhalt von `packages/contracts`

| Pfad                          | Inhalt                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `schemas/<domain>/*.json`     | JSON Schema 2020-12, ein Modell je Datei, `$id` = `https://jarvis.local/schemas/<domain>/<name>.schema.json` |
| `openapi/jarvis-api.yaml`     | OpenAPI **3.1.1**, 107 Operationen unter `/api/v1`                                                           |
| `asyncapi/jarvis-events.yaml` | AsyncAPI **3.1.0**, WebSocket `/api/v1/events`, 44 Event-Typen plus `ping`/`pong`                            |
| `examples/<domain>/*.json`    | Deutsche, realistische Beispiele je Modell und je Response-Envelope                                          |
| `baseline/`                   | Schnappschuss des zuletzt freigegebenen Vertrags für die Breaking-Change-Prüfung                             |
| `scripts/`                    | `lint`, `validate`, `bundle`, `generate`, `check-generated`, `breaking`, `check`                             |
| `redocly.yaml`                | Lint-Regelsatz (recommended; einzige Abweichung: `no-unused-components` aus, siehe Datei)                    |

Domains der Schemas: `common`, `tasks`, `activity`, `memory`, `agents`, `approvals`, `communication`, `calendar`,
`automations`, `research`, `files`, `voice`, `notifications`, `system`, `audit`, `orb`, `meta` (Capabilities, Adapter,
Health, Overview, Status), `settings`, `commands`, `auth`, `dev` (Szenario-Konsole), `events` (Envelope, Control-Frames,
Event-Payloads).

## Konventionen im Vertrag

- Ressourcen tragen `id, version, createdAt, updatedAt, labels?, source`; die Basisfelder sind in jedes Ressourcen-Schema
  eingebettet (kein `allOf`), damit `additionalProperties: false` greift und Provider-spezifische Felder nicht
  durchsickern. `common/canonical-resource` dokumentiert die Basis.
- Je Ressource existieren `<name>-response` (`{contractVersion, data, freshness}`) und `<name>-list-response`
  (`{contractVersion, items, pageInfo, freshness, sources}`). Ausnahmen laut Plan: `Meta`, `Capabilities` und `Health`
  sind flache Dokumente (tragen `contractVersion` selbst).
- Fortschritt ist immer ein Bruch `0..1`; unbekannt = `{ mode: "indeterminate", value: null }`.
- Zeitstempel sind UTC-ISO-8601 (`format: date-time`), IDs opak mit Präfix + 26 Zeichen.
- Das Feld `source` ist für den Datenherkunftsdeskriptor reserviert. Fachliche Quellen heißen anders
  (z. B. `origin` im Kommando-Verlauf).
- `PATCH /settings` ersetzt jeden mitgesendeten Bereich als Ganzes (Bereichs-Merge, kein Deep-Merge). Secrets existieren
  nur als `{ configured, maskedHint? }`; Schreibzugriff über `AdapterConfigPatch.secrets` (write-only).
- Header-Parameter `X-Correlation-Id`, `X-CSRF-Token`, `If-Match`, `Idempotency-Key` sind im Vertrag optional, weil das SDK
  sie setzt; der Server erzwingt sie (CSRF auf allen mutierenden Requests, `If-Match` auf versionierten Ressourcen).
- Operationen tragen `x-capability` (z. B. `tasks.cancel`) und `x-required-role` (`viewer|operator|owner`); Dev-Endpunkte
  zusätzlich `x-dev-only`.

## Generierung

`pnpm contracts:generate` schreibt nach `packages/generated-sdk/src/generated/`:

| Datei        | Quelle                                | Inhalt                                                                                                                             |
| ------------ | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `openapi.ts` | Redocly-Bundle + `openapi-typescript` | `paths`, `components`, `operations` (typisiert den `openapi-fetch`-Client)                                                         |
| `models.ts`  | `json-schema-to-typescript`           | ein Export je Schema-`title` (`Task`, `OrbStatus`, ...), `JarvisModelMap`                                                          |
| `events.ts`  | AsyncAPI                              | `JARVIS_EVENT_TYPES`, `JarvisEventType`, `JarvisEventMap`, `JarvisEventEnvelope<T>`, `JarvisEvent`, `JARVIS_EVENT_DATA_SCHEMA_IDS` |
| `schemas.ts` | alle JSON Schemas                     | `SCHEMAS` (nach `$id`), `SCHEMA_IDS` (Titel -> `$id`), `CONTRACT_VERSION`                                                          |

Der Bundle-Schritt (`scripts/bundle.mjs`) löst die Datei-`$ref`s auf, faltet die Alias-Einträge zusammen und entfernt die
dateibezogenen `$id`/`$schema`-Schlüssel (`dist/jarvis-api.bundled.yaml`, nicht eingecheckt). `minItems`/`maxItems`
werden nur für die TypeScript-Erzeugung ignoriert (keine Tupeltypen); AJV erzwingt sie zur Laufzeit.

`@jarvis/sdk` (`packages/generated-sdk`) exportiert zusätzlich `createJarvisClient`, `JarvisApiError`,
`createSchemaValidator`, `createCorrelationId`, `createIdempotencyKey`, `isJarvisEvent`, `isControlFrame`.

## Qualitätstore (PLAN §7.4)

`pnpm contracts:check` führt nacheinander aus:

1. **lint** – Redocly (OpenAPI), `@asyncapi/parser` (Fehler-Diagnosen brechen ab), identische Versionsnummer in
   `package.json`, OpenAPI und AsyncAPI.
2. **validate** – jedes Schema kompiliert mit AJV 2020 im Strict-Modus (`ajv-formats`), jedes Beispiel validiert gegen das
   in `$schema` deklarierte Schema.
3. **check-generated** – erzeugt das SDK in ein Temp-Verzeichnis und vergleicht; veraltete Dateien brechen ab.
4. **breaking** – vergleicht OpenAPI, AsyncAPI und Schemas mit `baseline/`.

### Breaking Changes

Als Breaking gelten: entfernte Pfade/Operationen/Responses/Media-Types, neue Pflichtparameter oder Pflicht-Request-Bodies,
entfernte oder neu verpflichtende Properties, entfernte Enum-Werte, geänderte Typen/`$ref`-Ziele/`format`/`const`,
verschärfte Constraints (Minima, Maxima, Pattern), entfernte `oneOf`/`anyOf`-Varianten, geänderte `operationId`s,
entfernte Event-Typen oder geänderte Event-Payload-Schemas, entfernte Schema-Dateien. Die Prüfung schlägt fehl, solange
das Major von `info.version` nicht höher ist als in der Baseline. Nach einem Release oder bewusstem Major-Sprung:

```bash
pnpm --filter @jarvis/contracts baseline:update
```

## AsyncAPI-Version

`@asyncapi/parser` 3.6.4 wurde gegen dieselbe Datei mit `asyncapi: 3.0.0` und `asyncapi: 3.1.0` geprüft:

- 3.0.0 – gültig, aber Info-Diagnose `asyncapi-latest-version` („3.1.0 empfohlen“).
- 3.1.0 – gültig, keine Diagnosen; 46 Nachrichten (44 Events + `ping`/`pong`) und 2 Operationen werden aufgelöst,
  inklusive der relativen `$ref`s auf die JSON-Schema-Dateien.

Daher verwendet der Vertrag **AsyncAPI 3.1.0** (Konventionen §2 sahen 3.0.0 vor, mit der Auflage, bei Parser-Unterstützung
zu wechseln). Der Lint-Schritt akzeptiert beide Versionen; er schlägt nur bei Fehler-Diagnosen fehl.

## Realtime-Vertrag

- Envelope: `specversion, id, type, source, subject, time, sequence, correlationId, causationId?, contractVersion, data`.
- `data` ist je Event-Typ ein vorhandenes Ressourcen-Schema oder ein Payload-Schema aus `schemas/events/`. Die Zuordnung
  Typ -> Schema-`$id` liefert `JARVIS_EVENT_DATA_SCHEMA_IDS`; damit validieren Client (Dev) und Server `data`.
- `ping`/`pong` sind Control-Frames (`ControlFrame`), keine Envelopes, ohne `sequence`.
- Nachladen nach Verbindungsabbruch: `?since=<sequence>`; bei zu altem `since` sendet der Server
  `jarvis.status.resync_required`. Lückenfüllung über `GET /api/v1/activity?sinceSequence=`.

## Abweichungen und Auslegungen gegenüber dem Plan

- `GET /orb/status` und `jarvis.orb.status_changed` liefern `OrbSnapshot = { status: OrbStatus, layers: OrbLayers }`.
  `OrbStatus` bleibt exakt PLAN §17; die parallelen Ebenen (§18.2) liegen daneben, nicht darin.
- Approval-IDs verwenden das Präfix `appr_` (Konventionen §3 vor Plan §8.3).
- `ErrorCode` enthält zusätzlich `REAUTH_REQUIRED` (Tier-3-Freigaben ohne frische Re-Authentifizierung).
- Die Auth-Endpunkte (`/auth/*`), `/dev/scenarios/*`, `/commands/history`, `/settings/layouts*`, `/settings/import`
  gehen über §47 hinaus und sind in der Aufgabenbeschreibung gefordert.
