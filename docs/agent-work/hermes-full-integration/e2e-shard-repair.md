# E2E shard repair — CI run 39201131580 (branch feat/hermes-integration-wave2-20261019)

CI run 39201131580 on Linux had all core jobs green but 5 of 8 Playwright E2E shards red. This note attributes every failing spec, classifies the cause, and records the fix and its verification.

Cause classes: **(a)** broken by this branch's HEAD work (`a106137` staged task update/cancel, `8d0e639` messenger catalog), **(b)** broken by an earlier wave commit already on this branch, **(c)** CI/browser infrastructure flake.

## Attribution table

| Spec | Class | Root cause | Fix |
| --- | --- | --- | --- |
| command-bar.spec.ts:70 | (b) | Native staged task creation (`f2a4a93`, `83e49a4`): with default `approvals.confirmTier2: true` the confirmed command lands in `requires_approval`, so the "Aufgabe wurde angelegt." toast never appears | Test disables tier-2 confirmations via settings patch (approval detour is covered by tasks.spec.ts) |
| a11y.spec.ts:203 | (b) | Same commits: dialog task creation is staged; the "Du bist dabei:" preview alertdialog was never confirmed | Same settings patch + keyboard confirmation of the preview dialog |
| reconnect.spec.ts:33/76/87, performance.spec.ts:72 | (b) | `f2a4a93` enforces preview + approval for direct `POST /tasks`; plain POST returns 403 and creates nothing | New `ApiClient.createTask` helper drives the real staged chain (preview → `X-Action-Preview-Id` → approval token → approve → verify created task) |
| alerts.spec.ts:247 | (b) | `1ea1a97` channel eligibility: WhatsApp is disabled in the seeded notification settings, so it is honestly marked "Übersprungen" at raise time instead of "Geplant" | Expectation corrected: Telegram/Telefon stay "Geplant", WhatsApp asserted as "Übersprungen" |
| scenarios.spec.ts:4 | (c) | Software WebGL on the runner: derived status "Wartet auf Freigabe" rendered correctly, only the orb canvas stayed on "Orb wird geladen …" past the 15 s timeout | None (no product defect; see below) |
| tasks.spec.ts:84 | (c) | Browser context setup timeout (90 s) on first try; retry passed in 10.5 s. Shard 6 log shows several `Browser.setDownloadBehavior: Failed to find browser context` crashes | None |
| visual.spec.ts:256 (`communication-1080p`), :317 (`communication-long-german-1080p`) | (b) | Intended UI change (messenger send path, `624fc80`, `9f99946`, `a115f7d`, `80a7627`): "Live-Postfach" renamed to "Mail Postfach (IMAP/SMTP)" and new "Messenger-Nachricht" panel on /communication | Linux baselines regenerated under WSL (`--update-snapshots`, only the two communication snapshots) |

## Evidence per spec

### command-bar.spec.ts:70 — class (b)

The free-text command test confirmed a task preview and then waited for the toast "Aufgabe wurde angelegt." (`apps/control-api/src/handlers/commands.ts:54`). With the native staged creation flow and the default setting `approvals.confirmTier2: true` (`apps/control-api/src/services/settings.ts:164`) the confirmed command instead becomes an approval request ("Freigabe erforderlich"). Reproduced locally on Windows before the fix (timeout waiting for the toast); green after the fix. The commits introducing native staged creation (`f2a4a93`, `83e49a4`) are not on main.

### a11y.spec.ts:203 — class (b)

The keyboard-only task flow test pressed Enter on "Aufgabe anlegen" in the create dialog and expected the task article. Since the wave-2 staged flow the dialog first produces the preview alertdialog "Du bist dabei:", which the test never confirmed. Reproduced locally before the fix; green after. Fix also disables tier-2 confirmations so the confirmed preview executes directly; the approval detour remains covered by tasks.spec.ts.

### reconnect.spec.ts:33/76/87 + performance.spec.ts:72 — class (b)

All four tests seeded tasks with a plain `api.post("/tasks", …)`. `f2a4a93` ("Enforce native preview and approval for direct task creation") makes that return 403 `APPROVAL_REQUIRED` (stage `preview`), so no task existed and every later UI assertion timed out. The CI log for shard 6 (job 117895616430) fails at the same statements (e.g. performance.spec.ts:86). Reproduced locally: 4 failed before the fix. Fix: `ApiClient.createTask` in `tests/e2e/support/api.ts` performs the full staged chain — POST → 403 preview (`details.previewId`) → POST with `X-Action-Preview-Id` → on tier-2 approval, GET `/approvals/{id}` for the one-time `x-approval-token` header → POST `/approvals/{id}/approve` → parse the execution receipt ("Aufgabe task_… angelegt.") → GET the task — and throws with diagnostics on any unexpected stage (mirrors `apps/control-api/test/support/task-actions.ts`). All six call sites switched.

### alerts.spec.ts:247 — class (b), intended behavior change

`1ea1a97` ("require owner approval for external escalation") marks escalation steps for ineligible channels as `skipped` at raise time (`packages/mock-data/src/world/services/notifications.ts:190-192`, eligibility at :231-234 reads `settings.notifications.channels`, `enabled && priorityRank(priority) <= priorityRank(minPriority)`). The seeded settings disable WhatsApp (`packages/mock-data/src/seed/settings.ts:153`), so a fresh P0 now truthfully shows "WhatsApp · Übersprungen" instead of "Geplant". The neighboring chain test (alerts.spec.ts:205) already encodes exactly this state vector (`["sent", "awaiting_approval", "skipped", "awaiting_approval"]`). The CI retry shows the identical failure ("WhatsApp · Übersprungen 10:48"); the first CI attempt was an infra context-setup timeout. Fix narrows the "Geplant" loop to the eligible channels (Telegram, Telefon) and asserts "Übersprungen" for WhatsApp — a stricter statement about a disabled channel, not a weakened test.

### scenarios.spec.ts:4 — class (c), infrastructure flake

CI failure: `expectOrbMode(page, "waiting_approval")` could not find `[data-orb-root]` within 15 s. The CI error-context snapshot shows the page fully rendered with the correct derived status ("Wartet auf Freigabe", "FREIGABE ERFORDERLICH") — only the orb renderer stayed on the "Orb wird geladen …" placeholder, i.e. the software WebGL renderer on the runner did not mount in time. The wave-2 diff touches no orb rendering: `OrbSlotInner.tsx` only adds the additive `showPerf` prop, plus minor `AppShell.tsx`/`AppTopBar.tsx` changes. The same spec passed in the main-branch CI (run 39185364534, all 8 shards green) and passes locally on Windows. No code change.

### tasks.spec.ts:84 — class (c), infrastructure flake

First CI attempt died with "Test timeout of 90000ms exceeded while setting up context" (browser/context setup, not test code); the retry passed in 10.5 s. The shard 6 log contains multiple browser-context crashes (`Browser.setDownloadBehavior: Failed to find browser context`). The spec passes repeatedly locally and in the main-branch CI. No code change.

### visual.spec.ts:256 / :317 — class (b), intended UI change

The CI diff screenshots (expected vs actual) show two intended changes on /communication from the messenger send path work (`624fc80`, `9f99946`, `a115f7d`, `80a7627`): the mailbox panel heading changed from "Live-Postfach (IMAP/SMTP)" to "Mail Postfach (IMAP/SMTP)" (`apps/web/src/features/communication/HimalayaMailbox.tsx:91`) and the new "Messenger-Nachricht" compose panel (`apps/web/src/features/communication/MessengerCompose.tsx:120-136`) appears. Baselines are Linux-only (`tests/e2e/__screenshots__/visual.spec.ts/communication-1080p-linux.png`, `communication-long-german-1080p-linux.png`), so the two snapshots were regenerated in WSL (Friday-Ubuntu) with `pnpm test:e2e tests/e2e/visual.spec.ts -g "communication" --update-snapshots` and re-run without the flag to confirm green. Windows baselines untouched. Residual risk: WSL font rendering can differ minimally from `ubuntu-latest` runners; the next CI run is the final proof.

## Verification

- Focused re-run of all previously failing tests (Windows, this branch): command-bar:70, a11y:203, reconnect:33/76/87, performance:72 green (6 passed); alerts:247 reproduced red ("WhatsApp · Übersprungen" vs "Geplant") before its fix.
- Full local spec files after all fixes: alerts.spec.ts 10/10 passed (1.8 min); command-bar + a11y + reconnect + performance + tasks + scenarios together: 58 passed, 1 failed (14.4 min). The single failure is performance.spec.ts:21 ("activity feed … virtualised and scrolls responsively"), a frame-time threshold assertion (scroll p95 183–217 ms vs a 191.75 ms bound derived from idle p95) that is untouched by this repair and passed on the CI runner (shard 5, 1.1 min, run 39201131580) — a local software-rendering environment flake on this Windows host, not a regression.
- Web typecheck (`apps/web`, `tsc --noEmit`): clean.
- ESLint on all six changed test files: clean.
- `git diff --check`: clean.
- WSL (Friday-Ubuntu, node v24.21.0, pnpm 10.28.2, Playwright chromium-1248): `visual.spec.ts -g "communication" --update-snapshots` regenerated exactly the two intended PNGs (2 passed, 2.9 min); the same selection without the flag passed against the new baselines (2 passed, 2.7 min). The new `communication-1080p-linux.png` was visually inspected and shows the intended "Mail Postfach (IMAP/SMTP)" heading and the "Messenger-Nachricht" panel.

## Changed files

- `tests/e2e/support/api.ts` — new `ApiClient.createTask` staged-flow helper
- `tests/e2e/reconnect.spec.ts` — 4 call sites on `createTask`
- `tests/e2e/performance.spec.ts` — 2 call sites on `createTask`
- `tests/e2e/command-bar.spec.ts` — tier-2 confirmations disabled in test :70
- `tests/e2e/a11y.spec.ts` — tier-2 confirmations disabled + preview confirmed by keyboard in test :203
- `tests/e2e/alerts.spec.ts` — test :247 asserts the truthful "Übersprungen" state for the disabled WhatsApp channel
- `tests/e2e/__screenshots__/visual.spec.ts/communication-1080p-linux.png`, `communication-long-german-1080p-linux.png` — regenerated Linux baselines (intended UI change)

## Remaining notes

- scenarios.spec.ts:4 and tasks.spec.ts:84 are documented infrastructure flakes with no product fix; if they recur on CI, a bounded orb-mount wait or runner investigation would be a separate change.
- performance.spec.ts:21 fails intermittently on this Windows host only (frame-time threshold under software rendering); green on CI. No code change.
- Visual baselines were produced in WSL, not on a GitHub runner; CI remains the final verification for the two new PNGs.
