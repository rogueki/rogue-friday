# P8-4 retention and system backup evidence

## Store ownership and behavior

| Setting | Actual consumer | Preservation boundary |
| --- | --- | --- |
| `activityDays` | `command_history` rows with non-voice origin | Friday command history only; the mock Activity feed is ephemeral and has no durable rows to prune. The UI labels this precisely. |
| `voiceHistoryDays` | `command_history` rows with voice origin | Does not touch the voice memory outbox, Vault, or pending delivery. |
| `auditDays` | Contiguous old prefix of `audit_log` moved to registered, checksummed local `audit-archive` segments | This is hot-store archiving, **not permanent deletion or disk retention**. The hash chain, signed head and archived segments remain verifiable; segments are included in system backup. |
| `notificationDays` | `NotificationStore.countResolvedBefore/deleteResolvedBefore` | Only resolved notifications with no pending dispatch are removed; open/acknowledged/snoozed and pending escalation remain. |
| `temporaryFileDays` | Registered `SystemBackupService` staging directories with matching random ownership marker | Unregistered/user directories and completed backups are not selected. |
| `memoryDefaultTtlDays` | No expiration consumer | P3 Obsidian policy is unlimited. Server rejects non-null TTL and UI disables the field. |

`RetentionService` runs at most once per successful 24-hour window, exposes owner-only dry-run counts and a manual run, and records confirmed partial results when a later stage fails. A retention run does not hold a transaction across filesystem archive or temporary cleanup; retry is idempotent and the result must not claim all-or-nothing execution.

## Backup source map

The system snapshot uses SQLite online backup for `dashboard.sqlite`, `voice-memory.sqlite`, and `memory/outbox.sqlite`; file/hash inventories cover Friday auth and scoped bridge keys (including the inbound messenger bridge), Windows install/config/voice references, registered audit segments, a separately verified P3 Memory backup, and WSL Hermes/profile/mail/calendar/Himalaya state. The WSL helper recognizes SQLite by header rather than extension, includes WAL size in planning, copies via SQLite backup, and records database paths for integrity checks. A clean, pinned Hermes checkout revision is recorded in the WSL manifest.

The WSL `.hermes` roots `hermes-agent`, `tools`, `installs`, and `cache` are explicitly excluded as reprovisionable code/runtime/dependency caches. The checkout must have no local changes or the backup fails. Hermes source `hermes_cli/_launchers.py:709-714` identifies `<home>/tools` as the runtime store; `hermes_cli/worktree_ops.py:981-985` identifies `<home>/installs` as dependency state. Nested user skills/plugins/configuration, including their own `cache` directories, remain included. Unix IPC sockets are not serializable and are skipped; other linked or special user-state files fail closed. WSL `manifest.json` records exclusions and the 40-character checkout revision so a later recovery flow can reprovision the exact release.

The owner UI and API identify restore as **isolated verification only**. It creates a new inert directory and never overwrites the live Vault, newer data, or the install. Operational recovery still requires reinstalling the pinned Hermes revision and its runtime/dependencies, then a separately reviewed import/switch procedure (P10). A successful restore test is not proof of a bootable restored system.

## Verification and limits

Synthetic tests cover archive/restart/append, missing or changed segments, a concurrent append, backup/archive snapshot race failure, SQLite WAL-only `.sqlite3` data, source links, restore canaries, exact inventories, backup hash and DB integrity, retention partial failures, owner/CSRF API guards, and notification retention. On the established WSL profile, a **read-only plan** returned 451 files, 84,325,028 bytes in 1.2 seconds. No live export, prune, restore, reinstall or update was run.

The backup destination's available space and the source volume's temporary snapshot space are checked separately. Windows private staging ACLs and per-file flushes protect copied credentials. This is source-level and temporary-data verification; physical media durability, external backup destination, and a live operational recovery remain unverified.
