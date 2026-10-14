# Architecture

One chapter per area. Other areas (Control API, adapters, mock platform) add their own chapters below the frontend chapter.

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
  shims/jarvis-orb.d.ts     type-only facade of @jarvis/orb for the compiler (see "Type checking")
```

## Providers (`src/app/providers.tsx`)

Order, outermost first: `QueryClientProvider` -> `ClientOnly` (tree mounts after hydration; the server HTML is the boot
screen because the UI library renders portals) -> `ToastProvider` -> `ErrorSinkBridge` (QueryClient errors -> toasts) ->
`MockGate` (starts MSW when `NEXT_PUBLIC_JARVIS_MSW=1`) -> `AppSettingsProvider` -> `CapabilitiesProvider` ->
`RealtimeProvider`. The three last ones only run for an authenticated session.

| Provider | Source | What it does |
|---|---|---|
| QueryClient | `lib/api/queryClient.ts` | stale time per domain (`staleTimes.ts`), retry only for `JarvisApiError.retryable`, never for 4xx, 3 attempts max; MutationCache turns errors into toasts, 409 CONFLICT refetches `conflictKeys`, UNAUTHENTICATED invalidates the session |
| SDK client | `lib/api/client.ts` | one `createJarvisClient({ baseUrl: "" })`; CSRF token from `/auth/session` (fallback: `jarvis_csrf` cookie); a correlation id per request (SDK) |
| Session | `lib/session.tsx` | `useSession()`; `SessionGate` redirects to `/login` or shows the "API not reachable" screen |
| Settings / theme | `lib/settings.tsx` | `GET /settings` -> `applyTheme`, theme knobs (cyan/panel/gold/grid/font scale), `setMotionMode`, `<html lang>`, locale/timezone/hour12; every change re-runs the effects, no rebuild (PLAN §25.2) |
| Capabilities | `lib/capabilities.tsx` | `useCapability(module, action)` (boolean), `useCapabilityState` (`available | read-only | missing`), `capabilityPathState("mail.send")` |
| i18n | `i18n/` | `useT()` -> `{ t, locale }`; German default, English from `profile.locale`; `en.ts` must have exactly the keys of `de.ts` (compile error + unit test) |
| Realtime | `lib/realtime/RealtimeProvider.tsx` | creates the `RealtimeClient` once meta + session exist |

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
      queryFn: (): Promise<TaskListResponse> => call(getApiClient().GET("/api/v1/tasks", { params: { query: filters } })),
      staleTime: staleTimes.tasks,
    }),
};
export const useTasks = (filters?: TaskFilters) => useQuery(taskQueries.list(filters));

// 3. mutations: useApiMutation adds the Idempotency-Key per intent, invalidation, optional optimistic edit + rollback
export function useUpdateTask() {
  return useApiMutation<TaskResponse, { id: string; version: number; patch: TaskUpdateRequest } & IntentVars>({
    label: "Aufgabe ändern",
    mutationFn: ({ id, version, patch }) =>
      call(getApiClient().PATCH("/api/v1/tasks/{id}", { params: { path: { id }, header: { "If-Match": String(version) } }, body: patch })),
    invalidate: [queryKeys.tasks.all, queryKeys.overview],
    conflictKeys: [queryKeys.tasks.all],            // 409 -> refetch + "Änderung nicht übernommen" toast
  });
}
```

Export the module from `lib/api/index.ts`. Existing domains: meta/session/health/capabilities/overview/status/orb (`core`), auth, tasks,
activity (+ `fetchActivitySince`), agents, approvals, notifications, communication, calendar, system, voice, memory (+ `searchMemory`),
files, automations, settings (+ layouts, themes), commands. Still to be added by module agents: research, audit, adapters, drafts detail views.

`useApiMutation` exposes `mutate`/`mutateAsync` that pin the Idempotency-Key at call time: pass the same `idempotencyKey` again
to replay a request (retry button), omit it for a new intent.

## Realtime (`src/lib/realtime`)

`RealtimeClient` (framework-free, fully unit-tested with a fake transport and fake timers):

* URL: `meta.eventsOrigin + meta.eventsPath` (http->ws), or the page origin (ws/wss from the page protocol), `?since=<last sequence>`.
* Persists the last applied sequence in `sessionStorage` (try/catch); resumes with `?since=` after reload or reconnect.
* Dedupe: `sequence <= last` is ignored. Gap: `sequence > last + 1` -> `onGap` (the provider refetches snapshot roots and backfills
  `GET /activity?sinceSequence=`), the event is still applied. `jarvis.status.resync_required` -> `onResync` (refetch everything,
  sequence jumps to `latestSequence`).
* Heartbeat: answers server pings with the echoed `ts`, sends its own ping every 10 s, roundtrip = pong delay; a ping unanswered
  for 5 s or a roundtrip > 1.5 s marks the stream `degraded`; 45 s of silence replaces the connection.
* Reconnect: exponential ceiling 0.5/1/2/4/8/15 s with jitter, always inside [0.5 s, 15 s]; backoff resets after the connection was
  stable for 3 s. After 3 failed attempts the state is `polling`: snapshot roots are refetched every 10 s until a connection holds.
* `navigator.onLine` (offline stops retrying, online reconnects immediately) and page visibility (visible -> reconnect/ping now).
* `useRealtimeStatus()` -> `{ state: connecting|online|degraded|offline|polling, roundtripMs, lastEventAt, sequence }`
  ("Event-Stream online · 28 ms · vor 2 s" in the top bar).
* Transport interface (`transport.ts`): `WebSocketTransport` in production, the same class over `@jarvis/mock-data`'s in-memory
  socket in standalone mock mode (`lib/mock/bootstrap.ts`). The client never knows the difference.

`applyEvent(queryClient, event)` (`applyEvent.ts`) is the deterministic event -> cache reducer, exhaustive over all 44 event types
(a new contract event is a compile error until handled). Rules: replace only with an equal-or-newer `version`; patch lists and
details in place; prepend created items to unfiltered first-page lists; refetch filtered lists instead of guessing membership;
keep `overview` (running tasks, open approvals, critical alerts, counters, orb, voice, system summary) in sync and coalesce the
derived parts (attention, counters) into one debounced refetch (1.5 s). `jarvis.voice.audio_level` bypasses the cache.

## Orb integration (`src/features/orb`)

* State = the query-cache entry of `GET /orb/status`; `jarvis.orb.status_changed` writes the same entry (`useOrbSnapshot`).
* `OrbSlot` lazy-loads `OrbSlotInner` (client only, three.js chunk) which renders `<JarvisOrb snapshot settings onActivate onVoiceToggle>`.
  `settings.orb` -> `orbSettingsFromWire`; `meta.features.forceOrbFallback2D` (scenario hint) -> `renderer: "2d"`; WebGL failure and
  context loss are handled by `@jarvis/orb` itself (2D fallback).
* Audio: `jarvis.voice.audio_level` events are written into `audioStore` without React state; consumers sample it at <= 12 Hz and only
  while a voice mode is active (`useAudioSamples`), so only the orb/waveform subtree re-renders. `JarvisOrb` has no ref-based audio
  input yet, hence the bounded-rate `status.audioLevel` update.
* Interaction routing (PLAN §21, `useOrbActions.routeOrbActivation`): approval -> `/approvals?approval=`, task -> `/tasks?task=`,
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
calls `setupBrowserMocks()` from `@jarvis/mock-data` (msw service worker `public/mockServiceWorker.js` + in-memory event socket).
`window.__jarvisMock` exposes the platform (scenario engine) to the browser console and the screenshot script.

## Type checking

`pnpm --filter @jarvis/web typecheck` uses `tsconfig.typecheck.json`, which maps `@jarvis/orb` to `src/shims/jarvis-orb.d.ts`.
Reason: `@react-three/fiber` augments the global JSX namespace; inside one TypeScript program that makes `ElementType` in
`@jarvis/ui`'s polymorphic `HudPanel` collapse to `never`. Next's own type check is therefore disabled
(`typescript.ignoreBuildErrors`), `pnpm build` runs the typecheck first. Bundlers resolve the real package.

## Commands

| Command | Purpose |
|---|---|
| `pnpm --filter @jarvis/web dev` | `next dev` on :3000, `/api/*` rewritten to `JARVIS_API_ORIGIN` (default `http://127.0.0.1:3100`) |
| `pnpm --filter @jarvis/web dev:mock` | standalone with MSW + mock event stream |
| `pnpm --filter @jarvis/web build` | typecheck + static export to `apps/web/out` |
| `pnpm --filter @jarvis/web typecheck` / `test` | tsc / vitest (jsdom) |
| `pnpm --filter @jarvis/web screenshots` | Playwright screenshots of the overview into `apps/web/screenshots/` (needs a running dev server, `--base`) |
