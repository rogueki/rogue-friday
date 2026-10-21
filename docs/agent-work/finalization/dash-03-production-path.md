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

## 5. Still open for DASH-03 (not claimed as done)

- `DASH-03.04` acceptance demands a **fresh installation** with empty real sources: 0 business entries, an
  outage shows an error, a restart creates no demo automation. That run belongs to INS-13/REL-03; the current
  evidence is a live-mode runtime test with an empty data directory, which is necessary but not sufficient.
- `DASH-03.05` recovery requires the snapshot rollback from `acceptance-environment.md` to be exercised once
  against the new configuration (documented procedure, not yet drilled).
- Honest UI labelling of a *deliberately* simulated development instance (hybrid) is part of DASH-04.