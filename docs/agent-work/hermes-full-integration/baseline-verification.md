# Verification baseline — 2026-10-19

## Revision and scope

- Local and `origin/main`: `841f0771f52c81b78ea57fd4012161c11c4efbf3` (`Include complete voice runtime dependencies in incremental updates`).
- No tracked implementation changes were present at the initial check. This report is this worker's only artifact; concurrent workers may add other untracked planning documents.
- Repository: <https://github.com/rogueki/rogue-friday>.
- GitHub CLI authentication is available as `rogueki`; no remote mutation was made.

## Current remote CI: FAIL

Run [39168340813](https://github.com/rogueki/rogue-friday/actions/runs/39168340813) is the CI run for the current revision. Its `verify` job passed: frozen install, contracts, typecheck, lint, whitespace check, unit/component tests, adapter conformance, and build. Six E2E shards passed; shards 6 and 8 failed.

| Gate | Result | Evidence / finding |
| --- | --- | --- |
| CI verify job | PASS | [job 117796000695](https://github.com/rogueki/rogue-friday/actions/runs/39168340813/job/117796000695) |
| E2E shards 1, 2, 3, 4, 5, 7 | PASS | CI run above |
| E2E shard 8, visual states | FAIL | `partial-outage` differs by 24,615 / 24,599 pixels on two attempts; `critical-alert` differs by 25,538 / 25,357 pixels on two attempts. Baselines `overview-partial-outage-linux.png` and `overview-critical-alert-linux.png` no longer represent the UI. |
| E2E shard 6, CSP | FAIL | `security.spec.ts` still expects `connect-src 'self' ws: wss:`. The server now returns the more permissive, intentional value `connect-src 'self' https://api.bigdatacloud.net ws: wss:`. The assertion must describe the approved CSP exactly. |
| E2E shard 6, first-attempt flakes | PASS on retry | Background-tab resume, scenario switch, and assistant rename each failed once but passed on retry. Treat as flake signals; they did not fail the shard independently. |

The visual failures are deterministic across the one allowed CI retry, so they are release-blocking until inspected Linux baselines are regenerated or the UI regression is corrected. The CSP mismatch is also deterministic and release-blocking: it is an outdated security assertion after the location/geocoding integration.

## Known visual-regression constraints

- Baselines are platform-specific. Linux/SwiftShader baselines are checked in CI; Windows cannot validate them without separate `-win32` baselines.
- `pnpm test:e2e:update` is a mutation and must never be used as evidence by itself. Review the two changed images before committing.
- Existing coverage has known limits: Chromium only, selected mobile routes, partial 3D-state coverage, no screen-reader run, and no real Hermes/voice service in CI. These are coverage limits, not passing evidence.

## Local read-only checks in this baseline

| Command | Result | Notes |
| --- | --- | --- |
| `git rev-parse HEAD`; `git ls-remote origin refs/heads/main` | PASS | Both resolve to `841f077…`. |
| `git diff --check` | PASS | No whitespace errors. |
| `pnpm test:e2e --list` with `C:\Program Files\nodejs` prepended to `PATH` | PASS | Playwright 1.64.0 discovers 235 tests in 30 files; no tests executed. |
| Broad local unit/E2E suite | NOT_RUN | Existing CI supplies current primary-gate evidence; it would not resolve the two current CI failures. |

The host requires `C:\Program Files\nodejs` to precede the inherited PATH for `pnpm` child processes to find `node`; apply that environment-only workaround to local commands below.

## Cheapest corrective verification sequence

Run these on Linux/WSL with the CI Chromium environment where possible. Do not start a broad suite until the focused failures pass.

```powershell
$env:PATH = 'C:\Program Files\nodejs;' + $env:PATH

# Inspect and correct the CSP assertion for the approved geocoding origin.
pnpm test:e2e tests/e2e/security.spec.ts -g 'CSP is delivered'

# Inspect the actual image diffs first; only then regenerate the two reviewed baselines.
pnpm test:e2e tests/e2e/visual.spec.ts -g 'overview in scenario (partial-outage|critical-alert)'

# After the correction, rerun the affected shard-risk tests.
pnpm test:e2e tests/e2e/security.spec.ts tests/e2e/visual.spec.ts tests/e2e/performance.spec.ts tests/e2e/scenarios.spec.ts tests/e2e/settings.spec.ts
```

For the current installer-only commit, use the focused Windows-safe checks in addition to CI primary gates:

```powershell
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File installer/tests/dashboard-update-voice-integration.Tests.ps1
py -3 -m unittest installer/voice/tests/test_update_dependency_closure.py
```

After focused tests pass and reviewed snapshots are committed, the authoritative release check is the existing `.github/workflows/ci.yml`: `pnpm install --frozen-lockfile`, contracts/typecheck/lint/unit/conformance/build, then all eight Linux Playwright shards. The separate hybrid integration suite is not in CI; run `pnpm test:integration` for adapter or hybrid wiring changes.

## Release decision

**FAIL — do not publish from `841f077` yet.** The primary CI job is green, but the current revision has two stable visual regressions and one stable CSP-test contract mismatch. Fix and verify those before a release decision.

## Bounded correction attempt — 2026-10-19

- **CSP assertion:** corrected `tests/e2e/security.spec.ts` to require the complete approved directive `connect-src 'self' https://api.bigdatacloud.net ws: wss:`. This preserves the exact allowlist rather than weakening the assertion. Focused local browser test: **PASS** (1 test, 1.1 min).
- **Visual evidence:** the affected Linux baselines last changed before `4069d4f`, while that commit replaced Overview placeholders with the intentional location, weather and browser-network context chips. The two affected scenarios are both Overview captures.
- **Linux PNG status:** **PASS**. Isolated branch `5af83ee` ran [capture workflow 39172029656](https://github.com/rogueki/rogue-friday/actions/runs/39172029656) on Ubuntu with Playwright Chromium v1248. It generated only the two guarded Linux candidates, then the images were visually reviewed before copying to this worktree. `partial-outage` correctly shows restricted operation and offline communication; `critical-alert` correctly shows online operation and the warning list; both retain the new context chips without overlap. SHA-256: `overview-partial-outage-linux.png` `8F721922A3ADB2DD69F83FED02AC69A1B1831B53A181B2DB2F846C1B7EC5AE7C`; `overview-critical-alert-linux.png` `2E6D12F006E80C877E5811C9A512C56A43982C33D5B2809B454E7F4508C6889E`.

## Research baselines captured on the runner — 2026-10-20

The two research screenshot baselines failed deterministically on every CI attempt for this branch
(`research-1080p`, `mobile-research`), while the same files matched byte-for-byte between `b53fb46` and the
later local commits. The design tokens request `'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif`
without shipping the font, so the render depends on the host's installed fonts: baselines captured on a WSL
host do not describe the `ubuntu-latest` runner.

Capture: `ci.yml` now exposes `workflow_dispatch` with `capture_baselines`. Dispatch run
[39446003797](https://github.com/rogueki/rogue-friday/actions/runs/39446003797) regenerated only
`visual.spec.ts` and `mobile.spec.ts` on `ubuntu-latest` with `--update-snapshots --workers=1` and uploaded
`tests/e2e/__screenshots__` as an artifact. The capture runs in its own concurrency group so it cannot
cancel the verification run for the same commit.

Evidence that the render is otherwise reproducible: **74 of 76** baselines from that artifact are
byte-identical to the committed files. Only the two research pages differ — the page whose setup controls
changed in `b64fe4a`, so a difference there is expected. Measured on the two PNGs: desktop `1920x1080`,
857862 differing pixels (41.4 %), best vertical offset 18 px explains about one percentage point of that;
mobile `390x844`, 32249 differing pixels (9.8 %), best offset 0 px.

**Review status: structural, not visual.** This session had no image-capable model available, so the two
changed PNGs were **not** inspected by eye; committing them relies on the hash evidence above plus the
layout assertions that pass on the same build (`mobile research` checks that the provider-setup label fits
inside its button, that the page does not scroll horizontally and that the command bar stays reachable).
The open follow-up is a visual review of
`tests/e2e/__screenshots__/visual.spec.ts/research-1080p-linux.png` and
`tests/e2e/__screenshots__/mobile.spec.ts/mobile-research-linux.png` by an image-capable reviewer or the
operator. Until then treat the research page's *appearance* — not its rendering stability — as unreviewed.
