# Project Status & Continuation Guide

**Read this first in every new session** (then `docs/IMPLEMENTATION_CONVENTIONS.md`, then `docs/PLAN.md`).
Last updated: 2026-10-31 (Mock entfernt; Installer-Assistent nur noch mit Klick-Steuerelementen, siehe letzte Abschnitte; physical clean-install drill open).

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

## Skills against the installed CLI (2026-10-23, live)

A real Control API in `dataMode: live` (own data root with `config/install-state.json`, distro `FRIDAY-2`) reads the
CLI inventory over HTTP: `GET /api/v1/skills` returned **159 skills** (53 builtin, 106 external) with origin and trust
as the CLI prints them; `diff`, `inspect` (identifier 2.3 s, bare name 110.6 s), `tap-list` and the refusal texts work,
an unoffered report command is a 400. Seven defects were only visible in that run and are fixed: the origin vocabulary
(`external`), the runner's 35 s limit, two time budgets below the real CLI runtime, the bridge's own 30 s list timeout,
a UTF-8 BOM on stdin, error texts that blamed the distro, and two budgets ordered without slack. Details:
`docs/agent-work/finalization/dash-10-06-skill-verwaltung-live.md`, ledger N-064..N-070.
Still open for DASH-10.06: no hub skill installed on that profile, restart equality, a missing external drive, and the
operator system itself (`FRIDAY_SKILLS_CATALOG_PATH`/dashboard URL unset there, so `catalogError` is reported honestly).

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

## Orb rework: live, audio-reactive orb (2026-10-17/18)

Order: "JARVIS-Orb vollständig beleben und audio-reaktiv machen". Analysis and plan: `docs/ORB_REWORK_ANALYSIS.md`;
specification: `docs/ORB_SPECIFICATION.md`; evidence: `docs/evidence/orb-rework/{before,after,after-package}/`.

- **Real event path (backend):** voice service phases, `friday.voice.tts_started` / `tts_ended`, banded
  `friday.voice.audio_level {direction, level, peak?, low?, mid?, high?}`, immediate orb derivation, `currentAgentName`.
- **`@friday/orb`:** layered `OrbController` (primary interaction / background work / system health / approval,
  priority error > offline > approval > listening > speaking > transcribing > thinking > working > syncing > idle),
  `OrbEventBridge`, Web Audio analyser (fixed dBFS mapping −60 → 0, −12 → 1, noise gate, attack/release),
  service-level source, speech-envelope fallback, demos, degraded-mode visuals, 2D fallback with all layers.
  Orb centred exactly in the panel (offset 0 px), visible fill 72 % of the stage height, no lift/boost.
- **Web:** realtime → orb router, real mic and TTS analysers in `browserAudio.ts`, AI-core status text from the
  controller, dev-only debug panel (`/dev/scenarios`, `/?orbDebug=1`; absent from the production build).
- **Verified (lead, 2026-10-18):** all gates green (`contracts:check`, typecheck, lint, 2877 unit tests,
  conformance, build); orb package 211 tests; E2E with `--ignore-snapshots` 196 passed before the booting fix,
  the remaining orb/booting specs pass after it; orb-layout 13/13 at 1366×768–3840×2160 × 80/100/125 %;
  mic silence/quiet/loud, TTS barge-in, 25 mic cycles without leaks, 2-min soak with a flat heap.
- **Open:** visual baselines (`tests/e2e/__screenshots__`) were produced on GitHub CI and differ from this
  container's font rendering → regenerate the orb/overview baselines on CI and review them (as in #23);
  real-GPU frame times; 30-min soak (`E2E_SOAK=1`); the evidence video is rendered from test-clock frames (2 fps)
  because the Playwright recorder does not work in this container; `syncing` still has no real event source.

## Hermes full integration, wave 2 (2026-10-19/20)

Order: implement the Hermes feature inventory end to end, package by package, with evidence. Plan, inventory, gap
register, evidence per package and the acceptance ledger live in `docs/agent-work/hermes-full-integration/`
(`acceptance-ledger.md` is the authority for what is proven and what is not).

- **Delivered and merged (PR #26, merge commit `f48a2b3`):** the approval-aware native staged-write pipeline (P9
  foundation) plus the action families for tasks (create/update/status/cancel), calendar, mail, messenger, agents
  (pause/resume/stop, task assignment, coding-run stop) and files/knowledge (memory create/update/delete/
  conflict-resolve, file rename/delete). Every direct API write and every German natural-language command stages the
  exact action first (`403 APPROVAL_REQUIRED`, `stage: preview`, `previewId`, German `previewText`), binds the
  confirmation to the unchanged body plus `X-Action-Preview-Id`, and either hands the action to the tier-2 approval UI
  or executes it exactly once with a stable receipt. Replays answer the stored receipt; tampered repeats and drifted
  versions fail 409; guards run before anything is staged.
- **Web:** one `useRunStagedWrite` / `StagedWriteConfirmHost` runner in `apps/web/src/lib/api/stagedWrite.tsx` drives
  tasks, calendar dialog, mail compose, messenger, agents, memory, files and automations — single confirmation host,
  single busy state, single invalidation set.
- **Automation action family (this branch):** create/update/enable/disable/test/pause-all through the same pipeline on
  the direct API and the German command path (pre-staging reference resolution, pause/resume modelled as an update with
  the pinned version), automations page, test panel and command palette on the staged runner. Evidence:
  `p9-automation-actions.md`; ledger row `P9 automation action family`.
- **CI:** Playwright E2E is split into 8 shards with `workers: 1`; all ten CI jobs green on `f48a2b3`
  (run 39360295207). `e2e-shard-repair.md` attributes every spec that broke on the branch to the staged-write change
  set (class b) versus infrastructure flake (class c) and records the fixes. The a11y/navigation palette assumption
  (`a11y.spec.ts:203`, `navigation.spec.ts:67`) was a genuine test-side race — hit entries rank before navigation
  entries — and is fixed with a keyboard-driven `selectPaletteOption` helper instead of an index guess.
- **Verified locally (2026-10-20):** `contracts:check`, `typecheck`, `lint` (0 errors), `pnpm test`
  (245 files / 3368 passed / 61 skipped), `test:conformance` (415 passed / 60 skipped), `build:app`.
- **Still open:** the remaining P9 family (research actions) and NLP-01..06, P7-D/E/F, the P8 field-by-field settings
  matrix and the P10 recovery/runbook acceptances. Real scheduler effects, provider-backed sends, physical
  voice/audio and a fresh-machine install stay **NOT_RUN** — they need a live Hermes instance, real accounts or the
  target hardware, not more local fixtures.
## Hermes integration wave 3 — merged 2026-10-20

PR #28 (`feat/friday-completion-20261020`) merged into `main` as `164a341ff504cc4b93cd6761a9e0aba706fc2ca0`
(2026-10-20T17:00:39Z). It carries the Hermes runtime controls (approval denylist and confirmation policy,
command-approval dry run, browser engine and local routing, cron inventory plus CAS-guarded cron mutations,
MCP OAuth setup and probing, task cancel/retry/stop), spoken research through the native approval pipeline,
source-grounded research drafts, the installed Whisper catalog with cancellable downloads, staged writes for
every action family, and the installer/update payloads that deliver the new voice modules —
`installer/voice/research_voice.py` is in both update scripts and covered by the Pester check.

Verification for the merged state: branch CI run `39453076996` on `1dd1c01` (10/10 jobs, all eight Playwright
shards) and `main` CI run `39462421959` on `164a341` (10/10 jobs). Shard 6 failed once on that branch run
(`settings.spec.ts:17` rename, `tasks.spec.ts:84` task preview) with dbus/SharedImage errors in the log; the
failed-job rerun was green, so it is the known browser/software-GL instability, not a code defect. Local runs
additionally covered `pnpm typecheck`, `pnpm contracts:check`, 12 focused voice/research API tests, the Python
dependency-closure test and the Pester voice-integration script.

Two notes worth keeping in mind:

- The released-operation pin moved from 270 to 271 because the cron mutation and the approval dry run are part
  of this release; `packages/contracts/test/openapi-additions.test.ts` states that origin.
- The two research screenshot baselines were recaptured on the CI runner via the new `capture_baselines`
  dispatch job. 74 of 76 baselines stayed byte-identical; only the two research pages differ because the design
  tokens rely on an `Inter` fallback that no host ships. Their *appearance* is still unreviewed by eye — see
  `docs/agent-work/hermes-full-integration/baseline-verification.md`.

Open, deliberately: the physical clean install (`docs/agent-work/hermes-full-integration/p10-clean-install-drill.md`),
upgrade preservation and rollback, and every acceptance that needs real providers, telephony, cloud speech keys
or voice hardware. Those stay `NOT_RUN` in the acceptance ledger.
Follow-up the same evening: PR #30 (`fix/orb-tts-timing-20261020`) merged as `5c7b969` and `main` CI run
`39494581690` is green. The orb TTS test sampled 2.8 s of analyser output and then expected the orb to still
be speaking; with 4.8 s of queued audio that margin fell below a second on a loaded runner, so the fixture now
queues 7.2 s and the pause window stays where the sampler sees it. Three other red jobs that day were
runner flakes, not code: `settings.spec.ts:17` and `tasks.spec.ts:84` (dbus/SharedImage errors in the log,
green on rerun) and one `durable-memory.test.ts` run that failed with "Credential-bearing Vault edit requires
review" and did not reproduce in 27 local runs of the file, 12 of them with the offending note path
instrumented; the job passed on rerun.
## 2026-10-21 Nachtsession: Distro 1 bereinigt, Neuinstallations-Versuch abgebrochen
- **Distro 1 (Friday-Ubuntu)**: `~/friday-tts` (11 GB Modelle + venv) und `~/jarvis` (44 KB J.A.R.V.I.S.-Altlast)
  gelöscht. `~/.hermes` (3,2 GB) bleibt. Keine FRIDAY-Artefakte mehr in der Distro.
- **Alte Dashboard-Installation (D:\Kali\Friday) stillgelegt**: `main.js` umbenannt, alle node-Prozesse auf
  FRIDAY-Ports (3101/43791–43794) beendet, geplante Aufgaben `FRIDAY_Dashboard`, `FRIDAY_Voice`,
  `FRIDAY_WSL_Keepalive` deaktiviert. Backups liegen unter `D:\backup\friday-20261021-0120` (config, voice,
  logs, 1,1 GB).
- **Neuinstallations-Versuch abgebrochen**: Die neue Distro (FRIDAY-2) und die Verzeichnisse
  `D:\Dokumente\F.R.I.D.A.Y`/`F.R.I.D.A.Y-wsl` wurden wieder entfernt. Der Installer brach mehrfach ab, weil
  der alte Dashboard-Prozess Port 3101 neu startete (Watchdog-ähnlicher Mechanismus außerhalb der Tasks).
  Nach der Deaktivierung läuft der Installer durch — der nächste Anlauf startet sauber mit freien Ports.
- **Offen**: physische Neuinstallation nach Absprache (Drill-Checkliste `p10-clean-install-drill.md`), jetzt
  unterbrochen für Neustart und Nutzerabstimmung. Keine Mock-Provider in der laufenden Installation.
### Nachtrag 2026-10-21: Rückbau abgeschlossen, ohne Sicherung der Altinstallation
`C:\Jarvis` und `D:\Kali\Friday` (je 25,5 GB) sowie `~/friday-tts`, `~/jarvis` und `~/.hermes` in
`Friday-Ubuntu` sind gelöscht; die vier Aufgaben `FRIDAY_Dashboard`, `FRIDAY_Voice`, `FRIDAY_WSL_Keepalive`
und `JARVIS_Qwen` sind entfernt (nicht nur deaktiviert). Auf Wunsch kein Distro-Export und kein
`.hermes`-Archiv — erhalten bleibt nur `D:\backup\friday-20261021-0120` (config, voice-JSONs, Logs; 20,3 MB).
Alle fünf FRIDAY-Ports sind frei, es läuft kein FRIDAY-/JARVIS-Prozess mehr. Die Distro `Friday-Ubuntu`
selbst bleibt bestehen und wird von der Neuinstallation nicht angefasst.

## 2026-10-21 Finalisierungs-Session: Masterplan §8.1 gestartet (BASE-01…04, DASH-01, INS-01, DASH-03 teilweise)

Arbeitsbranch `feat/friday-finalization-20261021` (Basis `e98cbf5`), sieben Commits, nichts gepusht.
Belege liegen vollständig unter `docs/agent-work/finalization/` – `baseline.md`, `inventory.md`,
`requirements.csv` (168 Zeilen), `issue-ledger.csv` (81 Zeilen), `installer-inventory.csv`,
`progress.md`, `contract-freeze.md`, `acceptance-environment.md`, `dash-03-production-path.md`.

- **BASE-01 Basis festhalten – PASS.** Checkout/HEAD/Worktrees, Ist-Runtime `D:\Dokumente\F.R.I.D.A.Y`
  (Distro `FRIDAY-2`, Ports 3101/43791–43795, Hermes 0.22.2, Node 24.13.0, pnpm 10.28.2), Nichtprüfungen
  ausdrücklich notiert.
- **BASE-02 Delta inventarisieren – PASS.** 154 Checklistenpunkte gezählt (141 fett + 13 INS), 0 fehlende
  Master-IDs, 0 Duplikate; jede Zeile mit Quellpfad/Runtime-Consumer/Status.
- **BASE-03 Verträge/Schreibbereiche – PASS.** Zehn geforderte Konzepte auf vorhandene Vertragstypen
  abgebildet (keine neuen DTOs): `IntegrationAccount`, `IntegrationStatus`, `ApplyResult`,
  `SecretStatus`, Job-Familien, `EventEnvelope.sequence`, Cancellation-Routen, `Capabilities`,
  `VoiceStatus`, `install-state.json` als installer-internes Manifest. `pnpm contracts:check` exit 0.
- **BASE-04 Abnahmeumgebung – PASS (Umgebung).** `scripts/finalization/prepare-acceptance-env.ps1` erzeugt
  Snapshot + Rollback-Manifest unter `D:\Dokumente\F.R.I.D.A.Y-acceptance`; 35/35 Dateien hashgleich
  zurückgespielt, drei `PRAGMA integrity_check` = ok, `fresh-target` leer, Live-Installation unberührt.
  Offen: reale Testkonten (BLOCKED_EXTERNAL) und der Fresh-Install-Lauf (INS-13).
- **DASH-01 / INS-01 – PASS.** Vier Inventare revisionsgebunden, I-001–I-062 + FP-01–12 + N-001–006
  vollständig zugeordnet; historische Löschvorgänge I-002/I-037/I-039 nicht als Installationsaufgabe.
- **DASH-03 – teilweise.** Ursache belegt: der Installer lieferte `dataMode: hybrid`, dadurch zehn
  `mock-*`-Adapter und `/api/v1/health` meldete sie als `online` (N-001). Behoben: Installer schreibt
  `live`, neues Modul `installer/lib/data-mode.ps1` migriert bestehende Konfigurationen mit Backup,
  `load.ts` warnt bei Simulationsmodus im Produktionslauf, `adapter-wiring.ts` ignoriert gespeicherte
  Mock-Provider-Wahlen im Live-Betrieb. Neue Tests: `installer/test/data-mode.test.ps1` (grün),
  `adapter-wiring.test.ts` (2 grün), `config.test.ts` 54 grün. **Offen:** Abnahme auf echter
  Neuinstallation (03.04) und Rollback-Drill (03.05).
- **Umgebungsbefund N-007.** `test/voice-research-command.test.ts` löst den Python-Probe relativ zum
  Package-cwd auf (`apps/control-api/installer/...`) und scheitert deshalb auch auf unverändertem Stand;
  einziger roter Test der Control-API-Suite (`--maxWorkers=2`: 1050/1052 grün). Nicht durch diese
  Session verursacht, im Issue-Ledger erfasst.
- **Nächste Schritte in Reihenfolge:** DASH-03.04/03.05 abschließen, dann DASH-04 (Einstellungen zeigen
  echte Adapteridentität und „nicht eingerichtet“ statt Simulation), DASH-07, INS-02.

## 2026-10-22 DASH-03 abgeschlossen, DASH-04 begonnen

- **DASH-03 jetzt PASS** (`dash-03-production-path.md`): `live-empty-sources.test.ts` belegt die frische Runtime im
  Live-Betrieb mit leeren Quellen (nur `tasks`, toter Upstream) — keine `mock-*`-Komponente, `/tasks` liefert Fehler
  oder 0 Einträge, `memory`/`automations`/`communication/channels`/`agents` ≥ 400, `/skills` leer, Neustart erzeugt
  keine Demo-Automation. `scripts/finalization/rollback-drill.ps1` spielt den BASE-04-Snapshot in
  `D:\Dokumente\F.R.I.D.A.Y-acceptance\rollback-drill-20261021-233904` zurück: unverändert hybrid → 19 Komponenten,
  15 simulierte Adapter online; mit `Set-ProductionDataMode` → `live`, 4 Komponenten, 0 Adapter, Health online.
  `dataMode: turbo` bricht den Start mit Exit 2 und klarer Meldung ab. Physischer Installer-Lauf bleibt INS-13.
- **Snapshot erweitert**: `prepare-acceptance-env.ps1` sichert jetzt auch `dashboard\config` (56 Dateien, 48 kopiert,
  0 Abweichungen, 3× SQLite `ok`) — ohne diese Dateien wäre ein Rollback der Dashboard-Konfiguration unmöglich.
- **DASH-04 begonnen** (`dash-04-settings.md`): Die Einstellungsseite existierte bereits vollständig (Master-Detail,
  Deep Links `?area`/`?adapter`, Schemaformular, Draft-Provider, 409-Konflikte, Read-only-Rolle, 87 Tests). Drei echte
  Mängel behoben: „Kalenderansicht verwendet Simulation“ stand auch im Live-Betrieb; Kategorien ohne Adapter waren
  unsichtbar (jetzt „Nicht eingerichtete Bereiche“ aus dem Vertrags-Enum); Bereichs-/Adapterwechsel verwarf Entwürfe
  stillschweigend (jetzt `alertdialog` mit Behalten/Verwerfen/Escape). 5 neue Tests, Settings-Suite 87 grün,
  `pnpm typecheck` und `pnpm lint` grün.
- **Offen in DASH-04**: Browser-Abnahme 390/1024/1920 px + Tastatur über `tests/e2e/settings.spec.ts` (braucht
  `pnpm build:app`), 04.05 Fehlkonfigurations-Isolation, Suche nach Quelle/Status im Skillkonto erst nach DASH-07-Inventar.
- **Nächster Schritt:** e2e-Abnahme DASH-04.04, dann DASH-07.01/.02 (Hermes-Inventar) — INS-02 und der lesende
  Studiovergleich (`../rogue-friday-content-studio`, `fd79ee2`) laufen parallel.

## 2026-10-22 DASH-04.04 Browser-Abnahme und Adapter-Versionsfehler

- **Neue Abnahmespezifikation** `tests/e2e/settings-acceptance.spec.ts` (3 Tests, gruen): zwei Adapter nacheinander
  (`mock-tasks` 111 verworfen, `mock-memory` 333 gespeichert), Entwurf behalten ueber "Hier bleiben", verwerfen ueber
  "Verwerfen und wechseln", `page.reload()` liest 333 zurueck; `dev-viewer` sieht "Nur lesend", deaktiviertes
  Speichern und keine Adapter-Zugangsdaten; 390/1024/1920 px ohne horizontalen Ueberlauf; Tastatur oeffnet den
  Draft-Dialog per Enter und schliesst ihn per Escape. Die 6 bestehenden `settings.spec.ts`-Tests bleiben gruen.
- **Echter Fehler gefunden und behoben**: Das Adapterformular sendete die *Settings*-Version als `If-Match`
  (`AdaptersArea.tsx`), der Server vergleicht aber die Revision des Adapters. Sobald beide Zaehler auseinanderliefen,
  schlug das Speichern mit `409 CONFLICT` fehl, obwohl nichts veraltet war. Jetzt `adapter.version ?? 1`; die alten
  Unit-Erwartungen (`If-Match: 3`) wurden auf die Adapterrevision (`7`) umgestellt.
- **Fixture erweitert**: `cleanWorld` sichert und restauriert jetzt auch alle Adapter ueber
  `PATCH /settings/adapters/{id}` (`restoreAdapters`), weil `adapters` im Settings-Payload nur ein Spiegel ist und
  `PATCH /settings` es mit 422 `additionalProperties` ablehnt.
- **Gruene Nachweise**: 3 neue e2e-Tests, 6 bestehende e2e-Tests, 92 Unit-Tests (`src/features/settings` + `src/i18n`),
  `pnpm typecheck` exit 0, `pnpm lint` 0 Fehler (3 alte Hook-Warnungen). Commit `d03527e`.
- **Weiter offen in DASH-04**: zwei Skills im e2e-Stack (kein Skills-Katalog, Hermes in WSL nicht erreichbar),
  Suche nach Quelle/Status (braucht DASH-07-Inventar), 04.05 Isolations-/Recovery-Drill.
- **Naechster Schritt:** DASH-07.01/.02 (Hermes-Inventar), dann INS-02 ff. nach Masterplan 8.1.

## 2026-10-22 DASH-02 Vertrags- und Durchsetzungsguard

- **Neuer Guard** `apps/control-api/test/authorization-contract.test.ts` (4 Tests, gruen): parst den OpenAPI-Vertrag,
  prueft bekannte Rolle je Operation, Capability fuer jede schreibende Operation (ausser owner-only und
  Auth-/Telemetrie-/Dev-Routen) und vergleicht alle 271 Operationen mit der generierten Route-Tabelle
  (Methode, Pfad, Rolle, Capability) — 0 Abweichungen. Damit ist die Rollen-/Capability-Durchsetzung bei jedem
  Testlauf erzwungen statt nur dokumentiert.
- **Vertragsumfang**: 271 Operationen (151 schreibend), Rollen 163 owner / 62 viewer / 44 operator / 2 none,
  236 mit Capability. Details in `docs/agent-work/finalization/dash-02-contracts.md`.
- **Ergebnis-Matrix** (Erfolg, Konflikt, 403/Capability, Timeout, unbekannter Ausgang, idempotente Wiederholung
  inkl. Neustart) auf bestehende Tests abgebildet und frisch ausgefuehrt: 176 Tests in 10 Dateien gruen;
  `pnpm contracts:check`, `pnpm typecheck` exit 0, `pnpm lint` 0 Fehler.
- **Weiter offen**: 02.03 Sprach-/UI-Paritaet mit Rueckleseprobe je Feld (KEEP-04), 02.04 Migrationsdrill mit
  Konten/Entwuerfen/Enrollment, 02.05 kontrolliertes Lesen der alten Vertragsversion.

## 2026-10-22 DASH-07.01/.02 Hermes-Inventar live erfasst

- **Live-Inventar** (`docs/agent-work/finalization/dash-07-hermes-inventory.md`): Hermes Agent v0.22.2
  (local d923a5eb487a), Configschema 50, 232 Provider / 9168 Modelle, 58 Skills in 12 Kategorien, 3 aktive
  Plugins (friday-dashboard-calendar/-mail, friday-memory), Gateway als systemd-Service aktiv, 1 Session,
  keine Cronjobs, leere Fallback-Kette, Modell `k3` ueber `kimi-coding`.
- **Paritaetsmatrix**: alle 18 Zeilen des alten `PLAN_DASHBOARD_HERMES_PARITY.md` zugeordnet; Friday-Flaeche sind
  11 Hermes-Vertragsoperationen und 82 typisierte Felder in `HERMES_CONFIG_FIELDS` (execution 42, operations 18,
  agent 16, models 5, extensions 1). Luecken fuer 07.03/07.04 ausdruecklich benannt: Customendpoints,
  Provider-Keys jenseits der drei vorhandenen, Pool-Limits/`hermes auth`, `memory.*`, lokale Modelle,
  Session-Verwaltung, Kanban.
- **Neues Issue N-008**: die einzige Inferenz-Credential (`kimi-coding`, `KIMI_API_KEY`) meldet zuletzt
  `auth failed permission_error (403)`, waehrend `hermes auth status` „logged in" sagt. Ein Erfolgsnachweis fuer
  den KI-Zugang braucht einen echten Modellaufruf; das ist DASH-07.05, nicht der Inventarschritt.
- **Planstand**: DASH-07.01 und 07.02 abgehakt; naechster Schritt DASH-07.03 (KI-Zugang: Provider/Keys,
  Customendpoints, lokale Modelle, Gedaechtnis-Felder).

## 2026-10-22 INS-02 Installer-I/O-Vertrag, Promptinventur und KI-Zugang

- **Vertrag eingefroren** (`docs/agent-work/finalization/ins-02-installer-io.md`): Transportprotokoll 1 mit
  28 Antworten und 7 Geheimnissen, Ereignisvertrag der GUI (Schritt-/`[GUI]`/`[OK]`/`[FEHLER]`-Zeilen, Exitcodes
  0/1/10), Zustandsvertrag von `install-state.json` und die Schrittmenge der Zustandsmaschine.
- **Promptinventur vollstaendig**: 19 `Read-Host`-Stellen in `install-friday.ps1`, jede an eine GUI-Route
  gebunden; `Ask`/`Choose`/`YesNo` werfen bei unbekanntem Fragetext statt auf stdin zurueckzufallen.
- **Echte Luecke gefunden und behoben (N-009)**: der Assistent fragte den Anbieter nicht ab und setzte in
  GUI-Laeufen still `kimi-coding`/`k3`. Neuer Reiter **KI-Zugang** mit `providerChoice`, `modelBaseUrl`,
  `modelName`, `openaiKey`, `anthropicKey`, `customKey` (Felder passend zur Auswahl aktiv), Transport-,
  Redaktions- und Aufraeumlisten erweitert; der stille Standard ist durch einen klaren Abbruch ersetzt.
- **Ausfuehrbarer Waechter**: `installer/tests/installer-io-contract.Tests.ps1` (neu, gruen) prueft per AST, dass
  jeder gefragte Schluessel im Transport existiert, kein `Read-Host` ungeschuetzt ist und kein interaktiver
  Python-Prompt ausserhalb der Aufnahmeprotokolle liegt — Ausgabe `28 answers, 7 secrets, 19 guarded prompts`.
- **Renderprobe**: `gui-installer.Tests.ps1` gruen mit acht Reitern, DPAPI-Rundlauf und den Exitcodes 0/1/10;
  alle uebrigen Installer-Testskripte ebenfalls gruen.
- **Naechster Schritt**: INS-03 (echte Auth-Pruefung fuer OpenAI/Anthropic/Kimi/Custom, OAuth-Ablehnung und
  Timeout, Konfiguration transaktional erhalten) — der Vertrag steht, die fachliche Pruefung fehlt noch.

## 2026-10-22 INS-03 (Teil) Anbieterfaehigkeiten aus dem installierten Hermes

- **Neue Sonde** `installer/wsl/hermes_provider_auth.py` mit Bridge-Aufruf `provider-auth`: Picker-Mitgliedschaft,
  Authart, Env-Variablen und Key-Praefixe kommen aus Hermes 0.22.2 statt aus Installer-Annahmen. 7 Unit-Tests und
  43 Bridge-Tests gruen.
- **Befund**: `normalize_provider("openai")` ergibt `openrouter`, `"kimi-coding"` ergibt `kimi-for-coding`; die
  Version kennt nur `openrouter` als Key-Praefix. Deshalb schreibt der Installer jetzt den Katalognamen
  `openai-api` und `setup_hermes.sh` lehnt Anbieter ab, die nicht als API-Key-Anbieter im Katalog stehen
  (OAuth-Anbieter sichtbar gesperrt statt halb eingerichtet).
- **Offen**: echte Anmeldung/Modellaufruf je Anbieter, OAuth-Erfolg/Ablehnung/Timeout, Key-Ablage fuer
  `kimi-coding`/`custom` im Credential-Pool statt `.env`; N-008 (403) unveraendert.

## 2026-10-22 INS-04 (Teil) Drei Stimmen und geprueftes Referenzaudio

- **N-011 behoben**: der Assistent kannte zwei Stimmen, der Installer drei — die eigene MP3/WAV war ueber die
  Oberflaeche unerreichbar. Jetzt drei Optionen im GUI mit Pflichtfeldpruefung, und `Test-VoiceReferenceFile`
  prueft im Backend den Dateiinhalt (RIFF/WAVE-Kopf bzw. MP3-Sync, Dauer 1–120 s, Endung) in beiden Zweigen.
- **Nachweis**: `voice-reference.Tests.ps1` mit echten Dateien (gueltig, leer, beschaedigt, zu kurz, fremde Endung,
  fehlend) gruen; GUI- und I/O-Vertragstests unveraendert gruen. Referenzaudio der laufenden Installation
  ausgemessen: 9,25 s / 9,56 s bei 24 kHz, Peak 9340 / 22656.
- **Offen**: Hoerprobe am Ausgabegeraet (TTS-Dienst laeuft auf Windows, Anfrageformat undokumentiert), Kopplung
  Persona/Wake beim Stimmenwechsel, echter ElevenLabs-Aufruf.

## 2026-10-22 INS-05 (Teil) Laufkennung, Stillstandsmeldung und Transportfix

- **N-012 behoben**: das Backend lehnte `voiceChoice=3` ab, obwohl die Oberflaeche die eigene MP3/WAV anbietet —
  die dritte Stimme war ueber den echten Transport unbenutzbar. Jetzt `1,2,3` (Transporttest: 3 angenommen, 4
  abgelehnt).
- **Laufkennung**: jeder Start erzeugt eine 12-stellige Kennung, gibt sie als `FRIDAY_INSTALL_RUN` an den
  Kindprozess und schreibt sie ins Protokoll; das Backend meldet `[GUI] Lauf <id>`.
- **Stillstandsmeldung**: nach 15 Minuten ohne Ausgabe ein einmaliger Hinweis, bewusst ohne Abbruch.
- **Nachweis**: `gui-run-tracker.Tests.ps1` gruen; GUI-, I/O-Vertrags- und Stimmtests ebenfalls gruen.
- **Offen**: strukturierte Ereignisse (Protokoll 2) und harte Zeitlimits je Schritt.

## 2026-10-22 INS-04 Korrektur: eigene Stimme vorerst zurueckgezogen

- **N-013 behoben**: die Dateipruefung akzeptierte 1–120 s, `voice_setup.py` verlangt 3–30 s. Grenze
  vereinheitlicht; eine 45-s-Datei wird jetzt sofort mit Begruendung abgelehnt statt nach den Downloads.
- **N-014 gefunden und entschaerft**: die eigene MP3/WAV belegte den weiblichen Stimmplatz und wurde als
  `voice_reference_friday-female` gespeichert — ein Zurueckwechseln auf F.R.I.D.A.Y. haette die eigene Aufnahme
  geliefert. Die Oberflaeche bietet die Option wieder nur mit den zwei Stimmen an, die die Ausgabekette kennt; die
  eigene Referenz wird getrennt als `voice_reference_own` gespeichert. Vollstaendig wird die Option erst, wenn
  `voice_persona`, `server.py`, `prepare_voice_pairs.py`, `update-voice-personas.ps1`, `friday_voice.py` und das
  Dashboard dieselbe dritte Kennung kennen.
- **Nachweis**: `voice-reference.Tests.ps1`, `gui-run-tracker.Tests.ps1`, `gui-installer.Tests.ps1` und
  `installer-io-contract.Tests.ps1` gruen.

## 2026-10-22 INS-06 (Teil) Installationszustand wird atomar geschrieben

- **N-015 behoben**: `Save-State` schrieb `install-state.json` direkt; ein Abbruch mitten im Schreiben haette eine
  halbe JSON-Datei hinterlassen und damit Fortschritt (`done[]`) und Entscheidungen gekostet. Jetzt `.tmp` plus
  `[IO.File]::Replace` mit Rueckfallebene, Zielverzeichnis wird angelegt.
- **Nachweis**: `installer/tests/state-atomic.Tests.ps1` (neu) prueft vollstaendigen Inhalt, Ersetzen statt
  Anhaengen und das Fehlen von Restdateien.
- **Offen**: Mutex gegen Parallellauf, Konflikte mit der geplanten Aufgabe, Ruecksetzen halb erledigter Schritte.

## 2026-10-22 INS-06 (Teil) Installer-Einzelinstanz und Zustandssicherung

- **N-016 behoben**: `install-friday.ps1` hatte keine eigene Sperre; belegt war nur ein Kommentar, der den
  Launchern Mutexe zuschrieb (die Dienst-Launcher halten tatsaechlich `Local\FRIDAY_*Launcher`, der Installer
  selbst keinen). Zwei Laeufe (Assistent und geplante Aufgabe oder ein zweiter Doppelklick) konnten den Zustand
  abwechselnd ersetzen - die Schrittmarken vermischten sich, der letzte Lauf gewann.
  Neu: `installer/lib/installer-lock.ps1` mit benanntem Mutex `Global\FRIDAY-Installer` (2 s Warteversuch,
  Fallback `Local\` ohne Global-Privileg), Sperrdatei `run\installer.lock.json` mit PID, Startzeit,
  Laufkennung, Art und InstallRoot, Stale-Erkennung ueber PID **und** Startzeit (PID-Reuse), Exitcode 20 fuer den
  zweiten Start, GUI-Meldung fuer 20, Freigabe in `Stop-Install`, am regulaeren Ende und per
  `PowerShell.Exiting`-Ereignis.
- **N-017 behoben**: eine unlesbare `install-state.json` lief ungeschuetzt durch `ConvertFrom-Json`; je nach
  Schaeden kam ein Fehlerabbruch oder ein Zustand ohne `done[]` - also ein Neustart von vorn - heraus.
  Neu: `install-state.json.bak` nach jedem erfolgreichen Speichern, `Read-InstallerState`/`Import-InstallerState`
  mit struktureller Pruefung, Wiederherstellung aus der Sicherung mit Meldung, sonst Abbruch mit Klartext.
- **Nachweis**: `installer/tests/installer-lock.Tests.ps1` (zwei echte Prozesse, PID-Reuse, Verdrahtung),
  `installer/tests/installer-single-instance.Tests.ps1` (echter Einstiegspunkt mit Halter-Prozess und
  InstallRoot mit Leerzeichen/Umlaut: Exitcode 20, keine Aenderung; ohne Halter kein Fehlalarm) und
  `installer/tests/state-recovery.Tests.ps1` (Wiederherstellung und Abbruchpfad). 15/15 Installer-Tests Exit 0.
  Negativkontrolle ohne `WaitOne` laesst beide Prozesse gleichzeitig arbeiten - der Test ist nicht leer.
- **Offen in INS-06**: Fortsetzung mit identischer Distro/Location als echter Lauf, Konflikt mit der geplanten
  Aufgabe `FRIDAY_Installation_fortsetzen`, Wiederholbarkeit jedes halb erledigten Schritts, systematische
  Parameterquotierung.
- **N-018 behoben** (gefunden beim Ausfuehren von `resume.bat` auf einem Pfad mit Umlaut): der Fortsetzungsbefehl
  wurde mit `[Text.Encoding]::Default` (Windows-1252) geschrieben, cmd liest Batchdateien aber in der
  Konsolencodepage. Der Umlaut im Zielpfad wurde verstuemmelt, der Befehl fand `install-state.json` nicht und
  landete in der Pruefung fuer eine frische Installation. Jetzt `chcp 65001` plus UTF-8 ohne BOM; der Test fuehrt
  `resume.bat` aus und belegt, dass der Zustand wieder gefunden wird.
- **N-019 behoben**: `$Distro`/`$DistroLocation` wurden erst nach der Widerspruchspruefung aus dem Zustand
  uebernommen. Ein Abbruch davor (etwa widersprechende `-DistroName`) schrieb `-DistroName "Ubuntu"` in
  `resume.bat` - genau die Umleitung auf die Standarddistribution, die INS-06 ausschliesst. Die Uebernahme steht
  jetzt am Anfang des Custom-Root-Blocks.
- **Nachweis (Fortsetzung)**: `installer/tests/installer-resume-distro.Tests.ps1` (neu) belegt am echten
  Einstiegspunkt: Fortsetzung ohne `-DistroName` uebernimmt Distribution und Ablageort aus dem Zustand,
  widersprechende Angaben brechen mit Klartext ab, der Zustand bleibt unveraendert, und `resume.bat` zitiert den
  Pfad mit Leerzeichen und Umlaut und laeuft in dieser Form (findet den Zustand wieder). 16/16 Installer-Tests
  Exit 0.- **N-020 behoben (eigene Regression aus N-016)**: Die Sperrdatei liegt unter `<Root>\run` und entstand vor der
  Pruefung "der frische InstallRoot ist nicht leer". Damit haette jeder frische eigene Zielordner die Meldung
  "nicht leer" bekommen - eine Erstanlage waere unmoeglich gewesen. Die Leerpruefung sitzt jetzt in
  `Test-FreshRootEmpty` und ignoriert ausschliesslich ein `run`-Verzeichnis, das nur die eigene
  `installer.lock.json` enthaelt; jede andere Datei zaehlt weiter als belegt.
- **Nachweis (frische Wurzel)**: `installer/tests/fresh-root.Tests.ps1` (neu) prueft sechs Faelle der Funktion
  (fehlend, leer, nur Sperrdatei, fremde Datei in `run`, fremde Datei im Root, Datei namens `run`) und faehrt den
  echten Einstiegspunkt mit leerem Zielordner samt Umlaut an: der Lauf scheitert nicht an "nicht leer", sondern
  an der naechsten Pruefung (Ablageort im Zielordner). 17/17 Installer-Tests Exit 0.
## 2026-10-22 INS-07 (Teil) Kooperativer Abbruch

- **N-021 behoben**: das GUI-`FormClosing` beendete den Lauf sofort mit `taskkill /T /F` und wartete nur 5 s.
  `/T` riss den gesamten Baum mit (wsl.exe, pip, pnpm, Dienststarter), halbe Artefakte blieben liegen, und der
  Installer konnte selbst nicht aufräumen. Neu: `installer/lib/installer-cancel.ps1` schreibt eine Abbruchbitte
  mit Laufkennung nach `<Root>\run\installer.cancel`; der Installer prüft sie an jeder Schrittgrenze (15 Blöcke)
  und vor jedem Unterprozess (`Native`, `Invoke-Pip`, `Download`) und bricht über den normalen Ausgang ab
  (Sperre und Aktivmarkierung weg, Zustand bleibt, `resume.bat` verweist auf den Fortschritt). Die GUI bittet
  zuerst, wartet bis zu 25 s und beendet erst dann hart — mit Protokolleintrag.
- **Nur die eigene Laufkennung zählt**: eine liegen gebliebene Bitte aus einem abgestürzten Lauf beendet keinen
  neuen Lauf (PIDs wiederholen sich, Laufkennungen nicht).
- **Nachweis**: `installer/tests/installer-cancel.Tests.ps1` (neu) prüft Modulverhalten, `Confirm-NotCancelled`
  per AST mit Stub-`Stop-Install`, die Vollständigkeit aller 15 Schrittblöcke und der drei Unterprozess-Runner,
  die GUI-Verdrahtung (kein `taskkill` mehr im `FormClosing`, Reihenfolge Bitte → Warten → Beenden) und am
  echten Einstiegspunkt: passende Bitte vor dem Start → Exitcode 1, `[ABBRUCH]`, kein `resume.bat`, keine
  Schrittarbeit; fremde Laufkennung → Lauf ignoriert sie und endet an der erwarteten Prüfung. 18/18
  Installer-Tests Exit 0.
- **Offen**: gezielte Unterprozessverwaltung (Job-Objekte statt Baum-Kill), Abbruch mitten in einem echten
  Download/pip-Lauf, systematische Prüfung unvollständiger Artefakte beim Resume.
## 2026-10-22 INS-05 (Teil) Ereignisstrom Protokoll 2

- **N-022 behoben**: Der Fortschritt der GUI hing an Textmustern (`^\s*Schritt \d+|\[GUI\]|\[FEHLER\]|\[OK\]`), und
  der stderr-Strom ging am Zeilenleser vorbei direkt ins Protokoll. Zeilenfragmente, Fremdausgaben von pip/curl/pnpm
  und mehrzeilige Werte konnten den Status verfaelschen; Download, Paketinstallation und Schritt waren nicht
  unterscheidbar. Neu: `installer/lib/gui-protocol.ps1` mit Protokoll 2 — je eine Zeile
  `[FRIDAY-EVENT]{"v":2,"type":…}`, geschrieben nur im GUI-Lauf. Der Installer meldet `run`, `step start/done`
  (alle 15 Schritte ueber `Enter-Step` und `MarkDone`), `download start/done/failed` und `pip start`.
- **Rueckweg bleibt konservativ**: unbekannte Version, kaputtes JSON, fehlende Felder, Zeilenfragmente und Klartext
  werden als Text angezeigt, nie still verschluckt und nie geraten. Die GUI erzeugt Anzeigetexte nur aus Feldern
  und rechnet keine Prozentwerte aus Text; beide Ausgabestroeme laufen ueber `Receive-BackendLine`.
- **Nachweis**: `installer/tests/gui-protocol.Tests.ps1` (neu) prueft Erzeugung und Rueckweg inklusive Umlauten,
  Quotes und Backslash, neun Gegenfaelle (Klartext, leer, Praefix ohne JSON, kaputtes JSON, Zeilenfragment,
  unbekannte Version, fehlende Version, Version als Text, JSON ohne Objekt), die Vollstaendigkeit und
  Namensgleichheit aller 15 Schrittbloecke, beide GUI-Stroeme und am echten Einstiegspunkt ein lesbares
  Laufereignis mit Kennung und Modus. 19/19 Installer-Tests Exit 0.
- **Offen**: harte Zeitlimits pro Schritt, explizites Abschlussereignis mit Exitcode, eigener Ereignistyp fuer den
  Modell-Warmup, Lastfall mit Paketspam.
## 2026-10-22 INS-05/INS-07 (Teil) Ueberwachte Unterprozesse

- **N-023 behoben**: `Download` rief `curl.exe` ohne Zeitlimit und ohne Abbruchpruefung auf; `Invoke-Pip` pollte bis
  120 Minuten ohne Abbruchweg, und der einzige Notausstieg war `taskkill /T /F` (Baum-Kill). Neu:
  `installer/lib/process-supervisor.ps1` mit `ConvertTo-WindowsArgument` (CreateProcess-Quotierung) und
  `Invoke-SupervisedProcess` (Start ueber `ProcessStartInfo`, Polling, hartes Zeitlimit, Abbruchpruefung, gezieltes
  `Stop-Process -Id` **nur** des gestarteten Prozesses, Exitcode erst nach abgeschlossenem `WaitForExit`).
- **Verdrahtung**: `Download` laeuft ueber den Supervisor (`$script:DownloadTimeoutSeconds = 3600`,
  `CancelCheck` gegen die Abbruchbitte, Warnung bei Zeitlimit, Fortsetzen ueber `curl -C -`); `Invoke-Pip` beendet
  bei Abbruch gezielt `cmd.exe` statt des ganzen Baums. Bewusst keine Streamumleitung: `Start-Process -PassThru`
  liefert in PowerShell 5.1 mit Umleitung keinen Exitcode (reproduziert).
- **Nachweis**: `installer/tests/process-supervisor.Tests.ps1` (neu) prueft die Quotierung durch einen echten
  Kindprozess (Leerzeichen, Umlaut, Anfuehrungszeichen, abschliessender Backslash), Exitcode 7, hartes Zeitlimit
  (eigener Prozess weg, fremder Bruderprozess lebt weiter), Abbruch waehrend des Laufs (dito) und die Verdrahtung
  in Download und Invoke-Pip. 20/20 Installer-Tests Exit 0.
- **Offen**: keine Job-Objekte (Nachfahren von `cmd.exe` koennen kurz weiterlaufen), `wsl.exe`-Aufrufe nicht
  ueberwacht, Modell-Warmup und Dashboardwechsel nicht einzeln mit Zeitlimit belegt, Lastfall Paketspam.
## 2026-10-22 INS-05 (Teil) Abschluss- und Warmup-Ereignisse

- **N-024 behoben**: Der Ereignisstrom endete ohne Abschlussereignis, und der Modellstart lief als anonymer Teil
  des Schritts `qwen`. Die GUI konnte damit den Ausgang eines Laufs nur am Prozessexit ablesen und einen langsamen
  Modellstart nicht von einem haengenden Schritt unterscheiden. Neu: `Write-GuiRunDone($Code,$State)` schreibt
  **genau ein** `run`-Ereignis mit `state` und `exitCode` (Einmal-Garantie ueber `$script:GuiRunDoneWritten`),
  aufgerufen in `Stop-Install` (`failed`, Code 1) und am normalen Ende (`ok`, Code 0 bzw. 1 wenn die
  Dashboardpruefung fehlschlaegt). Der Qwen-Start meldet `warmup start/done` (mit Sekunden) um die
  Bereitschaftspruefung herum.
- **GUI**: kennt `warmup` und `run` als Anzeigetypen, merkt sich `$script:sawRunDone` und schreibt beim Prozessende
  `[HINWEIS] Der Installer hat kein Abschlussereignis gesendet; massgeblich ist der Exitcode.` - ein fehlendes
  Abschlussereignis wird benannt, aber nicht als Erfolg oder Misserfolg umgedeutet.
- **Nachweis**: `installer/tests/gui-protocol.Tests.ps1` prueft die Einmal-Garantie (zwei Aufrufe, eine Zeile,
  erste gewinnt), die Meldung in `Stop-Install` und am Laufende, die Lage der Warmup-Ereignisse um
  `start-qwen-server` und `Wait-Http` (nur im Qwen-Schritt) und im echten Einstiegspunkt genau ein
  Abschlussereignis mit `state=failed`, `exitCode=1`. 20/20 Installer-Tests Exit 0.
- **Offen**: Abschlussereignis fuer den Fall "Prozess abgestuerzt, ohne Ereignis" ist bewusst nur ein Hinweis
  (kein zweiter Kanal); TTS-/Voice-Service-Warmup meldet noch kein eigenes Ereignis; Lastfall Paketspam.
## 2026-10-22 INS-05 (Teil 4) Voice-Warmup und Lastfall

- **N-025 behoben**: Der Sprachdienst meldete seine Ladezeit (bis zu 3 Minuten) nur als Textzeile, und der
  Ereignisleser war nie mit Paketspam konfrontiert. Neu: Schritt 14 meldet `warmup start/done` fuer den Dienst
  `voice` (mit Sekunden) um die Bereitschaftspruefung (`state -eq 'listening'`) herum - dieselbe Form wie beim
  Qwen-Start, damit beide Ladephasen in der GUI getrennt sichtbar sind.
- **Lastfall**: `gui-protocol.Tests.ps1` schickt 10 000 gemischte Zeilen durch `ConvertFrom-GuiEventLine`
  (2 500 Ereignisse mit Umlauten, 2 500 Klartextzeilen, 2 500 Zeilen mit unbekannter Version, 2 500 leere Zeilen).
  Ergebnis: 2 500 Ereignisse und 7 500 Textzeilen korrekt getrennt, Laufzeit 0,68 s. Kein Verschlucken, kein
  Umschalten auf Ereignis bei unbekannter Version.
- **Offen**: Die tatsaechliche Reaktionsfaehigkeit der Fensteroberflaeche unter dieser Last ist headless nicht
  belegbar (dafuer braucht es eine interaktive Sitzung); `wsl.exe`-Aufrufe haben weiterhin kein Zeitlimit.
## 2026-10-22 INS-04 (Teil 2) Stimm-Endpunkt und Persona-Update kennen den dritten Platz

- **N-026 (Fortsetzung)**: Der Endpunkt `/control/voice` prueft die erlaubten Stimmen gegen eine eigene
  Zwei-Werte-Liste statt gegen `voice_persona.CHOICES`; ein dritter Platz waere dort mit HTTP 400 abgewiesen
  worden, obwohl die Persona-Ebene ihn kennt. Jetzt ist `CHOICES` die einzige Quelle.
- `update-voice-personas.ps1` sichert und erneuert zusaetzlich `custom-streaming.wav` und
  `custom-reference.txt`, damit ein Stimmen-Update eine eigene Aufnahme nicht verwirft.
- **Nachweis**: `dashboard-update-voice-integration.Tests.ps1` und `dashboard-update-progress.Tests.ps1` gruen,
  Installer-Suite 20/20, Persona-Tests 8/8. Unbekannte Stimmen liefern weiterhin 400 (unveraendertes Verhalten).
- **Offen**: Installer-Abbildung Option 3 -> `custom` (Zeilen 1329-1357, 1950), `voice_setup.py` (Zeilen 20, 108,
  127) und die Dashboard-Stimmenliste; danach die messbare Audioausgabe.
## 2026-10-22 INS-09 Grafische Stimmaufnahme im Assistenten

- **N-037 (neu)**: Die Aufnahme lief bisher in eigenen Dialogfenstern (`askokcancel` je Sample) bzw. auf der
  Konsole; Aufforderung, Fortschritt, Wiederholung und Abbruch waren im Assistenten nicht sichtbar, und eine
  zweite Aufnahme ueberschrieb das alte Profil ohne Sicherung.
- Aufnahme und Assistent sprechen jetzt ueber zwei Dateien im Lauf-Ordner (`gui-interaction.json` und
  `.response`, atomar geschrieben, Kennung muss passen, Aktionen `ok`/`replay`/`skip`/`cancel`). Die Aufnahme
  fragt zuerst die Datei, dann (Rueckfall) Dialog bzw. Konsole; `replay` spielt die letzte WAV erneut,
  `cancel` beendet mit Exitcode 2. Der Assistent zeigt eine eigene Aufnahmenseite mit Fortschritt
  ("Aufnahme 3 von 44") und den drei Aktionen; "Abbrechen" beantwortet die Anfrage.
- Vor jeder Aufnahme sichert `voice-profile-backup.ps1` das Profil mit Pruefsummen-Manifest; die
  Wiederherstellung prueft jede Datei und schreibt nur fehlerfreie Sicherungen zurueck.
- **Nachweis**: `gui-interaction.Tests.ps1` 34 Zusicherungen (inkl. Python-Gegenstelle und drei Gegenproben),
  `test_gui_interaction.py` 9, `voice-profile-backup.Tests.ps1` 25, Selbsttest des Assistenten
  `interaction=visible:True ok:True` in `gui-wizard-pages.Tests.ps1` (108), Installer-Suite 32/32 Exit 0.
- **Offen**: echte Aufnahme mit Mikrofon/Headset (hoerbarer Start, vollstaendiger Durchlauf, erzeugte Modelle
  und Embeddings, Wake-Phrase gegen die Metadaten). Der Sprechergrenzwert bleibt unveraendert.
## 2026-10-22 DASH-05.01/05.02 Kanalleiste und integrierte Postfaecher

- Die Kommunikation zeigt genau sechs Navigationseintraege in fester Reihenfolge: Alle Kanaele, E-Mail Postfach,
  Telegram, WhatsApp, Telefon, Discord. SMS und weitere Kanaele bleiben als Daten und unter Einstellungen
  konfigurierbar, erscheinen aber nicht als Filter; ein Hinweis benennt das.
- Mail-Postfach und Messenger-Schritt stehen nicht mehr global ueber der Seite, sondern nur im jeweils gewaehlten
  Kanal: Postfach bei E-Mail, Nachrichtenformular bei Telegram/WhatsApp/Discord, ohne Auswahl keines von beiden.
  Titel sind "E-Mail Postfach" und "Nachricht ueber den gewaehlten Kanal".
- Vertrag: `ChannelKind` additiv um `discord` erweitert (`packages/contracts` -> `pnpm contracts:generate`),
  danach `contracts:check` mit lint/validate/check-generated/breaking gruen. Keine Werte entfernt.
- Mock-Seed: E-Mail-Kanal heisst "E-Mail Postfach", Discord-Kanal neu (nicht konfiguriert), SMS bleibt erhalten.
- **Nachweis**: `channelList.test.ts` (4), `communication.test.tsx` (20, davon 2 neu), volle Laeufe web 81/648 und
  node 191/2789 gruen, `tsc` 0 Fehler, `pnpm build:app` 0, neuer Browsertest
  `playwright test tests/e2e/communication.spec.ts` 2/2 gruen in 23,7 s (sechs Eintraege, keine oberen Formulare,
  Postfach/Messenger am richtigen Ort, 390/1024/1920 px ohne horizontalen Overflow).
- **Offen**: Wizard DASH-05.03, Mehrkonten/UIDVALIDITY/Sendjournal DASH-05.04, echte Testpostfaecher DASH-05.05,
  Recovery DASH-05.06. Einzelheiten in `docs/agent-work/finalization/dash-05-communication.md`.

## 2026-10-22 DASH-04.03/04.04/04.05 Skillkonten als Master-Detail

- Die Skillkonten-Seite hat jetzt links eine Skillliste mit Name, Quelle (Friday/Hermes) und Zustand, durchsuchbar
  ueber Name, Quelle, Kategorie und Zustandstext, plus exakten Zustandsfilter; rechts stehen **nur** die Konten des
  gewaehlten Skills (Pflicht und optional getrennt).
- Ein von mehreren Skills benoetigter Schluessel wird als "Geteilt mit ..." benannt; die Detailansicht hat bewusst
  **kein** Eingabefeld, damit derselbe Wert nicht doppelt eingegeben wird.
- Tiefenlink `?area=skillAccounts&skill=<id>`; Tastatur: Enter waehlt, Pfeil ab/auf wechselt, der Fokus bleibt in der
  Liste.
- **Nachweis**: `vitest run --project web features/settings` 18 Dateien / 101 Tests gruen, `tsc` 0 Fehler. Browser:
  `pnpm build:app` + `playwright test tests/e2e/settings-acceptance.spec.ts` -> 4 Tests gruen in 48,2 s (zwei Adapter,
  zwei Skills, Draft behalten/verwerfen, Reload-Rueckleseprobe, lesende Rolle, 390/1024/1920 px, Tastatur).
- E2E-Stack hat jetzt einen Skillkatalog: `tests/e2e/fixtures/skills/` (zwei Skills, gemeinsames CalDAV-Konto),
  gesetzt ueber `FRIDAY_SKILLS_CATALOG_PATH` in `tests/e2e/stack.ts`. Nicht im Produktivpfad.
- Recovery belegt: ein kaputter Katalog (`/skills` 500) meldet den Fehler nur im Skillbereich; andere Bereiche bleiben
  editierbar und speichern.

## 2026-10-22 DASH-02.05 Sicherung vor Migration und Vertragsversion

- `openDatabase` sichert eine **bestehende** Datenbank vor ausstehenden Migrationen: WAL-Checkpoint, Kopie nach
  `<datenbank>.pre-migrate-<stempel>.bak`, die letzten drei Staende bleiben liegen. Frische Installationen und
  In-Memory-Datenbanken erzeugen keine Datei.
- `restoreMigrationBackup` prueft `PRAGMA integrity_check` und die vorhandene `schema_migrations`-Tabelle, bevor es
  kopiert; eine beschaedigte Kopie bricht ab, ohne die Datenbank anzutasten. `-wal`/`-shm` werden entfernt; es wird
  nie eine neue Datenbank angelegt.
- Optionaler Header `X-Friday-Contract-Version`: fremde Hauptversion -> 409 mit `reason=contract_version_unsupported`
  und Meldung samt unterstuetzter Version, unlesbare Version -> 400; ohne Header unveraendertes Verhalten.
- **Nachweis**: `db-migration-backup.test.ts` (4 Tests, echte Dateien, Zustand vor der letzten Migration
  nachgebaut) und `contract-version-compat.test.ts` (4 Tests); Node-Suite mit `--maxWorkers=2` gruen, `tsc` 0 Fehler.
- Hinweis fuer Folgesessions: die Node-Suite nur mit `--maxWorkers=2` fahren; mit voller Parallelitaet laufen
  bekannte Integrationstests in ihr 5-Sekunden-Zeitlimit (keine Regression, siehe `dash-02-migration-recovery.md`).
  Dasselbe gilt fuer `--project web`: mit voller Parallelitaet laufen `approvals.test.tsx` und
  `ContentStudioPage.test.tsx` in ihr Zeitlimit (einzeln 26/26 gruen), deshalb auch dort `--maxWorkers=2`.

## 2026-10-22 DASH-02.03/02.04 Vertraege abgeschlossen

- UI-PATCH und bestaetigter Sprachdialog laufen beide ueber `settingsHandlers.updateSettings`; neuer Test
  `settings-shared-action.test.ts` belegt Revisionsschritt, gemeinsame Auditaktion `settings.updated`, 409 bei
  veralteter Revision und Bindung der Bestaetigung an den gestagten Inhalt (Replay ohne zweiten Audit-Eintrag).
- Migrationen sind wiederholbar belegt: `db-migrate-repeatable.test.ts` schreibt Konto, Mail-Entwurf, Studio-Plan
  und Bibliothekseintrag in eine echte SQLite-Datei, migriert erneut und nach Neustart erneut - keine
  Doppelanwendung, alle Zeilen byte-gleich, `integrity_check=ok`, Schreiben danach moeglich. Enrollment liegt
  ausserhalb dieser Datenbank.
- **Nachweis**: `contracts:check` ok (lint/validate/check-generated/breaking), 21 Testdateien / 495 Tests gruen,
  `tsc` Control API 0 Fehler.
- **Offen (N-043)**: keine Sicherung vor Migration und keine Laufzeitpruefung alter Vertragsversionen -> DASH-02.05.

## 2026-10-22 INS-12 Starter, Parameter und Abbruch

- `install-friday-gui.bat` reichte keine Parameter weiter, `install-friday-gui.vbs` gar keine, und
  `Friday installieren.vbs` nur `-Simulation` bei genau zwei Argumenten. Jetzt: `%*` in der Batch, bekannte
  Parameter (`-ResumeRoot`, `-Simulation`) in beiden VBS-Startern, unbekannte bleiben aussen vor.
- `installer/lib/elevation.ps1`: `Start-ElevatedPowerShell` startet mit `-Verb RunAs` und meldet
  `Started`/`Canceled`/`Message`; `Test-ElevationCanceled` erkennt Win32 1223. Assistent und CLI beenden einen
  Abbruch mit Exitcode 3 und ohne Aenderung, andere Fehler mit Exitcode 4 und Meldung.
- Simulation nur im Testmodus: der Assistent verlangt `FRIDAY_GUI_TEST=1`, sonst Exitcode 2; die beiden
  GUI-Tests setzen den Marker jetzt selbst.
- Dokumentation: `installer/ANLEITUNG.md` Abschnitt "Starter und Kommandozeile" (Tabelle, Parameter, Abbruch,
  kein Trockenlauf per Doppelklick), `README.md` nennt den CLI-Weg und `resume.bat`.
- **Nachweis**: `launcher.Tests.ps1` 49 Zusicherungen (echter cmd- und cscript-Lauf, echter Win32 1223,
  Dateibaum vorher/nachher mit SHA-256 gleich), gui-installer PASS, gui-wizard-pages 108 PASS,
  Installer-Suite 35/35 Exit 0 in 457 s.
- **Offen**: echter UAC-Abbruch per Klick und Start aus dem entpackten ZIP auf sauberem Windows -> INS-13.

## 2026-10-22 INS-11 Creator Studio im Command Center

- Der Assistent lieferte das Creator Studio zwar mit, im frischen Zielordner war es aber unsichtbar: der Standard
  `dashboard.contentStudioEnabled` war `false` und die vom Installer erzeugte `dashboard.yaml` kannte den Schalter
  nicht. Jetzt gibt es `ui.contentStudio` im Konfigurationsschema (Standard `true`), die Einstellungen uebernehmen
  den Wert, Installer-YAML und Beispielkonfiguration nennen ihn. Abschalten bleibt moeglich.
- Kopie und Hash der Dashboard-Quellen liegen in `installer/lib/dashboard-sync.ps1`: `/MIR` fuer Quellordner
  (Build-Ausgaben ausgeschlossen), `/E` fuer `config` mit Erhalt der lokalen `dashboard.yaml`/`adapters.yaml`.
- Die Sicherung vor einem Update liegt in `installer/lib/dashboard-backup.ps1`: Manifest mit relativer Datei,
  Groesse und SHA-256 je Datei, Pruefung vor dem Zurueckschreiben; der Installer sichert zusaetzlich
  `data/dashboard.sqlite`, `-wal`, `-shm`, `dashboard-revision.json` und `audit-head.json`.
- **Nachweis**: `dashboard-sync-backup.Tests.ps1` 72 Zusicherungen (realer robocopy-Lauf, echte SQLite-Datei
  gesichert, ueberschrieben, wiederhergestellt und ueber `node:sqlite` wieder gelesen), vitest content-studio 18,
  config 48, settings 72, web 5, `contracts:check` bestanden, `tsc --noEmit` 0, FFmpeg real, Installer-Suite
  34/34 Exit 0 in 477 s.
- **Offen**: physischer Lauf in einen frischen Zielordner mit Browser (Menue, Route, Plan nach Dienstneustart,
  Produktion mit synthetischen Medien) -> INS-13/REL-03; Wiederherstellung im laufenden Betrieb -> REL.

## 2026-10-22 INS-10 Installerregressionen einzeln abgesichert

- WSL-Update lief ohne Limit (`Native { wsl.exe --update }`). Jetzt `Invoke-CapturedProcess` mit 600 s,
  Zeitueberschreitung und Exitcode nur als Warnung, Abschalten per `-SkipWslUpdate`.
- Fuenf bereits behobene Regressionen waren nicht einzeln geprueft; sie liegen jetzt in eigenen Modulen und
  werden ohne Installationslauf geprueft: `wsl-path.ps1` (Warnzeilen filtern, Ausgabe vor Exitcode),
  `wait-http.ps1` (503 ist Laden, getrennt von "nicht erreichbar"), `wsl-keepalive.ps1` (nur ein echter
  Prozess zaehlt, keine "bereit"-Aufgabe), `download-integrity.ps1` (Pruefsumme, falsche Datei wird geloescht).
- Die Zeitfenster bleiben getrennt: TTS 900 s, Modell 120 s, Dashboard 60 s, Download 3600 s.
- **Nachweis**: `installer-regressions.Tests.ps1` 60 Zusicherungen (echter HTTP-Server, echter
  `cmd /c where`-Kindprozess mit nachgestelltem PATH-Fehler, Pruefsummen, Gegenproben), Gegenprobe 503 -> Exit 1
  und byte-identisch wiederhergestellt, `wsl-timeout` und `warmup-cancel` gruen, Installer-Suite 33/33.
- **Offen**: Beobachtung der Fenster unter realer Last (INS-13), echter haengender Download (INS-07).

## 2026-10-22 DASH-05.03 Gefuehrter E-Mail-Wizard

- Neuer Vertrag `POST /api/v1/settings/mail-connection-test` (Operation 272) testet einen **ungespeicherten**
  Postfach-Entwurf je Protokoll und antwortet mit `{ ok, reason }` aus `ok|auth|tls|network|protocol`;
  die Bridge `installer/wsl/mail_accounts.py` bekam dafuer `check-candidate` (kein Speichern, kein Versand).
- `features/settings/MailAccountWizard.tsx` fuehrt in sieben Schritten von der Adresse ueber erkannte,
  editierbare Servervorschlaege (`mailPresets.ts`) und getrennte Verbindungstests bis zur Ordnerzuordnung,
  zum Standardkonto und zur Zusammenfassung; gespeichert wird nur im letzten Schritt.
- Unbekannte Domains erzeugen keinen Vorschlag; fehlt die Postfach-Bruecke (503), sagt der Wizard das und
  verlangt eine bewusste Bestaetigung, statt die Pruefung still zu ueberspringen.
- `MailAccountsArea` nutzt den Wizard fuer "Neues Konto"; das Formular bleibt fuer bestehende Konten (OAuth).
- **Nachweis**: Python 11 Pruefungen, API-Routentests 5, Wizard 6, Vorschlaege 5, web 83/659, node 192/2794
  (60 skipped, Exit 0), `contracts:check`, `tsc` web+api, `pnpm lint` 0 Fehler, `pnpm typecheck`, `build:app`
  und `playwright mail-wizard.spec.ts` 2/2 in 33,2 s. Details:
  `docs/agent-work/finalization/dash-05-email-wizard.md`.
- **Offen**: DASH-05.04 Abnahme (Mehrkonten/Alias/UIDVALIDITY/Sent-Kopie/Sendjournal), DASH-05.05 mit zwei
  echten Testpostfaechern, DASH-05.06 Abbruch- und Timeout-Probe.

## 2026-10-22 DASH-05.04 Mehrkonten, Alias, UIDVALIDITY und Versandjournal

- Mehrere Konten bleiben getrennt: die Bridge bedient nur bekannte Konto-IDs, die API prueft die Aufrufe je
  Konto, die Postfach-UI zeigt je Konto eigene Ordner und Nachrichten.
- Lesen markiert nichts als gelesen: ein neuer Brueckentest (24 Zusicherungen, ohne echten Server) belegt
  `readonly=True` und `BODY.PEEK` fuer Listen und Nachrichten; nur `change` selektiert schreibend.
- Ordner/UIDVALIDITY: veraltete UIDVALIDITY ergibt 409 mit Hinweis auf neu zu ladende Nachrichten;
  die UI holt Nachrichten immer mit der UIDVALIDITY der Liste.
- Entwuerfe, Anhaenge und UTF-8: Betreff/Emoji/Anhang bleiben erhalten, derselbe Entwurf wird nicht doppelt
  angehaengt, Alias-Absender sind erlaubt, fremde Absender werden mit Feldhinweis `from` abgelehnt.
- Versandjournal: offene Belege mit Aktion "Gesendet-Ordner pruefen" ohne Versand; Replay derselben Vorschau
  ruft SMTP nicht erneut auf, der Archiv-Nachtrag ergaenzt nur die Sent-Kopie.
- Dabei behoben: die Anhangspruefung testete zuerst die Gesamtsumme (Meldung "je Datei" war unerreichbar),
  und `invalid_sender`/`invalid_recipients` fielen in die allgemeine Verbindungsmeldung.
- **Nachweis**: Bridge 24, API-Routen 5, Fehlerabbildung 4, Bridge/Action-Intent 21, Compose 7, Postfach-UI 3;
  web 84/666, node 2800 (60 skipped, Exit 0), lint 0 Fehler, typecheck, build:app 0, Browser 2/2 in 27,4 s.
  Details: `docs/agent-work/finalization/dash-05-mail-accounts.md`.
- **Offen**: DASH-05.05 mit zwei echten kontrollierten Testpostfaechern, DASH-05.06 Abbruch-/Timeout-Probe.

## 2026-10-22 DASH-05.06 Recovery und DASH-05.05 Teilstand

- Wizardabbruch: sichtbarer Knopf "Einrichtung verwerfen" setzt den Entwurf zurueck; ein Test belegt, dass
  danach kein Konto, kein Standardkonto und kein `onCreated` geschrieben wurde.
- Sendetimeout: der gestufte Schreibpfad meldet Fehler ueber `onFailed`; ein bestaetigter Versand mit
  Netzwerkfehler zeigt "Antwort unbekannt", markiert `uncertain`, laedt die Versandbelege neu und wiederholt
  nichts. 4xx-Antworten werden stattdessen mit der Servermeldung erklaert.
- Kein Loeschpfad: der Brueckentest belegt kein `EXPUNGE`/`\Deleted`, nur `\Flagged` und Entwuerfe per
  `append`; `delete-message` wird abgelehnt.
- DASH-05.05 teilweise: sechs Filter/SMS/obere Formulare (05.02), Passwort-/TLS-/Tokenfehler erklaert
  (Wizard und `mail-account-errors` inklusive OAuth-Luecke im `{error}`-Zweig), UI-Neustart laedt Konten und
  Quelle erneut. Offen bleiben zwei echte Testpostfaecher (keine Zugangsdaten/Server in dieser Umgebung).
- **Nachweis**: Bridge 25, Wizard 7, Compose 8, Postfach-UI 4, Fehlerabbildung 5; web 84/669, node 2801
  (60 skipped, Exit 0), lint/typecheck/build 0, Browser 2/2 in 24,4 s.
  Details: `docs/agent-work/finalization/dash-05-recovery.md`.
- **Offen**: DASH-05.05 mit echten Testpostfaechern; danach DASH-06.

## 2026-10-23 DASH-06 Kalenderkonten im Adapterdetail

- Der Kontoblock ist von der Kalenderseite in das Kalender-Adapterdetail umgezogen: sechs Schritte
  (Typ, Zugang, Discovery, Kalender/Rechte, Standard/Sync/Zeitzone, Pruefen/Uebernehmen). Die Kalenderseite
  zeigt nur noch Ansichten, Termine und Filter; `CalendarAccounts.tsx` ist entfernt.
- Discovery nutzt Principal und Home-Set, listet Rechte je Kalender und verweigert Rechte aus fehlerhaften
  propstat-Antworten. ICS bleibt fest lesend (kein Schreibziel, kein Schreibtest).
- Neu: ausdruecklicher Schreibtest in der Bridge (eindeutige Kennung, Ruecklesepruefung, Aufraeumen im
  finally), vertraglich als `write-test` verankert, im Service erklaerend abgebildet und nur auf Klick
  ausgeloest.
- Kontoentfernen und Abbruch loeschen keine Termine und keine Serverkalender; ein neuer Test prueft, dass
  `delete` keinen HTTP-DELETE sendet. Discovery-Fehler lassen das bisherige Standardkonto samt Kalendern
  unangetastet.
- **Nachweis**: CalDAV-Fixture 11/11 in WSL, Wizard 5/5, Kalender-API 60/60, web 85/674, lint/typecheck/build 0,
  Settings-Browser 10/10. Details: `docs/agent-work/finalization/dash-06-calendar-accounts.md`.
- **Offen**: DASH-06.04 TEIL - echte CRUD gegen einen realen Anbieter (keine Zugangsdaten hier); Wizard 06.02,
  Discovery/Schreibtest 06.03 und Recovery 06.05 sind belegt. Als Naechstes DASH-07.

## 2026-10-23 DASH-07.03-07.06 Teilstand: Hermes-Zugaenge

- Belegt vorhanden: `GET/PATCH /settings/hermes-config` (82 Felder, maskierte Secrets, Revisionspruefung),
  Modell-/Fallback-Felder, Modellkatalog, MCP-OAuth, `CONFLICT` bei Versionsabweichung.
- Fehlend und deshalb offen: Friday-Flaeche fuer `hermes auth add/list/remove/reset/logout` (Zugaenge
  anzeigen, hinzufuegen, erneuern, trennen, Abo vs. API-Key), Customendpoints, lokale Modelle, `memory.*`,
  Provider-OAuth/Deviceflow sowie der echte Modellaufruf fuer 07.05.
- Umgebungsbefund: Hermes ist auf diesem Rechner erreichbar (`hermes.exe` v0.20.5, zusaetzlich in
  `Friday-Ubuntu`); `hermes auth list` zeigt zwei Key-Provider. Die Inventarbasis (v0.22.2 in `FRIDAY-2`)
  weicht ab - die Version muss je Laufzeit gelesen werden. Kein Modellaufruf ausgefuehrt.
- **Nachweis**: rein lesende CLI-Abfragen, node 2801/60 skipped, web 85/674, lint/typecheck/build 0.
  Details: `docs/agent-work/finalization/dash-07-access-partial.md`.
- **Offen**: 07.03 Zugaenge-Vertrag und UI, 07.04 Flow, 07.05 Modellaufruf/Worker-Version, 07.06 Login-Recovery.

## 2026-10-23 DASH-07.03 Leseweg: Zugaenge bis zur Oberflaeche

- Bridge-Aktion `auth-list` (strenger Parser, keine Secrets) -> `GET /api/v1/settings/hermes-access` (owner,
  Vertrag/SDK/Routen generiert) -> `HermesAccessArea` im Hermes-Bereich mit Anbieter, Anzahl, Typ
  (API-Key/Abo-Anmeldung), maskierter Quelle und Aktivstatus; Laden/Fehler/leer sind ehrliche Zustaende.
- Nachweise: Parser-Test WSL 4/4, Service-Tests 4/4, Routentest (401/403/200) in 14/14, UI-Tests 3/3,
  web 86/677, typecheck und lint 0 Fehler, contracts:check 0.
- **Offen (07.03)**: Hinzufuegen/Erneuern/Trennen (`auth add/remove/reset/logout`, Key ueber stdin) und die
  Trennung OpenAI/Anthropic als Hauptauswahl gegen "Erweitert". Beides braucht echte Credentials und eine
  sichere, verifizierte CLI-Interaktion; ohne diese bleibt es TEIL. Ledger N-050 teilweise.

## 2026-10-23 DASH-10.02 Teilstand: Skillkatalog-Filter

- Kategoriefilter ergaenzt (`visibleSkills` + Auswahlfeld in `SkillsPage`, Optionen aus dem geladenen Katalog);
  Suche, Herkunft, Kategorie und Status wirken kombiniert. Nachweis: `skillPresentation`/`SkillsPage` 9/9,
  Web-Typecheck und Lint 0.
- **Noch offen fuer 10.02**: die Detailansicht laedt kein `SKILL.md` - es gibt weder einen Detail-Endpunkt noch
  eine Sanitizing-Strecke; Quellen-/Versions-/Trust-Angaben sind im Katalog nur teilweise getrennt sichtbar.
- **10.03-10.07 unangetastet**: der per-Skill-Schalter (opt-in/opt-out) und die CLI-Operationen
  (`inspect/search/install/update/check/audit/uninstall/trust`) sind nicht belegt; Vorgehen laut Plan erst nach
  Quell-/CLI-Analyse und Readbackprobe.

## 2026-10-23 Gate-Zertifizierung des aktuellen Baums

- `pnpm contracts:check` 0, `pnpm typecheck` 0, `pnpm lint` 0 Fehler (3 bestehende Warnungen), `pnpm build` 0,
  node-Suite 194 Dateien / 2806 Tests (60 skipped), web-Suite 86 Dateien / 677 Tests.
- Der neue Endpunkt `getHermesAccess` hat vier Vertrags-/Abdeckungswaechter ausgeloest; sie wurden bewusst
  nachgezogen: 273 released operations, live-only-Liste im Mock-Datenpaket (kein gemockter Hermes-Zugang),
  503-Erwartung im Secret-Hygiene-Test, fokussierte Vertragsprobe 80 statt 79 (Commit `4a64828`).
- Keine Abschwaechung der Zaehlungen, keine erfundenen Antworten: der Endpunkt bleibt im Test ohne Hermes
  ehrlich bei ADAPTER_UNAVAILABLE.

## 2026-10-23 DASH-10.02: Skill-Inventar mit Herkunft, Trust und SKILL.md-Detail

- **Detailendpunkt** `GET /api/v1/skills/{id}/markdown` (owner) steht: Vertrag, generiertes SDK, Service
  (`skillMarkdown`, Kennungspruefung vor dem Aufruf, 404/422 aus `skill_md_missing`/`skill_md_too_large`,
  Byte-Grenze 64 KiB) und Handler (Audit `skills.markdown_read` ohne Inhalt). Die Oberflaeche laedt den Text
  erst bei Auswahl und rendert ihn als `<pre>` - es existiert kein HTML-Pfad, also auch keine aktive Auszeichnung.
- **Inventar aus der echten CLI**: neue Bridge-Aktion `skills-list` parst ausschliesslich das dokumentierte
  Fuenf-Spalten-Layout von `hermes skills list --source all` (breite `COLUMNS`, sonst kuerzt die Tabelle Namen).
  Live auf diesem Host: 191 Skills, 119 `local`, 72 `builtin`, 0 `hub`, alle `enabled`.
- **Vertrag erweitert**: `SkillCatalogEntry` traegt jetzt `origin` (friday/builtin/local/hub/unknown) und
  `trust` (builtin/local/project/unknown) als Pflichtfelder; die Operationenzahl bleibt 274. Der Service zieht
  beides ausschliesslich aus der CLI, nutzt den CLI-Status nur, wenn das Dashboard keinen liefert, und laesst den
  Katalog bei unlesbarem Inventar unveraendert (Herkunft/Trust dann `unknown`).
- **Oberflaeche**: Detail trennt Herkunft, Trust, Kategorie, Paket, Hermes-Status, Beobachtet, Quelle und
  Ausfuehrbar; Filter fuer Suche, Quelle, Herkunft, Kategorie und Status; die Liste rendert 60 Zeilen und laedt
  auf Wunsch weiter.
- **Nachweise**: Bridge 9 + 6 Python-Pruefungen (WSL), Service 20 Tests (3 neu), Routentest mit
  `responseValidation: "throw"` (1), Web 4 + 7 + 2 Tests, Gesamtsuite 291 Dateien / 3681 passed / 60 skipped,
  `contracts:check`/`typecheck`/`lint`/`build` 0.
- **10.02 bleibt TEIL**: auf diesem Host existiert kein Hub-Skill (0 Zeilen mit Quelle `hub`), die CLI-Tabelle
  fuehrt keine Version je Skill, `external` erscheint dort als `local`, und die Trust-Verwaltung gehoert zu
  10.03/10.04. Details: `docs/agent-work/finalization/dash-10-02-skill-inventory.md`.
- **Naechster Schritt**: DASH-10.03 (per-Skill-Schalter per CLI-/Quellanalyse und Readbackprobe), danach 10.04.

## 2026-10-23 DASH-10.03: Per-Skill-Schalter belegt

- **Mechanismus** (Quellanalyse am Hermes-Checkout v0.22.2 in `FRIDAY-2`): der per-Skill-Schalter ist die Menge
  `skills.disabled`. `hermes_cli/skills_config.py` liest/schreibt sie (`get_disabled_skills`/`save_disabled_skills`,
  `None` = leer, Skalar = ein Element), `hermes_cli/web_routers/skills.py` berechnet daraus `enabled` und bietet
  `PUT /api/skills/toggle {name, enabled}`, und `agent/skill_utils.py:446` ordnet den Namen auch ueber `load_name`
  zu. `hermes skills config` ist eine interaktive TUI ohne scriptbare Einzelumschaltung; `opt-in`/`opt-out` steuern
  nur das Seeding der Bundled-Skills und sind **kein** per-Skill-Schalter.
- **Kontrollierte Readbackprobe** in einem wegwerfbaren Profil (`friday-probe`, danach geloescht): 72 aktivierte
  Skills, `skills.disabled=["arxiv"]` -> 71 und Zeile `arxiv … builtin builtin disabled`, Ruecknahme `[]` -> 72.
  Default-Profil unveraendert (`skills.disabled` nicht gesetzt, 191/191). Der Wrapper `friday-probe.bat` wurde
  entfernt.
- **Friday-Verhalten** unveraendert korrekt: `SkillsService.toggle` prueft die Kennung, verweigert unbekannten
  Zustand, sendet genau `{name, enabled}` an `/api/skills/toggle` und vergleicht anschliessend erneut. Neuer Test
  „rejects an activation the dashboard does not read back" belegt, dass eine akzeptierte, aber nicht wirksame
  Umschaltung als Fehler gilt (21/21 in `skills-onboarding.test.ts`).
- **Nebenfund**: `GET /api/skills` liefert `provenance` (hub > bundled > external > agent) — praeziser als die
  CLI-Spalte `Source`, die `external` als `local` fuehrt. Naechste Verbesserung: `origin` daraus speisen und um
  `external` erweitern.
- **Naechster Schritt**: DASH-10.04 (typisierte Skill-CLI-Operationen je Version).

## 2026-10-23 DASH-10.04: Typisierte Skill-Operationen (Teil)

- **Faehigkeitsmatrix** beider real installierten Staende (Windows-CLI v0.20.5, WSL-Checkout v0.22.2): nur
  `hermes skills search` und `hermes skills list-modified` bieten `--json`. `inspect`, `browse`, `check`,
  `audit`, `diff`, `tap list` liefern Rich-Text, `install/update/uninstall/reset/trust/untrust/tap add|remove`
  sind Mutationen, `config` ist eine TUI. Damit wird **keine** Rich-Tabelle geparst.
- **Zwei neue typisierte Operationen** (276 insgesamt): `GET /api/v1/skills/hub/search?query=&source=&limit=`
  ueber die Bridge-Aktion `hub-search` (`--json --limit`, optional `--source`, Timeout 60 s) und
  `GET /api/v1/skills/modified` ueber `modified-list`. Die Parser akzeptieren ausschliesslich die dokumentierten
  Felder (zusaetzliche Felder neuerer Versionen werden ignoriert, nie erfunden); Duplikate und Fremdformen
  werden abgelehnt. Eingaben werden vor dem CLI-Aufruf geprueft (1–120 Zeichen, Quellenmuster, Limit 1–50);
  Format- und Zeitfehler enden als `ADAPTER_UNAVAILABLE`, nie als leere Trefferliste.
- **Nachweise**: 9 Python-Pruefungen (WSL), 3 Routentests mit `responseValidation: "throw"`,
  Vertragswaechter auf 276 gezogen, `contracts:check`/`typecheck`/`lint`/`build` 0. Live lieferte
  `search hermes --json --limit 2` echte Treffer, `list-modified --json` den Wert `[]`.
- **Offen (TEIL)**: Textdarstellung fuer `inspect/browse/check/audit/diff/tap list`, alle Mutationen und das
  Verhalten bei nicht erreichbarem `skills.external_dirs`.
- **Neues Issue N-051**: der Test `messenger-inbound-routes` faellt mit 503 „Event ID conflict" beim zweiten
  identischen Empfang — reproduzierbar auch auf `2356c5e` und mit geleertem Arbeitsbaum, also vorbestehend und
  unabhaengig von diesem Block; im Ledger offen.
## 2026-10-23 DASH-10.05: Registry-Suche und lokale Aenderungen in der Oberflaeche

- **Neue Flaeche** `SkillRegistryPanel` auf der Skillseite (nur `owner`, nur online): Registry-Suche ueber
  `GET /api/v1/skills/hub/search` zeigt je Treffer Name, Quelle, Trust-Stufe, Kennung und Beschreibung; die Liste
  lokal geaenderter Skills kommt aus `GET /api/v1/skills/modified` und warnt, dass ein Update diese Skills
  ueberspringt. Ein Installationsknopf fehlt bewusst; der Grund (Bestaetigungs- und Wiederherstellungsweg fehlt
  noch) steht im Panel.
- **Keine erfundenen Zustaende**: Suche laeuft nur auf ausdrueckliche Eingabe, `retry: false`, Leer- und
  Fehlermeldung getrennt; ein Registry-Ausfall erzeugt eine Fehlermeldung, keine Trefferliste.
- **Nachweise**: 3 neue UI-Tests (Treffer ohne Installationsknopf, Leermeldung, Warnung plus Leerzustand),
  SkillsPage 4 gruen, web-Suite 88 Dateien / 685 Tests, `typecheck` und `lint` 0.
- **Offen (TEIL)**: Voraussetzungen und Auditbefund je Treffer (`inspect`/`audit` liefern kein JSON), Diff/Konflikt
  vor einem Update, die Installation/Aktualisierung selbst (DASH-10.07) und die gefuehrte Wiederverwendung
  bereits eingerichteter Referenzen.

## 2026-10-23 N-051 geschlossen: Wiederzustellung im Messenger

- **Fehler**: ein erneut zugestelltes Messenger-Ereignis (gleiche Nachricht, neuer Empfangszeitpunkt) wurde mit
  `503 INTERNAL "Event ID conflict"` beantwortet. Ursache: das dauerhafte Gedaechtnis lehnt einen bekannten
  Ereignisausweis mit abweichendem Inhalt ab, und der Zeitstempel der zweiten Zustellung weicht ab.
- **Fix**: `MessengerInboundService` wertet genau diesen Konflikt als `captured`; der zuerst gespeicherte Stand
  bleibt unveraendert, andere Capture-Fehler werden weiter geworfen. Gleiches Verhalten fuer Assistenten-Wendungen.
- **Belege**: neuer Diensttest (Konflikt -> `captured`, genau eine Zeile), Dienst 7/7, Routentest 6/6, volle
  node-Suite 198 Dateien / 2821 Tests gruen (60 uebersprungen), `contracts:check`/`typecheck`/`lint`/`build` 0.
- `secrets.test.ts` deckt die neuen Operationen `searchSkillHub` und `listModifiedSkills` ab (Suchbegriff bzw.
  503-Liste), damit der Geheimnis-Scan alle GET-Routen weiter prueft.

## 2026-10-23 DASH-10.04 Nachtrag: inspect, audit und diff als unveraenderter Text

- **Drei weitere Operationen** (279 insgesamt): `GET /api/v1/skills/{name}/inspect`, `.../audit`, `.../diff` ueber
  die Bridge-Aktion `skill-report`. Die CLI liefert fuer diese Befehle kein JSON, deshalb wird der Bericht
  woertlich durchgereicht: hoechstens 65536 Zeichen, `truncated` markiert die Kuerzung, `bytes` nennt die volle
  Groesse. Ein leerer Bericht wird als `ADAPTER_UNAVAILABLE` gemeldet, nie als leerer Erfolg; ein Zeitlimit
  (60 s) ebenso.
- **Nachweise**: 9 Python-Pruefungen (`test_skill_report.py`), 4 Routentests mit `responseValidation: "throw"`,
  Vertragswaechter auf 279 gezogen, volle node-Suite 199 Dateien / 2825 Tests gruen (60 uebersprungen),
  `contracts:check`/`typecheck`/`lint`/`build` 0.
- **Neues Issue N-052**: der Router prueft Pfadparameter nur auf Praesenz und Laenge (max. 128), nicht auf das im
  Vertrag dokumentierte Muster. Ein Name wie `-..` wird deshalb erst im Dienst abgelehnt; im Ledger offen.

## 2026-10-23 DASH-10.06: Abnahme im wegwerfbaren Profil

- **Hub-Fall real geprueft** (Profil `friday-accept`, danach geloescht): `skills install
  skills-sh/anthropics/skills/skill-creator --yes` durchlief Quarantaene und Sicherheitsscan
  (Verdict CAUTION, `ALLOWED` fuer eine trusted-Quelle), installierte drei Dateien, und ein **neuer Prozess**
  listet den Skill als `enabled`.
- **Lokale Aenderung wird nicht still ueberschrieben**: nach einem Edit an `SKILL.md` meldet
  `skills update skill-creator` „Skipping … you have local edits (update would overwrite them)" und laesst die
  Zeile stehen; `--force` ueberschreibt bewusst. Damit ist der Wiederherstellungsweg belegt, aber ausdruecklich.
- **Builtin und Friday-Skill**: Ansehen ueber Inventar/`SKILL.md`, Verwalten ueber den Schalter aus DASH-10.03,
  Readback in neuem Prozess unveraendert (Belege in `dash-10-02`/`dash-10-03`).
- **Neue Grenzen im Ledger**: N-053 (`inspect` loest gegen die Registries auf, bei Namenskollision mehrdeutig),
  N-054 (`diff` nur fuer getrackte Skills, unser 503 verschweigt den CLI-Text), N-055 (`list-modified` fuehrt
  keine Hub-Aenderungen).
- **Offen**: fehlendes externes Laufwerk, Nachweis am laufenden Operator-System (dort wurde nichts veraendert).

## 2026-10-23 DASH-10.07: Skill-Mutationen mit wiederherstellbarem Schnappschuss

- **Neue Operation** `POST /api/v1/skills/{name}/mutations` (**280**): `install`, `update`, `uninstall`. Vor jedem
  CLI-Aufruf wird das installierte Skill-Verzeichnis nach `~/.hermes/friday-snapshots/<UTC>-<aktion>-<name>` kopiert;
  nach dem Lauf wird der Zustand neu gelesen. Weicht er ab oder endet die CLI mit Fehler, wird der Schnappschuss
  zurueckgespielt, ein halb angelegtes Verzeichnis entfernt, und die Antwort nennt `restored`/`previousPresent`.
- **Fehlercodes**: `invalid_request` (Dienst: `VALIDATION_FAILED`, ohne CLI-Aufruf), `skill_mutation_failed` und
  `skill_mutation_timeout` (Dienst: `ADAPTER_UNAVAILABLE` mit dem Hinweis auf den wiederhergestellten Stand).
- **Belege**: 15 Bridge-Pruefungen mit echtem Unterprozess, 4 Routentests, Vertragswaechter auf 280, volle
  node-Suite 200 Dateien / 2829 Tests gruen, Gates 0.
- **Nebenbefund N-056 (behoben)**: die Routen-Sweeps brauchten unter zwei Workern mehr als die 5-s-Vorgabe von
  vitest; beide geteilten Projekte setzen jetzt `testTimeout`/`hookTimeout` 20 s.
- **Offen**: echter Lauf der Hermes-CLI gegen ein wegwerfbares Profil und der Nachweis, dass ein Entfernen keine
  geteilten Zugaenge anfasst.

## 2026-10-23 Sitzungsabschluss: Stand gegen Abschnitt 8.1

**Erledigt in dieser Sitzung** (jeweils mit Laufzeit- oder Testbeleg, Details in `docs/agent-work/finalization/`):

| Aufgabe | Stand | Beleg |
|---|---|---|
| DASH-10.03 Skill-Schalter | **PASS** | Schalter ueber `skills.disabled`, Readback 72 -> 71 -> 72 im wegwerfbaren Profil |
| DASH-10.04 Skill-Operationen | **PASS** | Hub-Suche und lokal geaenderte Liste typisiert; `inspect`/`audit`/`diff` als unveraenderter Text (gemessen: diff < 1 s, inspect 37 s); fehlende Wurzel wird gemeldet |
| DASH-10.05 Registry-Flaeche | **PASS** | Panel mit Treffern, Quelle/Trust, lokal geaenderten Skills; kein Installationsknopf, Grund genannt |
| DASH-10.06 Abnahme | TEIL | Hub-Skill real installiert (Quarantaene + Scan), Readback in neuem Prozess, lokale Aenderung nicht still ueberschrieben |
| DASH-10.07 Recovery | TEIL | `POST /api/v1/skills/{name}/mutations` mit Schnappschuss, erneutem Lesen und Wiederherstellung; echter CLI-Lauf offen |

**Vertrag**: 280 Operationen. **Suite**: 200 Dateien / 2829 Tests gruen (60 uebersprungen). **Gates**: 0.

**Offen nach Abschnitt 8.1** (58 von 141 Aufgaben erledigt, 83 offen):
- DASH-05.05, DASH-06.04, DASH-07.03–07.06
- DASH-08.01–08.05 und DASH-09.01–09.06 (brauchen echte Mail-, Kalender- und Messenger-Zugaenge)
- DASH-10.01, 10.02, 10.04–10.07 (jeweils der in den Detailberichten genannte Rest)
- DASH-11.01–11.05, 12.01–12.05, 13.01–13.05, 14.01–14.06, 15.01–15.05, 16.01–16.06, 17.01–17.05,
  18.01–18.06, 19.01–19.06, 20.01–20.04
- KEEP-01..06, REL-01.01..REL-06.04, INS-13

**Offene Befunde im Ledger**: N-052 (Router prueft Pfadparameter nur auf Laenge), N-053 (`inspect` loest gegen die
Registrierungen auf), N-054 (`diff` nur fuer getrackte Skills, unser 503 verschweigt den CLI-Text), N-055
(`list-modified` fuehrt keine Hub-Aenderungen). N-056 (vitest-Zeitlimits) ist behoben.

## 2026-10-23 — DASH-10.06 Laufzeitnachweis (DSH)

- Skill-Verwaltung am laufenden System geprueft: echte Control API (dataMode live, eigenes Datenwurzelverzeichnis mit install-state.json, Distro FRIDAY-2) las per HTTP 159 Skills (53 builtin, 106 external) in 67,3 s; diff, inspect (Kennung 2,3 s / Name 110,6 s), tap-list und Ablehnungstexte echt; command=config -> 400.
- Sieben nur im Betrieb sichtbare Defekte gefunden und behoben: origin external (N-064), Runner-Limit 35 s (N-065), zwei Budgets unter der realen CLI-Laufzeit (N-066/N-067), UTF-8-BOM auf stdin (N-068), Fehlertexte ohne Grund (N-069), Budgets ohne Abstand (N-070). Commits e809244 (Code) und 2de834f (Doku).
- DASH-10.06 bleibt TEIL: kein Hub-Skill auf dem Profil, Neustart-Gleichheit und fehlendes Laufwerk nicht live, Operator-System ohne FRIDAY_SKILLS_CATALOG_PATH.
- Naechster Schritt: Neustart-Readback und Fehlerfall "Laufwerk fehlt" am selben Aufbau; danach restliche Abschnitte 8.1.

## 2026-10-28 Finalisierung fortgesetzt: Vorstand geprueft, Installer-Regressionen, Basis-URL, Menue-Audit

Branch `feat/friday-finalization-20261021`, alles lokal (kein Push; Push nur als `rogueki` nach Ankuendigung).

| Einheit | Stand | Beleg |
|---|---|---|
| Testisolation Node (ffc2a4f, bbb495f) | PASS | Host-Installationsvariablen beeinflussen keine Tests mehr; 120-s-Limit am Scan |
| Next 16.4.3 + transitive Sicherheitsuntergrenzen (97bd4bb) | PASS | Build/Gates gruen |
| DASH-18.03 TEIL 5/6 Sprache: Automationen, Gedaechtnis/Recherche (45e9143, a4252a4) | PASS | Unit-Tests |
| I-004 globale `.wslconfig` erhalten, kein Shutdown neben fremden Distros (c0d8879) | CLOSED_VERIFIED | `wsl-config.Tests.ps1` 23 Checks; Live-Probe FRIDAY-2 -> Plan `existing` |
| INS-10-Regressionen I-007/009/011/023/027/046, N-006 (e66dd8a) | CLOSED_VERIFIED | `ins10-regressions.Tests.ps1` 22 Checks (Mutationsprobe), `test_persona_soul.py` |
| N-077 Installer setzt `model.base_url` fuer `custom` (e31d660) | CLOSED_VERIFIED | `test_setup_hermes_base_url.py` 3 OK in WSL, Gegenprobe rot |
| N-078 Bridge-Regression (`snapshot` verdeckt, stdin ohne `.buffer`) (51fafd8) | CLOSED_VERIFIED | Bridge-Tests 47 gruen (vorher 51 rot) |
| N-076 Basis-URL im Dashboard (51fafd8, d4dc177, a7fc0d6) | FIXED_PROVEN_CODE | Contract + API `validBaseUrl` + UI-Feld mit Sperrgrund; hermes-config 39, HermesConfigArea 2 (Gegenprobe), Bridge/Credential 49 |

**CI-Python-Liste unter CI-Bedingungen (WSL, frisches HOME)**: 281 passed, 7 skipped; einziger verbleibender Ausreisser
`test_messaging_pairing::test_qr_refresh_cancel_and_expiry_without_real_connector` ist ein Timing-Flake (einzeln je 3/3 im
alten und neuen Stand).

**Menue-Audit (DASH-18.05, `tests/e2e/menu-audit.spec.ts`)**: 18 Seiten, streng (`expect(findings).toEqual([])`;
`MENU_AUDIT_REPORT=1` = nur Bericht unter `test-results/menu-audit/<seite>.menu-audit.md`). Jede Auswahlliste,
Combobox, Tablist und jeder Dialog-Oeffner wird bedient, jede Option ausgewaehlt und ihre Wirkung festgehalten.
- N-080: 18 deaktivierte Aktionen ohne Grund -> Grund als Tooltip aus derselben Bedingung (d0f2b9d).
- N-081: Fokus nach Bestaetigungsdialogen auf `<body>` -> explizites Rueckkehrziel im Focus-Trap (d0f2b9d, c1e24b0).
- N-082: Gestapelte Dialoge (Bestaetigung ueber Aufgaben-Drawer) schlossen mit einem Escape gemeinsam, Tab sprang in den
  Drawer -> Trap-Stapel, nur die oberste Ebene reagiert (c1e24b0).
- N-083: E2E-Stack nutzte veraltete Builds; Neubau unter Windows scheiterte (c1e24b0).
- Kalender-"Woche"-Timeout war kein Dashboard-Fehler: CPU-Profil zeigt ~30 s SwiftShader-Software-WebGL (Orb) im
  Headless-Chromium. Der Audit laeuft daher mit 2D-Orb-Fallback (Orb hat eigene Visual-Tests); Kalender ohne Befund.
- Oeffner werden ueber ihren zugaenglichen Namen aufgeloest und vor jedem Oeffner auf den Ausgangszustand gesetzt;
  vorher blieben die Aufgaben-Drawer ungeprueft. Letzter Volllauf: 18/18 Seiten gruen, 216 Elemente, 8 Oeffner im Bericht
  als uebersprungen (Eintraege, die erst in aufgeklappten Menues erscheinen oder sich durch vorige Aktionen aendern:
  Export -> Markdown/JSON, Meldungsdetails, einzelne Kalender-/Timeline-Eintraege).
- Gepruefte Ausnahmen (Option ohne sichtbare Wirkung, by design): Skills-Filter "Quelle: Friday", "Herkunft:
  Friday-Paket", "Kategorie: Produktivitaet", "Status: Unbekannt" - der E2E-Katalog enthaelt genau zwei Friday-Skills dieser
  Werte, die Filter treffen alle Zeilen ("Hermes"/"Aktiviert" filtern nachweislich).

**PR #31 / Linux-CI (2026-10-28)**: Branch gepusht, PR https://github.com/rogueki/rogue-friday/pull/31.
- N-084..N-087: Gedaechtnissuche per Befehl (Regression aus a4252a4), `memory.deleted` ohne `before`, Navigations-/axe-Listen
  ohne Content Studio, Mail-Fehlerzuordnungstest nur unter Windows gruen (687ae06); mcp 2.2.0 in den CI-Testabhaengigkeiten
  (Dependabot #2, 0c5d6fa); 12 E2E-Shards statt 8 (52dd31a, N-091).
- N-088: Navigation passt mit 18 Eintraegen wieder ohne Scrollen in 1080 px (PLAN §24.12), neuer E2E-Test.
- N-089: Skills-Anleitung fuer Friday-Skills aus dem Friday-Register statt Fehlermeldung; Quelle auf Deutsch.
- N-090: `/audit` im Screenshot maskiert (Echtzeit-Kette), Content Studio und Skills mit Screenshot. Linux-Baselines
  werden per `workflow_dispatch capture_baselines` erzeugt und vor dem Commit Bild fuer Bild geprueft. Die geaenderte
  Kommunikationsseite (Rohformulare 'Mail Postfach'/'Messenger-Nachricht' und Anbietername ersetzt) ist beabsichtigt.

- PR-CI auf c2544d2 vollstaendig gruen (Gates, Python, 12/12 E2E inkl. neuer Linux-Baselines). Offen N-092
  (Quell-Badge auf Aufgabenkarten bricht um) und N-093 (CI-Wiederholungen durch haengende Chromium-GPU-Prozesse;
  Vorschlag 2D-Orb-Fallback ausserhalb der Orb-Spezifikationen). Menue-Audit wartet bis 2 s auf Reiterauswahl (3b28762).

- DASH-15/16 (2026-10-28, PR #32): Domain-Agenten laufen als Hermes-Kanban-Worker; Kanban-Dispatcher-Grenzen
  im Dashboard einstellbar (wirken nach Gateway-Neustart). Live: 7 Profile parallel mit korrelierten Ergebnissen,
  Grenzen belegt (Spitze 4, gleiches Profil seriell). Offen: N-094 harte Bereichstrennung, Sprache->Domain-Jobs (16.02),
  Abbruch an Kinder (16.04). Beleg docs/agent-work/finalization/dash-15-16-orchestrierung.md.

- DASH-16.02 (2026-10-29): Lange Sprachauftraege gehen ohne Rueckfrage als Kanban-Aufgabe an den Domain-Agenten
  (research/tasks/alerts/audit; senden/buchen/aendern bleiben in den bestaetigten Sprachablaeufen). Neue Routen
  `POST/GET /api/v1/voice/tasks` nur fuer die Voice-Bridge, lesen nur Aufgaben mit Label `tenant:voice-<bereich>`.
  `Task.resultSummary` kommt aus Hermes `latest_summary`; der Sprachdienst fragt alle 10 s ab und sagt das Ergebnis an,
  "Stopp" beendet nur die Ansage. Ohne Control API greift der alte Thread-Weg. Abbruch an Kinder (16.04) und
  Vorschautext (N-095) sind in PR #32 erledigt. N-094: Entscheidung eigene Linux-Benutzer je Profil, Entwurf
  docs/agent-work/finalization/n-094-profil-benutzer-entwurf.md.

- DASH-16.04/05/06 (2026-10-29, N-097): Sprachaufgaben lassen sich per Name abbrechen ("brich die Recherche ab",
  `POST /api/v1/voice/tasks/{taskId}/cancel`, offene Kinder mit); "Stopp" beendet nur Dialog und Audio. Statusfragen
  beantwortet der Sprachdienst lokal aus `domain-tasks.json` ohne Netz und Modell. Fertige Ergebnisse werden 3 s
  gesammelt und gemeinsam angesagt, ohne laufende Ansagen zu unterbrechen. Nach einem Neustart des Sprachdienstes
  werden offene Auftraege wieder beobachtet. Live-Abnahme auf FRIDAY-2 steht aus.

- N-094 (2026-10-29): Harte Bereichstrennung ueber `installer/wsl/setup_profile_isolation.sh`: je Domain-Profil ein
  Linux-Benutzer `friday-<p>`, Hermes `terminal.backend: ssh` auf 127.0.0.1:2222 (nur Schluessel), Terminal- und
  Datei-Tools laufen dort; Gateway-Seite 0700/0750. Kein Hermes-Patch (`n-094-profil-benutzer-entwurf.md`).
  Live auf FRIDAY-2 am 2026-10-30 abgenommen: sieben Profile als eigene Benutzer, fremde Zugangsdaten verweigert. Der
  erste Lauf scheiterte auf frischem openssh-server und liess Port 22 offen; #104 behebt das (N-143). Sieben
  Kanban-Aufgaben ueber den Dispatcher liefen danach je als `friday-<p>`; Schreiben in `~/.hermes` des Eigentuemers
  scheiterte in allen sieben.

- DASH-12.04/12.05 (2026-10-29): Ein fehlgeschlagenes Neutraining der Linux-Sprecheranmeldung loeschte bisher Profil,
  Wake-Modell und Meta des zuvor funktionierenden Profils. Jetzt werden sie vor dem Training gesichert (`*.prev`), bei
  Fehlschlag samt `active`-Marker wiederhergestellt und erst nach Erfolg verworfen (`linux-voice-enrollment.test.ts` 4/4,
  Gegenprobe gegen den alten Code rot).
- N-052 (2026-10-29): Pfadparameter werden gegen Laenge, Muster und Enum aus dem Vertrag geprueft (vorher nur
  128 Zeichen); Werte wie `-../` enden mit 400 VALIDATION_FAILED vor Handler und Adapter. 46 Operationen mit
  Pfadparametern deklarieren 400 jetzt im Vertrag (additiv).
- DASH-16.03 (2026-10-29): Grenzen fuer Unteragenten im Dashboard einstellbar (`delegation.max_spawn_depth`,
  `max_concurrent_children`, `max_iterations`, `child_timeout_seconds`; Hermes-Einstellungen -> Agent, wirken beim
  naechsten delegate_task). Anbietergrenze und Geldlimit gibt es in Hermes nicht; Ersatz und Begruendung in
  `dash-15-16-orchestrierung.md` Abschnitt 3.

- DASH-08/09/KEEP/REL (2026-10-29, N-114 bis N-126): Gateways uebernehmen neue Zugangsdaten nur nach Bestaetigung durch
  den Anbieter und schreiben erst nach erfolgreichem Umschalten (Telegram #67, Discord #70, Modell-Schluessel #66,
  CloudTalk #72; WhatsApp-Neukopplung #64). CloudTalk rief bisher einen falschen Host auf. Das Dashboard-Update liefert
  jetzt alle von der Control API aufgerufenen Laufzeit-Skripte aus; Closure-Tests sichern das (#71). Die CI fuehrt
  29 bisher ausgelassene WSL-Tests aus (#68). Der Orb verwirft verspaetete Server-Snapshots (#73, E2E-Shard 4).
  Telegram: Kopplungsanfragen im Dashboard freigeben/entziehen (#74), Gruppenchats ueber `TELEGRAM_GROUP_ALLOWED_CHATS`,
  Kopplungsmodus ohne IDs und Webhook-Entfernen nur auf ausdruecklichen Wunsch (#75); Hermes kennt keine Topic-Allowlist.
  Telefonie-Vorschauen kollidieren nicht mehr bei gleicher Millisekunde (#76). Offen: Live-Tests mit echten Konten.

- DASH-08.05/KEEP-04/REL-01.03 (2026-10-29, N-127 bis N-132): CloudTalk laesst sich trennen; die Schluessel werden
  geloescht und alte Rufvorschauen bleiben ungueltig (#78). Ein Consumer-Audit aller Dashboard-Bereiche entfernte tote
  Steuerelemente oder band sie an echte Daten (#79). Die 38 Windows-PowerShell-Installertests laufen erstmals in der CI
  (`installer-windows`, #79); dabei gefunden: eine verweigerte Job-Zuordnung beendete bei Zeitlimit/Abbruch nichts,
  jetzt endet der ganze Prozessbaum (#79). Das Dashboard-Update laeuft ueber die Vertrags-Pipeline mit Audit (#80).

- DASH-18.03/DASH-19.04/REL-06 (2026-10-30, N-146 bis N-155): Per Sprache lesbar sind jetzt auch Dateien (#113),
  Systemstatus, Auslastung und Skills (#114), das Wetter am gespeicherten Standort (#119) und der Stand der
  Ersteinrichtung (#122). Die Paritaetsmatrix uebersah Studio-Intents; korrigiert hat jeder der 20 Bereiche einen
  Sprachweg (#123). Das GitHub-ZIP enthaelt keine Agenten-Metadaten mehr, und der Dashboard-Sync
  kopiert keine Testschluessel (#115). Eine ZIP-Installation kennt ihren Commit (#116), die Systemseite nennt je Dienst
  die gepruefte Adresse (#118). `docs/RELEASE_COMPATIBILITY.md` fasst Versionen, Ports, Paketinhalt, Migrationen,
  Rollback und Nachweise zusammen (#120). Ein wackliger Orb-Freigabetest ist behoben (#117).
- DASH-18.03 (2026-10-30, N-156 bis N-161): Termine per Sprache anlegen, verschieben und loeschen darf wie im Kalender
  nur der Owner; vorher konnte ein Operator das und seine eigene Freigabe erteilen (#124). Die Terminabfrage per Sprache
  nennt auch lokale und verbundene Termine (#125). Bei Adapterausfall antworten die Sprach-Lesewege (Aufgaben, Agenten, Aktivitaet, Dateien, Gedaechtnis, Benachrichtigungen, Kalender, System) wie die Routen
  (#126). Der Orb haengt nicht mehr an einer Freigabe, die der Server nicht mehr kennt (#127); die Mikrofonpegel-Messung
  im Orb-E2E misst bei gestoerter Szene neu (#128). `dash-18-03-funktionsnachweis.md` belegt je Bereich Quelle,
  Persistenz, Rolle, Fehlerfall und Sprachaktion (#129).
- REL-06.03 (2026-10-30, N-162): Owner-Entscheidung zu Stimmdateien - eigene Referenz- und Sprecheraufnahmen bleiben
  lokal, jeder Nutzer erstellt sie selbst; ausgeliefert werden nur die synthetischen Stimmausgaben `friday_ref.wav` und
  `jarvis_ref.wav`. `.gitignore` und ein Allowlist-Test in `security-gate.test.ts` halten weitere Audiodateien aus dem
  Repository (#131).
- DASH-18.03 (2026-10-30, N-163): Auch Freigaben-Adapter und Studio-Anbieter haben einen Ausfallbeleg; der
  Funktionsnachweis fuehrt keinen Bereich mit externer Quelle mehr ohne Ausfalltest.
- INS-11/REL-06.03 (2026-10-30, N-164): Ein Dashboard-Update stoppt den Dienst, bevor es den alten Stand sichert. Die
  Installer-Selbstkopie und das GitHub-ZIP enthalten keine Installer-Tests mehr (#133).
- KEEP-03 (2026-10-30, N-165): Die Aktionsmatrix `dashboard-action-nlp-coverage.csv` ist neu gegen den Code geprueft:
  20 von 97 Aktionsfamilien haben einen getesteten Text-/Sprachweg, die uebrigen 77 einen genannten Grund. Der
  Audit-Detailbefehl hat jetzt einen Test. Offen bleiben Mehrschrittdialoge, Pronomen, Kanalwechsel und die
  NLP-01..06-Abnahme.
- DASH-12.03/DASH-11.03 (2026-10-30, N-166, N-170): Die Sprachseite zeigt das vorhandene Sprecherprofil mit echten
  Messwerten (#134); ein aelteres Profil ohne Messwerte heisst "Profilstand unbekannt" statt "kein Profil" (#141). Nach
  bestaetigter Sprecherpruefung nennt sie den Owner als erkannten Sprecher (#140).
- DASH-09.03/DASH-13 (2026-10-30, N-167, N-168): Die WhatsApp-Kopplung zeigt die Restzeit (#135); paralleler Start und
  Ablauf des Kopplungsfensters sind getestet (#139). Die Audiogeraete-Auswahl hat einen Oberflaechentest (#136).
- INS-07 (2026-10-30, N-169): Ein abgebrochener Lauf hinterlaesst kein unbrauchbares Python-venv mehr, und ein
  abgebrochener Dashboard-Neubau gilt beim naechsten Lauf nicht als fertig (#138).
- KEEP-06 (2026-10-30, N-171, offen): `keep-06-hermes-paritaet.md` dokumentiert die Abdeckung des Hermes-Inventars je
  Eintragsart. Die Einstellungen laufen nur ueber eine typisierte Allowlist (rund 85 von 814); ob ein allgemeiner
  Editor und Installationen aus dem Plugin-/Skill-Katalog kommen sollen, entscheidet der Owner.
- DASH-09.04 (2026-10-30, N-172, N-173): WhatsApp-Gruppen lassen sich im Dashboard freigeben (nur gelistete Gruppen,
  optional nur bei Erwaehnung), und die Kopfzeile ueber Antworten ist einstellbar statt fest "Hermes Agent" (#144).
  Zielgrammatik und Medienablehnung beim Senden sind getestet (#143). Antworten auf einzelne Nachrichten und Anhaenge
  bleiben beim Senden bewusst aus.
- DASH-08.02 (2026-10-30, N-174): Telegram-Gruppen lassen sich auf "nur bei Erwaehnung oder Befehl" stellen (#146);
  vorher antwortete Friday in einer freigegebenen Gruppe auf jede Nachricht. Discord erwartet die Erwaehnung schon
  standardmaessig.
- CI (2026-10-30, N-175, N-176): Die Befehlspalette fuehrt den angezeigten Eintrag aus, auch wenn Treffer spaeter
  darueber einsortiert werden (#147); die FFmpeg-Installation im Installer-Job wiederholt bei Feed-Ausfall und bricht
  sonst klar ab (#148).
- DASH-18.04 (2026-10-30, N-177, N-178): Folgebefehle nach einer Liste: nach "Zeige meine offenen Aufgaben" etwa
  "markiere die zweite als erledigt" oder "loesche sie" (#150), nach "Zeige meine Termine morgen" etwa "verschiebe den
  zweiten auf morgen 16 Uhr" oder "sag ihn ab" (#151). Friday merkt sich dafuer nur die Kennungen, 5 Minuten, pro
  Sitzung; unklare Bezuege fuehren zur Rueckfrage. Akzeptanzzeilen NLP-02 bis NLP-05 mit Testbelegen versehen.
- DASH-12.02 (2026-10-30, N-179, N-180): Sprecherprofil, Wake-Word-Modell und Ausgabestimme sind drei getrennte
  Artefakte: der Sprachdienst meldet Kalibrierung (Schwelle, Qualitaet, Trefferquote, eigene Aufnahmen) und
  Ausgabestimme (Platz, Stimmklon/vorgefertigt/Cloud, Plaetze mit Referenz) nur als Metadaten; die Sprachseite zeigt
  sie als eigene Zeilen (#154). Der eigene Stimmplatz (Option 3) wird jetzt wirklich in den TTS-Dienst installiert und
  vom Stimmen-Update mitgefuehrt; zuvor fehlten dann alle Stimmen bzw. scheiterte das Update (#153). Das persoenliche
  Wake-Modell traegt eine Formatversion; aeltere Dateien und ein ausstehendes Stimmen-Update werden auf der
  Sprachseite benannt (#157, N-182).
- DASH-16.02/16.05 (2026-10-31, N-184, N-185): Freitext in der Textleiste endete im Live-Modus mit "kein Adapter";
  jetzt geht er nach Bestaetigung als Hintergrundauftrag an den passenden Domain-Agenten, die Antwort kommt sofort
  (#159). Der Sprachdienst misst Antwortbeginn (Ende der Aufnahme bis erstes Audio), STT, Router, Sprecherpruefung und
  Modellantwort ueber die letzten 200 Befehle; die Sprachseite zeigt aktuell/Mittel/p95 (#160). Die Live-Messung
  "p95 <= 2 s" bleibt eine Owner-Abnahme. REL-01-Gates auf 988ed638 in `docs/agent-work/finalization/rel-01-gates.md`.
- DASH-07.04/10.06/11.05/12.05, KEEP-01 (2026-10-31, N-186..N-190): Anbieter lassen sich unter "KI-Zugaenge" ueber
  Hermes' eigenen Device-Code-Ablauf anmelden (nous, openai-codex, xai-oauth, minimax-oauth); Friday zeigt nur Code,
  Link und Ablaufzeit, Hermes speichert den Zugang (#165). Ein abgezogenes Skill-Laufwerk wird klar gemeldet und
  sperrt das Umschalten, statt die Liste umzuschreiben (#166). Ein abgebrochenes Sprecher-Training stellt das
  bisherige Profil wieder her (#162). Tests fuer Sprachseiten-Resync (#163) und Gedaechtnis MEM-03/05 (#164).
  Aufgabenstatus je Task in `docs/agent-work/finalization/task-status.md` (DASH-20.02). Echte Logins und Live-Tests
  bleiben Owner-Abnahmen.
- KEEP-03 (2026-10-30, N-181): Kanalwechsel-Regel fuer Vorschauen getestet und festgeschrieben (#156): ein zweiter
  Owner-Tab darf die identische Vorschau abschliessen, eine geaenderte Aktion, ein Viewer oder die Sprachbruecke nicht;
  Rueckfragen bleiben an die Sitzung gebunden.
- DASH-15.04 (2026-10-30, N-094, N-145): Die sieben Domain-Agenten laufen als eigene Benutzer, der Kanban-Lauf über
  alle sieben Profile ist bestanden. Eine Modell- oder Profiländerung gilt ab dem nächsten Worker-Start; ein laufender
  Lauf behält seine Route. Live am Profil research belegt und in `dash-15-16-orchestrierung.md` dokumentiert.
- Live-Nachweise 2026-10-30 (I-010, I-029, I-031, I-054, I-055, N-144): Downloads brechen einen stehenden Abruf nach 60 s
  ab und versuchen es erneut (#108). Die Wake-Restpuffer-Logik ist seit dem 16.10. im Repo, offen ist nur der Sprachtest.
  Ein Voice-Neustart wird im Health korrekt als offline und danach online gezeigt; abgebrochene Statusproben fuellen das
  Voice-Log nicht mehr (#107). Hermes liest und speichert den Content-Studio-Plan ueber eine eigene, auf den Plan
  begrenzte Bridge (#110). Der Owner-Reset ist in einer Sandbox abgenommen und zeigt keinen irrefuehrenden
  .env-Hinweis mehr (#109).
- INS-10 (2026-10-30, N-142): Auf der Live-Installation war der Hermes-Dashboard-Dienst nach einem SIGTERM 33 h aus, weil
  Restart=on-failure danach nicht neu startet und der Watchdog Hermes nicht kannte; das Command Center lief dadurch mit
  ausgefallenen Aufgaben-/Agenten-/Aktivitaetsadaptern. Die Unit startet jetzt immer neu, und der Watchdog startet einen
  inaktiven Hermes-Dashboard-Dienst ueber systemctl --user neu (#102). Live-Abnahme steht aus.
- REL-02/DASH-18.05/DASH-19.02 (2026-10-29, N-092, N-093, N-111, N-140): Aufgabenkarten-Fusszeile und Overview-Baseline
  per Sichtpruefung der ubuntu-24.04-Referenzbilder geschlossen. Alle E2E-Wiederholungen der letzten main-Laeufe lagen
  im SwiftShader-Projekt; der orb-freie Lastblock laeuft jetzt mit 2D-Fallback (#97). Der wiederholt rote TTS-Pausentest
  misst jetzt in der Seite ab dem ersten Frame, sucht die Pause erst nach dem lauten Plateau und laeuft mit 2D-Fallback
  (#98, #100; #98 allein reichte nicht). Der Umbenennungstest wartet auf den nachgeladenen Orb wie die Orb-Specs (N-141).
- KEEP-05/DASH-07.06 (2026-10-29, N-138, N-139): I-047 geschlossen; die alte Integer-ID-Engine ist nicht mehr im
  Produkt, und Plaene im alten Format oder mit unbekannten Zielen werden vor jedem Schreiben abgewiesen (#93). Eine nicht
  unterstuetzte Hermes-Version stoppt jede Konfigurationsaenderung mit klarem Hinweis statt "nicht erreichbar" (#94).
  Ein zufaellig roter Leck-Test im Event-Stream ist stabil (#95). FP-04 bleibt BLOCKED_EXTERNAL (echte Anbieter-Logins).
- DASH-13.05/DASH-19.04/INS-04 (2026-10-29, N-133 bis N-137): Die Voice-Seite zeigt "Wartet auf Audiogeraet" (#84).
  Das Dashboard-Update akzeptiert nur noch das eigene Dashboard auf dem Port (#86). Die Systemseite nennt die Version
  von Hermes und Voice-Dienst je Adapter (#91). Der Installer-Assistent bietet die eigene Stimme wieder als dritte Wahl
  mit eigenem Platz und zeigt "&" in Titeln (#87). Regressionstests schliessen I-033/I-034 (#89), I-052 (#85) und I-048
  (friday-skills #6); I-049 (friday-skills #5) ist im Code behoben, I-021 durch Wiederholung beim Aufraeumen gemildert (#90).

**Offen**: N-079 (`OPENAI_BASE_URL` beim Verlassen von `custom`) ist behoben (ff6327c). Danach DASH-08 (Telegram ueber
Produkt-Setup, Token vom Nutzer erneut noetig), DASH-07/15/16; am Ende mit Nutzer: Mailkonten, WhatsApp, Discord/Telefonie,
Mikrofontests, saubere Windows-VM, Windows-Kalender.

## 2026-10-31 Mock aus dem Produkt entfernt (Branch `chore/remove-mock-surface`)

Entscheidung des Operators: Friday wird ohne Simulationsdaten ausgeliefert; Mock-Daten gibt es nur noch als Testfixtures.

- **Konfiguration:** nur noch `config/dashboard.example.yaml` + `config/adapters.example.yaml` (live). Hybrid-/Live-/Mock-
  Varianten, `scripts/start-hybrid.mjs` und `pnpm start:hybrid` entfernt. Linux-Installer schreibt `dataMode: live` und
  migriert `mock`/`hybrid` nach `live` (Sicherung `dashboard.yaml.bak-dataMode-<UTC>`); `enable_voice_adapter.py --disable`
  schaltet die Sprache ab statt auf `mock-voice` zu wechseln.
- **Web:** Szenario-Konsole `/dev/scenarios`, Orb-Labor, Dev-Rollenwahl im Login, Live/Mock-Abzeichen, "Simulation"-Texte
  und der MSW-Standalone-Modus (`dev:mock`/`build:mock`, `lib/mock`, `mock-worker`) entfernt. Orb-Leistungsanzeige wirkt im
  normalen Betrieb. Die Web-App liest keine `NEXT_PUBLIC_*`-Variablen mehr.
- **Control API:** `src/` nutzt die Mock-Pakete nur als Typen; Mock-Welt/Szenario-Engine/Mock-Adapter nur über die
  injizierte `simulation` (`src/runtime/simulation.ts`, Implementierung `test-support/simulation.ts`). Ohne Simulation
  (jeder ausgelieferte Server) läuft eine alte `mock`/`hybrid`-Konfiguration mit Warnung als `live`; `auth.mode: dev` bricht
  den Start ab. `dist/main.js` ist rund 550 KB kleiner und enthält keinen Mock-Code (E2E-Spec `orb-debug-build.spec.ts`).
- **E2E:** Playwright startet `apps/control-api/.e2e-dist/e2e-server.js` (`pnpm --filter @friday/control-api build:e2e`,
  nie ausgeliefert). `apps/mock-console` und `pnpm scenario` entfernt.
- **Vertrag unverändert (bewusst):** dev-Operationen antworten ohne Simulation 404, `developer.scenarioConsole` ist ohne
  Wirkung, `dataMode`-Enum behält `mock|hybrid` für alte Konfigurationen. Ein Major-Bump hätte keinen sichtbaren Nutzen und
  würde das GitHub-Update alter Installationen riskanter machen.

**Zuletzt verifiziert (lokal, Windows):** `contracts:check`, `typecheck`, `lint` (0 Fehler), `pnpm test` 3973 bestanden
(1 Timing-Ausreißer im example-http-Shutdown, Wiederholung grün), `test:conformance` 415 bestanden, `build`, E2E-Auswahl
(orb-debug-build, navigation, settings, fallback-2d) grün; Linux `test_installer_modes.sh` und `test_voice_service.py` grün.

**Offen (Reihenfolge):** W2 Installer-GUI nur mit Klick-Steuerelementen, W3 Live-Gespräch (Qwen Audio) laut
`PLAN_LIVE_GESPRAECH_QWEN_AUDIO.md`, W4 robustes GitHub-Update, W5 Neuinstallations- und Update-Test mit dem Operator.

## 2026-10-31 Installer-Assistent nur mit Klick-Steuerelementen (Branch `feat/installer-click-gui`)

Vorgabe des Operators: Einstellungen per Dropdown, Durchsuchen, Haken oder Auswahl; Freitext nur für Namen, Zugangsdaten
und die Adresse eines eigenen Servers.

- **Installationsort:** Ordner nur per Ordnerdialog (Feld schreibgeschützt), WSL-Ablageort ebenso; Distributionsname als
  bearbeitbare Auswahl der vorhandenen WSL-Distributionen. Die Altinstallations-Haken erscheinen nur, wenn sie zutreffen
  (C:\Jarvis, JARVIS-Aufgaben, vorhandene Distribution, vorhandene `dashboard.yaml`).
- **Sprache:** Stimmreferenz nur per Dateidialog; ElevenLabs-Schlüssel auf dieser Seite (nur im ElevenLabs-Modus aktiv),
  Stimme als Auswahl, die per „Stimmen laden“ aus dem eigenen ElevenLabs-Konto gefüllt wird.
- **Persönlichkeit:** Freitext „Über dich“ entfernt (Persona-Feld `about` bleibt leer; Pflege im Dashboard ist offen).
- **KI-Zugang:** Anbieter OpenAI, Anthropic, **Alibaba Cloud Qwen (Token Plan, Region International/China)**, Kimi Coding,
  DeepSeek, OpenRouter, eigener Server; Modell als Auswahl je Anbieter; ein Schlüsselfeld für den gewählten Anbieter mit
  „Schlüssel prüfen“ (`GET …/models`). Ein eingerichteter Zugang wird bei Fortsetzung nicht erneut abgefragt.
- **Behobene Blocker:** Kimi-Schlüssel war bei jeder Neuinstallation Pflicht; ungültige Basis-URL oder Anbieterwahl
  führte im GUI-Modus zur Endlosschleife; die Rückfrage „zweite Installation“ brach im GUI-Modus mit „Unbekannte
  GUI-Entscheidung“ ab (jetzt klare Meldung mit dem vorhandenen Ordner). Ein auf dem PC gefundener Kimi-Schlüssel
  überschreibt im GUI-Modus nicht mehr still die Anbieterwahl. Anthropic-Standardmodell `claude-sonnet-5-5`.
- **Test:** neuer CI-Test `installer/tests/gui-controls.Tests.ps1` (Freitextfelder, Pfade nur per Dialog, Auswahlfelder,
  Anbieter, Pflichtangaben, keine `Read-Host`-Abfrage und keine Schleife im GUI-Modus).

**Zuletzt verifiziert (lokal, Windows):** alle 44 Installer-Tests inkl. der hostgebundenen (`gui-wizard-pages` mit
Simulationslauf, acht gezeichneten Seiten und Tastaturdurchlauf), `data-mode.test.ps1`; Parser ohne Fehler, BOM/CRLF.

**Offen:** dritter Sprachmodus „Qwen Audio (Alibaba)“ mit Schlüssel-Wiederverwendung wird mit W3 (Live-Gespräch) gebaut,
damit die Option nicht vor dem Backend erscheint; „Über dich“ im Dashboard-Profil.

## 2026-10-31 Live-Gespräch Phase 1: Qwen-Realtime-Client (Branch `feat/qwen-realtime-client`, LG-1.01)

Vorarbeiten P0-02 bis P0-12 gemessen; Ergebnisse stehen im Plan `PLAN_LIVE_GESPRAECH_QWEN_AUDIO.md` (Abschnitt 0b,
lokale Planungsdatei). Für die Umsetzung maßgeblich: Sprechende lokal erkennen und manuell committen, Ausgabe immer
Text+Audio (erste Antwort p50 0,62 s, p95 1,11 s; Server-VAD p95 6,5 s); der Server schließt eine Sitzung nach 180 s ohne
Antwort (Code 1007); das lokale Qwen3-4B wählt 26/30 Werkzeuge richtig, darum später Regeln vor dem Modell.

- **`installer/voice/qwen_realtime.py`:** asynchroner Client für `qwen-audio-3.0-realtime-plus` über den Token Plan
  (Region International/China), `session.update` mit Werkzeugen und optionaler Systemstimme, Audio in 100-ms-Stücken,
  Commit, Text-/System-Einträge, Werkzeugergebnis, Abbrechen, Wiederverbinden (nur bei Leerlauf/Netz/Ratenlimit),
  Fehlerklassen `auth`, `quota`, `rate`, `idle`, `network`, `protocol`. `websockets` wird erst beim Verbinden geladen.
- **`installer/voice/cloud_secret.py`:** sicheres Laden eines Cloud-Schlüssels (DPAPI je Windows-Benutzer, Linux feste
  0600-Datei) aus `elevenlabs_cloud.py` herausgelöst; ElevenLabs nutzt es unverändert, der Token-Plan-Schlüssel liegt
  unter Linux in `/etc/friday/secrets/alibaba-tokenplan.key`.
- **Update-Listen:** `cloud_secret.py` in `Get-VoiceSourcePaths` und `update-voice-personas.ps1` (Pflicht, weil
  `elevenlabs_cloud` es importiert). `qwen_realtime.py` kommt in die Listen, sobald `friday_voice.py` es importiert (LG-1.03).
- **Tests (CI):** `installer/voice/tests/test_qwen_realtime.py` gegen einen echten lokalen WebSocket-Server (Ablauf mit
  Text, Audio, Werkzeugaufruf und Leerlauf-Abbruch, HTTP 401, Kontingentfehler beim Aufbau, Schließen während des Lesens,
  Wiederverbinden) und `test_elevenlabs_cloud.py` neu in der CI-Liste.

**Zuletzt verifiziert:** Windows (websockets 15.0.1) 12/12; WSL Ubuntu (websockets 16.0) 15/15 inkl. POSIX-Schlüsseltest;
Abhängigkeitsprüfung und `test_configure_voice.py` 7/7; `dashboard-update-voice-integration.Tests.ps1` PASS; Gegenprobe
(Ratenlimit vor Kontingent vertauscht) rot; pyflakes ohne Befund.

**Als Nächstes:** LG-1.02 `ConversationOrchestrator` (Task-Register, Werkzeuge, Ansage-Queue), danach Einbau in
`friday_voice.py` (LG-1.03) und dritter Sprachmodus im Installer.
## 2026-10-31 Live-Gespräch Phase 1: Gesprächsschicht (Branch `feat/conversation-orchestrator`, LG-1.02)

- **`installer/voice/conversation.py` – `ConversationOrchestrator`:** gemeinsame Logik für den Qwen-Audio- und den lokalen
  Modus, ohne eigenes I/O. Werkzeuge `task_create` (Agenten research/tasks/alerts/audit, höchstens fünf parallel),
  `task_status` (laufende und zuletzt fertige Aufträge), `task_cancel` (eindeutig, Rückfrage bei mehreren),
  `zeit_datum` (ohne Locale). Baut auf dem vorhandenen Task-Register `DomainTaskVoice` auf; keine Task-IDs an das Modell.
  Feste Sätze (Abbruch, Uhrzeit, Stand) werden für das lokale Modell vorab geroutet (P0-06: 26/30 ohne Regeln).
- **Ansagen:** fertige Aufträge werden gesammelt, ab drei zusammengefasst, Ergebnisse auf 1 500 Zeichen gekürzt (Rest im
  Dashboard), als Daten markiert (nicht als Anweisung), während der Ruhezeit zurückgehalten und danach mit Hinweis
  angesagt, während Nutzer oder Stimme sprechen bis zur Pause verschoben. Gesprächsfenster 60 s.
- Mail und Kalender bleiben bei ihren bestätigten eigenen Sprachabläufen (Vertrag `VoiceDomainTaskRequest`); die
  Erweiterung der Domänen folgt mit LG-2.01. Einbau in `friday_voice.py` und Update-Listen mit LG-1.03.

**Zuletzt verifiziert:** `installer/voice/tests/test_conversation.py` 22/22 (neu in CI); Gegenprobe (Ruhezeit-Sperre
entfernt) rot; pyflakes ohne Befund.

## 2026-10-31 Live-Gespräch Phase 1: Qwen Audio im Sprachdienst (Branch `feat/qwen-dialog`, LG-1.03)

- **Entscheidung:** Der Gesprächsmodus ist ein eigener Schlüssel `conversation_backend` (`local` | `qwen`) in
  `config/voice.json`, nicht ein dritter Wert von `voice_mode`. `voice_mode` beschreibt den Audio-Stapel (lokal/ElevenLabs)
  und wird an rund 30 Stellen in Installer und Diensten geprüft; der Qwen-Modus braucht ohnehin den lokalen Audio-Stapel
  (lokale Stimme laut D-08, Whisper als Rückfall). Weitere Schlüssel: `qwen_key_file`, `qwen_region`.
- **`installer/voice/qwen_dialog.py` – `QwenDialog`:** hält die Realtime-Sitzung auf einer eigenen asyncio-Schleife für
  den threadbasierten Dienst. Verbindung beim Wake Word (während des Pieptons), Turn = geprüfte Äußerung senden und
  committen, Werkzeugaufrufe an den Orchestrator, Antworttext satzweise an die lokale Stimme, Cloud-Audio verworfen.
  Abbruch per Wake Word/Stopp sendet `response.cancel`; ein abgebrochener Turn schließt die Verbindung (keine
  Ereignisse der alten Antwort im nächsten Turn); nach 60 s ohne Turn wird die Sitzung geschlossen.
- **`friday_voice.py`:** Im Qwen-Modus beantwortet Qwen jede **geprüfte** Äußerung; Gäste ohne Sprecherprüfung bleiben
  lokal (kein unbestätigtes Audio in die Cloud). Fehler (`auth`, `quota`, Netz …) → derselbe Satz geht über den
  bisherigen lokalen Weg, Fehlerart steht in `status.qwen_error`. Von Qwen angelegte Aufträge bekommen denselben
  Hintergrund-Wächter; Ergebnisse laufen über die Ansage-Warteschlange des Orchestrators und werden Qwen danach als
  Daten mitgeteilt, damit Rückfragen dazu funktionieren. Bestehende Modi sind unverändert.
- **Installer/Update:** `qwen_realtime.py`, `qwen_dialog.py`, `conversation.py` in `Get-VoiceSourcePaths` und
  `update-voice-personas.ps1`; `websockets>=15,<17` in beiden Windows-Pip-Listen der Voice-Venv.
- **Rückfall (LG-1.04, F-02/F-03):** Vor der lokalen Antwort sagt die lokale Stimme einmal je Ausfallart an, was los ist
  (Schlüssel abgelehnt, Kontingent aufgebraucht, Drosselung, Modell nicht im Tarif, sonst „nicht erreichbar, ich nutze
  die lokale Stimme“); nach einem erfolgreichen Turn wird der nächste Ausfall wieder angesagt. Neue Fehlerart `model`.
- **Installer (GUI und Terminal):** Seite „Sprache & Stimme“ hat die Auswahlfelder „Gespräch“ (Lokal | Qwen Audio
  Live-Gespräch) und „Alibaba-Region“ sowie ein verdecktes Feld für den Token-Plan-Schlüssel. Ist beim KI-Zugang Alibaba
  Token Plan mit Schlüssel gewählt, wird dieser Schlüssel samt Region übernommen und das Feld darf leer bleiben. Der
  Schlüssel liegt DPAPI-verschlüsselt in `configlibaba_tokenplan.key.dpapi`; `voice_setup.py` schreibt
  `conversation_backend`, `qwen_region`, `qwen_key_file`. Ein Wechsel von Modus oder Region richtet den Sprachdienst neu ein.
- **Dashboard (LG-3):** Einstellungen → Sprache hat den Abschnitt „Gespräch“ (Lokal | Qwen Audio Live-Gespräch) mit
  Live-Status (aktiv, oder z. B. „Kontingent aufgebraucht – antwortet lokal“). Vertrag: `voice.conversationBackend`
  (optional, Standard `local`) und `VoiceStatus.conversation {backend, keyConfigured, lastError}`. Der Wert läuft als
  zehntes Laufzeitfeld über `POST /control/settings`; der Sprachdienst baut die Qwen-Sitzung vor dem Speichern auf (fehlt
  oder ist der Schlüssel unlesbar → 422, alter Modus bleibt) und tauscht sie nach dem Schreiben ohne Neustart aus.
  Ohne hinterlegten Schlüssel ist Qwen im Dashboard nicht wählbar und der Hinweis nennt den Installer-Weg. Alte
  voice.json ohne `qwen_key_file` bekommen den Standardpfad.
- **Stoppwort im Qwen-Modus:** Kurze Äußerungen (≤ 1,6 s) eines geprüften Sprechers prüft der Dienst zuerst lokal auf
  das Stoppwort („Stopp“, „Abbrechen“ …) und bricht ab, statt sie als Gesprächsbeitrag an Qwen zu senden; längere gehen
  direkt an Qwen (`STOP_PROBE_S`, Test `test_short_stop_word_cancels_instead_of_reaching_qwen`).
- **Moduswechsel ohne Ansageverlust:** Beim Umschalten Lokal↔Qwen gibt der alte Orchestrator noch nicht gesprochene
  Ergebnisse (`drain_announcements`) an die Ansage-Warteschlange zurück; der neue Modus spricht sie.
- **GitHub-Update (W4):** Das Update kopierte neue Sprachmodule, installierte aber keine neuen Python-Pakete; auf einer
  bestehenden Installation hätte `websockets` gefehlt. `update-voice-personas.ps1` installiert jetzt fehlende Pakete aus
  `$requiredPackages` in die Voice-Venv (nur wenn `import` scheitert; Ergebnis `present|installed|failed` in `result.json`,
  kein Abbruch des Updates). Zusätzlich meldet `QwenRealtimeSession.connect` ein fehlendes Paket als `RealtimeError
  protocol`, damit der Turn lokal beantwortet wird statt abzustürzen. Test `voice-update-packages.Tests.ps1`
  (inkl. Gleichstand der Versionsangabe mit dem Installer); Gegenproben rot.
- **GitHub-Update robuster (W4):** pnpm-Aufrufe laufen über `Invoke-Pnpm` (vorher brach unter PowerShell 5.1 mit
  `ErrorActionPreference = Stop` jede pnpm-Warnung auf stderr das Update ab – lokal belegt). Abhängigkeiten werden
  auch bei Änderungen an `pnpm-workspace.yaml`/`.npmrc` neu installiert (`Test-DependencyInstallNeeded`); ein
  fehlgeschlagenes `pnpm install` im Rollback wird jetzt als nicht bestätigter Rollback gemeldet. Die Update-Paketliste
  deckt alle Voice-Pakete ab, die der Installer in beiden Sprachbetrieben installiert; der Test erzwingt den Gleichstand.
  Tests `dashboard-update-pnpm.Tests.ps1`, `voice-update-packages.Tests.ps1`; Gegenproben rot.
- **Installer-Kopie per Update (W4):** `change-voice.bat`/`change-assistant-name.bat` starten `install-friday.ps1` aus
  `<Install>\installer`; das Update erneuerte diesen Ordner bisher nicht (neue Optionen wie Qwen Audio fehlten nach einem
  GitHub-Update in „Sprache ändern“). `Sync-InstallerCopy` überträgt jetzt geänderte, neue und gelöschte Installer-Dateien
  (Testdateien wie beim Erstinstaller ausgenommen) als letzten Schritt vor dem Revisionsmarker; lokal geänderte Dateien
  bleiben erhalten und werden gemeldet; bei einem Fehler wird die Kopie aus `updates\installer-copy-<RunId>`
  wiederhergestellt. Test `dashboard-update-installer-copy.Tests.ps1` (Git-Fixture, Fehlerfall); Gegenprobe rot.
- **Schlüssel im Dashboard (LG-3b):** Im Abschnitt „Gespräch“ lässt sich der Alibaba-Token-Plan-Schlüssel eingeben oder
  ersetzen (`setVoiceConversationKey`, POST `/api/v1/voice/conversation-key`, owner, CSRF). Der Sprachdienst prüft ihn mit einer
  kurzen Qwen-Audio-Sitzung (`qwen_realtime.verify_key`) und speichert ihn nur bei Erfolg per DPAPI für den Windows-Benutzer
  (`cloud_secret.save_secret`, Schlüssel nur über stdin, atomarer Austausch); eine laufende Qwen-Sitzung wird mit dem neuen
  Schlüssel neu aufgebaut. Abgelehnt/Kontingent/nicht erreichbar → 422 mit deutscher Meldung, gespeicherter Schlüssel bleibt.
  Linux: nur über den Installer. Der Schlüssel erscheint in keinem Log, Audit oder Fehlertext (Test prüft die Log-Ereignisse).
- **WSL-Update-Hülle:** `test_update_wsl_dependency_closure.py` prüft jetzt auch, dass jedes lokal importierte Nachbarmodul eines
  ausgelieferten WSL-Helfers mitkopiert wird.
- **Direkte Antworten im Gespräch (LG-2b.01/02):** Neues Werkzeug `friday_lesen` beantwortet Fragen nach Wetter,
  Einstellungen, offenen Aufgaben, Terminen (heute/morgen), Systemstatus, Benachrichtigungen, offenen Freigaben und Skills
  direkt aus dem Dashboard, ohne Hintergrund-Agent. Neue Operation `readVoiceQuery` (POST `/api/v1/voice/read`, nur lokale
  Voice-Bridge, nicht auditiert, weil rein lesend) nutzt die vorhandenen Leseabsichten von `read-query-intent.ts`; nur die
  Arten aus `VOICE_READ_KINDS` werden beantwortet (Audit, Gedächtnis, Dateien u. a. bleiben im Dashboard). Ohne Sitzung
  sperrt `executeReadQuery` alle anderen Arten selbst, egal über welche Bridge-Route. Antworten gehen als Daten markiert
  (gekürzt auf 1 500 Zeichen) an das Gesprächsmodell. Tests `voice-read.test.ts`, `ReadToolTest`,
  `test_read_posts_voice_read_and_truncates_text`; Gegenproben (Sperre/Owner-Fallback entfernt) rot.
- **Rechte-Zuordnung:** `setVoiceConversationKey` ist jetzt `settings.update` in der Aktionsmatrix.
- **Update-Prüfung (W4):** Der Healthcheck nach dem GitHub-Update verlangt zusätzlich, dass `/` die Weboberfläche
  ausliefert (vorher galt eine gesunde API ohne `apps/web/out` als Erfolg); sonst Rollback. Die installierten Build-Dateien
  vergleicht `Sync-BuildOutput` bereits per SHA256 mit dem Zielstand. Neuer Test `packages/config/test/installer-config.test.ts`:
  die vom Installer geschriebenen `dashboard.yaml`/`adapters.yaml` (aktuelle Vorlage aus `install-friday.ps1` und eingefrorene
  Fassung vom 2026-10-31 unter `test/fixtures/`) müssen mit dem aktuellen Schema laden, weil das Update diese Dateien nie
  ändert. Gegenproben rot (leere Startseite; entfernter Schlüssel).
- **Rückfragen per Stimme (LG-2.01):** Blockiert ein Agent eine Sprachaufgabe mit `needs_input`, liefert
  `getVoiceDomainTask` die Frage (`VoiceDomainTask.question`). Der Sprachdienst sagt sie sofort an, einmal je Frage; der Wächter
  läuft danach bis zum Endstatus weiter, und die Aufgabe bleibt im Register (vergessen werden nur Aufträge mit Endstatus). Der Orchestrator nimmt sie in seine Anweisungen auf (als Daten markiert), und das Werkzeug
  `task_antwort` gibt die Antwort über die neue Operation `replyVoiceDomainTask` (POST `/api/v1/voice/tasks/{taskId}/reply`, nur
  Voice-Bridge, Idempotency-Key Pflicht, Audit `tasks.voice_task_reply` ohne Antworttext) weiter; bei mehreren offenen Fragen fragt es
  nach. Der Hermes-Adapter kann jetzt `provideTaskInput` (Fähigkeit `tasks.input`): Besitzer-Kommentar über die Upstream-Route
  `POST /tasks/{id}/comments` (fließt in den Kontext des nächsten Workers) und danach `PATCH status ready` (`unblock_task`); nur bei
  `blocked` + `needs_input`, sonst 409. Beide Upstream-Routen gegen die Hermes-Installation in FRIDAY-2 geprüft (nur gelesen). Damit
  funktioniert auch die allgemeine Operation `provideTaskInput` des Dashboards mit Hermes. Tests: Hermes `tasks.test.ts` (4 neue),
  `voice-domain-task-reply.test.ts`, `TaskReplyTest`, `test_domain_task_voice.py`; Gegenproben (Statusprüfung, Entprellung) rot.
  Grenze: Offene Rückfragen kennt der Orchestrator nach einem Neustart des Sprachdienstes nicht mehr (die Aufgabe wartet weiter und
  lässt sich im Dashboard beantworten).
- **Ruhemodus (LG-2c, Teil 1):** Zentral in der Control API (`QuietModeService`, kv `quiet_mode.temporary_until`): neue Operationen
  `getQuietMode`/`setQuietMode`/`clearQuietMode` (`/api/v1/quiet-mode`, Owner oder Voice-Bridge, Audit
  `notifications.quiet_mode_set|cleared`). Aktiv ist er bei temporärer Ruhe (1 min bis 24 h) oder in der Nachtruhe aus
  `notifications.quietHours` (Zeitzone aus dem Profil, über Mitternacht). Sprachdienst: `QuietGate` (30 s Cache, bei Ausfall offen)
  hält proaktive Ansagen zurück; Werkzeug `ruhemodus` (an/aus, `minuten` oder `bis HH:MM`, Endzeit deterministisch in
  `quiet_until`, nicht vom Modell gerechnet). Gehaltene Ansagen kommen nach temporärer Ruhe gesammelt („Während der Ruhezeit …“),
  nach der Nachtruhe erst, wenn der Nutzer wieder spricht; die Ansageschleife prüft gehaltene Ansagen alle 30 s. Dashboard:
  Einstellungen → Benachrichtigungen → Ruhemodus (Dauer per Auswahl, Starten/Beenden), Kopfleiste zeigt „Ruhemodus/Nachtruhe bis
  HH:MM“. Seit Teil 2 auch im klassischen Ablauf wirksam. Tests: `quiet-mode.test.ts` (Dienst 8,
  App 1), `QuietModeControl.test.tsx`, `QuietModeTest`/`QuietGateTest`/`QuietUntilTest`, Gegenproben (Mitternachtsfenster,
  Nachtruhe-Freigabe) rot.
- **Ruhemodus (LG-2c, Teil 2):** Stufen `silent` (nichts verlässt F.R.I.D.A.Y.) und `voice_off` (Stimme aus, Wichtiges als Text),
  getrennt für Nachtruhe (`notifications.quietHours.level`) und befristeten Modus (`notifications.quietMode.level`, per Stimme
  `stufe` überschreibbar); `quietHours.summaryAt` (Endzeit oder erstes Gespräch); `importantClasses` (Rückfragen, Ergebnisse,
  Freigaben, Termine; Standard Rückfragen + Freigaben); `quietTextTargetId` = ein vom Owner registriertes Messenger-Ziel (sonst
  kein Versand). Neue Operationen `recordQuietNotice` (Sprachdienst meldet jede zurückgehaltene Ansage genau einmal; neue ausstehende
  Freigaben meldet die API selbst; Zustellung über `MessengerSendService.sendStaged` mit Journal, Text nie gespeichert oder auditiert),
  `getQuietModeSummary` (Titel der aktuellen/letzten Ruhephase, im Dashboard unter „Während der Ruhe“) und `setQuietHours`
  (Werkzeug `ruhemodus nachtruhe`, einzige Einstellungsänderung per Stimme). Werkzeug-Aktionen `abfragen`/`nachtruhe`,
  Zeitausdruck „heute Nacht“ (deterministisch bis 07:00). Der klassische Ablauf hält Ansagen jetzt ebenfalls zurück. Alte gespeicherte
  Benachrichtigungs-Einstellungen bekommen die Standardwerte beim Lesen. Dashboard: `QuietSettingsFields` (Auswahl + Schalter, keine
  Textfelder). P8-Matrix 116 Zeilen. Gegenproben rot (Versand trotz Stufe still, Nachtruhe-Freigabe zur Endzeit).
  Live-Versand (WSL-Bridge `messaging_send.py`) nicht ausgeführt – erst mit Nutzer im Live-Test (W5).
- **Eingebaute Hilfe (LG-2b.03–05):** Quelle `docs/friday-knowledge/*.md` (77 gepflegte Abschnitte: Seiten, Einstellungen, Abläufe,
  Fehlerbilder, Sprachbetrieb, Datenschutz; Format `## Titel` / `Stichworte:` / `Bereich:` / Text, gegen den Code geprüft) plus
  `settings.generated.json` (18 Einstellungsbereiche mit Beschriftung, Feldern und Standardwerten; installationsabhängige Werte
  markiert). `pnpm knowledge:build` (`scripts/knowledge/build-friday-knowledge.mjs`, tsx) schreibt zusätzlich das Bündel
  `installer/voice/knowledge/friday-knowledge.json` (95 Abschnitte), weil nur `installer/` auf den Rechner kommt; CI-Schritt
  `pnpm knowledge:check` schlägt bei veraltetem Stand fehl (Gegenprobe rot). Sprachdienst: `knowledge.py` (Stichwort/Titel/Text-
  Punkte, gemeinsamer Wortstamm, Stoppwörter, 1–3 Treffer mit Quelle), Werkzeug `friday_hilfe` und Systemprompt-Zeile mit der
  Bereichsübersicht. Installation kopiert `voice` jetzt rekursiv, beide Update-Dateilisten enthalten `knowledge.py` und das Bündel.
  Tests: `test_knowledge.py` (7), `test_knowledge_questions.py` (20 Hilfefragen, P0-12), `test_conversation.py`; Gegenprobe (Stamm-
  vergleich aus) rot; WSL-Voice-Liste 291 bestanden.
- **Kein `fetch()` mehr in Komponenten (Repo-Regel):** Wake- und Linux-Einlernen, STT-Modelle, Ortssuche, Wetter/Health in der
  Fußleiste, Browser-Audio-Verfügbarkeit und die MP3/MP4-Downloads im Content Studio riefen die Control API direkt per `fetch()` auf.
  Neue typisierte Domänenmodule in `lib/api/domains` (`wakeEnrollment`, `linuxEnrollment`, `sttModels`, `weather`, `health`,
  `contentStudioMedia`; Binärantworten über `parseAs: "blob"`, Idempotency-Key bleibt), Texte und Zeitlimits unverändert, Tests
  auf den FakeApi umgestellt. Wächter `tests/unit/web-no-raw-fetch.test.ts` schlägt fehl, sobald `fetch(` in `features/` oder
  `app/` auftaucht (einzige Ausnahme: die browserseitige Rückwärts-Geokodierung bei BigDataCloud); Gegenprobe rot.
- **Selbstdiagnose „Prüf dich“ (LG-2b.06):** `installer/voice/self_check.py` bewertet nur Live-Werte: Dienststatus (Mikrofon-Stream und
  -Fehler, Wake Word an/aus, Sprecherprüfung ohne Profil bzw. ≥ 3 Ablehnungen, Qwen-Schlüssel/-Fehler, Gedächtnis-Rückstau), Ruhemodus
  und Erreichbarkeit über `GET /quiet-mode` sowie den Systemstatus über `/voice/read`. Feste deutsche Sätze, keine Rohfehlertexte; Probleme
  zuerst, höchstens drei. Werkzeug `friday_diagnose` (Thema filterbar) im Qwen-Modus und Vorrang-Erkennung „Prüf dich“, „Selbsttest“,
  „Ist mit dir alles in Ordnung?“ in der lokalen Vorstufe beider Modi; Wissensabschnitt „Selbstdiagnose“. Tests `test_self_check.py` (29),
  `test_conversation.py`, Verdrahtung mit Fake-Status in `test_qwen_voice_wiring.py`; Gegenprobe (Vorrang aus) rot; WSL-Voice-Liste 356
  bestanden. Dabei gefunden und mitbehoben (nach dem Merge von #179): ein Python-`\f` hatte den Wissensbündel-Eintrag in `update-voice-personas.ps1` zu einem
  Seitenvorschub gemacht (Update wäre an `Assert-Ordinary` abgebrochen); neuer Installer-Test `voice-update-file-lists.Tests.ps1`
  prüft beide Update-Listen gegen das Repo, auf Steuerzeichen und auf Gleichheit.
- **Ansagen warten auf die Gesprächspause (LG-2.05, U-10):** Startete ein Hintergrund-Ergebnis, während der Nutzer sprach, brach
  `_record_command` die Aufnahme ab und der Satz ging verloren; `set_busy` wurde nirgends gesetzt. Jetzt markiert
  `user_speaking` laufende Sprache, die Ansage-Schleife wartet (`_wait_for_pause`, höchstens 120 s), solange der Nutzer spricht
  oder sein Befehl noch beantwortet wird; eine schon begonnene Aufnahme läuft bis zur Sprechpause weiter. Auftragsstatus wird
  alle 3 s statt 10 s abgefragt (Ersatz für den Push-Kanal aus LG-2.03), Ausfalltoleranz bleibt 30 s. Tests in
  `test_personal_wake.py` (4) und `test_domain_task_voice.py` (3); zwei Gegenproben rot; WSL-Voice-Liste 379 bestanden.
- **Ruhemodus-Abnahme 19–23 (LG-2c.05):** Lücken gefunden und geschlossen: Der lokale Modus verstand weder den Abnahmesatz
  „Die nächste Stunde will ich nicht gestört werden“ noch „Nachtruhe ist von 22 bis 7 Uhr“ noch „nur Stimme aus“ mit Dauer;
  eine Ruhezeit ohne zurückgehaltene Ergebnisse endete wortlos; „Ruhemodus aus“ sprach die Zusammenfassung erst in der
  nächsten Ansagerunde; Freigaben und Termine aus der Ruhezeit fehlten in der gesprochenen Zusammenfassung. Jetzt: Merker für
  laufende Ruhe (`observe_quiet`, alle 30 s im Dienst), nach Ablauf „Während der Ruhezeit …“ bzw. „Der Ruhemodus ist vorbei …“,
  Freigaben/Termine aus `GET /quiet-mode/summary` ergänzt (ohne Dashboard bleiben die Ergebnisse), „Ruhemodus aus“ antwortet mit
  der Zusammenfassung (während Nachtruhe bleibt sie zurückgehalten). Tests: `tests/test_quiet_acceptance.py` (17, beide Modi),
  API-Neustarttest in `apps/control-api/test/quiet-mode.test.ts`; fünf Gegenproben rot. Wissensabschnitt „Ruhemodus per Stimme“
  ergänzt.
- **Ruhemodus und Hilfe im lokalen Sprachbetrieb (LG-2c.03):** Der lokale Router hat keine Werkzeuge; eine deterministische Vorstufe
  in `_route` (nach der Uhrzeit) erkennt Ruhemodus-Befehle (an mit Dauer „für zwei Stunden“, „die nächste Stunde“, „bis 7.30 Uhr“,
  „heute Nacht“, Stufe „nur Stimme aus“; aus; abfragen) und Hilfefragen (Fragewort + Bedienwort) per `parse_local_command` und
  antwortet über dieselben Handler wie der Qwen-Modus (`ConversationOrchestrator.local_command`, `local_reply`; Hilfe: erster
  Abschnitt auf Satzgrenzen ≤ 400 Zeichen). Bedienfragen („Wie schalte ich den Ruhemodus ein?“) schalten nichts; ein bloßes
  „Sei still“ bleibt Stoppwort. Ohne Hilfetreffer oder bei Fehlern übernimmt der normale Router. Tests: Parser-Tabelle, Antworten,
  `_route`-Verdrahtung; Gegenprobe (Hilfe-Vorrang entfernt) rot; WSL-Voice-Liste 311 bestanden.
- **Benachrichtigungen im Live-Betrieb (PLAN §39):** Live gab es keinen Adapter für den Port `notifications`; `/notifications` lieferte
  CAPABILITY_MISSING, die Benachrichtigungsseite blieb leer, Übersicht und Orb sahen weder native Freigaben noch Alarme.
  `services/native-notifications.ts` legt eigene Alarme im vorhandenen `NotificationStore` an (Quelle
  `friday-native-notifications`, nur Dashboard-Eskalation – externe Kanäle brauchen eine Owner-Freigabe, die live noch fehlt),
  dedupliziert je Quelle+Kategorie, quittiert/schlummert/erledigt mit If-Match wie die Mock-Welt und weckt Geschlummertes beim
  Lesen; Einträge der Mock-Welt im selben Speicher bleiben unberührt. `handlers/notifications.ts` listet native Einträge neben einem
  Adapter und allein, wenn keiner konfiguriert ist (ein konfigurierter, ausgefallener Adapter bleibt 503). Erzeuger
  (`notification-producers.ts`, nur ohne Mock-Welt): Auftrag fehlgeschlagen und Rückfrage (`input_needed`) als P2, erledigt bei
  running/review/done/cancelled; Dienst offline als P1 (nicht bei STOPPING/STOPPED), erledigt bei online/paused; native Freigabe
  P2 (Stufe 3: P1), erledigt bei Entscheidung oder Ablauf (`onSettled`). Dabei gefunden: ausführbare Freigaben werden erst in
  `confirm()` vom Entwurf zu `pending` – dort fehlte `onPending`, also kam auch die Ruhemodus-Notiz für Freigaben nie an.
  Übersicht und Orb lesen native Freigaben (`listPending`) und Alarme mit; die Aufmerksamkeitsliste zeigt Freigabe- und
  Dienst-Alarme nicht doppelt. Tests: Dienst (14), Erzeuger (6), Live-Integration (3, Adapter-Alarm, If-Match, Freigabe-Zyklus);
  Gegenproben (beide Doppelungsregeln aus, `onPending` in `confirm` fehlt) rot. Offen: externe Eskalation live.
- **Backup- und Update-Fehler als Alarm:** Ein fehlgeschlagenes (geplantes) Systembackup und ein fehlgeschlagenes GitHub-Update
  hinterließen nur einen Eintrag in den Einstellungen. `BackupJobsService` meldet jedes Ergebnis über `onResult` (Fehler im
  Rückruf brechen das Backup nie ab): Fehler ⇒ P2 „Backup fehlgeschlagen“ mit Link `/settings?area=backups`, Erfolg erledigt ihn.
  Das Update-Ergebnis (`dashboard-update-result.json`, vom Update-Skript geschrieben) prüft die Laufzeit beim Start und alle
  5 min: Fehler ⇒ P2 „Update fehlgeschlagen“ mit Commit und Meldung, Link `/settings?area=dashboard`; ein späterer Erfolg erledigt
  ihn. Je Lauf genau einmal (Schlüssel `notifications.update_result_handled`), damit ein Neustart einen quittierten Alarm nicht
  wieder öffnet. Nur ohne Mock-Welt. Tests: Erzeuger (3), `backup-jobs.test.ts` (1), Live-Test `update-result-alert.test.ts`
  (Alarm, Quittung übersteht Neustart); Gegenprobe (Schlüssel nicht gelesen) rot.
- **Zustimmung für Qwen Audio (F-10):** Qwen ließ sich bisher ohne Hinweis auf die Datenübertragung einschalten. Neues
  Laufzeitfeld `voice.conversationConsent` (Sprachkonfiguration `qwen_consent`) und `VoiceStatus.conversation.consent`. Der
  Sprachdienst ist das Tor: `conversation_backend()` und `runtime_settings.effective()` melden ohne Zustimmung „local“,
  `validate()` lehnt Qwen ohne Zustimmung mit 422 ab (vor der Schlüsselprüfung), Laufzeitwechsel übergibt die Zustimmung an den
  Dialogaufbau. Installer-GUI: Pflicht-Haken unter dem Gesprächs-Hinweis, nur bei Qwen aktiv, ohne Haken bricht „Weiter“ mit Meldung
  ab; Konsole fragt j/n (nein ⇒ lokal); `voice_setup.py --qwen-consent` setzt die Zustimmung nur, wenn sie gegeben wurde, eine im
  Dashboard erteilte bleibt bei einem Stimmwechsel erhalten. Dashboard: Haken unter Einstellungen → Sprache → Gespräch; Qwen ohne
  Haken zeigt eine Meldung, Entfernen des Hakens widerruft sofort und schaltet auf lokal. Altinstallationen mit Qwen laufen nach dem
  Update lokal, bis der Haken gesetzt ist. Wissensbasis `datenschutz.md` ergänzt, Einstellungsmatrix +1 Zeile (117).
  Tests: Python (5 neu, Laufzeitwechsel mit Zustimmung/Ablehnung), Adapter-Mapping, Control API, Dashboard (6 neu), Installer
  (GUI- und Ablaufprüfungen); Gegenproben (Tor im Dienst entfernt: 3 rot; Dashboard-Prüfung entfernt: 1 rot).
- **Qwen Audio unter Linux (LG-6.05):** `install-friday-linux.sh` bietet im Browser-Sprachmodus (`--voice-mode elevenlabs`)
  das Live-Gespräch an: `--conversation qwen`, `--qwen-region`, `--qwen-consent`, Schlüssel per `--qwen-key-file` oder Abfrage
  (nie als Argument). `configure_voice.py` prüft alles vor dem ersten Schreiben (Qwen nur mit Zustimmung, Schlüssel 8–4096
  druckbare Zeichen), legt den Schlüssel mit 0600 unter `/etc/friday/secrets/alibaba-tokenplan.key` ab und rollt bei Fehler
  zurück; Sicherung, Wiederherstellung und Deinstallation kennen die Datei. Im lokalen Sprachmodus lehnt der Installer Qwen
  mit Hinweis ab (dort läuft kein Sprachdienst im Browser). CI: `test_configure_voice.py` (15) und neuer Schritt
  `test_installer_modes.sh`. `docs/LINUX_VOICE.md` ergänzt.
- **Anleitung und Update (LG-7.01/7.02):** `installer/ANLEITUNG.md` beschreibt Qwen Audio (Zustimmung, Schlüssel, Rückfall,
  Umschalten im Dashboard). Pester-Test sichert, dass das Stimm-Update nur Programmdateien kopiert und `voice.json` sowie den
  Qwen-Schlüssel nie anfasst; Gegenprobe rot.
- **Keine Wirkung aus eingeschleusten Daten (LG-2.06):** Hat das Gesprächsmodell in einem Zug Agenten- oder Lesedaten
  (`task_status`, `friday_lesen`) erhalten, lehnt der Orchestrator im selben Zug jedes Werkzeug mit Wirkung (`task_create`,
  `task_cancel`, `task_antwort`, `ruhemodus`) ab und bittet um eine eigene Anweisung; jede neue Äußerung des Owners
  (Qwen-Zug oder lokaler Befehl) setzt das zurück. Tests: 5 Orchestrator-Fälle plus ein Ende-zu-Ende-Fall im Qwen-Dialog;
  Gegenprobe 4 rot.
- **Gesprächsende (LG-1.03, D-03):** „Danke, das war's“, „Das ist alles“, „Tschüss“ u. ä. beenden das Gespräch sofort
  (Antwort „Gern. Ich bin da, wenn du mich rufst.“, Gesprächsfenster zu, nächster Auftrag braucht das Wake Word). Im
  Qwen-Modus fängt die lokale Kurzprüfung den Satz ab, er erreicht das Modell nicht. Stille bis Gesprächsende jetzt 20 s
  (Windows und Linux); Installationen mit 8 oder 15 s werden beim nächsten Stimm-Setup angehoben, eigene Werte bleiben.
  Wissensbasis und Anleitung angepasst. Tests: Phrasentabelle, Qwen- und Lokalweg, Folgefragen-Schleife endet; Gegenprobe 2 rot.
- **Hilfe in jedem Einstellungsbereich (LG-5.08):** Knopf „Hilfe“ im Kopf jedes der 18 Bereiche zeigt die passenden
  Abschnitte der Wissensbasis (Bereichsbeschreibung aus `einstellungen.md` plus jede Anleitung aus `ablaeufe.md`, die auf den
  Bereich verweist). Der Wissensbasis-Build erzeugt dafür `settingsHelp.generated.json`; das Dashboard braucht keinen
  API-Aufruf, `knowledge:check` meldet einen veralteten Stand, und ein Bereich ohne Hilfe bricht den Build ab.
- **Sprachtests vollständig in der CI (LG-1.05):** Elf Testdateien lagen neben der CI-Liste und waren teils veraltet. Jetzt in
  der Liste; repariert: Onboarding-Tests setzen unter Linux `FRIDAY_DATA_DIR` auf das Testverzeichnis (sonst schrieb der Dienst
  nach `/var/lib/friday`), Dispatcher-Test kennt `record_latency`, Persona-Test stubbt `huggingface_hub` und schlägt bei einem
  Download fehl; CI installiert `soundfile` (Version der Sprachumgebung). Dabei gefunden: `test_configure_voice` lud
  `elevenlabs_cloud` gegen einen numpy-Stub neu und ließ das Modul so zurück, nachfolgende ElevenLabs-Tests scheiterten; lädt jetzt
  echtes numpy nach. WSL, komplette CI-Liste: 800 bestanden, 16 übersprungen.
- **Gesprächseinstellungen im Dashboard (LG-5.04):** Einstellungen → Sprache → Gespräch hat jetzt „Stille bis Gesprächsende“
  (5–120 s, Standard 20; `voice.conversationSilenceSeconds` ⇒ `followup_window_s`) und „Ergebnisse von sich aus ansagen“
  (`voice.proactiveAnnouncements` ⇒ `proactive_announcements`, fehlend = an). Beide sind Laufzeitfelder (13 statt 11, Vorprüfung im
  Sprachdienst, CAS/Rücklesen wie die übrigen). Aus: Ein Ergebnis außerhalb eines Gesprächs wird zurückgehalten (höchstens 10) und
  direkt nach der nächsten Anfrage als „Seit unserem letzten Gespräch: …“ gesagt; wieder an gibt die Rückstände innerhalb von 30 s
  frei, außer der Ruhemodus ist aktiv (Ruhemodus hat Vorrang). Ankündigungsweg dafür in `_deliver_announcement` gebündelt.
  Ruhezeiten bleiben unter Benachrichtigungen (Text verweist darauf); Vollduplex (D-09, Option für Headsets) ist nicht
  enthalten. Vertrag: zwei optionale Felder ohne Default, SDK neu; Einstellungsmatrix 119. Tests: Python (Laufzeitfelder,
  Zurückhalten/Freigabe/Gespräch offen/Ruhemodus), Control API und Adapter mit vollständigem Feldsatz, Dashboard (Regler und
  Schalter speichern); Gegenproben (Zurückhalten aus, Ruhemodus-Vorrang aus, Mapping aus) je rot.
- **Gesprächsmodus und Sprachaufträge sichtbar (LG-5.05):** Die Sprachseite hat eine Statuszeile „Gespräch“ (Lokal / Qwen Audio,
  Cloud in Ordnung oder Grund der Störung mit „antwortet bis dahin lokal“, Hinweis wenn Qwen eingerichtet, aber nicht gewählt
  ist) und einen Bereich „Aufträge aus Gesprächen“: Aufgaben mit Label `tenant:voice-<domain>` (höchstens 6, neueste zuerst)
  mit Status, Hinweis bei „Wartet“, Klick öffnet die Aufgabe. Die Seitenleiste zeigt den Gesprächsmodus als fünfte Statusmarke.
  Ältere Sprachdienste ohne `conversation` zeigen weder Zeile noch Marke. Wissensbasis (Seite Sprache) erklärt beides.
  Tests: Statuszeile (in Ordnung/gestört/fehlt), Aufgabenfilter und Navigation, leere Liste, Seitenleiste; Gegenproben
  (Filter aus, Zeile aus) je rot.
- **Hörprobe und vorhandener Alibaba-Schlüssel (LG-5.03, LG-6.01):** Einstellungen → Sprache → Ausgabe hat „Hörprobe“:
  `POST /api/v1/voice/sample` (Owner, CSRF) → Sprachdienst `/control/voice/sample` spricht einen Satz mit der gespeicherten
  Stimme, nur wenn nichts anderes läuft (sonst 423 → CONFLICT), ohne Verlauf; gesperrt, solange eine neu gewählte Stimme nicht
  gespeichert ist (Gegenprobe rot). 306 Operationen. Das Anlernen einer eigenen Cloud-Stimme entfällt (P0-01, D-08). Der
  Installer erkennt `BAILIAN_API_KEY`/`DASHSCOPE_API_KEY` im Benutzerprofil wie den Kimi-Schlüssel: GUI-Haken „Auf diesem PC
  gefundenen Alibaba-Schlüssel verwenden“ (verschlüsselt übergeben, im Laufprotokoll geschwärzt), Konsole fragt einmal.
- **Antwortfenster nach einer Ansage von sich aus (LG-2.04):** Spricht der Sprachdienst eine Ansage, während kein Gespräch
  läuft, öffnet er danach ein Antwortfenster ohne Aktivierungswort (`reply_window`, Länge `followup_window_s`). Die
  Sprecherprüfung bleibt (`_handle_command` mit `wake_audio=None`); kein Fenster im Gastmodus, pausiert oder mitten im
  Gespräch; Stopp schließt es; das Aktivierungswort während der Ansage hat Vorrang. Qwen Audio bekommt Ansagen, die ohne
  offene Sitzung gesprochen wurden, beim nächsten Verbindungsaufbau als System-Item (höchstens fünf), damit es Rückfragen
  beantworten kann. Gegenproben: ohne `reply_window.set()` bzw. ohne das Nachreichen werden die Tests rot.
- **„Verbindung prüfen“ für den gespeicherten Qwen-Schlüssel (LG-5.02):** Neben „Schlüssel ersetzen“. `POST
  /api/v1/voice/conversation-key/check` (Owner, CSRF) → Sprachdienst `/control/conversation-key/check` lädt den gespeicherten
  Schlüssel, öffnet eine kurze Qwen-Sitzung mit der gespeicherten Region und meldet `ok` oder den Grund (`missing`, `auth`,
  `quota`, …). Nichts wird gespeichert oder umgeschaltet, der Schlüssel verlässt den Sprachdienst nicht (Test). Neues Schema
  `VoiceConversationKeyCheck`; 305 Operationen. Der Guthabenstand aus LG-5.02 entfällt (P0-08).
- **Schlüssel des Denkmodells für Qwen Audio übernehmen (LG-4.05):** Neuer Knopf unter Einstellungen → Sprache → Gespräch.
  `POST /api/v1/voice/conversation-key/from-brain` (Owner, CSRF, ohne Body): Die Hermes-Bridge liest in WSL mit der neuen Aktion
  `brain-qwen-key` die Basis-URL (`model.base_url`, sonst `OPENAI_BASE_URL`) und den Schlüssel (`model.api_key`, sonst
  `OPENAI_API_KEY`/`DASHSCOPE_API_KEY` aus `~/.hermes/.env`). Nur bei einer Token-Plan-URL gibt sie Schlüssel und Region auf der
  Pipe an die Control API zurück; die reicht ihn an `setConversationKey` (Prüfung bei Qwen, DPAPI). Er erscheint in keiner
  Antwort, Meldung oder Audit-Zeile (Kanarientests in Bridge und Control API). Weicht die Region des Denkmodells von der
  gespeicherten Qwen-Region ab, kommt vorher eine klare Meldung statt eines scheinbar falschen Schlüssels. Live gegen eine echte
  Hermes-Installation nicht geprüft.
- **Qwen-Region im Dashboard (LG-4.01):** Einstellungen → Sprache → Gespräch hat „Qwen-Region“ (International/Singapur oder
  Festlandchina/Peking). Neues Laufzeitfeld `voice.conversationRegion` (fehlend = `ap-southeast-1`), im Sprachdienst
  `qwen_region`; Vorprüfung und Rücklesen wie die übrigen Laufzeitfelder (14 statt 13; Matrix 120 Einträge). Ein Wechsel
  während Qwen spricht baut die Sitzung auf dem neuen Endpunkt neu auf (bei lokalem Gespräch kein Neuaufbau; Gegenprobe rot).
  Da der Sprachdienst einen neuen Schlüssel gegen die gespeicherte Region prüft, sperrt die Oberfläche „Prüfen und speichern“,
  solange eine geänderte Region ungespeichert ist, und sagt das. Die Ablehnungsmeldung nennt jetzt Schlüssel und Region.
  Live gegen Alibaba nicht geprüft.
- **Installer fragt nach demselben Alibaba-Schlüssel (LG-6.02, U-02):** Mit Qwen Audio als Gespräch und Alibaba Cloud Qwen
  (Token Plan) als Denkmodell zeigt die Seite KI-Zugang den Haken „Diesen Schlüssel auch für Qwen Audio (Live-Gespräch)
  verwenden“ (vorbelegt; nur sichtbar, wenn auf der Sprachseite kein eigener Qwen-Schlüssel steht). Bisher wurde der
  Brain-Schlüssel stillschweigend übernommen. Die Sprachseite hat „Schlüssel prüfen“ gegen
  `token-plan.<region>.maas.aliyuncs.com/compatible-mode/v1/models` (401/403 ⇒ „lehnt ab, Region prüfen“). Die Konsole fragt im
  Hermes-Schritt bei Token-Plan-Basis-URL und Qwen-Gespräch „Gleichen Alibaba-Schlüssel auch für Qwen Audio verwenden?“ und legt
  die DPAPI-Datei samt Region aus der Basis-URL an (GUI-Modus überspringt das, die Oberfläche liefert den Schlüssel selbst).
  Nebenbei behoben: Die Beschriftungen „Region“ und „Server-Adresse“ fehlten auf der KI-Zugangsseite, weil sie aus `.Visible`
  einer noch verborgenen Seite abgeleitet wurden; die Anordnung läuft jetzt beim Anzeigen der Seite (`Update-ProviderLayout`).
  Der Simulationslauf zeichnet zusätzlich den Qwen-Block der Sprachseite und die KI-Zugangsseite mit der Frage und belegt, dass
  sie bei lokalem Gespräch verschwindet (Gegenprobe rot). Installer-Tests: 48 Dateien; `gui-installer` war im Sammellauf
  einmal rot (Tastaturrunde Sprachseite) und danach viermal einzeln grün.
- **Noch nicht enthalten:** Cloud-Stimme ohne lokale TTS (D-08 zweiter Weg, LG-6.04), Umschalt-Auftrag (LG-4.03),
  Einführung im Dashboard (LG-5.07), Push statt Polling (LG-2.03).

**Zuletzt verifiziert:** WSL Ubuntu, komplette Voice-Testliste der CI plus neue Tests: 224 bestanden, 1 übersprungen;
Windows `test_qwen_dialog.py` 14/14; LG-3: WSL-Voice-Liste 226 bestanden, Gegenprobe Dialogtausch rot; `pnpm contracts:check`, `typecheck`, `lint`, `test` (ein Last-Timeout in `security.test.ts`, einzeln 28/28), `test:conformance`, `build` grün; `check_p8_matrix.py` 111 Zeilen; Gegenproben rot (Sitzung nach Abbruch nicht geschlossen; Gast-Audio an Qwen);
PowerShell-Parser ohne Fehler; `dashboard-update-voice-integration`, `dashboard-update-wsl-bridges`, `voice-slots`,
`voice-native-capture`, alle `gui-*.Tests.ps1` (9) PASS.
