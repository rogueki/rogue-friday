# Contract and write-scope freeze (BASE-03 / DASH-02 precondition)

Recorded 2026-10-21 on `feat/friday-finalization-20261021` (base `e98cbf5`).
Gate proof: `pnpm contracts:check` → `ok lint / validate / check-generated / breaking`, exit 0.
No contract file was changed for this task; the check confirms that source schemas, generated SDK and the
breaking baseline agree on this revision.

## 1. Decision table — one existing type per required concept

Nothing new is invented. Each row names the type that already exists and is therefore binding for the
following tasks.

| Concept (master §3.1) | Binding type (schema `$id`) | Revision/concurrency | Existing consumers |
|---|---|---|---|
| Integration/account ID | `integrations/integration-account.schema.json` → `IntegrationAccount` (`id`, `kind`, `ownerId`, `configRevision`, `secretState`) | `configRevision` (integer) | `apps/control-api/src/services/adapter-settings.ts`, `handlers/settings.ts` |
| Account status | `integrations/integration-status.schema.json` → `IntegrationStatus` (`installed`, `configured`, `authenticated`, `connected`, `canRead`, `canWrite`, `checkedAt`, `errorCode`, `persistedRevision`, `appliedRevision`, `verification` ∈ verified/unverified/failed/requires_restart) | both revisions | settings + integration handlers |
| Config revision | `settings/settings.schema.json` → `Settings.version`; mutation guard `ctx.mutation.ifMatchVersion` | optimistic `If-Match` | `handlers/settings.ts:328,419,439` (throws `conflict` on mismatch) |
| ApplyResult | `integrations/apply-result.schema.json` → `persisted`, `applied`, `verified`, `requiresRestart`, `errorCode`, `compensation` ∈ not_needed/restored/failed, `persistedRevision`, `appliedRevision` | explicit split of stored vs applied | adapter/mail/gateway settings |
| Credential references | `common/secret-status.schema.json` → `SecretStatus` (`configured`, `maskedHint`) inside `IntegrationAccount.secretState`; config side uses `file:` / `env:` / `wincred:` refs | masked only | `runtime/adapter-wiring.ts` (`resolveSecret`) |
| Job ID | no single generic job type — the four real job families stay: `ContentProductionJob.id`, `AutomationRun.id`, `wake-enrollment-job.schema.json`, `skills/coding-run.schema.json`; every job carries `correlationId` and, where long-running, `Progress` (`common/progress.schema.json`: `mode`, nullable `value`) | job `version` where optimistic concurrency is needed (`AutomationRun.version`) | handlers for studio, automations, voice enrollment, coding runs |
| Events / sequence | `events/event-envelope.schema.json` → required `sequence`, `correlationId`, `causationId`, `contractVersion`, typed `data` | monotonic `sequence` per stream; `events/resync-required.schema.json` for gaps | `apps/control-api/src/realtime/hub.ts` |
| Cancellation | per-family endpoints, all present in `openapi/friday-api.yaml`: `/tasks/{id}/cancel|retry`, `/agents/{id}/stop`, `/voice/stop`, `/voice/stt-models/cancel`, `/content-studio/production-jobs/{id}/cancel`, `/coding-runs/{runId}/stop`, `/commands/stop`; body `tasks/task-action-request.schema.json` (`reason`, `confirm`) | `TaskActionRequest` reused, no parallel DTO | handlers per family |
| Capabilities | `meta/capabilities.schema.json` (`contractVersion`, `modules`, `integrations`) and `integrations/capability-descriptor.schema.json` (`availability` ∈ available/needs_setup/unsupported/offline, `requires`, `roles`, `reasonCode`) | `contractVersion` | `handlers/meta.ts`, settings navigation |
| Voice status | `voice/voice-status.schema.json` (`source`, `mode`, `microphone`, `wakeWord`, `speakerVerification`, `trustedSession`, `stt`, `tts`, `localModel`, `audioInputDeviceId`, `audioOutputDeviceId`, `ttsVoiceChoice`, `serviceStartedAt`) plus `voice/voice-device.schema.json` for the real device list | `updatedAt` + `source` descriptor | `services/voice*.ts`, `handlers/browser-voice.ts` |
| Install manifest | **installer-internal**, not an API type: `<InstallRoot>/config/install-state.json` (already read by `calendar-accounts.ts`, `coding-runs.ts`, `hermes-config.ts`, `hermes-skill-keys.ts`, `himalaya-account.ts`, `mail-accounts.ts`) | file-level, no revision | those services only; never exposed as its own REST DTO |

## 2. Consequences that are now binding

1. **No parallel DTOs.** A new UI need is expressed by extending one of the types above and running
   `pnpm contracts:generate`; hand-written request/response shapes in `apps/web/src/lib/api` are not allowed.
2. **Every write follows one path** (master §4.1): validate against expected `If-Match` revision → persist →
   apply → read back → return `ApplyResult` with *both* revisions and `verification`. A stored value is never
   reported as "working".
3. **Secrets cross the API only as `SecretStatus`.** Keys never appear in `IntegrationAccount`, events, job
   payloads or logs; config references stay `file:`/`env:`/`wincred:`.
4. **Status vocabulary** is the `IntegrationStatus`/`verification` set; `null` means unknown, never "green".
5. **Install manifest stays read-only input** for the dashboard. DASH-12 reads enrollment/calibration from
   `voice.json` + `install-state.json`; it does not invent a second manifest file.

## 3. Write scopes for the next parallel work (one owner each)

| Scope | Owner of the files | Files |
|---|---|---|
| Contracts/SDK | one task at a time, never parallel | `packages/contracts/**`, generated `packages/generated-sdk/**` |
| Settings router | one owner | `apps/control-api/src/handlers/settings.ts`, `services/settings.ts`, `services/adapter-settings.ts` |
| Adapter wiring / runtime | one owner | `apps/control-api/src/runtime/**`, `apps/control-api/src/services/adapter-settings.ts` |
| Installer main | one owner | `installer/install-friday.ps1`, `installer/install-friday-gui.ps1`, `installer/wsl/**` |
| Web settings shell | separate owner per page | `apps/web/src/features/settings/**`, `apps/web/src/lib/api/domains/**` |

Rule for parallel work: read-only comparison (Studio, Hermes inventory) may run next to anything; no two
owners touch the same row above at the same time.

## 4. Open contract work (tracked, not silently skipped)

- `DASH-02.02`: role/capability check per new operation — `CapabilityDescriptor.roles` exists, but a handler
  audit is still required to prove every operation declares and enforces it.
- `DASH-02.03`: settings changed by UI **and** by voice must hit the same action; the intent layer
  (`settings-content-actions.ts`) currently computes `expectedVersion` itself — the readback binding has to be
  proven per field in KEEP-04.
- `DASH-02.04`: handler tests for success/timeout/403/conflict/unknown outcome are still to be written.
- `DASH-05/06/08/09`: mail/calendar/messenger/gateway schemas already exist
  (`integrations/mail-*`, `calendar/caldav-*`, `integrations/messenger-*`,
  `settings/{telegram,whatsapp,discord}-gateway*`); their *real* adapters and status readback are the remaining work.