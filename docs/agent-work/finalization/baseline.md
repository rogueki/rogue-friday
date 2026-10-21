# Finalization baseline (BASE-01)

Recorded: 2026-10-21, Europe/Paris. Owner: execution agent of `FRIDAY_FINALER_UMSETZUNGSPLAN.md`.
Work branch: `feat/friday-finalization-20261021` (created from `main` = `e98cbf5`, local only, no push).

## 1. Checkout under change

| Item | Value |
|---|---|
| Path | `C:\Users\ByteNinja\Downloads\JARVIS_Installer\JARVIS_Installer\rogue-friday-completion` |
| Remote | `origin` = <https://github.com/rogueki/rogue-friday.git> (private) |
| Branch at start | `main`, tracking `origin/main`, divergence 0/0 |
| HEAD at start | `e98cbf548cbf5b65369c97aae335d6883855eb7e` ("Fix the installer aborts seen in a real install and open it to any provider"), 2026-10-21 20:05:38 +0200 |
| Working tree at start | clean (`git status --short` empty) |
| Version | root `package.json` 1.0.0, `packageManager pnpm@10.28.2`, `engines.node >= 22.13`, contracts `@friday/contracts` 2.0.0 |

`docs/PROJECT_STATUS.md`, `docs/IMPLEMENTATION_CONVENTIONS.md` and `CLAUDE.md` were read before any change.
This report is the only artifact of BASE-01; it contains no secrets.

## 2. Sibling worktrees — read-only, not copied

`git worktree list` reports ~70 linked worktrees in this project folder. They are historical feature
branches of the same repository. For this task only these are relevant as **read-only comparison sources**:

| Worktree | HEAD | Role |
|---|---|---|
| `rogue-friday-content-studio` | `fd79ee2` (`codex/content-studio-oct15`) | Studio comparison source for DASH-14 / KEEP-05 |
| `rogue-friday-clean` | `028e9f8` (`feat/hermes-integration-wave2-20261019`) | already merged into `main`; no action expected |
| `rogue-friday-p9-automation` (+ nested `rogue-friday-nlp-read`, `rogue-friday-p8-matrix`) | `6d91baf` | historical evidence only |

Rule applied: no blanket merge or copy from these worktrees. Each function is compared file by file.

## 3. Actual runtime currently on this host (read-only observation)

The machine runs the installation that was completed on 2026-10-21 19:45. It is **not** a fresh target
for this work: `BASE-04` defines separate isolated test targets and forbids overwriting the user installation.

| Item | Observed value |
|---|---|
| Install root | `D:\Dokumente\F.R.I.D.A.Y` (exists) |
| WSL distro | `FRIDAY-2`, state `Running`, WSL2, Ubuntu 24.04.5 LTS |
| Distro location | `D:\Dokumente\F.R.I.D.A.Y-wsl` |
| Linux user | `ubuntu` |
| Dashboard source in state | `…\JARVIS_Installer\rogue-friday-completion` (this checkout) |
| Dashboard hash in state | `b95b1b5239ca496a1d5bd1720668113957fffcc922e8f6628592fa3795d75a89` |
| Assistant | `Kira`, wake phrase `Hey Kira`, wake engine `personal`, wake slug `hey_kira` |
| Voice mode | `local`, voice choice `friday-female` |
| GPU | NVIDIA GeForce RTX 4080 Laptop, 12282 MB VRAM, compute 8.9, driver 616.92 |
| Hermes | `Hermes Agent v0.22.2 (2026.9.24) · stable · local d923a5eb487a`, `/home/ubuntu/.hermes`, install method git |
| Skills commit in state | `9288ed6f83689c8087393397fbf89babb96ca7a1` |

Listening FRIDAY ports (verified with `Get-NetTCPConnection`):

| Port | Service | Evidence |
|---|---|---|
| 3101 | Command Center (Control API + static web) | Windows `node` PID 75504, started 19:43:06 |
| 43791 | Hermes dashboard | listening inside WSL (mirrored networking) |
| 43792 | Qwen local model (`llama-server`) | Windows PID 34548, started 17:30:49 |
| 43793 | Hermes API | listening inside WSL |
| 43794 | Friday Voice service | Windows `python` PID 73620, started 19:26:32 |
| 43795 | Friday TTS (`/health` → `{"ok":true,"model":"Qwen/Qwen3-TTS-12Hz-0.6B-Base","ready":true,"voices":["classic","friday-female"]}`) | HTTP 200 inside WSL |
| 3100 | not listening | — |

`GET http://127.0.0.1:3101/api/v1/health` returns HTTP 200 with
`contractVersion 2.0.0`, `status online`, 19 components. **Relevant finding for DASH-03:** the delivered
runtime currently reports mock components as healthy production adapters:
`mock-memory`, `mock-approvals`, `mock-communication`, `mock-calendar`, `mock-automations`,
`mock-research`, `mock-files`, `mock-notifications`, `mock-audit`, `mock-commands` — while
`hermes-tasks`, `hermes-activity`, `hermes-agents`, `friday-voice-http`, `local-system`,
`event-stream`, `database` and `audit-chain` are real. This is the live proof that the mock fallback
described in DASH-03 is still active in the delivered state; it is a defect to fix, not a baseline success.

Scheduled tasks: `FRIDAY_Dashboard`, `FRIDAY_Qwen`, `FRIDAY_Voice`, `FRIDAY_Watchdog`,
`FRIDAY_WSL_Keepalive` — all `Ready`.

## 4. Toolchain on this host

| Tool | Version |
|---|---|
| Windows | Windows NT 10.0.26200.0 (build 26200) |
| PowerShell | 5.1.26100.9711 Desktop (Windows PowerShell; the installer targets 5.1) |
| Node.js | v24.13.0 |
| pnpm | 10.28.2 (`C:\Program Files\nodejs\pnpm.ps1`) |
| Python (launcher `py -3`) | 3.11.0 |
| git | 2.51.2.windows.1 |

Host quirk that stays in force for every local command (documented in `docs/IMPLEMENTATION_CONVENTIONS.md`):
the machine PATH contains a stray double quote (`C:\Program Files\Tesseract-OCR"`), so cmd-spawned
`pnpm` scripts cannot find `node`. Workaround in every shell:
`$env:Path = $env:Path.Replace('"','')`. This was applied for all commands in this session.

## 5. Explicit non-checks of this baseline

- No fresh installation was performed, and the running user installation was not modified, restarted or deleted.
- No WSL distro was exported, registered, unregistered or shut down.
- No provider (OpenAI/Anthropic/Kimi/…), social or telephony call was made; no message was sent.
- No Playwright/E2E or Linux-CI run was executed; the current revision's CI status on `origin/main` was not re-queried.
- No GUI screenshots of the WinForms installer exist yet (INS-08 will produce them).
- Graphify index state is `building`; its snapshot was used only as orientation, all findings above come from
  direct file/registry/runtime reads.

## 6. Immediate consequences for the work order

1. `BASE-02`/`DASH-01`/`INS-01` share one ledger. It is created here as
   `docs/agent-work/finalization/requirements.csv` and `…/issue-ledger.csv`.
2. `BASE-03`/`DASH-02` (shared contracts) come next; `DASH-03` must remove the live mock adapter set
   documented in §3 without breaking the legitimate test fixtures.
3. `BASE-04` sets up the isolated acceptance targets: a fresh install root (not `D:\Dokumente\F.R.I.D.A.Y`)
   and an upgrade copy of the current state, plus a rollback manifest of config/DB/voice/studio/memory.