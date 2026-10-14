# Adapter SDK

Der Adapter SDK (`@jarvis/adapter-core`) ist die einzige Brücke zwischen der F.R.I.D.A.Y. Control API und einem Fremdsystem
(PLAN §10). Das Frontend spricht nie mit Hermes, GMX, Voice, Kalender oder dem Betriebssystem, sondern nur mit der Control API; diese
arbeitet ausschließlich über **Ports** und austauschbare **Adapter**. Ein produktiver Adapter lässt sich gegen den Mock-Adapter
austauschen, ohne Frontend, Routen, UI-Typen oder Komponenten zu ändern (PLAN §11.2 "Goldene Regel").

| Paket                                                  | Inhalt                                                                                                |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `@jarvis/adapter-core` (`packages/adapter-core`)       | Interfaces, Ports, Fehler, Resilienz, Health, Registry, Mapping-Helfer, HTTP-Client                   |
| `@jarvis/adapter-testkit` (`packages/adapter-testkit`) | Conformance-Suite, Fake-Upstream (siehe [ADAPTER_CONFORMANCE.md](ADAPTER_CONFORMANCE.md))             |
| `adapters/example-http`                                | vollständiger Referenzadapter (Kategorie `tasks`) gegen eine fiktive REST-API                         |
| `adapters/*-placeholder`                               | geplante Anbindungen (Hermes, Voice, GMX, Kalender, System): "Nicht konfiguriert", keine Capabilities |
| `packages/adapter-core/template`                       | kopierbare Vorlage für einen neuen Adapter                                                            |
| `docs/MAPPING/*.md`                                    | Feldtabellen je Fremdsystem                                                                           |

Typen kommen ausschließlich aus `@jarvis/sdk` (generiert aus `packages/contracts`). **Es werden keine DTO-Typen von Hand gepflegt.**

## 1. Konzepte

```text
Fremdsystem ──► Adapter (Mapper, validiert) ──► Registry (Timeout, Retry, Breaker, Ergebnisprüfung) ──► Control API ──► Dashboard
```

- **Port**: schmales Interface je Domäne (`TaskPort`, `MemoryPort`, ...). Jede Methode entspricht genau einer OpenAPI-Operation
  (gleicher Name wie die `operationId`).
- **Adapter**: implementiert `JarvisAdapter` (Lebenszyklus) plus den Port seiner Kategorie. Er übersetzt Fremdobjekte in kanonische Modelle.
- **Capability**: `<modul>.<flag>`, z. B. `tasks.create`. Die Control API schaltet Aktionen im UI danach frei (`GET /capabilities`).
- **Registry**: lädt nur allowlistete Adapter, isoliert Fehler, erzwingt Resilienz und prüft jedes Ergebnis gegen den Vertrag.
- **Source-Descriptor**: jede Ressource trägt `source {adapterId, system, externalId?, lastSyncedAt}`.
- **Kein Source-Leak**: Fremdfelder erreichen die Control API nie; kanonische Schemas haben `additionalProperties: false`.

## 2. Schnittstellen

### 2.1 `JarvisAdapter` (PLAN §10.3)

```ts
interface JarvisAdapter {
  readonly manifest: AdapterManifest; // aus @jarvis/sdk
  initialize(context: AdapterContext): Promise<void>; // leicht; kein Netzwerkzwang
  healthCheck(): Promise<AdapterHealthReport>; // wirft nie
  getCapabilities(): Promise<CapabilitySet>; // Teilmenge von manifest.capabilities
  shutdown(): Promise<void>; // Timer, Sockets, Subscriptions freigeben
  pollEvents?(): Promise<number>; // optional, für *.stream
}
```

### 2.2 `AdapterContext`

| Feld                | Zweck                                                                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `adapterId`, `mode` | `manifest.id`; `mock` / `hybrid` / `live`                                                                                                                                                                    |
| `logger`            | `Logger {debug, info, warn, error, child}`; die Registry maskiert Secrets in Nachricht und Feldern                                                                                                           |
| `clock`             | **statt** `Date.now()`/`setTimeout`: `clock.now()`, `clock.setTimeout(cb, ms)` -> Cancel-Funktion; macht Mocks und Tests deterministisch (`createManualClock()`)                                             |
| `config`            | gegen das Config-Schema validiert, Defaults angewendet; **ohne** Secret-Felder                                                                                                                               |
| `getSecret(field)`  | einziger Zugriff auf Secrets (nur Felder aus `manifest.secretFields`)                                                                                                                                        |
| `emit(event)`       | kanonisches Ereignis `{type, subject, data, correlationId?, causationId?}` ohne Envelope; Hub vergibt `id`, `time`, `sequence`; Payload wird gegen `JARVIS_EVENT_DATA_SCHEMA_IDS` validiert, Verstöße werfen |
| `signal`            | `AbortSignal`, bei Shutdown abgebrochen                                                                                                                                                                      |
| `correlationId()`   | Korrelations-ID des laufenden Port-Aufrufs (AsyncLocalStorage), sonst eine frische                                                                                                                           |

### 2.3 Port-Aufrufe

```ts
listTasks(params: ListTasksParams, call: CallContext): Promise<Page<Task>>
createTask?(params: { body: TaskCreateRequest }, call: MutationContext): Promise<Single<Task>>
```

- `CallContext {correlationId, actor?, signal?}`; `MutationContext` ergänzt `ifMatchVersion?` (aus `If-Match`) und `idempotencyKey?`.
- `Page<T> {items, pageInfo, freshness, sources?}`, `Single<T> {data, freshness}`, `Hits<T>`, `ActionOutcome` (= `ActionResult` ohne `contractVersion`).
  `contractVersion` ergänzt die Control API; `sources` leitet die Registry aus den `source`-Feldern der Items ab, wenn der Adapter es weglässt.
- `*.read`-Methoden sind Pflicht, alle anderen optional (= optionale Capability). `PortMap` bildet Kategorie -> Port ab.
- `PORT_SPEC` (in `port-spec.ts`) ordnet jeder Methode Operation, Capability, Mutation und Ergebnisform zu; daraus leiten Registry
  und Conformance-Suite ihr Verhalten ab. Der Typ erzwingt, dass jede Port-Methode einen Eintrag hat.

#### Methoden je Port

##### tasks

| Methode      | Capability     | Pflicht | Mutierend | Ergebnis                  |
| ------------ | -------------- | ------- | --------- | ------------------------- |
| `listTasks`  | `tasks.read`   | ja      | nein      | page (`TaskListResponse`) |
| `getTask`    | `tasks.read`   | ja      | nein      | single (`TaskResponse`)   |
| `createTask` | `tasks.create` | nein    | ja        | single (`TaskResponse`)   |
| `updateTask` | `tasks.update` | nein    | ja        | single (`TaskResponse`)   |
| `cancelTask` | `tasks.cancel` | nein    | ja        | single (`TaskResponse`)   |
| `retryTask`  | `tasks.retry`  | nein    | ja        | single (`TaskResponse`)   |
| `pauseTask`  | `tasks.pause`  | nein    | ja        | single (`TaskResponse`)   |
| `resumeTask` | `tasks.resume` | nein    | ja        | single (`TaskResponse`)   |

Nur-Flag-Capabilities (ohne Methode): `tasks.stream`

##### activity

| Methode            | Capability      | Pflicht | Mutierend | Ergebnis                           |
| ------------------ | --------------- | ------- | --------- | ---------------------------------- |
| `listActivity`     | `activity.read` | ja      | nein      | page (`ActivityEventListResponse`) |
| `getActivityEvent` | `activity.read` | ja      | nein      | single (`ActivityEventResponse`)   |

Nur-Flag-Capabilities (ohne Methode): `activity.stream`, `activity.backfill`

##### memory

| Methode        | Capability      | Pflicht | Mutierend | Ergebnis                      |
| -------------- | --------------- | ------- | --------- | ----------------------------- |
| `listMemory`   | `memory.read`   | ja      | nein      | page (`MemoryListResponse`)   |
| `getMemory`    | `memory.read`   | ja      | nein      | single (`MemoryResponse`)     |
| `createMemory` | `memory.write`  | nein    | ja        | single (`MemoryResponse`)     |
| `updateMemory` | `memory.write`  | nein    | ja        | single (`MemoryResponse`)     |
| `deleteMemory` | `memory.delete` | nein    | ja        | action                        |
| `searchMemory` | `memory.search` | nein    | nein      | hits (`MemorySearchResponse`) |

Nur-Flag-Capabilities (ohne Methode): `memory.lock`

##### agents

| Methode       | Capability      | Pflicht | Mutierend | Ergebnis                   |
| ------------- | --------------- | ------- | --------- | -------------------------- |
| `listAgents`  | `agents.read`   | ja      | nein      | page (`AgentListResponse`) |
| `getAgent`    | `agents.read`   | ja      | nein      | single (`AgentResponse`)   |
| `pauseAgent`  | `agents.pause`  | nein    | ja        | single (`AgentResponse`)   |
| `resumeAgent` | `agents.resume` | nein    | ja        | single (`AgentResponse`)   |
| `stopAgent`   | `agents.stop`   | nein    | ja        | single (`AgentResponse`)   |

Nur-Flag-Capabilities (ohne Methode): `agents.assignTask`

##### approvals

| Methode                  | Capability                 | Pflicht | Mutierend | Ergebnis                      |
| ------------------------ | -------------------------- | ------- | --------- | ----------------------------- |
| `listApprovals`          | `approvals.read`           | ja      | nein      | page (`ApprovalListResponse`) |
| `getApproval`            | `approvals.read`           | ja      | nein      | single (`ApprovalResponse`)   |
| `approveApproval`        | `approvals.decide`         | nein    | ja        | single (`ApprovalResponse`)   |
| `rejectApproval`         | `approvals.decide`         | nein    | ja        | single (`ApprovalResponse`)   |
| `requestApprovalContext` | `approvals.requestContext` | nein    | ja        | single (`ApprovalResponse`)   |

Nur-Flag-Capabilities (ohne Methode): `approvals.editBeforeApprove`

##### communication

| Methode            | Capability            | Pflicht | Mutierend | Ergebnis                     |
| ------------------ | --------------------- | ------- | --------- | ---------------------------- |
| `listChannels`     | `communication.read`  | ja      | nein      | page (`ChannelListResponse`) |
| `listThreads`      | `communication.read`  | ja      | nein      | page (`ThreadListResponse`)  |
| `getThread`        | `communication.read`  | ja      | nein      | single (`ThreadResponse`)    |
| `createDraft`      | `communication.draft` | nein    | ja        | single (`DraftResponse`)     |
| `updateDraft`      | `communication.draft` | nein    | ja        | single (`DraftResponse`)     |
| `requestDraftSend` | `communication.send`  | nein    | ja        | single (`ApprovalResponse`)  |

Nur-Flag-Capabilities (ohne Methode): `communication.multiChannel`

##### calendar

| Methode                  | Capability         | Pflicht | Mutierend | Ergebnis                              |
| ------------------------ | ------------------ | ------- | --------- | ------------------------------------- |
| `listCalendarEvents`     | `calendar.read`    | ja      | nein      | page (`CalendarEventListResponse`)    |
| `getCalendarEvent`       | `calendar.read`    | ja      | nein      | single (`CalendarEventResponse`)      |
| `listCalendarConflicts`  | `calendar.read`    | ja      | nein      | page (`CalendarConflictListResponse`) |
| `listCalendarBriefings`  | `calendar.read`    | ja      | nein      | page (`CalendarBriefingListResponse`) |
| `createCalendarProposal` | `calendar.propose` | nein    | ja        | single (`CalendarProposalResponse`)   |

Nur-Flag-Capabilities (ohne Methode): `calendar.create`, `calendar.reschedule`, `calendar.cancel`, `calendar.invite`, `calendar.respond`

##### automations

| Methode              | Capability            | Pflicht | Mutierend | Ergebnis                           |
| -------------------- | --------------------- | ------- | --------- | ---------------------------------- |
| `listAutomations`    | `automations.read`    | ja      | nein      | page (`AutomationListResponse`)    |
| `getAutomation`      | `automations.read`    | ja      | nein      | single (`AutomationResponse`)      |
| `listAutomationRuns` | `automations.read`    | ja      | nein      | page (`AutomationRunListResponse`) |
| `createAutomation`   | `automations.create`  | nein    | ja        | single (`AutomationResponse`)      |
| `updateAutomation`   | `automations.update`  | nein    | ja        | single (`AutomationResponse`)      |
| `testAutomation`     | `automations.test`    | nein    | ja        | single (`AutomationRunResponse`)   |
| `enableAutomation`   | `automations.enable`  | nein    | ja        | single (`AutomationResponse`)      |
| `disableAutomation`  | `automations.disable` | nein    | ja        | single (`AutomationResponse`)      |

Nur-Flag-Capabilities (ohne Methode): `automations.pauseAll`

##### research

| Methode                 | Capability      | Pflicht | Mutierend | Ergebnis                              |
| ----------------------- | --------------- | ------- | --------- | ------------------------------------- |
| `listResearchProjects`  | `research.read` | ja      | nein      | page (`ResearchProjectListResponse`)  |
| `getResearchProject`    | `research.read` | ja      | nein      | single (`ResearchProjectResponse`)    |
| `listResearchSources`   | `research.read` | ja      | nein      | page (`ResearchSourceListResponse`)   |
| `listResearchFindings`  | `research.read` | ja      | nein      | page (`ResearchFindingListResponse`)  |
| `listResearchArtifacts` | `research.read` | ja      | nein      | page (`ResearchArtifactListResponse`) |

Nur-Flag-Capabilities (ohne Methode): `research.create`, `research.export`

##### files

| Methode          | Capability       | Pflicht | Mutierend | Ergebnis                       |
| ---------------- | ---------------- | ------- | --------- | ------------------------------ |
| `listFiles`      | `files.read`     | ja      | nein      | page (`FileItemListResponse`)  |
| `getFile`        | `files.read`     | ja      | nein      | single (`FileItemResponse`)    |
| `getFilePreview` | `files.preview`  | nein    | nein      | single (`FilePreviewResponse`) |
| `downloadFile`   | `files.download` | nein    | nein      | raw                            |
| `deleteFile`     | `files.delete`   | nein    | ja        | delete-file                    |

Nur-Flag-Capabilities (ohne Methode): `files.upload`

##### voice

| Methode             | Capability   | Pflicht | Mutierend | Ergebnis                           |
| ------------------- | ------------ | ------- | --------- | ---------------------------------- |
| `getVoiceStatus`    | `voice.read` | ja      | nein      | single (`VoiceStatusResponse`)     |
| `listVoiceDevices`  | `voice.read` | ja      | nein      | page (`VoiceDeviceListResponse`)   |
| `getVoiceMetrics`   | `voice.read` | ja      | nein      | single (`VoiceMetricsResponse`)    |
| `listVoiceProfiles` | `voice.read` | ja      | nein      | page (`VoiceProfileListResponse`)  |
| `runVoiceTest`      | `voice.test` | nein    | ja        | single (`VoiceTestResultResponse`) |
| `stopVoice`         | `voice.stop` | nein    | ja        | action                             |

Nur-Flag-Capabilities (ohne Methode): `voice.enroll`

##### notifications

| Methode                   | Capability                  | Pflicht | Mutierend | Ergebnis                          |
| ------------------------- | --------------------------- | ------- | --------- | --------------------------------- |
| `listNotifications`       | `notifications.read`        | ja      | nein      | page (`NotificationListResponse`) |
| `acknowledgeNotification` | `notifications.acknowledge` | nein    | ja        | single (`NotificationResponse`)   |
| `snoozeNotification`      | `notifications.snooze`      | nein    | ja        | single (`NotificationResponse`)   |
| `resolveNotification`     | `notifications.resolve`     | nein    | ja        | single (`NotificationResponse`)   |

Nur-Flag-Capabilities (ohne Methode): -

##### system

| Methode                 | Capability           | Pflicht | Mutierend | Ergebnis                             |
| ----------------------- | -------------------- | ------- | --------- | ------------------------------------ |
| `getSystemMetrics`      | `system.read`        | ja      | nein      | single (`SystemMetricsResponse`)     |
| `listServices`          | `system.read`        | ja      | nein      | page (`ServiceListResponse`)         |
| `listStorageVolumes`    | `system.read`        | ja      | nein      | page (`StorageVolumeListResponse`)   |
| `listModelProviders`    | `system.read`        | ja      | nein      | page (`ModelProviderListResponse`)   |
| `runServiceHealthcheck` | `system.healthcheck` | nein    | ja        | single (`HealthcheckResultResponse`) |

Nur-Flag-Capabilities (ohne Methode): `system.restartAdapter`, `system.openLogs`

##### audit

| Methode           | Capability     | Pflicht | Mutierend | Ergebnis                        |
| ----------------- | -------------- | ------- | --------- | ------------------------------- |
| `listAuditEvents` | `audit.read`   | ja      | nein      | page (`AuditEventListResponse`) |
| `getAuditEvent`   | `audit.read`   | ja      | nein      | single (`AuditEventResponse`)   |
| `exportAudit`     | `audit.export` | nein    | nein      | page (`AuditEventListResponse`) |

Nur-Flag-Capabilities (ohne Methode): `audit.hashChain`

##### commands

| Methode              | Capability         | Pflicht | Mutierend | Ergebnis                                 |
| -------------------- | ------------------ | ------- | --------- | ---------------------------------------- |
| `listCommandHistory` | `commands.history` | ja      | nein      | page (`CommandHistoryEntryListResponse`) |
| `executeCommand`     | `commands.execute` | nein    | ja        | flat (`CommandResponse`)                 |
| `stopCommand`        | `commands.stop`    | nein    | ja        | action                                   |
| `pauseCommand`       | `commands.pause`   | nein    | ja        | action                                   |
| `resumeCommand`      | `commands.resume`  | nein    | ja        | action                                   |

Nur-Flag-Capabilities (ohne Methode): -

Zusätzlich existiert `OrbPort.getOrbStatus` (Quelle für `GET /orb/status`); die Control API kann den Snapshot auch aus anderen Ports ableiten.
Nicht über Ports laufen Meta, Auth, Settings, Adapterverwaltung und Dev-Szenarien: sie gehören der Control API.

## 3. Fehler (`AdapterError`)

Aus einem Adapter treten nur `AdapterError` aus: `code` (SDK-`ErrorCode`), `retryable`, `severity`, `details`, `correlationId`.
`normalizeError(unknown)` wandelt alles Übrige um und verschluckt nie etwas (unbekannt -> `INTERNAL` mit `cause`).

| Auslöser                                                                             | Code                                                      | retryable |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------- | --------- |
| HTTP 400, 422, ungültige Fremddaten, Schema-Verstoß, kaputtes JSON                   | `VALIDATION_FAILED`                                       | nein      |
| HTTP 401                                                                             | `UNAUTHENTICATED`                                         | nein      |
| HTTP 403                                                                             | `FORBIDDEN`                                               | nein      |
| HTTP 404, 410                                                                        | `NOT_FOUND`                                               | nein      |
| HTTP 409, 412, 428                                                                   | `CONFLICT`                                                | nein      |
| HTTP 429                                                                             | `RATE_LIMITED` (`details.retryAfterMs` aus `Retry-After`) | ja        |
| HTTP 5xx, ECONNREFUSED, ENOTFOUND, ECONNRESET, EAI_AGAIN, Socket-Abbruch             | `ADAPTER_UNAVAILABLE`                                     | ja        |
| HTTP 408/504, `TimeoutError`, ETIMEDOUT, `UND_ERR_*_TIMEOUT`, Deadline überschritten | `ADAPTER_TIMEOUT`                                         | ja        |
| `AbortError` (Shutdown)                                                              | `ADAPTER_UNAVAILABLE`                                     | nein      |
| Kategorie ohne Adapter / Capability nicht deklariert (Registry)                      | `CAPABILITY_MISSING`                                      | nein      |
| Rest                                                                                 | `INTERNAL`                                                | nein      |

## 4. Resilienz (PLAN §10.8)

Alle Zeitfunktionen laufen über die injizierbare `Clock`.

| Baustein                                      | Verhalten                                                                                                                                                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `withTimeout(op, {timeoutMs, clock, signal})` | Deadline je Versuch; `ADAPTER_TIMEOUT`; `op` bekommt ein Abort-Signal                                                                                                                                        |
| `retry(op, policy)`                           | begrenzt (Standard 3 Versuche), exponentielles Backoff (200 ms, Faktor 2, max. 5 s), **Full Jitter** (`[0, Obergrenze]`), nur bei `retryable`, abbrechbar, respektiert `retryAfterMs`                        |
| `CircuitBreaker`                              | `closed` -> `open` nach 5 Fehlern in Folge; nach 30 s `half_open` (1 Probe); Erfolg schließt, Fehler öffnet erneut; meldet Zustandswechsel; zählt nur Verfügbarkeitsfehler (Client-Fehler wie 404/409 nicht) |
| `createResilientCaller(policy)`               | `retry( breaker( timeout( op ) ) )`: jeder Versuch hat eigene Deadline und zählt im Breaker; offener Circuit wird nicht erneut versucht                                                                      |
| `createHttpClient(...)`                       | `fetch` + obiges + Fehlerabbildung + Maskierung; **Mutationen werden nur mit `Idempotency-Key` wiederholt**                                                                                                  |

Standardwerte: Timeout 10 s je Versuch, 3 Versuche, Breaker 5/30 s. Die Registry setzt für Port-Aufrufe Retry standardmäßig auf **einen
Versuch** (Transport-Retries macht der Adapter-HTTP-Client; sonst vervielfachen sich Versuche) und kann pro Eintrag überschrieben werden.
`config/adapters.yaml`-Schreibweisen (`resetAfterMs`, `jitter: 0.2`) werden akzeptiert.

## 5. Lebenszyklus und Health (PLAN §10.6/10.7)

```text
UNREGISTERED -> INITIALIZING -> ONLINE <-> DEGRADED -> OFFLINE -> (RECOVERING) -> ONLINE
                      \-> OFFLINE
ONLINE|DEGRADED|OFFLINE|RECOVERING|INITIALIZING -> STOPPING -> STOPPED   (STOPPED -> INITIALIZING bei Neustart)
```

`RECOVERING` ist intern und wird im Vertrag (`AdapterLifecycle`) als `OFFLINE` gemeldet. Der `HealthMonitor` ruft `healthCheck()` im Intervall
(Standard 15 s, Deadline 5 s) auf, führt `latencyMs`, `lastSuccessAt`, `lastError`, `consecutiveFailures` und `circuit`, und steuert den Lebenszyklus:

- erster Fehler im Betrieb -> `DEGRADED`; ab 3 Fehlern in Folge -> `OFFLINE`; erste Prüfung/Wiederanlauf mit Fehler -> sofort `OFFLINE`;
- `online`-Meldung über 3 s Latenz -> `DEGRADED`; Erfolg nach `OFFLINE` -> `RECOVERING` -> `ONLINE`;
- `jarvis.adapter.health_changed` nur bei echter Änderung; nach Recovery wird `getCapabilities()` neu gelesen.

Ein Adapter, der nicht serviert (`OFFLINE`, `STOPPED`), trägt nichts zu `GET /capabilities` bei: das UI zeigt "Nicht verbunden".

## 6. Registry (PLAN §10.9/10.10)

```ts
const registry = new AdapterRegistry({
  allowlist: ["example-tasks-http", "hermes-tasks"],          // nur diese Provider-IDs werden geladen
  secretProvider: ({ field, provider }) => resolveSecret(...), // env:NAME / wincred:ZIEL
  onEvent: ({ adapterId, event }) => hub.publish(adapterId, event),
});
registry.registerFactory("example-tasks-http", exampleTasksFactory);

const report = await registry.initialize({
  mode: "live",                                                // mock | hybrid | live
  adapters: {
    tasks: { provider: "example-tasks-http", enabled: true, timeoutMs: 8000,
             config: { baseUrl: "http://127.0.0.1:8099" } },
  },
});

const tasks = registry.getPort("tasks");                       // Proxy mit Resilienz + Ergebnisprüfung
await tasks.listTasks({ limit: 50 }, { correlationId });
registry.aggregateCapabilities();   // Capabilities-Dokument (§9.2), sources = Adapter-IDs
registry.listAdapters(); registry.getHealth("example-tasks-http");
await registry.restart("example-tasks-http"); await registry.shutdownAll();
```

In der Control API ruft niemand `registerFactory` von Hand auf: `apps/control-api/src/runtime/adapter-wiring.ts` enthält die
statische Zuordnung Paketname → Factories (`packageFactories()`), aus der die Allowlist in `config/adapters.yaml` bedient wird.
Ein neues Adapterpaket braucht deshalb einen Eintrag dort und eine `workspace:*`-Abhängigkeit in `apps/control-api/package.json`.

Verhalten:

- **Allowlist:** `registerFactory` und `initialize` verweisen unbekannte Provider mit klarer Meldung zurück ("nicht in der Allowlist"). Factory-Kategorie
  und Modus (`factory.modes`, Mock-Factories nur im Modus `mock`) werden geprüft.
- **Manifest:** wird gegen `AdapterManifest` validiert; Kategorie, Contract-Major, bekannte Capabilities und `configSchemaRef == configSchema.$id` müssen passen.
- **Config:** `entry.config` (+ aufgelöste Secrets) wird gegen das Config-Schema geprüft (AJV 2020, Defaults werden angewendet). Secret-Felder
  werden aus `context.config` entfernt und nur über `getSecret` ausgeliefert.
- **Isolation:** `initialize` wirft nie wegen eines Adapters. Ein fehlgeschlagener Adapter ist `OFFLINE` mit `lastError`; alle anderen laufen weiter.
  Das Ergebnis ist ein `InitReport[]`; nicht ladbare Einträge stehen in `listFailures()`.
- **Port-Proxy:** `getPort` wirft nie; die Methoden werfen `CAPABILITY_MISSING` (deaktiviert, nicht konfiguriert, Capability nicht deklariert) oder
  `ADAPTER_UNAVAILABLE` (offline/gestoppt). Jeder Aufruf läuft durch Timeout, Retry, Breaker; das Ergebnis wird gegen das Vertragsschema geprüft.
  **Verstoß -> `VALIDATION_FAILED`, Log, nichts wird weitergegeben.** Fehler tragen die `correlationId` des Aufrufs.
- **Retry von Mutationen:** nur mit `idempotencyKey`.
- **Capabilities:** `communication.*` füllt zusätzlich das Modul `mail`; `sources` enthält die Adapter-IDs, die das Modul tatsächlich bedienen.
  Änderungen lösen `jarvis.adapter.capabilities_changed` aus.

## 7. Mapping-Helfer

| Helfer                                                                               | Zweck                                                                                                                                 |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `defineMapper<Raw, Canonical>({name, schema, toCanonical})`                          | Mapper mit Vertragsvalidierung; Fremdfelder im Ergebnis führen zu `VALIDATION_FAILED` (`details.providerFieldLeak`)                   |
| `assertNoProviderFields(schema, value)`                                              | gleiche Prüfung für von Hand gebaute Objekte                                                                                          |
| `sourceDescriptor(adapterId, system, externalId, lastSyncedAt)` / `createMapContext` | `source`-Feld, einheitlicher `lastSyncedAt` je Antwort                                                                                |
| `createId(prefix, seed?)`                                                            | deterministische (mit Seed) oder zufällige ID `<prefix>_<26 Zeichen>`                                                                 |
| `createIdCodec(prefix)`                                                              | Fremd-ID <-> Vertrags-ID; reversibel bis 15 Byte, sonst Hash mit Merktabelle; `require(id)` -> `NOT_FOUND`                            |
| `defineEventMapper({name, toCanonical})`                                             | Fremdereignis -> `{type, subject, data}`; prüft Typ, Subject und `data` gegen `JARVIS_EVENT_DATA_SCHEMA_IDS`; `null` verwirft bewusst |
| `validatePortResult(spec, result, {what})`                                           | dieselbe Ergebnisprüfung wie die Registry (für Tests)                                                                                 |
| `createPlaceholderAdapter(...)`                                                      | "Nicht konfiguriert"-Adapter ohne Capabilities                                                                                        |

## 8. Neue Anbindung erstellen (PLAN §56.1)

Beispiel: neues System "Things" für die Kategorie `tasks`. Alle zehn Schritte; **keine Frontendänderung**.

1. **Template kopieren.** `packages/adapter-core/template` nach `adapters/things-http` kopieren; `package.json`-Name `@jarvis/adapter-things-http`, `pnpm install`.
   (Vorlage prüfen: Kopie in `adapters/` anlegen und `pnpm test:conformance` ausführen.)
2. **Manifest anpassen** (`id` in `^[a-z0-9][a-z0-9-]*$`, `category`, `contractVersion` aus `CONTRACT_VERSION`, `secretFields`).
3. **Config-Schema definieren** (JSON Schema 2020-12 mit `$id` = `manifest.configSchemaRef`; Secrets `writeOnly: true`; Defaults im Schema).
4. **`healthCheck()` implementieren**: ein billiger Aufruf, ein Versuch (`retry: false`); Fehler als `offline`-Report mit deutscher Meldung, **nie** werfen, keine Fremdtexte
   mit Secrets durchreichen.
5. **Capabilities melden**: nur tatsächlich umgesetzte (`tasks.read` zuerst). Jede deklarierte Capability braucht ihre Port-Methode; eine optionale Methode
   ohne Capability ist ein Fehler.
6. **Fremddaten mappen**: `defineMapper` je Objekt, `createIdCodec` für IDs, Port-Methoden mit `createHttpClient`. Unbekanntes ist `null`/leer, nie erfunden.
   Idempotency-Key und `If-Match` an das Fremdsystem durchreichen.
7. **Events mappen**: `defineEventMapper`; bei Polling den Cursor erst nach erfolgreichem `emit` weiterschieben (siehe `example-http`). `*.stream` deklarieren und `pollEvents()` anbieten.
8. **Conformance ausführen**: `test/conformance.test.ts` mit Fake-Upstream anpassen; `pnpm test:conformance` muss grün sein.
9. **In der Registry konfigurieren**: Provider-ID unter `allowlist` in `config/adapters.yaml` eintragen, Factory beim Start registrieren, Eintrag in `adapters.<kategorie>` mit `config`
   (Secrets als Referenz `env:NAME` / `wincred:ZIEL`).
10. **Mock-Adapter dieser Kategorie deaktivieren**: `adapters.tasks.provider` von `mock-tasks` auf `things-http` stellen (oder `dataMode: hybrid`).

### Die Regel "keine Frontendänderung"

Wenn ein Schritt eine Änderung in `apps/web`, `@jarvis/ui` oder den Routen verlangt, ist die Abbildung falsch: das Frontend kennt nur kanonische Modelle und
Capabilities. Fehlt dem Modell ein Feld, beginnt die Änderung im Vertrag (`packages/contracts`, PLAN §7), nicht im Adapter. Provider-Namen, Ports
und URLs stehen nie im Frontend.

## 9. Referenzadapter

`adapters/example-http` zeigt in einem Paket: Config + Secret (`apiToken`), resiliente HTTP-Aufrufe, ID-Codec, Mapper mit Vertragsvalidierung,
Idempotency-Key- und `If-Match`-Weitergabe, Statusfilter, Event-Polling mit Cursor und Reconnect, Health mit deutschen Meldungen, Shutdown ohne Restressourcen.
Seine Feldtabellen stehen in [MAPPING/example-tasks.md](MAPPING/example-tasks.md).

## 10. Sicherheitsregeln für Adapter

- Secrets nur über `getSecret`, nie in Logs, Fehlertexten, Events oder Ergebnissen (Conformance prüft das mit Canary-Werten).
- Provider-Fehlertexte sind nicht vertrauenswürdig: kürzen, maskieren (`createRedactor`), nie roh weitergeben.
- Schreibende Aktionen mit Außenwirkung (Senden, Löschen, Termin ändern) liefern ein `Approval` (z. B. `requestDraftSend`), sie führen nicht direkt aus.
- Keine direkten Zugriffe auf interne Datenbanken des Fremdsystems, solange API, CLI oder Eventquelle verfügbar sind.
- Der Adapter hat keine eigene Circuit-Breaker-Instanz, wenn die Registry ihn bereits hält (`circuitBreaker: false` im Adapter-HTTP-Client).
