# Acceptance ledger — Friday / Hermes full integration

Source: `implementation-spec.md`, sections 3–17. Baseline for this implementation run: `rogue-friday-clean` at `841f0771f52c81b78ea57fd4012161c11c4efbf3`. This ledger records intended proof, not completed work. All results begin `NOT_RUN`; update a row only with dated, revision-bound evidence. Use `BLOCKED_EXTERNAL` for unavailable provider accounts/consent and `BLOCKED_HARDWARE` for physical device evidence. Synthetic tests do not close external or hardware gates.

## Local package evidence index (not acceptance closure)

These references record scoped implementation checks in the shared worktree. They do not change the criterion statuses below: a row remains `NOT_RUN` until its stated minimum evidence is complete. Provider, hardware, live-install and full end-to-end evidence remain separately gated.

| Package | Local evidence | Remaining gate |
|---|---|---|
| P2 voice and controls | [`p2-voice.md`](p2-voice.md): focused voice/device, browser bridge, adapter, API, and overview checks. | Physical headset/device behavior and specified Stop latency remain unverified. |
| P3 memory | [`p3-memory.md`](p3-memory.md), [`p3-review.md`](p3-review.md): service/handler, voice outbox privacy, Hermes plugin, and installer fixture checks; both independent review findings have targeted regression evidence. | Live voice/API and Hermes runtime, cross-process/host restarts, and clean-host Obsidian/WSL installation remain unverified. |
| P4 mail | [`p4-evidence.md`](p4-evidence.md) records package-local results and explicitly separates provider-gated checks. | Controlled mailbox/provider authorization and send/receive proof remain external. |
| P5 calendar | [`p5-calendar.md`](p5-calendar.md): local CalDAV/ICS parsing, account, permission, recurrence, and fixture checks. | Controlled provider discovery and writable/read-only calendar behavior remain external. |
| P6a messaging | [`p6a-messaging.md`](p6a-messaging.md): 12 local fake/protocol/configuration tests. | Physical WhatsApp QR pairing, real Telegram account, gateway and message delivery remain external. |
| Cross-package lint/test hygiene | Current focused ESLint and mail/WhatsApp tests passed; BottomCommandBar component tests passed 9/9. | These narrow checks do not replace final integrated CI or acceptance runs. |

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



