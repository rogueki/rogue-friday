# DASH-03 — production path without simulation (work record)

2026-10-21, branch `feat/friday-finalization-20261021`. Base `e98cbf5`, work commit follows this file.

## 1. What was actually wrong (proven, not assumed)

| Finding | Proof |
|---|---|
| The installer shipped `dataMode: hybrid` | `installer/install-friday.ps1:2123` before the change; installed `D:\Dokumente\F.R.I.D.A.Y\dashboard\config\dashboard.yaml` has `dataMode: hybrid` |
| Hybrid creates a `mock-*` adapter for every category without a real provider | `packages/config/src/load.ts` `resolveAdapters`: `origin: 'mock-preset'` for `mode !== 'live'` |
| The live health endpoint therefore reported ten simulated adapters as `online` | `GET /api/v1/health` on the running installation, components `mock-memory`, `mock-communication`, … `status: online` (`N-001`) |
| The runtime itself was already honest in `live` | `adapter-wiring.ts:241` `if (config.dataMode === "live") return undefined;` → no `MockWorld`; `create-runtime.ts:247` scenario engine only in `mock`; `adapter-wiring.ts:175` `provider === null` → no adapter |

So the defect sat in the shipped configuration plus one stale-override hole, not in a missing runtime switch.

## 2. Changes

| File | Change |
|---|---|
| `installer/install-friday.ps1` | template `dataMode: live` + honest comments in `dashboard.yaml`/`adapters.yaml`; dot-sources the new module; calls `Set-ProductionDataMode` after writing the config |
| `installer/lib/data-mode.ps1` (new) | `Set-ProductionDataMode` / `Get-ConfiguredDataMode`: move an existing `mock`/`hybrid` config to `live` with a timestamped backup, comment-preserving regex, `-DryRun` support |
| `packages/config/src/load.ts` | production warning `dataMode "…" in a production run: categories without a real provider are simulated` |
| `apps/control-api/src/runtime/adapter-wiring.ts` | a saved provider override that points at `mock-*` is ignored when no mock world exists (live), with an explicit warning instead of a silently simulated adapter |
| `installer/test/data-mode.test.ps1` (new) | proves migration, backup, dry run, missing file and that the template ships `live` |
| `apps/control-api/src/runtime/adapter-wiring.test.ts` (new) | proves the stale mock override is dropped in `live` and kept in `hybrid` |
| `packages/config/src/config.test.ts` | proves the production warning fires for `hybrid`, not for `live`/`development` |

## 3. Evidence

| Check | Command | Result |
|---|---|---|
| installer parses | `Parser::ParseFile(installer/install-friday.ps1)` | `parse ok` |
| migration + template | `powershell -NoProfile -File installer/test/data-mode.test.ps1` | `data-mode tests: all checks passed` (exit 0) |
| config semantics | `pnpm --filter @friday/config test` | 54 passed |
| wiring guard | `vitest run src/runtime/adapter-wiring.test.ts` | 2 passed |
| live runtime has no mock adapters | existing `test/real-adapters.test.ts` "live example: configured categories are real, every other one is absent" | adapter list exactly 5 real entries; `/api/v1/memory` ≥ 400 |
| typecheck | `pnpm typecheck` | exit 0 |
| lint | `pnpm lint` | exit 0 (2 pre-existing warnings in web) |
| contracts untouched | `pnpm contracts:check` (earlier this session) | exit 0 |

## 4. Deliberate consequences for an existing installation

- The next `update-dashboard.bat` run rewrites `dataMode: hybrid` → `live` **once**, writes
  `backups/dashboard.yaml.bak-dataMode-<stamp>` and logs a warning line. Reversible by restoring that backup.
- After the restart the ten categories without a real adapter are **absent**: no memory, communication,
  calendar, automations, research, files, notifications, audit or commands adapter. Their pages must render
  "nicht eingerichtet" — that is exactly the work of DASH-04/05/06/08/09 and the reason they are next in order.
- `voice`, `tasks`, `activity`, `agents`, `system` keep working through their real adapters.

## 5. Acceptance run 2026-10-21 23:43 (DASH-03.04 / 03.05)

**Fresh runtime with empty real sources** — `apps/control-api/test/live-empty-sources.test.ts`, live mode, new
data directory, one configured adapter pointing at a dead upstream:

| Check | Result |
|---|---|
| adapter list | exactly `tasks:hermes-tasks`, no `mock-*` |
| health components | no `mock-*` component |
| `/api/v1/tasks` with dead upstream | error (≥ 500) or 200 with `items: []` — never fabricated tasks |
| `/api/v1/memory`, `/api/v1/automations`, `/api/v1/communication/channels`, `/api/v1/agents` | each ≥ 400 (category not configured) |
| `/api/v1/skills` | 200 with `data: []` (real catalog, empty installation) |
| restart with the same data directory | same adapter list, automations still ≥ 400 — no demo automation is created |

**Rollback drill** — `scripts/finalization/rollback-drill.ps1` restores the BASE-04 snapshot into
`D:\Dokumente\F.R.I.D.A.Y-acceptance\rollback-drill-20261021-233904`, rewrites port/paths (live installation
untouched) and boots the built control API:

| Run | Result |
|---|---|
| restored configuration as-is (`hybrid`, adapters off) | health `online`, contract 2.0.0, **19 components, 15 simulated adapters online** — the defect reproduced on a restored snapshot |
| same snapshot + `Set-ProductionDataMode` (`-Migrate`) | `dataMode: live`, health `online`, contract 2.0.0, **4 components, 0 adapters online**, no mock warning in the log |

That is the A/B proof that the migration flips a restored installation from simulation to live without losing
its database (the restored `dashboard.sqlite` checked `ok` before the boot).

**Honest not-ready state** — booting the built API with `dataMode: turbo` exits with code 2 and
`Invalid configuration (1 problem): [dashboard.yaml] dataMode: must be one of: mock, hybrid, live (got "turbo")`.
No silent fallback to a default mode.

**Limit of this evidence:** the runtime acceptance is a fresh runtime, not a physical installer run on a clean
machine. That run stays with INS-13/REL-03 and is not claimed here.