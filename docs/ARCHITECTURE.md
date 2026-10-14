# Architektur

Dieses Dokument beschreibt den Aufbau des F.R.I.D.A.Y. Command Center: Frontend, Control API, Adapter und Integration.
Die verbindliche Produktspezifikation ist `docs/PLAN.md`, die technischen Entscheidungen stehen in
`docs/IMPLEMENTATION_CONVENTIONS.md`. Der Übergabeweg für neue Anbindungen steht in [`HANDOFF.md`](HANDOFF.md).

## Systemüberblick

```text
Browser (apps/web, statischer Export)
   │  REST /api/v1 (generierter SDK-Client)    WebSocket /api/v1/events (Umschläge, sequence)
   ▼
Control API (apps/control-api, ein Port, Standard 127.0.0.1:3100)
   │  Anfragepipeline: Auth, Rollen, CSRF, Validierung, Idempotenz, Audit
   │  Ports (@jarvis/adapter-core) über die Adapter-Registry
   ▼
Adapter ── mock-* (Simulation)  │  hermes-*  │  jarvis-voice-http  │  local-system  │  example-http
   ▼
Fremdsysteme (Hermes, Voice-Dienst, Qwen, lokaler Rechner) bzw. MockWorld (@jarvis/mock-data)
```

Die Verträge (`packages/contracts`: OpenAPI 3.1.1, AsyncAPI 3.1.0, JSON Schema) sind die Quelle der Wahrheit. Aus ihnen
entstehen die Routentabelle der Control API und der Client `@jarvis/sdk`.

## Namen und Bezeichner

Der Produktname ist **F.R.I.D.A.Y.** (Command Center). Die technischen Bezeichner stammen aus der Vorgängergeneration
J.A.R.V.I.S. und sind stabil: Sie sind Teil des Vertrags (`packages/contracts`), der Workspace-Imports und der
gespeicherten Konfiguration. Eine Umbenennung wäre ein Breaking Change und ist eine eigene, bewusste Entscheidung.

| Bezeichner                                  | Beispiele                                                                                  | Bereich               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------- |
| `@jarvis/*` Paketnamen                      | `@jarvis/sdk`, `@jarvis/orb`, `@jarvis/adapter-core`                                       | Workspace, Imports    |
| `jarvis.*` Event-Typen                      | `jarvis.orb.status_changed`, `jarvis.status.resync_required`                               | AsyncAPI, Realtime    |
| `/api/v1`, `$id` `https://jarvis.local/...` | WebSocket `/api/v1/events`                                                                 | Vertrag               |
| `JARVIS_*` Umgebungsvariablen               | `JARVIS_API_ORIGIN`, `JARVIS_OWNER_PASSWORD_HASH`                                          | Konfiguration         |
| `--jarvis-*` CSS-Variablen, Theme-IDs       | `--jarvis-focus`, `jarvis-command-gold-core`                                               | Design-Tokens, Themes |
| Komponenten, Hooks, Clients                 | `JarvisOrb`, `JarvisShell`, `createJarvisClient`                                           | öffentliche API       |
| Pfade und Dateien                           | `installer/install-jarvis.bat`, `C:\Jarvis`, `design-references/jarvis_orb_reference.webp` | Installer, Referenzen |

Sichtbare Texte (UI, Orb-Beschriftungen, Dokumentation) verwenden dagegen den Namen F.R.I.D.A.Y. Der Assistentenname ist
über `settings.profile.assistantName` konfigurierbar (Standard „F.R.I.D.A.Y.“).

# Frontend (`apps/web`)

Next.js 16 App Router, **static export** (`output: "export"` -> `apps/web/out`, served by the Control API at `/`), React 19,
TanStack Query 5, Zustand (small UI stores), Motion, `@jarvis/ui` + `@jarvis/design-tokens`, `@jarvis/orb`, `@jarvis/sdk`.
All data is fetched on the client through the generated SDK; there are no server components that fetch.

## Layers

```
src/
  app/                      routes only (layout, providers, pages, error/not-found/loading)
    (dashboard)/            authenticated area: layout = SessionGate + AppShell, 1 folder per module page
    login/
  components/               shared building blocks (PanelFrame, ModulePlaceholder, FullScreen)
  features/                 vertical slices that own UI + logic
    shell/                  nav model (16 pages), top bar, bottom command bar, voice panel, drawers
    palette/                global command palette, command runner (preview protocol), create-task dialog
    orb/                    OrbSlot (the only place that mounts @jarvis/orb), audio store, click/Space routing
    voice/                  useVoiceUi (voice state, toggle, focus mode)
    overview/               layout engine + 9 panels
    auth/                   login view
    shared/                 time formatting, presentation helpers (icons, tones, status mapping)
  lib/
    api/                    SDK client, query keys, stale times, QueryClient factory, mutation helper, domain modules
    realtime/               framework-free RealtimeClient, transports, event -> cache reducer, provider, store
    session.tsx settings.tsx capabilities.tsx uiStore.ts
    mock/                   standalone MSW mode (bootstrap, runtime, empty stub)
  i18n/                     de.ts (default), en.ts, t()/useT()
  test/                     vitest setup, fixtures, render helper
```

## Providers (`src/app/providers.tsx`)

Order, outermost first: `QueryClientProvider` -> `ClientOnly` (tree mounts after hydration; the server HTML is the boot
screen because the UI library renders portals) -> `ToastProvider` -> `ErrorSinkBridge` (QueryClient errors -> toasts) ->
`MockGate` (starts MSW when `NEXT_PUBLIC_JARVIS_MSW=1`) -> `AppSettingsProvider` -> `CapabilitiesProvider` ->
`RealtimeProvider`. The three last ones only run for an authenticated session.

| Provider         | Source                              | What it does                                                                                                                                                                                                                              |
| ---------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| QueryClient      | `lib/api/queryClient.ts`            | stale time per domain (`staleTimes.ts`), retry only for `JarvisApiError.retryable`, never for 4xx, 3 attempts max; MutationCache turns errors into toasts, 409 CONFLICT refetches `conflictKeys`, UNAUTHENTICATED invalidates the session |
| SDK client       | `lib/api/client.ts`                 | one `createJarvisClient({ baseUrl: "" })`; CSRF token from `/auth/session` (fallback: `jarvis_csrf` cookie); a correlation id per request (SDK)                                                                                           |
| Session          | `lib/session.tsx`                   | `useSession()`; `SessionGate` redirects to `/login` or shows the "API not reachable" screen                                                                                                                                               |
| Settings / theme | `lib/settings.tsx`                  | `GET /settings` -> `applyTheme`, theme knobs (cyan/panel/gold/grid/font scale), `setMotionMode`, `<html lang>`, locale/timezone/hour12; every change re-runs the effects, no rebuild (PLAN §25.2)                                         |
| Capabilities     | `lib/capabilities.tsx`              | `useCapability(module, action)` (boolean), `useCapabilityState` (`available                                                                                                                                                               | read-only | missing`), `capabilityPathState("mail.send")` |
| i18n             | `i18n/`                             | `useT()` -> `{ t, locale }`; German default, English from `profile.locale`; `en.ts` must have exactly the keys of `de.ts` (compile error + unit test)                                                                                     |
| Realtime         | `lib/realtime/RealtimeProvider.tsx` | creates the `RealtimeClient` once meta + session exist                                                                                                                                                                                    |

## Data layer (`src/lib/api`) and how to add a domain

Rules (PLAN §48): only the SDK, no `fetch()` in components, central keys, targeted invalidation, optimistic UI only for safe
reversible actions (settings, kanban moves) and **never for approvals**, `Idempotency-Key` on critical POSTs, `If-Match` on PATCH.

Pattern of a domain module `src/lib/api/domains/<domain>.ts`:

```ts
// 1. keys: add the domain to lib/api/queryKeys.ts   (list = [d, "list", filters], detail = [d, "detail", id])
// 2. queries: queryOptions factories, one hook per factory
export const taskQueries = {
  list: (filters: TaskFilters = {}) =>
    queryOptions({
      queryKey: queryKeys.tasks.list(filters),
      queryFn: (): Promise<TaskListResponse> =>
        call(getApiClient().GET("/api/v1/tasks", { params: { query: filters } })),
      staleTime: staleTimes.tasks,
    }),
};
export const useTasks = (filters?: TaskFilters) => useQuery(taskQueries.list(filters));

// 3. mutations: useApiMutation adds the Idempotency-Key per intent, invalidation, optional optimistic edit + rollback
export function useUpdateTask() {
  return useApiMutation<TaskResponse, { id: string; version: number; patch: TaskUpdateRequest } & IntentVars>(
    {
      label: "Aufgabe ändern",
      mutationFn: ({ id, version, patch }) =>
        call(
          getApiClient().PATCH("/api/v1/tasks/{id}", {
            params: { path: { id }, header: { "If-Match": String(version) } },
            body: patch,
          }),
        ),
      invalidate: [queryKeys.tasks.all, queryKeys.overview],
      conflictKeys: [queryKeys.tasks.all], // 409 -> refetch + "Änderung nicht übernommen" toast
    },
  );
}
```

Export the module from `lib/api/index.ts`. Existing domains: `core` (meta, session, health, capabilities, overview, status, orb),
auth, tasks, activity (+ `fetchActivitySince`), agents, approvals, notifications, communication, calendar, system (inkl. Adapter-Status,
Logs, Neustart), voice, memory (+ `searchMemory`), files, automations, settings (+ Layouts, Themes, Adapter-Einstellungen),
commands, research, audit, dev (Szenario-Konsole); `cursorPages.ts` hilft beim Paging.

`useApiMutation` exposes `mutate`/`mutateAsync` that pin the Idempotency-Key at call time: pass the same `idempotencyKey` again
to replay a request (retry button), omit it for a new intent.

## Realtime (`src/lib/realtime`)

`RealtimeClient` (framework-free, fully unit-tested with a fake transport and fake timers):

- URL: `meta.eventsOrigin + meta.eventsPath` (http->ws), or the page origin (ws/wss from the page protocol), `?since=<last sequence>`.
- Persists the last applied sequence in `sessionStorage` (try/catch); resumes with `?since=` after reload or reconnect.
- Dedupe: `sequence <= last` is ignored. Gap: `sequence > last + 1` -> `onGap` (the provider refetches snapshot roots and backfills
  `GET /activity?sinceSequence=`), the event is still applied. `jarvis.status.resync_required` -> `onResync` (refetch everything,
  sequence jumps to `latestSequence`).
- Heartbeat: answers server pings with the echoed `ts`, sends its own ping every 10 s, roundtrip = pong delay; a ping unanswered
  for 5 s or a roundtrip > 1.5 s marks the stream `degraded`; 45 s of silence replaces the connection.
- Reconnect: exponential ceiling 0.5/1/2/4/8/15 s with jitter, always inside [0.5 s, 15 s]; backoff resets after the connection was
  stable for 3 s. After 3 failed attempts the state is `polling`: snapshot roots are refetched every 10 s until a connection holds.
- `navigator.onLine` (offline stops retrying, online reconnects immediately) and page visibility (visible -> reconnect/ping now).
- `useRealtimeStatus()` -> `{ state: connecting|online|degraded|offline|polling, roundtripMs, lastEventAt, sequence }`
  ("Event-Stream online · 28 ms · vor 2 s" in the top bar).
- Transport interface (`transport.ts`): `WebSocketTransport` in production, the same class over `@jarvis/mock-data`'s in-memory
  socket in standalone mock mode (`lib/mock/bootstrap.ts`). The client never knows the difference.

`applyEvent(queryClient, event)` (`applyEvent.ts`) is the deterministic event -> cache reducer, exhaustive over all 44 event types
(a new contract event is a compile error until handled). Rules: replace only with an equal-or-newer `version`; patch lists and
details in place; prepend created items to unfiltered first-page lists; refetch filtered lists instead of guessing membership;
keep `overview` (running tasks, open approvals, critical alerts, counters, orb, voice, system summary) in sync and coalesce the
derived parts (attention, counters) into one debounced refetch (1.5 s). `jarvis.voice.audio_level` bypasses the cache.

## Orb integration (`src/features/orb`)

- State = the query-cache entry of `GET /orb/status`; `jarvis.orb.status_changed` writes the same entry (`useOrbSnapshot`).
- `OrbSlot` lazy-loads `OrbSlotInner` (client only, three.js chunk) which renders `<JarvisOrb snapshot settings onActivate onVoiceToggle>`.
  `settings.orb` -> `orbSettingsFromWire`; `meta.features.forceOrbFallback2D` (scenario hint) -> `renderer: "2d"`; WebGL failure and
  context loss are handled by `@jarvis/orb` itself (2D fallback).
- Audio: `jarvis.voice.audio_level` events are written into `audioStore` without React state; consumers sample it at <= 12 Hz and only
  while a voice mode is active (`useAudioSamples`), so only the orb/waveform subtree re-renders. `JarvisOrb` has no ref-based audio
  input yet, hence the bounded-rate `status.audioLevel` update.
- Interaction routing (PLAN §21, `useOrbActions.routeOrbActivation`): approval -> `/approvals?approval=`, task -> `/tasks?task=`,
  error -> error-detail drawer, activity -> live-activity drawer, command -> palette; Space -> voice start/stop.

## Shell, palette, command bar

`AppShell` = `JarvisShell` + `LeftCommandNav` (16 pages, order/visibility from `settings.navigation`, live badges from
`overview.counters`, collapse state written back to `navigation.mode`) + `VoiceNavPanel` + `AppTopBar` + `AppBottomBar` + global
overlays (palette, create-task dialog, command confirmation, notification/activity/error drawers).
Commands go through `useRunCommand`: `POST /commands`; when the server answers `requiresConfirmation` the preview text is shown and
only the confirmed repeat (`confirm: true`, `previewId`) executes. Nothing sensitive is stored client-side; history comes from
`/commands/history` (redacted entries are shown but not repeatable). Context chips never invent data: no API -> "—" with an
"nicht verfügbar" tooltip.

## Overview (`src/features/overview`)

`OverviewPage` places the nine widgets from the layout JSON (settings -> layouts; fallback `DEFAULT_OVERVIEW_LAYOUT`; layouts that
contain none of the known widget ids fall back to the default). Placement is CSS custom properties on a 12-column grid; CSS stacks
the cells below 1100 px (tablet: orb, attention, two columns; mobile: one column, attention first).
Every panel renders through `PanelFrame` with a `PanelState` (`loading | error | offline | empty | ready(+degraded, +stale)`). The
single `GET /overview` payload feeds all panels; `degradedSections` decides per panel whether it shows the offline state
("Adapter konfigurieren") while the others keep working.

## Adding a module page (exact pattern)

1. Replace `src/app/(dashboard)/<route>/page.tsx` (currently `<ModulePlaceholder page="<route>" />`) with `"use client"` + your page
   component from `src/features/<module>/`. The route, nav entry, palette entry, i18n label and badge already exist.
2. Detail views are drawers or query params (`/tasks?task=task_...`), never dynamic segments (static export). Use
   `useSearchParams()` inside a `<Suspense>` boundary.
3. Data: add/extend `src/lib/api/domains/<module>.ts` (pattern above); keys only in `queryKeys.ts`.
4. Every view needs loading/empty/stale/degraded/offline/error: use `PanelFrame` + `PanelState`, `useCapability` for every action.
5. Realtime: if your events are not covered by `applyEvent.ts` the way you need, extend the reducer there and add a test in
   `applyEvent.test.ts`; never patch caches from components.
6. Strings: add the keys to `i18n/de.ts` and `i18n/en.ts` (the key sets must match).
7. Tests next to the code (`*.test.ts(x)`); `renderWithProviders` (`src/test/render.tsx`) seeds the cache and a fake-fetch SDK client.

## Standalone mock mode

`pnpm --filter @jarvis/web dev:mock` (or `build:mock`) sets `NEXT_PUBLIC_JARVIS_MSW=1`: `MockStarter` (client-only dynamic import)
calls `setupBrowserMocks()` from `@jarvis/mock-data` (msw service worker, in mock runs copied from `apps/web/mock-worker/` to
`public/mockServiceWorker.js`; normal runs delete it, so production exports never contain it) plus the in-memory event socket.
`window.__jarvisMock` exposes the platform (scenario engine) to the browser console and the screenshot script.

## Type checking

`pnpm --filter @jarvis/web typecheck` runs `tsc -p tsconfig.json --noEmit` against the real workspace packages. Next's own type
check is active (no `ignoreBuildErrors` in `next.config.ts`), and `pnpm --filter @jarvis/web build` runs the typecheck before the
export. The former compiler shim (`src/shims/jarvis-orb.d.ts` and `tsconfig.typecheck.json`) was removed in commit `1903958`.

## Commands

| Command                                        | Purpose                                                                                                                                 |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @jarvis/web dev`                | `next dev` on :3000, `/api/*` rewritten to `JARVIS_API_ORIGIN` (default `http://127.0.0.1:3100`)                                        |
| `pnpm --filter @jarvis/web dev:mock`           | standalone with MSW + mock event stream                                                                                                 |
| `pnpm --filter @jarvis/web build`              | typecheck + static export to `apps/web/out`                                                                                             |
| `pnpm --filter @jarvis/web typecheck` / `test` | tsc / vitest (jsdom)                                                                                                                    |
| `pnpm --filter @jarvis/web screenshots`        | Playwright screenshots of the overview into `apps/web/screenshots/` (needs a running server, `--base`, default `http://localhost:3000`) |

# Control API (`apps/control-api`)

Die Control API ist der einzige Server des Command Centers. Sie ist eine Fastify-Anwendung (Fastify 5) unter einer
NestJS-12-Hülle (`@nestjs/platform-fastify`) und wird mit `tsup` zu einem Bundle (`apps/control-api/dist/main.js`) gebaut.
Sie liefert auf einem Port die REST-Operationen unter `/api/v1`, den Ereignisstrom unter `/api/v1/events` und das statische Web aus
`apps/web/out`. Standard: `127.0.0.1:3100`. Alle Fachdaten kommen über Adapter-Ports (`@jarvis/adapter-core`); im Mock-Modus liefert
`@jarvis/adapter-mock` die Daten aus `@jarvis/mock-data`.

Verbindliche Regeln: Modelle kommen aus `@jarvis/sdk` (nie von Hand). Abhängigkeiten werden über explizite Injection-Tokens
verdrahtet (`@Inject(TOKEN)`), weil die Anwendung unter `tsx` und `tsup` (esbuild) läuft und keine Decorator-Metadaten braucht.
Antworten werden in Dev/Test gegen das Vertragsschema geprüft (`dev.responseValidation`).

## Struktur

| Pfad                                | Aufgabe                                                                                                                                                                                                                    |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main.ts`                       | Start: Konfiguration laden, Dev-Login-Fallback, `listen`, geordnetes Beenden (SIGINT/SIGTERM)                                                                                                                              |
| `src/app.ts`                        | Modulaufbau mit expliziten Tokens; schließt WebSockets vor dem HTTP-Server                                                                                                                                                 |
| `src/http/route-table.generated.ts` | generiert aus dem gebündelten OpenAPI, 122 Operationen (Details unten)                                                                                                                                                     |
| `src/http/pipeline.ts`              | Anfragepipeline je Operation                                                                                                                                                                                               |
| `src/http/server.ts`, `static.ts`   | Host-/Origin-Prüfung, Security-Header, CSP mit Hashes, statisches Web                                                                                                                                                      |
| `src/handlers/*`                    | Handler je Operation; portbasierte Operationen werden aus `PORT_SPEC` abgeleitet. Sonderfälle liegen in eigenen Dateien: `approvals.ts`, `auth.ts`, `commands.ts`, `settings.ts`, `dev.ts`, `adapters.ts`, `domain-ops.ts` |
| `src/security/*`                    | Sitzungen, Login-Drosselung, Re-Auth, Aktionsmatrix (`action-map.ts`), Guards                                                                                                                                              |
| `src/realtime/hub.ts`               | Ereignis-Hub: globale Sequenz, Ringpuffer, Replay, Heartbeat, Backpressure                                                                                                                                                 |
| `src/runtime/*`                     | Verdrahtung: Konfiguration, Welt, Adapter-Registry (`adapter-wiring.ts`), Dienste, Datenbank, Timer                                                                                                                        |
| `src/services/*`                    | Einstellungen, Adapter-Einstellungen, Orb-/Status-/Overview-Ableitung, Befehls-Intents, Frontend-Telemetrie, Log-Ringpuffer                                                                                                |
| `src/db/*`                          | `node:sqlite`: Migrationen, Stores, Audit-Kette, Kopf-Anker                                                                                                                                                                |

## Starten

```bash
pnpm dev:api                                  # tsx watch, Mock-Modus, Dev-Login
pnpm --filter @jarvis/control-api build       # tsup -> apps/control-api/dist/main.js
pnpm start                                    # node apps/control-api/dist/main.js
```

Ohne `config/dashboard.yaml` gelten Standardwerte (Mock-Modus, Loopback). Ohne Owner-Passwort-Hash schaltet der Start im
Mock-Modus auf Loopback auf feste Dev-Konten um (`dev-owner`, `dev-operator`, `dev-viewer`) und warnt dabei. In allen anderen Fällen
gibt es keinen Dev-Login. Umgebungsvariablen und Betriebsdetails stehen in `apps/control-api/README.md` und `docs/DEPLOYMENT.md`.

## Anfragepipeline

Jede Operation durchläuft dieselben Stufen (`ApiPipeline.handle`), in dieser Reihenfolge:

1. **Korrelation**: `X-Correlation-Id` aus der Anfrage übernehmen oder erzeugen; jede Antwort trägt sie, `Cache-Control: no-store`.
2. **Authentifizierung**: Sitzungs-Cookie auflösen. Ohne Sitzung entsteht ein anonymer Akteur.
3. **Autorisierung**: `requiresSession`, Rollenrang (`owner` > `operator` > `viewer`, Vertrag `x-required-role`), CSRF bei `csrf: true`,
   Aktionsmatrix (`ACTION_BY_OPERATION`). Verweigerungen: `UNAUTHENTICATED`, `FORBIDDEN` (mit `details.action`), `CSRF_INVALID`.
4. **Eingabe**: Pfadparameter, Query (`QueryValidator`) und Body (AJV gegen das Vertragsschema) prüfen. Fehler: `VALIDATION_FAILED`.
5. **Idempotenz** (nur nicht-sichere Methoden mit `Idempotency-Key`): Replay, Konflikt oder Ausführung (siehe unten).
6. **Handler**: ruft den Port-Adapter auf oder erledigt die Operation selbst. `If-Match` wird als `ifMatchVersion` übergeben.
7. **Audit**: jede mutierende Anfrage wird protokolliert, auch verweigerte. Anonymes Scanner-Rauschen wird nicht auditiert, der Login schon.
8. **Antwortvalidierung** (Dev/Test) gegen das Schema des Status.
9. **Metriken und Zugriffslog**: Methode, Route, Operation, Status, Dauer, Fehlercode, Benutzer-ID, Rolle und IP. Keine Anfrageinhalte, keine Geheimnisse.

Fehler werden einheitlich als `{ error: { code, message, severity, retryable, correlationId, details } }` ausgegeben. Der
HTTP-Status je Code steht in `src/util/errors.ts` (z. B. `CAPABILITY_MISSING` -> 403, `ADAPTER_UNAVAILABLE` -> 503).

## Routentabelle

`src/http/route-table.generated.ts` wird von `scripts/generate-route-table.ts` aus dem gebündelten Vertrag
(`packages/contracts/dist/jarvis-api.bundled.yaml`) erzeugt. Reihenfolge: `pnpm contracts:generate`, dann
`pnpm --filter @jarvis/control-api generate:routes`. Jede Route enthält `operationId`, Methode, Pfad, Capability, Mindestrolle,
`requiresSession`, `csrf`, `acceptsIfMatch`, `acceptsIdempotencyKey`, Body- und Größengrenzen sowie die zulässigen Antworten.
Fehlt für eine Operation ein Handler, antwortet die Pipeline mit `INTERNAL`. `contract.test.ts` prüft alle 122 Operationen
gegen ihre Verträge. `/api/v1/events` ist kein OpenAPI-Eintrag, sondern ein WebSocket im AsyncAPI-Vertrag.

## Authentifizierung, CSRF und Rollen

- **Login**: `POST /api/v1/auth/login`. Die Sitzung läuft über das Cookie `jarvis_session` (HttpOnly, SameSite=Strict, mit `Secure`,
  sobald `auth.secureCookies: true`). Das Cookie `jarvis_csrf` ist für die Oberfläche lesbar und ebenfalls SameSite=Strict.
- **CSRF**: Jede mutierende Anfrage braucht `X-CSRF-Token`. Der Wert ist HMAC-SHA256 über die Sitzungs-ID mit einem Serverschlüssel
  (`@jarvis/auth`, `csrf.ts`). Ein Token einer anderen Sitzung ist ungültig.
- **Rollen**: `owner` > `operator` > `viewer`. Die Rollenmatrix je Operation steht im Vertrag und in der Routentabelle.
- **Sitzungen**: Lebensdauer 720 Minuten, Leerlauf-Timeout 30 Minuten, Re-Auth-Fenster 5 Minuten (Vorlage `dashboard.example.yaml`).
- **Login-Drosselung** (`LoginRateLimiter`): 5 Fehlversuche je Benutzer und IP, zusätzlich 20 je IP, Fenster 15 Minuten.
  Danach `429 RATE_LIMITED` mit `Retry-After`.
- **Host und Origin** (`security/guards.ts`): Der Host-Header muss `localhost`, `127.0.0.1`, `[::1]` oder die konfigurierte
  Adresse sein. Schreibende Anfragen brauchen eine erlaubte Origin. Weitere Origins gibt es nur mit `server.allowRemote: true`.
- **Header**: Content-Security-Policy mit SHA-256-Hashes der Inline-Skripte je Seite, `Strict-Transport-Security` nur mit `secureCookies`.

## Idempotenz

- `Idempotency-Key` (8 bis 128 Zeichen) wird nur für nicht-sichere Methoden und nur für Operationen mit `acceptsIdempotencyKey`
  ausgewertet. Die Pipeline leitet daraus einen Schlüssel ab, der an Benutzer, Methode, Pfad und Ressource gebunden ist
  (`scopedIdempotencyKey`). Adapter sehen nur diesen abgeleiteten Schlüssel.
- Gespeichert wird in der SQLite-Tabelle `idempotency_keys` (übersteht Neustarts), zusammen mit einem Hash des Bodys. Nur erfolgreiche
  Antworten mit Body werden gespeichert.
- Gleicher Schlüssel und gleicher Body: dieselbe Antwort mit `Idempotent-Replayed: true`, ohne erneute Ausführung. Gleicher Schlüssel,
  anderer Body: `409 IDEMPOTENCY_CONFLICT`. Ein paralleler Doppelklick wartet auf die laufende Ausführung, statt doppelt auszuführen.
- Cache-Treffer und -Fehlzugriffe zählen in den Metriken (`jarvis_cache_requests_total`).

## If-Match

`If-Match: <version>` (auch `"3"` oder `W/"3"`) wird geparst und als `ifMatchVersion` an Handler und Adapter gereicht. Bei Abweichung:
`409 CONFLICT`. Betroffen sind Operationen mit `acceptsIfMatch`, z. B. Aufgaben, Dateien, Automationen und `PATCH /settings/adapters/{id}`.
Die Adapter-Einstellungen führen eine `version`, die bei jeder gespeicherten Änderung steigt (SQLite, übersteht Neustarts).

## Freigaben (Approvals, PLAN §32.5)

- `GET /approvals/{id}` stellt einen kurzlebigen Einmal-Token aus: Antwort-Header `X-Approval-Token` und
  `X-Approval-Token-Expires`. Standard-Lebensdauer 120 Sekunden (`DEFAULT_APPROVAL_TOKEN_TTL_MS`).
- `POST /approvals/{id}/approve` und `/reject` verlangen den Token als Request-Header `X-Approval-Token`. Fehlt er:
  `APPROVAL_REQUIRED`. Der Token ist einmalig, an die Freigabe, den Benutzer und die Aktion gebunden. Die verbrauchten Nonces stehen
  in `auth_approval_nonces`, damit ein Token auch nach einem Neustart nicht wiederverwendet werden kann.
- **Risikostufe 3**: nur `owner`, nie über den Sprachkanal (`FORBIDDEN`, Grund `voice_not_allowed`), zusätzlich eine frische
  Passwort-Re-Auth über `POST /auth/reauth`. Deren `reauthToken` (einmalig) wird im Body der Entscheidung mitgeschickt. Fehlt er:
  `REAUTH_REQUIRED`, bevor ein Credential verbraucht wird.
- Bereits entschiedene oder abgelaufene Freigaben: `409 CONFLICT`. Die Freigabe wird danach nicht erneut ausgeführt.

## Echtzeit (Ereignis-Hub, `src/realtime/hub.ts`)

- Endpunkt `GET /api/v1/events` (WebSocket, Pfad aus `/meta`). Umschläge nach AsyncAPI mit einer **globalen, streng steigenden
  `sequence`**. Der Hub vergibt `id`, `time`, `sequence` und die Vertragsversion. Unbekannte Ereignistypen werden verworfen.
- **Ringpuffer** mit `realtime.ringBufferSize` (Standard 5000). `?since=<n>` spielt Verpasstes nach. Liegt `since` außerhalb des
  Puffers oder über dem aktuellen Stand, kommt `jarvis.status.resync_required` mit einem Grund (`sequence_too_old`,
  `buffer_overflow` oder `server_restart`). Der Client lädt dann seine Snapshots neu.
- **Heartbeat**: Der Server sendet `{"kind":"ping","ts":…}` alle `realtime.heartbeatSeconds` (Standard 15), der Client antwortet mit
  `pong`. Stille Clients werden getrennt. Langsame Clients (Puffer läuft voll) werden mit Close-Code 1013 beendet und müssen neu synchronisieren.
- **Sitzungsende** schließt die Verbindung mit 4401. Beim Herunterfahren gehen alle Verbindungen mit 1001 weg, bevor der HTTP-Server schließt.
- **Sequenz über Neustarts**: Der Stand wird in der Tabelle `kv` (Schlüssel `hub.sequence`) alle 50 Ereignisse und beim Beenden
  gesichert. Nach dem Start zählt der Hub mit einem Sicherheitsabstand weiter, damit Cursor nie rückwärts laufen.
- Im Mock-Modus nummeriert die Welt ihre Aktivität mit derselben Sequenz (`MockWorld({ nextSequence })`). Der Umschlag von
  `jarvis.activity.appended` und `ActivityEvent.sequence` stimmen dadurch überein.

## Audit und Manipulationsschutz

- Jede mutierende Anfrage landet in der Tabelle `audit_log`, auch wenn sie verweigert wurde. Jeder Eintrag enthält eine
  SHA-256-Hashkette über den Vorgänger. Die Kette wird beim Start geprüft, `/health` zeigt `audit-chain` als `offline`, wenn sie gebrochen ist.
- **Kopf-Anker**: Länge und Hash des letzten Eintrags stehen nach jedem Anhängen HMAC-signiert (Schlüssel aus `auth.key`) in
  `<dataDir>/audit-head.json` und in `kv` (`audit.head`). `verify()` unterscheidet `truncated` (Kette kürzer als der Anker),
  `head_mismatch` (anderer Hash an der verankerten Stelle, z. B. altes Datenbank-Backup) und `anchor_tampered` (ungültige Signatur).
- Grenze: Wer Datenbank **und** beide Anker löscht oder den `auth.key` kennt, kann die Spur unbemerkt kürzen. Die Kette des Control-Plane
  ist von `GET /audit/events` getrennt; diese Operation liefert die Einträge des Audit-Adapters.

## Metriken und Telemetrie (PLAN §50.3)

- `GET /api/v1/metrics` (nur `owner`, `text/plain; version=0.0.4`): `jarvis_http_request_duration_seconds`, `jarvis_http_requests_total`,
  `jarvis_http_errors_total`, `jarvis_http_error_ratio` (Anteil 5xx), `jarvis_ws_connections`, `jarvis_events_total`,
  `jarvis_events_per_second`, `jarvis_adapter_health` (1 gesund, 0,5 eingeschränkt, 0 aus, -1 unbekannt), `jarvis_cache_requests_total`,
  `jarvis_cache_hit_ratio` sowie die Frontend-Reihen `jarvis_frontend_orb_fps`, `jarvis_frontend_orb_frame_time_ms`/`_seconds`,
  `jarvis_frontend_webgl_memory_bytes`, `jarvis_frontend_errors_total`. Die Label-Kardinalität ist auf 500 Reihen je Metrik begrenzt.
- `POST /api/v1/telemetry/frontend` (`operator` und höher, CSRF): bis zu 20 Fehler und 60 Orb-Messwerte je Anfrage, höchstens 32 KiB
  (`413`), 30 Anfragen je Minute und Sitzung (`429`). Meldungstexte werden bereinigt (URLs, E-Mail-Adressen, Tokens) und nur als
  Logzeile gehalten. Telemetrie erzeugt keine Audit-Einträge.
- **Logs**: strukturierte Zeilen mit Korrelations-ID. Der Ringpuffer `LogBuffer` hält die letzten 2000 Zeilen ab Level `info` und
  speist `GET /adapters/{id}/logs` (nur `owner`). Jede Zeile ist vor dem Speichern geschwärzt (Schlüsselnamen wie `token` und
  `password`, Tokens, API-Schlüssel, URL-Zugangsdaten). Stacktraces gelangen nicht in den Puffer.

## Statische Auslieferung (`src/http/static.ts`)

Das Web-Root ist `paths.webRoot` (Vorlage `../apps/web/out`, relativ zum Config-Verzeichnis). Die Auslieferung probiert
`/tasks` -> `tasks.html` -> `tasks/index.html` -> `index.html`. Dateien mit Endung müssen existieren, Seitenrouten fallen auf die
SPA-Hülle zurück. `/api/*` wird nie statisch beantwortet, und Pfade dürfen das Web-Root nicht verlassen (Traversal-Test in `static.test.ts`).

## Persistenz (`node:sqlite`)

- Datenbank `${dataDir}/dashboard.sqlite` über das eingebaute `node:sqlite` (Node >= 22.13), ohne natives Modul. Journal im WAL-Modus
  mit `synchronous = NORMAL` (nicht für `:memory:`).
- Migrationen sind eine append-only Liste mit Tabelle `schema_migrations`. Ausgelieferte Migrationen werden nie geändert, neue kommen hinzu.
- Tabellen: `kv` (Sequenz, Audit-Kopf, Kleinwerte), `settings_areas` (Einstellungsbereiche), `audit_log` (Hashkette),
  `idempotency_keys`, `command_history`, `library_items` (Themes, Layouts), `adapter_overrides` (Adapter-Einstellungen),
  `auth_sessions`, `auth_approval_nonces`.
- Dateien im Datenverzeichnis: `dashboard.sqlite` und `auth.key` (Serverschlüssel für CSRF, Approval-Token und den Audit-Anker; beim ersten Start
  angelegt), `audit-head.json`.
- Geheimnisse werden nie gespeichert. Adapter-Secrets, die über die Oberfläche eingegeben wurden, bleiben nur im Speicher (`RuntimeSecrets`).

## Dev-Konsole und Szenarien

`/api/v1/dev/*` existiert nur mit Mock-Daten und `dev.scenarioConsole: true` (sonst `404`) und nur für `owner`. Die CLI
`apps/mock-console` (`pnpm scenario -- <befehl>`) meldet sich als `dev-owner` an. Befehle: `list`, `state`, `select`/`play`,
`advance`, `offline`/`online`, `latency`, `error-rate`, `capability`, `event`, `orb`, `release-orb`, `play-event`, `reset`, `status`,
`watch`. Hilfe: `pnpm scenario -- --help`.

## Tests

```bash
pnpm --filter @jarvis/control-api test        # vitest, test/*.test.ts
```

| Datei                                               | Prüft                                                                                                            |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `contract.test.ts`                                  | alle 122 Operationen mit vertragsgültiger Antwort; schlägt fehl, wenn eine Operation fehlt                       |
| `contract-gaps.test.ts`                             | Operationen der geschlossenen Vertragslücken (Rollen, CSRF, Capability, Idempotenz, Audit, Schwärzung, Neustart) |
| `security.test.ts`                                  | Sitzungen, Cookies, CSRF, Origin/Host, Rollenmatrix, Login-Drosselung                                            |
| `mutations.test.ts`                                 | Idempotenz (Replay, Konflikt, parallel, Neustart), `If-Match`, `assistantName`                                   |
| `approvals.test.ts`                                 | Approval-Token, Einmaligkeit, Ablauf, Doppel-Approve, Stufe 3 mit Re-Auth, Sprachkanal                           |
| `degradation.test.ts`                               | Teilausfall, fehlende Capability, Latenz und Fehlerquote                                                         |
| `realtime.test.ts`                                  | WebSocket: Umschläge, `?since`, `resync_required`, Ping/Pong, Sitzungsende                                       |
| `audit.test.ts`                                     | Hashkette, Manipulationserkennung, abgeschnittenes Ende, Neustart mit manipulierter Datenbank                    |
| `observability.test.ts`                             | `/metrics`, Frontend-Telemetrie (Validierung, Größe, Rate, Bereinigung)                                          |
| `sequence.test.ts`                                  | Hub-Sequenz gleich Aktivitäts-Sequenz, `sinceSequence`-Nachfüllung                                               |
| `adapter-settings.test.ts`                          | `version` und `If-Match` an den Adapter-Einstellungen                                                            |
| `scenario-console.test.ts`                          | `release_orb_state`, `play_event`                                                                                |
| `config-files.test.ts`                              | Dateien in `config/layouts` und `config/themes` gegen ihre Schemas                                               |
| `secrets.test.ts`                                   | keine Secrets in Antworten, Audit, Ereignissen, Logs und Datenbank                                               |
| `static.test.ts`                                    | SPA-Fallback, CSP-Hashes, Path-Traversal                                                                         |
| `real-adapters.test.ts`                             | reale Adapter in der Registry: Registrierung, Mock-Fallbacks, `file:`-Secrets, Platzhalter-Kollision             |
| `branding-commands.test.ts`, `mock-console.test.ts` | Branding, Befehls-Intents, Szenario-CLI gegen den echten Server                                                  |

`test/helpers.ts` startet die komplette App in einem temporären Verzeichnis (`startTestApi`) mit einstellbarer Uhr,
Ringpuffer, Heartbeat und Log-Mitschnitt.

# Adapter und Integration

## Schichten

| Schicht                   | Ort                                                                   | Aufgabe                                                                                                            |
| ------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Ports                     | `packages/adapter-core/src/ports.ts`, `port-spec.ts`                  | Schmale Interfaces je Domäne; `PORT_SPEC` ordnet jeder Methode Operation, Capability, Mutation und Ergebnisform zu |
| Registry                  | `packages/adapter-core/src/registry.ts`                               | lädt nur Allowlist-Provider, isoliert Fehler, schützt Port-Aufrufe, prüft Ergebnisse                               |
| Resilienz                 | `resilience.ts`, `http-client.ts`                                     | Timeout, Retry mit Backoff und Jitter, Circuit Breaker, HTTP-Client mit Fehlerabbildung                            |
| Lebenszyklus und Health   | `lifecycle.ts`, `health-monitor.ts`                                   | Zustände, Prüfintervall, Capability-Refresh                                                                        |
| Konfiguration und Secrets | `packages/config` (`load.ts`, `secrets.ts`, `categories.ts`, Schemas) | `dashboard.yaml` und `adapters.yaml` laden und prüfen, Secret-Referenzen auflösen                                  |
| Verdrahtung               | `apps/control-api/src/runtime/adapter-wiring.ts`                      | Allowlist auf Factories abbilden, Einträge bilden, Secrets liefern, Ereignisse in den Hub leiten                   |
| Adapter                   | `adapters/*`                                                          | übersetzen Fremdsysteme in kanonische Modelle                                                                      |

Ein Adapter implementiert `JarvisAdapter` (Lebenszyklus) und den Port seiner Kategorie. Er gibt nur `AdapterError` nach außen. Fremdfelder
erreichen die Control API nie; kanonische Schemas verbieten zusätzliche Felder (`additionalProperties: false`).

## Betriebsmodi

`dataMode` in `dashboard.yaml`, überschreibbar mit `JARVIS_DATA_MODE`. Die Auflösung je Kategorie steht in `packages/config/src/load.ts`:

| Modus    | Kategorie in `adapters.yaml` genannt                                           | Kategorie nicht genannt                                                 | Provider `mock-*` in `adapters.yaml` |
| -------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------ |
| `mock`   | Nicht-Mock-Provider werden ignoriert (Warnung), stattdessen `mock-<kategorie>` | `mock-<kategorie>`                                                      | Standard                             |
| `hybrid` | Provider wie konfiguriert                                                      | `mock-<kategorie>` (Simulation, in der Oberfläche als solche erkennbar) | erlaubt                              |
| `live`   | Provider wie konfiguriert                                                      | deaktiviert, kein Adapter (keine Simulation)                            | erlaubt, mit Warnung                 |

Gespeicherte Überschreibungen der Adapter-Einstellungen (`adapter_overrides`, über `PATCH /settings/adapters/{id}`) wirken auf Schalter
und Konfiguration in allen Modi. Den Provider ersetzen sie nur in `hybrid` und `live` und nur, wenn der konfigurierte Eintrag kein
Mock-Provider ist. Im Modus `mock` bleibt es bei den Mock-Adaptern.

## Allowlist und Factories

Eine Anbindung braucht zwei Dinge:

1. **Allowlist** in `adapters.yaml`: Provider-ID -> npm-Paket (`allowlist: { hermes-tasks: "@jarvis/adapter-hermes" }`). Die Registry
   lädt nur diese Einträge. Ein aktivierter Provider ohne Allowlist-Eintrag ist ein Konfigurationsfehler (Exit-Code 2 beim Start).
2. **Factory im Build**: `packageFactories()` in `adapter-wiring.ts` bildet jeden erlaubten Paketnamen auf seine Factories ab. Die
   Control API bündelt sie statisch, es gibt keinen dynamischen Import. Ein Paket ohne Eintrag wird nicht geladen (Warnung).

Ältere Allowlist-Einträge, die auf ein Platzhalterpaket zeigen (`@jarvis/adapter-hermes-placeholder`, `@jarvis/adapter-voice-placeholder`),
bekommen automatisch den echten Adapter mit derselben Provider-ID (Warnung im Log). Die Vorlagen führen die echten Pakete.

## Reale Adapter

| Provider             | Kategorie  | Paket                          | Status                                                                           |
| -------------------- | ---------- | ------------------------------ | -------------------------------------------------------------------------------- |
| `hermes-tasks`       | `tasks`    | `@jarvis/adapter-hermes`       | Kanban-Aufgaben über das Hermes-Dashboard (`127.0.0.1:43691`)                    |
| `hermes-activity`    | `activity` | `@jarvis/adapter-hermes`       | Sitzungen und Nachrichten über den Hermes-API-Server (`127.0.0.1:43693`, Bearer) |
| `hermes-agents`      | `agents`   | `@jarvis/adapter-hermes`       | Profile, Assignees und Worker aus dem Hermes-Dashboard                           |
| `jarvis-voice-http`  | `voice`    | `@jarvis/adapter-voice-http`   | Statusdokument des Voice-Dienstes (`127.0.0.1:43694`), nur lesend                |
| `local-system`       | `system`   | `@jarvis/adapter-system-local` | Host-Metriken, Dienstprobes und Modelllisten auf dem Rechner der Control API     |
| `example-tasks-http` | `tasks`    | `@jarvis/adapter-example-http` | Referenz für eine fiktive REST-API, nicht verdrahtet                             |
| `mock-*`             | alle       | `@jarvis/adapter-mock`         | Simulation aus `@jarvis/mock-data`, 15 Port-Wrapper                              |

Capabilities, Verifikationsstand und offene Annahmen je Adapter stehen in [`HANDOFF.md`](HANDOFF.md) (Abschnitt 3) und in den
READMEs unter `adapters/`.

## Geheimnisse (`packages/config/src/secrets.ts`)

| Schema                | Auflösung                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------ |
| `env:NAME`            | Umgebungsvariable (inkl. `.env` im Projektwurzelverzeichnis)                                                 |
| `file:ABSOLUTER_PFAD` | Datei wird bei jedem Zugriff gelesen; BOM und Leerzeichen entfernt; nie ausgegeben; relative Pfade abgelehnt |
| `wincred:ZIEL`        | Windows Credential Manager über das PowerShell-Modul `CredentialManager`; nur Windows                        |

Die Konfiguration enthält nur Referenzen. Ein Klartextwert in einem Credential-Feld (`token`, `apiKey`, `password`, ...) wird beim
Laden abgelehnt. Adapter bekommen Secrets nur über `context.getSecret(field)` und nur für Felder aus `manifest.secretFields`. Die
Registry maskiert Secrets in Logs, Fehlern und Ereignissen; die Conformance-Suite prüft das mit Canary-Werten.

## Ausführung von Port-Aufrufen

- **Timeout** je Entry (`timeoutMs`; Konfigurationsstandard 5000 ms).
- **Retry**: Der Konfigurationsstandard gilt für jeden Eintrag (3 Versuche, Basis 200 ms, Obergrenze 5 s, Jitter 0,2). Ohne Konfiguration
  wäre der Registry-Standard ein Versuch (`ADAPTER_SDK.md` §4). Der Adapter-HTTP-Client wiederholt Transportfehler zusätzlich, die Versuche
  können sich also multiplizieren. Diese Abstimmung ist offen (siehe `HANDOFF.md`, Fehlersuche).
- **Circuit Breaker**: 5 Fehler in Folge öffnen, nach 30 Sekunden ein Testversuch. Client-Fehler (404, 409) zählen nicht.
  Mock-Adapter haben weder Retry noch Breaker, damit Szenarien deterministisch bleiben.
- **Ergebnisprüfung**: Jede Antwort wird gegen das Vertragsschema geprüft. Verstöße ergeben `VALIDATION_FAILED`, nichts wird weitergegeben.
- **Mutationen** werden nur mit `Idempotency-Key` wiederholt.
- **Fehler** tragen die Korrelations-ID des Aufrufs.

## Health-Monitor und Capability-Refresh

- Der `HealthMonitor` ruft `healthCheck()` alle 15 Sekunden auf (Prüfung mit Deadline 5 Sekunden). Er führt Latenz, letzten Erfolg,
  letzten Fehler, aufeinanderfolgende Fehler und den Breaker-Zustand.
- Zustände: `INITIALIZING`, `ONLINE`, `DEGRADED` (erster Fehler im Betrieb oder Latenz über 3 Sekunden), `OFFLINE` (ab 3 Fehlern in Folge),
  `RECOVERING` (intern, im Vertrag als `OFFLINE`), `STOPPING`, `STOPPED`.
- Nach einer Erholung liest die Registry `getCapabilities()` neu. Die Ereignisse `jarvis.adapter.health_changed` und
  `jarvis.adapter.capabilities_changed` kommen nur bei echter Änderung.
- Ein Adapter im Zustand `OFFLINE` oder `STOPPED` trägt nichts zu `GET /capabilities` bei; die Oberfläche zeigt „Nicht verbunden“.
- `POST /api/v1/adapters/{id}/restart` (nur `owner`, auditiert): stoppt den Adapter über die Registry, erzeugt eine frische Instanz und
  initialisiert sie neu. Die Capabilities `system.restartAdapter` und `system.openLogs` stellt die Control API selbst bereit, der
  Adapter `local-system` deklariert sie nicht.

## Teilausfall

Fällt ein Adapter aus, antworten nur dessen Endpunkte mit `503 ADAPTER_UNAVAILABLE`. `/health`, `/adapters`, `/capabilities`, `/status`
und `/orb/status` spiegeln den Zustand, alles andere läuft weiter. Ein Modul ohne Capability antwortet mit `403 CAPABILITY_MISSING`.
Die Oberfläche bleibt in jedem Fall bedienbar (PLAN §57: „Adapter-Ausfälle abgefangen“).

## Mock-Adapter (`adapters/mock`)

`createMockFactories({ world })` erzeugt je Kategorie den Adapter `mock-<kategorie>` über die `MockWorld`. Die Welt liefert Daten,
Latenz, Fehlerquoten, Ausfälle und Capabilities für die Szenario-Konsole. Mock-Adapter werden im Modus `mock` immer geladen und im
Modus `hybrid` für alle Kategorien ohne eigene Anbindung.

## Integrationsnachweis

Der Hybrid-Lauf gegen Fake-Upstreams (Hermes, Voice, Qwen auf den Installer-Ports) ist in `tests/integration` beschrieben und in
`docs/evidence/integration/` dokumentiert. Kommandos und Fehlersuche stehen in [`HANDOFF.md`](HANDOFF.md).
