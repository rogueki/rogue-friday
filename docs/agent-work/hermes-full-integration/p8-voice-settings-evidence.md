# P8 Voice settings runtime evidence

Scope: isolated synthetic fixtures only. No installed voice service, microphone, user recording, or live Friday state was changed. The existing uncommitted Automation worktree was not touched.

| Criterion | Runtime path | Current verification / limit |
| --- | --- | --- |
| `wakeWordEnabled` | Wake detection and barge-in gate in `friday_voice.py` | Apply/readback and disabled wake path; STOP listener remains independent. |
| `wakeWord` | Trained model phrase from `voice.json` | Changed phrase rejected with 422; no model retraining workflow yet. This field is **open**. |
| `pushToTalkKey` | Global browser keyboard hold/release, WebSocket control, voice session | Browser path and shortcut tests pass; changed key with device transport rejected with 422. Device path is **open**. |
| `speakerVerificationRequired` | Owner verifier and bridge permissions | `true` remains enforced. `false` rejected with 422 because the bridge cannot assign an unverified speaker a safe identity. This field is **open**. |
| `storeRawRecordings` | Accepted non-STOP command only, opt-in WAV in protected local state directory | Default false; no wake-only archive. ACL and write fixture tested. Retention sweep occurs on startup/hourly while service runs, so deletion is not a strict 24-hour wall-clock guarantee while offline. |
| `voiceHistoryEnabled` | Python conversation history, memory outbox, control API capture gate | Disable clears in-memory history, purges pending voice outbox and prevents new voice memory capture. Existing previously delivered durable memories are not automatically deleted. |
| `ttsRate` | PCM pacing for configured TTS outputs | Numeric validation, live config/readback and sample-duration test; pacing also changes pitch. |
| `ttsVoice` | Existing voice persona control | Existing apply/readback retained; rollback now uses observed pre-apply persona. |
| `inputDeviceId` | Existing device switch | Existing apply/readback retained; rollback now uses observed pre-apply input. |
| `outputDeviceId` | Existing device switch | Existing apply/readback retained; rollback now uses observed pre-apply output. |
| Settings import | Same live apply/ACK/readback route before import persistence | Import keeps the effective legacy wake phrase and records ACK at imported revision; regression test covers this path. |
| Integration status | Active process ID, actual settings, persisted revision, local ACK | Field verification is withheld after process restart or when browser PTT is unavailable. |

The dashboard update and voice-persona payloads include `runtime_settings.py` in the pinned dependency closure. The voice process publishes a configuration revision and requires the caller's observed revision and process identity on settings apply. Its settings, persona, and device writes share the process lock. The Control API applies before committing settings, checks process identity and readback, and rolls back runtime settings only against the revision it demonstrably wrote. A narrow race with a non-cooperating external file writer between final hash check and replace is still possible; there is no cross-process lock for arbitrary editors. Voice-history outbox purge occurs only after the configuration commit; a purge failure leaves capture/delivery disabled and is logged for retry by the worker.

Validation run in this isolated branch: `uvx --with numpy --with scipy --with scikit-learn pytest installer/voice/tests/test_runtime_settings.py installer/voice/tests/test_personal_wake.py -q`; targeted Vitest API/Web tests; API and Web TypeScript checks; Python syntax check. Live hardware, fresh install and end-to-end browser session are pending the planned clean-install phase.
