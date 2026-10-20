# P9 automation WIP review

## Scope and revisions

- Old working tree: `rogue-friday-clean`, `feat/hermes-integration-wave2-20261019`, HEAD `028e9f897118e141f604776dc210333a07d30c36`, with 13 modified tracked files and 4 untracked files (17 changed paths total).
- Merged package: main `f570014f8d248f29b124eba8d0415529a29c8444`, automation implementation commit `64752c5`, UI integration commit `fb2f8db`, documentation commit `6d91baf`.
- Review was read-only against the old working tree. The review and regression test are isolated in branch `codex/automation-capability-guard`, based on main `f570014`.

## WIP coverage

All 17 old-WIP paths are present in the merged package and their behavior is carried forward:

- API staging and approval: `approvals.ts`, `commands.ts`, `domain-ops.ts`, `handlers/index.ts`, `native-approval-requests.ts`, plus the two contract tests.
- API implementation: the old untracked `automation-actions.ts`, `automation-action-intent.ts`, `automation-action-intent.test.ts`, and `native-automation-action.test.ts` are included in the package implementation commit.
- Web: `AutomationDrawer.tsx`, `AutomationWizard.tsx`, `AutomationsPage.tsx`, the German and English automation strings, and `lib/api/domains/automations.ts` are included in the UI integration.

The merged package also completes two write paths absent from the 17-file WIP: `TestPanel.tsx` stages its exact dry-run sample through `useRunStagedWrite`, and `GlobalCommandPalette.tsx` uses the same runner for a real automation test, with its own action preview plus the server-bound preview. `automations.test.tsx` was updated to exercise the shared staged flow. Pause-all remains one bulk request; resume remains a per-automation update because the API contract has no bulk resume operation.

Semantic checks found no WIP-only behavior lost by the merge. The API pins versions for edits/toggles, binds repeat bodies to stored previews, routes tier-2 approvals through the automation dispatcher, and returns stored receipts on replay. The German command path resolves exact IDs/names or a single selected target before staging and rejects missing/ambiguous targets. The UI migrates create/edit, enable/disable, pause/resume, and dry-run actions to the shared confirmation flow.

## Capability-revocation investigation

Hypothesis: a capability turned off after a tier-2 approval is staged might be bypassed because `dispatchAutomationAction` checks the port method while its handler checks capability flags before staging.

The isolated regression stages a disable action with tier-2 approval enabled, turns off `automations.disable`, and then tries to approve it. The test asserts that both the capability toggle and approval lookup succeeded; the approval returns `403 CAPABILITY_MISSING`, and the automation remains enabled. The hypothesis is disproved: `packages/adapter-core/src/registry.ts` rechecks the declared operation capability on every wrapped port invocation (`runtime.capabilities.has(spec.capability)`) before calling the adapter. No production guard change is needed. The focused regression is retained to protect this apply-time behavior.

## Verification evidence and limits

The package evidence in `docs/agent-work/hermes-full-integration/p9-automation-actions.md` records 109 focused API tests, the complete local suite at 245 files / 3368 passed / 61 skipped, conformance at 415 passed / 60 skipped, and passing contracts, lint, typechecks and app build. CI evidence recorded in `MEMORY.md` is 10/10 jobs successful for the merged `f570014` main revision (run `39369620624`). On this review branch, these commands passed:

```text
pnpm --filter @friday/control-api exec vitest run test/native-automation-action.test.ts -t "rechecks the disabled capability"
  1 test passed; 7 skipped

pnpm --filter @friday/control-api exec vitest run test/native-automation-action.test.ts test/automation-action-intent.test.ts test/contract.test.ts test/contract-gaps.test.ts
  4 files passed; 110 tests passed

pnpm --filter @friday/control-api typecheck
  passed
```

No production implementation was changed.

Live Hermes scheduler behavior, downstream provider effects, and live restart during dispatch remain `NOT_RUN`; mock-port tests establish pipeline behavior only.
