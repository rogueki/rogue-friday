# Project Status & Continuation Guide

**Read this first in every new session** (then `docs/IMPLEMENTATION_CONVENTIONS.md`, then `docs/PLAN.md`).
Last updated: 2026-10-14 (move from a local Windows session to a cloud session).

## Goal

JARVIS Command Center — adapter-based, contract-first dashboard per `docs/PLAN.md` (binding spec, German).
Owner priorities: (1) the golden holographic orb (`design-references/jarvis_orb_reference.webp`), (2) the
command-center design language of `design-references/jarvis_dashboard_reference.webp`, (3) contract-first +
adapters + full mock mode, (4) transparency of what Jarvis does. **Nothing from the plan may be left out.**
The dashboard is for a friend who will install it from GitHub on Windows (`D:\Jarvis\dashboard`).

## Working mode

- One lead session orchestrates and reviews; implementation by cheaper subagents (Sonnet/Haiku) with
  strictly separated write scopes; the lead verifies every result (typecheck/tests/screenshots) before committing.
- Visual work is accepted only after the lead has looked at screenshots and compared them with the references.
- Art-direction briefs: `docs/briefs/ORB_BRIEF.md`, `docs/briefs/DASHBOARD_DESIGN_BRIEF.md`.

## Done and verified (committed)

| Area | Path | Verification |
|---|---|---|
| Monorepo, tooling, CI | root, `.github/workflows/ci.yml` | — |
| Contracts (252 JSON Schemas, OpenAPI 3.1.1 with 107 operations, AsyncAPI 3.1.0 with 44 events, 195 examples, codegen, breaking-change gate) | `packages/contracts` | `pnpm contracts:check` green |
| Generated SDK (types, openapi-fetch client, validator, event map) | `packages/generated-sdk` (`@jarvis/sdk`) | typecheck + tests green |
| Config / Auth / Observability | `packages/config`, `packages/auth`, `packages/observability` | 119 tests green |
| Design tokens, themes, HUD UI library (all PLAN §24.16 components), Storybook (81 stories, overview composition) | `packages/design-tokens`, `packages/ui`, `apps/storybook` | 36 tests, storybook build, screenshots in `apps/storybook/screenshots/` accepted by lead |
| Adapter SDK (15 ports, registry, resilience, health/lifecycle incl. RECOVERING), conformance suite, ExampleTasks HTTP adapter, Hermes/Voice/Mail/Calendar/System placeholders + mapping docs | `packages/adapter-core`, `packages/adapter-testkit`, `adapters/*` | 171 tests + 70 conformance green |
| Golden hologram orb (R3F scene, XState machine, all 14 modes, 2D fallback, perf overlay, stories, screenshot harness) | `packages/orb` | 82 tests, browser checks, screenshots in `packages/orb/screenshots/` accepted by lead after 2 review rounds |
| Mock platform (MockWorld for every operation, 4 seed profiles, 14 scenarios, MSW handlers, mock event hub) | `packages/mock-data` | 296 tests green |

## In progress when the local session stopped

See the sections below (filled from the final agent reports):

### apps/web — foundation DONE (verified by lead: typecheck clean, 53 tests green, static build OK)

Done: Next.js static export setup, providers (session gate, live settings/theme/motion/locale, capabilities, i18n de/en),
data layer (`src/lib/api`: central query keys, per-domain hooks, `useApiMutation` with Idempotency-Key, If-Match/409,
targeted invalidation), realtime client (`src/lib/realtime`: sequence persistence, `?since=`, dedupe, gap backfill,
resync, heartbeat, backoff 0.5–15 s, polling fallback; `applyEvent` covers all 44 event types), orb integration
(`src/features/orb`: OrbSlot, click routing PLAN §21, ≤12 Hz audio), shell with all 16 nav pages + live badges,
command palette with server preview/confirm, overview with 9 panels and all panel states, 15 placeholder module
routes, `/login`, error/not-found/loading, standalone MSW mode (`pnpm --filter @jarvis/web dev:mock`).
Architecture + "how to add a module page": `docs/ARCHITECTURE.md` → Frontend.

Open items from the web hand-off:
1. **Orb too small in the AI-core panel** (lead review): the reference globe fills the panel; make the orb canvas
   ~85–90 % of the panel height and move "JARVIS / AI CORE / version" to a compact strip so it does not shrink the orb.
2. `BottomCommandBar` (`@jarvis/ui`) has no text-input slot → add one; typed commands currently go via the palette.
3. Production build still bundles the mock platform in 2 lazy chunks and ships `mockServiceWorker.js` → exclude in non-mock builds.
4. Typecheck uses `tsconfig.typecheck.json` with a shim `src/shims/jarvis-orb.d.ts` because R3F's global JSX
   augmentation breaks `HudPanel`'s `as` prop; Next's own type check is off. Better fix: make `HudPanel`'s `as` prop
   robust against the augmented JSX namespace, then drop the shim.
5. Mock-data layouts use widget ids `orb`, `attention`, `agents`… but the app uses the canonical ids from
   `config/layouts/jarvis-command-overview.json` → switch mock-data to canonical ids.
6. Command conventions to align with the Control API: voice start = command text "Sprachaufnahme starten",
   focus mode = "Fokus-Modus umschalten" (`src/features/voice/useVoiceUi.ts`); dev login = `dev-<role>` / `dev`.
7. `JarvisOrb` has no ref-based audio input (would remove the 12 Hz cap).
8. Location/weather chips show "—" (no data source in the contract).
9. Only the default scenario was screenshotted; outage/WebGL-failure/reduced-motion scenarios still need visual checks.
   (Old web screenshots were deleted before the GitHub push; regenerate with `apps/web/scripts/screenshot.mjs`.)

### apps/control-api + adapters/mock + apps/mock-console — PARTIAL (typecheck clean, not yet runnable end-to-end)

Done (not yet test-verified): `adapters/mock` (15 port wrappers over MockWorld, `createMockFactories({world})`);
control-api core — generated route table from the bundled OpenAPI (`scripts/generate-route-table.ts` →
`src/http/route-table.generated.ts`, 107 operations), request pipeline (`src/http/pipeline.ts`: correlation, auth,
role matrix, CSRF, query/body validation, If-Match, idempotency, audit, response validation), handlers
(`src/handlers/*`, port-backed ops derived from `PORT_SPEC`; approvals per PLAN §32.5 with `X-Approval-Token`),
decorator-free Nest-on-Fastify app (`src/app.ts`), security headers/CSP/host+origin checks (`src/http/server.ts`),
static web serving with SPA fallback (`src/http/static.ts`), SQLite (migrations, audit hash chain, idempotency,
command history, theme/layout library), realtime hub (`src/realtime/hub.ts`), settings/adapter-settings/core-views
services, `src/main.ts`, `tsup.config.ts`, test helpers + smoke test.

Blocking bug: `POST /auth/login` fails response validation — user ids must match `^usr_[0-9A-Za-z]{26}$`
(currently `user_owner` / `dev-owner`) → use deterministic `usr_` + 26-char ids in `src/security/auth-service.ts`.

Not started: `adapters/mock/test/conformance.test.ts`; all control-api tests beyond the smoke test (107-operation
contract test, auth/CSRF/roles, idempotency, If-Match, approvals incl. tier 3, partial outage, capability missing,
WebSocket, audit chain, secret scan); `apps/mock-console/src/cli.ts`; eslint; tsup build + live verification;
`docs/DEPLOYMENT.md`; Control API chapter in `docs/ARCHITECTURE.md`.

Control-API contract gaps: no `/metrics` or `/telemetry/frontend` route; approval token travels as response header
`X-Approval-Token` (not in contract) and must be sent back by the web client on approve; `?speed=` on playScenario is
an extension; hub sequence ≠ world `ActivityEvent.sequence` in mock mode (needs an injectable sequence provider in
MockWorld); control-plane audit chain (SQLite) is separate from `GET /audit/events`. Dev-auth fallback: missing owner
hash + mock + loopback silently switches to dev auth — production must set `auth.mode: local` + `JARVIS_OWNER_PASSWORD_HASH`.

## Repository layout (complete package)

- `installer/` — the original Windows one-click installer (WSL2 + Hermes Agent + Kimi + local Qwen + voice service
  with speaker verification), added unchanged except for a neutral default persona text in
  `installer/voice/jarvis_voice.py`. Installs to `C:\Jarvis`; services on 127.0.0.1:43691–43694.
- root pnpm monorepo — F.R.I.D.A.Y. Command Center (`apps/`, `packages/`, `adapters/`, `config/`, `docs/`).
- `skills/` — reserved for separate skills (conventions in `skills/README.md`).

Integration tasks (installer ↔ dashboard), to schedule after the dashboard is complete:
- Installer step that deploys the Command Center (Node runtime check, `pnpm install --prod`/prebuilt bundle, config,
  owner password hash, autostart after QA per PLAN §54) — target path to decide: plan says `D:\Jarvis\dashboard`,
  installer uses `C:\Jarvis`.
- Real adapters for the installed services: Hermes (tasks/activity/agents, API on 127.0.0.1:43693), voice service
  status on 127.0.0.1:43694 (see `docs/MAPPING/voice.md`), local Qwen on 127.0.0.1:43692.
- Branding of the installer/voice persona to F.R.I.D.A.Y. (wake word "Hey Jarvis" is trained per user — changing it
  requires new enrollment; decide with the owner).

## Cloud session 2026-10-14 — progress log (lead-verified)

| Unit | Commit | Verification |
|---|---|---|
| Contract `settings.profile.assistantName` (optional, 1..40, no schema default so generated OpenAPI types keep it optional) | `8733b2e`, `717f898` | `contracts:check` green, SDK 218 tests |
| A.0 Branding F.R.I.D.A.Y. (orb labels via `createOrbLabels`, ui brand/bottom-bar props, web `useAssistantName()` + `{assistant}` i18n, config `ui.assistantName`, mock-data texts + canonical layout widget ids → status item 5 done) | `717f898` | typecheck/eslint clean, 514 tests in scope, web static build, screenshot `apps/web/screenshots/branding/` checked against reference |
| B.1 Installer static review: 8 real fixes (robocopy exit code + re-sync, nvidia-smi fallback, py.exe check, corrupt zip removal, key-file ACL order, `IFS= read`, `set -e` FAIL path, shellcheck) | `c3ede6d` | CRLF/BOM preserved, `bash -n`, shellcheck 0.9.0, `py_compile`, PS 7.4 parser 0 errors; findings in `docs/INSTALLER_INTEGRATION_REVIEW.md` |
| B.2 Hermes interface verified from source (commit `0e427d7`) + live instance in VM | `c3ede6d` | `docs/MAPPING/hermes.md` (API 43693 Bearer, dashboard 43691 `X-Hermes-Session-Token`, Kanban CLI/REST/WebSocket); voice/qwen mapping from installer code |

Decisions: contract version stays `1.0.0` (additive, unreleased). Open owner decisions are collected at the end of this file.

In progress: A.1 Control API, A.2 web open items, B.3 adapters (`adapters/hermes`, `adapters/voice-http`, `adapters/system-local`).

## Remaining work (in order)

0. **Branding F.R.I.D.A.Y.** (owner decision 2026-10-14: the product is F.R.I.D.A.Y., successor of J.A.R.V.I.S.;
   repo `rogueki/rogue-friday`). Change all **user-visible** branding to F.R.I.D.A.Y. — brand block/logo text in
   `@jarvis/ui` (`BrandMark`, "JARVIS COMMAND CENTER" → "F.R.I.D.A.Y. COMMAND CENTER"), AI-core caption, orb labels
   and aria sentences (`packages/orb/src/labels.ts`, e.g. "JARVIS WIRD INITIALISIERT" → "F.R.I.D.A.Y. WIRD
   INITIALISIERT", "JARVIS SPRICHT" → "F.R.I.D.A.Y. SPRICHT"), web i18n (`apps/web/src/i18n`), bottom bar
   ("MIT F.R.I.D.A.Y. SPRECHEN"), page titles, mock-data texts, docs. Make the display name a setting
   (`settings.profile`/branding, default "F.R.I.D.A.Y.") so it is changeable without rebuild (PLAN §25.2) — this is a
   contract change: start in `packages/contracts`. **Keep internal identifiers stable** (`@jarvis/*` packages,
   `jarvis.*` event types, `/api/v1`) to avoid a breaking contract change; a full internal rename is a separate,
   explicit decision. Design language (navy/cyan HUD, golden orb) stays as specified.
1. Finish/verify **apps/web foundation** and **control-api + adapters/mock + mock-console** (see hand-offs).
2. **Module pages** (PLAN §28–42), three parallel agents with disjoint routes:
   - A: Tasks (Kanban/List/Timeline/Meine Entscheidungen, DnD capability-gated, detail tabs), Live Activity
     (virtualized, tree, filters, pause/autoscroll, raw JSON admin-only), Approvals, Agents.
   - B: Memory, Notifications & Alerts (escalation view), Mail & Communication, Calendar (day/week/month/agenda),
     Automations (wizard, dry run, run history, pause all).
   - C: Research, Files & Documents (sandboxed preview), Voice (status, metrics, enrollment, test mode),
     System (hardware, services, adapter matrix, actions), Audit & History, Settings (all 14 areas, theme editor,
     orb settings, layout editor, adapter settings generated from JSON Schema, export/import), `/dev/scenarios`
     scenario console.
   Every page: loading/empty/stale/degraded/offline/error states, capability-gated actions, German copy.
3. **Storybook domain stories** for module components (PLAN §46.2) and MSW wiring with `@jarvis/mock-data`.
4. **Playwright**: E2E (navigation, scenario switch, task flow, approval flow, adapter outage, orb states,
   command bar, settings, theme switch, reconnect, 2D fallback), visual regression (orb states, core pages,
   1080p/1440p/4K/tablet, reduced motion, long German text), axe accessibility, performance (10k events, 1k tasks,
   30-min orb soak). PLAN §51–52.
5. **Docs**: `docs/TESTING.md`, `docs/HANDOFF.md` (PLAN §56), complete `docs/ARCHITECTURE.md`, `README.md`.
6. **Acceptance** against PLAN §57 Definition of Done — every checkbox with evidence.
7. **Final verification on Windows** (target platform): `pnpm install`, `pnpm build`, `pnpm start`,
   browser check at http://127.0.0.1:3100.

## Known contract gaps / decisions to revisit

From the mock-platform report:
1. `Service.version` is a software version string, so Service has no If-Match.
2. `AutomationCondition.value` generates as `{[k]: unknown}` but the schema allows any JSON.
3. `ScenarioForceOrbState.mode` is required → the contract cannot release a forced orb (engine supports `null`).
4. `POST /dev/scenarios/{id}/play` has no `speed` parameter (mock accepts `?speed=`).
5. `ScenarioState` has no UI-hint fields; mock exposes `forceOrbFallback2D`/`reducedMotion` in `Meta.features`.
6. No `jarvis.approval.updated` event (request-context re-emits `requested`).
7. Task has no `paused` status (modelled as `waiting` + blocker "Vom Benutzer pausiert").
8. No 504 in OpenAPI; ADAPTER_TIMEOUT/INTERNAL map to 503.
9. No endpoints for research create, voice enroll, file upload → those capabilities default to false.
10. No settings/theme change events (clients refetch).

From the adapter-core report:
- Conformance fault injection is HTTP-only; non-HTTP adapters run static checks + world fault switches.
- Hermes endpoints for tasks/activity/agents are unverified assumptions (`docs/MAPPING/hermes.md`).

## Cloud sessions (claude.ai/code)

- Repo: `github.com/rogueki/rogue-friday` (private). The Claude GitHub App must be installed on it (or `/web-setup`).
- `CLAUDE.md` (project rules) and `.claude/settings.json` (SessionStart hook → `scripts/cloud-setup.sh`: Node ≥ 22.13
  check, `pnpm install --frozen-lockfile` with lockfile-hash skip, Playwright Chromium best-effort) are versioned for
  cloud sessions. Subagents: `.claude/agents/implementer.md` (Sonnet), `.claude/agents/doc-writer.md` (Haiku).
- Cloud usage counts toward the same plan limits as local usage (per Anthropic docs); parallel sessions consume
  limits proportionally.
- Recommended cloud environment: network access "Trusted" (npm registry is allowlisted). If Playwright's browser
  download is blocked, add its download hosts or use the preinstalled Chrome (`channel: "chrome"`).

## Environment notes

- Node ≥ 22.13 (developed on Node 24), pnpm 10, TypeScript ~5.9.3 (not 7 — typescript-eslint needs < 6.1).
- esbuild/@swc/core postinstalls are intentionally not in `onlyBuiltDependencies`.
- Playwright needs `pnpm exec playwright install chromium`; headless WebGL via
  `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`.
- Windows-only quirk of the original dev machine (not relevant on Linux): stray quote in the machine PATH
  required `$env:Path = $env:Path.Replace('"','')` before pnpm scripts.

## Gate commands

```bash
pnpm install
pnpm contracts:check
pnpm typecheck
pnpm lint
pnpm test
pnpm test:conformance
pnpm build
pnpm test:e2e
```

## Open owner decisions (collected, not decided by agents)

1. Wake word "Hey Jarvis" → "Hey Friday" (requires new voice enrollment per user).
2. Rename internal identifiers `@jarvis/*`, `jarvis.*` events, `JARVIS_*` env (breaking contract change).
