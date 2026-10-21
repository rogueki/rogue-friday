# Inventory consolidation (BASE-02 / DASH-01 / INS-01)

Recorded 2026-10-21 on `e98cbf5` + working branch `feat/friday-finalization-20261021`.
One ledger, no second inventory: this page only joins existing machine-readable tables and adds the two that
were missing. Every table below is a file in this repository, not a prose claim.

## 1. Tables and their real source revisions

| Inventory | File | Rows | Source revision of the data | Fresh enough for this task? |
|---|---|---|---|---|
| Requirements (all sources) | `requirements.csv` | 168 | master plan 21.10.2026 + six plans + Vollintegration §§5–17 + Journal | **yes**, created against `e98cbf5` |
| Issues/defects | `issue-ledger.csv` | 80 | I-001..I-062 (journal), FP-01..12 (FIXPLAN), N-001..006 (this session) | **yes**, every row has a current assessment |
| UI page → data source → consumer → status | `../hermes-full-integration/dashboard-coverage.csv` | 20 areas | `e6f23c7` (19.10.2026) | partially — area level only, no callback proof (`ACTION_ROW_LEVEL`) |
| UI action → native/NL path | `../hermes-full-integration/dashboard-action-nlp-coverage.csv` | 97 | `e6f23c7` | partially — `SOURCE_TRACE_ONLY`, runtime `NOT_RUN` |
| Setting → apply → readback → restart | `../hermes-full-integration/settings-runtime-map.csv` | 110 fields | `e6f23c7` | partially — most acceptance cells are `NOT_RUN` |
| Hermes function → Friday target → gap | `../hermes-full-integration/hermes-feature-inventory.json` | see `items` | Hermes `d923a5eb487a` (v0.22.2), Friday `e6f23c7` | yes for Hermes side (installed version is identical), Friday side stale |
| Hermes config key → bridge/consumer | `../hermes-full-integration/p7d-config-matrix.csv` | 97 keys | Hermes `d923a5eb487a` | yes for Hermes, consumers partly unverified |
| Installer component → artifact → health | `installer-inventory.csv` | 16 | `e98cbf5` + live install `D:\Dokumente\F.R.I.D.A.Y` | **yes**, new in this session |

Rule that was applied: a table that was produced on an older revision is kept as the row-level source but its
status column is **not** promoted. Stale `NOT_RUN`/`SOURCE_TRACE_ONLY` cells stay what they are; the rows that
matter for the next tasks are re-proven on `e98cbf5` when the task is executed.

## 2. Requirement coverage (DASH-01.04)

- The master plan contains **154** checklist items: 141 bold-ID items plus `INS-01`..`INS-13` in the todo block.
  Verified by counting `^- \[ \]` lines in `FRIDAY_FINALER_UMSETZUNGSPLAN.md`.
- `requirements.csv` has **168** rows, one for every REQ-01..22, every legacy acceptance criterion
  (MEM/MAIL/MSG/CAL/NLP/STOP/UI-STOP/AUDIO/SETTINGS-ALL), every item of the six single plans
  (FIXPLAN, provider, skills, voice selection, GUI, parity) and one owning row per master task
  (BASE/KEEP/INS/DASH/REL). Script check: **0 master IDs without a ledger row**, 0 duplicate IDs.
- `issue-ledger.csv` carries all 62 journal entries, all 12 collection-list items and the six findings of this
  session. No journal ID is missing; the current assessment column says explicitly whether a row is
  `FIXED_PROVEN_CODE` (source evidence exists now), `FIXED_NEEDS_REGRESSION`, `OPEN`, `BLOCKED_EXTERNAL` or
  `HISTORICAL_*` (no product effect).

## 3. Status honesty

Not a single row is marked `PASS` because it was once reported done. Current PASS marks:

| ID | Basis |
|---|---|
| `REQ-22` | the master plan exists, was read completely and its 154 checklist IDs were counted |
| `BASE-01` | `baseline.md` records checkout, revision, runtime, ports, versions and explicit non-checks |
| `N-005` | counter check: 154 items confirmed, `INS-*` are simply not bold |

Everything else is `OPEN`/`IN_PROGRESS` and needs a fresh proof in its own task.

## 4. Installer inventory — what the live installation actually proves

`installer-inventory.csv` maps the 15 installer steps to their artifacts and a checkable health signal, and it
records which of those signals were observed **now**:

- 13 steps have a current, observed signal (files parse, ports answer, scheduled tasks are `Ready`,
  distro registry `BasePath` equals `D:\Dokumente\F.R.I.D.A.Y-wsl`, two `wsl.exe … sleep infinity` keepalive
  processes exist, build artifacts `dist/main.js`, `web/out`, `node_modules`, `data` exist).
- Step 3 (`wsl --update`) stays `PARTIAL` because of the historical hang (I-008).
- Step 4 (power settings) and step 13 (speaker enrollment) stay `HISTORICAL`: no current re-check was run.
- **Step 15b fails on purpose**: the delivered `config/adapters.yaml` activates `dataMode: hybrid`, which fills
  ten categories with `mock-*` adapters, and the live health endpoint reports them as `online`
  (`mock-memory`, `mock-approvals`, `mock-communication`, `mock-calendar`, `mock-automations`,
  `mock-research`, `mock-files`, `mock-notifications`, `mock-audit`, `mock-commands`). That is the concrete
  defect `DASH-03` has to remove; it is recorded as `N-001`.

## 5. Consequence

The shared baseline is complete. `BASE-03`/`DASH-02` (contracts and write scopes) come next, then `DASH-03`
(real wiring without mock fallback) — starting with the installer's delivered data mode and the honest
"not configured" state that has to replace a green `mock-*` row.