// GENERATED — do not edit. Source of truth: packages/contracts (run `pnpm contracts:generate`).
/* eslint-disable */
export interface paths {
    "/api/v1/activity": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List activity events; use sinceSequence to backfill after a reconnect */
        get: operations["listActivity"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/activity/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get one activity event */
        get: operations["getActivityEvent"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/adapters": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List registered adapters with manifest and health */
        get: operations["listAdapters"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/adapters/{id}/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Health of one adapter */
        get: operations["getAdapterHealth"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/adapters/{id}/logs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Recent redacted log lines of one adapter from the Control API log buffer */
        get: operations["getAdapterLogs"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/adapters/{id}/restart": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Restart one adapter (owner, audited; shutdown, new instance, initialize) */
        post: operations["restartAdapter"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/agents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List agents */
        get: operations["listAgents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/agents/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get one agent */
        get: operations["getAgent"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/agents/{id}/pause": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Pause an agent */
        post: operations["pauseAgent"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/agents/{id}/resume": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Resume an agent */
        post: operations["resumeAgent"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/agents/{id}/stop": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Stop an agent */
        post: operations["stopAgent"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/approvals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List approvals */
        get: operations["listApprovals"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/approvals/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get one approval */
        get: operations["getApproval"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/approvals/{id}/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Approve (optionally with edited preview). Tier 3 requires re-authentication. */
        post: operations["approveApproval"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/approvals/{id}/reject": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Reject an approval */
        post: operations["rejectApproval"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/approvals/{id}/request-context": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Ask the agent for more context before deciding */
        post: operations["requestApprovalContext"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/audit/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List audit events */
        get: operations["listAuditEvents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/audit/events/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get one audit event with before/after and child events */
        get: operations["getAuditEvent"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/audit/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Export audit events */
        get: operations["exportAudit"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Sign in and receive the session cookie */
        post: operations["login"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** End the current session */
        post: operations["logout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/logout-all": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** End all sessions of the current user */
        post: operations["logoutAll"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/reauth": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Re-authenticate for Tier-3 actions and receive a short-lived token */
        post: operations["reauth"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/session": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Current session, role and CSRF token */
        get: operations["getSession"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/automations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List automations */
        get: operations["listAutomations"];
        put?: never;
        /** Create an automation */
        post: operations["createAutomation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/automations/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get one automation */
        get: operations["getAutomation"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update an automation (increments version) */
        patch: operations["updateAutomation"];
        trace?: never;
    };
    "/api/v1/automations/{id}/disable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Disable an automation */
        post: operations["disableAutomation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/automations/{id}/enable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Enable an automation */
        post: operations["enableAutomation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/automations/{id}/runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Run history with trigger reason, conditions and results */
        get: operations["listAutomationRuns"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/automations/{id}/test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Dry run / test with mock data */
        post: operations["testAutomation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/automations/{id}/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Version history of an automation, newest first */
        get: operations["listAutomationVersions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/automations/pause-all": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Pause every enabled automation (Pause All) and report the outcome per automation */
        post: operations["pauseAllAutomations"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/calendar/briefings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List meeting briefings */
        get: operations["listCalendarBriefings"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/calendar/caldav/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create a timed event after owner confirmation; one conditional PUT only */
        post: operations["createCalendarEvent"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/calendar/caldav/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Preview a single timed event in the configured CalDAV collection */
        post: operations["previewCalDavEvent"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/calendar/conflicts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List detected conflicts */
        get: operations["listCalendarConflicts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/calendar/connected/voice/confirm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Execute the exact confirmed connected calendar voice action once */
        post: operations["confirmVoiceConnectedCalendar"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/calendar/connected/voice/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Preview an explicitly named connected calendar voice action */
        post: operations["previewVoiceConnectedCalendar"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/calendar/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List calendar events in a time range */
        get: operations["listCalendarEvents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/calendar/events/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get one calendar event */
        get: operations["getCalendarEvent"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/calendar/local/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create an event in Friday's local calendar */
        post: operations["createLocalCalendarEvent"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/calendar/local/events/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Update a local event at its current revision */
        put: operations["updateLocalCalendarEvent"];
        post?: never;
        /** Delete a local event at its current revision */
        delete: operations["deleteLocalCalendarEvent"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/calendar/local/voice/confirm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Execute the exact confirmed local calendar voice operation once */
        post: operations["confirmVoiceLocalCalendar"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/calendar/local/voice/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Preview one local calendar voice operation with a short-lived confirmation token */
        post: operations["previewVoiceLocalCalendar"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/calendar/proposals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Propose a calendar change; goes through approval */
        post: operations["createCalendarProposal"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/capabilities": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Capability discovery for all modules */
        get: operations["getCapabilities"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/coding-runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Start the selected native WSL Coding CLI in an owner-selected Git repository */
        post: operations["createCodingRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/coding-runs/{runId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Poll a native Coding CLI run */
        get: operations["getCodingRun"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/coding-runs/{runId}/stop": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Stop a running native Coding CLI task */
        post: operations["stopCodingRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/coding-runs/cli-status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read local native CLI installation and authentication hints without account details */
        get: operations["getCodingCliStatus"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/coding-runs/voice": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Start a confirmed voice coding task in the saved repository alias */
        post: operations["createVoiceCodingRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/coding-runs/voice-repository": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read the owner-selected repository alias for verified voice coding */
        get: operations["getCodingVoiceRepository"];
        /** Save one owner-selected repository alias */
        put: operations["putCodingVoiceRepository"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/commands": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Execute a command; write actions first return a preview */
        post: operations["executeCommand"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/commands/history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Recent commands (sensitive ones redacted) */
        get: operations["listCommandHistory"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/commands/pause": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Pause work (agents, automations, voice) */
        post: operations["pauseCommand"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/commands/resume": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Resume paused work */
        post: operations["resumeCommand"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/commands/stop": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Stop current work */
        post: operations["stopCommand"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/communication/channels": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List channels with status and capabilities */
        get: operations["listChannels"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/communication/drafts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List drafts, optionally of one thread */
        get: operations["listDrafts"];
        put?: never;
        /** Create a draft */
        post: operations["createDraft"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/communication/drafts/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Edit a draft */
        patch: operations["updateDraft"];
        trace?: never;
    };
    "/api/v1/communication/drafts/{id}/request-send": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Request sending; creates an approval, never sends directly */
        post: operations["requestDraftSend"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/communication/himalaya/envelopes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read a bounded page of IMAP message headers */
        get: operations["listHimalayaEnvelopes"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/communication/himalaya/mailboxes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List folders in the explicitly configured Friday IMAP account */
        get: operations["listHimalayaMailboxes"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/communication/himalaya/message": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read one IMAP message without changing its seen flag */
        get: operations["getHimalayaMessage"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/communication/himalaya/send": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Send one owner-confirmed plain-text message through the managed Friday SMTP account */
        post: operations["sendHimalayaMessage"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/communication/himalaya/voice/confirm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Execute the exact approved voice mail action once */
        post: operations["confirmVoiceMail"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/communication/himalaya/voice/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Preview one local voice mail action with an expiring approval token */
        post: operations["previewVoiceMail"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/communication/threads": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Unified inbox */
        get: operations["listThreads"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/communication/threads/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a thread with messages */
        get: operations["getThread"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/content-studio/elevenlabs/speech": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Generate confirmed paid speech with ElevenLabs */
        post: operations["createElevenSpeech"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/content-studio/kie/tasks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Submit a confirmed paid image or video task through the server */
        post: operations["createKieTask"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/content-studio/kie/tasks/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read status of a task submitted by this Control API */
        get: operations["getKieTask"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/content-studio/plan": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read the authoritative Content Studio plan */
        get: operations["getContentStudioPlan"];
        /** Replace the plan if its revision still matches */
        put: operations["putContentStudioPlan"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/content-studio/production-jobs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Approve and start automatic production for one planned idea */
        post: operations["createContentProductionJob"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/content-studio/production-jobs/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read the state of an automatic production job */
        get: operations["getContentProductionJob"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/content-studio/production-jobs/{id}/artifact": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Download the locally rendered MP4 artifact */
        get: operations["getContentProductionArtifact"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/content-studio/production-jobs/{id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Stop further local work and paid requests for a production job */
        post: operations["cancelContentProductionJob"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/data-retention": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get scoped retention job status */
        get: operations["getDataRetentionStatus"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/data-retention/actions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Preview or run scoped data retention */
        post: operations["performDataRetentionAction"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/dev/scenarios": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List mock scenarios (development/QA only) */
        get: operations["listScenarios"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/dev/scenarios/{id}/play": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Play a scenario */
        post: operations["playScenario"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/dev/scenarios/control": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Clock, adapter outage, latency, error rate, capability and orb overrides */
        post: operations["controlScenario"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/dev/scenarios/state": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Current mock engine state */
        get: operations["getScenarioState"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/files": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List files */
        get: operations["listFiles"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/files/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get file metadata, versions and lineage */
        get: operations["getFile"];
        put?: never;
        post?: never;
        /** Delete a file; may respond 202 with an approval */
        delete: operations["deleteFile"];
        options?: never;
        head?: never;
        /** Rename a file (If-Match) */
        patch: operations["renameFile"];
        trace?: never;
    };
    "/api/v1/files/{id}/download": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Download file content */
        get: operations["downloadFile"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/files/{id}/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Sandboxed preview of a file */
        get: operations["getFilePreview"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Liveness and component health of the control API */
        get: operations["getHealth"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/calendar/accounts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Friday-managed calendar accounts and discovered permissions */
        get: operations["listCalendarAccounts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/calendar/accounts/actions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Configure, discover, read or conditionally mutate a connected calendar */
        post: operations["actOnCalendarAccount"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/mail/accounts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Friday-managed mail accounts without secrets */
        get: operations["listMailAccounts"];
        put?: never;
        /** Create one IMAP and SMTP mail account */
        post: operations["createMailAccount"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/mail/accounts/{accountId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Replace account configuration at expected revision */
        put: operations["updateMailAccount"];
        post?: never;
        /** Remove one Friday-managed account locally */
        delete: operations["deleteMailAccount"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/mail/accounts/{accountId}/attachment": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Download one bounded attachment from its source UID and UIDVALIDITY */
        get: operations["getMailAttachment"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/mail/accounts/{accountId}/change": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Flag or move one UID from its source account */
        post: operations["changeMailMessage"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/mail/accounts/{accountId}/check": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Check IMAP or SMTP authentication without sending mail */
        post: operations["checkMailAccount"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/mail/accounts/{accountId}/default": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Choose the default account with catalog revision */
        post: operations["setDefaultMailAccount"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/mail/accounts/{accountId}/draft": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Save an idempotent draft to the account Drafts folder without SMTP */
        post: operations["saveMailDraft"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/mail/accounts/{accountId}/envelopes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read one mailbox page bound to account and UIDVALIDITY */
        get: operations["listMailEnvelopes"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/mail/accounts/{accountId}/folders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Discover folders in one account */
        get: operations["listMailFolders"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/mail/accounts/{accountId}/message": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read a UID from its source account and UIDVALIDITY */
        get: operations["getMailMessage"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/mail/accounts/{accountId}/oauth/poll": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Poll a Microsoft device authorization once */
        post: operations["pollMailOAuth"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/mail/accounts/{accountId}/oauth/revoke": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Remove locally stored OAuth grant; provider consent may require separate revocation */
        post: operations["revokeMailOAuth"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/mail/accounts/{accountId}/oauth/start": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Start local Google PKCE or Microsoft device authorization */
        post: operations["startMailOAuth"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/mail/accounts/{accountId}/receipts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Review bounded mail send journal without message contents */
        get: operations["listMailReceipts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/mail/accounts/{accountId}/receipts/{receiptId}/archive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Append exact confirmed SMTP send to Sent only, with dedupe; never sends SMTP */
        post: operations["reconcileMailArchive"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/mail/accounts/{accountId}/receipts/{receiptId}/review": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Check Sent for an uncertain send without sending */
        post: operations["reviewMailReceipt"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/mail/accounts/{accountId}/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Search message text in one source mailbox */
        get: operations["searchMailEnvelopes"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/mail/accounts/{accountId}/send": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Send with durable journal and separate Sent copy state */
        post: operations["sendMailMessage"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/mail/oauth/google/callback": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Local loopback PKCE callback bound to a short-lived random state */
        get: operations["completeGoogleMailOAuth"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/memory/backup": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create an isolated memory backup */
        post: operations["backupDurableMemory"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/memory/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Capture an eligible redacted event */
        post: operations["captureDurableMemoryEvent"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/memory/events/{eventId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Tombstone one stored event */
        delete: operations["forgetDurableMemoryEvent"];
        options?: never;
        head?: never;
        /** Correct one memory event atomically */
        patch: operations["correctDurableMemoryEvent"];
        trace?: never;
    };
    "/api/v1/integrations/memory/reindex": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Rebuild native memory search index from owned Vault notes */
        post: operations["reindexDurableMemory"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/memory/restore": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Restore into a separate target vault */
        post: operations["restoreDurableMemory"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/memory/retry": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Retry pending memory writes */
        post: operations["retryDurableMemory"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/memory/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Search durable memory for one identity */
        get: operations["searchDurableMemory"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/memory/settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Set native memory capture policy */
        put: operations["putDurableMemorySettings"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/memory/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Durable memory writer and vault status */
        get: operations["getDurableMemoryStatus"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/messenger/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Admit a post-gateway private message through a distinct local bridge credential */
        post: operations["captureMessengerInbound"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/voice/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Persisted and verified voice integration state */
        get: operations["getVoiceIntegrationStatus"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/location/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Search city or postal code for a confirmed dashboard location
         * @description Owner only. Returns up to eight disambiguated GeoNames results through Open-Meteo. Does not save a location.
         */
        get: operations["searchLocations"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/memory": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List memories */
        get: operations["listMemory"];
        put?: never;
        /** Create a memory */
        post: operations["createMemory"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/memory/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a memory with history and provenance */
        get: operations["getMemory"];
        put?: never;
        post?: never;
        /** Forget a memory (audited) */
        delete: operations["deleteMemory"];
        options?: never;
        head?: never;
        /** Edit, lock or confirm a memory */
        patch: operations["updateMemory"];
        trace?: never;
    };
    "/api/v1/memory/{id}/conflicts/{conflictId}/resolve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Resolve a memory conflict (keep_both, replace or dismiss) */
        post: operations["resolveMemoryConflict"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/memory/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Export all memories as JSON (restricted memories are omitted, never secrets) */
        get: operations["exportMemory"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/memory/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Semantic search over memories */
        post: operations["searchMemory"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/messenger/catalog": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Inspect pinned Hermes native messaging prerequisites and observed gateway state */
        get: operations["getMessengerCatalog"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/messenger/confirm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Confirm and reserve an exact messenger delivery once */
        post: operations["confirmMessengerMessage"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/messenger/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Preview an exact admitted messenger target and message */
        post: operations["previewMessengerMessage"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/messenger/providers/{platform}": {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                platform: string;
            };
            cookie?: never;
        };
        /** Read pinned Hermes provider configuration revision */
        get: operations["getMessengerProvider"];
        /** Store allowlisted provider fields in pinned Hermes without claiming gateway activation */
        put: operations["updateMessengerProvider"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/messenger/providers/{platform}/apply": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Explicitly restart the local Hermes gateway after provider credential changes */
        post: operations["applyMessengerProvider"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/messenger/receipts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read durable messenger delivery states for the owner */
        get: operations["listMessengerReceipts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/messenger/senders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Inspect admitted private-message senders without message content */
        get: operations["listMessengerSenders"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/messenger/senders/{id}/link": {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Explicitly link one observed authenticated sender to the owner identity */
        post: operations["linkMessengerSender"];
        /** Revoke one sender-to-owner identity link */
        delete: operations["unlinkMessengerSender"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/messenger/targets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List owner-enrolled exact outbound targets */
        get: operations["listMessengerTargets"];
        put?: never;
        /** Enroll an exact outbound destination for the owner */
        post: operations["registerMessengerTarget"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/messenger/targets/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Remove one exact outbound destination */
        delete: operations["removeMessengerTarget"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/meta": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Bootstrap information (contract version, data mode, event stream location) */
        get: operations["getMeta"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/metrics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Prometheus metrics of the control API (text exposition format 0.0.4)
         * @description Request latency, error rate, WebSocket connections, events per second, adapter health, cache hits and the frontend telemetry gauges (orb FPS, frame time, WebGL memory, frontend errors). Contains no personal data.
         */
        get: operations["getMetrics"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/notifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List notifications */
        get: operations["listNotifications"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/notifications/{id}/acknowledge": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Acknowledge (stops escalation) */
        post: operations["acknowledgeNotification"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/notifications/{id}/resolve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Resolve a notification */
        post: operations["resolveNotification"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/notifications/{id}/snooze": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Snooze a notification */
        post: operations["snoozeNotification"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/onboarding": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read resumable owner onboarding state */
        get: operations["getOnboarding"];
        /** Replace onboarding decisions if revision matches */
        put: operations["putOnboarding"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/orb/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Current semantic orb state with parallel layers */
        get: operations["getOrbStatus"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/overview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Aggregated home payload */
        get: operations["getOverview"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/research/projects": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List research projects */
        get: operations["listResearchProjects"];
        put?: never;
        /** Search for a topic and store unverified source candidates */
        post: operations["createResearchProject"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/research/projects/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get one research project */
        get: operations["getResearchProject"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/research/projects/{id}/artifacts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Artifacts of a project */
        get: operations["listResearchArtifacts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/research/projects/{id}/findings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Findings with supporting sources and contradictions */
        get: operations["listResearchFindings"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/research/projects/{id}/sources": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Sources of a project */
        get: operations["listResearchSources"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/research/provider": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get local source discovery provider configuration */
        get: operations["getResearchProvider"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Configure Wikipedia or a local SearXNG endpoint, optionally provisioning the bundled local service */
        patch: operations["updateResearchProvider"];
        trace?: never;
    };
    "/api/v1/settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get all settings areas */
        get: operations["getSettings"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Replace the supplied settings areas */
        patch: operations["updateSettings"];
        trace?: never;
    };
    "/api/v1/settings/adapters": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Adapter configuration (secrets masked) */
        get: operations["listAdapterSettings"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/settings/adapters/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update adapter configuration; secrets are write-only */
        patch: operations["updateAdapterSettings"];
        trace?: never;
    };
    "/api/v1/settings/adapters/{id}/test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Test the connection of an adapter configuration */
        post: operations["testAdapterSettings"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/settings/cloudtalk": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read CloudTalk API setup state without secrets */
        get: operations["getCloudTalk"];
        /** Create or update CloudTalk setup; omit both API keys to retain encrypted credentials */
        put: operations["putCloudTalk"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/settings/content-studio-keys": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get configured Content Studio provider key flags; values are never returned */
        get: operations["getContentStudioKeys"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Set or clear one runtime-only Content Studio provider key */
        patch: operations["updateContentStudioKey"];
        trace?: never;
    };
    "/api/v1/settings/discord-gateway": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read local Hermes Discord gateway configuration without exposing the bot token */
        get: operations["getDiscordGateway"];
        /** Configure the local Hermes Discord gateway */
        put: operations["putDiscordGateway"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/settings/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Export settings, themes and layouts (never secrets) */
        get: operations["exportSettings"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/settings/hermes-config": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read effective allowlisted Hermes config and installed extension inventory */
        get: operations["getHermesConfig"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Write one allowlisted typed Hermes config leaf or stdin-only model credential */
        patch: operations["patchHermesConfig"];
        trace?: never;
    };
    "/api/v1/settings/hermes-config/mcp-oauth": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Start, poll or cancel one owner-bound Hermes MCP OAuth login */
        post: operations["manageHermesMcpOAuth"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/settings/hermes-config/mcp-probe": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Probe one configured HTTPS MCP server with a bounded public-IP protocol handshake */
        post: operations["probeHermesMcp"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/settings/hermes-cron/jobs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read bounded native Hermes cron job metadata for the active profile */
        get: operations["listHermesCronJobs"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/settings/hermes-model-catalog": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read pinned Hermes picker providers; optionally probe one model catalog */
        get: operations["getHermesModelCatalog"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/settings/hermes-skill-keys": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read configured flags for supported Hermes skill keys without values */
        get: operations["getHermesSkillKeys"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Set or remove one supported Hermes skill key in the installed WSL account */
        patch: operations["updateHermesSkillKey"];
        trace?: never;
    };
    "/api/v1/settings/hermes-skill-keys/{key}/check": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Check an installed Airtable or Notion token on explicit owner request */
        post: operations["checkHermesSkillKey"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/settings/himalaya-account": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read local Himalaya account readiness without exposing credentials */
        get: operations["getHimalayaAccount"];
        /** Save Friday-owned IMAP and SMTP account in Friday-Ubuntu */
        put: operations["putHimalayaAccount"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/settings/himalaya-account/check-smtp": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Check Friday-managed SMTP TLS and authentication without sending a message */
        post: operations["checkHimalayaSmtp"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/settings/import": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Import a settings export (schema-validated) */
        post: operations["importSettings"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/settings/layouts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Available overview layouts */
        get: operations["listLayouts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/settings/layouts/import": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Import a layout (schema-validated) */
        post: operations["importLayout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/settings/obsidian-vault": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read Hermes Obsidian vault path and WSL readiness */
        get: operations["getObsidianVault"];
        /** Configure an existing Obsidian vault for Hermes in WSL */
        put: operations["putObsidianVault"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/settings/schema": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** JSON Schema of the settings document */
        get: operations["getSettingsSchema"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/settings/telegram-gateway": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read local Hermes Telegram gateway configuration without exposing the bot token */
        get: operations["getTelegramGateway"];
        /** Configure the local Hermes Telegram gateway */
        put: operations["putTelegramGateway"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/settings/telephony": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read observed Asterisk and SIP registration status without secrets */
        get: operations["getTelephony"];
        /** Store private owner SIP and local Asterisk ARI configuration */
        put: operations["putTelephony"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/settings/themes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Available themes */
        get: operations["listThemes"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/settings/themes/import": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Import a theme (schema-validated) */
        post: operations["importTheme"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/settings/whatsapp-gateway": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read local Hermes WhatsApp gateway setup and linked-session presence */
        get: operations["getWhatsappGateway"];
        /** Configure the local Hermes WhatsApp gateway after pairing */
        put: operations["putWhatsappGateway"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/settings/whatsapp-pairing": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read short-lived local WhatsApp QR pairing status */
        get: operations["getWhatsappPairing"];
        put?: never;
        /** Start or replace the local Hermes Baileys pairing session */
        post: operations["startWhatsappPairing"];
        /** Cancel pending WhatsApp QR pairing without logging out an existing account */
        delete: operations["cancelWhatsappPairing"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/settings/whatsapp-session": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Revoke the linked Baileys WhatsApp session and disable its Hermes adapter */
        delete: operations["logoutWhatsappGateway"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/settings/whatsapp-session/reconnect": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Restart the linked Hermes gateway to reconnect its WhatsApp adapter */
        post: operations["reconnectWhatsappGateway"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/settings/wiki-path": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read local Hermes Markdown wiki path and WSL readability */
        get: operations["getWikiPath"];
        /** Set or clear local Hermes Markdown wiki path in Friday-Ubuntu */
        put: operations["putWikiPath"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/skills": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List packaged Friday skills and freshly observed Hermes skills */
        get: operations["listSkills"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/skills/{id}/activation": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Toggle a discovered skill through the Hermes dashboard and read back its state */
        put: operations["setSkillActivation"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/skills/powerpoint/decks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the owner's recent locally generated PowerPoint decks */
        get: operations["listPowerPointDecks"];
        put?: never;
        /** Create a presentation with the installed Hermes PowerPoint skill */
        post: operations["createPowerPointDeck"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/skills/powerpoint/decks/{id}/download": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Download a private PowerPoint presentation */
        get: operations["downloadPowerPointDeck"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/skills/powerpoint/voice": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create a confirmed speaker-verified PowerPoint through the local voice bridge */
        post: operations["createVoicePowerPointDeck"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Compact overall Friday status */
        get: operations["getStatus"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/system-backups": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get scheduled system backup status and source coverage */
        get: operations["getSystemBackupStatus"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/system-backups/actions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Preview, create, verify or test-restore a system backup */
        post: operations["performSystemBackupAction"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/system/metrics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Hardware metrics */
        get: operations["getSystemMetrics"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/system/models": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Model providers */
        get: operations["listModelProviders"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/system/services": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Monitored services */
        get: operations["listServices"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/system/services/{id}/healthcheck": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Trigger a healthcheck of a service */
        post: operations["runServiceHealthcheck"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/system/storage": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Storage volumes (D:\ and others) */
        get: operations["listStorageVolumes"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tasks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List tasks */
        get: operations["listTasks"];
        put?: never;
        /** Create a task */
        post: operations["createTask"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tasks/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a task with steps, tool calls and artifacts */
        get: operations["getTask"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update a task (also used for Kanban moves) */
        patch: operations["updateTask"];
        trace?: never;
    };
    "/api/v1/tasks/{id}/assign": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Assign a task to an agent or release it */
        post: operations["assignTask"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tasks/{id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Cancel a task */
        post: operations["cancelTask"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tasks/{id}/input": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Answer a task that waits for input (blocker input_needed) */
        post: operations["provideTaskInput"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tasks/{id}/pause": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Pause a task */
        post: operations["pauseTask"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tasks/{id}/resume": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Resume a task */
        post: operations["resumeTask"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tasks/{id}/retry": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Retry a task */
        post: operations["retryTask"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/telemetry/frontend": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Report frontend errors and orb performance samples (size- and rate-limited, no personal data)
         * @description Body limit 32 KiB, at most 20 errors and 60 orb samples per request, 30 requests per minute per session. Messages are redacted server-side; only aggregated metrics and a redacted log line are kept.
         */
        post: operations["submitFrontendTelemetry"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/telephony/calls": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** After explicit owner confirmation, request a call from owner extension to destination */
        post: operations["originateTelephonyCall"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/telephony/calls/{callId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Observe the owner channel without inferring remote connection */
        get: operations["getTelephonyCall"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/telephony/calls/{callId}/hangup": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Ask Asterisk to hang up the journalled owner channel */
        post: operations["hangupTelephonyCall"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/telephony/cloudtalk/calls": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** After owner confirmation, ask CloudTalk to ring the agent first and then the target */
        post: operations["originateCloudTalkCall"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/telephony/cloudtalk/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Preview an E.164 CloudTalk call without placing it */
        post: operations["previewCloudTalkCall"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/telephony/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create a short-lived owner-bound call preview without dialing */
        post: operations["previewTelephonyCall"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/voice/browser-audio-availability": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Browser audio bridge readiness */
        get: operations["getBrowserAudioAvailability"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/voice/devices": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Audio devices */
        get: operations["listVoiceDevices"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/voice/enrollments/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Status of one enrollment job */
        get: operations["getVoiceEnrollment"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/voice/history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete the voice history (needs confirm=true, audited) */
        delete: operations["deleteVoiceHistory"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/voice/linux-enrollment": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read private Linux owner enrollment progress */
        get: operations["getLinuxVoiceEnrollment"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/voice/linux-enrollment/samples": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Upload one bounded browser microphone PCM sample */
        post: operations["addLinuxVoiceSample"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/voice/linux-enrollment/train": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Train the private owner speaker and wake models */
        post: operations["startLinuxVoiceTraining"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/voice/metrics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Voice pipeline latencies */
        get: operations["getVoiceMetrics"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/voice/profiles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Enrolled voice profiles */
        get: operations["listVoiceProfiles"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/voice/profiles/{id}/enroll": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Start the enrollment of a voice profile; returns the job (202) */
        post: operations["enrollVoiceProfile"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/voice/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Voice pipeline status */
        get: operations["getVoiceStatus"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/voice/stop": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Stop listening / speaking immediately */
        post: operations["stopVoice"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/voice/test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Run a voice pipeline test */
        post: operations["runVoiceTest"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/voice/wake-enrollment": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read private pending wake phrase enrollment */
        get: operations["getWakeEnrollment"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/voice/wake-enrollment/discard": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Cancel and delete a pending wake enrollment */
        post: operations["discardWakeEnrollment"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/voice/wake-enrollment/samples": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Upload one bounded private wake training sample */
        post: operations["addWakeEnrollmentSample"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/voice/wake-enrollment/start": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Start one phrase-bound private wake enrollment */
        post: operations["startWakeEnrollment"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/voice/wake-enrollment/train": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Train staged wake model without activating it */
        post: operations["trainWakeEnrollment"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/weather/current": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Current weather for the locally saved dashboard location
         * @description Authenticated read. Null data means that no location was saved. The upstream is Open-Meteo; stale data is explicitly marked.
         */
        get: operations["getCurrentWeather"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /**
         * ActionResult
         * @description Result of an action that returns no resource (delete, stop, ...).
         */
        ActionResult: {
            accepted: boolean;
            auditEventId?: string;
            contractVersion: components["schemas"]["ContractVersion"];
            correlationId: string;
            message?: string;
            resourceId?: string;
            /** @enum {string} */
            status: "completed" | "queued" | "rejected";
        };
        /** ActivityCapability */
        ActivityCapability: {
            backfill: boolean;
            read: boolean;
            sources: string[];
            stream: boolean;
        };
        /**
         * ActivityEvent
         * @description Immutable event in the activity tree (PLAN §29). parentId links children to their parent.
         */
        ActivityEvent: {
            actor?: components["schemas"]["Actor"];
            adapterId?: string | null;
            agentId?: string | null;
            correlationId: string;
            /** Format: date-time */
            createdAt: string;
            /** @description Redacted structured context; raw payloads only in debug/admin views. */
            details?: {
                [key: string]: unknown;
            };
            durationMs: number | null;
            /** Format: date-time */
            endedAt?: string | null;
            error?: components["schemas"]["ErrorDetail"];
            id: string;
            kind: components["schemas"]["ActivityKind"];
            labels?: string[];
            model?: string | null;
            /** Format: date-time */
            occurredAt: string;
            parentId: string | null;
            result?: string | null;
            /** @description Global monotonic event sequence; backfill via GET /activity?sinceSequence=. */
            sequence: number;
            severity: components["schemas"]["Severity"];
            source: components["schemas"]["SourceDescriptor"];
            /** @enum {string} */
            status: "started" | "running" | "succeeded" | "failed" | "cancelled" | "info";
            summary?: string;
            taskId?: string | null;
            title: string;
            tool?: string | null;
            /** Format: date-time */
            updatedAt: string;
            /** @description Monotonic revision used for optimistic concurrency (If-Match). */
            version: number;
        };
        /**
         * ActivityEventListResponse
         * @description Cursor-paginated list envelope for ActivityEvent.
         */
        ActivityEventListResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            freshness: components["schemas"]["Freshness"];
            items: components["schemas"]["ActivityEvent"][];
            pageInfo: components["schemas"]["PageInfo"];
            sources: components["schemas"]["SourceDescriptor"][];
        };
        /**
         * ActivityEventResponse
         * @description Single-resource envelope for ActivityEvent.
         */
        ActivityEventResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["ActivityEvent"];
            freshness: components["schemas"]["Freshness"];
        };
        /**
         * ActivityKind
         * @enum {string}
         */
        ActivityKind: "user_request" | "task" | "agent" | "tool_call" | "source_read" | "result" | "artifact" | "adapter" | "system";
        /** Actor */
        Actor: {
            id: string;
            name?: string;
            /** @enum {string} */
            type: "user" | "agent" | "system" | "adapter";
        };
        /**
         * AdapterCategory
         * @enum {string}
         */
        AdapterCategory: "tasks" | "activity" | "memory" | "agents" | "approvals" | "communication" | "calendar" | "automations" | "research" | "files" | "voice" | "notifications" | "system" | "audit" | "commands";
        /** AdapterConfigPatch */
        AdapterConfigPatch: {
            config?: {
                [key: string]: unknown;
            };
            enabled?: boolean;
            provider?: string;
            /** @description Write-only secret values by field name. */
            secrets?: {
                [key: string]: string;
            };
        };
        /**
         * AdapterConfigSettings
         * @description Per-adapter configuration. The UI renders the form from configSchema; secrets are write-only.
         */
        AdapterConfigSettings: {
            adapterId: string;
            category: components["schemas"]["AdapterCategory"];
            config: {
                [key: string]: unknown;
            };
            configSchema: components["schemas"]["JsonSchemaObject"];
            enabled: boolean;
            /** Format: date-time */
            lastTestAt?: string | null;
            /** @enum {string} */
            lastTestResult?: "success" | "failure";
            provider: string;
            secretFields: {
                [key: string]: components["schemas"]["SecretStatus"];
            };
            /** @description Optimistic-concurrency token of this configuration; send it as If-Match on PATCH /settings/adapters/{id}. Increases with every change. */
            version?: number;
        };
        /**
         * AdapterConfigSettingsListResponse
         * @description Cursor-paginated list envelope for AdapterConfigSettings.
         */
        AdapterConfigSettingsListResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            freshness: components["schemas"]["Freshness"];
            items: components["schemas"]["AdapterConfigSettings"][];
            pageInfo: components["schemas"]["PageInfo"];
            sources: components["schemas"]["SourceDescriptor"][];
        };
        /**
         * AdapterConfigSettingsResponse
         * @description Single-resource envelope for AdapterConfigSettings.
         */
        AdapterConfigSettingsResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["AdapterConfigSettings"];
            freshness: components["schemas"]["Freshness"];
        };
        /**
         * AdapterHealth
         * @description Runtime health of an adapter (PLAN §10.7) including circuit breaker state.
         */
        AdapterHealth: {
            adapterId: string;
            /** Format: date-time */
            checkedAt: string;
            /** @enum {string} */
            circuit: "closed" | "open" | "half_open";
            consecutiveFailures: number;
            lastError: {
                code: string;
                message: string;
            } | null;
            /** Format: date-time */
            lastSuccessAt: string | null;
            latencyMs: number | null;
            lifecycle: components["schemas"]["AdapterLifecycle"];
            status: components["schemas"]["HealthStatus"];
        };
        /**
         * AdapterHealthResponse
         * @description Single-resource envelope for AdapterHealth.
         */
        AdapterHealthResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["AdapterHealth"];
            freshness: components["schemas"]["Freshness"];
        };
        /** AdapterInfo */
        AdapterInfo: {
            enabled: boolean;
            health: components["schemas"]["AdapterHealth"];
            manifest: components["schemas"]["AdapterManifest"];
            /** @enum {string} */
            mode: "mock" | "live";
            provider: string;
        };
        /**
         * AdapterInfoListResponse
         * @description Cursor-paginated list envelope for AdapterInfo.
         */
        AdapterInfoListResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            freshness: components["schemas"]["Freshness"];
            items: components["schemas"]["AdapterInfo"][];
            pageInfo: components["schemas"]["PageInfo"];
            sources: components["schemas"]["SourceDescriptor"][];
        };
        /**
         * AdapterLifecycle
         * @description Adapter lifecycle (PLAN 10.6). RECOVERING = health checks are succeeding again after OFFLINE but the adapter is not yet confirmed ONLINE (PLAN 45.9).
         * @enum {string}
         */
        AdapterLifecycle: "UNREGISTERED" | "INITIALIZING" | "ONLINE" | "DEGRADED" | "OFFLINE" | "RECOVERING" | "STOPPING" | "STOPPED";
        /**
         * AdapterLogEntry
         * @description One redacted log line of an adapter from the Control API's log buffer (PLAN §40.4 Open Logs). Secrets, tokens and personal data never appear.
         */
        AdapterLogEntry: {
            adapterId: string;
            /** @description Redacted scalar fields of the log call. */
            context: {
                [key: string]: string | number | boolean | null;
            };
            correlationId: string | null;
            /** @enum {string} */
            level: "debug" | "info" | "warn" | "error";
            message: string;
            /** Format: date-time */
            timestamp: string;
        };
        /**
         * AdapterLogListResponse
         * @description Recent log lines of one adapter, newest last. Not paginated: the buffer is bounded and limit caps the result.
         */
        AdapterLogListResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            freshness: components["schemas"]["Freshness"];
            items: components["schemas"]["AdapterLogEntry"][];
            sources: components["schemas"]["SourceDescriptor"][];
        };
        /**
         * AdapterManifest
         * @description Static description of an adapter package (PLAN §10.4).
         */
        AdapterManifest: {
            adapterVersion: string;
            apiVersion: string;
            capabilities: string[];
            category: components["schemas"]["AdapterCategory"];
            configSchemaRef: string;
            contractVersion: components["schemas"]["ContractVersion"];
            id: string;
            name: string;
            secretFields: string[];
        };
        /** AdapterTestResult */
        AdapterTestResult: {
            adapterId: string;
            correlationId: string;
            latencyMs: number | null;
            message: string;
            success: boolean;
            /** Format: date-time */
            testedAt: string;
        };
        /**
         * AdapterTestResultResponse
         * @description Single-resource envelope for AdapterTestResult.
         */
        AdapterTestResultResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["AdapterTestResult"];
            freshness: components["schemas"]["Freshness"];
        };
        /**
         * Agent
         * @description Worker agent (PLAN §31).
         */
        Agent: {
            /** @description Icon accent color for the agent card. */
            accent?: string;
            activeTools: string[];
            capabilities: string[];
            /** @description Redacted, read-only agent configuration for the Configuration tab. */
            configuration?: {
                [key: string]: unknown;
            };
            /** Format: date-time */
            createdAt: string;
            currentTaskId: string | null;
            description?: string;
            /** Format: date-time */
            heartbeatAt: string | null;
            id: string;
            labels?: string[];
            /** Format: date-time */
            lastActivityAt: string | null;
            lastError: components["schemas"]["ErrorDetail"] | null;
            model: string | null;
            name: string;
            performance: components["schemas"]["AgentPerformance"];
            reasoningLevel: components["schemas"]["ReasoningLevel"];
            role: string;
            runtimeMs: number | null;
            source: components["schemas"]["SourceDescriptor"];
            /** Format: date-time */
            startedAt: string | null;
            status: components["schemas"]["AgentStatus"];
            successRate: number | null;
            /** Format: date-time */
            updatedAt: string;
            /** @description Monotonic revision used for optimistic concurrency (If-Match). */
            version: number;
        };
        /** AgentHeartbeat */
        AgentHeartbeat: {
            agentId: string;
            currentTaskId: string | null;
            /** Format: date-time */
            heartbeatAt: string;
            status: components["schemas"]["AgentStatus"];
        };
        /**
         * AgentListResponse
         * @description Cursor-paginated list envelope for Agent.
         */
        AgentListResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            freshness: components["schemas"]["Freshness"];
            items: components["schemas"]["Agent"][];
            pageInfo: components["schemas"]["PageInfo"];
            sources: components["schemas"]["SourceDescriptor"][];
        };
        /** AgentPerformance */
        AgentPerformance: {
            avgTaskDurationMs: number | null;
            costEur?: number;
            tasksCompleted: number;
            tasksFailed: number;
            tokensUsed?: number;
        };
        /**
         * AgentResponse
         * @description Single-resource envelope for Agent.
         */
        AgentResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["Agent"];
            freshness: components["schemas"]["Freshness"];
        };
        /** AgentsCapability */
        AgentsCapability: {
            assignTask: boolean;
            pause: boolean;
            read: boolean;
            resume: boolean;
            sources: string[];
            stop: boolean;
        };
        /**
         * AgentStatus
         * @enum {string}
         */
        AgentStatus: "idle" | "starting" | "working" | "waiting" | "paused" | "error" | "offline";
        /**
         * Approval
         * @description Human approval gate (PLAN §32). Decisions are checked again server-side before execution.
         */
        Approval: {
            /** @description Short imperative description, e.g. "E-Mail an Frau Becker senden". */
            action: string;
            agentId: string | null;
            correlationId: string;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            decidedAt?: string | null;
            decidedBy?: components["schemas"]["Actor"] | null;
            decisionComment?: string | null;
            editable: boolean;
            executionResult?: string | null;
            /** Format: date-time */
            expiresAt: string | null;
            id: string;
            impacts: components["schemas"]["ApprovalImpact"][];
            labels?: string[];
            preview: components["schemas"]["ApprovalPreview"];
            rationale: string;
            requiredAuth: components["schemas"]["RequiredAuth"];
            riskTier: components["schemas"]["RiskTier"];
            source: components["schemas"]["SourceDescriptor"];
            sourceRef: components["schemas"]["EntityRef"] | null;
            status: components["schemas"]["ApprovalStatus"];
            taskId: string | null;
            type: components["schemas"]["ApprovalType"];
            /** Format: date-time */
            updatedAt: string;
            /** @description Monotonic revision used for optimistic concurrency (If-Match). */
            version: number;
        };
        /** ApprovalContextRequest */
        ApprovalContextRequest: {
            question: string;
        };
        /** ApprovalDecisionRequest */
        ApprovalDecisionRequest: {
            comment?: string;
            editedPreview?: components["schemas"]["ApprovalPreview"];
            /** @enum {string} */
            inputChannel?: "dashboard" | "voice" | "api";
            /** @description Short-lived token from POST /auth/reauth; required when requiredAuth is reauth. */
            reauthToken?: string;
        };
        /** ApprovalImpact */
        ApprovalImpact: {
            description: string;
            /** @enum {string} */
            kind: "data" | "money" | "communication" | "schedule" | "system" | "legal" | "other";
            severity?: components["schemas"]["Severity"];
        };
        /**
         * ApprovalListResponse
         * @description Cursor-paginated list envelope for Approval.
         */
        ApprovalListResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            freshness: components["schemas"]["Freshness"];
            items: components["schemas"]["Approval"][];
            pageInfo: components["schemas"]["PageInfo"];
            sources: components["schemas"]["SourceDescriptor"][];
        };
        /** ApprovalPreview */
        ApprovalPreview: {
            body: string;
            fields?: {
                label: string;
                value: string;
            }[];
            /** @enum {string} */
            kind: "email" | "message" | "calendar" | "file" | "order" | "payment" | "contract" | "command" | "text";
            title: string;
        };
        /**
         * ApprovalResponse
         * @description Single-resource envelope for Approval.
         */
        ApprovalResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["Approval"];
            freshness: components["schemas"]["Freshness"];
        };
        /** ApprovalsCapability */
        ApprovalsCapability: {
            decide: boolean;
            editBeforeApprove: boolean;
            read: boolean;
            requestContext: boolean;
            sources: string[];
        };
        /** ApprovalSettings */
        ApprovalSettings: {
            confirmTier2: boolean;
            defaultExpiryMinutes: number;
            /** @default true */
            draftOnlyByDefault: boolean;
            notifyOnRequest: boolean;
            /** @default true */
            reauthTier3: boolean;
        };
        /**
         * ApprovalStatus
         * @enum {string}
         */
        ApprovalStatus: "pending" | "approved" | "rejected" | "expired" | "cancelled" | "executed" | "failed";
        /**
         * ApprovalType
         * @enum {string}
         */
        ApprovalType: "send_email" | "change_event" | "send_message" | "delete_file" | "order" | "payment" | "contract" | "system_change";
        /** ArtifactRef */
        ArtifactRef: {
            fileId?: string;
            id: string;
            /** @enum {string} */
            kind: "file" | "report" | "presentation" | "dataset" | "link" | "other";
            name: string;
            sizeBytes?: number;
        };
        /** Attachment */
        Attachment: {
            fileId?: string;
            id: string;
            mimeType: string;
            name: string;
            sizeBytes: number;
        };
        /** Attendee */
        Attendee: {
            /** Format: email */
            email?: string;
            name: string;
            /** @enum {string} */
            response: "accepted" | "declined" | "tentative" | "needs_action";
        };
        /** AttentionItem */
        AttentionItem: {
            id: string;
            /** @enum {string} */
            kind: "alert" | "approval" | "mail" | "blocked_task" | "overdue_task" | "system";
            /** Format: date-time */
            occurredAt: string;
            ref: components["schemas"]["EntityRef"] | null;
            severity: components["schemas"]["Severity"];
            summary: string;
            targetRoute: string;
            title: string;
        };
        /** AuditCapability */
        AuditCapability: {
            export: boolean;
            hashChain: boolean;
            read: boolean;
            sources: string[];
        };
        /**
         * AuditEvent
         * @description Append-only audit record with hash chain (PLAN §41).
         */
        AuditEvent: {
            /** @description Dotted action name, e.g. approval.approved. */
            action: string;
            actor: components["schemas"]["Actor"];
            adapterId?: string | null;
            after: {
                [key: string]: unknown;
            } | null;
            agentId?: string | null;
            approvalId?: string | null;
            artifactIds: string[];
            before: {
                [key: string]: unknown;
            } | null;
            /** @enum {string} */
            category: "user_action" | "agent_action" | "tool_call" | "approval" | "system" | "security";
            childEventIds: string[];
            /** @description Redacted context. */
            context?: {
                [key: string]: unknown;
            };
            correlationId: string;
            /** Format: date-time */
            createdAt: string;
            durationMs: number | null;
            errorCode?: components["schemas"]["ErrorCode"] | null;
            hash: string;
            id: string;
            labels?: string[];
            model?: string | null;
            /** Format: date-time */
            occurredAt: string;
            prevHash: string | null;
            reasoningLevel?: components["schemas"]["ReasoningLevel"] | null;
            /** @enum {string} */
            result: "success" | "failure" | "denied" | "pending";
            sequence: number;
            severity: components["schemas"]["Severity"];
            source: components["schemas"]["SourceDescriptor"];
            taskId?: string | null;
            tool?: string | null;
            /** Format: date-time */
            updatedAt: string;
            /** @description Monotonic revision used for optimistic concurrency (If-Match). */
            version: number;
        };
        /**
         * AuditEventListResponse
         * @description Cursor-paginated list envelope for AuditEvent.
         */
        AuditEventListResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            freshness: components["schemas"]["Freshness"];
            items: components["schemas"]["AuditEvent"][];
            pageInfo: components["schemas"]["PageInfo"];
            sources: components["schemas"]["SourceDescriptor"][];
        };
        /**
         * AuditEventResponse
         * @description Single-resource envelope for AuditEvent.
         */
        AuditEventResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["AuditEvent"];
            freshness: components["schemas"]["Freshness"];
        };
        /**
         * Automation
         * @description Rule: trigger, conditions, actions, escalation (PLAN §35). version increments on every definition change.
         */
        Automation: {
            actions: components["schemas"]["AutomationAction"][];
            conditions: components["schemas"]["AutomationCondition"][];
            /** Format: date-time */
            createdAt: string;
            description?: string;
            enabled: boolean;
            escalation: components["schemas"]["EscalationStep"][];
            id: string;
            labels?: string[];
            lastError: {
                /** Format: date-time */
                at: string;
                message: string;
                runId: string;
            } | null;
            /** Format: date-time */
            lastRunAt: string | null;
            lastSuccess: {
                /** Format: date-time */
                at: string;
                runId: string;
            } | null;
            name: string;
            /** Format: date-time */
            nextRunAt: string | null;
            paused: boolean;
            runCount: number;
            source: components["schemas"]["SourceDescriptor"];
            trigger: components["schemas"]["AutomationTrigger"];
            /** Format: date-time */
            updatedAt: string;
            /** @description Monotonic revision used for optimistic concurrency (If-Match). */
            version: number;
        };
        /** AutomationAction */
        AutomationAction: {
            /** @enum {string} */
            channel?: "dashboard" | "telegram" | "whatsapp" | "sms" | "phone" | "email";
            description: string;
            id: string;
            params?: {
                [key: string]: unknown;
            };
            requiresApproval: boolean;
            /** @enum {string} */
            type: "notify" | "create_task" | "draft_message" | "call" | "run_agent" | "set_priority" | "webhook";
        };
        /** AutomationCondition */
        AutomationCondition: {
            description: string;
            field: string;
            id: string;
            /** @enum {string} */
            operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "in" | "matches";
            /** @description Comparison value (any JSON). */
            value: unknown;
        };
        /** AutomationCreateRequest */
        AutomationCreateRequest: {
            actions: components["schemas"]["AutomationAction"][];
            conditions: components["schemas"]["AutomationCondition"][];
            description?: string;
            enabled?: boolean;
            escalation?: components["schemas"]["EscalationStep"][];
            name: string;
            trigger: components["schemas"]["AutomationTrigger"];
        };
        /**
         * AutomationListResponse
         * @description Cursor-paginated list envelope for Automation.
         */
        AutomationListResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            freshness: components["schemas"]["Freshness"];
            items: components["schemas"]["Automation"][];
            pageInfo: components["schemas"]["PageInfo"];
            sources: components["schemas"]["SourceDescriptor"][];
        };
        /**
         * AutomationPauseAllRequest
         * @description Optional body of the bulk pause (PLAN §35.3 Pause All).
         */
        AutomationPauseAllRequest: {
            reason?: string;
        };
        /**
         * AutomationPauseAllResponse
         * @description Single-resource envelope for AutomationPauseAllResult.
         */
        AutomationPauseAllResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["AutomationPauseAllResult"];
            freshness: components["schemas"]["Freshness"];
        };
        /**
         * AutomationPauseAllResult
         * @description Per-automation outcome of the bulk pause. Automations that are already paused or disabled stay untouched.
         */
        AutomationPauseAllResult: {
            failedCount: number;
            pausedCount: number;
            results: {
                automationId: string;
                message?: string;
                name: string;
                /** @enum {string} */
                outcome: "paused" | "already_paused" | "skipped" | "failed";
                /** @description Version after the operation (null when the automation could not be read). */
                version: number | null;
            }[];
            unchangedCount: number;
        };
        /**
         * AutomationResponse
         * @description Single-resource envelope for Automation.
         */
        AutomationResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["Automation"];
            freshness: components["schemas"]["Freshness"];
        };
        /**
         * AutomationRun
         * @description Execution record; answers why it fired, which conditions held, what ran and the result (PLAN §35.4).
         */
        AutomationRun: {
            actionsExecuted: {
                actionId: string;
                /** Format: date-time */
                executedAt: string;
                resultSummary: string;
                /** @enum {string} */
                status: "succeeded" | "failed" | "skipped" | "simulated";
            }[];
            automationId: string;
            automationVersion: number;
            conditionsEvaluated: {
                conditionId: string;
                detail: string;
                met: boolean;
            }[];
            correlationId: string;
            /** Format: date-time */
            createdAt: string;
            dryRun: boolean;
            error?: components["schemas"]["ErrorDetail"];
            /** Format: date-time */
            finishedAt: string | null;
            id: string;
            labels?: string[];
            result: string;
            source: components["schemas"]["SourceDescriptor"];
            /** @enum {string} */
            status: "running" | "succeeded" | "failed" | "skipped" | "dry_run";
            /** Format: date-time */
            triggeredAt: string;
            triggerReason: string;
            /** Format: date-time */
            updatedAt: string;
            /** @description Monotonic revision used for optimistic concurrency (If-Match). */
            version: number;
        };
        /**
         * AutomationRunListResponse
         * @description Cursor-paginated list envelope for AutomationRun.
         */
        AutomationRunListResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            freshness: components["schemas"]["Freshness"];
            items: components["schemas"]["AutomationRun"][];
            pageInfo: components["schemas"]["PageInfo"];
            sources: components["schemas"]["SourceDescriptor"][];
        };
        /**
         * AutomationRunResponse
         * @description Single-resource envelope for AutomationRun.
         */
        AutomationRunResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["AutomationRun"];
            freshness: components["schemas"]["Freshness"];
        };
        /** AutomationsCapability */
        AutomationsCapability: {
            create: boolean;
            disable: boolean;
            enable: boolean;
            pauseAll: boolean;
            read: boolean;
            sources: string[];
            test: boolean;
            update: boolean;
            /** @description Read the version history of an automation. */
            versions?: boolean;
        };
        /** AutomationTestRequest */
        AutomationTestRequest: {
            /** @default true */
            dryRun: boolean;
            /** @description Mock input to evaluate the trigger against. */
            sampleData?: {
                [key: string]: unknown;
            };
        };
        /** AutomationTrigger */
        AutomationTrigger: {
            description: string;
            /** @description Event type, e.g. friday.communication.thread_updated. */
            event?: string;
            /** @description Cron expression. */
            schedule?: string;
            timeZone?: string;
            /** @enum {string} */
            type: "event" | "schedule" | "manual" | "condition";
        };
        /** AutomationUpdateRequest */
        AutomationUpdateRequest: {
            actions?: components["schemas"]["AutomationAction"][];
            conditions?: components["schemas"]["AutomationCondition"][];
            description?: string;
            enabled?: boolean;
            escalation?: components["schemas"]["EscalationStep"][];
            name?: string;
            paused?: boolean;
            trigger?: components["schemas"]["AutomationTrigger"];
        };
        /**
         * AutomationVersion
         * @description One entry of the version history of an automation (PLAN §35.3 Versionierung). Newest version first.
         */
        AutomationVersion: {
            automationId: string;
            changedBy: components["schemas"]["Actor"];
            /** Format: date-time */
            createdAt: string;
            /** @description True for the version that is live now. */
            current: boolean;
            /** @description Definition of the automation at this version. */
            snapshot: {
                actions: components["schemas"]["AutomationAction"][];
                conditions: components["schemas"]["AutomationCondition"][];
                description?: string;
                enabled: boolean;
                escalation: components["schemas"]["EscalationStep"][];
                name: string;
                paused: boolean;
                trigger: components["schemas"]["AutomationTrigger"];
            };
            source: components["schemas"]["SourceDescriptor"];
            /** @description What changed compared to the previous version. */
            summary: string;
            version: number;
        };
        /**
         * AutomationVersionListResponse
         * @description Cursor-paginated list envelope for AutomationVersion.
         */
        AutomationVersionListResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            freshness: components["schemas"]["Freshness"];
            items: components["schemas"]["AutomationVersion"][];
            pageInfo: components["schemas"]["PageInfo"];
            sources: components["schemas"]["SourceDescriptor"][];
        };
        /** BackupSettings */
        BackupSettings: {
            enabled: boolean;
            /** Format: date-time */
            lastBackupAt: string | null;
            /** @enum {string} */
            lastBackupStatus: "success" | "failed" | "never";
            retentionCount: number;
            /** @description Cron expression. */
            schedule: string;
            targetPath: string;
        };
        /**
         * BrowserAudioAvailability
         * @description Whether the local Linux browser voice bridge is ready for one owner session.
         */
        BrowserAudioAvailability: {
            available: boolean;
            contractVersion: components["schemas"]["ContractVersion"];
        };
        /** CalDavEventCreateRequest */
        CalDavEventCreateRequest: {
            confirmationToken: string;
            /** Format: date-time */
            end: string;
            /** Format: date-time */
            start: string;
            title: string;
        };
        /** CalDavEventCreateResponse */
        CalDavEventCreateResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: {
                replayed: boolean;
                /** @enum {string} */
                state: "created" | "unknown";
            };
            freshness: components["schemas"]["Freshness"];
        };
        /** CalDavEventPreviewRequest */
        CalDavEventPreviewRequest: {
            /** Format: date-time */
            end: string;
            /** Format: date-time */
            start: string;
            title: string;
        };
        /** CalDavEventPreviewResponse */
        CalDavEventPreviewResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: {
                confirmationToken: string;
                /** Format: date-time */
                end: string;
                /** Format: date-time */
                expiresAt: string;
                /** Format: date-time */
                start: string;
                title: string;
            };
            freshness: components["schemas"]["Freshness"];
        };
        /** CalendarAccountAction */
        CalendarAccountAction: {
            account?: {
                baseUrl: string;
                displayName: string;
                id?: string;
                /** @enum {unknown} */
                kind: "caldav" | "ics";
                syncMinutes: number;
                username: string;
            };
            accountId?: string;
            /** @enum {unknown} */
            action: "upsert" | "delete" | "discover" | "select" | "default" | "check" | "events" | "create" | "update" | "delete-event";
            calendarId?: string;
            defaultCalendarId?: string | null;
            etag?: string;
            event?: {
                allDay?: boolean;
                description?: string;
                end: string;
                location?: string;
                rrule?: string;
                start: string;
                title: string;
            };
            eventId?: string;
            expectedRevision?: number | null;
            /** Format: date-time */
            from?: string;
            password?: string;
            /** Format: date-time */
            recurrenceId?: string;
            /** @enum {unknown} */
            scope?: "single" | "series" | "occurrence";
            selectedIds?: string[];
            /** Format: date-time */
            to?: string;
        };
        /** CalendarAccountActionResponse */
        CalendarAccountActionResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: {
                [key: string]: unknown;
            };
            freshness: components["schemas"]["Freshness"];
        };
        /** CalendarBriefing */
        CalendarBriefing: {
            attendeeContext: {
                name: string;
                notes: string;
            }[];
            /** Format: date-time */
            createdAt: string;
            eventId: string;
            /** Format: date-time */
            generatedAt: string;
            id: string;
            labels?: string[];
            linkedThreadIds: string[];
            source: components["schemas"]["SourceDescriptor"];
            summary: string;
            talkingPoints: string[];
            /** Format: date-time */
            updatedAt: string;
            /** @description Monotonic revision used for optimistic concurrency (If-Match). */
            version: number;
        };
        /**
         * CalendarBriefingListResponse
         * @description Cursor-paginated list envelope for CalendarBriefing.
         */
        CalendarBriefingListResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            freshness: components["schemas"]["Freshness"];
            items: components["schemas"]["CalendarBriefing"][];
            pageInfo: components["schemas"]["PageInfo"];
            sources: components["schemas"]["SourceDescriptor"][];
        };
        /**
         * CalendarBriefingResponse
         * @description Single-resource envelope for CalendarBriefing.
         */
        CalendarBriefingResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["CalendarBriefing"];
            freshness: components["schemas"]["Freshness"];
        };
        /** CalendarCapability */
        CalendarCapability: {
            cancel: boolean;
            create: boolean;
            invite: boolean;
            propose: boolean;
            read: boolean;
            reschedule: boolean;
            respond: boolean;
            sources: string[];
        };
        /** CalendarConflict */
        CalendarConflict: {
            /** Format: date-time */
            createdAt: string;
            description: string;
            /** Format: date-time */
            detectedAt: string;
            eventIds: string[];
            id: string;
            /** @enum {string} */
            kind: "overlap" | "double_booking" | "travel_time" | "no_focus_time";
            labels?: string[];
            severity: components["schemas"]["Severity"];
            source: components["schemas"]["SourceDescriptor"];
            suggestedResolution?: string;
            /** Format: date-time */
            updatedAt: string;
            /** @description Monotonic revision used for optimistic concurrency (If-Match). */
            version: number;
        };
        /**
         * CalendarConflictListResponse
         * @description Cursor-paginated list envelope for CalendarConflict.
         */
        CalendarConflictListResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            freshness: components["schemas"]["Freshness"];
            items: components["schemas"]["CalendarConflict"][];
            pageInfo: components["schemas"]["PageInfo"];
            sources: components["schemas"]["SourceDescriptor"][];
        };
        /**
         * CalendarConflictResponse
         * @description Single-resource envelope for CalendarConflict.
         */
        CalendarConflictResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["CalendarConflict"];
            freshness: components["schemas"]["Freshness"];
        };
        /**
         * CalendarEvent
         * @description Calendar entry (PLAN §34). All times UTC; timeZone is the display zone of the event.
         */
        CalendarEvent: {
            allDay: boolean;
            attendees: components["schemas"]["Attendee"][];
            briefingId: string | null;
            conflictIds: string[];
            /** Format: date-time */
            createdAt: string;
            description?: string;
            /** Format: date-time */
            end: string;
            id: string;
            labels?: string[];
            linkedTaskIds: string[];
            linkedThreadIds: string[];
            location?: string;
            reminderMinutes: number[];
            source: components["schemas"]["SourceDescriptor"];
            /** Format: date-time */
            start: string;
            /** @enum {string} */
            status: "confirmed" | "tentative" | "cancelled";
            /** @description IANA zone, e.g. Europe/Berlin. */
            timeZone: string;
            title: string;
            /** Format: date-time */
            updatedAt: string;
            /** @description Monotonic revision used for optimistic concurrency (If-Match). */
            version: number;
        };
        /**
         * CalendarEventListResponse
         * @description Cursor-paginated list envelope for CalendarEvent.
         */
        CalendarEventListResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            freshness: components["schemas"]["Freshness"];
            items: components["schemas"]["CalendarEvent"][];
            pageInfo: components["schemas"]["PageInfo"];
            sources: components["schemas"]["SourceDescriptor"][];
        };
        /**
         * CalendarEventResponse
         * @description Single-resource envelope for CalendarEvent.
         */
        CalendarEventResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["CalendarEvent"];
            freshness: components["schemas"]["Freshness"];
        };
        /**
         * CalendarProposal
         * @description Write actions on the calendar are proposals that go through approval.
         */
        CalendarProposal: {
            approvalId: string | null;
            attendees: components["schemas"]["Attendee"][];
            /** Format: date-time */
            createdAt: string;
            eventId: string | null;
            id: string;
            labels?: string[];
            /** Format: date-time */
            proposedEnd: string | null;
            /** Format: date-time */
            proposedStart: string | null;
            reason: string;
            source: components["schemas"]["SourceDescriptor"];
            /** @enum {string} */
            status: "pending_approval" | "approved" | "rejected" | "applied" | "failed";
            title: string | null;
            type: components["schemas"]["CalendarProposalType"];
            /** Format: date-time */
            updatedAt: string;
            /** @description Monotonic revision used for optimistic concurrency (If-Match). */
            version: number;
        };
        /** CalendarProposalRequest */
        CalendarProposalRequest: {
            attendees?: components["schemas"]["Attendee"][];
            /** Format: date-time */
            end?: string;
            eventId?: string | null;
            reason: string;
            /** Format: date-time */
            start?: string;
            title?: string;
            type: components["schemas"]["CalendarProposalType"];
        };
        /**
         * CalendarProposalResponse
         * @description Single-resource envelope for CalendarProposal.
         */
        CalendarProposalResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["CalendarProposal"];
            freshness: components["schemas"]["Freshness"];
        };
        /**
         * CalendarProposalType
         * @enum {string}
         */
        CalendarProposalType: "create" | "reschedule" | "cancel" | "invite" | "respond";
        /**
         * CanonicalResource
         * @description Base fields every canonical resource carries (inlined into each resource schema).
         */
        CanonicalResource: {
            /** Format: date-time */
            createdAt: string;
            id: string;
            labels?: string[];
            source: components["schemas"]["SourceDescriptor"];
            /** Format: date-time */
            updatedAt: string;
            version: number;
        };
        /**
         * Capabilities
         * @description Per-module capability flags (PLAN §9). The UI derives enabled/disabled actions from this document.
         */
        Capabilities: {
            contractVersion: components["schemas"]["ContractVersion"];
            integrations?: components["schemas"]["CapabilityDescriptor"][];
            modules: {
                activity: components["schemas"]["ActivityCapability"];
                agents: components["schemas"]["AgentsCapability"];
                approvals: components["schemas"]["ApprovalsCapability"];
                audit: components["schemas"]["AuditCapability"];
                automations: components["schemas"]["AutomationsCapability"];
                calendar: components["schemas"]["CalendarCapability"];
                commands: components["schemas"]["CommandsCapability"];
                communication: components["schemas"]["CommunicationCapability"];
                files: components["schemas"]["FilesCapability"];
                mail: components["schemas"]["MailCapability"];
                memory: components["schemas"]["MemoryCapability"];
                notifications: components["schemas"]["NotificationsCapability"];
                research: components["schemas"]["ResearchCapability"];
                system: components["schemas"]["SystemCapability"];
                tasks: components["schemas"]["TasksCapability"];
                telephony: components["schemas"]["TelephonyCapability"];
                voice: components["schemas"]["VoiceCapability"];
            };
            $defs: {
                /** TasksCapability */
                TasksCapability: {
                    cancel: boolean;
                    create: boolean;
                    /** @description Answer tasks that wait for input (POST /tasks/{id}/input). */
                    input?: boolean;
                    pause: boolean;
                    read: boolean;
                    resume: boolean;
                    retry: boolean;
                    sources: string[];
                    stream: boolean;
                    update: boolean;
                };
                /** ActivityCapability */
                ActivityCapability: {
                    backfill: boolean;
                    read: boolean;
                    sources: string[];
                    stream: boolean;
                };
                /** MemoryCapability */
                MemoryCapability: {
                    delete: boolean;
                    /** @description Export the memory store as JSON. */
                    export?: boolean;
                    lock: boolean;
                    read: boolean;
                    /** @description Resolve memory conflicts. */
                    resolveConflict?: boolean;
                    search: boolean;
                    sources: string[];
                    write: boolean;
                };
                /** AgentsCapability */
                AgentsCapability: {
                    assignTask: boolean;
                    pause: boolean;
                    read: boolean;
                    resume: boolean;
                    sources: string[];
                    stop: boolean;
                };
                /** ApprovalsCapability */
                ApprovalsCapability: {
                    decide: boolean;
                    editBeforeApprove: boolean;
                    read: boolean;
                    requestContext: boolean;
                    sources: string[];
                };
                /** MailCapability */
                MailCapability: {
                    draft: boolean;
                    read: boolean;
                    send: boolean;
                    sources: string[];
                };
                /** CommunicationCapability */
                CommunicationCapability: {
                    draft: boolean;
                    multiChannel: boolean;
                    read: boolean;
                    send: boolean;
                    sources: string[];
                };
                /** CalendarCapability */
                CalendarCapability: {
                    cancel: boolean;
                    create: boolean;
                    invite: boolean;
                    propose: boolean;
                    read: boolean;
                    reschedule: boolean;
                    respond: boolean;
                    sources: string[];
                };
                /** AutomationsCapability */
                AutomationsCapability: {
                    create: boolean;
                    disable: boolean;
                    enable: boolean;
                    pauseAll: boolean;
                    read: boolean;
                    sources: string[];
                    test: boolean;
                    update: boolean;
                    /** @description Read the version history of an automation. */
                    versions?: boolean;
                };
                /** ResearchCapability */
                ResearchCapability: {
                    create: boolean;
                    export: boolean;
                    read: boolean;
                    sources: string[];
                };
                /** FilesCapability */
                FilesCapability: {
                    delete: boolean;
                    download: boolean;
                    preview: boolean;
                    read: boolean;
                    /** @description Rename files (PATCH /files/{id}). */
                    rename?: boolean;
                    sources: string[];
                    upload: boolean;
                };
                /** VoiceCapability */
                VoiceCapability: {
                    /** @description Delete the voice history (DELETE /voice/history). */
                    deleteHistory?: boolean;
                    enroll: boolean;
                    read: boolean;
                    sources: string[];
                    stop: boolean;
                    test: boolean;
                };
                /** NotificationsCapability */
                NotificationsCapability: {
                    acknowledge: boolean;
                    read: boolean;
                    resolve: boolean;
                    snooze: boolean;
                    sources: string[];
                };
                /** SystemCapability */
                SystemCapability: {
                    healthcheck: boolean;
                    openLogs: boolean;
                    read: boolean;
                    restartAdapter: boolean;
                    sources: string[];
                };
                /** AuditCapability */
                AuditCapability: {
                    export: boolean;
                    hashChain: boolean;
                    read: boolean;
                    sources: string[];
                };
                /** CommandsCapability */
                CommandsCapability: {
                    execute: boolean;
                    history: boolean;
                    pause: boolean;
                    resume: boolean;
                    sources: string[];
                    stop: boolean;
                };
                /** TelephonyCapability */
                TelephonyCapability: {
                    call: boolean;
                    read: boolean;
                    sources: string[];
                };
            };
        };
        /** CapabilityCatalogResponse */
        CapabilityCatalogResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: {
                items: components["schemas"]["CapabilityDescriptor"][];
            };
            freshness: components["schemas"]["Freshness"];
        };
        /** CapabilityDescriptor */
        CapabilityDescriptor: {
            actions: string[];
            /** @enum {unknown} */
            availability: "available" | "needs_setup" | "unsupported" | "offline";
            contractVersion: components["schemas"]["ContractVersion"];
            id: string;
            reasonCode: string | null;
            requires: string[];
            roles: ("viewer" | "operator" | "owner")[];
            settingsArea: string;
        };
        /**
         * Channel
         * @description Communication channel (PLAN §33.1). Address is an account hint, never a credential.
         */
        Channel: {
            address?: string;
            capabilities: {
                draft: boolean;
                read: boolean;
                send: boolean;
            };
            /** Format: date-time */
            createdAt: string;
            id: string;
            kind: components["schemas"]["ChannelKind"];
            labels?: string[];
            /** Format: date-time */
            lastSyncAt: string | null;
            name: string;
            source: components["schemas"]["SourceDescriptor"];
            status: components["schemas"]["ChannelStatus"];
            unreadCount: number;
            /** Format: date-time */
            updatedAt: string;
            /** @description Monotonic revision used for optimistic concurrency (If-Match). */
            version: number;
        };
        /**
         * ChannelKind
         * @enum {string}
         */
        ChannelKind: "email" | "telegram" | "whatsapp" | "sms" | "phone" | "other";
        /**
         * ChannelListResponse
         * @description Cursor-paginated list envelope for Channel.
         */
        ChannelListResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            freshness: components["schemas"]["Freshness"];
            items: components["schemas"]["Channel"][];
            pageInfo: components["schemas"]["PageInfo"];
            sources: components["schemas"]["SourceDescriptor"][];
        };
        /**
         * ChannelResponse
         * @description Single-resource envelope for Channel.
         */
        ChannelResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["Channel"];
            freshness: components["schemas"]["Freshness"];
        };
        /**
         * ChannelStatus
         * @enum {string}
         */
        ChannelStatus: "online" | "degraded" | "offline" | "read_only" | "not_configured";
        /** CloudTalkCallRequest */
        CloudTalkCallRequest: {
            destination: string;
            previewToken: string;
        };
        /** CloudTalkCallResponse */
        CloudTalkCallResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: {
                /** Format: date-time */
                createdAt: string;
                destination: string;
                id: string;
                note: string;
                providerStatus: number | null;
                replayed?: boolean;
                /** @enum {string} */
                state: "pending" | "requested" | "rejected" | "unknown";
                /** Format: date-time */
                updatedAt: string;
            };
            freshness: components["schemas"]["Freshness"];
        };
        /** CloudTalkPreviewRequest */
        CloudTalkPreviewRequest: {
            destination: string;
        };
        /** CloudTalkPreviewResponse */
        CloudTalkPreviewResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: {
                agentId: number;
                destination: string;
                /** Format: date-time */
                expiresAt: string;
                note: string;
                token: string;
            };
            freshness: components["schemas"]["Freshness"];
        };
        /** CloudTalkProfilePatch */
        CloudTalkProfilePatch: {
            accessKeyId?: string;
            accessKeySecret?: string;
            agentId?: number;
            ownerPhone?: string;
            ownerPhoneConfirmed?: boolean;
            reminderMinutes?: number;
            remindersEnabled?: boolean;
            voiceAgentId?: string;
        };
        /** CloudTalkStatusResponse */
        CloudTalkStatusResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: {
                agentId: number | null;
                configured: boolean;
                lastReminderAt: string | null;
                /** @enum {string|null} */
                lastReminderState: "pending" | "requested" | "rejected" | "unknown" | null;
                note: string;
                ownerPhone: string | null;
                ownerPhoneConfirmed: boolean;
                reminderMinutes: number;
                remindersEnabled: boolean;
                revision: number;
                voiceAgentId: string | null;
            };
            freshness: components["schemas"]["Freshness"];
        };
        /** CodingCliStatus */
        CodingCliStatus: {
            /** @enum {string} */
            authState: "signed_in" | "signed_out" | "stored_credentials" | "unknown";
            /** @enum {string} */
            cli: "codex" | "opencode" | "claude-code";
            installed: boolean;
            version: string | null;
        };
        /** CodingCliStatusResponse */
        CodingCliStatusResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["CodingCliStatus"][];
            freshness: components["schemas"]["Freshness"];
        };
        /** CodingRun */
        CodingRun: {
            error: string | null;
            executionVerified: boolean;
            output: string | null;
            preflightVersion: string | null;
            /** @enum {string|null} */
            requestedCli: "codex" | "opencode" | "claude-code" | null;
            requestedWorkdir: string | null;
            runId: string;
            status: string;
            updatedAt: number | null;
        };
        /** CodingRunRequest */
        CodingRunRequest: {
            /** @enum {string} */
            cli: "auto" | "codex" | "opencode" | "claude-code";
            repository: string;
            task: string;
        };
        /** CodingRunResponse */
        CodingRunResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["CodingRun"];
            freshness: components["schemas"]["Freshness"];
        };
        /** CodingVoiceRepository */
        CodingVoiceRepository: {
            alias: string;
            repository: string;
            revision: number;
        };
        /** CodingVoiceRepositoryPatch */
        CodingVoiceRepositoryPatch: {
            alias: string;
            repository: string;
        };
        /** CodingVoiceRepositoryResponse */
        CodingVoiceRepositoryResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["CodingVoiceRepository"];
            freshness: components["schemas"]["Freshness"];
        };
        /**
         * CommandControlRequest
         * @description Body of stop/pause/resume.
         */
        CommandControlRequest: {
            reason?: string;
            /** @enum {string} */
            scope: "all" | "task" | "agent" | "voice" | "automations";
            targetId?: string;
        };
        /**
         * CommandHistoryEntry
         * @description Sensitive commands are stored redacted.
         */
        CommandHistoryEntry: {
            correlationId: string;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            executedAt: string;
            id: string;
            labels?: string[];
            /** @enum {string} */
            origin: "text" | "voice" | "palette" | "quick_command";
            redacted: boolean;
            repeatable: boolean;
            riskTier: components["schemas"]["RiskTier"] | null;
            source: components["schemas"]["SourceDescriptor"];
            /** @enum {string} */
            status: "executed" | "accepted" | "requires_confirmation" | "requires_approval" | "rejected" | "failed";
            text: string;
            /** Format: date-time */
            updatedAt: string;
            /** @description Monotonic revision used for optimistic concurrency (If-Match). */
            version: number;
        };
        /**
         * CommandHistoryEntryListResponse
         * @description Cursor-paginated list envelope for CommandHistoryEntry.
         */
        CommandHistoryEntryListResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            freshness: components["schemas"]["Freshness"];
            items: components["schemas"]["CommandHistoryEntry"][];
            pageInfo: components["schemas"]["PageInfo"];
            sources: components["schemas"]["SourceDescriptor"][];
        };
        /** CommandRequest */
        CommandRequest: {
            /** @description Set after the user saw previewText of a previous requires_confirmation response. */
            confirm?: boolean;
            context?: {
                route: string;
                selectedIds?: string[];
            };
            /** @description Echo of CommandResponse.previewId to bind confirmation to the preview. */
            previewId?: string;
            /** @enum {string} */
            source: "text" | "voice" | "palette" | "quick_command";
            text: string;
        };
        /**
         * CommandResponse
         * @description Write/critical actions first return a preview (PLAN §43.4); only a confirmed repeat executes.
         */
        CommandResponse: {
            approvalId: string | null;
            commandId: string;
            contractVersion: components["schemas"]["ContractVersion"];
            correlationId: string;
            previewId?: string;
            /** @description e.g. "Du bist dabei, eine E-Mail an Frau Becker zu senden." */
            previewText: string | null;
            requiresConfirmation: boolean;
            result: {
                message: string;
                targetRoute?: string;
                taskId?: string;
            } | null;
            riskTier: components["schemas"]["RiskTier"] | null;
            /** @enum {string} */
            status: "executed" | "accepted" | "requires_confirmation" | "requires_approval" | "rejected" | "failed";
        };
        /** CommandsCapability */
        CommandsCapability: {
            execute: boolean;
            history: boolean;
            pause: boolean;
            resume: boolean;
            sources: string[];
            stop: boolean;
        };
        /** CommunicationCapability */
        CommunicationCapability: {
            draft: boolean;
            multiChannel: boolean;
            read: boolean;
            send: boolean;
            sources: string[];
        };
        /** ContentPlanDocument */
        ContentPlanDocument: {
            content: {
                beschreibung: string;
                /** @enum {string} */
                format: "Reel" | "Feed-Post" | "Story" | "Karussell" | "LinkedIn-Video" | "LinkedIn-Karussell" | "TikTok-Video" | "YouTube-Video" | "YouTube-Short";
                id: string;
                /** @enum {string} */
                plattform: "LinkedIn" | "Instagram" | "Facebook" | "TikTok" | "YouTube" | "Beide";
                /** @enum {string} */
                status: "idee" | "in-arbeit" | "fertig";
                titel: string;
                zieldatum: string;
                ziele?: ("LinkedIn" | "Instagram" | "Facebook" | "TikTok" | "YouTube")[];
            }[];
            /** Format: date-time */
            exportiert_am?: string;
            postings: {
                datum: string;
                /** @enum {string} */
                format: "Reel" | "Feed-Post" | "Story" | "Karussell" | "LinkedIn-Video" | "LinkedIn-Karussell" | "TikTok-Video" | "YouTube-Video" | "YouTube-Short";
                id: string;
                /** @enum {string} */
                plattform: "LinkedIn" | "Instagram" | "Facebook" | "TikTok" | "YouTube";
                /** @enum {string} */
                status: "geplant" | "gepostet" | "verpasst";
                titel: string;
                uhrzeit: string;
                ziele?: ("LinkedIn" | "Instagram" | "Facebook" | "TikTok" | "YouTube")[];
            }[];
            /** @constant */
            version: 1;
        };
        /** ContentPlanState */
        ContentPlanState: {
            plan: components["schemas"]["ContentPlanDocument"] | null;
            revision: number;
            updatedAt: string | null;
        };
        /** ContentPlanStateResponse */
        ContentPlanStateResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["ContentPlanState"];
            freshness: components["schemas"]["Freshness"];
        };
        /** ContentProductionJob */
        ContentProductionJob: {
            artifactReady: boolean;
            /** Format: date-time */
            createdAt: string;
            errorCode: string | null;
            /** Format: uuid */
            id: string;
            ideaId: string;
            /** @enum {string} */
            kind: "image" | "video";
            providerTaskId: string | null;
            /** @enum {string} */
            state: "queued" | "submitting" | "provider_pending" | "downloading" | "speech_submitting" | "editing" | "completed" | "provider_unknown" | "speech_unknown" | "failed" | "cancelled";
            /** Format: date-time */
            updatedAt: string;
        };
        /** ContentProductionJobResponse */
        ContentProductionJobResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["ContentProductionJob"];
            freshness: components["schemas"]["Freshness"];
        };
        /** ContentProductionRequest */
        ContentProductionRequest: {
            /** @constant */
            confirmed: true;
            ideaId: string;
            planRevision: number;
            voiceId?: string;
        };
        /** ContentStudioKeyPatch */
        ContentStudioKeyPatch: {
            key: string;
            /** @enum {string} */
            provider: "kie" | "elevenlabs" | "capcut";
        };
        /** ContentStudioKeys */
        ContentStudioKeys: {
            capcut: boolean;
            elevenlabs: boolean;
            kie: boolean;
        };
        /** ContentStudioKeysResponse */
        ContentStudioKeysResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["ContentStudioKeys"];
            freshness: components["schemas"]["Freshness"];
        };
        /**
         * ContractVersion
         * @description Semantic version of the wire contract, e.g. 1.0.0.
         */
        ContractVersion: string;
        /**
         * ControlFrame
         * @description Heartbeat frames (conventions §4). Not an envelope, no sequence.
         */
        ControlFrame: {
            /** @enum {string} */
            kind: "ping" | "pong";
            /** @description Sender clock, epoch milliseconds. */
            ts: number;
        };
        counts: {
            negatives: number;
            short: number;
            speech: number;
            wake: number;
        };
        /** CurrentWeatherResponse */
        CurrentWeatherResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: null | {
                /** Format: date-time */
                fetchedAt: string;
                location: {
                    countryCode?: string;
                    label: string;
                    latitude: number;
                    longitude: number;
                };
                /** Format: date-time */
                observedAt: string;
                /** @constant */
                provider: "Open-Meteo";
                stale: boolean;
                temperatureC: number;
                weatherCode: number;
            };
            freshness: components["schemas"]["Freshness"];
        };
        /** DashboardSettings */
        DashboardSettings: {
            activeLayoutId: string;
            autoRefreshSeconds: number;
            backgroundGrid: boolean;
            compact: boolean;
            /** @description Enables the optional Content Studio module. Missing on older settings means disabled. */
            contentStudioEnabled?: boolean;
            fontScale: number;
            /** @description Confirmed coarse dashboard location; absent or null means no location was chosen. */
            location?: null | {
                countryCode?: string;
                label: string;
                latitude: number;
                longitude: number;
            };
            soundEffects: boolean;
        };
        /** DataRetentionActionRequest */
        DataRetentionActionRequest: {
            /** @enum {string} */
            action: "preview" | "run" | "activate" | "deactivate";
        };
        /** DataRetentionActionResponse */
        DataRetentionActionResponse: {
            contractVersion: string;
            data: {
                /** @enum {string} */
                action: "preview" | "run";
                archivedAuditRows: number;
                /** Format: date-time */
                at?: string;
                /** @constant */
                auditPolicy: "archive-local-indefinitely";
                cutoffs: {
                    /** Format: date-time */
                    activity: string;
                    /** Format: date-time */
                    auditToArchive: string;
                    /** Format: date-time */
                    notifications: string;
                    /** Format: date-time */
                    temporaryFiles: string;
                    /** Format: date-time */
                    voiceHistory: string;
                };
                eligible: {
                    activity: number;
                    auditToArchive: number;
                    notifications: number;
                    temporaryFiles: number;
                    voiceHistory: number;
                };
                /** @constant */
                memoryPolicy: "unlimited";
                removed?: {
                    activity: number;
                    auditToArchive: number;
                    notifications: number;
                    temporaryFiles: number;
                    voiceHistory: number;
                };
            } | {
                /** @enum {string} */
                action: "activate" | "deactivate";
                automaticEnabled: boolean;
            };
            freshness: components["schemas"]["Freshness"];
        };
        /** DataRetentionSettings */
        DataRetentionSettings: {
            activityDays: number;
            auditDays: number;
            memoryDefaultTtlDays: number | null;
            notificationDays: number;
            temporaryFileDays: number;
            voiceHistoryDays: number;
        };
        /** DataRetentionStatusResponse */
        DataRetentionStatusResponse: {
            contractVersion: string;
            data: {
                automaticEnabled: boolean;
                last: null | {
                    /** Format: date-time */
                    at: string;
                    confirmedPartial: {
                        activity?: number;
                        auditToArchive?: number;
                        notifications?: number;
                        temporaryFiles?: number;
                        voiceHistory?: number;
                    };
                    counts: null | {
                        activity: number;
                        auditToArchive: number;
                        notifications: number;
                        temporaryFiles: number;
                        voiceHistory: number;
                    };
                    error: string | null;
                    /** @enum {string} */
                    status: "success" | "failed";
                };
                running: boolean;
            };
            freshness: components["schemas"]["Freshness"];
        };
        /** DeveloperSettings */
        DeveloperSettings: {
            debugMode: boolean;
            /** @enum {string} */
            logLevel: "error" | "warn" | "info" | "debug";
            orbPerfOverlay: boolean;
            scenarioConsole: boolean;
            showRawJson: boolean;
        };
        /** DiscordGateway */
        DiscordGateway: {
            allowedChannelIds: string[];
            allowedUserIds: string[];
            applied: boolean | null;
            /** @enum {string} */
            connectionState: "connected" | "disconnected" | "unknown";
            enabled: boolean | null;
            gatewayRunning: boolean | null;
            revision: number;
            setupUrl: string;
            tokenConfigured: boolean;
        };
        /** DiscordGatewayPatch */
        DiscordGatewayPatch: {
            allowedChannelIds: string[];
            allowedUserIds: string[];
            clearToken: boolean;
            enabled: boolean;
            token: string;
        };
        /** DiscordGatewayResponse */
        DiscordGatewayResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["DiscordGateway"];
            freshness: components["schemas"]["Freshness"];
        };
        /**
         * Draft
         * @description Drafts are created automatically; sending always requires approval (PLAN §33.5).
         */
        Draft: {
            approvalId: string | null;
            body: string;
            cc?: components["schemas"]["Participant"][];
            channelId: string;
            /** Format: date-time */
            createdAt: string;
            generatedByAgentId: string | null;
            id: string;
            labels?: string[];
            replyToMessageId?: string | null;
            source: components["schemas"]["SourceDescriptor"];
            status: components["schemas"]["DraftStatus"];
            subject: string;
            threadId: string | null;
            to: components["schemas"]["Participant"][];
            /** Format: date-time */
            updatedAt: string;
            /** @description Monotonic revision used for optimistic concurrency (If-Match). */
            version: number;
        };
        /** DraftCreateRequest */
        DraftCreateRequest: {
            body: string;
            cc?: components["schemas"]["Participant"][];
            channelId: string;
            replyToMessageId?: string | null;
            subject: string;
            threadId?: string | null;
            to: components["schemas"]["Participant"][];
        };
        /**
         * DraftListResponse
         * @description Cursor-paginated list envelope for Draft.
         */
        DraftListResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            freshness: components["schemas"]["Freshness"];
            items: components["schemas"]["Draft"][];
            pageInfo: components["schemas"]["PageInfo"];
            sources: components["schemas"]["SourceDescriptor"][];
        };
        /**
         * DraftResponse
         * @description Single-resource envelope for Draft.
         */
        DraftResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["Draft"];
            freshness: components["schemas"]["Freshness"];
        };
        /** DraftSendRequest */
        DraftSendRequest: {
            comment?: string;
        };
        /**
         * DraftStatus
         * @enum {string}
         */
        DraftStatus: "draft" | "pending_approval" | "approved" | "sent" | "failed" | "discarded";
        /** DraftUpdateRequest */
        DraftUpdateRequest: {
            body?: string;
            cc?: components["schemas"]["Participant"][];
            /** @enum {string} */
            status?: "draft" | "discarded";
            subject?: string;
            to?: components["schemas"]["Participant"][];
        };
        /** DurableMemoryBackupResponse */
        DurableMemoryBackupResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: {
                /** Format: date-time */
                createdAt: string;
                eventCount: number;
                path: string;
            };
            freshness: components["schemas"]["Freshness"];
        };
        /** DurableMemoryCaptureResponse */
        DurableMemoryCaptureResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: {
                accepted: boolean;
                eventId: string;
                pending: boolean;
            };
            freshness: components["schemas"]["Freshness"];
        };
        /** DurableMemoryCorrectRequest */
        DurableMemoryCorrectRequest: {
            text: string;
        };
        /** DurableMemoryCorrectResponse */
        DurableMemoryCorrectResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: {
                corrected: boolean;
                eventId: string;
                replacementEventId: string;
            };
            freshness: components["schemas"]["Freshness"];
        };
        /** DurableMemoryForgetResponse */
        DurableMemoryForgetResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: {
                deleted: boolean;
                eventId: string;
            };
            freshness: components["schemas"]["Freshness"];
        };
        /** DurableMemoryRestoreRequest */
        DurableMemoryRestoreRequest: {
            backupPath: string;
            targetVaultPath: string;
        };
        /** DurableMemoryRestoreResponse */
        DurableMemoryRestoreResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: {
                eventCount: number;
                /** Format: date-time */
                restoredAt: string;
                targetVaultPath: string;
            };
            freshness: components["schemas"]["Freshness"];
        };
        /** DurableMemorySearchResponse */
        DurableMemorySearchResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: {
                items: {
                    channel: string;
                    eventId: string;
                    identityId: string | null;
                    /** Format: date-time */
                    occurredAt: string;
                    score: number;
                    sessionId: string | null;
                    source: string;
                    text: string;
                }[];
            };
            freshness: components["schemas"]["Freshness"];
        };
        /** DurableMemorySettings */
        DurableMemorySettings: {
            channels: {
                dashboard: boolean;
                hermes: boolean;
                messenger?: boolean;
                voice: boolean;
            };
            enabled: boolean;
            exclusions: string[];
            privateMode: boolean;
            /** @constant */
            retention: "unlimited";
        };
        /** DurableMemorySettingsPatch */
        DurableMemorySettingsPatch: {
            channels: {
                dashboard: boolean;
                hermes: boolean;
                voice: boolean;
            };
            enabled: boolean;
            privateMode: boolean;
        };
        /** DurableMemorySettingsResponse */
        DurableMemorySettingsResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["DurableMemorySettings"];
            freshness: components["schemas"]["Freshness"];
        };
        /** DurableMemoryStatus */
        DurableMemoryStatus: {
            /** @enum {unknown} */
            indexState: "ready" | "unavailable" | "error";
            lastError: string | null;
            /** Format: date-time */
            lastRestoreTestAt: string | null;
            /** Format: date-time */
            lastWrittenAt: string | null;
            pending: number;
            ready: boolean;
            settings?: components["schemas"]["DurableMemorySettings"];
            vaultPath: string;
        };
        /** DurableMemoryStatusResponse */
        DurableMemoryStatusResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["DurableMemoryStatus"];
            freshness: components["schemas"]["Freshness"];
        };
        /** ElevenSpeechRequest */
        ElevenSpeechRequest: {
            /** @constant */
            confirmed: true;
            text: string;
            voiceId: string;
        };
        /**
         * EntityRef
         * @description Typed link to another resource, used for navigation ("jump to task").
         */
        EntityRef: {
            id: string;
            label?: string;
            /** @enum {string} */
            type: "task" | "agent" | "approval" | "memory" | "thread" | "message" | "draft" | "calendar_event" | "automation" | "automation_run" | "research_project" | "file" | "notification" | "service" | "adapter" | "audit_event" | "activity_event";
        };
        /**
         * ErrorCode
         * @enum {string}
         */
        ErrorCode: "ADAPTER_UNAVAILABLE" | "ADAPTER_TIMEOUT" | "CAPABILITY_MISSING" | "VALIDATION_FAILED" | "NOT_FOUND" | "CONFLICT" | "UNAUTHENTICATED" | "FORBIDDEN" | "CSRF_INVALID" | "APPROVAL_REQUIRED" | "IDEMPOTENCY_CONFLICT" | "RATE_LIMITED" | "REAUTH_REQUIRED" | "INTERNAL";
        /**
         * ErrorDetail
         * @description Normalized error. Provider-specific errors are mapped to this shape by adapters.
         */
        ErrorDetail: {
            code: components["schemas"]["ErrorCode"];
            correlationId: string;
            /** @description Structured context, e.g. { fieldErrors: [...] }. May be empty. */
            details: {
                [key: string]: unknown;
            };
            message: string;
            retryable: boolean;
            severity: components["schemas"]["Severity"];
        };
        /**
         * ErrorResponse
         * @description Error envelope returned for every non-2xx REST response.
         */
        ErrorResponse: {
            error: components["schemas"]["ErrorDetail"];
        };
        /** EscalationStep */
        EscalationStep: {
            afterSeconds: number;
            /** @enum {string} */
            channel: "dashboard" | "telegram" | "whatsapp" | "sms" | "phone" | "email";
            description: string;
            stopOnAcknowledge?: boolean;
        };
        /**
         * EventEnvelope
         * @description CloudEvents-inspired envelope (PLAN §12.3). sequence is global and strictly increasing.
         */
        EventEnvelope: {
            causationId?: string;
            contractVersion: components["schemas"]["ContractVersion"];
            correlationId: string;
            /** @description Typed per event type; see the AsyncAPI document. */
            data: {
                [key: string]: unknown;
            };
            id: string;
            sequence: number;
            /** @description e.g. adapter://mock-tasks or control-api://core. */
            source: string;
            /** @constant */
            specversion: "1.0";
            /** @description e.g. task/task_01J... */
            subject: string;
            /** Format: date-time */
            time: string;
            type: string;
        };
        extension: {
            authenticated: boolean | null;
            available: boolean | null;
            configured: boolean | null;
            enabled: boolean | null;
            id: string;
            /** @constant */
            installed: true;
            needsSetup: boolean | null;
            unsupported: boolean | null;
        };
        /**
         * FileCategory
         * @enum {string}
         */
        FileCategory: "generated" | "uploaded" | "reports" | "presentations" | "invoices" | "research" | "exports" | "temporary";
        /**
         * FileItem
         * @description Generated or uploaded document (PLAN §37). Untrusted content is only previewed in a sandbox.
         */
        FileItem: {
            category: components["schemas"]["FileCategory"];
            checksum: string | null;
            /** Format: date-time */
            createdAt: string;
            createdBy: components["schemas"]["Actor"];
            currentVersion: number;
            id: string;
            labels?: string[];
            lineage: components["schemas"]["FileLineageEntry"][];
            /** @description Logical location, e.g. D:\Friday\Dateien\Berichte. */
            location: string;
            mimeType: string;
            name: string;
            previewKind: components["schemas"]["FilePreviewKind"];
            sizeBytes: number;
            source: components["schemas"]["SourceDescriptor"];
            tags: string[];
            taskId: string | null;
            /** Format: date-time */
            updatedAt: string;
            /** @description Monotonic revision used for optimistic concurrency (If-Match). */
            version: number;
            versions: components["schemas"]["FileVersion"][];
        };
        /**
         * FileItemListResponse
         * @description Cursor-paginated list envelope for FileItem.
         */
        FileItemListResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            freshness: components["schemas"]["Freshness"];
            items: components["schemas"]["FileItem"][];
            pageInfo: components["schemas"]["PageInfo"];
            sources: components["schemas"]["SourceDescriptor"][];
        };
        /**
         * FileItemResponse
         * @description Single-resource envelope for FileItem.
         */
        FileItemResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["FileItem"];
            freshness: components["schemas"]["Freshness"];
        };
        /** FileLineageEntry */
        FileLineageEntry: {
            description: string;
            fileId?: string;
            /** @enum {string} */
            relation: "derived_from" | "input_of" | "output_of" | "replaces";
            taskId?: string;
        };
        /** FilePreview */
        FilePreview: {
            contentType: string;
            fileId: string;
            kind: components["schemas"]["FilePreviewKind"];
            sandboxed: boolean;
            text?: string;
            truncated: boolean;
            /** @description Same-origin sandboxed preview URL. */
            url?: string;
        };
        /**
         * FilePreviewKind
         * @enum {string}
         */
        FilePreviewKind: "none" | "text" | "markdown" | "image" | "pdf" | "html";
        /**
         * FilePreviewResponse
         * @description Single-resource envelope for FilePreview.
         */
        FilePreviewResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["FilePreview"];
            freshness: components["schemas"]["Freshness"];
        };
        /**
         * FileRenameRequest
         * @description Renames a file (PLAN §37.3). The location and the content stay unchanged; the name must not contain path separators or reserved characters.
         */
        FileRenameRequest: {
            /** @description New file name including extension. */
            name: string;
        };
        /** FilesCapability */
        FilesCapability: {
            delete: boolean;
            download: boolean;
            preview: boolean;
            read: boolean;
            /** @description Rename files (PATCH /files/{id}). */
            rename?: boolean;
            sources: string[];
            upload: boolean;
        };
        /** FileVersion */
        FileVersion: {
            checksum?: string;
            /** Format: date-time */
            createdAt: string;
            createdBy: components["schemas"]["Actor"];
            sizeBytes: number;
            version: number;
        };
        /**
         * Freshness
         * @description Data age marker; stale data must never be rendered as live.
         */
        Freshness: {
            /** Format: date-time */
            asOf: string | null;
            state: components["schemas"]["FreshnessState"];
        };
        /**
         * FreshnessState
         * @enum {string}
         */
        FreshnessState: "fresh" | "stale" | "unknown" | "offline-cache";
        /**
         * FridayStatus
         * @description Compact overall status (top bar).
         */
        FridayStatus: {
            adapterSummary: {
                degraded: number;
                offline: number;
                online: number;
            };
            /** @enum {string} */
            dataMode: "mock" | "hybrid" | "live";
            eventStream: {
                /** Format: date-time */
                lastEventAt: string | null;
                roundtripMs: number | null;
                /** @enum {string} */
                state: "online" | "degraded" | "offline" | "connecting";
            };
            label: string;
            mode: components["schemas"]["OrbMode"];
            /** Format: date-time */
            since: string;
            status: components["schemas"]["HealthStatus"];
            uptimeSeconds: number;
            version: string;
        };
        /**
         * FridayStatusResponse
         * @description Single-resource envelope for FridayStatus.
         */
        FridayStatusResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["FridayStatus"];
            freshness: components["schemas"]["Freshness"];
        };
        /**
         * FrontendErrorReport
         * @description One aggregated browser error (PLAN §50.3). Contains no user data: no stack traces, no URLs with query strings, no identifiers. The server additionally redacts the message.
         */
        FrontendErrorReport: {
            /** @description Occurrences of this error since the last batch (1 when absent). */
            count?: number;
            /** @enum {string} */
            kind: "js_error" | "unhandled_rejection" | "render_error" | "network_error" | "webgl_context_lost" | "resource_error";
            /** @description Short technical message (for example the error class and the failing module). */
            message: string;
            /** Format: date-time */
            occurredAt?: string;
            /** @description Dashboard route path without query or fragment. */
            route?: string;
        };
        /**
         * FrontendTelemetryBatch
         * @description Batch of frontend errors and orb performance samples (PLAN §50.3). Limited to 20 errors and 60 samples per request; the server also caps the body size (32 KiB) and the request rate. Must not contain personal data.
         */
        FrontendTelemetryBatch: {
            errors?: components["schemas"]["FrontendErrorReport"][];
            orbSamples?: components["schemas"]["OrbPerformanceSample"][];
        };
        /**
         * FrontendTelemetryReceipt
         * @description How much of a telemetry batch the server recorded.
         */
        FrontendTelemetryReceipt: {
            acceptedErrors: number;
            acceptedOrbSamples: number;
        };
        /**
         * FrontendTelemetryReceiptResponse
         * @description Single-resource envelope for FrontendTelemetryReceipt.
         */
        FrontendTelemetryReceiptResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["FrontendTelemetryReceipt"];
            freshness: components["schemas"]["Freshness"];
        };
        /**
         * Health
         * @description Liveness/readiness summary of the control API and its components.
         */
        Health: {
            /** Format: date-time */
            checkedAt: string;
            components: {
                id: string;
                latencyMs: number | null;
                name: string;
                status: components["schemas"]["HealthStatus"];
            }[];
            contractVersion: components["schemas"]["ContractVersion"];
            status: components["schemas"]["HealthStatus"];
        };
        /** HealthcheckResult */
        HealthcheckResult: {
            /** Format: date-time */
            checkedAt: string;
            correlationId: string;
            latencyMs: number | null;
            message: string;
            serviceId: string;
            status: components["schemas"]["HealthStatus"];
        };
        /**
         * HealthcheckResultResponse
         * @description Single-resource envelope for HealthcheckResult.
         */
        HealthcheckResultResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["HealthcheckResult"];
            freshness: components["schemas"]["Freshness"];
        };
        /**
         * HealthStatus
         * @enum {string}
         */
        HealthStatus: "online" | "degraded" | "offline" | "unknown" | "paused";
        /** HermesConfigPatch */
        HermesConfigPatch: {
            /** @constant */
            key: "model.provider";
            value: string;
        } | {
            /** @constant */
            key: "model.default";
            value: string;
        } | {
            /** @constant */
            key: "agent.reasoning_effort";
            /** @enum {unknown} */
            value: "" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
        } | {
            /** @constant */
            key: "fallback.min_switch_reset_seconds";
            value: number;
        } | {
            /** @constant */
            key: "fallback_model";
            value: {
                model: string;
                provider: string;
            }[];
        } | {
            /** @constant */
            key: "agent.auto_recovery_cycles";
            value: number;
        } | {
            /** @constant */
            key: "agent.run_budget_seconds";
            value: number | null;
        } | {
            /** @constant */
            key: "agent.budget_warning_ratio";
            value: number | null;
        } | {
            /** @constant */
            key: "agent.agent_cache.max_size";
            value: number;
        } | {
            /** @constant */
            key: "max_concurrent_sessions";
            value: number;
        } | {
            /** @constant */
            key: "context_file_max_chars";
            value: number;
        } | {
            /** @constant */
            key: "compression.enabled";
            value: boolean;
        } | {
            /** @constant */
            key: "compression.threshold";
            value: number;
        } | {
            /** @constant */
            key: "compression.target_ratio";
            value: number;
        } | {
            /** @constant */
            key: "compression.tail_mode";
            /** @enum {unknown} */
            value: "lean" | "legacy";
        } | {
            /** @constant */
            key: "compression.protect_last_n";
            value: number;
        } | {
            /** @constant */
            key: "agent.max_turns";
            value: number;
        } | {
            /** @constant */
            key: "agent.gateway_timeout";
            value: number;
        } | {
            /** @constant */
            key: "agent.api_max_retries";
            value: number;
        } | {
            /** @constant */
            key: "session.terminal_continue";
            value: boolean;
        } | {
            /** @constant */
            key: "max_live_sessions";
            value: number;
        } | {
            /** @constant */
            key: "terminal.timeout";
            value: number;
        } | {
            /** @constant */
            key: "terminal.container_cpu";
            value: number;
        } | {
            /** @constant */
            key: "terminal.container_memory";
            value: number;
        } | {
            /** @constant */
            key: "terminal.container_disk";
            value: number;
        } | {
            /** @constant */
            key: "terminal.container_persistent";
            value: boolean;
        } | {
            /** @constant */
            key: "terminal.backend";
            /** @enum {unknown} */
            value: "local" | "docker";
        } | {
            /** @constant */
            key: "terminal.cwd";
            value: string;
        } | {
            /** @constant */
            key: "terminal.docker_network";
            value: boolean;
        } | {
            /** @constant */
            key: "terminal.docker_mount_cwd_to_workspace";
            value: boolean;
        } | {
            /** @constant */
            key: "terminal.docker_volumes";
            value: string[];
        } | {
            /** @constant */
            key: "browser.command_timeout";
            value: number;
        } | {
            /** @constant */
            key: "browser.snapshot_threshold";
            value: number;
        } | {
            /** @constant */
            key: "browser.inactivity_timeout";
            value: number;
        } | {
            /** @constant */
            key: "browser.dialog_policy";
            /** @enum {unknown} */
            value: "must_respond" | "auto_dismiss";
        } | {
            /** @constant */
            key: "browser.dialog_timeout_s";
            value: number;
        } | {
            /** @constant */
            key: "browser.allow_private_urls";
            value: boolean;
        } | {
            /** @constant */
            key: "browser.use_real_profile";
            value: boolean;
        } | {
            /** @constant */
            key: "browser.real_profile_pin";
            value: string;
        } | {
            /** @constant */
            key: "browser.restrict_evaluate";
            value: boolean;
        } | {
            /** @constant */
            key: "browser.allow_unsafe_evaluate";
            value: boolean;
        } | {
            /** @constant */
            key: "code_execution.mode";
            /** @enum {unknown} */
            value: "project" | "strict";
        } | {
            /** @constant */
            key: "code_execution.kernel_idle_timeout";
            value: number;
        } | {
            /** @constant */
            key: "code_execution.max_session_kernels";
            value: number;
        } | {
            /** @constant */
            key: "computer_use.permission_mode";
            /** @enum {unknown} */
            value: "standard" | "bounded";
        } | {
            /** @constant */
            key: "computer_use.capability_manifest";
            value: string;
        } | {
            /** @constant */
            key: "computer_use.max_image_dimension";
            value: number;
        } | {
            /** @constant */
            key: "computer_use.ax_max_elements";
            value: number;
        } | {
            /** @constant */
            key: "computer_use.capture_after_mode";
            /** @enum {unknown} */
            value: "som" | "ax" | "vision";
        } | {
            /** @constant */
            key: "toolsets";
            value: string[];
        } | {
            /** @constant */
            key: "command_allowlist";
            value: string[];
        } | {
            /** @constant */
            key: "approvals.mode";
            /** @enum {unknown} */
            value: "manual" | "smart";
        } | {
            /** @constant */
            key: "approvals.timeout";
            value: number;
        } | {
            /** @constant */
            key: "approvals.single_query_mode";
            /** @enum {unknown} */
            value: "deny" | "approve";
        } | {
            /** @constant */
            key: "approvals.unattended_mode";
            /** @enum {unknown} */
            value: "deny" | "approve";
        } | {
            /** @constant */
            key: "security.protected_instruction_files";
            /** @constant */
            value: true;
        } | {
            /** @constant */
            key: "skills.disabled";
            value: string[];
        } | {
            /** @enum {unknown} */
            key: "cron.catch_up_missed" | "cron.allow_agent_scheduling" | "cron.preflight" | "cron.require_restart_safe_scope" | "gateway.loop_watchdog" | "gateway.startup_watchdog";
            value: boolean;
        } | {
            /** @constant */
            key: "cron.max_parallel_jobs";
            value: number | null;
        } | {
            /** @constant */
            key: "cron.output_retention";
            value: number;
        } | {
            /** @constant */
            key: "cron.script_timeout_seconds";
            value: number;
        } | {
            /** @constant */
            key: "cron.session_db_timeout_seconds";
            value: number;
        } | {
            /** @constant */
            key: "cron.failure_repeat_alert_hours";
            value: number;
        } | {
            /** @constant */
            key: "gateway.startup_watchdog_timeout_seconds";
            value: number;
        } | {
            /** @constant */
            key: "gateway.restart_loop_guard.max_restarts";
            value: number;
        } | {
            /** @constant */
            key: "gateway.respawn_storm.max_starts";
            value: number;
        } | {
            /** @constant */
            key: "gateway.signal_interrupt_grace_timeout";
            value: number;
        } | {
            /** @constant */
            key: "logging.level";
            /** @enum {unknown} */
            value: "DEBUG" | "INFO" | "WARNING";
        } | {
            /** @constant */
            key: "logging.max_size_mb";
            value: number;
        } | {
            /** @constant */
            key: "logging.backup_count";
            value: number;
        } | {
            enabled: boolean;
            /** @constant */
            key: "plugin.activation";
            pluginId: string;
        } | {
            enabled: boolean;
            /** @constant */
            key: "mcp.httpServer";
            name: string;
            url: string | null;
        } | {
            enabled: boolean;
            /** @constant */
            key: "mcp.activation";
            name: string;
        } | {
            /** @constant */
            key: "mcp.bearerCredential";
            name: string;
            token: string | null;
        } | {
            /** @enum {unknown} */
            key: "OPENROUTER_API_KEY" | "OPENAI_API_KEY" | "ANTHROPIC_API_KEY";
            value: string | null;
        };
        /** HermesConfigStatus */
        HermesConfigStatus: {
            /** Format: date-time */
            checkedAt: string;
            families: {
                authenticated: boolean | null;
                available: boolean | null;
                configFileSet: boolean;
                configured: boolean | null;
                /** @constant */
                coverage: "followup";
                enabled: boolean | null;
                followup: string;
                /** @enum {unknown} */
                id: "models" | "agent" | "execution" | "extensions" | "operations";
                installed: boolean | null;
                needsSetup: boolean | null;
                roots: string[];
                unsupported: boolean | null;
            }[];
            fields: {
                consumer: string;
                explicit: boolean;
                /** @enum {unknown} */
                family: "agent" | "models" | "execution" | "extensions" | "operations";
                /** @enum {unknown} */
                key: "model.provider" | "model.default" | "agent.reasoning_effort" | "fallback.min_switch_reset_seconds" | "fallback_model" | "agent.auto_recovery_cycles" | "agent.run_budget_seconds" | "agent.budget_warning_ratio" | "agent.agent_cache.max_size" | "max_concurrent_sessions" | "context_file_max_chars" | "compression.enabled" | "compression.threshold" | "compression.target_ratio" | "compression.tail_mode" | "compression.protect_last_n" | "agent.max_turns" | "agent.gateway_timeout" | "agent.api_max_retries" | "session.terminal_continue" | "max_live_sessions" | "terminal.timeout" | "terminal.container_cpu" | "terminal.container_memory" | "terminal.container_disk" | "terminal.container_persistent" | "terminal.backend" | "terminal.cwd" | "terminal.docker_network" | "terminal.docker_mount_cwd_to_workspace" | "terminal.docker_volumes" | "browser.command_timeout" | "browser.snapshot_threshold" | "browser.inactivity_timeout" | "browser.dialog_policy" | "browser.dialog_timeout_s" | "browser.allow_private_urls" | "browser.use_real_profile" | "browser.real_profile_pin" | "browser.restrict_evaluate" | "browser.allow_unsafe_evaluate" | "code_execution.mode" | "code_execution.kernel_idle_timeout" | "code_execution.max_session_kernels" | "computer_use.permission_mode" | "computer_use.capability_manifest" | "computer_use.max_image_dimension" | "computer_use.ax_max_elements" | "computer_use.capture_after_mode" | "toolsets" | "command_allowlist" | "approvals.mode" | "approvals.timeout" | "approvals.single_query_mode" | "approvals.unattended_mode" | "security.protected_instruction_files" | "skills.disabled" | "cron.catch_up_missed" | "cron.allow_agent_scheduling" | "cron.preflight" | "cron.max_parallel_jobs" | "cron.output_retention" | "cron.script_timeout_seconds" | "cron.session_db_timeout_seconds" | "cron.failure_repeat_alert_hours" | "cron.require_restart_safe_scope" | "gateway.loop_watchdog" | "gateway.startup_watchdog" | "gateway.startup_watchdog_timeout_seconds" | "gateway.restart_loop_guard.max_restarts" | "gateway.respawn_storm.max_starts" | "gateway.signal_interrupt_grace_timeout" | "logging.level" | "logging.max_size_mb" | "logging.backup_count";
                /** @constant */
                reasonCode: "runtime_receipt_unavailable";
                /** @enum {unknown} */
                type: "integer" | "optionalInteger" | "number" | "optionalNumber" | "boolean" | "string" | "fallback" | "skillNames" | "textList";
                value: (number | boolean | string | null) | {
                    model: string;
                    provider: string;
                }[] | string[];
                /** @constant */
                verification: "unverified";
                writable: boolean;
            }[];
            installed: boolean;
            inventory: {
                modelProvidersComplete: boolean;
                pluginsComplete: boolean;
                reasons: string[];
                /** @constant */
                scope: "profile";
                skillsComplete: boolean;
            };
            mcpComplete: boolean;
            mcpServers: {
                /** @enum {unknown} */
                authMode: "none" | "bearer" | "oauth" | "unknown";
                credentialConfigured: boolean | null;
                editable: boolean;
                enabled: boolean | null;
                endpoint: string | null;
                id: string;
                /** @enum {unknown} */
                transport: "http" | "stdio" | "unknown";
            }[];
            modelProviders: {
                authenticated: boolean | null;
                available: boolean | null;
                configFileSet: boolean;
                id: string;
            }[];
            plugins: components["schemas"]["extension"][];
            revision: number | null;
            secretStates: {
                configFileSet: boolean;
                effectiveConfigured: boolean | null;
                /** @enum {unknown} */
                key: "model.api_key" | "OPENROUTER_API_KEY" | "OPENAI_API_KEY" | "ANTHROPIC_API_KEY";
            }[];
            skills: components["schemas"]["extension"][];
            sourceRevision: string | null;
            write: null | {
                applied: boolean | null;
                key: string;
                persisted: boolean;
                /** @enum {unknown} */
                reasonCode: "runtime_receipt_unavailable" | "readback_mismatch";
                /** @constant */
                verification: "unverified";
            };
            $defs: {
                extension: {
                    authenticated: boolean | null;
                    available: boolean | null;
                    configured: boolean | null;
                    enabled: boolean | null;
                    id: string;
                    /** @constant */
                    installed: true;
                    needsSetup: boolean | null;
                    unsupported: boolean | null;
                };
            };
        };
        /** HermesConfigStatusResponse */
        HermesConfigStatusResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["HermesConfigStatus"];
            freshness: components["schemas"]["Freshness"];
        };
        /** HermesCronJobs */
        HermesCronJobs: {
            count: number;
            jobs: {
                enabled: boolean;
                id: string;
                lastRunAt: string | null;
                name: string;
                nextRunAt: string | null;
                schedule: string;
                state: string;
                timezone: string | null;
            }[];
            profile: string;
            profileTimezone: string | null;
            /** @description The store alone cannot prove scheduler process liveness. */
            schedulerRunning: null;
            sourceRevision: string;
            storeRevision: string;
            truncated: boolean;
        };
        /** HermesCronJobsResponse */
        HermesCronJobsResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["HermesCronJobs"];
            freshness: components["schemas"]["Freshness"];
        };
        /** HermesMcpOAuthRequest */
        HermesMcpOAuthRequest: {
            /** @constant */
            action: "start";
            name: string;
        } | {
            /** @enum {unknown} */
            action: "status" | "cancel";
            flowId: string;
        };
        /** HermesMcpOAuthResponse */
        HermesMcpOAuthResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: {
                authorizationUrl: string | null;
                failureClass: string | null;
                flowId: string;
                revision: number | null;
                runtimeApplied: null;
                /** @enum {unknown} */
                status: "starting" | "awaiting_approval" | "publishing" | "cancelling" | "configured" | "failed";
            };
            freshness: components["schemas"]["Freshness"];
        };
        /** HermesMcpProbeRequest */
        HermesMcpProbeRequest: {
            name: string;
        };
        /** HermesMcpProbeResponse */
        HermesMcpProbeResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: {
                /** Format: date-time */
                checkedAt: string;
                connected: boolean;
                /** @enum {unknown} */
                failureClass: "auth_required" | "config_invalid" | "connect_failed" | "protocol_failed" | "protocol_unsupported" | "redirect_rejected" | "private_or_unresolved_address" | null;
                name: string;
                revision: number;
                runtimeApplied: null;
                toolCount: number | null;
                toolCountComplete: boolean;
            };
            freshness: components["schemas"]["Freshness"];
        };
        /** HermesModelCatalog */
        HermesModelCatalog: {
            /** Format: date-time */
            checkedAt: string;
            /** @description Pinned picker can silently omit plugin profiles whose discovery fails. */
            providerListComplete: boolean | null;
            providers: {
                id: string;
                label: string;
            }[];
            selected: null | {
                id: string;
                modelAccess: boolean | null;
                models: string[];
                /** @enum {unknown} */
                origin: "curated" | "endpoint_confirmed_picker";
                /** @enum {unknown} */
                probeStatus: "unsupported" | "succeeded" | "failed";
            };
            sourceRevision: string;
        };
        /** HermesModelCatalogResponse */
        HermesModelCatalogResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["HermesModelCatalog"];
            freshness: components["schemas"]["Freshness"];
        };
        /** HermesSkillKeyCheck */
        HermesSkillKeyCheck: {
            /** Format: date-time */
            checkedAt: string;
            /** @enum {unknown} */
            key: "AIRTABLE_API_KEY" | "NOTION_API_KEY";
            /** @enum {unknown} */
            state: "verified" | "missing" | "rejected" | "permission-limited" | "unavailable";
        };
        /** HermesSkillKeyCheckResponse */
        HermesSkillKeyCheckResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["HermesSkillKeyCheck"];
            freshness: components["schemas"]["Freshness"];
        };
        /** HermesSkillKeyPatch */
        HermesSkillKeyPatch: {
            /** @enum {string} */
            key: "AIRTABLE_API_KEY" | "NOTION_API_KEY" | "TENOR_API_KEY" | "JINA_API_KEY" | "MSGRAPH_TENANT_ID" | "MSGRAPH_CLIENT_ID" | "MSGRAPH_CLIENT_SECRET";
            value: string;
        };
        /** HermesSkillKeys */
        HermesSkillKeys: {
            applied: boolean | null;
            configured: {
                AIRTABLE_API_KEY: boolean;
                JINA_API_KEY: boolean;
                MSGRAPH_CLIENT_ID: boolean;
                MSGRAPH_CLIENT_SECRET: boolean;
                MSGRAPH_TENANT_ID: boolean;
                NOTION_API_KEY: boolean;
                TENOR_API_KEY: boolean;
            };
        };
        /** HermesSkillKeysResponse */
        HermesSkillKeysResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["HermesSkillKeys"];
            freshness: components["schemas"]["Freshness"];
        };
        /** HimalayaAccount */
        HimalayaAccount: {
            cliInstalled: boolean;
            configPresent: boolean;
            connectionChecked: boolean;
            credentialsPresent: boolean;
            managed: boolean;
            readyForLocalUse: boolean;
            revision: number;
        };
        /** HimalayaAccountPatch */
        HimalayaAccountPatch: {
            displayName: string;
            draftsFolder: string;
            email: string;
            imapHost: string;
            imapLogin: string;
            imapPassword: string;
            imapPort: number;
            sentFolder: string;
            /** @enum {string} */
            smtpEncryption: "tls" | "start-tls";
            smtpHost: string;
            smtpLogin: string;
            smtpPassword: string;
            smtpPort: number;
            trashFolder: string;
        };
        /** HimalayaAccountResponse */
        HimalayaAccountResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["HimalayaAccount"];
            freshness: components["schemas"]["Freshness"];
        };
        /** HimalayaEnvelopeListResponse */
        HimalayaEnvelopeListResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: {
                items: {
                    date: string | null;
                    flags: unknown[] | null;
                    from: {
                        [key: string]: unknown;
                    }[] | null;
                    id: string;
                    subject: string | null;
                }[];
                mailbox: string;
                page: number;
            };
            freshness: components["schemas"]["Freshness"];
        };
        /** HimalayaMailboxListResponse */
        HimalayaMailboxListResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: {
                mailboxes: {
                    id: string;
                    name: string;
                    role: string | null;
                }[];
            };
            freshness: components["schemas"]["Freshness"];
        };
        /** HimalayaMessageResponse */
        HimalayaMessageResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: {
                bodyText: string;
                date: string;
                from: string;
                id: string;
                mailbox: string;
                messageId?: string;
                references?: string;
                replyTo?: string;
                subject: string;
            };
            freshness: components["schemas"]["Freshness"];
        };
        /** HimalayaSendRequest */
        HimalayaSendRequest: {
            body: string;
            subject: string;
            to: string[];
        };
        /** HimalayaSendResponse */
        HimalayaSendResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: {
                replayed: boolean;
                /** @enum {string} */
                state: "sent" | "unknown";
            };
            freshness: components["schemas"]["Freshness"];
        };
        /** HimalayaSmtpCheckResponse */
        HimalayaSmtpCheckResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: {
                ok: boolean;
            };
            freshness: components["schemas"]["Freshness"];
        };
        /**
         * IntegrationEvent
         * @description Capture candidate. A durable writer must enforce captureEligibility and redact sensitive text before storage.
         */
        IntegrationEvent: {
            actor: {
                id: string;
                role: string | null;
                /** @enum {unknown} */
                type: "user" | "assistant" | "system" | "provider";
            };
            /** @enum {unknown} */
            captureEligibility: "eligible" | "private" | "do_not_store";
            channel: string;
            contractVersion: components["schemas"]["ContractVersion"];
            correlationId: string | null;
            dialogId: string | null;
            eventId: string;
            /** @enum {unknown} */
            eventType: "user_utterance" | "assistant_response" | "action_result";
            identityId: string | null;
            /** Format: date-time */
            occurredAt: string;
            /** @enum {unknown} */
            outcome: "completed" | "aborted" | "uncertain";
            payload: {
                /** @constant */
                kind: "text";
                text: string;
            } | {
                actionId: string;
                externalId: string | null;
                /** @constant */
                kind: "action";
                targetId: string | null;
            };
            /** @enum {unknown} */
            redaction: "complete" | "required";
            sessionId: string | null;
            source: string;
        };
        /** IntegrationStatus */
        IntegrationStatus: {
            appliedRevision: number | null;
            authenticated: boolean | null;
            canRead: boolean | null;
            canWrite: boolean | null;
            /** Format: date-time */
            checkedAt: string;
            configured: boolean;
            connected: boolean | null;
            errorCode: string | null;
            id: string | null;
            installed: boolean;
            kind: string;
            persistedRevision: number;
            settings: {
                [key: string]: {
                    reasonCode: string | null;
                    /** @enum {unknown} */
                    verification: "verified" | "unverified" | "failed" | "requires_restart";
                };
            };
            /** @enum {unknown} */
            verification: "verified" | "unverified" | "failed" | "requires_restart";
        };
        /** IntegrationStatusResponse */
        IntegrationStatusResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["IntegrationStatus"];
            freshness: components["schemas"]["Freshness"];
        };
        /**
         * JsonSchemaObject
         * @description An embedded JSON Schema document (e.g. an adapter configSchema).
         */
        JsonSchemaObject: {
            [key: string]: unknown;
        };
        /** KieTask */
        KieTask: {
            creditsConsumed: number | null;
            /** @enum {string} */
            kind: "image" | "video";
            resultUrls: string[];
            /** @enum {string} */
            state: "waiting" | "queuing" | "generating" | "success" | "fail";
            taskId: string;
        };
        /** KieTaskRequest */
        KieTaskRequest: {
            /** @enum {string} */
            aspectRatio: "1:1" | "16:9" | "9:16";
            /** @constant */
            confirmed: true;
            /** @enum {string} */
            kind: "image" | "video";
            prompt: string;
        };
        /** KieTaskResponse */
        KieTaskResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["KieTask"];
            freshness: components["schemas"]["Freshness"];
        };
        /** LatencyStat */
        LatencyStat: {
            avgMs: number | null;
            currentMs: number | null;
            p95Ms: number | null;
            sampleCount: number;
        };
        /**
         * Layout
         * @description Overview layout file (PLAN §25.4) on a 12-column grid.
         */
        Layout: {
            columns?: number;
            layoutId: string;
            name?: string;
            widgets: components["schemas"]["LayoutWidget"][];
        };
        /** LayoutImportRequest */
        LayoutImportRequest: {
            activate?: boolean;
            layout: components["schemas"]["Layout"];
        };
        /**
         * LayoutListResponse
         * @description Cursor-paginated list envelope for Layout.
         */
        LayoutListResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            freshness: components["schemas"]["Freshness"];
            items: components["schemas"]["Layout"][];
            pageInfo: components["schemas"]["PageInfo"];
            sources: components["schemas"]["SourceDescriptor"][];
        };
        /**
         * LayoutResponse
         * @description Single-resource envelope for Layout.
         */
        LayoutResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["Layout"];
            freshness: components["schemas"]["Freshness"];
        };
        /** LayoutWidget */
        LayoutWidget: {
            h: number;
            id: string;
            visible: boolean;
            w: number;
            x: number;
            y: number;
        };
        /** LinuxEnrollmentSample */
        LinuxEnrollmentSample: {
            /** @enum {string} */
            kind: "wake" | "short" | "negatives" | "speech";
            pcmBase64: string;
        };
        /** LinuxEnrollmentStatus */
        LinuxEnrollmentStatus: {
            available: boolean;
            contractVersion: components["schemas"]["ContractVersion"];
            counts: components["schemas"]["counts"];
            error: string | null;
            phrase: string;
            required: components["schemas"]["counts"];
            shortPhrase: string | null;
            /** @enum {string} */
            state: "pending" | "training" | "activating" | "complete" | "failed";
            $defs: {
                counts: {
                    negatives: number;
                    short: number;
                    speech: number;
                    wake: number;
                };
            };
        };
        /**
         * ListEnvelope
         * @description Generic cursor-paginated list envelope.
         */
        ListEnvelope: {
            contractVersion: components["schemas"]["ContractVersion"];
            freshness: components["schemas"]["Freshness"];
            items: unknown[];
            pageInfo: components["schemas"]["PageInfo"];
            sources: components["schemas"]["SourceDescriptor"][];
        };
        /** LocalEventRequest */
        LocalEventRequest: {
            /** Format: date-time */
            end: string;
            /** Format: date-time */
            start: string;
            timeZone: string;
            title: string;
        };
        /** LocationCandidate */
        LocationCandidate: {
            country: string;
            countryCode: string;
            label: string;
            latitude: number;
            longitude: number;
            region?: string;
        };
        /** LocationSearchResponse */
        LocationSearchResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: {
                items: components["schemas"]["LocationCandidate"][];
                /** @constant */
                provider: "Open-Meteo";
            };
            freshness: components["schemas"]["Freshness"];
        };
        /** LoginRequest */
        LoginRequest: {
            displayName?: string;
            password: string;
            rememberMe?: boolean;
            username: string;
        };
        /** MailAccount */
        MailAccount: {
            aliases: string[];
            archiveFolder: string;
            /** @enum {unknown} */
            authMode: "password" | "google-oauth" | "microsoft-oauth";
            displayName: string;
            draftsFolder: string;
            email: string;
            id: string;
            imapHost: string;
            imapLogin: string;
            imapPort: number;
            /** @enum {unknown} */
            imapSecurity: "tls" | "start-tls";
            oauthClientId: string;
            oauthTenant: string;
            revision: number;
            secretState: {
                imapPassword: boolean;
                oauthRefreshToken: boolean;
                smtpPassword: boolean;
            };
            senderName: string;
            sentFolder: string;
            signature: string;
            smtpHost: string;
            smtpLogin: string;
            smtpPort: number;
            /** @enum {unknown} */
            smtpSecurity: "tls" | "start-tls";
            spamFolder: string;
            trashFolder: string;
        };
        /** MailAccountResponse */
        MailAccountResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["MailAccount"];
            freshness: components["schemas"]["Freshness"];
        };
        /** MailAccountsResponse */
        MailAccountsResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: {
                accounts: components["schemas"]["MailAccount"][];
                defaultAccountId: string | null;
                revision: number;
            };
            freshness: components["schemas"]["Freshness"];
        };
        /** MailAccountWrite */
        MailAccountWrite: {
            aliases: string[];
            archiveFolder: string;
            /** @enum {unknown} */
            authMode?: "password" | "google-oauth" | "microsoft-oauth";
            displayName: string;
            draftsFolder: string;
            /** Format: email */
            email: string;
            imapHost: string;
            imapLogin: string;
            imapPort: number;
            /** @enum {unknown} */
            imapSecurity: "tls" | "start-tls";
            oauthClientId?: string;
            oauthTenant?: string;
            secrets?: {
                imapPassword?: string | null;
                smtpPassword?: string | null;
            };
            senderName: string;
            sentFolder: string;
            signature: string;
            smtpHost: string;
            smtpLogin: string;
            smtpPort: number;
            /** @enum {unknown} */
            smtpSecurity: "tls" | "start-tls";
            spamFolder: string;
            trashFolder: string;
        };
        /** MailAttachmentResponse */
        MailAttachmentResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: {
                contentType: string;
                data: string;
                filename: string;
                size: number;
            };
            freshness: components["schemas"]["Freshness"];
        };
        /** MailCapability */
        MailCapability: {
            draft: boolean;
            read: boolean;
            send: boolean;
            sources: string[];
        };
        /** MailChangeRequest */
        MailChangeRequest: {
            destination?: string;
            /** @enum {unknown} */
            kind: "move" | "flag";
            mailbox: string;
            uid: string;
            uidValidity: string;
        };
        /** MailCheckResponse */
        MailCheckResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: {
                folders?: {
                    id: string;
                    name: string;
                    role: string | null;
                }[];
                ok: boolean;
            };
            freshness: components["schemas"]["Freshness"];
        };
        /** MailDraftRequest */
        MailDraftRequest: {
            attachments?: {
                data: string;
                filename: string;
            }[];
            body?: string;
            /** Format: email */
            from?: string;
            inReplyTo?: string;
            references?: string;
            subject?: string;
            to?: string[];
        };
        /** MailDraftResponse */
        MailDraftResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: {
                alreadyPresent: boolean;
                messageId: string;
                /** @constant */
                state: "drafted";
            };
            freshness: components["schemas"]["Freshness"];
        };
        /** MailEnvelopesResponse */
        MailEnvelopesResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: {
                items: {
                    date: string;
                    flags: string[];
                    from: string;
                    id: string;
                    subject: string;
                }[];
                mailbox: string;
                page: number;
                uidValidity: string | null;
            };
            freshness: components["schemas"]["Freshness"];
        };
        /** MailFolderResponse */
        MailFolderResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: {
                folders: {
                    id: string;
                    name: string;
                    role: string | null;
                }[];
            };
            freshness: components["schemas"]["Freshness"];
        };
        /** MailMessageResponse */
        MailMessageResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: {
                attachments: {
                    contentType: string;
                    filename: string;
                    size: number;
                }[];
                bodyText: string;
                date: string;
                from: string;
                mailbox: string;
                messageId: string;
                references: string;
                replyTo: string;
                subject: string;
                to: string;
                uid: string;
                uidValidity: string | null;
            };
            freshness: components["schemas"]["Freshness"];
        };
        /** MailOAuthPoll */
        MailOAuthPoll: {
            flowId: string;
        };
        /** MailOAuthResultResponse */
        MailOAuthResultResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: {
                accountId: string;
                authorized: boolean;
                pending: boolean;
            };
            freshness: components["schemas"]["Freshness"];
        };
        /** MailOAuthStartResponse */
        MailOAuthStartResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: {
                authorizationUrl: string | null;
                expiresAt: string;
                flowId: string;
                userCode: string | null;
                verificationUri: string | null;
            };
            freshness: components["schemas"]["Freshness"];
        };
        /** MailReceipt */
        MailReceipt: {
            accountId: string;
            archivePending: boolean;
            /** Format: date-time */
            createdAt: string;
            receiptId: string;
            /** @enum {unknown} */
            state: "pending" | "sent" | "uncertain";
        };
        /** MailReceiptResponse */
        MailReceiptResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["MailReceipt"];
            freshness: components["schemas"]["Freshness"];
        };
        /** MailReceiptsResponse */
        MailReceiptsResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: {
                items: components["schemas"]["MailReceipt"][];
            };
            freshness: components["schemas"]["Freshness"];
        };
        /** MailResultResponse */
        MailResultResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: {
                changed?: boolean;
                defaultAccountId?: string;
                deleted?: boolean;
                revision?: number;
            };
            freshness: components["schemas"]["Freshness"];
        };
        /** MailSendRequest */
        MailSendRequest: {
            attachments?: {
                data: string;
                filename: string;
            }[];
            body: string;
            /** Format: email */
            from?: string;
            inReplyTo?: string;
            references?: string;
            subject: string;
            to: string[];
        };
        /** MailSendResponse */
        MailSendResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: {
                archivePending: boolean;
                /** @enum {unknown} */
                memoryCapture: "written" | "pending" | "skipped" | "error";
                receiptId: string;
                replayed: boolean;
                /** @enum {unknown} */
                state: "sent" | "uncertain";
            };
            freshness: components["schemas"]["Freshness"];
        };
        /**
         * Memory
         * @description Stored knowledge item (PLAN §30). Nothing is hidden: provenance, usage and history are visible.
         */
        Memory: {
            confidence: number;
            /** Format: date-time */
            confirmedAt: string | null;
            conflicts: components["schemas"]["MemoryConflict"][];
            content: string;
            /** Format: date-time */
            createdAt: string;
            entities: components["schemas"]["MemoryEntity"][];
            /** Format: date-time */
            expiresAt: string | null;
            history: components["schemas"]["MemoryHistoryEntry"][];
            id: string;
            labels?: string[];
            /** Format: date-time */
            lastUsedAt: string | null;
            locked: boolean;
            pinned: boolean;
            provenance: components["schemas"]["MemoryProvenance"];
            sensitivity: components["schemas"]["MemorySensitivity"];
            source: components["schemas"]["SourceDescriptor"];
            tags: string[];
            title?: string;
            ttlSeconds?: number | null;
            type: components["schemas"]["MemoryType"];
            /** Format: date-time */
            updatedAt: string;
            usageCount: number;
            /** @description Monotonic revision used for optimistic concurrency (If-Match). */
            version: number;
        };
        /** MemoryCapability */
        MemoryCapability: {
            delete: boolean;
            /** @description Export the memory store as JSON. */
            export?: boolean;
            lock: boolean;
            read: boolean;
            /** @description Resolve memory conflicts. */
            resolveConflict?: boolean;
            search: boolean;
            sources: string[];
            write: boolean;
        };
        /** MemoryConflict */
        MemoryConflict: {
            /** Format: date-time */
            detectedAt: string;
            memoryId: string;
            reason: string;
            /** @enum {string} */
            resolution: "pending" | "keep_both" | "replaced" | "dismissed";
        };
        /**
         * MemoryConflictResolveRequest
         * @description Resolution of one memory conflict (PLAN §30.3). The conflict is addressed by the id of the conflicting memory (MemoryConflict.memoryId). keep_both keeps both entries, replace lets the addressed memory replace the conflicting one (the conflicting entry is forgotten, locked entries refuse with 409), dismiss marks the hint as irrelevant.
         */
        MemoryConflictResolveRequest: {
            /** @description Optional reason that is stored in the memory history. */
            note?: string;
            /** @enum {string} */
            resolution: "keep_both" | "replace" | "dismiss";
        };
        /** MemoryCreateRequest */
        MemoryCreateRequest: {
            confidence?: number;
            content: string;
            entities?: components["schemas"]["MemoryEntity"][];
            /** Format: date-time */
            expiresAt?: string | null;
            pinned?: boolean;
            sensitivity?: components["schemas"]["MemorySensitivity"];
            tags?: string[];
            title?: string;
            type: components["schemas"]["MemoryType"];
        };
        /** MemoryEntity */
        MemoryEntity: {
            id: string;
            /** @enum {string} */
            kind: "person" | "company" | "project" | "place" | "other";
            label: string;
        };
        /**
         * MemoryExport
         * @description JSON export of the memory store (PLAN §30.3). Never contains secrets: restricted memories are omitted and only counted.
         */
        MemoryExport: {
            contractVersion: components["schemas"]["ContractVersion"];
            /** @description Number of exported memories (items.length). */
            count: number;
            /** Format: date-time */
            exportedAt: string;
            items: components["schemas"]["Memory"][];
            /** @description Memories with sensitivity restricted that were left out. */
            omittedRestricted: number;
        };
        /** MemoryHistoryEntry */
        MemoryHistoryEntry: {
            actor: components["schemas"]["Actor"];
            after: string | null;
            before: string | null;
            /** @enum {string} */
            change: "created" | "updated" | "confirmed" | "locked" | "unlocked" | "pinned" | "deleted" | "expired";
            /** Format: date-time */
            changedAt: string;
            summary: string;
            version: number;
        };
        /**
         * MemoryListResponse
         * @description Cursor-paginated list envelope for Memory.
         */
        MemoryListResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            freshness: components["schemas"]["Freshness"];
            items: components["schemas"]["Memory"][];
            pageInfo: components["schemas"]["PageInfo"];
            sources: components["schemas"]["SourceDescriptor"][];
        };
        /** MemoryProvenance */
        MemoryProvenance: {
            description?: string;
            /** @enum {string} */
            kind: "conversation" | "import" | "manual" | "inference" | "sync";
            referenceId?: string;
        };
        /**
         * MemoryResponse
         * @description Single-resource envelope for Memory.
         */
        MemoryResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["Memory"];
            freshness: components["schemas"]["Freshness"];
        };
        /** MemorySearchHit */
        MemorySearchHit: {
            highlights?: string[];
            memory: components["schemas"]["Memory"];
            score: number;
        };
        /** MemorySearchRequest */
        MemorySearchRequest: {
            includeExpired?: boolean;
            limit?: number;
            minConfidence?: number;
            query: string;
            semantic?: boolean;
            sensitivity?: components["schemas"]["MemorySensitivity"][];
            tags?: string[];
            types?: components["schemas"]["MemoryType"][];
        };
        /** MemorySearchResponse */
        MemorySearchResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            freshness: components["schemas"]["Freshness"];
            items: components["schemas"]["MemorySearchHit"][];
            sources: components["schemas"]["SourceDescriptor"][];
        };
        /**
         * MemorySensitivity
         * @enum {string}
         */
        MemorySensitivity: "normal" | "sensitive" | "restricted";
        /**
         * MemoryType
         * @enum {string}
         */
        MemoryType: "profile" | "preference" | "fact" | "person" | "company" | "project" | "relationship" | "instruction" | "episode" | "decision";
        /** MemoryUpdateRequest */
        MemoryUpdateRequest: {
            confidence?: number;
            /** @description Marks the memory as confirmed now. */
            confirm?: boolean;
            content?: string;
            entities?: components["schemas"]["MemoryEntity"][];
            /** Format: date-time */
            expiresAt?: string | null;
            locked?: boolean;
            pinned?: boolean;
            sensitivity?: components["schemas"]["MemorySensitivity"];
            tags?: string[];
            title?: string;
            type?: components["schemas"]["MemoryType"];
        };
        /** Message */
        Message: {
            aiSummary: string | null;
            attachments: components["schemas"]["Attachment"][];
            bodyText: string;
            cc?: components["schemas"]["Participant"][];
            /** Format: date-time */
            createdAt: string;
            /** @enum {string} */
            direction: "inbound" | "outbound";
            from: components["schemas"]["Participant"];
            id: string;
            labels?: string[];
            /** @description Opaque reference to the original in the source system. */
            originalRef?: string;
            /** Format: date-time */
            sentAt: string;
            source: components["schemas"]["SourceDescriptor"];
            threadId: string;
            to: components["schemas"]["Participant"][];
            /** Format: date-time */
            updatedAt: string;
            /** @description Monotonic revision used for optimistic concurrency (If-Match). */
            version: number;
        };
        /**
         * MessageListResponse
         * @description Cursor-paginated list envelope for Message.
         */
        MessageListResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            freshness: components["schemas"]["Freshness"];
            items: components["schemas"]["Message"][];
            pageInfo: components["schemas"]["PageInfo"];
            sources: components["schemas"]["SourceDescriptor"][];
        };
        /**
         * MessageResponse
         * @description Single-resource envelope for Message.
         */
        MessageResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["Message"];
            freshness: components["schemas"]["Freshness"];
        };
        /** MessengerReceipt */
        "messenger-receipt.schema": {
            accountId: string;
            /** Format: date-time */
            createdAt: string;
            externalId: string | null;
            /** @enum {unknown} */
            memoryCapture?: "written" | "pending" | "skipped" | "error";
            platform: string;
            receiptId: string;
            recipient: string;
            replayed: boolean;
            /** @enum {unknown} */
            state: "pending" | "sent" | "uncertain";
        };
        /** MessengerTarget */
        "messenger-target.schema": {
            /** @constant */
            accountId: "default";
            /** Format: date-time */
            createdAt: string;
            id: string;
            platform: string;
            recipient: string;
        };
        /** MessengerCatalogResponse */
        MessengerCatalogResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: {
                items: {
                    configured: boolean;
                    /** @enum {unknown} */
                    connectionState: "connected" | "disconnected" | "unknown";
                    exactSendSupported: boolean;
                    fields: {
                        name: string;
                        present: boolean;
                        required: boolean;
                        secret: boolean;
                    }[];
                    gatewayRunning: boolean;
                    nativeSetupAvailable: boolean;
                    platform: string;
                    /** @enum {unknown} */
                    source: "builtin" | "bundled_plugin";
                }[];
                /** @constant */
                pin: "d923a5eb";
            };
            freshness: components["schemas"]["Freshness"];
        };
        /** MessengerConfirmRequest */
        MessengerConfirmRequest: {
            draft: components["schemas"]["MessengerDraft"];
            token: string;
        };
        /** MessengerDraft */
        MessengerDraft: {
            /** @constant */
            accountId: "default";
            notificationId?: string;
            notificationStep?: number;
            /** @enum {unknown} */
            platform: "telegram" | "discord" | "whatsapp" | "slack" | "signal" | "matrix" | "mattermost" | "sms" | "irc" | "line" | "feishu" | "wecom" | "photon" | "buzz" | "ntfy" | "teams" | "google_chat" | "simplex" | "weixin" | "bluebubbles" | "dingtalk" | "whatsapp_cloud" | "qqbot" | "yuanbao";
            recipient: string;
            text: string;
        };
        /** MessengerInboundEvent */
        MessengerInboundEvent: {
            accountEpoch: string;
            /** @constant */
            accountId: "default";
            actionId?: string;
            admissionEventId?: string;
            chatId: string;
            chatType: string;
            /** @enum {unknown} */
            eventType?: "assistant_response" | "action_result";
            messageId: string;
            /** @enum {unknown} */
            outcome?: "completed" | "aborted" | "uncertain";
            /** @enum {unknown} */
            platform: "telegram" | "discord" | "whatsapp" | "whatsapp_cloud" | "slack" | "signal" | "mattermost" | "matrix" | "sms" | "dingtalk" | "feishu" | "wecom" | "weixin" | "bluebubbles" | "qqbot" | "yuanbao" | "teams" | "buzz" | "google_chat" | "irc" | "line" | "ntfy" | "photon" | "simplex";
            senderId: string;
            /** @enum {unknown} */
            suppressionReason?: "private" | "policy_disabled" | "not_private_dm" | "unsupported_profile" | "multi_profile_unknown" | "account_changed";
            text: string;
            turnId?: string;
        };
        /** MessengerInboundResponse */
        MessengerInboundResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: {
                context?: {
                    occurredAt: string;
                    source: string;
                    text: string;
                }[];
                eventId: string | null;
                /** @enum {unknown} */
                reason: "captured" | "pending" | "unlinked" | "policy_disabled" | "private" | "not_private_dm" | "unsupported_profile" | "multi_profile_unknown" | "account_changed" | "invalid";
            };
            freshness: components["schemas"]["Freshness"];
        };
        /** MessengerPreviewResponse */
        MessengerPreviewResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: {
                draft: components["schemas"]["MessengerDraft"];
                /** Format: date-time */
                expiresAt: string;
                fingerprint: string;
                idempotencyKey?: string;
                token: string;
            };
            freshness: components["schemas"]["Freshness"];
        };
        /** MessengerProviderApply */
        MessengerProviderApply: {
            revision: string;
        };
        /** MessengerProviderResponse */
        MessengerProviderResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: {
                /** @enum {unknown} */
                connectionState?: "connected" | "disconnected" | "unknown";
                gatewayRestarted?: boolean;
                platform: string;
                revision: string;
                /** @enum {unknown} */
                state: "available" | "saved" | "partial" | "uncertain" | "applied";
            };
            freshness: components["schemas"]["Freshness"];
        };
        /** MessengerProviderUpdate */
        MessengerProviderUpdate: {
            /** @constant */
            platform: "bluebubbles";
            revision: string;
            values: {
                BLUEBUBBLES_PASSWORD?: string | null;
                BLUEBUBBLES_SERVER_URL?: string | null;
            };
        } | {
            /** @constant */
            platform: "buzz";
            revision: string;
            values: {
                BUZZ_ALLOWED_USERS?: string | null;
                BUZZ_AUTH_TAG?: string | null;
                BUZZ_CHANNELS?: string | null;
                BUZZ_HOME_CHANNEL?: string | null;
                BUZZ_POLL_INTERVAL?: string | null;
                BUZZ_PRIVATE_KEY?: string | null;
                BUZZ_RELAY_URL?: string | null;
                BUZZ_REPLY_IN_THREAD?: string | null;
                BUZZ_TRANSPORT?: string | null;
            };
        } | {
            /** @constant */
            platform: "dingtalk";
            revision: string;
            values: {
                DINGTALK_ALLOWED_USERS?: string | null;
                DINGTALK_CLIENT_ID?: string | null;
                DINGTALK_CLIENT_SECRET?: string | null;
                DINGTALK_HOME_CHANNEL?: string | null;
                DINGTALK_HOME_CHANNEL_NAME?: string | null;
                DINGTALK_WEBHOOK_URL?: string | null;
            };
        } | {
            /** @constant */
            platform: "feishu";
            revision: string;
            values: {
                FEISHU_ALLOWED_USERS?: string | null;
                FEISHU_APP_ID?: string | null;
                FEISHU_APP_SECRET?: string | null;
                FEISHU_DOMAIN?: string | null;
                FEISHU_HOME_CHANNEL?: string | null;
                FEISHU_HOME_CHANNEL_NAME?: string | null;
            };
        } | {
            /** @constant */
            platform: "google_chat";
            revision: string;
            values: {
                GOOGLE_CHAT_ALLOWED_USERS?: string | null;
                GOOGLE_CHAT_HOME_CHANNEL?: string | null;
                GOOGLE_CHAT_HTTP_EVENTS_AUDIENCE?: string | null;
                GOOGLE_CHAT_HTTP_EVENTS_SERVICE_ACCOUNT_EMAIL?: string | null;
                GOOGLE_CHAT_HTTP_EVENTS_URL?: string | null;
                GOOGLE_CHAT_PROJECT_ID?: string | null;
                GOOGLE_CHAT_SERVICE_ACCOUNT_JSON?: string | null;
                GOOGLE_CHAT_SUBSCRIPTION_NAME?: string | null;
            };
        } | {
            /** @constant */
            platform: "irc";
            revision: string;
            values: {
                IRC_ALLOWED_USERS?: string | null;
                IRC_CHANNEL?: string | null;
                IRC_HOME_CHANNEL?: string | null;
                IRC_NICKNAME?: string | null;
                IRC_NICKSERV_PASSWORD?: string | null;
                IRC_PORT?: string | null;
                IRC_SERVER?: string | null;
                IRC_SERVER_PASSWORD?: string | null;
                IRC_USE_TLS?: string | null;
            };
        } | {
            /** @constant */
            platform: "line";
            revision: string;
            values: {
                LINE_ALLOWED_GROUPS?: string | null;
                LINE_ALLOWED_ROOMS?: string | null;
                LINE_ALLOWED_USERS?: string | null;
                LINE_CHANNEL_ACCESS_TOKEN?: string | null;
                LINE_CHANNEL_SECRET?: string | null;
                LINE_HOME_CHANNEL?: string | null;
                LINE_HOST?: string | null;
                LINE_PORT?: string | null;
                LINE_PUBLIC_URL?: string | null;
                LINE_SLOW_RESPONSE_THRESHOLD?: string | null;
            };
        } | {
            /** @constant */
            platform: "matrix";
            revision: string;
            values: {
                MATRIX_ACCESS_TOKEN?: string | null;
                MATRIX_ALLOWED_USERS?: string | null;
                MATRIX_HOME_CHANNEL?: string | null;
                MATRIX_HOME_CHANNEL_NAME?: string | null;
                MATRIX_HOMESERVER?: string | null;
                MATRIX_PASSWORD?: string | null;
            };
        } | {
            /** @constant */
            platform: "mattermost";
            revision: string;
            values: {
                MATTERMOST_ALLOWED_CHANNELS?: string | null;
                MATTERMOST_ALLOWED_USERS?: string | null;
                MATTERMOST_FREE_RESPONSE_CHANNELS?: string | null;
                MATTERMOST_HOME_CHANNEL?: string | null;
                MATTERMOST_REPLY_MODE?: string | null;
                MATTERMOST_REQUIRE_MENTION?: string | null;
                MATTERMOST_TOKEN?: string | null;
                MATTERMOST_URL?: string | null;
            };
        } | {
            /** @constant */
            platform: "ntfy";
            revision: string;
            values: {
                NTFY_ALLOWED_USERS?: string | null;
                NTFY_HOME_CHANNEL?: string | null;
                NTFY_HOME_CHANNEL_NAME?: string | null;
                NTFY_MARKDOWN?: string | null;
                NTFY_PUBLISH_TOPIC?: string | null;
                NTFY_SERVER_URL?: string | null;
                NTFY_TOKEN?: string | null;
                NTFY_TOPIC?: string | null;
            };
        } | {
            /** @constant */
            platform: "photon";
            revision: string;
            values: {
                PHOTON_ALLOWED_USERS?: string | null;
                PHOTON_DASHBOARD_HOST?: string | null;
                PHOTON_HOME_CHANNEL?: string | null;
                PHOTON_HOME_CHANNEL_NAME?: string | null;
                PHOTON_MARKDOWN?: string | null;
                PHOTON_MENTION_PATTERNS?: string | null;
                PHOTON_NODE_BIN?: string | null;
                PHOTON_PROJECT_ID?: string | null;
                PHOTON_PROJECT_SECRET?: string | null;
                PHOTON_REACTIONS?: string | null;
                PHOTON_READ_RECEIPTS?: string | null;
                PHOTON_REQUIRE_MENTION?: string | null;
                PHOTON_SIDECAR_AUTOSTART?: string | null;
                PHOTON_SIDECAR_PORT?: string | null;
                PHOTON_SIDECAR_TOKEN?: string | null;
                PHOTON_SPECTRUM_HOST?: string | null;
                PHOTON_TELEMETRY?: string | null;
            };
        } | {
            /** @constant */
            platform: "qqbot";
            revision: string;
            values: {
                QQ_APP_ID?: string | null;
                QQ_CLIENT_SECRET?: string | null;
            };
        } | {
            /** @constant */
            platform: "signal";
            revision: string;
            values: {
                SIGNAL_ACCOUNT?: string | null;
                SIGNAL_HTTP_URL?: string | null;
            };
        } | {
            /** @constant */
            platform: "simplex";
            revision: string;
            values: {
                SIMPLEX_ALLOWED_USERS?: string | null;
                SIMPLEX_AUTO_ACCEPT?: string | null;
                SIMPLEX_GROUP_ALLOWED?: string | null;
                SIMPLEX_HOME_CHANNEL?: string | null;
                SIMPLEX_HOME_CHANNEL_NAME?: string | null;
                SIMPLEX_WS_URL?: string | null;
            };
        } | {
            /** @constant */
            platform: "slack";
            revision: string;
            values: {
                SLACK_ALLOWED_USERS?: string | null;
                SLACK_APP_TOKEN?: string | null;
                SLACK_BOT_TOKEN?: string | null;
                SLACK_HOME_CHANNEL?: string | null;
                SLACK_HOME_CHANNEL_NAME?: string | null;
                SLACK_THREAD_REQUIRE_MENTION?: string | null;
            };
        } | {
            /** @constant */
            platform: "sms";
            revision: string;
            values: {
                SMS_ALLOWED_USERS?: string | null;
                SMS_HOME_CHANNEL?: string | null;
                TWILIO_ACCOUNT_SID?: string | null;
                TWILIO_AUTH_TOKEN?: string | null;
                TWILIO_PHONE_NUMBER?: string | null;
            };
        } | {
            /** @constant */
            platform: "teams";
            revision: string;
            values: {
                TEAMS_ALLOWED_USERS?: string | null;
                TEAMS_CLIENT_ID?: string | null;
                TEAMS_CLIENT_SECRET?: string | null;
                TEAMS_GRAPH_ACCESS_TOKEN?: string | null;
                TEAMS_HOME_CHANNEL?: string | null;
                TEAMS_HOME_CHANNEL_NAME?: string | null;
                TEAMS_HOST?: string | null;
                TEAMS_INCOMING_WEBHOOK_URL?: string | null;
                TEAMS_PORT?: string | null;
                TEAMS_REQUIRE_MENTION?: string | null;
                TEAMS_TENANT_ID?: string | null;
            };
        } | {
            /** @constant */
            platform: "wecom";
            revision: string;
            values: {
                WECOM_ALLOWED_USERS?: string | null;
                WECOM_BOT_ID?: string | null;
                WECOM_CALLBACK_AGENT_ID?: string | null;
                WECOM_CALLBACK_CORP_ID?: string | null;
                WECOM_CALLBACK_CORP_SECRET?: string | null;
                WECOM_CALLBACK_ENCODING_AES_KEY?: string | null;
                WECOM_CALLBACK_TOKEN?: string | null;
                WECOM_HOME_CHANNEL?: string | null;
                WECOM_SECRET?: string | null;
                WECOM_WEBSOCKET_URL?: string | null;
            };
        } | {
            /** @constant */
            platform: "weixin";
            revision: string;
            values: {
                WEIXIN_ACCOUNT_ID?: string | null;
                WEIXIN_TOKEN?: string | null;
            };
        } | {
            /** @constant */
            platform: "whatsapp_cloud";
            revision: string;
            values: {
                WHATSAPP_CLOUD_ACCESS_TOKEN?: string | null;
                WHATSAPP_CLOUD_PHONE_NUMBER_ID?: string | null;
            };
        } | {
            /** @constant */
            platform: "yuanbao";
            revision: string;
            values: {
                YUANBAO_APP_ID?: string | null;
                YUANBAO_APP_SECRET?: string | null;
            };
        };
        /** MessengerReceiptResponse */
        MessengerReceiptResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["messenger-receipt.schema"];
            freshness: components["schemas"]["Freshness"];
        };
        /** MessengerReceiptsResponse */
        MessengerReceiptsResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: {
                items: components["schemas"]["messenger-receipt.schema"][];
            };
            freshness: components["schemas"]["Freshness"];
        };
        /** MessengerSender */
        MessengerSender: {
            /** @constant */
            accountId: "default";
            chatId: string;
            id: string;
            /** Format: date-time */
            lastSeenAt: string;
            linked: boolean;
            platform: string;
            senderId: string;
        };
        /** MessengerSenderResponse */
        MessengerSenderResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["MessengerSender"];
            freshness: components["schemas"]["Freshness"];
        };
        /** MessengerSendersResponse */
        MessengerSendersResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: {
                items: components["schemas"]["MessengerSender"][];
            };
            freshness: components["schemas"]["Freshness"];
        };
        /** MessengerTargetRequest */
        MessengerTargetRequest: {
            /** @constant */
            accountId: "default";
            /** @enum {unknown} */
            platform: "telegram" | "discord" | "whatsapp" | "slack" | "signal" | "matrix" | "mattermost" | "sms" | "irc" | "line" | "feishu" | "wecom" | "photon" | "buzz" | "ntfy" | "teams" | "google_chat" | "simplex" | "weixin" | "bluebubbles" | "dingtalk" | "whatsapp_cloud" | "qqbot" | "yuanbao";
            recipient: string;
        };
        /** MessengerTargetResponse */
        MessengerTargetResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["messenger-target.schema"];
            freshness: components["schemas"]["Freshness"];
        };
        /** MessengerTargetsResponse */
        MessengerTargetsResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: {
                items: components["schemas"]["messenger-target.schema"][];
            };
            freshness: components["schemas"]["Freshness"];
        };
        /**
         * Meta
         * @description Bootstrap document: tells the client how to reach the event stream and which mode the server runs in.
         */
        Meta: {
            apiVersion: string;
            buildVersion: string;
            contractVersion: components["schemas"]["ContractVersion"];
            /** @enum {string} */
            dataMode: "mock" | "hybrid" | "live";
            /** @enum {string} */
            defaultLocale?: "de" | "en";
            /**
             * Format: uri
             * @description Overrides the origin of the WebSocket (dev setups).
             */
            eventsOrigin?: string;
            /** @description WebSocket path, relative to the API origin. */
            eventsPath: string;
            /** @description Boolean feature flags, e.g. devScenarios. */
            features: {
                [key: string]: boolean;
            };
            /** Format: date-time */
            serverTime?: string;
        };
        /**
         * ModelProvider
         * @description LLM provider shown under Models & Services.
         */
        ModelProvider: {
            activeRequests: number;
            contextWindow?: number;
            /** Format: date-time */
            createdAt: string;
            id: string;
            labels?: string[];
            latencyMs: number | null;
            models: string[];
            name: string;
            /** @enum {string} */
            providerKind: "local" | "cloud";
            source: components["schemas"]["SourceDescriptor"];
            status: components["schemas"]["HealthStatus"];
            /** Format: date-time */
            updatedAt: string;
            /** @description Monotonic revision used for optimistic concurrency (If-Match). */
            version: number;
        };
        /**
         * ModelProviderListResponse
         * @description Cursor-paginated list envelope for ModelProvider.
         */
        ModelProviderListResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            freshness: components["schemas"]["Freshness"];
            items: components["schemas"]["ModelProvider"][];
            pageInfo: components["schemas"]["PageInfo"];
            sources: components["schemas"]["SourceDescriptor"][];
        };
        /** ModelsRoutingSettings */
        ModelsRoutingSettings: {
            defaultModel: string;
            localFirst: boolean;
            monthlyBudgetEur: number | null;
            routes: {
                fallbackModel: string | null;
                model: string;
                reasoningLevel: components["schemas"]["ReasoningLevel"];
                taskKind: string;
            }[];
        };
        /** NavigationSettings */
        NavigationSettings: {
            defaultPage: string;
            hidden: string[];
            /** @enum {string} */
            mode: "compact" | "expanded";
            order: string[];
        };
        /**
         * Notification
         * @description Alert with escalation chain (PLAN §39).
         */
        Notification: {
            acknowledged: boolean;
            /** Format: date-time */
            acknowledgedAt?: string | null;
            body: string;
            /** @enum {string} */
            category: "system" | "task" | "approval" | "mail" | "calendar" | "automation" | "security" | "voice" | "adapter";
            /** Format: date-time */
            createdAt: string;
            escalation: {
                /** Format: date-time */
                acknowledgedAt: string | null;
                /** @enum {string} */
                channel: "dashboard" | "telegram" | "whatsapp" | "sms" | "phone" | "email";
                /** Format: date-time */
                scheduledAt: string;
                /** Format: date-time */
                sentAt: string | null;
                /** @enum {string} */
                state: "pending" | "awaiting_approval" | "sent" | "uncertain" | "acknowledged" | "failed" | "skipped";
                step: number;
                /** @default true */
                stopOnAcknowledge: boolean;
            }[];
            id: string;
            labels?: string[];
            priority: components["schemas"]["Priority"];
            resolved: boolean;
            /** Format: date-time */
            resolvedAt?: string | null;
            /** Format: date-time */
            snoozedUntil: string | null;
            source: components["schemas"]["SourceDescriptor"];
            sourceRef: components["schemas"]["EntityRef"] | null;
            /** @enum {string} */
            status: "open" | "acknowledged" | "snoozed" | "resolved";
            /** @description Dashboard route for "Open source", e.g. /approvals?approval=appr_... */
            targetRoute: string | null;
            title: string;
            /** Format: date-time */
            updatedAt: string;
            /** @description Monotonic revision used for optimistic concurrency (If-Match). */
            version: number;
        };
        /** NotificationActionRequest */
        NotificationActionRequest: {
            comment?: string;
        };
        /**
         * NotificationListResponse
         * @description Cursor-paginated list envelope for Notification.
         */
        NotificationListResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            freshness: components["schemas"]["Freshness"];
            items: components["schemas"]["Notification"][];
            pageInfo: components["schemas"]["PageInfo"];
            sources: components["schemas"]["SourceDescriptor"][];
        };
        /**
         * NotificationResponse
         * @description Single-resource envelope for Notification.
         */
        NotificationResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["Notification"];
            freshness: components["schemas"]["Freshness"];
        };
        /** NotificationsCapability */
        NotificationsCapability: {
            acknowledge: boolean;
            read: boolean;
            resolve: boolean;
            snooze: boolean;
            sources: string[];
        };
        /** NotificationSettings */
        NotificationSettings: {
            channels: {
                /** @description Configured provider account used for owner-reviewed sends. */
                accountId?: string;
                enabled: boolean;
                /** @enum {string} */
                kind: "dashboard" | "telegram" | "whatsapp" | "sms" | "phone" | "email";
                minPriority: components["schemas"]["Priority"];
                /** @description Exact owner-approved destination. Empty means external delivery is not configured. */
                recipient?: string;
            }[];
            defaultEscalation: components["schemas"]["EscalationStep"][];
            quietHours: {
                enabled: boolean;
                from: string;
                to: string;
            };
            snoozeDefaultMinutes: number;
        };
        /** NotificationSnoozeRequest */
        NotificationSnoozeRequest: {
            durationMinutes?: number;
            /** Format: date-time */
            until?: string;
        };
        /** ObsidianVault */
        ObsidianVault: {
            applied: boolean;
            configured: boolean;
            path: string;
            readable: boolean;
            revision: number;
        };
        /** ObsidianVaultPatch */
        ObsidianVaultPatch: {
            path: string;
        };
        /** ObsidianVaultResponse */
        ObsidianVaultResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["ObsidianVault"];
            freshness: components["schemas"]["Freshness"];
        };
        /** OnboardingResponse */
        OnboardingResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["OnboardingState"];
            freshness: components["schemas"]["Freshness"];
        };
        /** OnboardingState */
        OnboardingState: {
            /** Format: date-time */
            completedAt: string | null;
            goals: string[];
            preferredName?: string;
            revision: number;
            selectedSkillIds: string[];
            steps: {
                /** @enum {unknown} */
                accounts: "pending" | "completed" | "skipped";
                /** @enum {unknown} */
                finish: "pending" | "completed" | "skipped";
                /** @enum {unknown} */
                intro: "pending" | "completed" | "skipped";
                /** @enum {unknown} */
                profile: "pending" | "completed" | "skipped";
                /** @enum {unknown} */
                skills: "pending" | "completed" | "skipped";
            };
            /** Format: date-time */
            updatedAt: string | null;
        };
        /** OnboardingUpdate */
        OnboardingUpdate: {
            goals: string[];
            preferredName?: string;
            selectedSkillIds: string[];
            steps: {
                /** @enum {unknown} */
                accounts: "pending" | "completed" | "skipped";
                /** @enum {unknown} */
                finish: "pending" | "completed" | "skipped";
                /** @enum {unknown} */
                intro: "pending" | "completed" | "skipped";
                /** @enum {unknown} */
                profile: "pending" | "completed" | "skipped";
                /** @enum {unknown} */
                skills: "pending" | "completed" | "skipped";
            };
        };
        /**
         * OrbHealth
         * @enum {string}
         */
        OrbHealth: "online" | "degraded" | "offline";
        /**
         * OrbLayers
         * @description Parallel activity layers (PLAN §18.2): the orb can speak while agents work and health is shown on the telemetry ring.
         */
        OrbLayers: {
            activeAgentIds: string[];
            /** @enum {string} */
            attention: "none" | "waiting_approval" | "success" | "warning" | "error";
            health: components["schemas"]["OrbHealth"];
            /** @enum {string} */
            voice: "idle" | "listening" | "transcribing" | "speaking";
            /** @enum {string} */
            work: "idle" | "thinking" | "working" | "syncing" | "paused";
        };
        /**
         * OrbMode
         * @enum {string}
         */
        OrbMode: "booting" | "idle" | "listening" | "transcribing" | "thinking" | "syncing" | "working" | "speaking" | "waiting_approval" | "success" | "warning" | "error" | "offline" | "paused";
        /**
         * OrbPerformanceSample
         * @description One orb render performance sample of the browser (PLAN §50.3): frames per second, frame time and WebGL memory.
         */
        OrbPerformanceSample: {
            fps: number;
            /** @description Mean frame time of the sampling window. */
            frameTimeMs: number;
            /** Format: date-time */
            occurredAt?: string;
            /** @description Estimated GPU memory held by the orb scene (textures plus geometries). */
            webglMemoryBytes?: number;
        };
        /**
         * OrbProgressMode
         * @enum {string}
         */
        OrbProgressMode: "determinate" | "indeterminate" | "none";
        /**
         * OrbSettings
         * @description User-tunable orb behaviour (PLAN §23.2, §42.3). Never contains shader parameters of the backend.
         */
        OrbSettings: {
            /** @enum {string} */
            animations: "full" | "reduced" | "off";
            audioReactive: boolean;
            bloom: boolean;
            intensity: number;
            mouseParallax: boolean;
            particleDensity: number;
            preset: string;
            /** @enum {string} */
            quality: "auto" | "low" | "medium" | "high" | "ultra";
            /** @enum {string} */
            renderMode: "auto" | "2d" | "3d";
            size: number;
            speed: number;
            /** @description Secondary accent color per orb mode; the gold core is invariant. */
            statusColors: {
                [key: string]: string;
            };
        };
        /**
         * OrbSnapshot
         * @description Dominant orb status plus the parallel layers. Payload of GET /orb/status and friday.orb.status_changed.
         */
        OrbSnapshot: {
            layers: components["schemas"]["OrbLayers"];
            status: components["schemas"]["OrbStatus"];
        };
        /**
         * OrbSnapshotResponse
         * @description Single-resource envelope for OrbSnapshot.
         */
        OrbSnapshotResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["OrbSnapshot"];
            freshness: components["schemas"]["Freshness"];
        };
        /**
         * OrbStatus
         * @description Semantic orb state (PLAN §17). Backends emit semantics only, never shader parameters.
         */
        OrbStatus: {
            activeAgentCount?: number;
            activityText?: string;
            approvalId?: string;
            audioLevel?: number;
            currentAgentId?: string;
            /** @description Display name of the agent behind currentAgentId (optional; absent when unknown). */
            currentAgentName?: string;
            detailText?: string;
            health?: components["schemas"]["OrbHealth"];
            mode: components["schemas"]["OrbMode"];
            progress?: number | null;
            progressMode?: components["schemas"]["OrbProgressMode"];
            /** Format: date-time */
            since: string;
            sourceEventId?: string;
            taskId?: string;
            urgency?: components["schemas"]["OrbUrgency"];
        };
        /**
         * OrbUrgency
         * @enum {string}
         */
        OrbUrgency: "none" | "info" | "warning" | "critical";
        /**
         * Overview
         * @description Aggregated home payload (PLAN §27.14). Sections of failed adapters are listed in degradedSections instead of failing the call.
         */
        Overview: {
            activeAgents: components["schemas"]["Agent"][];
            attention: components["schemas"]["AttentionItem"][];
            counters: {
                alerts: number;
                approvals: number;
                mail: number;
                tasks: number;
            };
            criticalAlerts: components["schemas"]["Notification"][];
            currentActivity: {
                agentId: string | null;
                /** Format: date-time */
                since: string;
                taskId: string | null;
                text: string;
            } | null;
            degradedSections: {
                adapterId: string;
                reason: string;
                section: string;
                status: components["schemas"]["HealthStatus"];
            }[];
            friday: components["schemas"]["FridayStatus"];
            importantMailCount: number;
            /** Format: date-time */
            lastUpdatedAt: string;
            memoryInsights: {
                /** Format: date-time */
                lastUpdatedAt: string | null;
                newToday: number;
                total: number;
            } | null;
            models: components["schemas"]["ModelProvider"][];
            nextEvents: components["schemas"]["CalendarEvent"][];
            openApprovals: components["schemas"]["Approval"][];
            orb: components["schemas"]["OrbSnapshot"];
            quickCommands: components["schemas"]["QuickCommand"][];
            runningTasks: components["schemas"]["Task"][];
            systemSummary: {
                cpuPercent: number | null;
                gpuPercent: number | null;
                ramPercent: number | null;
                services: {
                    id: string;
                    name: string;
                    status: components["schemas"]["HealthStatus"];
                }[];
                storageUsedPercent: number | null;
                vramPercent: number | null;
            };
            voice: components["schemas"]["VoiceStatus"] | null;
        };
        /**
         * OverviewResponse
         * @description Single-resource envelope for Overview.
         */
        OverviewResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["Overview"];
            freshness: components["schemas"]["Freshness"];
        };
        /** PageInfo */
        PageInfo: {
            hasNextPage: boolean;
            nextCursor: string | null;
            totalCount?: number;
        };
        /** Participant */
        Participant: {
            address: string;
            name: string;
            role?: string;
        };
        /** PowerPointDeck */
        "powerpoint-deck.schema": {
            /** Format: date-time */
            createdAt: string;
            downloadUrl: string;
            /** Format: uuid */
            id: string;
            slideCount: number;
            title: string;
        };
        /** PowerPointDeckListResponse */
        PowerPointDeckListResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["powerpoint-deck.schema"][];
            freshness: components["schemas"]["Freshness"];
        };
        /** PowerPointDeckRequest */
        PowerPointDeckRequest: {
            slides: {
                bullets: string[];
                title: string;
            }[];
            title: string;
        };
        /** PowerPointDeckResponse */
        PowerPointDeckResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["powerpoint-deck.schema"];
            freshness: components["schemas"]["Freshness"];
        };
        prerequisite: {
            kind: string;
            notice: string;
            /** @enum {unknown} */
            status: "required" | "optional";
        };
        /**
         * Priority
         * @description P0 critical, P1 urgent, P2 important, P3 normal, P4 informational.
         * @enum {string}
         */
        Priority: "P0" | "P1" | "P2" | "P3" | "P4";
        /** ProfileSettings */
        ProfileSettings: {
            /** @description Visible brand name of the assistant (UI, orb labels, voice copy). Optional; clients fall back to "F.R.I.D.A.Y.". */
            assistantName?: string;
            /** @enum {string} */
            dateFormat: "dd.MM.yyyy" | "yyyy-MM-dd" | "MM/dd/yyyy";
            displayName: string;
            /** @enum {string} */
            firstDayOfWeek: "monday" | "sunday";
            /** @enum {string} */
            locale: "de" | "en";
            /** @enum {string} */
            timeFormat: "24h" | "12h";
            timeZone: string;
        };
        /**
         * Progress
         * @description Unknown progress is indeterminate; never fake a percentage. value is a fraction 0..1.
         */
        Progress: {
            /** @enum {string} */
            mode: "determinate" | "indeterminate" | "none";
            value: number | null;
        };
        /**
         * QuickCommand
         * @description Capability-aware quick action shown on the overview (PLAN §27.8).
         */
        QuickCommand: {
            commandText: string | null;
            disabledReason?: string;
            enabled: boolean;
            icon: string;
            id: string;
            label: string;
            /** @description Capability path such as tasks.create. */
            requiredCapability: string;
            requiresConfirmation: boolean;
            targetRoute: string | null;
        };
        /**
         * ReasoningLevel
         * @enum {string}
         */
        ReasoningLevel: "none" | "low" | "medium" | "high" | "max";
        /** ReauthRequest */
        ReauthRequest: {
            password: string;
        };
        /** ReauthResponse */
        ReauthResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            /** Format: date-time */
            expiresAt: string;
            reauthToken: string;
        };
        /**
         * RequiredAuth
         * @enum {string}
         */
        RequiredAuth: "none" | "confirm" | "reauth";
        /** ResearchArtifact */
        ResearchArtifact: {
            /** Format: date-time */
            createdAt: string;
            fileId: string | null;
            /** @enum {string} */
            format: "markdown" | "json" | "pdf" | "docx" | "pptx";
            id: string;
            labels?: string[];
            name: string;
            projectId: string;
            sizeBytes: number | null;
            source: components["schemas"]["SourceDescriptor"];
            /** Format: date-time */
            updatedAt: string;
            /** @description Monotonic revision used for optimistic concurrency (If-Match). */
            version: number;
        };
        /**
         * ResearchArtifactListResponse
         * @description Cursor-paginated list envelope for ResearchArtifact.
         */
        ResearchArtifactListResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            freshness: components["schemas"]["Freshness"];
            items: components["schemas"]["ResearchArtifact"][];
            pageInfo: components["schemas"]["PageInfo"];
            sources: components["schemas"]["SourceDescriptor"][];
        };
        /**
         * ResearchArtifactResponse
         * @description Single-resource envelope for ResearchArtifact.
         */
        ResearchArtifactResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["ResearchArtifact"];
            freshness: components["schemas"]["Freshness"];
        };
        /** ResearchCapability */
        ResearchCapability: {
            create: boolean;
            export: boolean;
            read: boolean;
            sources: string[];
        };
        /** ResearchCreateRequest */
        ResearchCreateRequest: {
            topic: string;
        };
        /**
         * ResearchFinding
         * @description A statement together with the sources that support it and known contradictions.
         */
        ResearchFinding: {
            confidence: number;
            contradictions: {
                description: string;
                findingId: string | null;
                sourceId: string | null;
            }[];
            /** Format: date-time */
            createdAt: string;
            id: string;
            labels?: string[];
            projectId: string;
            source: components["schemas"]["SourceDescriptor"];
            statement: string;
            /** @enum {string} */
            status: "draft" | "verified" | "disputed" | "rejected";
            supportingSourceIds: string[];
            /** Format: date-time */
            updatedAt: string;
            /** @description Monotonic revision used for optimistic concurrency (If-Match). */
            version: number;
        };
        /**
         * ResearchFindingListResponse
         * @description Cursor-paginated list envelope for ResearchFinding.
         */
        ResearchFindingListResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            freshness: components["schemas"]["Freshness"];
            items: components["schemas"]["ResearchFinding"][];
            pageInfo: components["schemas"]["PageInfo"];
            sources: components["schemas"]["SourceDescriptor"][];
        };
        /**
         * ResearchFindingResponse
         * @description Single-resource envelope for ResearchFinding.
         */
        ResearchFindingResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["ResearchFinding"];
            freshness: components["schemas"]["Freshness"];
        };
        /**
         * ResearchProject
         * @description Research mission with sources, findings and artifacts (PLAN §36).
         */
        ResearchProject: {
            agentIds: string[];
            artifactCount: number;
            contradictionCount: number;
            costEur?: number | null;
            /** Format: date-time */
            createdAt: string;
            findingCount: number;
            id: string;
            labels?: string[];
            mission: string;
            progress: components["schemas"]["Progress"];
            resultSummary?: string | null;
            runtimeMs: number | null;
            source: components["schemas"]["SourceDescriptor"];
            sourceCount: number;
            /** @enum {string} */
            status: "planning" | "running" | "review" | "done" | "failed" | "cancelled";
            topic: string;
            /** Format: date-time */
            updatedAt: string;
            /** @description Monotonic revision used for optimistic concurrency (If-Match). */
            version: number;
        };
        /**
         * ResearchProjectListResponse
         * @description Cursor-paginated list envelope for ResearchProject.
         */
        ResearchProjectListResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            freshness: components["schemas"]["Freshness"];
            items: components["schemas"]["ResearchProject"][];
            pageInfo: components["schemas"]["PageInfo"];
            sources: components["schemas"]["SourceDescriptor"][];
        };
        /**
         * ResearchProjectResponse
         * @description Single-resource envelope for ResearchProject.
         */
        ResearchProjectResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["ResearchProject"];
            freshness: components["schemas"]["Freshness"];
        };
        /** ResearchProvider */
        ResearchProvider: {
            configured: boolean;
            endpoint: string | null;
            maxSources: number;
            /** @enum {string} */
            provider: "searxng" | "wikipedia";
            setup: {
                available: boolean;
                endpoint: string;
                image: string | null;
                reason: string | null;
                /** @enum {string} */
                state: "ready" | "stopped" | "unavailable";
            };
            /** @constant */
            sourceVerification: "unverified";
            timeoutMs: number;
            version: number;
        };
        /** ResearchProviderResponse */
        ResearchProviderResponse: {
            contractVersion: string;
            data: components["schemas"]["ResearchProvider"];
            freshness: components["schemas"]["Freshness"];
        };
        /** ResearchProviderUpdateRequest */
        ResearchProviderUpdateRequest: {
            endpoint: string;
            /** @description Provision the pinned local SearXNG service before selecting its fixed endpoint. */
            installLocal?: boolean;
        };
        /** ResearchSource */
        ResearchSource: {
            contentHash?: string | null;
            /** @description Bounded plain-text extraction from a fetched page. Missing on legacy or mock sources. */
            contentText?: string | null;
            /** Format: date-time */
            createdAt: string;
            domain: string;
            excerpt: string | null;
            fetchError?: string | null;
            id: string;
            labels?: string[];
            projectId: string;
            relevance: number;
            reliability: number;
            /** Format: date-time */
            retrievedAt: string | null;
            source: components["schemas"]["SourceDescriptor"];
            /** @enum {string} */
            status: "queued" | "retrieved" | "failed" | "excluded";
            supportsStatement: string | null;
            title: string;
            /** Format: date-time */
            updatedAt: string;
            /** Format: uri */
            url?: string;
            /** @description Monotonic revision used for optimistic concurrency (If-Match). */
            version: number;
        };
        /**
         * ResearchSourceListResponse
         * @description Cursor-paginated list envelope for ResearchSource.
         */
        ResearchSourceListResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            freshness: components["schemas"]["Freshness"];
            items: components["schemas"]["ResearchSource"][];
            pageInfo: components["schemas"]["PageInfo"];
            sources: components["schemas"]["SourceDescriptor"][];
        };
        /**
         * ResearchSourceResponse
         * @description Single-resource envelope for ResearchSource.
         */
        ResearchSourceResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["ResearchSource"];
            freshness: components["schemas"]["Freshness"];
        };
        /** ResourceDeleted */
        ResourceDeleted: {
            /** Format: date-time */
            deletedAt: string;
            deletedBy?: components["schemas"]["Actor"];
            id: string;
        };
        /** ResyncRequired */
        ResyncRequired: {
            latestSequence: number;
            oldestAvailableSequence: number | null;
            /** @enum {string} */
            reason: "sequence_too_old" | "buffer_overflow" | "server_restart" | "unknown";
            requestedSince: number | null;
        };
        /**
         * RiskTier
         * @description Tier 1 low, Tier 2 confirm, Tier 3 re-authentication; Tier 3 is never approvable by voice alone.
         * @enum {integer}
         */
        RiskTier: 1 | 2 | 3;
        /**
         * Role
         * @enum {string}
         */
        Role: "owner" | "operator" | "viewer";
        /**
         * Scenario
         * @description Deterministic mock scenario (PLAN §45).
         */
        Scenario: {
            description: string;
            id: string;
            name: string;
            steps: {
                delayMs: number;
                description?: string;
                index: number;
                label: string;
                orbMode?: components["schemas"]["OrbMode"];
            }[];
        };
        /**
         * ScenarioControlRequest
         * @description Mock control actions of the scenario console (PLAN §44.6). Discriminated by action.
         */
        ScenarioControlRequest: {
            /** @constant */
            action: "clock_advance";
            ms: number;
        } | {
            /** @constant */
            action: "adapter_offline";
            adapterId: string;
            offline: boolean;
        } | {
            /** @constant */
            action: "latency";
            adapterId?: string;
            ms: number;
        } | {
            /** @constant */
            action: "error_rate";
            adapterId?: string;
            rate: number;
        } | {
            /** @constant */
            action: "capability_toggle";
            capability: string;
            enabled: boolean;
            module: string;
        } | {
            /** @constant */
            action: "force_orb_state";
            activityText?: string;
            audioLevel?: number;
            mode: components["schemas"]["OrbMode"];
            progress?: number | null;
        } | {
            /** @constant */
            action: "release_orb_state";
        } | {
            /** @constant */
            action: "play_event";
            eventType: string;
            payload?: {
                [key: string]: unknown;
            };
            subject?: string;
        } | {
            /** @constant */
            action: "reset";
        };
        /**
         * ScenarioListResponse
         * @description Cursor-paginated list envelope for Scenario.
         */
        ScenarioListResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            freshness: components["schemas"]["Freshness"];
            items: components["schemas"]["Scenario"][];
            pageInfo: components["schemas"]["PageInfo"];
            sources: components["schemas"]["SourceDescriptor"][];
        };
        /**
         * ScenarioResponse
         * @description Single-resource envelope for Scenario.
         */
        ScenarioResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["Scenario"];
            freshness: components["schemas"]["Freshness"];
        };
        /** ScenarioState */
        ScenarioState: {
            activeScenarioId: string | null;
            adapterOverrides: {
                adapterId: string;
                errorRate?: number;
                latencyMs?: number;
                offline: boolean;
            }[];
            capabilityOverrides: {
                capability: string;
                enabled: boolean;
                module: string;
            }[];
            clockOffsetMs: number;
            forcedOrbMode: components["schemas"]["OrbMode"] | null;
            running: boolean;
            seed: number;
            /** Format: date-time */
            simulatedTime: string;
            stepIndex: number;
        };
        /**
         * ScenarioStateResponse
         * @description Single-resource envelope for ScenarioState.
         */
        ScenarioStateResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["ScenarioState"];
            freshness: components["schemas"]["Freshness"];
        };
        /**
         * SecretStatus
         * @description Secrets never leave the server; the browser only learns whether one is configured.
         */
        SecretStatus: {
            configured: boolean;
            maskedHint?: string;
        };
        /** SecuritySettings */
        SecuritySettings: {
            /** @default false */
            allowRemoteAccess: boolean;
            auditHashChain: boolean;
            loginRequired?: boolean;
            reauthWindowMinutes: number;
            sessionTimeoutMinutes: number;
            trustedOrigins: string[];
        };
        /**
         * Service
         * @description Monitored system component (PLAN §40.2): Hermes, Kimi API, Local Qwen, Voice, WSL, ...
         */
        Service: {
            /** Format: date-time */
            createdAt: string;
            detail?: string;
            id: string;
            /** @enum {string} */
            kind: "hermes" | "llm" | "voice" | "wsl" | "api" | "stream" | "adapter" | "worker" | "other";
            labels?: string[];
            /** Format: date-time */
            lastCheckAt: string | null;
            /** Format: date-time */
            lastSuccessAt: string | null;
            latencyMs: number | null;
            name: string;
            source: components["schemas"]["SourceDescriptor"];
            status: components["schemas"]["HealthStatus"];
            /** Format: date-time */
            updatedAt: string;
            version: string;
        };
        /**
         * ServiceListResponse
         * @description Cursor-paginated list envelope for Service.
         */
        ServiceListResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            freshness: components["schemas"]["Freshness"];
            items: components["schemas"]["Service"][];
            pageInfo: components["schemas"]["PageInfo"];
            sources: components["schemas"]["SourceDescriptor"][];
        };
        /**
         * ServiceResponse
         * @description Single-resource envelope for Service.
         */
        ServiceResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["Service"];
            freshness: components["schemas"]["Freshness"];
        };
        /**
         * Session
         * @description Current session. csrfToken must be echoed in X-CSRF-Token on mutating requests.
         */
        Session: {
            authenticated: boolean;
            csrfToken: string | null;
            /** Format: date-time */
            expiresAt: string | null;
            /** Format: date-time */
            reauthUntil: string | null;
            role: components["schemas"]["Role"] | null;
            setupRequired?: boolean;
            user: components["schemas"]["User"] | null;
        };
        /**
         * SessionResponse
         * @description Single-resource envelope for Session.
         */
        SessionResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["Session"];
            freshness: components["schemas"]["Freshness"];
        };
        /**
         * Settings
         * @description All 14 settings areas (PLAN §42.1). adapters lists configuration state; secrets only as { configured }.
         */
        Settings: {
            adapters: components["schemas"]["AdapterConfigSettings"][];
            approvals: components["schemas"]["ApprovalSettings"];
            backups: components["schemas"]["BackupSettings"];
            dashboard: components["schemas"]["DashboardSettings"];
            dataRetention: components["schemas"]["DataRetentionSettings"];
            developer: components["schemas"]["DeveloperSettings"];
            modelsRouting: components["schemas"]["ModelsRoutingSettings"];
            navigation: components["schemas"]["NavigationSettings"];
            notifications: components["schemas"]["NotificationSettings"];
            orb: components["schemas"]["OrbSettings"];
            profile: components["schemas"]["ProfileSettings"];
            security: components["schemas"]["SecuritySettings"];
            theme: components["schemas"]["ThemeSettings"];
            /** Format: date-time */
            updatedAt: string;
            version: number;
            voice: components["schemas"]["VoiceSettings"];
        };
        /**
         * SettingsExport
         * @description Portable export. Secrets are never included.
         */
        SettingsExport: {
            contractVersion: components["schemas"]["ContractVersion"];
            /** Format: date-time */
            exportedAt: string;
            layouts: components["schemas"]["Layout"][];
            settings: components["schemas"]["SettingsPatch"];
            themes: components["schemas"]["Theme"][];
        };
        /**
         * SettingsPatch
         * @description PATCH body: every supplied area replaces the stored area as a whole. Adapters are patched via /settings/adapters/{id}.
         */
        SettingsPatch: {
            approvals?: components["schemas"]["ApprovalSettings"];
            backups?: components["schemas"]["BackupSettings"];
            dashboard?: components["schemas"]["DashboardSettings"];
            dataRetention?: components["schemas"]["DataRetentionSettings"];
            developer?: components["schemas"]["DeveloperSettings"];
            modelsRouting?: components["schemas"]["ModelsRoutingSettings"];
            navigation?: components["schemas"]["NavigationSettings"];
            notifications?: components["schemas"]["NotificationSettings"];
            orb?: components["schemas"]["OrbSettings"];
            profile?: components["schemas"]["ProfileSettings"];
            security?: components["schemas"]["SecuritySettings"];
            theme?: components["schemas"]["ThemeSettings"];
            voice?: components["schemas"]["VoiceSettings"];
        };
        /**
         * SettingsResponse
         * @description Single-resource envelope for Settings.
         */
        SettingsResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["Settings"];
            freshness: components["schemas"]["Freshness"];
        };
        /** SettingsSchema */
        SettingsSchema: {
            areas: string[];
            schema: components["schemas"]["JsonSchemaObject"];
        };
        /**
         * SettingsSchemaResponse
         * @description Single-resource envelope for SettingsSchema.
         */
        SettingsSchemaResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["SettingsSchema"];
            freshness: components["schemas"]["Freshness"];
        };
        /**
         * Severity
         * @enum {string}
         */
        Severity: "info" | "warning" | "error" | "critical";
        /**
         * SingleEnvelope
         * @description Generic single-resource envelope.
         */
        SingleEnvelope: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: unknown;
            freshness: components["schemas"]["Freshness"];
        };
        /** SkillActivationRequest */
        SkillActivationRequest: {
            enabled: boolean;
        };
        /** SkillCatalogEntry */
        SkillCatalogEntry: {
            accounts: string[];
            category: string;
            conditionalCapabilities: string[];
            description: string;
            discovered: boolean | null;
            enabled: boolean | null;
            id: string;
            integrationDetails: {
                /** @enum {unknown} */
                account: "none" | "required" | "conditional";
                configured: boolean | null;
                connectionChecked: boolean | null;
                cost?: {
                    /** @enum {unknown} */
                    model: "host_resources" | "provider_usage" | "subscription_license" | "none" | "unknown";
                    notice: string;
                };
                id: string;
                permissions?: {
                    optional_prerequisites: components["schemas"]["prerequisite"][];
                    required_prerequisites: components["schemas"]["prerequisite"][];
                    scope_notice: string;
                    /** @enum {unknown} */
                    scope_status: "unknown" | "not_required";
                };
                reference: string;
                required: boolean;
                settingsTarget: string;
                setupDe: string;
            }[];
            integrationRefs: string[];
            name: string;
            observationError: string | null;
            observationSource: string;
            /** Format: date-time */
            observedAt: string | null;
            packaged: boolean;
            requiredCapabilities: string[];
            setupRefs: string[];
            /** @enum {unknown} */
            source: "friday" | "hermes";
            version: string | null;
            $defs: {
                prerequisite: {
                    kind: string;
                    notice: string;
                    /** @enum {unknown} */
                    status: "required" | "optional";
                };
            };
        };
        /** SkillCatalogResponse */
        SkillCatalogResponse: {
            catalogError: string | null;
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["SkillCatalogEntry"][];
            freshness: components["schemas"]["Freshness"];
            hermesError: string | null;
        };
        /** SkillResponse */
        SkillResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["SkillCatalogEntry"];
            freshness: components["schemas"]["Freshness"];
        };
        /**
         * SourceDescriptor
         * @description Provenance of a canonical resource: which adapter delivered it.
         */
        SourceDescriptor: {
            adapterId: string;
            /** @description Opaque id in the backing system. Never interpreted by the UI. */
            externalId?: string;
            /** Format: date-time */
            lastSyncedAt: string;
            /** @description Backing system family, e.g. mock, hermes, gmx. */
            system: string;
        };
        /** StorageVolume */
        StorageVolume: {
            /** Format: date-time */
            createdAt: string;
            fileSystem?: string;
            freeBytes: number;
            id: string;
            label: string;
            labels?: string[];
            /** @description Drive or mount, e.g. D:\. */
            mount: string;
            source: components["schemas"]["SourceDescriptor"];
            totalBytes: number;
            /** Format: date-time */
            updatedAt: string;
            usagePercent: number;
            usedBytes: number;
            /** @description Monotonic revision used for optimistic concurrency (If-Match). */
            version: number;
        };
        /**
         * StorageVolumeListResponse
         * @description Cursor-paginated list envelope for StorageVolume.
         */
        StorageVolumeListResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            freshness: components["schemas"]["Freshness"];
            items: components["schemas"]["StorageVolume"][];
            pageInfo: components["schemas"]["PageInfo"];
            sources: components["schemas"]["SourceDescriptor"][];
        };
        /** SystemBackupActionRequest */
        SystemBackupActionRequest: {
            /** @enum {string} */
            action: "preview" | "run" | "verify" | "restore-test";
            path?: string;
            targetPath?: string;
        };
        /** SystemBackupActionResponse */
        SystemBackupActionResponse: {
            contractVersion: string;
            data: {
                /** @enum {string} */
                action: "preview" | "run" | "verify" | "restore-test";
                /** Format: date-time */
                createdAt?: string;
                destination?: string;
                estimatedBytes?: number;
                fileCount?: number;
                memoryEventCount?: number;
                path?: string;
                verified?: boolean;
            };
            freshness: components["schemas"]["Freshness"];
        };
        /** SystemBackupStatusResponse */
        SystemBackupStatusResponse: {
            contractVersion: string;
            data: {
                /** @enum {string} */
                coverage: "windows-and-memory" | "windows-wsl-and-memory";
                enabled: boolean;
                last: null | {
                    /** Format: date-time */
                    at: string;
                    error: string | null;
                    path: string | null;
                    /** @enum {string} */
                    status: "success" | "failed";
                };
                /** @constant */
                reprovisionRequired: true;
                /** @constant */
                restoreMode: "isolated-verification-only";
                running: boolean;
                schedule: string;
                targetPath: string;
                timeZone: string;
            };
            freshness: components["schemas"]["Freshness"];
        };
        /** SystemCapability */
        SystemCapability: {
            healthcheck: boolean;
            openLogs: boolean;
            read: boolean;
            restartAdapter: boolean;
            sources: string[];
        };
        /**
         * SystemMetrics
         * @description Hardware snapshot (PLAN §40.1). Optional sensors are null when unavailable.
         */
        SystemMetrics: {
            cpu: {
                cores: number;
                temperatureC?: number | null;
                usagePercent: number;
            };
            gpu: {
                name: string;
                temperatureC?: number | null;
                usagePercent: number;
            } | null;
            network: {
                latencyMs?: number | null;
                rxBytesPerSec: number;
                txBytesPerSec: number;
            };
            ram: {
                totalBytes: number;
                usagePercent: number;
                usedBytes: number;
            };
            /** Format: date-time */
            sampledAt: string;
            source: components["schemas"]["SourceDescriptor"];
            storage: components["schemas"]["StorageVolume"][];
            temperatures?: {
                celsius: number;
                sensor: string;
            }[];
            vram: {
                totalBytes: number;
                usagePercent: number;
                usedBytes: number;
            } | null;
        };
        /**
         * SystemMetricsResponse
         * @description Single-resource envelope for SystemMetrics.
         */
        SystemMetricsResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["SystemMetrics"];
            freshness: components["schemas"]["Freshness"];
        };
        /**
         * Task
         * @description Unit of work processed by an agent (PLAN §28.3).
         */
        Task: {
            agentId: string | null;
            agentName?: string;
            approvalIds: string[];
            artifactCount: number;
            artifacts: components["schemas"]["ArtifactRef"][];
            blockers: components["schemas"]["TaskBlocker"][];
            /** Format: date-time */
            createdAt: string;
            createdBy: components["schemas"]["Actor"];
            description?: string;
            /** Format: date-time */
            dueAt: string | null;
            errors: components["schemas"]["ErrorDetail"][];
            /** Format: date-time */
            estimatedCompletionAt: string | null;
            id: string;
            labels?: string[];
            /** Format: date-time */
            lastActivityAt: string | null;
            model: string | null;
            parentTaskId?: string | null;
            priority: components["schemas"]["Priority"];
            progress: components["schemas"]["Progress"];
            runtimeMs: number | null;
            source: components["schemas"]["SourceDescriptor"];
            sourceRefs: components["schemas"]["EntityRef"][];
            /** Format: date-time */
            startedAt: string | null;
            status: components["schemas"]["TaskStatus"];
            steps: components["schemas"]["TaskStep"][];
            title: string;
            toolCalls: components["schemas"]["TaskToolCall"][];
            /** Format: date-time */
            updatedAt: string;
            /** @description Monotonic revision used for optimistic concurrency (If-Match). */
            version: number;
        };
        /**
         * TaskActionRequest
         * @description Optional body for cancel/retry/pause/resume.
         */
        TaskActionRequest: {
            confirm?: boolean;
            reason?: string;
        };
        /**
         * TaskAssignRequest
         * @description Assigns a task to an agent or releases it (agentId null).
         */
        TaskAssignRequest: {
            agentId: string | null;
            reason?: string;
        };
        /** TaskBlocker */
        TaskBlocker: {
            description: string;
            id: string;
            /** @enum {string} */
            kind: "approval" | "dependency" | "input_needed" | "adapter_unavailable" | "other";
            refId?: string;
            /** Format: date-time */
            since?: string;
        };
        /** TaskCreateRequest */
        TaskCreateRequest: {
            agentId?: string | null;
            description?: string;
            /** Format: date-time */
            dueAt?: string | null;
            labels?: string[];
            model?: string | null;
            priority?: components["schemas"]["Priority"];
            title: string;
        };
        /**
         * TaskInputRequest
         * @description Answer to a task that waits for input (blocker kind input_needed). The text is forwarded to the agent; it resolves the blocker.
         */
        TaskInputRequest: {
            /** @description Blocker to resolve; defaults to the first input_needed blocker. */
            blockerId?: string;
            input: string;
        };
        /**
         * TaskListResponse
         * @description Cursor-paginated list envelope for Task.
         */
        TaskListResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            freshness: components["schemas"]["Freshness"];
            items: components["schemas"]["Task"][];
            pageInfo: components["schemas"]["PageInfo"];
            sources: components["schemas"]["SourceDescriptor"][];
        };
        /** TaskProgressEvent */
        TaskProgressEvent: {
            agentId?: string | null;
            currentStep?: string | null;
            message?: string;
            progress: components["schemas"]["Progress"];
            taskId: string;
        };
        /**
         * TaskResponse
         * @description Single-resource envelope for Task.
         */
        TaskResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["Task"];
            freshness: components["schemas"]["Freshness"];
        };
        /** TasksCapability */
        TasksCapability: {
            cancel: boolean;
            create: boolean;
            /** @description Answer tasks that wait for input (POST /tasks/{id}/input). */
            input?: boolean;
            pause: boolean;
            read: boolean;
            resume: boolean;
            retry: boolean;
            sources: string[];
            stream: boolean;
            update: boolean;
        };
        /**
         * TaskStatus
         * @enum {string}
         */
        TaskStatus: "triage" | "todo" | "ready" | "running" | "waiting" | "review" | "done" | "failed" | "cancelled";
        /** TaskStep */
        TaskStep: {
            detail?: string;
            /** Format: date-time */
            finishedAt?: string;
            id: string;
            index: number;
            /** Format: date-time */
            startedAt?: string;
            /** @enum {string} */
            status: "pending" | "running" | "done" | "failed" | "skipped";
            title: string;
        };
        /** TaskToolCall */
        TaskToolCall: {
            adapterId?: string;
            durationMs?: number;
            error?: components["schemas"]["ErrorDetail"];
            id: string;
            /** Format: date-time */
            startedAt: string;
            /** @enum {string} */
            status: "running" | "succeeded" | "failed";
            summary?: string;
            tool: string;
        };
        /**
         * TaskUpdateRequest
         * @description Partial update (also used for Kanban moves via status). Requires If-Match.
         */
        TaskUpdateRequest: {
            agentId?: string | null;
            description?: string;
            /** Format: date-time */
            dueAt?: string | null;
            labels?: string[];
            priority?: components["schemas"]["Priority"];
            status?: components["schemas"]["TaskStatus"];
            title?: string;
        };
        /** TelegramGateway */
        TelegramGateway: {
            allowedUserIds: string[];
            applied: boolean | null;
            /** @enum {string} */
            botAuthentication: "missing" | "verified" | "invalid" | "unknown";
            botId: string | null;
            botUsername: string | null;
            /** @enum {string} */
            connectionState: "connected" | "disconnected" | "unknown";
            enabled: boolean | null;
            gatewayRunning: boolean | null;
            /** @enum {string} */
            receiveMode: "polling" | "webhook" | "unknown";
            revision: number;
            tokenConfigured: boolean;
        };
        /** TelegramGatewayPatch */
        TelegramGatewayPatch: {
            allowedUserIds: string[];
            clearToken: boolean;
            enabled: boolean;
            token: string;
        };
        /** TelegramGatewayResponse */
        TelegramGatewayResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["TelegramGateway"];
            freshness: components["schemas"]["Freshness"];
        };
        /** TelephonyStatus */
        "telephony-status.schema": {
            ariReachable: boolean;
            callerId: string | null;
            configurationApplied: boolean;
            configured: boolean;
            dialplanLoaded: boolean;
            /** @enum {string|null} */
            mode: "local" | "trunk" | null;
            /** @enum {string} */
            ownerEndpoint: "unknown" | "online" | "offline";
            ready: boolean;
            /** @enum {string} */
            registration: "unavailable" | "unknown" | "unregistered" | "registered" | "not_required";
            revision: number;
        };
        /** TelephonyCallRequest */
        TelephonyCallRequest: {
            destination: string;
            previewToken: string;
        };
        /** TelephonyCallResponse */
        TelephonyCallResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: {
                adapterStatus: number | null;
                /** Format: date-time */
                createdAt: string;
                destination: string;
                id: string;
                replayed?: boolean;
                /** @enum {string} */
                state: "pending" | "requested" | "owner_answered" | "ended" | "failed" | "unknown";
                /** Format: date-time */
                updatedAt: string;
            };
            freshness: components["schemas"]["Freshness"];
        };
        /** TelephonyCapability */
        TelephonyCapability: {
            call: boolean;
            read: boolean;
            sources: string[];
        };
        /** TelephonyPreviewRequest */
        TelephonyPreviewRequest: {
            destination: string;
        };
        /** TelephonyPreviewResponse */
        TelephonyPreviewResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: {
                callerId: string;
                destination: string;
                /** Format: date-time */
                expiresAt: string;
                /** @enum {string} */
                mode: "local" | "trunk";
                token: string;
            };
            freshness: components["schemas"]["Freshness"];
        };
        /** TelephonyProfilePatch */
        TelephonyProfilePatch: {
            ariPassword: string;
            ariPort: number;
            ariUser: string;
            callerId: string;
            /** @enum {string} */
            mode: "local" | "trunk";
            ownerEndpoint: string;
            sipHost?: string;
            sipPassword?: string;
            sipUser?: string;
        };
        /** TelephonyStatusResponse */
        TelephonyStatusResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["telephony-status.schema"];
            freshness: components["schemas"]["Freshness"];
        };
        /**
         * Theme
         * @description Theme file (PLAN §25.3). Switchable at runtime without rebuild.
         */
        Theme: {
            builtIn: boolean;
            description?: string;
            id: string;
            name: string;
            orb: {
                fragmentDensity: number;
                glowIntensity: number;
                motionSpeed: number;
                mouseParallax: boolean;
                particleDensity: number;
                preset: string;
            };
            panels: {
                backgroundOpacity: number;
                borderIntensity: number;
                /** @enum {string} */
                cornerStyle: "technical-cut" | "rounded" | "square";
            };
            /** @description Design tokens as dotted keys, e.g. color.primary. */
            tokens: {
                [key: string]: string;
            };
        };
        /** ThemeImportRequest */
        ThemeImportRequest: {
            activate?: boolean;
            theme: components["schemas"]["Theme"];
        };
        /**
         * ThemeListResponse
         * @description Cursor-paginated list envelope for Theme.
         */
        ThemeListResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            freshness: components["schemas"]["Freshness"];
            items: components["schemas"]["Theme"][];
            pageInfo: components["schemas"]["PageInfo"];
            sources: components["schemas"]["SourceDescriptor"][];
        };
        /**
         * ThemeResponse
         * @description Single-resource envelope for Theme.
         */
        ThemeResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["Theme"];
            freshness: components["schemas"]["Freshness"];
        };
        /** ThemeSettings */
        ThemeSettings: {
            activeThemeId: string;
            cyanIntensity: number;
            goldIntensity: number;
            overrides?: {
                [key: string]: string;
            };
            panelOpacity: number;
        };
        /**
         * Thread
         * @description Unified inbox thread (PLAN §33.2). messages is populated in the detail view only.
         */
        Thread: {
            channelId: string;
            channelKind: components["schemas"]["ChannelKind"];
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            deadline: string | null;
            draftIds: string[];
            extractedEvents: {
                /** Format: date-time */
                end?: string;
                /** Format: date-time */
                start: string;
                title: string;
            }[];
            extractedTasks: {
                /** Format: date-time */
                dueAt: string | null;
                title: string;
            }[];
            hasDraft: boolean;
            id: string;
            labels?: string[];
            /** Format: date-time */
            lastMessageAt: string;
            linkedTaskId: string | null;
            messageCount: number;
            messages?: components["schemas"]["Message"][];
            needsReply: boolean;
            participants: components["schemas"]["Participant"][];
            priority: components["schemas"]["Priority"];
            source: components["schemas"]["SourceDescriptor"];
            /** @enum {string} */
            status: "open" | "waiting" | "replied" | "archived";
            subject: string;
            suggestedReply: string | null;
            summary: string | null;
            unreadCount: number;
            /** Format: date-time */
            updatedAt: string;
            /** @description Monotonic revision used for optimistic concurrency (If-Match). */
            version: number;
        };
        /**
         * ThreadListResponse
         * @description Cursor-paginated list envelope for Thread.
         */
        ThreadListResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            freshness: components["schemas"]["Freshness"];
            items: components["schemas"]["Thread"][];
            pageInfo: components["schemas"]["PageInfo"];
            sources: components["schemas"]["SourceDescriptor"][];
        };
        /**
         * ThreadResponse
         * @description Single-resource envelope for Thread.
         */
        ThreadResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["Thread"];
            freshness: components["schemas"]["Freshness"];
        };
        /** User */
        User: {
            displayName: string;
            id: string;
            role: components["schemas"]["Role"];
        };
        /**
         * VoiceAudioLevel
         * @description Real audio level of one direction (input = microphone, output = TTS playback). Only numbers, never audio. level = smoothed RMS, peak = peak level, low/mid/high = frequency bands (< 250 Hz, 250-2000 Hz, > 2000 Hz), all normalized 0..1. Bands are optional because not every source can analyse the spectrum.
         */
        VoiceAudioLevel: {
            /** Format: date-time */
            at: string;
            /** @enum {string} */
            direction: "input" | "output";
            high?: number;
            level: number;
            low?: number;
            mid?: number;
            peak?: number;
        };
        /** VoiceCapability */
        VoiceCapability: {
            /** @description Delete the voice history (DELETE /voice/history). */
            deleteHistory?: boolean;
            enroll: boolean;
            read: boolean;
            sources: string[];
            stop: boolean;
            test: boolean;
        };
        /** VoiceCodingRunRequest */
        VoiceCodingRunRequest: {
            alias: string;
            /** @enum {string} */
            cli: "auto" | "codex" | "opencode" | "claude-code";
            revision: number;
            task: string;
        };
        /** VoiceConnectedCalendarConfirm */
        VoiceConnectedCalendarConfirm: {
            accountId: string;
            calendarId: string;
            etag: string;
            eventId: string;
            request: components["schemas"]["VoiceConnectedCalendarRequest"];
            token: string;
        };
        /** VoiceConnectedCalendarRequest */
        VoiceConnectedCalendarRequest: {
            /** @enum {unknown} */
            action: "create" | "update" | "delete";
            calendarName: string;
            /** Format: date-time */
            end?: string;
            /** Format: date-time */
            start?: string;
            targetTitle?: string;
            timeZone?: string;
            title?: string;
        };
        /** VoiceDevice */
        VoiceDevice: {
            channels?: number;
            /** Format: date-time */
            createdAt: string;
            id: string;
            isDefault: boolean;
            /** @enum {string} */
            kind: "input" | "output";
            labels?: string[];
            name: string;
            sampleRateHz?: number;
            source: components["schemas"]["SourceDescriptor"];
            status: components["schemas"]["HealthStatus"];
            /** Format: date-time */
            updatedAt: string;
            /** @description Monotonic revision used for optimistic concurrency (If-Match). */
            version: number;
        };
        /**
         * VoiceDeviceListResponse
         * @description Cursor-paginated list envelope for VoiceDevice.
         */
        VoiceDeviceListResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            freshness: components["schemas"]["Freshness"];
            items: components["schemas"]["VoiceDevice"][];
            pageInfo: components["schemas"]["PageInfo"];
            sources: components["schemas"]["SourceDescriptor"][];
        };
        /**
         * VoiceEnrollment
         * @description Status of one enrollment job.
         */
        VoiceEnrollment: {
            /** Format: date-time */
            finishedAt: string | null;
            id: string;
            /** @description Human readable hint, e.g. the next sentence to read or the failure reason. */
            message: string | null;
            profileId: string;
            progress: components["schemas"]["Progress"];
            /** @description Quality of the profile after the job (null until known). */
            quality: number | null;
            samplesCaptured: number;
            samplesRequired: number;
            source: components["schemas"]["SourceDescriptor"];
            /** Format: date-time */
            startedAt: string;
            /** @enum {string} */
            status: "queued" | "capturing" | "calibrating" | "completed" | "failed" | "cancelled";
            /** Format: date-time */
            updatedAt: string;
        };
        /**
         * VoiceEnrollmentResponse
         * @description Single-resource envelope for VoiceEnrollment.
         */
        VoiceEnrollmentResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["VoiceEnrollment"];
            freshness: components["schemas"]["Freshness"];
        };
        /**
         * VoiceEnrollRequest
         * @description Starts (or repeats) the enrollment of a voice profile (PLAN §38.3). The audio itself is captured by the voice service, never uploaded through this API.
         */
        VoiceEnrollRequest: {
            /** @description Re-run the calibration of the threshold after the samples are captured. */
            recalibrate?: boolean;
            /** @description Number of samples to capture; the adapter chooses its default when omitted. */
            sampleTarget?: number;
        };
        /** VoiceLocalConfirmRequest */
        VoiceLocalConfirmRequest: {
            request: components["schemas"]["VoiceLocalRequest"];
            targetId: string;
            token: string;
            version: number;
        };
        /** VoiceLocalPreviewResponse */
        VoiceLocalPreviewResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: {
                /** @enum {string} */
                action: "create" | "update" | "delete";
                event: components["schemas"]["LocalEventRequest"];
                /** Format: date-time */
                expiresAt: string;
                targetId: string;
                token: string;
                version: number;
            };
            freshness: components["schemas"]["Freshness"];
        };
        /** VoiceLocalRequest */
        VoiceLocalRequest: {
            /** @enum {string} */
            action: "create" | "update" | "delete";
            /** Format: date-time */
            end?: string;
            /** Format: date-time */
            start?: string;
            targetTitle?: string;
            timeZone?: string;
            title?: string;
        };
        /** VoiceMailConfirmRequest */
        VoiceMailConfirmRequest: {
            fingerprint: string;
            request: components["schemas"]["VoiceMailRequest"];
            token: string;
        };
        /** VoiceMailConfirmResponse */
        VoiceMailConfirmResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: {
                replayed: boolean;
                /** @enum {string} */
                state: "sent" | "changed" | "unknown";
            };
            freshness: components["schemas"]["Freshness"];
        };
        /** VoiceMailPreviewResponse */
        VoiceMailPreviewResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: {
                accountId: string;
                accountName: string;
                /** @enum {string} */
                action: "compose" | "reply" | "move" | "flag";
                body: string;
                destination: string;
                /** Format: date-time */
                expiresAt: string;
                fingerprint: string;
                id: string;
                mailbox: string;
                subject: string;
                to: string[];
                token: string;
            };
            freshness: components["schemas"]["Freshness"];
        };
        /** VoiceMailRequest */
        VoiceMailRequest: {
            accountId?: string;
            /** @enum {string} */
            action: "compose" | "reply" | "move" | "flag";
            body?: string;
            destination?: string;
            id?: string;
            mailbox?: string;
            subject?: string;
            to?: string[];
            uidValidity?: string;
        };
        /**
         * VoiceMetrics
         * @description Pipeline latencies (PLAN §38.2).
         */
        VoiceMetrics: {
            firstToken: components["schemas"]["LatencyStat"];
            routerLatency: components["schemas"]["LatencyStat"];
            /** Format: date-time */
            sampledAt: string;
            source: components["schemas"]["SourceDescriptor"];
            speakerVerificationLatency: components["schemas"]["LatencyStat"];
            sttLatency: components["schemas"]["LatencyStat"];
            ttsFirstAudio: components["schemas"]["LatencyStat"];
            wakeWordLatency: components["schemas"]["LatencyStat"];
        };
        /**
         * VoiceMetricsResponse
         * @description Single-resource envelope for VoiceMetrics.
         */
        VoiceMetricsResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["VoiceMetrics"];
            freshness: components["schemas"]["Freshness"];
        };
        /**
         * VoiceProfile
         * @description Voice enrollment profile (PLAN §38.3).
         */
        VoiceProfile: {
            /** Format: date-time */
            calibratedAt: string | null;
            /** Format: date-time */
            createdAt: string;
            displayName: string;
            id: string;
            labels?: string[];
            /** Format: date-time */
            lastTestAt: string | null;
            /** @enum {string} */
            lastTestResult: "pass" | "fail" | "unknown";
            owner: boolean;
            quality: number;
            sampleCount: number;
            source: components["schemas"]["SourceDescriptor"];
            threshold: number;
            /** Format: date-time */
            updatedAt: string;
            /** @description Monotonic revision used for optimistic concurrency (If-Match). */
            version: number;
        };
        /**
         * VoiceProfileListResponse
         * @description Cursor-paginated list envelope for VoiceProfile.
         */
        VoiceProfileListResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            freshness: components["schemas"]["Freshness"];
            items: components["schemas"]["VoiceProfile"][];
            pageInfo: components["schemas"]["PageInfo"];
            sources: components["schemas"]["SourceDescriptor"][];
        };
        /** VoiceSettings */
        VoiceSettings: {
            inputDeviceId: string | null;
            outputDeviceId: string | null;
            pushToTalkKey: string;
            speakerVerificationRequired: boolean;
            /** @default false */
            storeRawRecordings: boolean;
            ttsRate: number;
            ttsVoice: string;
            voiceHistoryEnabled: boolean;
            wakeWord: string;
            wakeWordEnabled: boolean;
        };
        /**
         * VoiceStatus
         * @description Live voice pipeline status (PLAN §38.1). Microphone activity is always visible.
         */
        VoiceStatus: {
            audioInputDeviceId: string | null;
            audioOutputDeviceId: string | null;
            focusMode: boolean;
            localModel: {
                latencyMs: number | null;
                name: string | null;
                /** @enum {string} */
                state: "ready" | "busy" | "error" | "offline";
            };
            microphone: {
                active: boolean;
                deviceId: string | null;
                inputLevel: number;
                /** @enum {string} */
                state: "off" | "muted" | "idle" | "listening";
            };
            /** @enum {string} */
            mode: "idle" | "listening" | "transcribing" | "thinking" | "speaking" | "error";
            pushToTalk: {
                active: boolean;
                enabled: boolean;
            };
            rawRecordingEnabled: boolean;
            /** Format: date-time */
            serviceStartedAt?: string | null;
            source: components["schemas"]["SourceDescriptor"];
            speakerVerification: {
                confidence: number | null;
                enabled: boolean;
                recognizedSpeaker: string | null;
                /** @enum {string} */
                state: "disabled" | "idle" | "verifying" | "verified" | "rejected";
            };
            stt: {
                engine: string;
                latencyMs: number | null;
                /** @enum {string} */
                state: "ready" | "busy" | "error" | "offline";
            };
            trustedSession: {
                active: boolean;
                /** Format: date-time */
                expiresAt: string | null;
            };
            tts: {
                engine: string;
                latencyMs: number | null;
                /** @enum {string} */
                state: "ready" | "busy" | "error" | "offline";
            };
            ttsVoiceChoice?: string | null;
            /** Format: date-time */
            updatedAt: string;
            voiceHistoryEnabled: boolean;
            wakeWord: {
                enabled: boolean;
                phrase: string;
                /** @enum {string} */
                state: "disabled" | "armed" | "triggered" | "error";
            };
        };
        /**
         * VoiceStatusResponse
         * @description Single-resource envelope for VoiceStatus.
         */
        VoiceStatusResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["VoiceStatus"];
            freshness: components["schemas"]["Freshness"];
        };
        /**
         * VoiceTestKind
         * @enum {string}
         */
        VoiceTestKind: "wake_word" | "speaker" | "stt" | "tts" | "full_pipeline";
        /** VoiceTestRequest */
        VoiceTestRequest: {
            durationMs?: number;
            kind: components["schemas"]["VoiceTestKind"];
            text?: string;
        };
        /** VoiceTestResult */
        VoiceTestResult: {
            correlationId: string;
            durationMs: number;
            kind: components["schemas"]["VoiceTestKind"];
            message: string;
            stages: {
                detail: string | null;
                latencyMs: number | null;
                name: string;
                ok: boolean;
            }[];
            /** Format: date-time */
            startedAt: string;
            success: boolean;
        };
        /**
         * VoiceTestResultResponse
         * @description Single-resource envelope for VoiceTestResult.
         */
        VoiceTestResultResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["VoiceTestResult"];
            freshness: components["schemas"]["Freshness"];
        };
        /** VoiceTranscript */
        VoiceTranscript: {
            confidence?: number | null;
            final: boolean;
            language: string;
            speaker?: string | null;
            /** Format: date-time */
            startedAt: string;
            text: string;
            utteranceId: string;
        };
        /** VoiceTtsEnded */
        VoiceTtsEnded: {
            durationMs: number;
            interrupted: boolean;
            utteranceId: string;
        };
        /** VoiceTtsStarted */
        VoiceTtsStarted: {
            engine: string;
            text?: string;
            utteranceId: string;
            voice?: string;
        };
        /** WakeEnrollmentJob */
        WakeEnrollmentJob: {
            jobId: string;
        };
        /** WakeEnrollmentSample */
        WakeEnrollmentSample: {
            jobId: string;
            /** @enum {string} */
            kind: "wake" | "short" | "negatives" | "speech";
            pcmBase64: string;
        };
        /** WakeEnrollmentStart */
        WakeEnrollmentStart: {
            phrase: string;
        };
        /** WakeEnrollmentStatus */
        WakeEnrollmentStatus: {
            contractVersion: components["schemas"]["ContractVersion"];
            counts: components["schemas"]["counts"];
            error: string | null;
            jobId: string | null;
            phrase: string | null;
            quality: string | null;
            required: components["schemas"]["counts"];
            shortPhrase: string | null;
            /** @enum {string} */
            state: "idle" | "capturing" | "training" | "ready" | "failed" | "cancelled";
            $defs: {
                counts: {
                    negatives: number;
                    short: number;
                    speech: number;
                    wake: number;
                };
            };
        };
        /** WhatsappGateway */
        WhatsappGateway: {
            allowedUserIds: string[];
            applied: boolean | null;
            /** @enum {string} */
            connectionState: "connected" | "disconnected" | "unknown";
            enabled: boolean | null;
            gatewayRunning: boolean | null;
            /** @enum {string|null} */
            mode: "bot" | "self-chat" | null;
            revision: number;
            sessionPresent: boolean;
            setupUrl: string;
        };
        /** WhatsappGatewayPatch */
        WhatsappGatewayPatch: {
            allowedUserIds: string[];
            enabled: boolean;
            /** @enum {string} */
            mode: "bot" | "self-chat";
        };
        /** WhatsappGatewayResponse */
        WhatsappGatewayResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["WhatsappGateway"];
            freshness: components["schemas"]["Freshness"];
        };
        /** WhatsappPairing */
        WhatsappPairing: {
            /** @enum {string} */
            connectionState: "connected" | "disconnected" | "unknown";
            expiresAt: number | null;
            id: string | null;
            linkedIdentity: string | null;
            /** @enum {string} */
            mode?: "bot" | "self-chat";
            qr: string | null;
            /** @enum {string} */
            state: "idle" | "starting" | "waiting" | "qr_expired" | "connected" | "unverified" | "expired" | "cancelled" | "error";
        };
        /** WhatsappPairingResponse */
        WhatsappPairingResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["WhatsappPairing"];
            freshness: components["schemas"]["Freshness"];
        };
        /** WhatsappPairingStart */
        WhatsappPairingStart: {
            /** @enum {string} */
            mode: "bot" | "self-chat";
        };
        /** WikiPath */
        WikiPath: {
            applied: boolean | null;
            configured: boolean;
            customized: boolean;
            path: string;
            readable: boolean;
            revision: number;
        };
        /** WikiPathPatch */
        WikiPathPatch: {
            path: string;
        };
        /** WikiPathResponse */
        WikiPathResponse: {
            contractVersion: components["schemas"]["ContractVersion"];
            data: components["schemas"]["WikiPath"];
            freshness: components["schemas"]["Freshness"];
        };
    };
    responses: {
        /** @description Malformed request */
        BadRequest: {
            headers: {
                "X-Correlation-Id": components["headers"]["CorrelationId"];
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ErrorResponse"];
            };
        };
        /** @description Version conflict or idempotency key reuse (CONFLICT, IDEMPOTENCY_CONFLICT) */
        Conflict: {
            headers: {
                "X-Correlation-Id": components["headers"]["CorrelationId"];
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ErrorResponse"];
            };
        };
        /** @description Not allowed (FORBIDDEN, CSRF_INVALID, CAPABILITY_MISSING, APPROVAL_REQUIRED) */
        Forbidden: {
            headers: {
                "X-Correlation-Id": components["headers"]["CorrelationId"];
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ErrorResponse"];
            };
        };
        /** @description Resource not found (NOT_FOUND) */
        NotFound: {
            headers: {
                "X-Correlation-Id": components["headers"]["CorrelationId"];
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ErrorResponse"];
            };
        };
        /** @description Request body exceeds the size limit of the operation (VALIDATION_FAILED) */
        PayloadTooLarge: {
            headers: {
                "X-Correlation-Id": components["headers"]["CorrelationId"];
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ErrorResponse"];
            };
        };
        /** @description Adapter unavailable or timed out (ADAPTER_UNAVAILABLE, ADAPTER_TIMEOUT, INTERNAL) */
        ServiceUnavailable: {
            headers: {
                "X-Correlation-Id": components["headers"]["CorrelationId"];
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ErrorResponse"];
            };
        };
        /** @description Rate limited (RATE_LIMITED) */
        TooManyRequests: {
            headers: {
                "X-Correlation-Id": components["headers"]["CorrelationId"];
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ErrorResponse"];
            };
        };
        /** @description Not authenticated (UNAUTHENTICATED, REAUTH_REQUIRED) */
        Unauthorized: {
            headers: {
                "X-Correlation-Id": components["headers"]["CorrelationId"];
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ErrorResponse"];
            };
        };
        /** @description Validation failed (VALIDATION_FAILED) */
        UnprocessableEntity: {
            headers: {
                "X-Correlation-Id": components["headers"]["CorrelationId"];
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ErrorResponse"];
            };
        };
    };
    parameters: {
        /** @description Short-lived, single-use approval token from GET /approvals/{id} (response header X-Approval-Token). The server rejects an approve without a valid token with 403 APPROVAL_REQUIRED (PLAN §32.5). */
        ApprovalToken: string;
        /** @description Generated by the server when absent; echoed in the response. */
        CorrelationId: string;
        /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
        CsrfToken: string;
        /** @description Opaque cursor from pageInfo.nextCursor */
        Cursor: string;
        /** @description Repeated keys replay the stored response instead of executing again. */
        IdempotencyKey: string;
        /** @description Resource version for optimistic concurrency; a mismatch yields 409 CONFLICT. Set by the SDK callers. */
        IfMatch: string;
        /** @description Page size */
        Limit: number;
        /** @description Opaque resource id (prefix identifies the type) */
        PathId: string;
    };
    requestBodies: never;
    headers: {
        /** @description Short-lived, single-use token bound to this approval, user and the approve action; send it back as X-Approval-Token on POST /approvals/{id}/approve. Only present for pending approvals the caller may decide. */
        ApprovalToken: string;
        /** @description Expiry of X-Approval-Token (UTC ISO-8601). */
        ApprovalTokenExpires: string;
        /** @description Correlation id of this request */
        CorrelationId: string;
        /** @description Set to "true" when the response was replayed from the idempotency store for a repeated Idempotency-Key instead of executing the operation again. */
        IdempotentReplayed: "true";
    };
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    listActivity: {
        parameters: {
            query?: {
                /** @description Filter by adapter */
                adapterId?: string;
                /** @description Filter by agent */
                agentId?: string;
                /** @description Filter by correlation id */
                correlationId?: string;
                /** @description Opaque cursor from pageInfo.nextCursor */
                cursor?: components["parameters"]["Cursor"];
                /** @description Start of time range */
                from?: string;
                /** @description Filter by kind */
                kind?: components["schemas"]["ActivityKind"][];
                /** @description Page size */
                limit?: components["parameters"]["Limit"];
                /** @description Filter by model */
                model?: string;
                /** @description Only children of this event */
                parentId?: string;
                /** @description Filter by severity */
                severity?: components["schemas"]["Severity"][];
                /** @description Return events with sequence greater than this value, ascending */
                sinceSequence?: number;
                /** @description Filter by status */
                status?: string;
                /** @description Filter by task */
                taskId?: string;
                /** @description End of time range */
                to?: string;
                /** @description Filter by tool */
                tool?: string;
            };
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ActivityEventListResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getActivityEvent: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ActivityEventResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listAdapters: {
        parameters: {
            query?: {
                /** @description Opaque cursor from pageInfo.nextCursor */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size */
                limit?: components["parameters"]["Limit"];
            };
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdapterInfoListResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getAdapterHealth: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdapterHealthResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getAdapterLogs: {
        parameters: {
            query?: {
                /** @description Minimum level */
                level?: "debug" | "info" | "warn" | "error";
                /** @description Maximum number of lines (newest kept) */
                limit?: number;
            };
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdapterLogListResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    restartAdapter: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ActionResult"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listAgents: {
        parameters: {
            query?: {
                /** @description Opaque cursor from pageInfo.nextCursor */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size */
                limit?: components["parameters"]["Limit"];
                /** @description Name or role query */
                q?: string;
                /** @description Filter by status */
                status?: components["schemas"]["AgentStatus"][];
            };
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AgentListResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getAgent: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AgentResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    pauseAgent: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AgentResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    resumeAgent: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AgentResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    stopAgent: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AgentResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listApprovals: {
        parameters: {
            query?: {
                /** @description Filter by agent */
                agentId?: string;
                /** @description Opaque cursor from pageInfo.nextCursor */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size */
                limit?: components["parameters"]["Limit"];
                /** @description Filter by risk tier */
                riskTier?: components["schemas"]["RiskTier"][];
                /** @description Filter by status */
                status?: components["schemas"]["ApprovalStatus"][];
                /** @description Filter by task */
                taskId?: string;
                /** @description Filter by type */
                type?: components["schemas"]["ApprovalType"][];
            };
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApprovalListResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getApproval: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Approval-Token": components["headers"]["ApprovalToken"];
                    "X-Approval-Token-Expires": components["headers"]["ApprovalTokenExpires"];
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApprovalResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    approveApproval: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description Resource version for optimistic concurrency; a mismatch yields 409 CONFLICT. Set by the SDK callers. */
                "If-Match"?: components["parameters"]["IfMatch"];
                /** @description Short-lived, single-use approval token from GET /approvals/{id} (response header X-Approval-Token). The server rejects an approve without a valid token with 403 APPROVAL_REQUIRED (PLAN §32.5). */
                "X-Approval-Token"?: components["parameters"]["ApprovalToken"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["ApprovalDecisionRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApprovalResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    rejectApproval: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description Resource version for optimistic concurrency; a mismatch yields 409 CONFLICT. Set by the SDK callers. */
                "If-Match"?: components["parameters"]["IfMatch"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["ApprovalDecisionRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApprovalResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    requestApprovalContext: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ApprovalContextRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApprovalResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listAuditEvents: {
        parameters: {
            query?: {
                /** @description Action name prefix */
                action?: string;
                /** @description Actor id */
                actor?: string;
                /** @description Adapter */
                adapterId?: string;
                /** @description Agent */
                agentId?: string;
                /** @description Filter by category */
                category?: ("user_action" | "agent_action" | "tool_call" | "approval" | "system" | "security")[];
                /** @description Opaque cursor from pageInfo.nextCursor */
                cursor?: components["parameters"]["Cursor"];
                /** @description Start of time range */
                from?: string;
                /** @description Page size */
                limit?: components["parameters"]["Limit"];
                /** @description Filter by result */
                result?: ("success" | "failure" | "denied" | "pending")[];
                /** @description Filter by severity */
                severity?: components["schemas"]["Severity"][];
                /** @description Task */
                taskId?: string;
                /** @description End of time range */
                to?: string;
                /** @description Tool */
                tool?: string;
            };
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuditEventListResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getAuditEvent: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuditEventResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    exportAudit: {
        parameters: {
            query?: {
                /** @description Export format */
                format?: "json" | "ndjson" | "csv";
                /** @description Start of time range */
                from?: string;
                /** @description End of time range */
                to?: string;
            };
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Audit export */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuditEventListResponse"];
                    "application/x-ndjson": string;
                    "text/csv": string;
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    login: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LoginRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    /** @description HttpOnly, SameSite=Strict session cookie */
                    "Set-Cookie"?: string;
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    logout: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ActionResult"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    logoutAll: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ActionResult"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    reauth: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReauthRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReauthResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getSession: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listAutomations: {
        parameters: {
            query?: {
                /** @description Opaque cursor from pageInfo.nextCursor */
                cursor?: components["parameters"]["Cursor"];
                /** @description Filter by enabled flag */
                enabled?: boolean;
                /** @description Page size */
                limit?: components["parameters"]["Limit"];
                /** @description Name query */
                q?: string;
            };
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AutomationListResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    createAutomation: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AutomationCreateRequest"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    /** @description URL of the created resource */
                    Location?: string;
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AutomationResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getAutomation: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AutomationResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    updateAutomation: {
        parameters: {
            query?: never;
            header?: {
                /** @description Resource version for optimistic concurrency; a mismatch yields 409 CONFLICT. Set by the SDK callers. */
                "If-Match"?: components["parameters"]["IfMatch"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AutomationUpdateRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AutomationResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    disableAutomation: {
        parameters: {
            query?: never;
            header?: {
                /** @description Resource version for optimistic concurrency; a mismatch yields 409 CONFLICT. Set by the SDK callers. */
                "If-Match"?: components["parameters"]["IfMatch"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AutomationResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    enableAutomation: {
        parameters: {
            query?: never;
            header?: {
                /** @description Resource version for optimistic concurrency; a mismatch yields 409 CONFLICT. Set by the SDK callers. */
                "If-Match"?: components["parameters"]["IfMatch"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AutomationResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listAutomationRuns: {
        parameters: {
            query?: {
                /** @description Opaque cursor from pageInfo.nextCursor */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size */
                limit?: components["parameters"]["Limit"];
            };
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AutomationRunListResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    testAutomation: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["AutomationTestRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AutomationRunResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listAutomationVersions: {
        parameters: {
            query?: {
                /** @description Opaque cursor from pageInfo.nextCursor */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size */
                limit?: components["parameters"]["Limit"];
            };
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AutomationVersionListResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    pauseAllAutomations: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["AutomationPauseAllRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AutomationPauseAllResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listCalendarBriefings: {
        parameters: {
            query?: {
                /** @description Opaque cursor from pageInfo.nextCursor */
                cursor?: components["parameters"]["Cursor"];
                /** @description Briefing for one event */
                eventId?: string;
                /** @description Page size */
                limit?: components["parameters"]["Limit"];
            };
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CalendarBriefingListResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    createCalendarEvent: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CalDavEventCreateRequest"];
            };
        };
        responses: {
            /** @description Confirmed creation or permanently unknown outcome; replay never resends */
            200: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CalDavEventCreateResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    previewCalDavEvent: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CalDavEventPreviewRequest"];
            };
        };
        responses: {
            /** @description Owner-bound short-lived confirmation token and canonical preview */
            200: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CalDavEventPreviewResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            422: components["responses"]["UnprocessableEntity"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listCalendarConflicts: {
        parameters: {
            query?: {
                /** @description Opaque cursor from pageInfo.nextCursor */
                cursor?: components["parameters"]["Cursor"];
                /** @description Start of range */
                from?: string;
                /** @description Page size */
                limit?: components["parameters"]["Limit"];
                /** @description End of range */
                to?: string;
            };
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CalendarConflictListResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    confirmVoiceConnectedCalendar: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["VoiceConnectedCalendarConfirm"];
            };
        };
        responses: {
            /** @description Provider result, including explicitly uncertain writes */
            200: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CalendarAccountActionResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            409: components["responses"]["Conflict"];
        };
    };
    previewVoiceConnectedCalendar: {
        parameters: {
            query?: never;
            header?: {
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["VoiceConnectedCalendarRequest"];
            };
        };
        responses: {
            /** @description Preview and confirmation token */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CalendarAccountActionResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            409: components["responses"]["Conflict"];
        };
    };
    listCalendarEvents: {
        parameters: {
            query?: {
                /** @description Opaque cursor from pageInfo.nextCursor */
                cursor?: components["parameters"]["Cursor"];
                /** @description Start of range (inclusive) */
                from?: string;
                /** @description Page size */
                limit?: components["parameters"]["Limit"];
                /** @description Title query */
                q?: string;
                /** @description End of range (exclusive) */
                to?: string;
            };
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CalendarEventListResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getCalendarEvent: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CalendarEventResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    createLocalCalendarEvent: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LocalEventRequest"];
            };
        };
        responses: {
            /** @description Created local event */
            201: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CalendarEventResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
        };
    };
    updateLocalCalendarEvent: {
        parameters: {
            query?: never;
            header?: {
                /** @description Resource version for optimistic concurrency; a mismatch yields 409 CONFLICT. Set by the SDK callers. */
                "If-Match"?: components["parameters"]["IfMatch"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LocalEventRequest"];
            };
        };
        responses: {
            /** @description Updated local event */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CalendarEventResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
        };
    };
    deleteLocalCalendarEvent: {
        parameters: {
            query?: never;
            header?: {
                /** @description Resource version for optimistic concurrency; a mismatch yields 409 CONFLICT. Set by the SDK callers. */
                "If-Match"?: components["parameters"]["IfMatch"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deleted local event */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CalendarEventResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
        };
    };
    confirmVoiceLocalCalendar: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["VoiceLocalConfirmRequest"];
            };
        };
        responses: {
            /** @description Updated or deleted local event */
            200: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CalendarEventResponse"];
                };
            };
            /** @description Created local event */
            201: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CalendarEventResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
        };
    };
    previewVoiceLocalCalendar: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["VoiceLocalRequest"];
            };
        };
        responses: {
            /** @description Canonical event to read aloud before confirming */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VoiceLocalPreviewResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
        };
    };
    createCalendarProposal: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CalendarProposalRequest"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    /** @description URL of the created resource */
                    Location?: string;
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CalendarProposalResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getCapabilities: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Capabilities"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    createCodingRun: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CodingRunRequest"];
            };
        };
        responses: {
            /** @description Friday accepted the asynchronous native CLI run */
            202: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CodingRunResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            422: components["responses"]["UnprocessableEntity"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getCodingRun: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                runId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Current native runner state */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CodingRunResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    stopCodingRun: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                runId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Stop request acknowledged */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CodingRunResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getCodingCliStatus: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Local CLI status; no provider request or model invocation */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CodingCliStatusResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    createVoiceCodingRun: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["VoiceCodingRunRequest"];
            };
        };
        responses: {
            /** @description Native CLI run accepted */
            202: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CodingRunResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
        };
    };
    getCodingVoiceRepository: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Current alias and canonical repository */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CodingVoiceRepositoryResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    putCodingVoiceRepository: {
        parameters: {
            query?: never;
            header?: {
                /** @description Resource version for optimistic concurrency; a mismatch yields 409 CONFLICT. Set by the SDK callers. */
                "If-Match"?: components["parameters"]["IfMatch"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CodingVoiceRepositoryPatch"];
            };
        };
        responses: {
            /** @description Saved alias */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CodingVoiceRepositoryResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
        };
    };
    executeCommand: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CommandRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CommandResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listCommandHistory: {
        parameters: {
            query?: {
                /** @description Opaque cursor from pageInfo.nextCursor */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size */
                limit?: components["parameters"]["Limit"];
            };
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CommandHistoryEntryListResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    pauseCommand: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["CommandControlRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ActionResult"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    resumeCommand: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["CommandControlRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ActionResult"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    stopCommand: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["CommandControlRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ActionResult"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listChannels: {
        parameters: {
            query?: {
                /** @description Opaque cursor from pageInfo.nextCursor */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size */
                limit?: components["parameters"]["Limit"];
            };
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ChannelListResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listDrafts: {
        parameters: {
            query?: {
                /** @description Opaque cursor from pageInfo.nextCursor */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size */
                limit?: components["parameters"]["Limit"];
                /** @description Filter by draft status */
                status?: components["schemas"]["DraftStatus"][];
                /** @description Only drafts of this thread */
                threadId?: string;
            };
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DraftListResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    createDraft: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DraftCreateRequest"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    /** @description URL of the created resource */
                    Location?: string;
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DraftResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    updateDraft: {
        parameters: {
            query?: never;
            header?: {
                /** @description Resource version for optimistic concurrency; a mismatch yields 409 CONFLICT. Set by the SDK callers. */
                "If-Match"?: components["parameters"]["IfMatch"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DraftUpdateRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DraftResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    requestDraftSend: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description Resource version for optimistic concurrency; a mismatch yields 409 CONFLICT. Set by the SDK callers. */
                "If-Match"?: components["parameters"]["IfMatch"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["DraftSendRequest"];
            };
        };
        responses: {
            /** @description Accepted (approval required) */
            202: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApprovalResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listHimalayaEnvelopes: {
        parameters: {
            query: {
                mailbox: string;
                page?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HimalayaEnvelopeListResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            422: components["responses"]["UnprocessableEntity"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listHimalayaMailboxes: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HimalayaMailboxListResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getHimalayaMessage: {
        parameters: {
            query: {
                id: string;
                mailbox: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HimalayaMessageResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            422: components["responses"]["UnprocessableEntity"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    sendHimalayaMessage: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["HimalayaSendRequest"];
            };
        };
        responses: {
            /** @description Sent or permanently unknown SMTP result; replay never invokes SMTP again */
            200: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HimalayaSendResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    confirmVoiceMail: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["VoiceMailConfirmRequest"];
            };
        };
        responses: {
            /** @description Sent, changed, or unknown outcome */
            200: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VoiceMailConfirmResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
        };
    };
    previewVoiceMail: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["VoiceMailRequest"];
            };
        };
        responses: {
            /** @description Exact recipients, text and mailbox action to read aloud */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VoiceMailPreviewResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
        };
    };
    listThreads: {
        parameters: {
            query?: {
                /** @description Filter by channel */
                channelId?: string;
                /** @description Opaque cursor from pageInfo.nextCursor */
                cursor?: components["parameters"]["Cursor"];
                /** @description Only threads with a draft */
                hasDraft?: boolean;
                /** @description Page size */
                limit?: components["parameters"]["Limit"];
                /** @description Only threads that need a reply */
                needsReply?: boolean;
                /** @description Filter by priority */
                priority?: components["schemas"]["Priority"][];
                /** @description Full-text query */
                q?: string;
                /** @description Filter by thread status */
                status?: ("open" | "waiting" | "replied" | "archived")[];
            };
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ThreadListResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getThread: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ThreadResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    createElevenSpeech: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ElevenSpeechRequest"];
            };
        };
        responses: {
            /** @description MP3 audio */
            200: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "audio/mpeg": string;
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    createKieTask: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["KieTaskRequest"];
            };
        };
        responses: {
            /** @description Accepted by kie.ai; use task ID to read status */
            202: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["KieTaskResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getKieTask: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Task status */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["KieTaskResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getContentStudioPlan: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Current plan, or null when no plan has been saved */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ContentPlanStateResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    putContentStudioPlan: {
        parameters: {
            query?: never;
            header?: {
                /** @description Resource version for optimistic concurrency; a mismatch yields 409 CONFLICT. Set by the SDK callers. */
                "If-Match"?: components["parameters"]["IfMatch"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ContentPlanDocument"];
            };
        };
        responses: {
            /** @description Saved plan and new revision */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ContentPlanStateResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
        };
    };
    createContentProductionJob: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ContentProductionRequest"];
            };
        };
        responses: {
            /** @description Durable production job */
            202: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ContentProductionJobResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getContentProductionJob: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Job state */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ContentProductionJobResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    getContentProductionArtifact: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Finished MP4 artifact */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "video/mp4": string;
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    cancelContentProductionJob: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Cancelled job or already completed job */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ContentProductionJobResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    getDataRetentionStatus: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Last retention result */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DataRetentionStatusResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    performDataRetentionAction: {
        parameters: {
            query?: never;
            header?: {
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DataRetentionActionRequest"];
            };
        };
        responses: {
            /** @description Retention preview or run result */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DataRetentionActionResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    listScenarios: {
        parameters: {
            query?: {
                /** @description Opaque cursor from pageInfo.nextCursor */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size */
                limit?: components["parameters"]["Limit"];
            };
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScenarioListResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    playScenario: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScenarioStateResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    controlScenario: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ScenarioControlRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScenarioStateResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getScenarioState: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScenarioStateResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listFiles: {
        parameters: {
            query?: {
                /** @description Filter by category */
                category?: components["schemas"]["FileCategory"][];
                /** @description Opaque cursor from pageInfo.nextCursor */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size */
                limit?: components["parameters"]["Limit"];
                /** @description Name query */
                q?: string;
                /** @description Filter by tag */
                tag?: string;
                /** @description Filter by originating task */
                taskId?: string;
            };
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FileItemListResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getFile: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FileItemResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    deleteFile: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description Resource version for optimistic concurrency; a mismatch yields 409 CONFLICT. Set by the SDK callers. */
                "If-Match"?: components["parameters"]["IfMatch"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ActionResult"];
                };
            };
            /** @description Approval required before execution */
            202: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApprovalResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    renameFile: {
        parameters: {
            query?: never;
            header?: {
                /** @description Resource version for optimistic concurrency; a mismatch yields 409 CONFLICT. Set by the SDK callers. */
                "If-Match"?: components["parameters"]["IfMatch"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FileRenameRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FileItemResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    downloadFile: {
        parameters: {
            query?: {
                /** @description File version, default current */
                version?: number;
            };
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description File content */
            200: {
                headers: {
                    /** @description Attachment file name */
                    "Content-Disposition"?: string;
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getFilePreview: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FilePreviewResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getHealth: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Health"];
                };
            };
            400: components["responses"]["BadRequest"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listCalendarAccounts: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CalendarAccountActionResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    actOnCalendarAccount: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CalendarAccountAction"];
            };
        };
        responses: {
            /** @description Success or explicitly uncertain provider write */
            200: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CalendarAccountActionResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            409: components["responses"]["Conflict"];
        };
    };
    listMailAccounts: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MailAccountsResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    createMailAccount: {
        parameters: {
            query?: never;
            header?: {
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MailAccountWrite"];
            };
        };
        responses: {
            /** @description Created */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MailAccountResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    updateMailAccount: {
        parameters: {
            query?: never;
            header?: {
                /** @description Resource version for optimistic concurrency; a mismatch yields 409 CONFLICT. Set by the SDK callers. */
                "If-Match"?: components["parameters"]["IfMatch"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                accountId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MailAccountWrite"];
            };
        };
        responses: {
            /** @description Updated */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MailAccountResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            409: components["responses"]["Conflict"];
        };
    };
    deleteMailAccount: {
        parameters: {
            query?: never;
            header?: {
                /** @description Resource version for optimistic concurrency; a mismatch yields 409 CONFLICT. Set by the SDK callers. */
                "If-Match"?: components["parameters"]["IfMatch"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                accountId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Removed */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MailResultResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    getMailAttachment: {
        parameters: {
            query: {
                index: number;
                mailbox: string;
                uid: string;
                uidValidity: string;
            };
            header?: never;
            path: {
                accountId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MailAttachmentResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    changeMailMessage: {
        parameters: {
            query?: never;
            header?: {
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                accountId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MailChangeRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MailResultResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    checkMailAccount: {
        parameters: {
            query: {
                protocol: "imap" | "smtp";
            };
            header?: {
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                accountId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MailCheckResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    setDefaultMailAccount: {
        parameters: {
            query?: never;
            header?: {
                /** @description Resource version for optimistic concurrency; a mismatch yields 409 CONFLICT. Set by the SDK callers. */
                "If-Match"?: components["parameters"]["IfMatch"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                accountId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MailResultResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    saveMailDraft: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                accountId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MailDraftRequest"];
            };
        };
        responses: {
            /** @description Draft present in IMAP Drafts */
            200: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MailDraftResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    listMailEnvelopes: {
        parameters: {
            query: {
                mailbox: string;
                page?: number;
            };
            header?: never;
            path: {
                accountId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MailEnvelopesResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    listMailFolders: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                accountId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MailFolderResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    getMailMessage: {
        parameters: {
            query: {
                mailbox: string;
                uid: string;
                uidValidity: string;
            };
            header?: never;
            path: {
                accountId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MailMessageResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    pollMailOAuth: {
        parameters: {
            query?: never;
            header?: {
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                accountId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MailOAuthPoll"];
            };
        };
        responses: {
            /** @description Pending or connected */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MailOAuthResultResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    revokeMailOAuth: {
        parameters: {
            query?: never;
            header?: {
                /** @description Resource version for optimistic concurrency; a mismatch yields 409 CONFLICT. Set by the SDK callers. */
                "If-Match"?: components["parameters"]["IfMatch"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                accountId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Local grant removed */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MailAccountResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    startMailOAuth: {
        parameters: {
            query?: never;
            header?: {
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                accountId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Authorization instructions */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MailOAuthStartResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    listMailReceipts: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                accountId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MailReceiptsResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    reconcileMailArchive: {
        parameters: {
            query?: never;
            header?: {
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                accountId: string;
                receiptId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MailSendRequest"];
            };
        };
        responses: {
            /** @description Current receipt */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MailReceiptResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    reviewMailReceipt: {
        parameters: {
            query?: never;
            header?: {
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                accountId: string;
                receiptId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Current receipt */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MailReceiptResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    searchMailEnvelopes: {
        parameters: {
            query: {
                mailbox: string;
                page?: number;
                q: string;
            };
            header?: never;
            path: {
                accountId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MailEnvelopesResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    sendMailMessage: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                accountId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MailSendRequest"];
            };
        };
        responses: {
            /** @description Success or uncertain outcome */
            200: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MailSendResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    completeGoogleMailOAuth: {
        parameters: {
            query: {
                code: string;
                state: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OAuth connected */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MailOAuthResultResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
        };
    };
    backupDurableMemory: {
        parameters: {
            query?: never;
            header?: {
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DurableMemoryBackupResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    captureDurableMemoryEvent: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["IntegrationEvent"];
            };
        };
        responses: {
            /** @description Captured or already recorded */
            200: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DurableMemoryCaptureResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    forgetDurableMemoryEvent: {
        parameters: {
            query?: never;
            header?: {
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                eventId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DurableMemoryForgetResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    correctDurableMemoryEvent: {
        parameters: {
            query?: never;
            header?: {
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                eventId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DurableMemoryCorrectRequest"];
            };
        };
        responses: {
            /** @description Corrected event */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DurableMemoryCorrectResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    reindexDurableMemory: {
        parameters: {
            query?: never;
            header?: {
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Current writer and index status */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DurableMemoryStatusResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    restoreDurableMemory: {
        parameters: {
            query?: never;
            header?: {
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DurableMemoryRestoreRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DurableMemoryRestoreResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    retryDurableMemory: {
        parameters: {
            query?: never;
            header?: {
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Current writer status */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DurableMemoryStatusResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    searchDurableMemory: {
        parameters: {
            query: {
                identityId: string;
                limit?: number;
                query: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DurableMemorySearchResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    putDurableMemorySettings: {
        parameters: {
            query?: never;
            header?: {
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DurableMemorySettingsPatch"];
            };
        };
        responses: {
            /** @description Applied settings */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DurableMemorySettingsResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    getDurableMemoryStatus: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DurableMemoryStatusResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    captureMessengerInbound: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MessengerInboundEvent"];
            };
        };
        responses: {
            /** @description Inbound classification */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MessengerInboundResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            422: components["responses"]["UnprocessableEntity"];
        };
    };
    getVoiceIntegrationStatus: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IntegrationStatusResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    searchLocations: {
        parameters: {
            query: {
                language?: "de" | "en";
                q: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Matching places, possibly empty */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationSearchResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listMemory: {
        parameters: {
            query?: {
                /** @description Opaque cursor from pageInfo.nextCursor */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size */
                limit?: components["parameters"]["Limit"];
                /** @description Only locked memories */
                locked?: boolean;
                /** @description Only pinned memories */
                pinned?: boolean;
                /** @description Keyword query */
                q?: string;
                /** @description Filter by sensitivity */
                sensitivity?: components["schemas"]["MemorySensitivity"][];
                /** @description Filter by tag */
                tag?: string;
                /** @description Filter by type */
                type?: components["schemas"]["MemoryType"][];
            };
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MemoryListResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    createMemory: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MemoryCreateRequest"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    /** @description URL of the created resource */
                    Location?: string;
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MemoryResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getMemory: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MemoryResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    deleteMemory: {
        parameters: {
            query?: never;
            header?: {
                /** @description Resource version for optimistic concurrency; a mismatch yields 409 CONFLICT. Set by the SDK callers. */
                "If-Match"?: components["parameters"]["IfMatch"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ActionResult"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    updateMemory: {
        parameters: {
            query?: never;
            header?: {
                /** @description Resource version for optimistic concurrency; a mismatch yields 409 CONFLICT. Set by the SDK callers. */
                "If-Match"?: components["parameters"]["IfMatch"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MemoryUpdateRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MemoryResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    resolveMemoryConflict: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description Resource version for optimistic concurrency; a mismatch yields 409 CONFLICT. Set by the SDK callers. */
                "If-Match"?: components["parameters"]["IfMatch"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                /** @description Id of the conflicting memory (MemoryConflict.memoryId) */
                conflictId: string;
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MemoryConflictResolveRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MemoryResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    exportMemory: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    /** @description attachment with the export file name */
                    "Content-Disposition"?: string;
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MemoryExport"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    searchMemory: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MemorySearchRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MemorySearchResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getMessengerCatalog: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Native transport catalog */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MessengerCatalogResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    confirmMessengerMessage: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MessengerConfirmRequest"];
            };
        };
        responses: {
            /** @description Delivery receipt */
            200: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MessengerReceiptResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    previewMessengerMessage: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MessengerDraft"];
            };
        };
        responses: {
            /** @description Preview */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MessengerPreviewResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            422: components["responses"]["UnprocessableEntity"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getMessengerProvider: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                platform: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Provider revision */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MessengerProviderResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            422: components["responses"]["UnprocessableEntity"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    updateMessengerProvider: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                platform: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MessengerProviderUpdate"];
            };
        };
        responses: {
            /** @description Provider save outcome */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MessengerProviderResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    applyMessengerProvider: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                platform: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MessengerProviderApply"];
            };
        };
        responses: {
            /** @description Observed gateway restart */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MessengerProviderResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listMessengerReceipts: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Receipts */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MessengerReceiptsResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    listMessengerSenders: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Observed senders */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MessengerSendersResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    linkMessengerSender: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Linked sender */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MessengerSenderResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    unlinkMessengerSender: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Unlinked sender */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MessengerSenderResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    listMessengerTargets: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Targets */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MessengerTargetsResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    registerMessengerTarget: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MessengerTargetRequest"];
            };
        };
        responses: {
            /** @description Target */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MessengerTargetResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            422: components["responses"]["UnprocessableEntity"];
        };
    };
    removeMessengerTarget: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Removed target */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MessengerTargetResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            422: components["responses"]["UnprocessableEntity"];
        };
    };
    getMeta: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Meta"];
                };
            };
            400: components["responses"]["BadRequest"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getMetrics: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example # HELP friday_http_requests_total HTTP requests handled
                     *     # TYPE friday_http_requests_total counter
                     *     friday_http_requests_total{method="GET",route="/api/v1/health",status="200"} 12
                     */
                    "text/plain": string;
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listNotifications: {
        parameters: {
            query?: {
                /** @description Filter by category */
                category?: string;
                /** @description Opaque cursor from pageInfo.nextCursor */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size */
                limit?: components["parameters"]["Limit"];
                /** @description Filter by priority */
                priority?: components["schemas"]["Priority"][];
                /** @description Filter by status */
                status?: ("open" | "acknowledged" | "snoozed" | "resolved")[];
            };
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationListResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    acknowledgeNotification: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description Resource version for optimistic concurrency; a mismatch yields 409 CONFLICT. Set by the SDK callers. */
                "If-Match"?: components["parameters"]["IfMatch"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["NotificationActionRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    resolveNotification: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description Resource version for optimistic concurrency; a mismatch yields 409 CONFLICT. Set by the SDK callers. */
                "If-Match"?: components["parameters"]["IfMatch"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["NotificationActionRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    snoozeNotification: {
        parameters: {
            query?: never;
            header?: {
                /** @description Resource version for optimistic concurrency; a mismatch yields 409 CONFLICT. Set by the SDK callers. */
                "If-Match"?: components["parameters"]["IfMatch"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NotificationSnoozeRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getOnboarding: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Current state including first-login defaults */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OnboardingResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    putOnboarding: {
        parameters: {
            query?: never;
            header?: {
                /** @description Resource version for optimistic concurrency; a mismatch yields 409 CONFLICT. Set by the SDK callers. */
                "If-Match"?: components["parameters"]["IfMatch"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["OnboardingUpdate"];
            };
        };
        responses: {
            /** @description Saved onboarding state */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OnboardingResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
        };
    };
    getOrbStatus: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrbSnapshotResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getOverview: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OverviewResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listResearchProjects: {
        parameters: {
            query?: {
                /** @description Opaque cursor from pageInfo.nextCursor */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size */
                limit?: components["parameters"]["Limit"];
                /** @description Topic query */
                q?: string;
            };
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ResearchProjectListResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    createResearchProject: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ResearchCreateRequest"];
            };
        };
        responses: {
            /** @description Source discovery recorded; project remains in review */
            201: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ResearchProjectResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getResearchProject: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ResearchProjectResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listResearchArtifacts: {
        parameters: {
            query?: {
                /** @description Opaque cursor from pageInfo.nextCursor */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size */
                limit?: components["parameters"]["Limit"];
            };
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ResearchArtifactListResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listResearchFindings: {
        parameters: {
            query?: {
                /** @description Opaque cursor from pageInfo.nextCursor */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size */
                limit?: components["parameters"]["Limit"];
            };
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ResearchFindingListResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listResearchSources: {
        parameters: {
            query?: {
                /** @description Opaque cursor from pageInfo.nextCursor */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size */
                limit?: components["parameters"]["Limit"];
            };
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ResearchSourceListResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getResearchProvider: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Current configuration */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ResearchProviderResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    updateResearchProvider: {
        parameters: {
            query?: never;
            header?: {
                /** @description Resource version for optimistic concurrency; a mismatch yields 409 CONFLICT. Set by the SDK callers. */
                "If-Match"?: components["parameters"]["IfMatch"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ResearchProviderUpdateRequest"];
            };
        };
        responses: {
            /** @description Saved configuration */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ResearchProviderResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            422: components["responses"]["UnprocessableEntity"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getSettings: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SettingsResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    updateSettings: {
        parameters: {
            query?: never;
            header?: {
                /** @description Resource version for optimistic concurrency; a mismatch yields 409 CONFLICT. Set by the SDK callers. */
                "If-Match"?: components["parameters"]["IfMatch"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SettingsPatch"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SettingsResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listAdapterSettings: {
        parameters: {
            query?: {
                /** @description Opaque cursor from pageInfo.nextCursor */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size */
                limit?: components["parameters"]["Limit"];
            };
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdapterConfigSettingsListResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    updateAdapterSettings: {
        parameters: {
            query?: never;
            header?: {
                /** @description Resource version for optimistic concurrency; a mismatch yields 409 CONFLICT. Set by the SDK callers. */
                "If-Match"?: components["parameters"]["IfMatch"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdapterConfigPatch"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdapterConfigSettingsResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    testAdapterSettings: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdapterTestResultResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getCloudTalk: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CloudTalkStatusResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    putCloudTalk: {
        parameters: {
            query?: never;
            header?: {
                /** @description Resource version for optimistic concurrency; a mismatch yields 409 CONFLICT. Set by the SDK callers. */
                "If-Match"?: components["parameters"]["IfMatch"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CloudTalkProfilePatch"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CloudTalkStatusResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
        };
    };
    getContentStudioKeys: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ContentStudioKeysResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    updateContentStudioKey: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ContentStudioKeyPatch"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ContentStudioKeysResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            422: components["responses"]["UnprocessableEntity"];
        };
    };
    getDiscordGateway: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DiscordGatewayResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    putDiscordGateway: {
        parameters: {
            query?: never;
            header?: {
                /** @description Resource version for optimistic concurrency; a mismatch yields 409 CONFLICT. Set by the SDK callers. */
                "If-Match"?: components["parameters"]["IfMatch"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DiscordGatewayPatch"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DiscordGatewayResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    exportSettings: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SettingsExport"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getHermesConfig: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Effective Hermes configuration */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HermesConfigStatusResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    patchHermesConfig: {
        parameters: {
            query?: never;
            header?: {
                /** @description Resource version for optimistic concurrency; a mismatch yields 409 CONFLICT. Set by the SDK callers. */
                "If-Match"?: components["parameters"]["IfMatch"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["HermesConfigPatch"];
            };
        };
        responses: {
            /** @description Persisted readback; live runtime application is unverified */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HermesConfigStatusResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    manageHermesMcpOAuth: {
        parameters: {
            query?: never;
            header?: {
                /** @description Resource version for optimistic concurrency; a mismatch yields 409 CONFLICT. Set by the SDK callers. */
                "If-Match"?: components["parameters"]["IfMatch"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["HermesMcpOAuthRequest"];
            };
        };
        responses: {
            /** @description OAuth flow state; configured means native tokens and config persisted, not a running session */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HermesMcpOAuthResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    probeHermesMcp: {
        parameters: {
            query?: never;
            header?: {
                /** @description Resource version for optimistic concurrency; a mismatch yields 409 CONFLICT. Set by the SDK callers. */
                "If-Match"?: components["parameters"]["IfMatch"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["HermesMcpProbeRequest"];
            };
        };
        responses: {
            /** @description One protocol handshake receipt, not a running Hermes session receipt */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HermesMcpProbeResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listHermesCronJobs: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Native job metadata; scheduler liveness remains unknown */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HermesCronJobsResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getHermesModelCatalog: {
        parameters: {
            query?: {
                providerId?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Provider picker and optional bounded model discovery; not an inference receipt */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HermesModelCatalogResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            422: components["responses"]["UnprocessableEntity"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getHermesSkillKeys: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HermesSkillKeysResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    updateHermesSkillKey: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["HermesSkillKeyPatch"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HermesSkillKeysResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            422: components["responses"]["UnprocessableEntity"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    checkHermesSkillKey: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                key: "AIRTABLE_API_KEY" | "NOTION_API_KEY";
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Transient provider check; does not prove resource access */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HermesSkillKeyCheckResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            422: components["responses"]["UnprocessableEntity"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getHimalayaAccount: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HimalayaAccountResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    putHimalayaAccount: {
        parameters: {
            query?: never;
            header?: {
                /** @description Resource version for optimistic concurrency; a mismatch yields 409 CONFLICT. Set by the SDK callers. */
                "If-Match"?: components["parameters"]["IfMatch"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["HimalayaAccountPatch"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HimalayaAccountResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    checkHimalayaSmtp: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Ephemeral connection check result */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HimalayaSmtpCheckResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    importSettings: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SettingsExport"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SettingsResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listLayouts: {
        parameters: {
            query?: {
                /** @description Opaque cursor from pageInfo.nextCursor */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size */
                limit?: components["parameters"]["Limit"];
            };
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LayoutListResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    importLayout: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LayoutImportRequest"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    /** @description URL of the created resource */
                    Location?: string;
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LayoutResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getObsidianVault: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ObsidianVaultResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    putObsidianVault: {
        parameters: {
            query?: never;
            header?: {
                /** @description Resource version for optimistic concurrency; a mismatch yields 409 CONFLICT. Set by the SDK callers. */
                "If-Match"?: components["parameters"]["IfMatch"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ObsidianVaultPatch"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ObsidianVaultResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getSettingsSchema: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SettingsSchemaResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getTelegramGateway: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TelegramGatewayResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    putTelegramGateway: {
        parameters: {
            query?: never;
            header?: {
                /** @description Resource version for optimistic concurrency; a mismatch yields 409 CONFLICT. Set by the SDK callers. */
                "If-Match"?: components["parameters"]["IfMatch"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TelegramGatewayPatch"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TelegramGatewayResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getTelephony: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TelephonyStatusResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    putTelephony: {
        parameters: {
            query?: never;
            header?: {
                /** @description Resource version for optimistic concurrency; a mismatch yields 409 CONFLICT. Set by the SDK callers. */
                "If-Match"?: components["parameters"]["IfMatch"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TelephonyProfilePatch"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TelephonyStatusResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listThemes: {
        parameters: {
            query?: {
                /** @description Opaque cursor from pageInfo.nextCursor */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size */
                limit?: components["parameters"]["Limit"];
            };
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ThemeListResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    importTheme: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ThemeImportRequest"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    /** @description URL of the created resource */
                    Location?: string;
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ThemeResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getWhatsappGateway: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WhatsappGatewayResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    putWhatsappGateway: {
        parameters: {
            query?: never;
            header?: {
                /** @description Resource version for optimistic concurrency; a mismatch yields 409 CONFLICT. Set by the SDK callers. */
                "If-Match"?: components["parameters"]["IfMatch"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WhatsappGatewayPatch"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WhatsappGatewayResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getWhatsappPairing: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WhatsappPairingResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    startWhatsappPairing: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WhatsappPairingStart"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WhatsappPairingResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            422: components["responses"]["UnprocessableEntity"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    cancelWhatsappPairing: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WhatsappPairingResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    logoutWhatsappGateway: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Remote logout confirmed */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WhatsappPairingResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    reconnectWhatsappGateway: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Restart requested */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WhatsappPairingResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getWikiPath: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WikiPathResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    putWikiPath: {
        parameters: {
            query?: never;
            header?: {
                /** @description Resource version for optimistic concurrency; a mismatch yields 409 CONFLICT. Set by the SDK callers. */
                "If-Match"?: components["parameters"]["IfMatch"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WikiPathPatch"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WikiPathResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listSkills: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Skill catalog with nullable runtime state */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SkillCatalogResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    setSkillActivation: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SkillActivationRequest"];
            };
        };
        responses: {
            /** @description Freshly observed skill state after Hermes toggle */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SkillResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listPowerPointDecks: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description At most 20 available decks */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PowerPointDeckListResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    createPowerPointDeck: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PowerPointDeckRequest"];
            };
        };
        responses: {
            /** @description Presentation created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PowerPointDeckResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            /** @description Invalid presentation content */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    downloadPowerPointDeck: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description PowerPoint file */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/vnd.openxmlformats-officedocument.presentationml.presentation": string;
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    createVoicePowerPointDeck: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PowerPointDeckRequest"];
            };
        };
        responses: {
            /** @description Presentation created or idempotently replayed */
            201: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PowerPointDeckResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getStatus: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FridayStatusResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getSystemBackupStatus: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Current backup status */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SystemBackupStatusResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    performSystemBackupAction: {
        parameters: {
            query?: never;
            header?: {
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SystemBackupActionRequest"];
            };
        };
        responses: {
            /** @description Backup action result */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SystemBackupActionResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    getSystemMetrics: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SystemMetricsResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listModelProviders: {
        parameters: {
            query?: {
                /** @description Opaque cursor from pageInfo.nextCursor */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size */
                limit?: components["parameters"]["Limit"];
            };
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ModelProviderListResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listServices: {
        parameters: {
            query?: {
                /** @description Opaque cursor from pageInfo.nextCursor */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size */
                limit?: components["parameters"]["Limit"];
            };
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ServiceListResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    runServiceHealthcheck: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HealthcheckResultResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listStorageVolumes: {
        parameters: {
            query?: {
                /** @description Opaque cursor from pageInfo.nextCursor */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size */
                limit?: components["parameters"]["Limit"];
            };
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StorageVolumeListResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listTasks: {
        parameters: {
            query?: {
                /** @description Filter by assigned agent */
                agentId?: string;
                /** @description Opaque cursor from pageInfo.nextCursor */
                cursor?: components["parameters"]["Cursor"];
                /** @description Only tasks due before this instant */
                dueBefore?: string;
                /** @description Filter by label */
                label?: string;
                /** @description Page size */
                limit?: components["parameters"]["Limit"];
                /** @description Filter by priority */
                priority?: components["schemas"]["Priority"][];
                /** @description Full-text query */
                q?: string;
                /** @description Sort order */
                sort?: "-updatedAt" | "updatedAt" | "priority" | "dueAt";
                /** @description Filter by status */
                status?: components["schemas"]["TaskStatus"][];
                /** @description Only tasks updated after this instant */
                updatedSince?: string;
            };
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskListResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    createTask: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description Set to true with X-Action-Preview-Id and the unchanged body to discard that draft without creating a task. */
                "X-Action-Preview-Cancel"?: "true";
                /** @description Exact server draft reference from the first task-create attempt; sending it confirms the unchanged request body. */
                "X-Action-Preview-Id"?: string;
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TaskCreateRequest"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    /** @description URL of the created resource */
                    Location?: string;
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskResponse"];
                };
            };
            /** @description Saved preview discarded; no task was created. */
            204: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getTask: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    updateTask: {
        parameters: {
            query?: never;
            header?: {
                /** @description Resource version for optimistic concurrency; a mismatch yields 409 CONFLICT. Set by the SDK callers. */
                "If-Match"?: components["parameters"]["IfMatch"];
                /** @description Set to true with the exact preview id and unchanged task update body to discard the draft. */
                "X-Action-Preview-Cancel"?: "true";
                "X-Action-Preview-Id"?: string;
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TaskUpdateRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskResponse"];
                };
            };
            /** @description The matching draft was discarded without updating the task. */
            204: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    assignTask: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description Resource version for optimistic concurrency; a mismatch yields 409 CONFLICT. Set by the SDK callers. */
                "If-Match"?: components["parameters"]["IfMatch"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TaskAssignRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    cancelTask: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description Resource version for optimistic concurrency; a mismatch yields 409 CONFLICT. Set by the SDK callers. */
                "If-Match"?: components["parameters"]["IfMatch"];
                /** @description Set to true with the exact preview id and unchanged cancellation body to discard the draft. */
                "X-Action-Preview-Cancel"?: "true";
                "X-Action-Preview-Id"?: string;
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["TaskActionRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskResponse"];
                };
            };
            /** @description The matching draft was discarded without cancelling the task. */
            204: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    provideTaskInput: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description Resource version for optimistic concurrency; a mismatch yields 409 CONFLICT. Set by the SDK callers. */
                "If-Match"?: components["parameters"]["IfMatch"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TaskInputRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    pauseTask: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description Resource version for optimistic concurrency; a mismatch yields 409 CONFLICT. Set by the SDK callers. */
                "If-Match"?: components["parameters"]["IfMatch"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["TaskActionRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    resumeTask: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description Resource version for optimistic concurrency; a mismatch yields 409 CONFLICT. Set by the SDK callers. */
                "If-Match"?: components["parameters"]["IfMatch"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["TaskActionRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    retryTask: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description Resource version for optimistic concurrency; a mismatch yields 409 CONFLICT. Set by the SDK callers. */
                "If-Match"?: components["parameters"]["IfMatch"];
                /** @description Set to true with the exact preview id and unchanged retry body to discard the draft. */
                "X-Action-Preview-Cancel"?: "true";
                "X-Action-Preview-Id"?: string;
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["TaskActionRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskResponse"];
                };
            };
            /** @description The matching draft was discarded without retrying the task. */
            204: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    submitFrontendTelemetry: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FrontendTelemetryBatch"];
            };
        };
        responses: {
            /** @description Accepted */
            202: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FrontendTelemetryReceiptResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    originateTelephonyCall: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TelephonyCallRequest"];
            };
        };
        responses: {
            /** @description Journal state */
            200: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TelephonyCallResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getTelephonyCall: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                callId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Journal state */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TelephonyCallResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    hangupTelephonyCall: {
        parameters: {
            query?: never;
            header?: {
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                callId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Journal state */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TelephonyCallResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    originateCloudTalkCall: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CloudTalkCallRequest"];
            };
        };
        responses: {
            /** @description Journal state */
            200: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CloudTalkCallResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    previewCloudTalkCall: {
        parameters: {
            query?: never;
            header?: {
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CloudTalkPreviewRequest"];
            };
        };
        responses: {
            /** @description Preview */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CloudTalkPreviewResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            422: components["responses"]["UnprocessableEntity"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    previewTelephonyCall: {
        parameters: {
            query?: never;
            header?: {
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TelephonyPreviewRequest"];
            };
        };
        responses: {
            /** @description Preview */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TelephonyPreviewResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            422: components["responses"]["UnprocessableEntity"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getBrowserAudioAvailability: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Browser audio bridge readiness */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BrowserAudioAvailability"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    listVoiceDevices: {
        parameters: {
            query?: {
                /** @description Opaque cursor from pageInfo.nextCursor */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size */
                limit?: components["parameters"]["Limit"];
            };
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VoiceDeviceListResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getVoiceEnrollment: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VoiceEnrollmentResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    deleteVoiceHistory: {
        parameters: {
            query: {
                /** @description Only delete entries older than this timestamp */
                before?: string;
                /** @description Must be true; protects against accidental deletion */
                confirm: boolean;
            };
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ActionResult"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getLinuxVoiceEnrollment: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Enrollment progress */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LinuxEnrollmentStatus"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    addLinuxVoiceSample: {
        parameters: {
            query?: never;
            header?: {
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LinuxEnrollmentSample"];
            };
        };
        responses: {
            /** @description Enrollment progress */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LinuxEnrollmentStatus"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    startLinuxVoiceTraining: {
        parameters: {
            query?: never;
            header?: {
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Enrollment progress */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LinuxEnrollmentStatus"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    getVoiceMetrics: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VoiceMetricsResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listVoiceProfiles: {
        parameters: {
            query?: {
                /** @description Opaque cursor from pageInfo.nextCursor */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size */
                limit?: components["parameters"]["Limit"];
            };
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VoiceProfileListResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    enrollVoiceProfile: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                /** @description Opaque resource id (prefix identifies the type) */
                id: components["parameters"]["PathId"];
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["VoiceEnrollRequest"];
            };
        };
        responses: {
            /** @description Enrollment job accepted */
            202: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    /** @description URL of the enrollment job */
                    Location?: string;
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VoiceEnrollmentResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getVoiceStatus: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VoiceStatusResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    stopVoice: {
        parameters: {
            query?: never;
            header?: {
                /** @description Repeated keys replay the stored response instead of executing again. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ActionResult"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    runVoiceTest: {
        parameters: {
            query?: never;
            header?: {
                /** @description Generated by the server when absent; echoed in the response. */
                "X-Correlation-Id"?: components["parameters"]["CorrelationId"];
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["VoiceTestRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    "X-Correlation-Id": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VoiceTestResultResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getWakeEnrollment: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Wake enrollment status */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WakeEnrollmentStatus"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    discardWakeEnrollment: {
        parameters: {
            query?: never;
            header?: {
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WakeEnrollmentJob"];
            };
        };
        responses: {
            /** @description Wake enrollment status */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WakeEnrollmentStatus"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    addWakeEnrollmentSample: {
        parameters: {
            query?: never;
            header?: {
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WakeEnrollmentSample"];
            };
        };
        responses: {
            /** @description Wake enrollment status */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WakeEnrollmentStatus"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    startWakeEnrollment: {
        parameters: {
            query?: never;
            header?: {
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WakeEnrollmentStart"];
            };
        };
        responses: {
            /** @description Wake enrollment status */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WakeEnrollmentStatus"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    trainWakeEnrollment: {
        parameters: {
            query?: never;
            header?: {
                /** @description CSRF double-submit token from GET /auth/session. Added automatically by the SDK on mutating requests. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WakeEnrollmentJob"];
            };
        };
        responses: {
            /** @description Wake enrollment status */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WakeEnrollmentStatus"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    getCurrentWeather: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Current or marked stale weather */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CurrentWeatherResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
}
