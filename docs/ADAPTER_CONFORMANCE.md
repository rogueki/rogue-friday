# Adapter Conformance Suite

Jeder Adapter muss dieselben Tests bestehen (PLAN §11). Sie sichern die "Goldene Regel": ein produktiver Adapter ist ohne Frontendänderung
gegen den Mock austauschbar. Die Suite liegt in `@friday/adapter-testkit` (`packages/adapter-testkit`) und läuft auf Vitest.

## Ausführen

```powershell
$env:Path = $env:Path.Replace('"','')   # nur auf dieser Maschine nötig (verirrtes Anführungszeichen im PATH)
pnpm test:conformance                    # alle Adapter in adapters/*  (findet test/conformance.test.ts bzw. conformance.test.ts)
pnpm exec vitest run adapters/example-http   # ein Adapter
```

`packages/adapter-testkit/scripts/run-conformance.mjs` listet die gefundenen Adapter auf und startet Vitest mit der Root-Konfiguration. Ein neuer Adapter braucht nur seine
`test/conformance.test.ts`.

## Test einbinden

```ts
import { runConformanceSuite } from "@friday/adapter-testkit";

runConformanceSuite({
  name: "example-http (ExampleTasks)",
  category: "tasks",
  profile: "full", // "placeholder" für nicht konfigurierte Adapter
  createAdapter: ({ upstream, timing }) => ({
    adapter: new ExampleTasksAdapter(),
    configSchema, // prüft $id == manifest.configSchemaRef und Secret-Felder
    config: {
      baseUrl: upstream.url,
      timeoutMs: timing.timeoutMs,
      maxAttempts: timing.maxAttempts,
      retryBaseDelayMs: timing.retryBaseDelayMs,
      pollIntervalMs: timing.pollIntervalMs,
    },
  }),
  fixtures: {/* siehe unten */},
  faults: { slowDelayMs: 1000 }, // optional
});
```

`createAdapter` erhält einen frischen **Fake-Upstream** und die Zeitvorgaben (`timeoutMs` 250, `maxAttempts` 3, `retryBaseDelayMs` 5, `pollIntervalMs` 0).
Der Adapter muss sie in seine Config übernehmen, damit Fehlertests in Millisekunden laufen. Die Suite baut den `AdapterContext` selbst:
Secrets sind Canary-Werte (`sk_canary_<feld>_<zufall>`), Logger und `emit` zeichnen alles auf, `signal` wird beim Shutdown abgebrochen.

### Fixtures

| Feld                                | Bedeutung                                                                                                                                                                        |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `seed(upstream, {count, pageSize})` | richtet die Routen des Fremdsystems ein (gesund), mit `count` Items und Cursor-Paging; `count: 0` -> leere Liste                                                                 |
| `list`                              | `{method, params?, route}`: Listen-Methode und die Route dahinter (Fehler werden dort injiziert)                                                                                 |
| `healthRoute?`                      | Route der Gesundheitsprüfung (Standard: Listen-Route)                                                                                                                            |
| `invalidListBody()`                 | gültiges JSON mit Inhalten, die sich nicht kanonisch abbilden lassen                                                                                                             |
| `providerFields`                    | Schlüsselnamen des Fremdsystems, die nie in der Ausgabe stehen dürfen                                                                                                            |
| `get?`                              | `{method, paramsFor(item), route}` für Einzelabruf und NOT_FOUND-Test                                                                                                            |
| `mutation?`                         | `{method, params, route, sideEffects(upstream)}` für Idempotenz- und Retry-Tests                                                                                                 |
| `events?`                           | `{route, publish(upstream, n), expectedTypes}` für Event-Mapping und Reconnect; `expectedTypes` sind die kanonischen Typen der `n` veröffentlichten Rohereignisse in Reihenfolge |

Fehlen `mutation` oder `events`, werden die zugehörigen Tests als übersprungen gemeldet (nicht als bestanden).

### Fake-Upstream (`createFakeUpstream()`)

HTTP-Server (`node:http`) auf `127.0.0.1` mit Zufallsport. `route(method, "/items/:id", handler | response)`; `fault(method, pattern, {...})` mit
`latencyMs`, `status`, `statusSequence` (z. B. `[503, 503]`, danach normal), `drop` (Socket zerstören), `body`/`raw` (auch Funktion, um Header zu echoen), `times`;
`requests` / `requestsFor(...)` protokollieren alles; `setOffline(true)` schließt den Port (ECONNREFUSED); `reset()`, `close()`.

## Prüfungen (PLAN §11.1) und wie man Fehler liest

Testnamen beginnen mit dem Prüfpunkt. Die Fehlermeldungen nennen die verletzte Regel im Klartext.

| #   | Test                                                     | Prüft                                                                                                                                                                                                     | Typische Ursache bei Fehlschlag                                                            |
| --- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1   | manifest valid                                           | Manifest gegen `AdapterManifest`-Schema, Kategorie, `apiVersion`, `configSchemaRef == $id`, Config-Schema kompiliert, Secret-Felder im Schema                                                             | `id` mit Großbuchstaben, `$id` weicht ab, Secret nicht im Schema                           |
| 2   | contract version compatible                              | Major von `manifest.contractVersion` == `CONTRACT_VERSION`                                                                                                                                                | Manifest mit eigener Versionszahl statt `CONTRACT_VERSION`                                 |
| 3   | capabilities match the implemented port methods          | jede deklarierte Capability hat ihre Methoden; optionale Methode ohne Capability gilt als Fehler; Pflicht-`*.read` bei `full`; `getCapabilities()` ⊆ Manifest; Platzhalter bewerben nichts                | `"tasks.cancel" is declared but cancelTask() missing` bzw. Methode ohne Capability         |
| 4   | healthCheck returns the contract shape with latency      | Status gültig, `latencyMs` Ganzzahl >= 0 oder `null`; `full`: `online` + Latenz                                                                                                                           | Health prüft nicht wirklich oder liefert Float-Latenz                                      |
| 5   | offline behaviour                                        | Upstream aus -> `healthCheck` wirft nicht und meldet `offline`; Aufruf -> `ADAPTER_UNAVAILABLE` (retryable); nach Rückkehr wieder `online`                                                                | `healthCheck` wirft, roher `fetch`-Fehler                                                  |
| 6   | shutdown releases resources and later calls fail cleanly | doppelter `shutdown` ok; nach Shutdown keine weiteren Requests (Polling gestoppt); Aufrufe -> `AdapterError(ADAPTER_UNAVAILABLE)`                                                                         | Timer/Intervall läuft weiter, Aufruf nach Shutdown wirft `TypeError`                       |
| 7   | no secret leaks                                          | Canary-Secrets erscheinen nicht in Ergebnissen, Fehlern (Message, Details, Cause, Stack), Events, Health, Logs - auch wenn der Upstream sie in Fehlerseiten echot (401/403/500/429/kaputtes JSON/Abbruch) | Token im Log, Fehlertext des Fremdsystems ungefiltert (`createRedactor` fehlt)             |
| 8   | timeout handling                                         | langsamer Upstream -> `ADAPTER_TIMEOUT` (retryable) innerhalb `timeoutMs * maxAttempts + 2 s`                                                                                                             | Timeout nicht gesetzt oder auf den Standard statt `timing.timeoutMs`                       |
| 9   | retry behaviour                                          | 503, 503, 200 -> Erfolg nach genau 3 Requests; 400/403/404/409/422 -> genau 1 Request, richtiger Code                                                                                                     | 4xx wird wiederholt, kein Retry bei 5xx                                                    |
| 10  | retries are bounded                                      | dauerhaftes 503 -> `ADAPTER_UNAVAILABLE`, 2..`maxAttempts` Requests                                                                                                                                       | unbegrenzter Retry                                                                         |
| 11  | empty response -> valid empty page                       | `items: []`, `hasNextPage: false`, `nextCursor: null`, gültig gegen `*ListResponse`                                                                                                                       | leere Liste liefert `undefined` oder Fehler                                                |
| 12  | pagination                                               | Cursor-Walk über 7 Items (Seitengröße 3) liefert jede ID genau einmal; `hasNextPage` ⇔ `nextCursor != null`; Cursor schreitet fort                                                                        | Cursor wird nicht an das Fremdsystem durchgereicht, `hasNextPage` hartkodiert              |
| 13  | invalid foreign data is rejected                         | unbrauchbare Fremddaten -> `VALIDATION_FAILED` (nicht retryable), nichts wird zurückgegeben                                                                                                               | Mapper "repariert" oder reicht durch                                                       |
| 14  | schema mapping                                           | Liste, Einzelabruf und Mutationsergebnis validieren mit `validatePortResult` gegen das SDK-Schema (wie in der Registry)                                                                                   | falsche Enum-Werte, fehlende Pflichtfelder, ID ohne Präfix                                 |
| 15  | error normalization                                      | HTTP 400/401/403/404/409/422/429/500/502/503/504, Verbindungsabbruch, kaputtes JSON, ECONNREFUSED, 404 am Einzelabruf -> kanonische Codes mit korrektem `retryable`                                       | Tabelle in ADAPTER_SDK §3                                                                  |
| 16  | auth error / permission error                            | 401 -> `UNAUTHENTICATED`, 403 -> `FORBIDDEN`, je genau 1 Request; Health meldet bei 401 nicht `online`                                                                                                    | 401 wird als `INTERNAL` oder `ADAPTER_UNAVAILABLE` gemeldet                                |
| 17  | event mapping                                            | `pollEvents()` liefert genau die erwarteten kanonischen Typen in Reihenfolge, jede Payload gültig gegen `FRIDAY_EVENT_DATA_SCHEMA_IDS`, keine Fremdfelder                                                 | falscher Event-Typ, Payload verletzt Schema                                                |
| 18  | reconnect                                                | Abbruch des Eventstroms (alle Versuche) -> `ADAPTER_UNAVAILABLE`, nichts verloren; nächster Poll liefert die Events genau einmal, weiterer Poll 0, neue Events folgen                                     | Cursor wird vor dem Emit weitergeschoben (Verlust) oder gar nicht (Duplikate)              |
| 19  | idempotency                                              | gleicher Key zweimal -> ein Seiteneffekt, gleiche ID; Key kommt als `Idempotency-Key` beim Fremdsystem an; neuer Key -> zweiter Seiteneffekt                                                              | Key nicht weitergereicht                                                                   |
| 20  | mutations are not retried without an idempotency key     | 503 bei Mutation ohne Key -> genau 1 Request                                                                                                                                                              | Retry auf POST ohne Key (doppelte Ausführung)                                              |
| 21  | no provider-specific fields                              | rekursive Suche nach `providerFields` in Ergebnissen; IDs haben Präfix + 26 Zeichen                                                                                                                       | Fremdfeld im Objekt (das Schema verbietet es zusätzlich per `additionalProperties: false`) |

### Profil `placeholder`

Für Adapter, die noch nichts anbinden: bestehen müssen 1-7 in reduzierter Form. Zusätzlich: keine Capabilities (Manifest und `getCapabilities()` leer);
Health `offline` mit "Nicht konfiguriert" ohne Config; Lesemethoden schlagen mit `AdapterError(ADAPTER_UNAVAILABLE)` fehl; Shutdown sauber; keine Secret-Lecks.
Die Tests 8-21 entfallen. `createPlaceholderAdapter` erfüllt das Profil bereits.

## Fehlerbilder

- `Aufruf hätte X liefern müssen, lieferte aber einen Wert`: der Adapter hat den Fehlerfall verschluckt oder Daten erfunden.
- `Fehler muss ein AdapterError sein`: ein roher Fehler (`TypeError: fetch failed`, `SyntaxError`) tritt aus dem Adapter aus; `normalizeError`/`createHttpClient` verwenden.
- `Secret '<feld>' taucht ... auf`: die Meldung nennt das Feld; im Test-Output nach dem Canary suchen (`sk_canary_...`) und die Stelle im Adapter-Code (Log, Fehlertext, `details`) maskieren.
- Zeitüberschreitung des Tests selbst: der Adapter nutzt nicht `timing.timeoutMs`/`maxAttempts`, oder `shutdown()` wartet auf einen hängenden Request (Signal abbrechen).
- Zufällig fehlschlagende Pagination/Events: Fake-Upstream pro Test frisch; den Zustand des Fremdsystem-Fakes im `seed` neu aufbauen (nicht modulglobal halten).

## Grenzen

Die Fehlerinjektion arbeitet über HTTP (Fake-Upstream). Adapter ohne HTTP-Fremdsystem (z. B. der Mock-Adapter, WSL-/Prozess-Adapter) erfüllen
die statischen Prüfungen (1-4, 6, 7) und die Ergebnisformen mit `profile: "full"` nur, wenn sie ihre Fehlerfälle über eigene Fixtures nachbilden; bis dahin
prüfen sie zusätzlich mit `validatePortResult` (siehe `packages/adapter-core/test`) und der Registry-Testsuite. Die Suite ist so gebaut, dass weitere Transporte
(Prozess, Socket) ergänzt werden können, ohne die Prüfpunkte zu ändern.
