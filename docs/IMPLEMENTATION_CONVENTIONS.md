# Implementation Conventions (binding for every contributor and agent)

The authoritative product spec is `docs/PLAN.md`. This file fixes the technical decisions the plan leaves
open, so that independently built parts integrate without rework. When this file and `PLAN.md` disagree on
a technical detail, this file wins; on product scope, `PLAN.md` wins.

## 1. Workspace

- pnpm 10 workspaces, Node >= 22.13 (developed on Node 24), ESM everywhere (`"type": "module"`).
- TypeScript `~5.9.3`, strict, `noUncheckedIndexedAccess`. Base config: `tsconfig.base.json`.
- Internal libraries export **TypeScript source** (`"exports": { ".": "./src/index.ts" }`). No per-package
  build step for libraries. Apps transpile them (Next `transpilePackages`, tsup for the API, Vite for Storybook).
- Every package has `typecheck` (`tsc -p tsconfig.json --noEmit`). Tests use Vitest, colocated as
  `src/**/*.test.ts(x)` or `test/**/*.test.ts`.
- Dependencies are installed centrally. If you truly need a new dependency: `pnpm --filter <your-pkg> add <dep>`;
  if pnpm reports a lock conflict, wait 20 s and retry (other agents may be installing). Never delete
  `pnpm-lock.yaml` or `node_modules`.
- No `any` without a one-line reason comment. No TODO placeholders in delivered code.
- UI copy defaults to **German**; an English dictionary exists (see §9). Code identifiers/comments in English.

| Package | Name | Path |
|---|---|---|
| Contracts (source of truth) | `@jarvis/contracts` | `packages/contracts` |
| Generated SDK | `@jarvis/sdk` | `packages/generated-sdk` |
| Design tokens/themes | `@jarvis/design-tokens` | `packages/design-tokens` |
| UI components | `@jarvis/ui` | `packages/ui` |
| Orb | `@jarvis/orb` | `packages/orb` |
| Adapter SDK (ports, registry, resilience) | `@jarvis/adapter-core` | `packages/adapter-core` |
| Conformance suite | `@jarvis/adapter-testkit` | `packages/adapter-testkit` |
| Mock data, seeds, scenarios, MSW handlers | `@jarvis/mock-data` | `packages/mock-data` |
| Config loader | `@jarvis/config` | `packages/config` |
| Auth (sessions, roles, CSRF) | `@jarvis/auth` | `packages/auth` |
| Observability (logger, redaction, metrics) | `@jarvis/observability` | `packages/observability` |
| Mock adapters | `@jarvis/adapter-mock` | `adapters/mock` |
| Example HTTP adapter (template) | `@jarvis/adapter-example-http` | `adapters/example-http` |
| Placeholders | `@jarvis/adapter-*-placeholder` | `adapters/*-placeholder` |
| Control API (NestJS + Fastify) | `@jarvis/control-api` | `apps/control-api` |
| Web (Next.js App Router) | `@jarvis/web` | `apps/web` |
| Scenario CLI | `@jarvis/mock-console` | `apps/mock-console` |
| Storybook | `@jarvis/storybook` | `apps/storybook` |

### Windows shell gotchas (this machine)

- Run pnpm via the PowerShell tool and prefix every command with `$env:Path = $env:Path.Replace('"','');` — the machine PATH
  contains a stray quote (`C:\Program Files\Tesseract-OCR"`), which breaks every cmd.exe-spawned pnpm script
  ("Der Befehl node ... konnte nicht gefunden werden").
- Never leave a shell cwd inside `node_modules` (Windows locks the folder → pnpm EPERM).
- esbuild/@swc/core postinstall scripts are intentionally not in `onlyBuiltDependencies`; their platform binaries
  come from optional dependencies.

## 2. Contracts and code generation

- Source of truth: `packages/contracts/`.
  - `schemas/<domain>/*.schema.json` — JSON Schema 2020-12, one canonical model per file, `$id` of the form
    `https://jarvis.local/schemas/<domain>/<name>.schema.json`, relative `$ref`s between files.
  - `openapi/jarvis-api.yaml` — OpenAPI **3.1.1**, references the JSON schema files via relative `$ref`.
  - `asyncapi/jarvis-events.yaml` — AsyncAPI **3.0.0** (the newest version that `@asyncapi/parser` validates
    reliably; upgrade to 3.1 once the parser supports it — record the check result in `docs/CONTRACT_FIRST.md`).
  - `examples/<domain>/*.json` — example payloads, each declares the schema it must satisfy.
  - `baseline/` — snapshot of the last released contract for breaking-change detection.
- Generator chain (no Java available, so the OpenAPI Generator JAR is replaced by TS-native tooling):
  1. `redocly bundle` → `packages/contracts/dist/jarvis-api.bundled.yaml`
  2. `openapi-typescript` → `packages/generated-sdk/src/generated/openapi.ts`
  3. `json-schema-to-typescript` over all schemas → `packages/generated-sdk/src/generated/models.ts`
  4. event payload/type map from AsyncAPI → `packages/generated-sdk/src/generated/events.ts`
  5. JSON schema registry (all schemas inlined as data) → `packages/generated-sdk/src/generated/schemas.ts`
- `@jarvis/sdk` exports: generated types, `createJarvisClient({ baseUrl, fetch?, getCsrfToken? })` built on
  `openapi-fetch`, `JarvisEventMap` / `JarvisEventType` / `JarvisEventEnvelope<T>`, the schema registry,
  and `CONTRACT_VERSION`.
- **Nobody hand-writes DTO types.** Import models from `@jarvis/sdk`. The only exception: `@jarvis/orb` and
  `@jarvis/ui` keep their own *visual* prop types (e.g. `OrbVisualParams`) that are not wire models.
- Contract version: `1.0.0`, in every response envelope as `contractVersion` and in every event.

## 3. Wire conventions (from PLAN §8)

- Base path `/api/v1`. Timestamps UTC ISO-8601. IDs opaque, prefixed: `task_`, `agent_`, `appr_`, `mem_`,
  `act_`, `thr_`, `msg_`, `cal_`, `auto_`, `run_`, `rsp_`, `src_`, `fnd_`, `file_`, `ntf_`, `svc_`, `aud_`,
  `evt_`, `corr_`, `cmd_` followed by a 26-char ULID-like suffix (deterministic in mocks).
- Lists: `{ contractVersion, items, pageInfo: { nextCursor, hasNextPage }, freshness, sources }`.
- Single resources: `{ contractVersion, data, freshness }`.
- Every canonical resource: `id, version, createdAt, updatedAt, labels?, source{adapterId, system, externalId?, lastSyncedAt}`.
- `freshness`: `{ state: "fresh"|"stale"|"unknown"|"offline-cache", asOf }`.
- Errors: `{ error: { code, message, severity, retryable, correlationId, details } }`. Error codes enum lives in
  `schemas/common/error.schema.json` (at least `ADAPTER_UNAVAILABLE, ADAPTER_TIMEOUT, CAPABILITY_MISSING,
  VALIDATION_FAILED, NOT_FOUND, CONFLICT, UNAUTHENTICATED, FORBIDDEN, CSRF_INVALID, APPROVAL_REQUIRED,
  IDEMPOTENCY_CONFLICT, RATE_LIMITED, INTERNAL`).
- Mutations on versioned resources accept `If-Match: <version>` → `409 CONFLICT` on mismatch.
- Critical POSTs accept `Idempotency-Key`; the API replays the stored response for a repeated key.
- Headers: `X-Correlation-Id` (request → response, generated if absent), `X-CSRF-Token` on every mutating request.

## 4. Realtime

- WebSocket at `GET /api/v1/events` (same origin as REST). Query `?since=<sequence>` for replay.
- Envelope (PLAN §12.3) with monotonically increasing global `sequence`.
- Server keeps a ring buffer (default 5 000 events). If `since` is older than the buffer → server sends a
  `jarvis.status.resync_required` event; client reloads snapshots.
- Heartbeat: server sends `{"kind":"ping","ts":…}` every 15 s, client answers `{"kind":"pong","ts":…}`;
  client may also ping to measure roundtrip. Control frames are not envelopes and carry no `sequence`.
- Client: persists last applied `sequence`, ignores duplicates (`sequence <= last`), detects gaps
  (`sequence > last + 1`) → backfill via `GET /api/v1/activity?sinceSequence=` or snapshot refresh,
  exponential reconnect backoff with jitter (0.5 s → 15 s), polling fallback after 3 failed attempts.

## 5. Control API

- NestJS 11/12 with `@nestjs/platform-fastify`. **Always inject with explicit tokens** (`@Inject(TOKEN)`), never
  rely on `emitDecoratorMetadata` — the API must run under `tsx` (dev) and `tsup` (build) which use esbuild.
- Port default `3100`, host default `127.0.0.1`. Serves the static web build (`apps/web/out`) at `/` and the
  API at `/api/v1`. One origin, one port in production.
- Response validation against the contract schemas (AJV 2020) is **on in dev/test** and logs/fails on mismatch.
- Persistence: `node:sqlite` (built into Node ≥ 22.13) at `${JARVIS_DATA_DIR}/dashboard.sqlite` for settings,
  sessions, audit (append-only, hash chain), idempotency keys, command history. No native modules.
- Data mode: `JARVIS_DATA_MODE=mock|hybrid|live` + `config/adapters.yaml`.

## 6. Frontend

- Next.js App Router, `output: "export"` (static), React 19, TanStack Query v5, XState v5, React Three Fiber 9,
  Motion (`motion/react`). No server components that fetch data; all data via the SDK on the client.
- Detail views use drawers / query params (`/tasks?task=task_…`), not dynamic route segments (static export).
- Dev: `next dev` on 3000 rewrites `/api/*` to `JARVIS_API_ORIGIN` (default `http://127.0.0.1:3100`).
  The WebSocket URL is derived from `GET /api/v1/meta` (`eventsPath`, optional `eventsOrigin`) — never hardcoded.
- No `fetch()` in components. Query keys live in one module. Realtime events patch the cache deterministically.
- Optional standalone mock: `NEXT_PUBLIC_JARVIS_MSW=1` starts MSW in the browser with `@jarvis/mock-data` handlers.

## 7. Design

- Tokens exactly as PLAN §24.15 as CSS custom properties, exported from `@jarvis/design-tokens`
  (`tokens.css`, `themes/*.json`, `applyTheme(theme)`), runtime-switchable without rebuild.
- Fonts self-hosted via `@fontsource`: Oxanium (headings, uppercase, tracking), Inter (body), JetBrains Mono (metrics).
- Icons: `lucide-react`, stroke width 1.5, cyan by default.
- Panels: `HudPanel` with technical cut corners via `clip-path`, 1px cyan border at low/medium opacity, inner
  highlight line, small corner brackets. Glow only on active/attention panels. Gold only for orb/AI-core context.
- Reference images: `design-references/` — briefing only, never used as assets.

## 8. Orb

- `@jarvis/orb` exports `<JarvisOrb status={OrbStatus} settings={OrbSettings} onActivate=… />`, the XState
  machine `orbMachine`, `arbitrateOrbState()`, the 2D fallback `<OrbFallback2D/>`, and `<OrbPerfOverlay/>`.
- Semantic input only (`OrbStatus` from `@jarvis/sdk`, PLAN §17). Visual parameters are derived in the orb package.
- Scene is mounted once; state changes interpolate uniforms/speeds inside `useFrame`; no per-frame React state.

## 9. i18n

- Minimal dictionary approach: `apps/web/src/i18n/{de,en}.ts`, `t(key)` helper, `de` default. UI packages accept
  labels via props where text is user-facing.

## 10. Testing gates

- `pnpm contracts:check` — lint OpenAPI/AsyncAPI, validate schemas/examples, generated SDK up to date, breaking check.
- `pnpm test` — Vitest unit/component across the workspace (root `vitest.config.ts` uses `projects`).
- `pnpm test:conformance` — every adapter passes `@jarvis/adapter-testkit`.
- `pnpm test:e2e` — Playwright (navigation, flows, orb states, visual regression, axe).
- `pnpm typecheck`, `pnpm lint` must be clean.

## 11. Security baseline

- Localhost only by default. Roles `owner|operator|viewer`. HttpOnly + SameSite=Strict session cookie,
  CSRF double-submit token, re-auth for Tier-3 approvals, strict CSP headers from the API.
- Secrets only server-side (env / Windows Credential Manager reference); never in the browser, mock files, logs.
