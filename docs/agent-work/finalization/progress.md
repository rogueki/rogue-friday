# Finalization progress — session handoff

Last updated: 2026-10-21 23:05 (Europe/Paris). Branch `feat/friday-finalization-20261021`, base `e98cbf5`.
Read `baseline.md` first, then this page. Every status below is backed by a file in this folder.

## Status board

| Task | State | Evidence |
|---|---|---|
| BASE-01 Basis festhalten | PASS | `baseline.md` |
| BASE-02 Delta inventarisieren | PASS | `requirements.csv`, `issue-ledger.csv`, `inventory.md` |
| BASE-03 Verträge/Schreibbereiche fixieren | PASS | `contract-freeze.md`, `pnpm contracts:check` exit 0 |
| BASE-04 Abnahmeumgebung | PASS (Umgebung) | `acceptance-environment.md`, 35/35 hashgleich |
| DASH-01.01–.05 Istbestand einfrieren | PASS | `inventory.md`, `installer-inventory.csv` |
| INS-01 Bestands- und Fehler-ID-Matrix | PASS | `issue-ledger.csv` |
| DASH-03 Produktionspfad ohne Simulation | PASS | `dash-03-production-path.md`, `live-empty-sources.test.ts`, Rollback-Drill |
| DASH-02 Vertraege | 02.01/02.02 PASS, 02.03/02.05 offen, 02.04 teilweise | `dash-02-contracts.md`, `authorization-contract.test.ts` (4 gruen), 176 Handler-/Event-Tests gruen |
| DASH-04 Einstellungen ehrlich | 04.01/04.02 PASS, 04.04 Adapter-Haelfte PASS; 04.03/04.05 offen | `dash-04-settings.md`, `tests/e2e/settings-acceptance.spec.ts` (3 gruen), 92 Settings-Tests |
| all other INS/DASH/KEEP/REL | OPEN | owner rows in `requirements.csv` |

## Task records (format from master §3.3)

### BASE-01

- requirement_ids: BASE-01; predecessor: none
- base_revision: `e98cbf548cbf5b65369c97aae335d6883855eb7e`; result_revision: same (docs only)
- write_scope: `docs/agent-work/finalization/`
- implementation_paths: `baseline.md`
- test_command: `git status --short`, `git rev-parse HEAD`, `Get-NetTCPConnection`, `Invoke-WebRequest /api/v1/health`,
  `wsl -l -v`, `hermes --version`, registry read of `HKCU:\…\Lxss`
- expected: clean checkout, recorded runtime, no secret in the document
- observed: clean tree, live runtime D:\Dokumente\F.R.I.D.A.Y on FRIDAY-2, 5 ports, 19 health components, Hermes 0.22.2
- evidence_paths: `baseline.md`; status: PASS; remaining_work: none

### BASE-02

- requirement_ids: BASE-02, REQ-01, REQ-22; predecessor: BASE-01
- base_revision: `e98cbf5`; result_revision: `e98cbf5` (docs only)
- implementation_paths: `requirements.csv` (168 rows), `issue-ledger.csv` (80 rows), `inventory.md`,
  `installer-inventory.csv` (16 rows)
- test_command: `py -3 tools/check_ledgers.py` equivalent (ad-hoc script, see below), master checkbox count
- expected: 154 checklist points, no orphan master ID, no duplicate ledger ID
- observed: 154 checkboxes (141 bold + 13 INS), 0 orphan IDs, 0 duplicates, both CSVs parse
- evidence_paths: `inventory.md` §1–2; status: PASS
- remaining_work: field-level *re-proving* of `settings-runtime-map.csv` on `e98cbf5` stays with KEEP-04 —
  the rows are inventoried, their acceptance cells are still `NOT_RUN`

The check used for the ledgers is reproducible with:

```powershell
py -3 -c "import csv,collections; rows=list(csv.DictReader(open(r'docs/agent-work/finalization/requirements.csv',encoding='utf-8'))); print(len(rows), [k for k,v in collections.Counter(r['req_id'] for r in rows).items() if v>1])"
```

### INS-01

- requirement_ids: INS-01; predecessor: BASE-02
- implementation_paths: `issue-ledger.csv`
- expected: each journal ID assigned to regression, outstanding implementation or historical operation
- observed: 62 journal rows + 12 collection-list rows + 6 session findings; no historical deletion
  (I-002/I-037/I-039) turned into an install task
- status: PASS; remaining_work: INS-10 has to close the `FIXED_NEEDS_REGRESSION` rows with a real run

### DASH-01

- requirement_ids: DASH-01.01–.05; predecessor: BASE-01/02
- implementation_paths: `installer-inventory.csv`, `inventory.md`
- observed: four inventories exist and are named with their source revision; the installer inventory proves
  13 of 16 rows against the live installation and marks 15b (data mode) as FAIL
- status: PASS for the inventory; the defect itself is DASH-03

### DASH-02

- requirement_ids: DASH-02.01/02.02 (PASS), DASH-02.03/02.04/02.05 (teilweise bzw. offen)
- predecessor: BASE-03 (gemeinsamer Vertragsmeilenstein)
- base_revision: `15d90af`; result_revision: (offen bis Commit)
- implementation_paths: `apps/control-api/test/authorization-contract.test.ts` (neu),
  `docs/agent-work/finalization/dash-02-contracts.md`
- test_command: `npx vitest run test/authorization-contract.test.ts`, `npx vitest run test/mutations.test.ts
  test/degradation.test.ts test/cloudtalk.test.ts test/contract-gaps.test.ts`, `npx vitest run
  test/himalaya-send.test.ts test/messenger-send-routes.test.ts test/contract.test.ts test/security.test.ts
  test/settings-content-mutation.test.ts test/adapter-settings.test.ts`, `pnpm contracts:check`, `pnpm typecheck`,
  `pnpm lint`
- expected: jede Vertragsoperation deklariert Rolle und Capability, die Durchsetzung entspricht dem Vertrag, und
  Erfolg, Timeout, 403, Konflikt sowie unbekannter Ausgang sind durch gezielte Tests belegt
- observed: 271 Operationen (163 owner, 62 viewer, 44 operator, 2 none), 236 mit Capability; der neue Guard
  vergleicht alle 271 mit der generierten Route-Tabelle (0 Abweichungen); 4 + 81 + 95 = 180 Tests gruen, davon
  176 in den Vertrags-/Handler-Dateien; `contracts:check` und `typecheck` exit 0, `lint` 0 Fehler
- evidence_paths: `dash-02-contracts.md`; status: PASS fuer 02.01/02.02
- remaining_work: 02.03 (Rueckleseprobe pro Feld, KEEP-04), 02.04 Migrationsdrill mit Konten/Entwuerfen/
  Enrollment, 02.05 kontrolliertes Lesen der alten Vertragsversion

### DASH-03

- requirement_ids: DASH-03.01-.05; predecessor: BASE-02/BASE-03
- implementation_paths: `apps/control-api/src/runtime/adapter-wiring.ts`, `apps/control-api/src/handlers/meta.ts`,
  `apps/web/src/features/settings/AdaptersArea.tsx`, `installer/lib/data-mode.ps1`, `installer/install-friday.ps1`,
  `packages/config/src/load.ts`, `scripts/finalization/rollback-drill.ps1`
- test_command: `vitest run test/live-empty-sources.test.ts test/adapter-wiring.test.ts` (control-api),
  `pnpm test:conformance`, `scripts/finalization/rollback-drill.ps1` with and without `-Migrate`
- expected: a live runtime without configured sources creates no mock adapter and shows no simulated data;
  the delivered configuration is honest; a rollback restores the previous behaviour
- observed: live with an empty allowlist lists only the configured `tasks:hermes-tasks` (dead upstream
  `127.0.0.1:9`), no `mock-*` health component, memory/automations/communication/channels/agents answer 4xx,
  `/skills` returns `data: []`; `/api/v1/meta` reports `dataMode: live`, `features.mockData: false`; the
  rollback drill without migration boots 19 components with 15 simulated adapters, with `-Migrate` 4 components
  and 0 adapters; an invalid `dataMode: turbo` is rejected with exit 2
- evidence_paths: `dash-03-production-path.md`, `acceptance-environment.md`; status: PASS; remaining_work: none

### DASH-04

- requirement_ids: DASH-04.01/04.02 (PASS), DASH-04.03/04.04 Skill-Haelfte/04.05 (open)
- predecessor: DASH-02, DASH-03
- base_revision: `5efaac9`; result_revision: `d03527e`
- implementation_paths: `apps/web/src/features/settings/{SettingsPage,AdaptersArea,settings.css,testApi}.tsx`,
  `apps/web/src/i18n/modules/d.{de,en}.ts`, `tests/e2e/settings-acceptance.spec.ts`,
  `tests/e2e/support/fixtures.ts`
- test_command: `npx playwright test tests/e2e/settings-acceptance.spec.ts`, `npx playwright test
  tests/e2e/settings.spec.ts`, `npx vitest run src/features/settings src/i18n` (apps/web), `pnpm typecheck`,
  `pnpm lint`
- expected: master-detail opens the selected adapter, drafts survive or are dropped only after confirmation,
  a saved configuration is read back after a reload, the owner writes while a read-only role cannot, and the
  page works at 390/1024/1920 px and by keyboard alone
- observed: 3 e2e tests green (mock-tasks 111 discarded, mock-memory 333 persisted and read back after reload,
  `dev-viewer` sees "Nur lesend" with a disabled save button and no adapter credentials, no horizontal overflow
  at all three widths, Enter opens and Escape cancels the draft dialog); 6 existing settings e2e tests stay
  green; 92 settings/i18n unit tests green; `If-Match` defect fixed (adapter revision instead of settings
  version), proven by a 409 before and a 200 after
- evidence_paths: `dash-04-settings.md` §4; status: PASS for 04.01/04.02 and the adapter half of 04.04
- remaining_work: 04.03 search over source/status needs the DASH-07 inventory; 04.04 needs a stack with a
  skills catalog and a Hermes bridge for the "two skills" half; 04.05 recovery drill

## Next (in the order of master §8.1)

1. **DASH-07.01/.02** — Hermes inventory (skills, accounts, sources, status) as the base for DASH-04.03 and
   the skill half of DASH-04.04.
2. **INS-02 .. INS-07** — installer follow-ups in the order of master §8.1.
3. **DASH-04.05** recovery drill once a single-area misconfiguration can be staged in the acceptance copy.
4. Parallel while read-only: the Studio comparison for DASH-14/KEEP-05.

## Open risks / notes for the next session

- The running installation must not be rebuilt or restarted from this branch without a rollback plan
  (`D:\Dokumente\F.R.I.D.A.Y` belongs to the operator).
- `dataMode: live` already exists and creates **no** adapters for unconfigured categories
  (`adapter-wiring.ts:241`); the fix direction is therefore to make the delivered configuration honest instead
  of inventing a fourth mode.
- Windows PATH quirk still applies: `$env:Path = $env:Path.Replace('"','')` before every `pnpm` command.
- The 13 `FIXED_PROVEN_CODE` rows prove source presence only, never runtime behaviour.