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
| DASH-04 Einstellungen ehrlich | 04.01-04.03 in Arbeit, Browser-Abnahme offen | `dash-04-settings.md`, 87 Settings-Tests |
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

## Next (in the order of master §8.1)

1. **BASE-03** — freeze shared contracts and write scopes: integration/account ID, config revision,
   `ApplyResult`, credential references, job ID, events/sequence, cancellation, capabilities, voice status,
   install manifest. Contracts first in `packages/contracts`, then `pnpm contracts:generate`.
2. **DASH-02** (same milestone) — API/job/event/migration contracts, role and capability checks per new operation.
3. **DASH-03** — remove the production mock fallback. Concrete starting point is proven: the installer ships
   `dataMode: hybrid` with ten `mock-*` categories (`N-001`), and the live health endpoint reports them as `online`.
4. Parallel while read-only: INS-02 (prompt/state inventory) and the Studio comparison for DASH-14.

## Open risks / notes for the next session

- The running installation must not be rebuilt or restarted from this branch without a rollback plan
  (`D:\Dokumente\F.R.I.D.A.Y` belongs to the operator).
- `dataMode: live` already exists and creates **no** adapters for unconfigured categories
  (`adapter-wiring.ts:241`); the fix direction is therefore to make the delivered configuration honest instead
  of inventing a fourth mode.
- Windows PATH quirk still applies: `$env:Path = $env:Path.Replace('"','')` before every `pnpm` command.
- The 13 `FIXED_PROVEN_CODE` rows prove source presence only, never runtime behaviour.