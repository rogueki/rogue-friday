# Settings and Content Studio natural-language mutation evidence

This document records only the local behavior added in the isolated
`feat/nlp-settings-content-mutations-20261020` worktree. It is not an NLP
acceptance claim and does not change `acceptance-ledger.md` statuses.

## Implemented actions and source path

| Utterance family | Typed intent | Native operation | Evidence / boundary |
|---|---|---|---|
| `set dashboard compact mode on/off` / German equivalents | `settings.dashboard.compact` | Owner-authenticated command stages a preview, then calls `settingsHandlers.updateSettings` with the captured `ifMatchVersion`; stale settings fail closed. | `services/settings-content-mutation-intent.ts`, `handlers/settings-content-actions.ts`; runtime effect is explicitly not separately verified. |
| `add/create idea <title> to the Content Studio plan` / German equivalents | `contentStudio.idea.add` | Owner-authenticated command stages a preview, then appends one idea through `contentStudioHandlers.putContentStudioPlan` with captured plan revision. Defaults are LinkedIn, Feed-Post, empty description/date, status Idee. | `handlers/content-studio.ts` is the canonical persistence route; no provider is called. Exact UI counterpart is `ContentStudioPage.tsx` `addIdea`; this NL action currently covers creation only, not edit/status/delete. |
| `set status of idea <exact title> to in progress/done/idea` / German equivalents | `contentStudio.idea.status` | Resolves one unique exact title before staging, previews the target status, then updates only that idea through the canonical plan handler with captured plan revision. Missing or duplicate titles fail before a draft is created. | Exact UI counterpart is `ContentStudioPage.tsx` Kanban `onStatus`; tests cover owner-only access, persisted status, replay, and duplicate-title clarification by failure. |
| `retry task <id/title>` / selected task, including German restart phrasing | `task.retry` | Resolves task before staging, checks retryable state, captures `task.retry` in the native approval journal, and calls the existing task port with the journal idempotency key after confirmation. | Exact operation is `retryTask`; preview/approval/replay tested against a failed fixture task. This adds a missing NL consumer to the existing direct retry endpoint. |

Both operations pin the concrete payload and revision in the native preview,
reject a corrected payload against an old preview, and use the existing native
confirmation executor for idempotent replay/uncertain-result handling. Inputs
are redacted from command history; audit records contain typed intent metadata,
not the idea title. The Content Studio action requires the module enabled.
These are bounded owner-local edits and use risk tier 1. The native policy only
routes tier 2 (when configured) or tier 3 through the approval executor; these
actions therefore cannot produce an unexecutable `requires_approval` result.
`draftOnlyByDefault` still leaves a same-owner staged draft that must be
explicitly confirmed. Tests exercise that policy combination.

Focused verification currently covers parser behavior, owner authorization,
preview/discard/confirm/replay, correction invalidation, stale revision and
uncertain result handling, plus command/read precedence. It does not establish
physical voice behavior or full natural-language coverage.

## Original acceptance ledger NLP-01..06

| ID | Exact requirement | Current evidence | Remaining work / boundary |
|---|---|---|---|
| NLP-01 | Every UI action has an accessible language/text action or justified guided physical step. | Three Settings/Content Studio mutations plus task.retry; read consumers for Settings and plan exist in the earlier read slice. | Inventory and map each UI callback to a real typed command or a justified guided step. Settings field actions and Content Studio edit/remove/posting/import/export remain unmapped; the dashboard-wide inventory is not closed. |
| NLP-02 | References/pronouns resolve to the intended entity. | No cross-turn entity/reference behavior added in this mutation slice. Exact idea title is stored as action data, not resolved at confirm time. | Add scoped reference context, unique resolution, and multi-turn fixtures across entity families. |
| NLP-03 | Ambiguous recipients/calendars prompt for clarification. | Settings has no entity reference. Content Studio status mutation refuses duplicate exact titles before staging. | Add ambiguity fixtures for recipient/calendar selectors and other title-based Content Studio operations; no action before clarification. |
| NLP-04 | Any material correction invalidates prior approval. | These three native drafts bind their intent payload; tests reject a changed intent with an existing preview. | Cross-family recipient/channel corrections and existing approval-edit paths remain unverified. |
| NLP-05 | Spoken/text claims match backend outcome. | Local saved revision is returned for these writes; stale writes fail closed. Settings message distinguishes saved state from unverified runtime effect. | Test injected success/rejection/timeout and compare response claims with persisted/provider outcome across all action families. |
| NLP-06 | End-to-end passes synthetic audio fixtures and separately documents real device path. | No audio fixture or physical device execution in this slice. | Synthetic audio E2E remains required; physical microphone/speaker evidence is a separate external/hardware step. |

No provider-backed generation, social publishing, or credential mutation is
reachable from these intents. Those require their own preview, approval, cost,
and provider-result contract before command exposure.
