# Independent P3 review

Scope: targeted source review of memory privacy, identity boundaries, durable queue/restore behavior, Hermes bridge, and the memory updater. This is a review of the current shared worktree, not an overall acceptance decision. No live provider, Windows/WSL migration, or physical device was exercised.

## Findings and disposition

### RESOLVED — Voice “do not store” requests were persisted (historical finding, P1)

`installer/voice/friday_voice.py:1217` assigns `memory_dialog_private` from `mail_voice.handles_text(text)`. That method at `installer/voice/mail_voice.py:60-66` recognizes mail workflow commands; it is not a privacy-intent detector. The ordinary voice path then queues the utterance as eligible at `friday_voice.py:1218-1219`, and `_queue_memory_event` writes eligible events to the local SQLite outbox (`friday_voice.py:831-854`, `installer/voice/memory_outbox.py:112-124`). The Hermes plugin has a separate private-intent check (`installer/wsl/friday_memory_plugin/__init__.py:183-187`), but voice does not.

**Reproduction:** enable memory and the voice channel with private mode off; submit “Friday, bitte speichere dieses Gespräch nicht” (or equivalent English wording) through the voice transcript path. `MailVoice.handles_text` is false, so the event is marked eligible and queued on disk; assistant replies in the dialog inherit the false privacy flag. The memory backend then receives both.

**Fix:** add a dedicated shared privacy-intent predicate and apply it before either utterance or response enqueue. Mark the whole dialog private, avoid adding the triggering transcript to the local outbox, and test German/English cues plus subsequent turns in both voice and Hermes paths. A test only asserting that an explicitly pre-marked `private=True` event is rejected does not cover this user-facing route.

**Current evidence:** the current implementation uses a dedicated privacy-intent predicate for the voice transcript path, marks the rest of that session private and excludes assistant replies. `installer/voice/test_memory_outbox.py` now has `test_verified_voice_transcript_private_intent_blocks_entire_session`; the focused voice outbox suite passed 6/6, and Hermes intent fixtures passed 4/4. See [`p3-memory.md`](p3-memory.md). This resolves the reviewed source defect locally; a live voice/API session remains unverified.

### RESOLVED — Restore failure could delete a pre-existing neighboring SQLite file (historical finding, P2)

`apps/control-api/src/services/durable-memory.ts:481-484` derives the restore index path from the requested target basename in its parent and opens it without an exclusive-create check. On any restore error, `durable-memory.ts:497-500` removes that path unconditionally. Thus a same-named user file already present at that location can be modified or deleted by a failed restore. A successful restore can also reuse an existing SQLite database via `CREATE TABLE IF NOT EXISTS`.

**Reproduction:** create a valid backup; create `memory/restored-memory-index.sqlite` containing a canary (or a SQLite database with a conflicting `entries` table); request restore to `memory/restored`. Force insertion to fail with a duplicate ID in the pre-existing index, or use a backup whose content fails after target/index creation. The catch block removes `restored-memory-index.sqlite`, including the pre-existing file.

**Fix:** build the restored Vault and index in a unique staging directory created exclusively for that invocation; reject an existing target and index; on failure remove only paths recorded as created by this call. Publish the new isolated result atomically after successful validation. Add a regression test that asserts a pre-existing canary index is byte-for-byte unchanged after a failed restore.

**Current evidence:** restore now uses an isolated restore location and refuses a pre-existing neighboring index before staging. `apps/control-api/src/services/durable-memory.test.ts` has `never opens or deletes a pre-existing neighboring restore index`; the service and handler tests passed 16/16. See [`p3-memory.md`](p3-memory.md). This resolves the reviewed data-loss path in local tests; clean-host filesystem/restore proof remains unverified.

## Reviewed paths without a confirmed defect

- API capture checks global/private/channel policy before queueing (`durable-memory.ts:194-215`); the HTTP handler binds voice/Hermes sources and owner identity, and search filters by identity (`handlers/durable-memory.ts:29-70`, service `:339-359`). I found no demonstrated cross-identity retrieval in these paths.
- API forget/tombstone work is transactional and pending deletes are retried on startup/flush (`durable-memory.ts:362-400`, runtime startup in `apps/control-api/src/runtime/create-runtime.ts`).
- The update helper snapshots the listed Windows bridge files and WSL Hermes config/plugin, then attempts both rollbacks on apply failure (`installer/scripts/update-memory-bridge.ps1`). The WSL helper snapshots before apply when called in update mode (`installer/wsl/configure_memory_bridge.py:155-178`); the wrapper marks the WSL attempt before calling it so its failure path invokes rollback. I found no confirmed user-data deletion in this updater flow.
- Voice and Hermes capture ordinary user/assistant text and explicitly mark the voice dialog cancellation as aborted; I did not find a path that reports an external action as completed without evidence. Runtime speech delivery is not implied by an archived assistant response.

## Verification limits

This source review did not execute the voice controller against the API, a live Hermes gateway, or Windows/WSL update/rollback. The two source findings are resolved by current targeted local regression evidence; those tests do not prove a live runtime or fresh-host install.
