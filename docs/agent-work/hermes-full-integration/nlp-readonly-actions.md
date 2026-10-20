# Bounded read-only natural-language commands

This branch adds a finite, deterministic English and German read grammar for Activity, Notifications, Approvals, and Audit to `POST /api/v1/commands`. This is scoped vocabulary coverage, not full-language coverage. The parser accepts recognized family words, an optional single supported status, bounded lookback periods where the existing list operation supports them, or one exact opaque ID for detail reads. Unrecognized filter terms and mixed read/write requests return clarification instead of silently widening to an unfiltered list. Free text is never forwarded as an API filter, query, or SQL fragment.

| Family | Native operation | Role gate | Response fields | Explicit limitation |
|---|---|---|---|---|
| Activity | `activity.listActivity` / `activity.getActivityEvent` | viewer read minimum; command route itself requires operator | ID, kind, status, severity, occurred time | Max 5; optional lookback capped at 30 days |
| Notifications | `notifications.listNotifications` | viewer read minimum; command route itself requires operator | ID, status, priority/category and timestamps | Max 5; no detail GET is exposed; detail help lists only supported status filters |
| Approvals | `approvals.listApprovals` / `approvals.getApproval` | viewer read minimum; command route itself requires operator | ID, status and timestamps | Max 5; native approvals are per-user scoped and native-first like the GET handler; no action/rationale/context or decision token |
| Audit | `audit.listAuditEvents` / `audit.getAuditEvent` | viewer read minimum; command route itself requires operator | ID, category, result, severity and timestamp | Max 5; lookback capped at 30 days; export remains owner-only UI/API operation and is not an NL read |

Relative `today/heute` and `yesterday/gestern` requests clarify because a correct civil-day boundary requires an explicit timezone. Use an explicit period such as `last 24 hours` instead. Read commands are always redacted in command history, including otherwise ordinary-looking text. Audit context records only the typed `read_<family>.<operation>` intent. Results omit notification text, approval action/rationale, and audit before/after/context payloads. Empty pages return an explicit no-results message; truncation is reported when the source has another page.

Verification in this worktree:

- `apps/control-api/src/services/read-query-intent.test.ts`: German umlauts, English/German status phrases, finite status grammar, unsupported filters, mixed write/read text, ambiguous family/status, date boundaries, malformed domains, and unsupported notification detail.
- `apps/control-api/test/read-command-intents.test.ts`: local Activity fixture is read through the real port and compared with the direct API; Notifications/Approvals are compared against their direct list endpoints; a native approval is compared against owner list behavior and foreign-owner detail behavior; audit read/export role gates and private-output redaction are asserted; viewer command access is denied while viewer GET remains available.
- `node_modules/vitest/vitest.mjs run apps/control-api/src/services/read-query-intent.test.ts apps/control-api/test/read-command-intents.test.ts`: passed (8 tests).
- `node_modules/typescript/bin/tsc -p apps/control-api/tsconfig.json --noEmit`: passed.

This is local API/test evidence, not live/hardware or freshly installed end-to-end evidence. Content Studio reads and cross-family pronoun resolution remain separate follow-up work.
