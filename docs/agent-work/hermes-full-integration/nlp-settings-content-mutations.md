# Settings and Content Studio natural-language mutation evidence

This document records only the local behavior added in the isolated
`feat/nlp-settings-content-mutations-20261020` worktree. It is not an NLP
acceptance claim and does not change `acceptance-ledger.md` statuses. The
rename, description and scheduling actions described below are a second local
slice after commit `763ac9a`. Date, format and platform edits are a third local
slice. Manual posting create/status and bounded idea/post removals were added in
the fourth slice; dashboard refresh interval is a fifth slice and background
grid, sound effects and Content Studio gating are a sixth local slice. A seventh
slice adds guided Content Studio browser import/export; each slice remains
subject to root review and broader integration checks.

## Implemented actions and source path

| Utterance family | Typed intent | Native operation | Evidence / boundary |
|---|---|---|---|
| `set dashboard compact mode on/off` / German equivalents | `settings.dashboard.compact` | Owner-authenticated command stages a preview, then calls `settingsHandlers.updateSettings` with the captured `ifMatchVersion`; stale settings fail closed. | `services/settings-content-mutation-intent.ts`, `handlers/settings-content-actions.ts`; runtime effect is explicitly not separately verified. |
| `set dashboard refresh to <5..3600> seconds` / German equivalents | `settings.dashboard.refresh` | Accepts only the dashboard schema integer range and calls the canonical settings update handler with captured Settings version. | UI callback is the refresh NumberField in `BasicAreas.tsx`; `AppShell.tsx` consumes the stored value for refresh fallback. API test verifies persisted readback, version bump and replay; runtime timing is not separately verified. |
| `set dashboard background grid/sound effects/content studio to on/off` or `enable/disable content studio` | `settings.dashboard.backgroundGrid`, `settings.dashboard.soundEffects`, `settings.dashboard.contentStudioEnabled` | Three separate typed intents update one schema field each through the canonical settings handler with captured Settings version. | UI callbacks are the switches in `BasicAreas.tsx`; grid applies in `lib/settings.tsx`, sound is consumed by `lib/realtime/applyEvent.ts`, and Content Studio gate is enforced by its route/handler. API tests verify persisted values. Runtime effect is not separately verified. |
| `add/create idea <title> to the Content Studio plan` / German equivalents | `contentStudio.idea.add` | Owner-authenticated command stages a preview, then appends one idea through `contentStudioHandlers.putContentStudioPlan` with captured plan revision. Defaults are LinkedIn, Feed-Post, empty description/date, status Idee. | `handlers/content-studio.ts` is the canonical persistence route; no provider is called. Exact UI counterpart is `ContentStudioPage.tsx` `addIdea`; this NL action currently covers creation only, not edit/status/delete. |
| `set status of idea <exact title> to in progress/done/idea` / German equivalents | `contentStudio.idea.status` | Resolves one unique exact title before staging, previews the target status, then updates only that idea through the canonical plan handler with captured plan revision. Missing or duplicate titles fail before a draft is created. | Exact UI counterpart is `ContentStudioPage.tsx` Kanban `onStatus`; tests cover owner-only access, persisted status, replay, and duplicate-title clarification by failure. |
| `rename idea "<old>" to "<new>"` | `contentStudio.idea.rename` | Resolves one unique case-insensitive title before staging; disallows colliding new titles; previews both titles and updates the canonical plan with captured revision. | Exact UI counterpart is `ContentStudioPage.tsx` `editIdea`/`addIdea`; tests cover discard, corrected-preview rejection and replay. Only the title field is exposed by this NL action. |
| `set description of idea "<title>" to "<text>"` | `contentStudio.idea.description` | Resolves one unique case-insensitive title, binds the full bounded description in the preview, and changes only that field through the canonical plan handler with captured revision. Newlines are preserved. | Exact UI counterpart is the description field in `addIdea`; test confirms stored description. Quotes are delimiters; embedded literal quote escaping is not implemented. |
| `set target date of idea "<title>" to YYYY-MM-DD` or `clear` | `contentStudio.idea.date` | Resolves one unique title and accepts a valid calendar date or explicit clear; updates only `zieldatum` through canonical plan persistence with captured revision. | Exact UI counterpart is the date field in `addIdea`; tests exercise accepted date and stored value. |
| `set format of idea "<title>" to "<supported format>"` | `contentStudio.idea.format` | Accepts only one of the nine contract formats and updates only `format` through canonical plan persistence with captured revision. | Exact UI counterpart is the format selector in `addIdea`; tests verify stored enum. Unsupported values are rejected before staging. |
| `set platforms of idea "<title>" to "Instagram and Facebook"` | `contentStudio.idea.targets` | Accepts one to five unique supported platform names, stores the first as legacy `plattform` and all choices in `ziele`, matching the UI form. | Exact UI counterpart is the multi-select platform controls in `addIdea`; tests verify list and primary platform. |
| `remove idea "<title>"` | `contentStudio.idea.remove` | Resolves one unique title before staging; preview states related postings remain. Confirm removes only the idea with plan CAS. | Exact UI counterpart is IdeaKanban `onRemove`; tests verify discard, idea removal and preservation of associated posting rows. |
| `schedule idea "<title>" for YYYY-MM-DD` / German equivalents | `contentStudio.posting.fromIdea` | Resolves one unique case-insensitive title before staging; creates one planned posting with the explicit date, UI default time 09:00, and the idea's current targets/format. Existing target list is preserved; no provider call or publication occurs. | Exact UI counterpart is Kanban `onPlan`/`addPosting`; tests verify discard, multi-target metadata, owner-only access, replay, stale CAS and no lost concurrent plan edit. |
| `schedule posting "<title>" for YYYY-MM-DD at HH:MM on <platform> as "<format>"` | `contentStudio.posting.create` | Requires valid explicit date/time and supported platform/format; stages one local planned posting and stores only via canonical plan PUT+CAS. | Exact UI counterpart is manual `addManualPosting`; tests verify metadata and replay. This stores a plan entry only; it never publishes. |
| `set status of posting "<title>" on YYYY-MM-DD at HH:MM to planned/posted/missed` | `contentStudio.posting.status` | Resolves one unique title/date/time tuple before staging and updates only the status through canonical plan persistence with captured revision. | Exact UI counterpart is PostingCalendar/list status selector; tests verify persisted `gepostet` state. Ambiguous tuples fail before staging. |
| `remove posting "<title>" on YYYY-MM-DD at HH:MM` | `contentStudio.posting.remove` | Resolves one unique tuple before staging, previews the exact item, and removes only that row via canonical plan CAS after confirmation. | Exact UI counterpart is the Postingplan `Entfernen` button; tests verify explicit preview and stored removal. |
| `retry task <id/title>` / selected task, including German restart phrasing | `task.retry` | Resolves task before staging, checks retryable state, captures `task.retry` in the native approval journal, and calls the existing task port with the journal idempotency key after confirmation. | Exact operation is `retryTask`; preview/approval/replay tested against a failed fixture task. This adds a missing NL consumer to the existing direct retry endpoint. |
| `export/download Content Studio plan` or `import Content Studio plan` / German equivalents | `contentStudio.plan.exportGuided` / `contentStudio.plan.importGuided` | Returns the Content Studio route and explicit instructions for the existing browser download or JSON file picker. It does not read arbitrary paths, upload bytes, or pretend the file operation already occurred. | `ContentStudioPage.tsx`: `downloadPlan`, “Plan exportieren” button, “Plan importieren” button, hidden JSON file input and `importPlan` change handler. API test checks owner-only access and unchanged server plan revision. The actual download/file selection remains a user browser step. |

These actions pin the concrete payload and revision in the native preview,
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
| NLP-01 | Every UI action has an accessible language/text action or justified guided physical step. | Settings compact/refresh/grid/sound/Content Studio gate; Content Studio add/status/rename/description/date/format/platform/idea schedule/manual posting create/status and idea/post removal; task.retry; plan import/export are guided to the actual browser controls. Settings and plan read consumers exist in the earlier read slice. | Still unmapped: other Settings fields; media, production and publishing UI actions. Continue the dashboard-wide callback inventory. |
| NLP-02 | References/pronouns resolve to the intended entity. | Content Studio title references resolve exact unique idea title before staging; no cross-turn pronoun context is added. | Add scoped context and multi-turn references across entity families. |
| NLP-03 | Ambiguous recipients/calendars prompt for clarification. | Title-based Content Studio actions refuse duplicate titles before staging. | Implement conversational clarification turn for recipient/calendar and title ambiguity; current duplicate rejection is safe but not a clarification exchange. |
| NLP-04 | Any material correction invalidates prior approval. | Native mutation drafts bind exact new title, description, status and plan date/payload; rename tests reject a corrected title against the old preview. | Cross-family recipient/channel corrections and existing approval-edit paths remain unverified. |
| NLP-05 | Spoken/text claims match backend outcome. | Local saved revision is returned for these writes; stale writes fail closed. Settings message distinguishes saved state from unverified runtime effect. | Test injected success/rejection/timeout and compare response claims with persisted/provider outcome across all action families. |
| NLP-06 | End-to-end passes synthetic audio fixtures and separately documents real device path. | No audio fixture or physical device execution in this slice. | Synthetic audio E2E remains required; physical microphone/speaker evidence is a separate external/hardware step. |

No provider-backed generation, social publishing, or credential mutation is
reachable from these intents. Those require their own preview, approval, cost,
and provider-result contract before command exposure.
