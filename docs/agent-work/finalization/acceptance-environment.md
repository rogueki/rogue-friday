# Acceptance environment and rollback manifest (BASE-04)

Recorded 2026-10-21 23:10 (Europe/Paris). Script: `scripts/finalization/prepare-acceptance-env.ps1`
(PowerShell 5.1, UTF-8 with BOM, parser-clean). The script is read-only against the live installation.

## 1. Targets

| Target | Purpose | State |
|---|---|---|
| `D:\Dokumente\F.R.I.D.A.Y` | operator installation — **never written by this task** | untouched, running (3101) |
| `D:\Dokumente\F.R.I.D.A.Y-acceptance\snapshot-<stamp>` | frozen state copy (config, data, memory, skills registry) | created `20261021-231054` |
| `D:\Dokumente\F.R.I.D.A.Y-acceptance\restore-drill-<stamp>` | restored copy used to prove the manifest | created, verified |
| `D:\Dokumente\F.R.I.D.A.Y-acceptance\fresh-target` | empty install target for REL-03 fresh runs | created, empty |
| `D:\Dokumente\F.R.I.D.A.Y-acceptance\manifest-<stamp>.csv` | rollback manifest | 43 rows |
| `D:\Dokumente\F.R.I.D.A.Y-acceptance\sqlite-integrity-<stamp>.mjs` | reproducible integrity check | present |

## 2. Manifest content

| Metric | Value |
|---|---|
| files recorded | 43 |
| copied state files | 35 |
| bytes copied | 7 175 346 (≈ 6,8 MiB) |
| secret rows (hash only, not copied) | 8 (`hermes_api.key`, `dashboard_owner.hash`, six `auth.key` including the five bridge keys) |
| locked/skipped files | 0 |
| classes | `config`, `data`, `memory`, `skills`, `secret` |

Every row carries `path`, `bytes`, `sha256`, `class`, `copied`. The manifest lists **hashes** of secret files, never
their content — a rollback restores the secret from its original location, an upgrade must not rotate it.

## 3. Restore drill (proved, not asserted)

| Check | Result |
|---|---|
| copy snapshot → `restore-drill-<stamp>` | robocopy exit < 8 |
| SHA256 of every copied file compared to the manifest **before the first open** | **35 / 35 identical, 0 mismatches** |
| `PRAGMA integrity_check` on `dashboard.sqlite` | `ok` (exit 0) |
| `PRAGMA integrity_check` on `voice-memory.sqlite` | `ok` (exit 0) |
| `PRAGMA integrity_check` on `memory/outbox.sqlite` | `ok` (exit 0) |

Deliberate detail: opening the restored databases **checkpointed** their WAL, so the four `*-wal` / `*-shm`
files no longer exist in the drill afterwards (31 files instead of 35). That is normal SQLite behaviour on first
open and the integrity check is the proof that the rollback target is consistent without those files.

## 4. What is intentionally not in the snapshot

| Excluded | Reason |
|---|---|
| `voice/` model tree (3 175 MiB, 32 181 files) | reinstallable by installer step 12; copying it would add 3 GB without acceptance value |
| `dashboard/node_modules`, `dist`, `apps/web/out` | build output, reproducible by `pnpm install && pnpm build:app` |
| secret file content | hash-only rows; avoids a second copy of live credentials |
| `skills/friday-skills` body (2,9 MiB) | only `registry/` state is snapshotted; the skill body is product content under version control |

Windows task state was captured read-only: `FRIDAY_Dashboard`, `FRIDAY_Qwen`, `FRIDAY_Voice`,
`FRIDAY_Watchdog`, `FRIDAY_WSL_Keepalive` — all `Ready`; two `wsl.exe -d FRIDAY-2 --exec /bin/sleep infinity`
keepalive processes exist.

## 5. Rollback procedure (binding)

1. Stop `FRIDAY_Dashboard`, `FRIDAY_Voice` (service tasks), leave WSL keepalive running.
2. Copy the manifest-listed files of the chosen snapshot back into `D:\Dokumente\F.R.I.D.A.Y`, preserving the
   relative paths, **except** `class = secret` rows (those stay at their live location).
3. Start `FRIDAY_Dashboard`; wait for `GET /api/v1/health` = 200 and `contractVersion` matches.
4. Verify: `PRAGMA integrity_check` on `dashboard/data/dashboard.sqlite`, `voice-memory.sqlite`,
   `memory/outbox.sqlite`; compare SHA256 of restored files with the manifest.
5. Only after a green step 4 delete the snapshot — never before.

## 6. Still open in BASE-04 (explicit, not silently skipped)

- **Real external test accounts are not created yet.** Mail (two accounts), calendar (a writable and a
  read-only test calendar), Telegram, Discord and the phone backend need operator-side accounts. They are a
  hard precondition for the live acceptance in DASH-05/06/08/09 and are recorded as `BLOCKED_EXTERNAL`
  until they exist. No mock account is used as a substitute.
- The **fresh install run** on `fresh-target` belongs to INS-13/REL-03 and needs the GUI work of INS-05..08 first.

## 7. Reproduce

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/finalization/prepare-acceptance-env.ps1
# custom target / stamp:
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/finalization/prepare-acceptance-env.ps1 `
  -SourceRoot 'D:\Dokumente\F.R.I.D.A.Y' -TargetRoot 'D:\Dokumente\F.R.I.D.A.Y-acceptance' -Stamp 'rel03'
```