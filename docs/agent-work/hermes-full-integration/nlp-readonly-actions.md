# Bounded read-only natural-language commands

This branch adds deterministic English and German read intents for Activity, Notifications, Approvals, and Audit to `POST /api/v1/commands`. The parser accepts a finite family vocabulary, optional single status and bounded time window where the existing list operation supports one, or one exact opaque ID for detail reads. It never forwards free text as an API filter, query, or SQL fragment. Mixed families/statuses, unsupported periods, malformed or cross-family IDs return a clarification response.

| Family | Native operation | Role gate | Response fields | Explicit limitation |
|---|---|---|---|---|
| Activity | `activity.listActivity` / `activity.getActivity` | viewer read minimum; command route itself requires operator | ID, kind, status, severity, occurred time | Max 5; optional lookback capped at 30 days |
| Notifications | `notifications.listNotifications` | viewer read minimum; command route itself requires operator | ID, status, severity/category and timestamps | Max 5; no detail GET is exposed |
| Approvals | `approvals.listApprovals` / `approvals.getApproval` | viewer read minimum; command route itself requires operator | ID, status and timestamps | Max 5; preserves native per-user scoping; no action/rationale/context or decision token |
| Audit | `audit.listAuditEvents` / `audit.getAuditEvent` | viewer read minimum; command route itself requires operator | ID, category, result, severity and timestamp | Max 5; lookback capped at 30 days; export remains owner-only UI/API operation and is not an NL read |

Read commands are always redacted in command history, including otherwise ordinary-looking text. Audit context records only the typed `read_<family>.<operation>` intent. Results omit notification text, approval action/rationale, and audit before/after/context payloads. Empty pages return an explicit no-results message; truncation is reported when the source has another page.

Verification in this worktree:

- `apps/control-api/src/services/read-query-intent.test.ts`: English/German grammar, finite statuses, bounds, ambiguous family/status, malformed domains and unsupported notification detail.
- `apps/control-api/test/read-command-intents.test.ts`: local Activity fixture is read through the real port and compared with the direct API; Notifications/Approvals are compared against their direct list endpoints; audit read/export role gates and private-output redaction are asserted; viewer command access is denied while the viewer GET remains available.
- `node_modules/vitest/vitest.mjs run apps/control-api/src/services/read-query-intent.test.ts apps/control-api/test/read-command-intents.test.ts`: passed (7 tests).
- `node_modules/typescript/bin/tsc -p apps/control-api/tsconfig.json --noEmit`: passed.

This is local API/test evidence, not live/hardware or freshly installed end-to-end evidence. Content Studio reads and cross-family pronoun resolution remain separate follow-up work.
