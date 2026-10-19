# P2/P2b voice Stop and audio devices — integration evidence

## Implemented runtime paths

- `installer/voice/friday_voice.py`: spoken, browser-button, and local authenticated Stop use `cancel_active_interaction`; it increments the cancellation generation, interrupts TTS, clears pending approvals and follow-up context, and returns to `wake_only`. A bounded local detector receives Host and browser PCM during active interactions. Playback PCM is retained for at most eight seconds in memory as an echo reference; matched TTS is ignored without disabling user Stop for the whole utterance. No wake-only audio is archived.
- `installer/voice/browser_audio.py`: authenticated browser PCM feeds the same detector. Browser TTS PCM updates the echo reference after successful send. Actual browser playback timing is not acknowledged by the browser, so this is a bounded reference, not proof of acoustic isolation.
- `installer/voice/audio_devices.py`, `select_audio_devices.py`, `friday_voice.py`: read-only host enumeration exposes stable IDs based on backend, endpoint name, and direction; duplicate indistinguishable names on one backend fail closed. Selected input and output are independently resolved and opened. `/control/audio` authenticates the change, persists it atomically after opening, returns an ACK, and attempts rollback on failure. Hotplug loss sets `waiting_audio` and cancels the active interaction instead of silently falling back.
- `adapters/voice-http/src/{adapter,mapping,provider-types}.ts`, `apps/control-api/src/{services/voice-audio.ts,handlers/settings.ts}`, `apps/web/src/features/settings/BasicAreas.tsx`, `apps/web/src/lib/api/domains/voice.ts`: host inventory reaches the device dropdowns; a settings change needs live apply ACK and process-bound read-back before the field is verified. Unavailable selected devices remain visible as disconnected. The handler independently attempts persona and device compensation after a failed combined change.
- `packages/ui/src/components/Shell.tsx`, `apps/web/src/features/shell/AppBottomBar.tsx`: the overview omits the speech Pause control and its accessibility target; Stop remains. Other routes keep their existing automation Pause behavior.
- `installer/voice/friday_voice.py` consumes the durable, redacted `installer/voice/memory_outbox.py` from P3 for eligible voice events. The memory search result is bounded and marked as untrusted context. This is P3-owned storage/API functionality, tested separately.
- `installer/scripts/update-dashboard-github.ps1` and `update-voice-personas.ps1` include the new voice Python dependencies in their update payloads. P3 may extend the dashboard updater for its plugin in parallel.

## Verification performed

| Check | Result |
| --- | --- |
| Focused Python voice/device/outbox/update closure tests | 54 passed before the final browser-reference test |
| Browser bridge tests with local WebSocket and synthetic PCM | 3 passed |
| Browser PCM echo-reference regression | 1 passed |
| Voice HTTP adapter tests | 100 passed |
| Control API settings rollback and audio ACK tests | 4 and 2 passed respectively after the final compensation change; combined-change restoration covered |
| Overview bottom-bar tests | 7 passed |
| Control API and web TypeScript typechecks | Passed before the final test-only/browser-reference change |
| `git diff --check` | Passed before this document |

Test runs used synthetic PCM and fake services. Read-only Windows host enumeration returned 19 endpoints, including the connected soundcore R50i input/output on the observed machine. No microphone stream, audible TTS, paid provider, service restart, deployment, commit, or push was performed.

## Criteria and limits

- STOP-02/03/04/06 and UI-STOP-01/03 have code and synthetic regression evidence. STOP-01/05/07/08 have only partial synthetic evidence: no physical barge-in, acoustic echo, wake/re-wake, or archive inspection was performed. The Stop detector shares an STT lock with the main transcriber, so latency during a competing transcription is not yet bounded by a measured physical p95. Tool actions already committed by external providers cannot be undone by local Stop.
- AUDIO-01 has read-only host enumeration and dropdown wiring; AUDIO-02/03/04/05/06/09 have code-path and synthetic evidence. An endpoint whose backend/name/direction tuple is ambiguous is rejected rather than assigned a false stable ID. A renamed endpoint needs reselection. AUDIO-07/08 remain unverified on physical hardware: no loopback capture, real headset recording, audio after change, physical Bluetooth profile transition, or wake/Stop/TTS after switch was run. Permissions and occupied-endpoint error display have code paths but were not induced on hardware.
- `listVoiceProfiles` still returns an empty/unknown list; speaker profile inventory is an open integration gap. The remaining VoiceArea fields outside persona and device selection still need the P7 consumer/status matrix and should not be presented as runtime-verified merely because they are saved.
- Browser playback has no device identity controlled by the host settings; browser input/output selection belongs to browser permissions and the operating system. The browser echo reference records PCM sent to the browser, but cannot prove the browser played it at that instant or that its microphone captured the same signal.
