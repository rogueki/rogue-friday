# Acceptance ledger — Friday / Hermes full integration

Source: `implementation-spec.md`, sections 3–17. Original requirements baseline: `841f0771f52c81b78ea57fd4012161c11c4efbf3`; this evidence refresh is made against `30a5da196df983091f468a1b08db13f4b68b1f8f` and cites later scoped commits explicitly. The status in the acceptance table means the full stated minimum evidence is complete. A local implementation or synthetic fixture can be `PASS_LOCAL` while the acceptance row remains `NOT_RUN` because live/provider/hardware or cross-package evidence is outstanding. `BLOCKED_EXTERNAL` and `BLOCKED_HARDWARE` are reserved for a demonstrated unavailable prerequisite, not an assumed absence. No aggregate completion is implied.

## Local package evidence index (not acceptance closure)

These references record scoped implementation checks from the cited commits/worktrees. They do not change the criterion statuses below: a row remains `NOT_RUN` until its stated minimum evidence is complete. Provider, hardware, live-install and full end-to-end evidence remain separately gated. `settings-runtime-map.csv` distinguishes `LOCAL_FIXTURE_PASS` from source-only/test-gap states; `restart` stays `NOT_RUN` where no restart was exercised. `dashboard-coverage.csv` adds local evidence while all 20 full-coverage rows remain `REVIEW_REQUIRED` and voice action coverage remains `UNMAPPED`.

| Package | Local implementation / fixture status and evidence | Full acceptance status / remaining gate |
|---|---|---|
| P2 voice and controls | **PASS_LOCAL_FIXTURES**: [`p2-voice.md`](p2-voice.md) records focused voice/device, browser bridge, adapter, API, and overview checks. | Physical headset/device behavior and specified Stop latency remain **NOT_RUN**. |
| P3 memory | **PASS_LOCAL_FIXTURES**: [`p3-memory.md`](p3-memory.md), [`p3-review.md`](p3-review.md) record local service/handler, voice outbox privacy, Hermes plugin, installer fixtures, and targeted fixes for both review findings. | Live voice/API and Hermes runtime, cross-process/host restarts, and clean-host Obsidian/WSL installation remain **NOT_RUN**. |
| P4 mail / P5 calendar | **PASS_LOCAL_FIXTURES**: [`p4-evidence.md`](p4-evidence.md), [`p5-calendar.md`](p5-calendar.md) record package-local parser, account, permission, recurrence, and fixture evidence. | Controlled mailbox/calendar authorization and actual provider send/receive/write behavior remain **NOT_RUN**. |
| P6 messaging | **PASS_LOCAL_FIXTURES**: [`p6a-messaging.md`](p6a-messaging.md), [`p6b-messaging.md`](p6b-messaging.md) record local configuration, approval, redaction, inbound-owner binding, and Python bridge fixtures. | Actual QR/account pairing, provider connectivity and message delivery remain **NOT_RUN** external gates. |
| P7 Hermes config | `ba00c80`, `cd4aa50`, `edef918`, `ba7641b`, `fbdd548`, `c7baaa9`, `baee829` plus [`p7a-evidence.md`](p7a-evidence.md), [`p7b-evidence.md`](p7b-evidence.md), [`p7c-evidence.md`](p7c-evidence.md): typed model/fallback and agent/session/context controls; local bridge/API/voice fixtures described per package. | **PASS_LOCAL_FIXTURES** for the cited slices; full P7 / DOD-02 remains **NOT_RUN**. D/E/F are open; persisted values without an instance receipt remain `applied: null`; provider authentication and live Hermes reload are not proven. |
| P8-1 profile/dashboard UI | **PASS_LOCAL_FIXTURES**: [`p8-1-ui-evidence.md`](p8-1-ui-evidence.md), commit `cc31cb4ca20307facbf210c5786a638414f4ae70`; Web typecheck/lint and five focused Vitest files, 31 tests. | SETTINGS-ALL-01/04 and DOD-02 remain **NOT_RUN**: field matrix, live browser restart/deployment, and full dashboard actions are not covered. |
| P8-2 security and approvals | **PASS_LOCAL_FIXTURES**: [`p8-2-security-approval.md`](p8-2-security-approval.md); commits `1b9d23f`, `66401c0`, `5a2936e`; four session/origin tests and two approval-policy tests. | Security acceptance and DOD-13 remain **NOT_RUN** for live login/provider effects; approval executor integration remains P9 work. |
| P8-3 notifications | **PASS_LOCAL_FIXTURES**: `1ea1a97` / `80a7627`, 40 focused tests reported passing; `2ba1a06` targeted alert-escalation Playwright passed 1/1 in 42 s (`friday-wave2-alert-e2e.log`). `78532a6` integrated local suite passed 3068 with 60 skipped and app build passed (`friday-wave2-inbound-full.log`, `friday-wave2-inbound-build.log`). | Notification acceptance and DOD-07/08/10 remain **NOT_RUN** for provider/phone delivery. Local state is truthful owner approval/staging and real-receipt reconciliation; external channel delivery and phone/hardware behavior were not exercised. Full GitHub CI remains a separate gate. |
| P8-4 backup/retention | **PASS_LOCAL_FIXTURES**: [`p8-4-evidence.md`](p8-4-evidence.md), checkpoint `e6f23c7ab0ad061aa6c66cf327efe4f330c50984`; synthetic archive/backup/restore-isolation/retention fixtures and read-only WSL inventory plan. | Full restore/recovery and DOD-05/13/14 remain **NOT_RUN**: no live export, prune, restore, reinstall, external destination, or physical durability proof. |
| P8-5 developer controls | **PASS_LOCAL_FIXTURES**: `253793a` two focused API tests and API typecheck; `5c4cff7c4b9cef25b1d33cae705350e0b857a130` logging suites, 22 tests, ESLint, diff check. | DOD-15 remains **NOT_RUN** pending final integrated CI. Installed runtime behavior and Orb overlay end-to-end proof remain open. |
| Orb background/resume CI diagnosis | **PASS_FOCUSED_E2E**: isolated commit `9c8d059`; Playwright showed visible 221, hidden 0, resumed 170 draw calls/s after explicitly restoring the default profile; original thresholds unchanged. | This one targeted run is not a full CI result; DOD-15 remains **NOT_RUN**. |
| Cross-package hygiene | **PASS_FOCUSED_TESTS**: `5c4cff7` logging fixtures and the scoped BottomCommandBar/mutation fixes have targeted checks; see commits/test paths in history. | Integrated local test/build pass is recorded above; final GitHub CI remains outstanding, so DOD-15 remains **NOT_RUN**. |

## Highest-priority implementation gaps with no completed package evidence

“Unowned” here means no completed implementation/evidence package is recorded in this ledger; confirm assignment before starting a work item. P2 is preparing a shared approval-aware executor foundation and Task Create, followed by Task Status/Cancel; that planned work is explicitly not counted as delivered. The 71 residual `NO_CONSUMER_HIT` / `CANDIDATE_HIT_REVIEW` settings rows (48 / 23) are static-search triage labels, not 71 confirmed defects; each requires source/consumer review before any implementation claim.

| Priority | Gap | Required implementation boundary | Dependency / acceptance |
|---|---|---|---|
| 1 | P9 natural-language action execution outside the planned task family: agent, calendar, mail, messenger, file/knowledge, automation and research actions. | Typed family handlers over existing domain APIs; clarify ambiguous entities; create exact preview; use native approval/reauth; persist real receipt; invalidate changed drafts. No arbitrary command/API dispatcher. | P1 contracts and P2 shared executor; NLP-01..06, STOP-02..07. Real provider effects stay separate. |
| 2 | P7-D Hermes execution/browser/tool permission controls. | Map every field to pinned Hermes validator and actual consumer; typed, owner-gated UI/API; least privilege, dry-run/effective status and restart/apply receipt. | P7-A bridge; approvals remain Friday authority. Tool execution cannot be enabled by saved config alone. |
| 3 | P7-E installed skills, plugins and MCP setup/activation. | Configure only installed/source-verified entries; typed schema and secret lifecycle; report installed/enabled/authenticated/available separately; guide uninstalled offerings without green status. | P7-A inventory and P6 connector ownership. No static catalog entry proves local installation. |
| 4 | P7-F cron, hooks, gateway, logging and monitoring controls. | Trace each pinned key to scheduler/runtime, clarify timezone/reload semantics, and distinguish Hermes cron from Friday automation and notifications. | P7-A; P8 notification/backup contracts. Require effective runtime receipt. |
| 5 | P8 field-by-field settings and dashboard matrix closure. | Review the residual `NO_STATIC_HIT`/`CANDIDATE_HIT_REVIEW` rows in `settings-runtime-map.csv`; prove choices, validation, persistence, apply/read-back, restart, conflict, error, discard, responsive UX and language coverage per field. | P8 domain packages and P9; SETTINGS-ALL-01..04. A consumer path or stored value alone is insufficient. |

| ID | Acceptance / Definition of Done | Minimum evidence required | Status |
|---|---|---|---|
| MEM-01 | Every supported input channel stores the correct identity, user input, and Friday response in the Vault. | Inject one synthetic interaction per channel; inspect event IDs, role, identity, response and source in Vault. | NOT_RUN |
| MEM-02 | Confirmed events survive Voice, API, Hermes, Windows and WSL restarts. | Persist events, restart each process/side, reconcile event IDs and content. | NOT_RUN |
| MEM-03 | A later session retrieves an earlier fact with its source. | Seed dated fact; query in a fresh session; assert source/date citation. | NOT_RUN |
| MEM-04 | Correction supersedes stale fact; deletion removes active retrieval. | Add, correct, query, tombstone/delete, query again and inspect index. | NOT_RUN |
| MEM-05 | Crash between outbox enqueue and Vault write causes neither loss nor duplicate. | Fault-inject at write boundary; restart/replay; compare stable IDs and count. | NOT_RUN |
| MEM-06 | Offline/full/unwritable storage is visible and queued data saves after recovery. | Simulate unavailable and full/read-only target; inspect error/queue; restore and replay. | NOT_RUN |
| MEM-07 | Separate Vault restore succeeds and search index rebuilds from restored data. | Restore backup to isolated Vault; rebuild index; retrieve known source. | NOT_RUN |
| MEM-08 | Credentials and designated private inputs are absent from archive, index and diagnostic export. | Seed canary secrets/private fields; scan all three outputs and logs. | NOT_RUN |
| MEM-09 | Memory continues when Obsidian GUI is closed. | Close Obsidian; submit, persist and retrieve a synthetic interaction. | NOT_RUN |
| MAIL-01 | Two differently configured accounts remain isolated. | Configure two controlled test accounts; enumerate, read and send to unique fixtures. | NOT_RUN |
| MAIL-02 | Mail configuration and protected secrets survive service/host restart. | Save in isolated test profile; restart; verify secret status and successful auth without revealing secret. | NOT_RUN |
| MAIL-03 | Read, search, reply and Sent copy work against a real controlled mailbox. | Provider-backed test with synthetic messages; verify server-side Sent copy. | NOT_RUN |
| MAIL-04 | Bad password, TLS, port and expired token have actionable errors. | Exercise each negative fixture; assert code/message and no false connected state. | NOT_RUN |
| MAIL-05 | Retry/timeout after possible delivery cannot silently duplicate a send. | Simulate ambiguous provider timeout and retry; inspect idempotency/result reconciliation. | NOT_RUN |
| MAIL-06 | Product uses “Mail Postfach”; user-defined account names remain intact. | Search UI/API/seed/migration labels; migration fixture preserves custom names. | NOT_RUN |
| MAIL-07 | Multi-step natural mail dialog resolves pronouns/ordinals and accepts correction. | Script paraphrase, recipient/message selection, ordinal reference and correction; inspect final action. | NOT_RUN |
| MSG-01 | Each supported messenger is fully configurable from Friday. | For Telegram/WhatsApp and each inventoried connector, complete setup and status flow in controlled account. | NOT_RUN |
| MSG-02 | Receive and targeted test send work against the real channel. | Send/receive synthetic test message; capture redacted provider and Friday evidence. | NOT_RUN |
| MSG-03 | Token/QR expiration, revoked session and restart are handled. | Run expiry/revoke/restart fixtures; require visible disconnected state and recoverable setup. | NOT_RUN |
| MSG-04 | Allowlist and owner identity are enforced by runtime. | Positive and unauthorized identity tests; verify denied action creates no side effect. | NOT_RUN |
| MSG-05 | Cross-channel identity and memory are correct; unrelated users’ content never crosses contexts. | Two identities across two channels; inspect retrieval isolation and stored attribution. | NOT_RUN |
| MSG-06 | Approval binds to final recipient, channel and content. | Change each after approval; old approval must invalidate; verify no delivery until reapproval. | NOT_RUN |
| CAL-01 | Multiple existing calendars are discovered and selectable. | Connect controlled account with multiple calendars; compare provider inventory with UI. | NOT_RUN |
| CAL-02 | Create/read/update/delete works on a controlled writable real calendar. | Provider-backed CRUD with unique synthetic event; clean up only test event. | NOT_RUN |
| CAL-03 | Read-only permission is detected and writes are blocked. | Use read-only fixture/account; verify capability and denied write. | NOT_RUN |
| CAL-04 | ETag conflict preserves concurrent external edits. | Change event externally between read/write; assert conflict and no lost update. | NOT_RUN |
| CAL-05 | Recurrence, DST and all-day boundaries are correct. | Contract fixtures across DST transition, recurrence and timezone boundaries; provider confirmation where supported. | NOT_RUN |
| CAL-06 | UI, language, Hermes and memory observe the same calendar event. | Create/update through each path; compare stable provider event ID and memory event. | NOT_RUN |
| NLP-01 | Every UI action has an accessible language/text action or justified guided physical step. | Join dashboard action inventory to capability catalog and run coverage check. | NOT_RUN |
| NLP-02 | References/pronouns resolve to the intended entity. | Multi-turn fixtures with unique contacts/calendars/items; assert selected IDs. | NOT_RUN |
| NLP-03 | Ambiguous recipients/calendars prompt for clarification. | Ambiguous fixtures; assert no action before clarification. | NOT_RUN |
| NLP-04 | Any material correction invalidates prior approval. | Approve then alter content/recipient/channel; assert new approval required. | NOT_RUN |
| NLP-05 | Spoken/text claims match backend outcome. | Inject success, rejection and timeout; compare utterance with persisted/provider result. | NOT_RUN |
| NLP-06 | End-to-end passes synthetic audio fixtures and separately documents real device path. | Automated audio-fixture run plus separate physical microphone/speaker evidence; text-only is insufficient. | NOT_RUN |
| STOP-01 | Stop works in listening, transcription, reasoning, tool wait and speech. | Trigger Stop in every state; record state transition and output cancellation. | NOT_RUN |
| STOP-02 | Slow model/tool callback cannot produce a late response after Stop. | Delay tool/model, Stop, release callback; assert no response/action. | NOT_RUN |
| STOP-03 | Stop clears pending mail/calendar/messenger approvals. | Create pending approvals in each family; Stop; verify invalidation. | NOT_RUN |
| STOP-04 | Following speech is ignored until a new wake word. | Stop, speak follow-up without wake; assert no transcription/action. | NOT_RUN |
| STOP-05 | New wake word resumes a normal dialog. | After Stop, issue wake word then synthetic command; verify regular processing. | NOT_RUN |
| STOP-06 | Button and spoken Stop share cancellation semantics. | Same in-flight operation stopped by each path; compare cancellation generation, approvals and output. | NOT_RUN |
| STOP-07 | TTS saying “Stop” does not self-cancel. | Speak generated response containing “Stop”; assert only user-originated command cancels. | NOT_RUN |
| STOP-08 | Wake-only mode does not retain a persistent audio archive. | Inspect storage/logs over wake-only interval and verify no audio payload retained. | NOT_RUN |
| UI-STOP-01 | No speech Pause button appears on desktop/mobile overview or accessibility tree. | Browser checks at responsive breakpoints plus accessibility-tree query. | NOT_RUN |
| UI-STOP-02 | Stop returns to wake-ready and next wake word starts a dialog. | Browser/device flow tied to STOP-05 and status indicator. | NOT_RUN |
| UI-STOP-03 | No orphaned shortcut, tooltip or Resume dependency remains. | Search UI strings/shortcut registry; keyboard and help walkthrough. | NOT_RUN |
| AUDIO-01 | Connected target headset appears in live device query and selector. | Enumerate on the actual audio host and select the physical endpoint. | NOT_RUN |
| AUDIO-02 | Voice service confirms the chosen device is actually opened. | Compare selected stable ID to runtime applied/open endpoint status. | NOT_RUN |
| AUDIO-03 | Input and output devices are independently selectable. | Apply distinct endpoints; verify active capture and playback IDs. | NOT_RUN |
| AUDIO-04 | Device selection survives service/host restart and changed transient indices. | Restart/re-enumerate with changed index; verify stable ID resolution. | NOT_RUN |
| AUDIO-05 | Disconnect/reconnect and Bluetooth profile changes are visible and recoverable. | Physical hotplug/profile cycle; record status and reapply behavior. | NOT_RUN |
| AUDIO-06 | Permission-denied or exclusively busy device shows a clear error. | Exercise both negative cases on audio host; assert no green/applied status. | NOT_RUN |
| AUDIO-07 | Synthetic loopback proves pipeline; real headset capture is separately evidenced. | Automated loopback proof plus physical capture proof; never substitute mock. | NOT_RUN |
| AUDIO-08 | Wake, Stop and TTS remain functional after device switch. | Run all three against selected endpoints. | NOT_RUN |
| AUDIO-09 | Missing selected microphone never silently falls back to another. | Remove endpoint; verify explicit unavailable status and no capture from default. | NOT_RUN |
| SETTINGS-ALL-01 | Every setting field has a named runtime consumer. | Complete settings-runtime map; reject blank consumer rows. | NOT_RUN |
| SETTINGS-ALL-02 | A saved value alone never reports the feature as functioning. | For every field family, force apply failure and verify status is not healthy. | NOT_RUN |
| SETTINGS-ALL-03 | External device/account/model choices reflect actual inventory and show errors. | Compare discovery API/UI with provider/runtime fixture including empty/error result. | NOT_RUN |
| SETTINGS-ALL-04 | Complete field matrix has evidence for every required check. | Close all 12 field-level checks per matrix row; publish linked evidence. | NOT_RUN |

## Field-level evidence required for every setting

For each row in `settings-runtime-map.csv`, record: (1) source of choices, (2) read-back matches effective configuration including pre-existing values, (3) type/range/dependency validation, (4) persistent save with write-only secret handling, (5) actual apply/restart, (6) domain-specific observed effect, (7) restart persistence/effect, (8) concurrent edit conflict behavior, (9) separate load/save/apply/verify errors, (10) discard and compensation behavior, (11) keyboard/mobile/labels/help/loading/empty-list usability, and (12) query/setup/change via natural language. Explicit coverage includes wake word, push-to-talk, speaker profile, STT language/model, TTS voice/speed, audio input/output, model routing/fallback, quiet hours, notification channels, session timeout, approvals, retention, backups, storage paths, location, theme/layout, and every provider field.

## Definition of Done (all must be evidenced)

| DoD | Requirement | Status |
|---|---|---|
| DOD-01 | Versioned Hermes inventory is complete and every feature/setting is mapped. | NOT_RUN |
| DOD-02 | Every offered feature is natively configurable and has a real backend execution path. | NOT_RUN |
| DOD-03 | No production mocks and no settings without runtime consumers. | NOT_RUN |
| DOD-04 | Obsidian is the default; cross-channel interactions persist and are retrievable. | NOT_RUN |
| DOD-05 | Memory restart, crash and restore evidence exists. | NOT_RUN |
| DOD-06 | Provider-neutral multi-account Mail Postfach has complete IMAP/SMTP setup. | NOT_RUN |
| DOD-07 | WhatsApp QR and Telegram are natively configured and tested against real channels. | NOT_RUN |
| DOD-08 | Other inventoried communication routes and their settings are integrated. | NOT_RUN |
| DOD-09 | Existing calendars are discovered and actual write access is tested. | NOT_RUN |
| DOD-10 | Entire dashboard matrix is accepted with real actions and settings. | NOT_RUN |
| DOD-11 | Natural language covers all action families, context and changes. | NOT_RUN |
| DOD-12 | Spoken/button Stop share cancellation contract; only wake word reactivates. | NOT_RUN |
| DOD-13 | Secrets, existing data and custom settings are protected and retained. | NOT_RUN |
| DOD-14 | Clean-environment install, upgrade and rollback are verified. | NOT_RUN |
| DOD-15 | Relevant local checks and final CI pass; known regressions are closed or explicitly open. | NOT_RUN |
| DOD-16 | README/help, architecture/operations docs, version matrix and project memory are updated. | NOT_RUN |

## Evidence record format

For every result add UTC date, code SHA and runtime/provider versions, criterion ID, exact command or manual path, outcome, artifact/log reference with secrets redacted, limitations, and reviewer. A screenshot proves visible UI only; HTTP 200 proves reachability only. Missing account/provider consent is `BLOCKED_EXTERNAL`; physical headset use and stop-latency measurement are `BLOCKED_HARDWARE` until actually exercised. Do not claim a weekly quota, price or fixed cost unless independently established from the current provider/account terms.
