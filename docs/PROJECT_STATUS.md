# Project Status & Continuation Guide

**Read this first in every new session** (then `docs/IMPLEMENTATION_CONVENTIONS.md`, then `docs/PLAN.md`).
Last updated: 2026-10-15 (cloud session; Phase A and B complete in the cloud, Windows verification open).

## Goal

F.R.I.D.A.Y. Command Center (successor of J.A.R.V.I.S.; internal identifiers renamed jarvis → friday on 2026-10-15, contract 2.0.0) — adapter-based, contract-first dashboard per `docs/PLAN.md` (binding spec, German).
Owner priorities: (1) the golden holographic orb (`design-references/jarvis_orb_reference.webp`), (2) the
command-center design language of `design-references/jarvis_dashboard_reference.webp`, (3) contract-first +
adapters + full mock mode, (4) transparency of what F.R.I.D.A.Y. does. **Nothing from the plan may be left out.**
The dashboard is for a friend who will install it from GitHub on Windows via `installer/install-friday.bat` (target `C:\Friday\dashboard`, decision in `docs/DEPLOYMENT.md`).

## Working mode

- One lead session orchestrates and reviews; implementation by cheaper subagents (Sonnet/Haiku) with
  strictly separated write scopes; the lead verifies every result (typecheck/tests/screenshots) before committing.
- Visual work is accepted only after the lead has looked at screenshots and compared them with the references.
- Art-direction briefs: `docs/briefs/ORB_BRIEF.md`, `docs/briefs/DASHBOARD_DESIGN_BRIEF.md`.

## Done and verified before the cloud session (local session, committed)

| Area                                                                                                                                                                                         | Path                                                              | Verification                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Monorepo, tooling, CI                                                                                                                                                                        | root, `.github/workflows/ci.yml`                                  | —                                                                                                           |
| Contracts (252 JSON Schemas, OpenAPI 3.1.1 with 122 operations (2026-10-14, was 107), AsyncAPI 3.1.0 with 44 events, 195 examples, codegen, breaking-change gate)                            | `packages/contracts`                                              | `pnpm contracts:check` green                                                                                |
| Generated SDK (types, openapi-fetch client, validator, event map)                                                                                                                            | `packages/generated-sdk` (`@friday/sdk`)                          | typecheck + tests green                                                                                     |
| Config / Auth / Observability                                                                                                                                                                | `packages/config`, `packages/auth`, `packages/observability`      | 119 tests green                                                                                             |
| Design tokens, themes, HUD UI library (all PLAN §24.16 components), Storybook (81 stories, overview composition)                                                                             | `packages/design-tokens`, `packages/ui`, `apps/storybook`         | 36 tests, storybook build, screenshots in `apps/storybook/screenshots/` accepted by lead                    |
| Adapter SDK (15 ports, registry, resilience, health/lifecycle incl. RECOVERING), conformance suite, ExampleTasks HTTP adapter, Hermes/Voice/Mail/Calendar/System placeholders + mapping docs | `packages/adapter-core`, `packages/adapter-testkit`, `adapters/*` | 171 tests + 70 conformance green                                                                            |
| Golden hologram orb (R3F scene, XState machine, all 14 modes, 2D fallback, perf overlay, stories, screenshot harness)                                                                        | `packages/orb`                                                    | 82 tests, browser checks, screenshots in `packages/orb/screenshots/` accepted by lead after 2 review rounds |
| Mock platform (MockWorld for every operation, 4 seed profiles, 14 scenarios, MSW handlers, mock event hub)                                                                                   | `packages/mock-data`                                              | 296 tests green                                                                                             |

## Repository layout (complete package)

- `installer/` — the original Windows one-click installer (WSL2 + Hermes Agent + Kimi + local Qwen + voice service
  with speaker verification), added unchanged except for a neutral default persona text in
  `installer/voice/friday_voice.py`. Installs to `C:\Friday`; services on 127.0.0.1:43691–43694.
- root pnpm monorepo — F.R.I.D.A.Y. Command Center (`apps/`, `packages/`, `adapters/`, `config/`, `docs/`).
- `skills/` — reserved for separate skills (conventions in `skills/README.md`).
- `tests/e2e`, `tests/integration` — Playwright suites; `scripts/fake-upstreams` — fake Hermes/voice/Qwen.

## Cloud session 2026-10-14 — progress log (lead-verified)

| Unit                                                                                                                                                                                                                                  | Commit               | Verification                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract `settings.profile.assistantName` (optional, 1..40, no schema default so generated OpenAPI types keep it optional)                                                                                                            | `f73427c`, `d6f071e` | `contracts:check` green, SDK 218 tests                                                                                                                   |
| A.0 Branding F.R.I.D.A.Y. (orb labels via `createOrbLabels`, ui brand/bottom-bar props, web `useAssistantName()` + `{assistant}` i18n, config `ui.assistantName`, mock-data texts + canonical layout widget ids → status item 5 done) | `d6f071e`            | typecheck/eslint clean, 514 tests in scope, web static build, screenshot `apps/web/screenshots/branding/` checked against reference                      |
| B.1 Installer static review: 8 real fixes (robocopy exit code + re-sync, nvidia-smi fallback, py.exe check, corrupt zip removal, key-file ACL order, `IFS= read`, `set -e` FAIL path, shellcheck)                                     | `e824960`            | CRLF/BOM preserved, `bash -n`, shellcheck 0.9.0, `py_compile`, PS 7.4 parser 0 errors; findings in `docs/INSTALLER_INTEGRATION_REVIEW.md`                |
| B.2 Hermes interface verified from source (commit `0e427d7`) + live instance in VM                                                                                                                                                    | `e824960`            | `docs/MAPPING/hermes.md` (API 43693 Bearer, dashboard 43691 `X-Hermes-Session-Token`, Kanban CLI/REST/WebSocket); voice/qwen mapping from installer code |

| Old operator name removed from all files; operator/account is RogueKI | `0000000` | grep → 0 hits; history rewritten 2026-10-15 (owner decision) |
| B.3 adapters `voice-http` (VoicePort over 43694, read-only, prefers reported `wake_phrase`, default "Hey Friday") and `system-local` (real host metrics, probes Qwen/Hermes/voice/WSL/Control API, models) | `8e7e3f1` | typecheck/eslint, 154 tests, adapted conformance suites against fake upstreams |
| Docs narrative: F.R.I.D.A.Y. as successor generation, "Namen und Bezeichner" section | `199f590` | lead review |
| A.1 Control API complete (usr_ ids, 107-op contract test + 130 API tests, mock conformance 15 categories, mock-console CLI, tsup build, command intents, several bug fixes) | `bd7d21f` | lead: typecheck/eslint, 480 tests in scope, build, live REST + WebSocket + scenario CLI against `dist/main.js` |
| A.2 web: orb ~90 % panel height, text input in command bar, no mock code in prod build, typecheck shim removed (Next type check on), orb audio ref without 12 Hz cap, chips explain missing sources | `f69824d` | lead: 181 tests, prod build grep (no mockServiceWorker/mock code), screenshots `apps/web/screenshots/a2/` reviewed |
| Contract: `X-Approval-Token` request/response headers declared | `cc424a3` | contracts:check, API contract + approval tests |
| B.3 Hermes adapter (`adapters/hermes`: tasks/Kanban, activity, agents; unverified actions capability=false) | `a781a0c` | 179 tests, conformance 10/10 adapters |
| Platform gaps: `/metrics`, `/telemetry/frontend`, global sequence in mock, adapter settings version/If-Match, scenario `release_orb_state`/`play_event`, valid layout JSON, HealthMonitor capability refresh, audit head anchor; fix orb defaults 1 → 70/60 (orb rendered at 1 %) | `b54c73d` | contracts:check (109 ops), API/mock tests, live `/metrics` |
| Installer: assistant name asked before recordings (default Friday / "Hey Friday"), personal wake word for non-Jarvis names, `change-assistant-name.bat` | `119d544` | PS parser 0 errors, CRLF/BOM, py_compile, 12 tests; detection quality only synthetic (mixed), Whisper stage BLOCKED in cloud |
| A.3 module pages: all 16 menus + `/dev/scenarios` | `eee0c03` | typecheck/eslint clean, 354 web tests, static export all routes, screenshots `apps/web/screenshots/modules-*` (WebP) |
| B.5 integration: real adapters wired (allowlist), `file:` secret refs, hybrid/live example configs, fake upstreams, Playwright proof | `fd99c6f`, `6758e51` | `pnpm test:integration` 7/7 (outage + recovery for voice and Hermes) |
| B.4 installer step 15: Command Center deploy (Node LTS, pnpm, `build:app`, hybrid config, owner hash as `file:` secret, task `FRIDAY_Dashboard`, health check) | `f31977c` | PS parser 0 errors, CRLF/BOM; Windows run open |
| Contract completion: 107 → 122 operations (files rename, adapter restart/logs, memory export/conflicts, automation versions, pause-all, drafts list, voice enroll/history delete, task assign/input), MSW approval token | `b48e2d1` | contracts:check, control-api contract test covers all operations |
| Storybook domain stories (15 modules × 10 states, 254 stories, axe audit) + ui a11y polish | `a3b5221` | storybook build, axe over all stories |
| Web: outage vs. not configured vs. missing capability; core tiles per adapter; a11y follow-ups | `5e88eeb` | 415 web tests, screenshots `apps/web/screenshots/followup` |
| Fix: stacked registry/adapter retries (registry retry default 1) | `3801c81` | config/control-api tests |
| Installer: findings I-31..I-38 (voice sync, launcher stop/mutex, step 15 failure path, log rotation, greeting name), watchdog `FRIDAY_Watchdog` via hidden.vbs (no console window) | `b8ac7db`, `a280a85` | PS parser, CRLF/BOM, watchdog decision tests under pwsh |
| Docs: HANDOFF, ARCHITECTURE (Control API, adapters), DEPLOYMENT, TESTING, INSTALLER_INTEGRATION_REVIEW, ACCEPTANCE | `3801c81`, `9d93b09`, `8e72681`, `5cc339e` | lead review |
| Playwright suite (E2E, visual incl. deterministic 3D orb frames, axe, performance) + fixes of every gap it found (/meta UI hints, reduced motion, 404 page, orb test clock §52.1, GPU quality scaling, contrast/button names) | `224910c`, `f7899b3` | 137 → 164 e2e tests green |
| Acceptance gaps: persistent offline cache, mobile 390 px, security checklist §9 with evidence, real mic level voice service → orb | `0a5204b` | 2462 unit tests, new e2e specs; 30-min orb soak passed (heap +0.06 MB/min) |
| Fix: voice outage briefly shown as "Nicht verbunden" (section status) | `7740a19` | integration 7/7 ×4 |
| Phase 7 e2e flows: Live Activity, Agents, Memory, Alerts; memory delete race fixed | `b06517c` | e2e 204/204, unit 2469 |
| Rename jarvis → friday (owner decision 2026-10-15): `@friday/*`, `friday.*` events, `FRIDAY_*` env (legacy `JARVIS_*` still read + deprecation warning), `--friday-*`, `FridayOrb` etc., cookies/metrics/theme+layout ids, `C:\Friday` defaults, Hermes model `friday`; contract 2.0.0 + baseline reset | uncommitted | contracts:check, typecheck, lint, test 2473, conformance 422, build, e2e 204/204 (no visual baseline changed), integration 7/7 |

Decisions: contract version was `1.0.0` (all changes additive, unreleased) until the rename of 2026-10-15 raised it to `2.0.0`. Target path `C:\Friday\dashboard`
(installer-consistent, deviates from PLAN §54 `D:\`). Wake word default "Hey Friday", name chosen at install time
(the name Jarvis keeps the pretrained openWakeWord model, other names use the personal wake word). `main` is fast-forwarded only
with all gates green.

## Current state and remaining work

All gates green on the feature branch and `main` (2026-10-15): `contracts:check` (122 operations), `typecheck`, `lint`,
`pnpm test` (110 files / 2469 tests), `test:conformance` (10 adapters / 422), `build`, `test:e2e` (204 tests, 42.7 min),
`test:integration` (7/7). Acceptance with evidence: `docs/ACCEPTANCE.md`.

Remaining (cannot be done in the cloud):

1. **Real test on a fresh Windows 11 PC** with `installer/install-friday.bat` — step-by-step checklist in
   `docs/INSTALLER_INTEGRATION_REVIEW.md` §5 (what each step must show, URLs, logs under `C:\Friday\logs`).
2. **Real services**: Hermes with a real Kimi key, real voice service + microphone (wake word quality for "Hey Friday",
   audio-level reactivity), local Qwen — adapters are verified against fakes that reproduce the documented behaviour.
3. Owner decisions below.

## Known contract gaps / decisions to revisit

From the mock-platform report:

1. `Service.version` is a software version string, so Service has no If-Match.
2. `AutomationCondition.value` generates as `{[k]: unknown}` but the schema allows any JSON.
3. ~~Releasing a forced orb~~ closed: scenario action `release_orb_state` (`b54c73d`).
4. `POST /dev/scenarios/{id}/play` has no `speed` parameter (mock accepts `?speed=`).
5. UI hints (`forceOrbFallback2D`/`reducedMotion`) travel in `Meta.features`; the Control API passes them through (`f7899b3`).
6. No `friday.approval.updated` event (request-context re-emits `requested`).
7. Task has no `paused` status (modelled as `waiting` + blocker "Vom Benutzer pausiert").
8. No 504 in OpenAPI; ADAPTER_TIMEOUT/INTERNAL map to 503.
9. Voice enroll and file rename now have endpoints (`b48e2d1`); research create and file upload still have none.
10. No settings/theme change events (clients refetch).

From the adapter-core report:

- Conformance fault injection is HTTP-only; non-HTTP adapters run static checks + world fault switches.
- Hermes interface verified from source + live VM instance (`docs/MAPPING/hermes.md`); unverified actions stay capability=false.
- Location/weather chips have no data source in the contract (chips explain it).
- `AdapterHealth` has no `offlineSince`; the UI derives the outage start.

## Cloud sessions (claude.ai/code)

- Repo: `github.com/rogueki/rogue-friday` (public, MIT). Cloud sessions using Claude Code still need their own account sign-in and repository access.
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

## Owner decisions (2026-10-15)

1. Wake word: always asked at install time as a free phrase (1–4 words, default "Hey <Name>"); the personal wake
   word trains on it; the pretrained openWakeWord model only for exactly "Hey Jarvis".
2. Internal identifiers renamed jarvis → friday (`@friday/*`, `friday.*`, `FRIDAY_*`, `--friday-*`; contract 2.0.0).
3. Git history rewritten: the old operator name replaced by RogueKI in authors, messages and file contents;
   `main` and the feature branch force-pushed. Local clones must be re-cloned or hard-reset to `origin/main`.
4. Paths, files and tasks renamed: `C:\Friday`, `installer/install-friday.bat`, tasks `FRIDAY_*`; the installer
   migrates an existing `C:\Jarvis` install (backup kept, foreign tasks disabled only after confirmation).
5. TTS voice stays as is (no trained F.R.I.D.A.Y. voice yet; the original film voice cannot be used — rights of a
   real actress). A free female Piper voice remains an option.
6. Hermes Agent stays unpinned (always the current version).
7. Warning badges and approval hints use a subtle orb gold (relaxes PLAN §24.2; see `docs/DESIGN_SYSTEM.md`).

## Public beta release: Skills and onboarding (2026-10-16)

- The companion `friday-skills` repository contains 106 Friday procedures and a validated setup catalog. The installer clones it into `<InstallRoot>\skills\friday-skills`, registers its skill directory with Hermes and makes the catalog available to the Control API.
- The owner-only Control API exposes the combined Friday/Hermes skill catalog, observed discovery/activation, guarded Hermes toggle and revisioned onboarding. An authenticated read-only API probe of the installed runtime returned 106 Friday and 53 bundled skills. Discovery or activation is not a live provider check.
- The web app provides Skills search, filters, details, account setup guidance and resumable first-owner onboarding. The voice bridge can read the catalog and save confirmed onboarding choices after speaker verification; it cannot toggle skills.
- Targeted contract, API, web, installer and voice checks passed. A full fresh installer run, every provider path and a paid Content Studio job were not run for this beta. See `docs/SKILLS_ONBOARDING_PLAN.md` for scope and remaining limits.
- Repository-wide `pnpm format:check` currently fails on 649 pre-existing files. CI checks commit whitespace instead; formatting debt remains separate from this beta release. ESLint passes with two React Hook warnings in the new Skills pages.
- This entry supersedes the older private-repository and missing-onboarding notes above. GitHub visibility, repository settings and the D: deployment are verified separately at release time.

### Public beta release verification

- Both `rogueki/rogue-friday` and `rogueki/friday-skills` are public GitHub repositories with MIT licenses, updated descriptions/READMEs, secret scanning, push protection, Dependabot security updates, private vulnerability reporting, and protection against force-pushing/deleting `main`.
- A targeted update of the existing `D:\Kali\Friday` installation succeeded. The dashboard and voice status responded with HTTP 200. The authenticated owner API returned HTTP 200 for `/api/v1/skills`: 159 catalog entries, including all 106 Friday Skills and 53 bundled Hermes Skills, with no catalog or Hermes error. Activation is a separate observed field and does not prove skill execution.
- The update exposed and fixed three integration issues: WSL paths for a custom install root during dashboard updates, duplicate complete Friday Skills directories in Hermes configuration, and a cold catalog request exceeding the API's previous 8-second timeout.
- This is a beta acceptance of the installed core and catalog. A fresh-machine install, every external account/provider, paid Content Studio generation, and a spoken end-to-end voice command remain unverified.

### Messaging gateways in the installed beta

- The owner dashboard exposes Telegram and Discord bot settings plus a WhatsApp setup link to the authenticated local Hermes QR flow. The owner settings API returned HTTP 200 for all three gateways after the targeted D: update. The shared Hermes gateway process was running, but all three channels remained unconfigured and the WhatsApp session was absent.
- Bot tokens, allowed sender identities, QR pairing and actual message delivery require the respective provider setup. Friday reports local configuration separately from a verified connection. No provider-backed message was sent or received during this beta acceptance.

### Optional SIP telephony path

- The dashboard source now includes an owner-only Asterisk-SIP setup and a separate call preview, confirmation, journal, status and hangup flow. It checks local ARI reachability, owner endpoint, loaded dialplan and trunk registration before allowing a call request. Asterisk configuration is applied manually; it is not installed by the Friday installer.
- The D: test installation has no Asterisk service or SIP account. No local or external call, remote answer, or Friday voice dialogue over the call has been verified. The Hermes phone skill remains unable to dial autonomously.
