import { PORT_SPEC } from "@friday/adapter-core";
import { createHash } from "node:crypto";
import { CONTRACT_VERSION, type ActionResult, type CommandControlRequest, type CommandRequest, type CommandResponse } from "@friday/sdk";
import type { Handler } from "../http/context";
import type { OperationId } from "../http/route-types";
import { CommandHistoryStore } from "../db/stores";
import type { IntegrationEvent } from "../services/durable-memory";
import { controlLiveVoice, executeBuiltinIntent, matchBuiltinIntent } from "../services/command-intents";
import { parseTaskCreateIntent } from "../services/task-create-intent";
import { routeAgentTask, taskModelPreview } from "../services/task-model-routing";
import { parseTaskActionIntent, type TaskActionIntent } from "../services/task-action-intent";
import { taskCancelPreviewText } from "../services/task-cancel-preview";
import { parseCalendarActionIntent, type CalendarActionIntent } from "../services/calendar-action-intent";
import { derivedSubject, parseMailActionIntent, type MailActionIntent } from "../services/mail-action-intent";
import { parseMessengerActionIntent, type MessengerActionIntent } from "../services/messenger-action-intent";
import { parseAgentActionIntent, type AgentActionIntent } from "../services/agent-action-intent";
import { parseKnowledgeActionIntent, type KnowledgeActionIntent } from "../services/knowledge-action-intent";
import { assertMemoryWritable, assertRenameTargetFree, assertValidFileName, dispatchKnowledgeAction, fileDeleteAction, memoryLabel } from "./knowledge-actions";
import { dispatchAutomationAction } from "./automation-actions";
import { parseAutomationActionIntent, type AutomationActionIntent } from "../services/automation-action-intent";
import { parseResearchActionIntent } from "../services/research-action-intent";
import { executeResearchCommand } from "./research-actions";
import { executeSettingsContentMutation } from "./settings-content-actions";
import { parseSettingsContentMutationIntent } from "../services/settings-content-mutation-intent";
import { executeReadQuery, parseReadQueryIntent } from "../services/read-query-intent";
import { checkedLocalEvent, LocalCalendarService } from "../services/local-calendar";
import { checkedMailSend, type MailSendRequest } from "../services/mail-send";
import { checkedMessengerDraft, type MessengerSendDraft } from "../services/messenger-send";
import { captureMailSend } from "./mail-memory";
import { mailJournalKey } from "./mail-accounts";
import { parseClarificationChoice, type PendingCommandClarification } from "../services/pending-command-clarifications";
import { captureMessengerSend, messengerPreviewText } from "./messenger-send";
import { AGENT_LIFECYCLE_VERB, agentLifecyclePreviewText, assertAgentTransition, CODING_RUN_TERMINAL } from "./agent-actions";
import type { Agent } from "@friday/sdk";
import type { CalendarEvent } from "@friday/sdk";
import type { FileItem } from "@friday/sdk";
import type { Memory, MemoryUpdateRequest } from "@friday/sdk";
import type { Automation } from "@friday/sdk";
import { createId } from "@friday/observability";
import { conflict, forbidden, notFound, validationFailed, ApiError } from "../util/errors";
import { authorize } from "@friday/auth";
import { portHandler } from "./ports";
import type { NativeExecutableAction } from "../services/native-approval-requests";

const executeBase = portHandler("commands", "executeCommand", PORT_SPEC.commands.executeCommand);
const stopVoiceBase = portHandler("voice", "stopVoice", PORT_SPEC.voice.stopVoice);

async function executeTaskCreate(ctx: Parameters<Handler>[0], request: CommandRequest,
  body: NonNullable<ReturnType<typeof parseTaskCreateIntent>>): Promise<Awaited<ReturnType<Handler>>> {
  const ownerId = ctx.principal?.userId;
  if (!ownerId) throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung erforderlich." });
  const create = ctx.runtime.registry.getPort("tasks").createTask;
  if (!create) throw new ApiError({ code: "CAPABILITY_MISSING", message: "Aufgaben koennen derzeit nicht angelegt werden." });
  const action = { kind: "task.create" as const,
    body: routeAgentTask(body, ctx.runtime.settings.area("modelsRouting")), sourceBody: body };
  if (!request.confirm && request.previewId) {
    const stored = ctx.runtime.nativeApprovals.readAction(ownerId, request.previewId);
    if (!stored || stored.kind !== "task.create" || JSON.stringify(stored.sourceBody ?? stored.body) !== JSON.stringify(body))
      throw conflict("Der Entwurf passt nicht zur Aktion.");
    ctx.runtime.nativeApprovals.cancelDraft(ownerId, request.previewId, stored);
    return { status: 200, body: { contractVersion: CONTRACT_VERSION, commandId: createId("cmd"),
      correlationId: ctx.correlationId, riskTier: 2, status: "rejected", requiresConfirmation: false,
      previewText: null, approvalId: null, result: { message: "Entwurf verworfen." } } satisfies CommandResponse };
  }
  const requestKey = request.confirm ? request.previewId : ctx.correlationId;
  if (!requestKey) throw validationFailed("Eine bestaetigte Vorschau fehlt.", [{ path: "previewId", message: "erforderlich" }]);
  const policy = request.confirm
    ? ctx.runtime.nativeApprovals.confirm(ownerId, requestKey, action)
    : ctx.runtime.nativeApprovals.propose({ ownerId, requestKey, correlationId: ctx.correlationId, riskTier: 2,
        type: "system_change", action: `Aufgabe anlegen: ${body.title}`, rationale: "Lokale Aufgabe aus bestaetigtem Befehl",
        preview: { kind: "text", title: "Neue Aufgabe", body: body.title }, impacts: [], execution: action });
  const base = { contractVersion: CONTRACT_VERSION, commandId: createId("cmd"), correlationId: ctx.correlationId,
    riskTier: 2 as const };
  let response: CommandResponse;
  if (!request.confirm) {
    response = { ...base, status: "requires_confirmation", requiresConfirmation: true,
      previewText: `Aufgabe „${body.title}“ mit Prioritaet ${body.priority} anlegen?${taskModelPreview(action.body)}`, previewId: requestKey,
      approvalId: null, result: null };
  } else if (policy.approval) {
    response = { ...base, status: "requires_approval", requiresConfirmation: false, previewText: null,
      approvalId: policy.approval.id, result: { message: "Aufgabe wartet auf Freigabe.", targetRoute: `/approvals?approval=${policy.approval.id}` } };
  } else {
    const taskId = await ctx.runtime.nativeApprovals.executeWithoutApproval(ownerId, requestKey,
      async (actionToRun, idempotencyKey) => {
        if (actionToRun.kind !== "task.create") throw conflict("Die Bestaetigung passt nicht zum gespeicherten Entwurf.");
        return (await create({ body: actionToRun.body }, { ...ctx.mutation, idempotencyKey })).data.id;
      });
    response = { ...base, status: "executed", requiresConfirmation: false, previewText: null,
      approvalId: null, result: { message: "Aufgabe wurde angelegt.", taskId, targetRoute: `/tasks?task=${taskId}` } };
  }
  return { status: 200, body: response };
}

const TASK_REF_ID = /^task_[0-9A-Za-z]{26}$/;

const STATUS_LABEL: Readonly<Record<string, string>> = {
  triage: "Triage", todo: "Offen", ready: "Bereit", running: "In Arbeit", waiting: "Wartend",
  review: "In Pruefung", done: "Erledigt", failed: "Fehlgeschlagen", cancelled: "Abgebrochen",
};

/**
 * Resolves the spoken reference before anything is staged: a task id directly, an exact unique title via the task
 * list, or the single selected task of the command context. Unknown or ambiguous references fail here, not after a
 * preview was saved.
 */
async function resolveTaskRef(ctx: Parameters<Handler>[0], request: CommandRequest, ref: string | null) {
  const tasks = ctx.runtime.registry.getPort("tasks");
  if (ref === null) {
    const selected = request.context?.selectedIds ?? [];
    if (selected.length !== 1) {
      throw validationFailed("Welche Aufgabe ist gemeint? Bitte Titel, Kennung oder genau eine Auswahl angeben.",
        [{ path: "context.selectedIds", message: "genau eine Aufgabe erforderlich" }]);
    }
    return (await tasks.getTask({ id: selected[0]! }, ctx.call)).data;
  }
  if (TASK_REF_ID.test(ref)) return (await tasks.getTask({ id: ref }, ctx.call)).data;
  const matches = (await tasks.listTasks({ q: ref, limit: 50 }, ctx.call)).items
    .filter((task) => task.title.trim().toLowerCase() === ref.toLowerCase());
  if (matches.length === 0) throw notFound("Aufgabe", ref);
  if (matches.length > 1) throw conflict(`Mehrere Aufgaben passen zu „${ref}“. Bitte die Kennung angeben.`, { ref });
  return matches[0]!;
}

async function executeTaskAction(ctx: Parameters<Handler>[0], request: CommandRequest,
  intent: TaskActionIntent): Promise<Awaited<ReturnType<Handler>>> {
  const ownerId = ctx.principal?.userId;
  if (!ownerId) throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung erforderlich." });
  const tasks = ctx.runtime.registry.getPort("tasks");
  const write = intent.kind === "task.update" ? tasks.updateTask : intent.kind === "task.retry" ? tasks.retryTask : tasks.cancelTask;
  if (!write) {
    throw new ApiError({ code: "CAPABILITY_MISSING",
      message: intent.kind === "task.update" ? "Aufgaben koennen derzeit nicht geaendert werden."
        : intent.kind === "task.retry" ? "Aufgaben koennen derzeit nicht neu gestartet werden."
          : "Aufgaben koennen derzeit nicht abgebrochen werden." });
  }
  const task = await resolveTaskRef(ctx, request, intent.ref);
  if (!request.confirm && intent.kind === "task.cancel" && ["done", "failed", "cancelled"].includes(task.status)) {
    throw conflict(`Aufgabe ${task.id} ist bereits beendet (${task.status}) und kann nicht abgebrochen werden.`, { status: task.status });
  }
  if (!request.confirm && intent.kind === "task.retry" && !["failed", "cancelled", "waiting"].includes(task.status)) {
    throw conflict(`Aufgabe ${task.id} kann im Status ${task.status} nicht neu gestartet werden.`, { status: task.status });
  }
  const action: NativeExecutableAction = intent.kind === "task.update"
    ? { kind: "task.update", id: task.id, body: { status: intent.status } }
    : intent.kind === "task.retry" ? { kind: "task.retry", id: task.id } : { kind: "task.cancel", id: task.id };
  const actionText = intent.kind === "task.update" ? `Aufgabe aktualisieren: ${task.title}`
    : intent.kind === "task.retry" ? `Aufgabe erneut starten: ${task.title}` : `Aufgabe abbrechen: ${task.title}`;
  const previewText = intent.kind === "task.update"
    ? `Aufgabe „${task.title}“ als ${STATUS_LABEL[intent.status]} markieren?`
    : intent.kind === "task.retry" ? `Aufgabe „${task.title}“ erneut starten?` : taskCancelPreviewText(task);
  if (!request.confirm && request.previewId) {
    ctx.runtime.nativeApprovals.cancelDraft(ownerId, request.previewId, action);
    return { status: 200, body: { contractVersion: CONTRACT_VERSION, commandId: createId("cmd"),
      correlationId: ctx.correlationId, riskTier: 2, status: "rejected", requiresConfirmation: false,
      previewText: null, approvalId: null, result: { message: "Entwurf verworfen." } } satisfies CommandResponse };
  }
  const requestKey = request.confirm ? request.previewId : ctx.correlationId;
  if (!requestKey) throw validationFailed("Eine bestaetigte Vorschau fehlt.", [{ path: "previewId", message: "erforderlich" }]);
  const policy = request.confirm
    ? ctx.runtime.nativeApprovals.confirm(ownerId, requestKey, action)
    : ctx.runtime.nativeApprovals.propose({ ownerId, requestKey, correlationId: ctx.correlationId, riskTier: 2,
        type: "system_change", action: actionText, rationale: "Aufgabenaktion aus bestaetigtem Befehl",
        preview: { kind: "text", title: actionText, body: previewText }, impacts: [], execution: action });
  const base = { contractVersion: CONTRACT_VERSION, commandId: createId("cmd"), correlationId: ctx.correlationId,
    riskTier: 2 as const };
  let response: CommandResponse;
  if (!request.confirm) {
    response = { ...base, status: "requires_confirmation", requiresConfirmation: true,
      previewText, previewId: requestKey, approvalId: null, result: null };
  } else if (policy.approval) {
    response = { ...base, status: "requires_approval", requiresConfirmation: false, previewText: null,
      approvalId: policy.approval.id, result: { message: "Aufgabe wartet auf Freigabe.", targetRoute: `/approvals?approval=${policy.approval.id}` } };
  } else {
    const taskId = await ctx.runtime.nativeApprovals.executeWithoutApproval(ownerId, requestKey,
      async (actionToRun, idempotencyKey) => {
        const call = { ...ctx.mutation, idempotencyKey };
        if (actionToRun.kind === "task.update") {
          return (await tasks.updateTask!({ id: actionToRun.id, body: actionToRun.body }, call)).data.id;
        }
        if (actionToRun.kind === "task.cancel") {
          return (await tasks.cancelTask!({ id: actionToRun.id, body: actionToRun.body }, call)).data.id;
        }
        if (actionToRun.kind === "task.retry") {
          return (await tasks.retryTask!({ id: actionToRun.id, body: actionToRun.body }, call)).data.id;
        }
        throw conflict("Die Bestaetigung passt nicht zum gespeicherten Entwurf.");
      });
    response = { ...base, status: "executed", requiresConfirmation: false, previewText: null,
      approvalId: null, result: { message: intent.kind === "task.update" ? "Aufgabe wurde aktualisiert."
          : intent.kind === "task.retry" ? "Aufgabe wurde erneut gestartet." : "Aufgabe wurde abgebrochen.",
        taskId, targetRoute: `/tasks?task=${taskId}` } };
  }
  return { status: 200, body: response };
}

const EVENT_REF_ID = /^cal_[0-9A-Za-z]{26}$/;

/**
 * Resolves the spoken reference before anything is staged: an event id directly, an exact unique local title, or the
 * single selected event of the command context. Only Friday-local events are writable; unknown or ambiguous
 * references fail here, not after a preview was saved.
 */
function resolveEventRef(ctx: Parameters<Handler>[0], request: CommandRequest, ref: string | null,
  intent: Extract<CalendarActionIntent, { kind: "calendar.update" | "calendar.delete" }>): CalendarEvent {
  const calendar = new LocalCalendarService(ctx.runtime.db);
  const ownerId = ctx.principal!.userId;
  if (ref === null) {
    const selected = request.context?.selectedIds ?? [];
    if (selected.length !== 1) {
      throw validationFailed("Welcher Termin ist gemeint? Bitte Titel, Kennung oder genau eine Auswahl angeben.",
        [{ path: "context.selectedIds", message: "genau ein Termin erforderlich" }]);
    }
    return calendar.get(selected[0]!);
  }
  if (EVENT_REF_ID.test(ref)) return calendar.get(ref);
  const matches = calendar.findOwnerByTitle(ownerId, ref);
  if (matches.length === 0) throw notFound("Termin", ref);
  if (matches.length > 1) {
    if (matches.length > 4)
      throw conflict("Zu viele Termine passen. Bitte die Termin-ID oder ein eindeutigeres Suchwort angeben.", { ref, clarificationRequired: true, optionCount: 0 });
    const pending = ctx.runtime.pendingCommandClarifications.put(ownerId, ctx.principal!.sessionId, {
      kind: "calendar.clarify", intent,
      candidates: matches.map((event) => ({ id: event.id, version: event.version, title: event.title, start: event.start })),
    });
    const timeZone = ctx.runtime.settings.area("profile").timeZone;
    const choices = matches.map((event, index) => `${index + 1}) ${event.title}, ${deDateTime(event.start, timeZone)}`).join("; ");
    throw conflict(`Mehrere Termine passen zu „${ref}“: ${choices}. Antworte innerhalb von 5 Minuten mit der Optionsnummer oder Ordinalzahl.`,
      { ref, clarificationRequired: true, clarificationId: pending.id, optionCount: matches.length });
  }
  return matches[0]!;
}

const deDateTime = (iso: string, timeZone: string): string =>
  new Intl.DateTimeFormat("de-DE", { dateStyle: "full", timeStyle: "short", timeZone }).format(new Date(iso));

async function executeCalendarAction(ctx: Parameters<Handler>[0], request: CommandRequest,
  intent: CalendarActionIntent, sessionBinding?: string): Promise<Awaited<ReturnType<Handler>>> {
  const ownerId = ctx.principal?.userId;
  if (!ownerId) throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung erforderlich." });
  // Same permission as POST/PATCH/DELETE /calendar/local/events; otherwise an operator could write by voice what the
  // calendar page refuses, and even approve it.
  if (!authorize(ctx.principal!.role, "calendar.create").allowed)
    throw forbidden("Termine anlegen, verschieben und löschen darf wie im Kalender nur der Owner.", { requiredAction: "calendar.create" });
  let action: NativeExecutableAction;
  let actionText: string;
  let previewText: string;
  let doneMessage: string;
  if (intent.kind === "calendar.create") {
    const body = checkedLocalEvent({ title: intent.title, start: intent.start, end: intent.end, timeZone: intent.timeZone });
    action = { kind: "calendar.create", body };
    actionText = `Termin eintragen: ${body.title}`;
    previewText = `Termin „${body.title}“ am ${deDateTime(body.start, body.timeZone)} eintragen?`;
    doneMessage = "Termin wurde eingetragen.";
  } else if (intent.kind === "calendar.update") {
    const event = resolveEventRef(ctx, request, intent.ref, intent);
    const duration = Date.parse(event.end) - Date.parse(event.start);
    const body = checkedLocalEvent({ title: event.title, start: intent.start,
      end: new Date(Date.parse(intent.start) + duration).toISOString(), timeZone: event.timeZone });
    action = { kind: "calendar.update", id: event.id, version: event.version, body, ...(sessionBinding ? { sessionBinding } : {}) };
    actionText = `Termin verschieben: ${event.title}`;
    previewText = `Termin „${event.title}“ auf ${deDateTime(body.start, body.timeZone)} verschieben?`;
    doneMessage = "Termin wurde verschoben.";
  } else {
    const event = resolveEventRef(ctx, request, intent.ref, intent);
    action = { kind: "calendar.delete", id: event.id, version: event.version, snapshot: event, ...(sessionBinding ? { sessionBinding } : {}) };
    actionText = `Termin loeschen: ${event.title}`;
    previewText = `Termin „${event.title}“ loeschen?`;
    doneMessage = "Termin wurde geloescht.";
  }
  if (!request.confirm && request.previewId) {
    ctx.runtime.nativeApprovals.cancelDraft(ownerId, request.previewId, action);
    return { status: 200, body: { contractVersion: CONTRACT_VERSION, commandId: createId("cmd"),
      correlationId: ctx.correlationId, riskTier: 2, status: "rejected", requiresConfirmation: false,
      previewText: null, approvalId: null, result: { message: "Entwurf verworfen." } } satisfies CommandResponse };
  }
  const requestKey = request.confirm ? request.previewId : ctx.correlationId;
  if (!requestKey) throw validationFailed("Eine bestaetigte Vorschau fehlt.", [{ path: "previewId", message: "erforderlich" }]);
  const policy = request.confirm
    ? ctx.runtime.nativeApprovals.confirm(ownerId, requestKey, action)
    : ctx.runtime.nativeApprovals.propose({ ownerId, requestKey, correlationId: ctx.correlationId, riskTier: 2,
        type: "system_change", action: actionText, rationale: "Kalenderaktion aus bestaetigtem Befehl",
        preview: { kind: "text", title: actionText, body: previewText }, impacts: [], execution: action });
  const base = { contractVersion: CONTRACT_VERSION, commandId: createId("cmd"), correlationId: ctx.correlationId,
    riskTier: 2 as const };
  let response: CommandResponse;
  if (!request.confirm) {
    response = { ...base, status: "requires_confirmation", requiresConfirmation: true,
      previewText, previewId: requestKey, approvalId: null, result: null };
  } else if (policy.approval) {
    response = { ...base, status: "requires_approval", requiresConfirmation: false, previewText: null,
      approvalId: policy.approval.id, result: { message: "Termin wartet auf Freigabe.", targetRoute: `/approvals?approval=${policy.approval.id}` } };
  } else {
    await ctx.runtime.nativeApprovals.executeWithoutApproval(ownerId, requestKey,
      async (actionToRun) => {
        const calendar = new LocalCalendarService(ctx.runtime.db);
        if (actionToRun.kind === "calendar.create") return calendar.create(actionToRun.body, ownerId).id;
        if (actionToRun.kind === "calendar.update") {
          return calendar.update(actionToRun.id, actionToRun.body, ownerId, actionToRun.version).id;
        }
        if (actionToRun.kind === "calendar.delete") {
          calendar.delete(actionToRun.id, ownerId, actionToRun.version);
          return actionToRun.id;
        }
        throw conflict("Die Bestaetigung passt nicht zum gespeicherten Entwurf.");
      });
    response = { ...base, status: "executed", requiresConfirmation: false, previewText: null,
      approvalId: null, result: { message: doneMessage, targetRoute: "/calendar" } };
  }
  return { status: 200, body: response };
}

const MEMORY_REF_ID = /^mem_[0-9A-Za-z]{26}$/;
const FILE_REF_ID = /^file_[0-9A-Za-z]{26}$/;
const KNOWLEDGE_KINDS = new Set([
  "memory.create", "memory.update", "memory.delete", "memory.resolveConflict",
  "file.rename", "file.delete", "file.delete.gated",
]);

/**
 * Resolves the spoken reference before anything is staged: a memory id directly, an exact unique title via the live
 * memory list, or the single selected memory of the command context. Unknown or ambiguous references fail here.
 */
async function resolveMemoryRef(ctx: Parameters<Handler>[0], request: CommandRequest, ref: string | null): Promise<Memory> {
  const memory = ctx.runtime.registry.getPort("memory");
  if (ref === null) {
    const selected = request.context?.selectedIds ?? [];
    if (selected.length !== 1) {
      throw validationFailed("Welcher Gedächtniseintrag ist gemeint? Bitte Titel, Kennung oder genau eine Auswahl angeben.",
        [{ path: "context.selectedIds", message: "genau ein Eintrag erforderlich" }]);
    }
    return (await memory.getMemory({ id: selected[0]! }, ctx.call)).data;
  }
  if (MEMORY_REF_ID.test(ref)) return (await memory.getMemory({ id: ref }, ctx.call)).data;
  const wanted = ref.toLowerCase();
  const matches = (await memory.listMemory({ q: ref, limit: 50 }, ctx.call)).items
    .filter((entry) => (entry.title ?? "").trim().toLowerCase() === wanted || entry.content.trim().toLowerCase() === wanted);
  if (matches.length === 0) throw notFound("Gedächtniseintrag", ref);
  if (matches.length > 1) throw conflict(`Mehrere Gedächtniseinträge passen zu „${ref}“. Bitte die Kennung angeben.`, { ref });
  return matches[0]!;
}

/**
 * Resolves the spoken reference before anything is staged: a file id directly, an exact unique file name via the live
 * file list, or the single selected file of the command context. Unknown or ambiguous references fail here.
 */
async function resolveFileRef(ctx: Parameters<Handler>[0], request: CommandRequest, ref: string | null): Promise<FileItem> {
  const files = ctx.runtime.registry.getPort("files");
  if (ref === null) {
    const selected = request.context?.selectedIds ?? [];
    if (selected.length !== 1) {
      throw validationFailed("Welche Datei ist gemeint? Bitte Name, Kennung oder genau eine Auswahl angeben.",
        [{ path: "context.selectedIds", message: "genau eine Datei erforderlich" }]);
    }
    return (await files.getFile({ id: selected[0]! }, ctx.call)).data;
  }
  if (FILE_REF_ID.test(ref)) return (await files.getFile({ id: ref }, ctx.call)).data;
  const matches = (await files.listFiles({ q: ref, limit: 50 }, ctx.call)).items
    .filter((entry) => entry.name.trim().toLowerCase() === ref.toLowerCase());
  if (matches.length === 0) throw notFound("Datei", ref);
  if (matches.length > 1) throw conflict(`Mehrere Dateien passen zu „${ref}“. Bitte die Kennung angeben.`, { ref });
  return matches[0]!;
}

function knowledgeDone(action: NativeExecutableAction): { doneMessage: string; targetRoute: string } {
  switch (action.kind) {
    case "memory.create": return { doneMessage: "Gedaechtniseintrag wurde angelegt.", targetRoute: "/memory" };
    case "memory.update": return { doneMessage: "Gedaechtniseintrag wurde aktualisiert.", targetRoute: `/memory?memory=${action.id}` };
    case "memory.delete": return { doneMessage: "Gedaechtniseintrag wurde vergessen.", targetRoute: "/memory" };
    case "memory.resolveConflict": return { doneMessage: "Gedaechtniskonflikt wurde geloest.", targetRoute: `/memory?memory=${action.id}` };
    case "file.rename": return { doneMessage: "Datei wurde umbenannt.", targetRoute: "/files" };
    case "file.delete": return { doneMessage: "Datei wurde geloescht.", targetRoute: "/files" };
    case "file.delete.gated": return { doneMessage: "Datei-Loeschung wurde beim Adapter zur Freigabe angemeldet.", targetRoute: "/approvals" };
    default: throw conflict("Aktion ist nicht ausfuehrbar.");
  }
}

/**
 * Spoken file/knowledge actions run through the same native staged pipeline as the direct routes: exact-body
 * confirmation binds the draft, and the port call carries the pipeline idempotency key. The references resolve ONLY
 * against the live registry before staging (a saved draft binds confirmation and replay instead).
 */
async function executeKnowledgeAction(ctx: Parameters<Handler>[0], request: CommandRequest,
  intent: KnowledgeActionIntent): Promise<Awaited<ReturnType<Handler>>> {
  const ownerId = ctx.principal?.userId;
  if (!ownerId) throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung erforderlich." });
  const memory = ctx.runtime.registry.getPort("memory");
  const files = ctx.runtime.registry.getPort("files");
  let action: NativeExecutableAction;
  let actionText = "";
  let previewText = "";
  let doneMessage: string;
  let targetRoute: string;
  const stored = request.previewId ? ctx.runtime.nativeApprovals.readAction(ownerId, request.previewId) : null;
  if (stored && KNOWLEDGE_KINDS.has(stored.kind)) {
    // Confirmation or discard of a saved draft: the stored action binds; the target may be gone by now (deletion replay).
    action = stored;
    ({ doneMessage, targetRoute } = knowledgeDone(stored));
  } else {
    if (request.previewId) throw conflict("Der Entwurf passt nicht zur Aktion.");
    if (intent.kind === "memory.create") {
      if (!memory.createMemory || !ctx.runtime.capabilities().modules.memory.write) {
        throw new ApiError({ code: "CAPABILITY_MISSING", message: "Gedaechtniseintraege koennen derzeit nicht angelegt werden." });
      }
      const body = { type: "fact" as const, content: intent.content };
      action = { kind: "memory.create", body };
      actionText = `Gedaechtniseintrag anlegen: ${memoryLabel({ title: null, content: intent.content })}`;
      previewText = `Gedächtniseintrag „${intent.content.slice(0, 80)}“ anlegen?`;
      doneMessage = "Gedaechtniseintrag wurde angelegt.";
      targetRoute = "/memory";
    } else if (intent.kind === "memory.update" || intent.kind === "memory.confirm") {
      if (!memory.updateMemory || !ctx.runtime.capabilities().modules.memory.write) {
        throw new ApiError({ code: "CAPABILITY_MISSING", message: "Gedaechtniseintraege koennen derzeit nicht geaendert werden." });
      }
      const current = await resolveMemoryRef(ctx, request, intent.ref);
      const body: MemoryUpdateRequest = intent.kind === "memory.confirm" ? { confirm: true } : { content: intent.content };
      assertMemoryWritable(current, body);
      action = { kind: "memory.update", id: current.id, version: current.version, body };
      actionText = `Gedaechtniseintrag aktualisieren: ${memoryLabel(current)}`;
      previewText = intent.kind === "memory.confirm"
        ? `Gedächtniseintrag „${memoryLabel(current)}“ bestätigen?`
        : `Gedächtniseintrag „${memoryLabel(current)}“ aktualisieren?`;
      doneMessage = intent.kind === "memory.confirm" ? "Gedaechtniseintrag wurde bestaetigt." : "Gedaechtniseintrag wurde aktualisiert.";
      targetRoute = `/memory?memory=${current.id}`;
    } else if (intent.kind === "memory.delete") {
      if (!memory.deleteMemory || !ctx.runtime.capabilities().modules.memory.delete) {
        throw new ApiError({ code: "CAPABILITY_MISSING", message: "Gedaechtniseintraege koennen derzeit nicht vergessen werden." });
      }
      const current = await resolveMemoryRef(ctx, request, intent.ref);
      if (current.locked) throw conflict("Gesperrte Einträge können nicht gelöscht werden.", { locked: true });
      action = { kind: "memory.delete", id: current.id, version: current.version, title: current.title ?? null };
      actionText = `Gedaechtniseintrag vergessen: ${memoryLabel(current)}`;
      previewText = `Gedächtniseintrag „${memoryLabel(current)}“ vergessen? Die Löschung bleibt im Audit nachvollziehbar.`;
      doneMessage = "Gedaechtniseintrag wurde vergessen.";
      targetRoute = "/memory";
    } else if (intent.kind === "file.rename") {
      if (!files.renameFile || !ctx.runtime.capabilities().modules.files.rename) {
        throw new ApiError({ code: "CAPABILITY_MISSING", message: "Dateien koennen derzeit nicht umbenannt werden." });
      }
      const current = await resolveFileRef(ctx, request, intent.ref);
      assertValidFileName(intent.name);
      await assertRenameTargetFree(ctx, current, intent.name);
      action = { kind: "file.rename", id: current.id, version: current.version, body: { name: intent.name },
        previousName: current.name };
      actionText = `Datei umbenennen: ${current.name} -> ${intent.name}`;
      previewText = `Datei „${current.name}“ in „${intent.name}“ umbenennen?`;
      doneMessage = "Datei wurde umbenannt.";
      targetRoute = "/files";
    } else {
      if (!files.deleteFile || !ctx.runtime.capabilities().modules.files.delete) {
        throw new ApiError({ code: "CAPABILITY_MISSING", message: "Dateien koennen derzeit nicht geloescht werden." });
      }
      const current = await resolveFileRef(ctx, request, intent.ref);
      action = fileDeleteAction(current);
      actionText = `Datei loeschen: ${current.name}`;
      previewText = `Datei „${current.name}“ endgültig löschen?`;
      doneMessage = action.kind === "file.delete.gated"
        ? "Datei-Loeschung wurde beim Adapter zur Freigabe angemeldet." : "Datei wurde geloescht.";
      targetRoute = "/files";
    }
  }
  if (!request.confirm && request.previewId) {
    ctx.runtime.nativeApprovals.cancelDraft(ownerId, request.previewId, action);
    return { status: 200, body: { contractVersion: CONTRACT_VERSION, commandId: createId("cmd"),
      correlationId: ctx.correlationId, riskTier: 2, status: "rejected", requiresConfirmation: false,
      previewText: null, approvalId: null, result: { message: "Entwurf verworfen." } } satisfies CommandResponse };
  }
  const requestKey = request.confirm ? request.previewId : ctx.correlationId;
  if (!requestKey) throw validationFailed("Eine bestaetigte Vorschau fehlt.", [{ path: "previewId", message: "erforderlich" }]);
  const policy = request.confirm
    ? ctx.runtime.nativeApprovals.confirm(ownerId, requestKey, action)
    : ctx.runtime.nativeApprovals.propose({ ownerId, requestKey, correlationId: ctx.correlationId, riskTier: 2,
        type: "system_change", action: actionText, rationale: "Datei-/Wissensaktion aus bestaetigtem Befehl",
        preview: { kind: "text", title: actionText, body: previewText }, impacts: [], execution: action });
  const base = { contractVersion: CONTRACT_VERSION, commandId: createId("cmd"), correlationId: ctx.correlationId,
    riskTier: 2 as const };
  let response: CommandResponse;
  if (!request.confirm) {
    response = { ...base, status: "requires_confirmation", requiresConfirmation: true,
      previewText, previewId: requestKey, approvalId: null, result: null };
  } else if (policy.approval) {
    response = { ...base, status: "requires_approval", requiresConfirmation: false, previewText: null,
      approvalId: policy.approval.id,
      result: { message: "Aktion wartet auf Freigabe.", targetRoute: `/approvals?approval=${policy.approval.id}` } };
  } else {
    let approvalId: string | null = null;
    await ctx.runtime.nativeApprovals.executeWithoutApproval(ownerId, requestKey,
      async (actionToRun, idempotencyKey) => {
        const dispatched = await dispatchKnowledgeAction(ctx.runtime, actionToRun, { ...ctx.mutation, idempotencyKey });
        if (dispatched.result.kind === "file.approval") approvalId = dispatched.result.approval.id;
        return dispatched.receipt;
      });
    response = { ...base, status: "executed", requiresConfirmation: false, previewText: null, approvalId: null,
      result: { message: approvalId
        ? "Datei-Loeschung wurde beim Adapter zur Freigabe angemeldet."
        : doneMessage,
        targetRoute: approvalId ? `/approvals?approval=${approvalId}` : targetRoute } };
  }
  return { status: 200, body: response };
}

const AUTOMATION_REF_ID = /^auto_[0-9A-Za-z]{26}$/;
const AUTOMATION_KINDS = new Set([
  "automation.create", "automation.update", "automation.enable", "automation.disable",
  "automation.test", "automation.pauseAll",
]);

/**
 * Resolves the spoken reference before anything is staged: an automation id directly, an exact unique name via the
 * live automation list, or the single selected automation of the command context. Unknown or ambiguous references fail.
 */
async function resolveAutomationRef(ctx: Parameters<Handler>[0], request: CommandRequest, ref: string | null): Promise<Automation> {
  const automations = ctx.runtime.registry.getPort("automations");
  if (ref === null) {
    const selected = request.context?.selectedIds ?? [];
    if (selected.length !== 1) {
      throw validationFailed("Welche Automation ist gemeint? Bitte Name, Kennung oder genau eine Auswahl angeben.",
        [{ path: "context.selectedIds", message: "genau eine Automation erforderlich" }]);
    }
    return (await automations.getAutomation({ id: selected[0]! }, ctx.call)).data;
  }
  if (AUTOMATION_REF_ID.test(ref)) return (await automations.getAutomation({ id: ref }, ctx.call)).data;
  const matches = (await automations.listAutomations({ q: ref, limit: 50 }, ctx.call)).items
    .filter((entry) => entry.name.trim().toLowerCase() === ref.toLowerCase());
  if (matches.length === 0) throw notFound("Automation", ref);
  if (matches.length > 1) throw conflict(`Mehrere Automationen passen zu „${ref}“. Bitte die Kennung angeben.`, { ref });
  return matches[0]!;
}

function automationDone(action: NativeExecutableAction): { doneMessage: string; targetRoute: string } {
  switch (action.kind) {
    case "automation.create": return { doneMessage: "Automation wurde angelegt.", targetRoute: "/automations" };
    case "automation.update": return { doneMessage: "Automation wurde aktualisiert.", targetRoute: `/automations?automation=${action.id}` };
    case "automation.enable": return { doneMessage: "Automation wurde aktiviert.", targetRoute: `/automations?automation=${action.id}` };
    case "automation.disable": return { doneMessage: "Automation wurde deaktiviert.", targetRoute: `/automations?automation=${action.id}` };
    case "automation.test": return { doneMessage: "Automation wurde getestet.", targetRoute: `/automations?automation=${action.id}` };
    case "automation.pauseAll": return { doneMessage: "Alle Automationen wurden pausiert.", targetRoute: "/automations" };
    default: throw conflict("Aktion ist nicht ausfuehrbar.");
  }
}

/**
 * Spoken automation actions run through the same native staged pipeline as the direct routes: exact-body confirmation
 * binds the draft, and the port call carries the pipeline idempotency key. References resolve ONLY against the live
 * registry before staging (a saved draft binds confirmation and replay instead).
 */
async function executeAutomationAction(ctx: Parameters<Handler>[0], request: CommandRequest,
  intent: AutomationActionIntent): Promise<Awaited<ReturnType<Handler>>> {
  const ownerId = ctx.principal?.userId;
  if (!ownerId) throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung erforderlich." });
  const automations = ctx.runtime.registry.getPort("automations");
  const capabilities = ctx.runtime.capabilities().modules.automations;
  let action: NativeExecutableAction;
  let actionText = "";
  let previewText = "";
  let doneMessage: string;
  let targetRoute: string;
  const stored = request.previewId ? ctx.runtime.nativeApprovals.readAction(ownerId, request.previewId) : null;
  if (stored && AUTOMATION_KINDS.has(stored.kind)) {
    // Confirmation or discard of a saved draft: the stored action binds; the target may be gone by now.
    action = stored;
    ({ doneMessage, targetRoute } = automationDone(stored));
  } else {
    if (request.previewId) throw conflict("Der Entwurf passt nicht zur Aktion.");
    if (intent.kind === "automation.pauseAll") {
      if (!automations.pauseAllAutomations || !capabilities.pauseAll) {
        throw new ApiError({ code: "CAPABILITY_MISSING", message: "Automationen koennen derzeit nicht pausiert werden." });
      }
      const items = (await automations.listAutomations({ limit: 200 }, ctx.call)).items;
      const affected = items.filter((entry) => entry.enabled && !entry.paused).length;
      action = { kind: "automation.pauseAll", body: {} };
      actionText = "Alle Automationen pausieren";
      previewText = affected > 0 ? `Alle ${affected} aktiven Automationen pausieren?` : "Alle Automationen pausieren? Es sind keine aktiven Automationen betroffen.";
      doneMessage = "Alle Automationen wurden pausiert.";
      targetRoute = "/automations";
    } else {
      const current = await resolveAutomationRef(ctx, request, intent.ref);
      if (intent.kind === "automation.enable" || intent.kind === "automation.disable") {
        const enable = intent.kind === "automation.enable";
        if (!(enable ? automations.enableAutomation : automations.disableAutomation) ||
            !(enable ? capabilities.enable : capabilities.disable)) {
          throw new ApiError({ code: "CAPABILITY_MISSING",
            message: `Automationen koennen derzeit nicht ${enable ? "aktiviert" : "deaktiviert"} werden.` });
        }
        action = { kind: intent.kind, id: current.id, version: current.version };
        const verb = enable ? "aktivieren" : "deaktivieren";
        actionText = `Automation ${verb}: ${current.name}`;
        previewText = enable === current.enabled
          ? `Automation „${current.name}“ ist bereits ${enable ? "aktiviert" : "deaktiviert"} — trotzdem erneut ${verb}?`
          : `Automation „${current.name}“ ${verb}?`;
        doneMessage = enable ? "Automation wurde aktiviert." : "Automation wurde deaktiviert.";
      } else if (intent.kind === "automation.pause" || intent.kind === "automation.resume") {
        if (!automations.updateAutomation || !capabilities.update) {
          throw new ApiError({ code: "CAPABILITY_MISSING", message: "Automationen koennen derzeit nicht geaendert werden." });
        }
        const pause = intent.kind === "automation.pause";
        action = { kind: "automation.update", id: current.id, version: current.version, body: { paused: pause } };
        actionText = `Automation ${pause ? "pausieren" : "fortsetzen"}: ${current.name}`;
        previewText = pause
          ? (current.paused ? `Automation „${current.name}“ ist bereits pausiert — trotzdem erneut setzen?`
            : `Automation „${current.name}“ pausieren?`)
          : (current.paused ? `Automation „${current.name}“ fortsetzen?`
            : !current.enabled ? `Automation „${current.name}“ ist deaktiviert — trotzdem die Pausierung aufheben?`
            : `Automation „${current.name}“ läuft bereits — trotzdem erneut setzen?`);
        doneMessage = pause ? "Automation wurde pausiert." : "Automation wurde fortgesetzt.";
      } else {
        if (!automations.testAutomation || !capabilities.test) {
          throw new ApiError({ code: "CAPABILITY_MISSING", message: "Automationen koennen derzeit nicht getestet werden." });
        }
        action = { kind: "automation.test", id: current.id, body: {} };
        actionText = `Automation trocken testen: ${current.name}`;
        previewText = `Trockenlauf der Automation „${current.name}“? Bedingungen werden geprüft, nichts wird ausgeführt.`;
        doneMessage = "Automation wurde getestet.";
      }
      targetRoute = `/automations?automation=${current.id}`;
    }
  }
  if (!request.confirm && request.previewId) {
    ctx.runtime.nativeApprovals.cancelDraft(ownerId, request.previewId, action);
    return { status: 200, body: { contractVersion: CONTRACT_VERSION, commandId: createId("cmd"),
      correlationId: ctx.correlationId, riskTier: 2, status: "rejected", requiresConfirmation: false,
      previewText: null, approvalId: null, result: { message: "Entwurf verworfen." } } satisfies CommandResponse };
  }
  const requestKey = request.confirm ? request.previewId : ctx.correlationId;
  if (!requestKey) throw validationFailed("Eine bestaetigte Vorschau fehlt.", [{ path: "previewId", message: "erforderlich" }]);
  const policy = request.confirm
    ? ctx.runtime.nativeApprovals.confirm(ownerId, requestKey, action)
    : ctx.runtime.nativeApprovals.propose({ ownerId, requestKey, correlationId: ctx.correlationId, riskTier: 2,
        type: "system_change", action: actionText, rationale: "Automationsaktion aus bestaetigtem Befehl",
        preview: { kind: "text", title: actionText, body: previewText }, impacts: [], execution: action });
  const base = { contractVersion: CONTRACT_VERSION, commandId: createId("cmd"), correlationId: ctx.correlationId,
    riskTier: 2 as const };
  let response: CommandResponse;
  if (!request.confirm) {
    response = { ...base, status: "requires_confirmation", requiresConfirmation: true,
      previewText, previewId: requestKey, approvalId: null, result: null };
  } else if (policy.approval) {
    response = { ...base, status: "requires_approval", requiresConfirmation: false, previewText: null,
      approvalId: policy.approval.id,
      result: { message: "Aktion wartet auf Freigabe.", targetRoute: `/approvals?approval=${policy.approval.id}` } };
  } else {
    await ctx.runtime.nativeApprovals.executeWithoutApproval(ownerId, requestKey,
      async (actionToRun, idempotencyKey) =>
        (await dispatchAutomationAction(ctx.runtime, actionToRun, { ...ctx.mutation, idempotencyKey })).receipt);
    response = { ...base, status: "executed", requiresConfirmation: false, previewText: null, approvalId: null,
      result: { message: doneMessage, targetRoute } };
  }
  return { status: 200, body: response };
}

const MAIL_ADDRESS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
const MAIL_MESSAGE_ID = /^<[^<>\s@]+@[^<>\s@]+>$/;
const MAIL_SELECTED = /^([^:]+):([0-9]+)$/;

interface MailEnvelopeRef { id?: unknown; subject?: unknown; from?: unknown; date?: unknown }

/**
 * The spoken mail command never names an account: the configured default wins, a single configured account is the
 * implicit default, everything else fails before staging instead of guessing a mailbox.
 */
async function mailAccountFor(ctx: Parameters<Handler>[0]): Promise<string> {
  const catalog = await ctx.runtime.mailAccounts.list();
  const chosen = catalog.defaultAccountId && catalog.accounts.some((item) => item.id === catalog.defaultAccountId)
    ? catalog.defaultAccountId : catalog.accounts.length === 1 ? catalog.accounts[0]!.id : null;
  if (!chosen) throw validationFailed("Welches Mail Postfach ist gemeint? Bitte ein Standardpostfach festlegen.");
  return chosen;
}

/** Extracts the bare address from a From/Reply-To header; anything unclear stays unresolved, never guessed. */
function mailHeaderAddress(header: unknown): string | null {
  const value = String(header ?? "").trim();
  const candidate = value.includes("<") ? /^([^<>]*)<([^<>]+)>$/.exec(value)?.[2]?.trim() : value;
  if (!candidate || !MAIL_ADDRESS.test(candidate) || value.includes("\n") || value.includes("\r")) return null;
  return candidate;
}

function newestEnvelope(items: unknown[]): MailEnvelopeRef | null {
  const usable = (items as MailEnvelopeRef[]).filter((item) => item && item.id !== undefined);
  usable.sort((a, b) => Date.parse(String(b.date ?? 0)) - Date.parse(String(a.date ?? 0)));
  return usable[0] ?? null;
}

/**
 * A spoken recipient name is resolved against the INBOX senders of the account. Zero or several distinct addresses
 * fail before staging; exactly one wins. Addresses pass through unchanged.
 */
function mailRecipientChoices(items: unknown[]): Array<{ address: string; label: string }> {
  const addresses = new Map<string, { address: string; label: string }>();
  for (const item of items as MailEnvelopeRef[]) {
    const address = mailHeaderAddress(item?.from);
    if (!address) continue;
    const from = String(item?.from ?? "").trim();
    const display = /^([^<>]{1,120})\s*<[^<>]+>$/.exec(from)?.[1]?.trim().replace(/^"|"$/g, "");
    addresses.set(address.toLowerCase(), { address, label: display || address });
  }
  return [...addresses.values()];
}

async function resolveMailRecipient(ctx: Parameters<Handler>[0], accountId: string, recipient: string,
  intent: Extract<MailActionIntent, { kind: "mail.compose" }>): Promise<string> {
  if (MAIL_ADDRESS.test(recipient)) return recipient;
  const found = await ctx.runtime.mailAccounts.search(accountId, "INBOX", recipient, 1);
  const candidates = mailRecipientChoices(found.items);
  if (candidates.length === 0) throw notFound("Empfaenger", recipient);
  if (candidates.length > 4)
    throw conflict("Zu viele Empfaenger passen. Bitte die vollstaendige E-Mail-Adresse angeben.", { clarificationRequired: true, optionCount: 0 });
  if (candidates.length > 1) {
    const pending = ctx.runtime.pendingCommandClarifications.put(ctx.principal!.userId, ctx.principal!.sessionId, {
      kind: "mail.clarify", accountId, intent, candidates,
    });
    const choices = candidates.map((candidate, index) => `${index + 1}) ${candidate.label} <${candidate.address}>`).join("; ");
    throw conflict(`Mehrere Empfaenger passen zu „${recipient}“: ${choices}. Antworte innerhalb von 5 Minuten mit der Optionsnummer oder Ordinalzahl.`,
      { recipient, clarificationRequired: true, clarificationId: pending.id, optionCount: candidates.length });
  }
  return candidates[0]!.address;
}

interface MailReplyTarget { to: string; subject: string; inReplyTo: string; references: string }

/**
 * Resolves the reply destination before anything is staged: the newest INBOX mail of a uniquely matched sender, the
 * single selected "mailbox:uid" of the command context, or the newest INBOX mail overall. The header binding
 * (Reply-To, Message-Id, References) mirrors the voice reply path.
 */
async function resolveMailReplyTarget(ctx: Parameters<Handler>[0], request: CommandRequest,
  accountId: string, sender: string | null): Promise<MailReplyTarget> {
  let mailbox = "INBOX";
  let uid: string;
  let uidValidity: string;
  if (sender) {
    const found = await ctx.runtime.mailAccounts.search(accountId, "INBOX", sender, 1);
    const items = found.items as MailEnvelopeRef[];
    const senders = new Map<string, string>();
    for (const item of items) {
      const address = mailHeaderAddress(item?.from);
      if (address) senders.set(address.toLowerCase(), address);
    }
    if (senders.size === 0) throw notFound("Absender", sender);
    if (senders.size > 1) throw conflict(`Mehrere Absender passen zu „${sender}“. Bitte genauer nennen.`, { sender });
    const target = newestEnvelope(items);
    if (!target) throw notFound("Absender", sender);
    uid = String(target.id);
    uidValidity = found.uidValidity ?? "";
  } else {
    const selectedIds = request.context?.selectedIds ?? [];
    const selected = selectedIds.length === 1 ? MAIL_SELECTED.exec(selectedIds[0]!) : null;
    if (selected) {
      mailbox = selected[1]!;
      uid = selected[2]!;
      uidValidity = (await ctx.runtime.mailAccounts.envelopes(accountId, mailbox, 1)).uidValidity ?? "";
    } else {
      const listing = await ctx.runtime.mailAccounts.envelopes(accountId, "INBOX", 1);
      const target = newestEnvelope(listing.items as MailEnvelopeRef[]);
      if (!target) throw notFound("Mail", "Posteingang");
      uid = String(target.id);
      uidValidity = listing.uidValidity ?? "";
    }
  }
  if (!uidValidity) throw conflict("Die Ordnerkennung fehlt. Bitte die Mail im Dashboard erneut oeffnen.");
  const message = await ctx.runtime.mailAccounts.message(accountId, mailbox, uid, uidValidity);
  const to = mailHeaderAddress(message.replyTo ?? message.from);
  if (!to) throw conflict("Antwortadresse ist nicht eindeutig. Bitte im Dashboard antworten.");
  const originalId = String(message.messageId ?? "").trim();
  if (originalId && !MAIL_MESSAGE_ID.test(originalId))
    throw conflict("Nachrichtenkennung ist ungueltig. Bitte im Dashboard antworten.");
  const oldReferences = String(message.references ?? "").trim();
  const references = [oldReferences, originalId].filter(Boolean).join(" ");
  if (references.length > 2000 || (oldReferences && !oldReferences.split(/\s+/).every((value) => MAIL_MESSAGE_ID.test(value))))
    throw conflict("Antwortverlauf ist ungueltig. Bitte im Dashboard antworten.");
  const subject = String(message.subject ?? "");
  return { to, subject: /^re\s*:/i.test(subject) ? subject : "Re: " + subject, inReplyTo: originalId, references };
}

/**
 * Spoken compose/reply runs through the same staged pipeline as the mail routes: exact-body confirmation binds the
 * draft, and the send journal keeps SMTP at-most-once across confirmation, approval and replay.
 */
async function executeMailAction(ctx: Parameters<Handler>[0], request: CommandRequest,
  intent: MailActionIntent | null, sessionBinding?: string,
  stagedAction?: Extract<NativeExecutableAction, { kind: "mail.send" | "mail.send.clarified" }>): Promise<Awaited<ReturnType<Handler>>> {
  const ownerId = ctx.principal?.userId;
  if (!ownerId) throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung erforderlich." });
  const accountId = stagedAction?.accountId ?? await mailAccountFor(ctx);
  const stagedBody = stagedAction?.kind === "mail.send" ? stagedAction.body
    : stagedAction?.kind === "mail.send.clarified"
      ? ctx.runtime.encryptedClarifiedMailDrafts.read(ownerId, stagedAction.sessionBinding, stagedAction.draftId, stagedAction.intentHash)
      : null;
  const body: MailSendRequest | null = stagedBody ?? (intent?.kind === "mail.compose"
    ? checkedMailSend({ to: [await resolveMailRecipient(ctx, accountId, intent.recipient, intent)],
        subject: intent.subject ?? derivedSubject(intent.body), body: intent.body })
    : intent?.kind === "mail.reply" ? await (async () => {
        const target = await resolveMailReplyTarget(ctx, request, accountId, intent.sender);
        return checkedMailSend({ to: [target.to], subject: target.subject, body: intent.body,
          ...(target.inReplyTo ? { inReplyTo: target.inReplyTo } : {}),
          ...(target.references ? { references: target.references } : {}) });
      })() : null);
  if (!body) throw conflict("Gespeicherter Mailentwurf ist nicht mehr verfuegbar.");
  let action: NativeExecutableAction = stagedAction ?? { kind: "mail.send", accountId, body, ...(sessionBinding ? { sessionBinding } : {}) };
  let encryptedDraft: { id: string; expiresAt: number } | null = null;
  if (!stagedAction && sessionBinding) {
    const intentHash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    encryptedDraft = ctx.runtime.encryptedClarifiedMailDrafts.create(ownerId, sessionBinding, intentHash, body);
    action = { kind: "mail.send.clarified", accountId, draftId: encryptedDraft.id, intentHash, sessionBinding };
  }
  const actionText = `Mail senden: ${body.subject}`;
  const previewText = `E-Mail an ${body.to.join(", ")} senden? Betreff: „${body.subject}“`;
  if (!request.confirm && request.previewId) {
    ctx.runtime.nativeApprovals.cancelDraft(ownerId, request.previewId, action);
    if (action.kind === "mail.send.clarified") ctx.runtime.encryptedClarifiedMailDrafts.delete(ownerId, action.sessionBinding, action.draftId);
    return { status: 200, body: { contractVersion: CONTRACT_VERSION, commandId: createId("cmd"),
      correlationId: ctx.correlationId, riskTier: 2, status: "rejected", requiresConfirmation: false,
      previewText: null, approvalId: null, result: { message: "Entwurf verworfen." } } satisfies CommandResponse };
  }
  const requestKey = request.confirm ? request.previewId : ctx.correlationId;
  if (!requestKey) throw validationFailed("Eine bestaetigte Vorschau fehlt.", [{ path: "previewId", message: "erforderlich" }]);
  let policy;
  try {
    policy = request.confirm
      ? ctx.runtime.nativeApprovals.confirm(ownerId, requestKey, action)
      : ctx.runtime.nativeApprovals.propose({ ownerId, requestKey, correlationId: ctx.correlationId, riskTier: 2,
        type: "system_change", action: actionText, rationale: "E-Mail aus bestaetigtem Befehl",
        preview: { kind: "text", title: actionText, body: previewText }, impacts: [], execution: action });
  } catch (error) {
    if (encryptedDraft) ctx.runtime.encryptedClarifiedMailDrafts.delete(ownerId, sessionBinding!, encryptedDraft.id);
    throw error;
  }
  if (policy.approval && action.kind === "mail.send.clarified" && policy.approval.expiresAt) {
    ctx.runtime.encryptedClarifiedMailDrafts.extend(ownerId, action.sessionBinding, action.draftId,
      action.intentHash, Date.parse(policy.approval.expiresAt));
  }
  const base = { contractVersion: CONTRACT_VERSION, commandId: createId("cmd"), correlationId: ctx.correlationId,
    riskTier: 2 as const };
  let response: CommandResponse;
  if (!request.confirm) {
    response = { ...base, status: "requires_confirmation", requiresConfirmation: true,
      previewText, previewId: requestKey, approvalId: null, result: null };
  } else if (policy.approval) {
    response = { ...base, status: "requires_approval", requiresConfirmation: false, previewText: null,
      approvalId: policy.approval.id,
      result: { message: "E-Mail wartet auf Freigabe.", targetRoute: `/approvals?approval=${policy.approval.id}` } };
  } else {
    const receiptId = await ctx.runtime.nativeApprovals.executeWithoutApproval(ownerId, requestKey,
      async (actionToRun, idempotencyKey) => {
        if (actionToRun.kind === "mail.send") {
          await ctx.runtime.mailSend.send(actionToRun.accountId, actionToRun.body, ownerId, idempotencyKey);
          return ctx.runtime.mailSend.receipt(actionToRun.accountId, ownerId, idempotencyKey).receiptId;
        }
        if (actionToRun.kind === "mail.send.clarified") {
          const draftBody = ctx.runtime.encryptedClarifiedMailDrafts.consume(ownerId, actionToRun.sessionBinding,
            actionToRun.draftId, actionToRun.intentHash);
          if (!draftBody) throw conflict("Der verschluesselte Mailentwurf ist abgelaufen oder wurde bereits verwendet.");
          await ctx.runtime.mailSend.send(actionToRun.accountId, draftBody, ownerId, idempotencyKey);
          return ctx.runtime.mailSend.receipt(actionToRun.accountId, ownerId, idempotencyKey).receiptId;
        }
        throw conflict("Die Bestaetigung passt nicht zum gespeicherten Entwurf.");
      });
    const outcome = ctx.runtime.mailSend.outcomeFor(accountId, receiptId)
      ?? { state: "uncertain" as const, archivePending: false };
    const memoryCapture = captureMailSend(ctx, accountId, ownerId, ownerId, "dashboard", outcome.state,
      mailJournalKey(ownerId, requestKey));
    ctx.audit.after = { accountId, state: outcome.state, replayed: false, memoryCapture };
    response = { ...base, status: "executed", requiresConfirmation: false, previewText: null, approvalId: null,
      result: { message: outcome.state === "sent" ? "E-Mail wurde versendet." : "Versand unklar; bitte Mail-Eingang pruefen.",
        targetRoute: "/communication" } };
  }
  return { status: 200, body: response };
}

/**
 * A spoken messenger recipient resolves ONLY against the registered outbound targets of the sender: exact,
 * case-insensitive match on the stored platform recipient id. Zero matches fail 404, several fail 409 — a send to a
 * guessed recipient is never staged.
 */
function resolveMessengerRecipient(ctx: Parameters<Handler>[0], ownerId: string, platform: string,
  spoken: string | null): string {
  const targets = ctx.runtime.messengerSend.targets(ownerId).filter((target) => target.platform === platform);
  if (spoken) {
    const exact = targets.filter((target) => target.recipient.toLowerCase() === spoken.toLowerCase());
    if (exact.length === 0) throw notFound("Empfaenger", spoken);
    return exact[0]!.recipient;
  }
  if (targets.length === 0) throw notFound("Empfaenger", platform);
  if (targets.length > 1) throw conflict(`Mehrere Empfaenger sind für ${platform} registriert. Bitte genauer nennen.`,
    { platform });
  return targets[0]!.recipient;
}

/**
 * A spoken reply binds to the newest inbound observation (optionally platform-filtered); the observed chat must be a
 * registered outbound target, otherwise the reply fails honestly before staging.
 */
function resolveMessengerReplyTarget(ctx: Parameters<Handler>[0], ownerId: string,
  platform: string | null): { platform: string; recipient: string } {
  const observations = ctx.runtime.messengerInbound.observations();
  const candidates = platform ? observations.filter((entry) => entry.platform === platform) : observations;
  const latest = candidates[0];
  if (!latest) throw notFound("Nachricht", platform ?? "Eingang");
  const hit = ctx.runtime.messengerSend.targets(ownerId)
    .find((target) => target.platform === latest.platform && target.recipient === latest.chatId);
  if (!hit) throw notFound("Empfaenger", latest.chatId);
  return { platform: latest.platform, recipient: hit.recipient };
}

/**
 * Spoken messenger compose/reply runs through the same native staged pipeline as the messenger routes: exact-body
 * confirmation binds the draft, and the send journal keeps provider delivery at-most-once.
 */
async function executeMessengerAction(ctx: Parameters<Handler>[0], request: CommandRequest,
  intent: MessengerActionIntent): Promise<Awaited<ReturnType<Handler>>> {
  const ownerId = ctx.principal?.userId;
  if (!ownerId) throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung erforderlich." });
  const resolved = intent.kind === "messenger.send"
    ? { platform: intent.platform, recipient: resolveMessengerRecipient(ctx, ownerId, intent.platform, intent.recipient) }
    : resolveMessengerReplyTarget(ctx, ownerId, intent.platform);
  const draft: MessengerSendDraft = checkedMessengerDraft({ accountId: "default", platform: resolved.platform,
    recipient: resolved.recipient, text: intent.text });
  const action: NativeExecutableAction = { kind: "messenger.send", draft };
  const actionText = `Nachricht senden: ${draft.platform}/${draft.recipient}`;
  const previewText = messengerPreviewText(draft);
  // An unregistered recipient, an unconfigured channel or a dead gateway fails before any preview is staged.
  if (!request.confirm) await ctx.runtime.messengerSend.assertSendable(ownerId, draft);
  if (!request.confirm && request.previewId) {
    ctx.runtime.nativeApprovals.cancelDraft(ownerId, request.previewId, action);
    return { status: 200, body: { contractVersion: CONTRACT_VERSION, commandId: createId("cmd"),
      correlationId: ctx.correlationId, riskTier: 2, status: "rejected", requiresConfirmation: false,
      previewText: null, approvalId: null, result: { message: "Entwurf verworfen." } } satisfies CommandResponse };
  }
  const requestKey = request.confirm ? request.previewId : ctx.correlationId;
  if (!requestKey) throw validationFailed("Eine bestaetigte Vorschau fehlt.", [{ path: "previewId", message: "erforderlich" }]);
  const policy = request.confirm
    ? ctx.runtime.nativeApprovals.confirm(ownerId, requestKey, action)
    : ctx.runtime.nativeApprovals.propose({ ownerId, requestKey, correlationId: ctx.correlationId, riskTier: 2,
        type: "system_change", action: actionText, rationale: "Nachricht aus bestaetigtem Befehl",
        preview: { kind: "text", title: actionText, body: previewText }, impacts: [], execution: action });
  const base = { contractVersion: CONTRACT_VERSION, commandId: createId("cmd"), correlationId: ctx.correlationId,
    riskTier: 2 as const };
  let response: CommandResponse;
  if (!request.confirm) {
    response = { ...base, status: "requires_confirmation", requiresConfirmation: true,
      previewText, previewId: requestKey, approvalId: null, result: null };
  } else if (policy.approval) {
    response = { ...base, status: "requires_approval", requiresConfirmation: false, previewText: null,
      approvalId: policy.approval.id,
      result: { message: "Nachricht wartet auf Freigabe.", targetRoute: `/approvals?approval=${policy.approval.id}` } };
  } else {
    const receiptId = await ctx.runtime.nativeApprovals.executeWithoutApproval(ownerId, requestKey,
      async (actionToRun, idempotencyKey) => {
        if (actionToRun.kind !== "messenger.send") throw conflict("Die Bestaetigung passt nicht zum gespeicherten Entwurf.");
        const receipt = await ctx.runtime.messengerSend.sendStaged(ownerId, actionToRun.draft, idempotencyKey);
        return receipt.receiptId;
      });
    const receipt = ctx.runtime.messengerSend.receipt(ownerId, receiptId)
      ?? { receiptId, accountId: draft.accountId, platform: draft.platform, recipient: draft.recipient,
        state: "uncertain" as const, externalId: null, createdAt: new Date().toISOString(), replayed: false };
    const memoryCapture = captureMessengerSend(ctx, ownerId, receipt);
    ctx.audit.after = { platform: receipt.platform, state: receipt.state, replayed: false, memoryCapture };
    response = { ...base, status: "executed", requiresConfirmation: false, previewText: null, approvalId: null,
      result: { message: receipt.state === "sent" ? "Nachricht wurde versendet." : "Zustellung unklar; bitte den Kanal pruefen.",
        targetRoute: "/communication" } };
  }
  return { status: 200, body: response };
}

const squashAgentName = (value: string): string =>
  value.toLowerCase()
    .replaceAll("ä", "ae").replaceAll("ö", "oe").replaceAll("ü", "ue").replaceAll("ß", "ss")
    .replace(/\s+/g, " ").trim();

/**
 * A spoken agent reference resolves ONLY against the live registry: exact name, or the name base with the
 * -Agent suffix the seed personas carry ("Recherche-Agenten" matches "Recherche-Agent"). Zero matches fail 404,
 * several fail 409 — an action on a guessed agent is never staged.
 */
async function resolveAgentRef(ctx: Parameters<Handler>[0], ref: string): Promise<Agent> {
  const items = (await ctx.runtime.registry.getPort("agents").listAgents({ limit: 200 }, ctx.call)).items;
  const wanted = squashAgentName(ref);
  const base = wanted.replace(/[-\s]?agent(?:en)?$/, "").trim();
  const matches = items.filter((agent) => {
    const name = squashAgentName(agent.name);
    return name === wanted || name === `${base}-agent` || name === `${base} agent` ||
      name.replace(/[-\s]?agent$/, "").trim() === base;
  });
  if (matches.length === 0) throw notFound("Agent", ref);
  if (matches.length > 1) throw conflict(`Mehrere Agenten passen zu „${ref}“. Bitte genauer nennen.`, { ref });
  return matches[0]!;
}

/**
 * Spoken agent lifecycle, assignment and coding-run-stop intents run through the same native staged pipeline as the
 * agent routes: exact-body confirmation binds the action, the port call carries the pipeline idempotency key.
 */
async function executeAgentAction(ctx: Parameters<Handler>[0], request: CommandRequest,
  intent: AgentActionIntent): Promise<Awaited<ReturnType<Handler>>> {
  const ownerId = ctx.principal?.userId;
  if (!ownerId) throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung erforderlich." });
  const agents = ctx.runtime.registry.getPort("agents");
  let action: NativeExecutableAction;
  let actionText: string;
  let previewText: string;
  let doneMessage: string;
  let targetRoute: string;
  if (intent.kind === "codingrun.stop") {
    const selected = request.context?.selectedIds ?? [];
    const runId = selected.length === 1 ? selected[0]! : null;
    if (!runId) throw validationFailed("Welcher Coding-Lauf ist gemeint? Bitte genau einen Lauf auswaehlen.",
      [{ path: "context.selectedIds", message: "genau ein Lauf erforderlich" }]);
    if (!request.confirm) {
      const current = await ctx.runtime.codingRuns.status(runId);
      if (CODING_RUN_TERMINAL.includes(current.status)) {
        throw conflict(`Coding-Lauf ${runId} ist bereits beendet (${current.status}).`, { status: current.status });
      }
    }
    action = { kind: "codingrun.stop", id: runId };
    actionText = `Coding-Lauf abbrechen: ${runId}`;
    previewText = `Coding-Lauf ${runId} abbrechen? Laufende Arbeit wird beendet.`;
    doneMessage = "Coding-Lauf wurde abgebrochen.";
    targetRoute = "/skills";
  } else if (intent.kind === "agent.assign") {
    if (!agents.assignTask) throw new ApiError({ code: "CAPABILITY_MISSING",
      message: "Aufgaben koennen derzeit keinem Agenten zugewiesen werden." });
    const task = await resolveTaskRef(ctx, request, intent.taskRef);
    const agent = await resolveAgentRef(ctx, intent.agentRef);
    action = { kind: "agent.assign", id: task.id, body: { agentId: agent.id } };
    actionText = `Aufgabe zuweisen: ${task.title} an ${agent.name}`;
    previewText = `Aufgabe „${task.title}“ an ${agent.name} zuweisen?`;
    doneMessage = "Aufgabe wurde zugewiesen.";
    targetRoute = `/tasks?task=${task.id}`;
  } else {
    const capability = intent.kind === "agent.pause" ? "pause" as const
      : intent.kind === "agent.resume" ? "resume" as const : "stop" as const;
    const method = capability === "pause" ? agents.pauseAgent : capability === "resume" ? agents.resumeAgent : agents.stopAgent;
    if (!method) throw new ApiError({ code: "CAPABILITY_MISSING",
      message: `Agenten koennen derzeit nicht ${capability === "pause" ? "pausiert" : capability === "resume" ? "fortgesetzt" : "gestoppt"} werden.` });
    const agent = await resolveAgentRef(ctx, intent.ref);
    if (!request.confirm) assertAgentTransition(agent, capability);
    action = { kind: intent.kind, id: agent.id };
    actionText = `Agent ${AGENT_LIFECYCLE_VERB[capability]}: ${agent.name}`;
    previewText = agentLifecyclePreviewText(capability, agent.name);
    doneMessage = capability === "pause" ? "Agent wurde pausiert."
      : capability === "resume" ? "Agent wurde fortgesetzt." : "Agent wurde gestoppt.";
    targetRoute = "/agents";
  }
  if (!request.confirm && request.previewId) {
    ctx.runtime.nativeApprovals.cancelDraft(ownerId, request.previewId, action);
    return { status: 200, body: { contractVersion: CONTRACT_VERSION, commandId: createId("cmd"),
      correlationId: ctx.correlationId, riskTier: 2, status: "rejected", requiresConfirmation: false,
      previewText: null, approvalId: null, result: { message: "Entwurf verworfen." } } satisfies CommandResponse };
  }
  const requestKey = request.confirm ? request.previewId : ctx.correlationId;
  if (!requestKey) throw validationFailed("Eine bestaetigte Vorschau fehlt.", [{ path: "previewId", message: "erforderlich" }]);
  const policy = request.confirm
    ? ctx.runtime.nativeApprovals.confirm(ownerId, requestKey, action)
    : ctx.runtime.nativeApprovals.propose({ ownerId, requestKey, correlationId: ctx.correlationId, riskTier: 2,
        type: "system_change", action: actionText, rationale: "Agentenaktion aus bestaetigtem Befehl",
        preview: { kind: "text", title: actionText, body: previewText }, impacts: [], execution: action });
  const base = { contractVersion: CONTRACT_VERSION, commandId: createId("cmd"), correlationId: ctx.correlationId,
    riskTier: 2 as const };
  let response: CommandResponse;
  if (!request.confirm) {
    response = { ...base, status: "requires_confirmation", requiresConfirmation: true,
      previewText, previewId: requestKey, approvalId: null, result: null };
  } else if (policy.approval) {
    response = { ...base, status: "requires_approval", requiresConfirmation: false, previewText: null,
      approvalId: policy.approval.id,
      result: { message: "Aktion wartet auf Freigabe.", targetRoute: `/approvals?approval=${policy.approval.id}` } };
  } else {
    const targetId = await ctx.runtime.nativeApprovals.executeWithoutApproval(ownerId, requestKey,
      async (actionToRun, idempotencyKey) => {
        const call = { ...ctx.mutation, idempotencyKey };
        if (actionToRun.kind === "agent.pause") return (await agents.pauseAgent!({ id: actionToRun.id }, call)).data.id;
        if (actionToRun.kind === "agent.resume") return (await agents.resumeAgent!({ id: actionToRun.id }, call)).data.id;
        if (actionToRun.kind === "agent.stop") return (await agents.stopAgent!({ id: actionToRun.id }, call)).data.id;
        if (actionToRun.kind === "agent.assign") {
          return (await agents.assignTask!({ id: actionToRun.id, body: actionToRun.body }, call)).data.id;
        }
        if (actionToRun.kind === "codingrun.stop") return (await ctx.runtime.codingRuns.stop(actionToRun.id)).runId;
        throw conflict("Die Bestaetigung passt nicht zum gespeicherten Entwurf.");
      });
    response = { ...base, status: "executed", requiresConfirmation: false, previewText: null,
      approvalId: null, result: { message: doneMessage, targetRoute,
        ...(intent.kind === "agent.assign" ? { taskId: targetId } : {}) } };
  }
  return { status: 200, body: response };
}

function captureCommand(ctx: Parameters<Handler>[0], eventId: string, eventType: "user_utterance" | "assistant_response",
  text: string, outcome: IntegrationEvent["outcome"], privateInput: boolean): void {
  if (!ctx.principal) return;
  ctx.runtime.durableMemory.capture({
    eventId, contractVersion: CONTRACT_VERSION, eventType,
    actor: eventType === "user_utterance" ? { type: "user", id: ctx.principal.userId, role: null }
      : { type: "assistant", id: "friday", role: null },
    identityId: ctx.principal.userId, channel: requestChannel(ctx), sessionId: null,
    dialogId: ctx.correlationId, correlationId: ctx.correlationId,
    source: "dashboard/command", occurredAt: new Date().toISOString(), outcome,
    captureEligibility: privateInput ? "private" : "eligible", redaction: "required", payload: { kind: "text", text },
  });
}

function requestChannel(ctx: Parameters<Handler>[0]): string {
  const source = (ctx.body as CommandRequest).source;
  return source === "voice" ? "dashboard_voice" : "dashboard";
}

async function controlCommand(ctx: Parameters<Handler>[0], action: "stop" | "pause" | "resume"): Promise<Awaited<ReturnType<Handler>>> {
  const request = ctx.body as CommandControlRequest;
  let voiceError: string | null = null;
  let controlledVoice = false;
  if (ctx.runtime.config.adapters.voice.provider === "friday-voice-http" && (request.scope === "all" || request.scope === "voice")) {
    voiceError = await controlLiveVoice(ctx, action);
    controlledVoice = voiceError === null;
    // Keep the command adapter's task controls for scope=all; voice-only is already handled by the live service.
    if (request.scope === "voice") {
      const body: ActionResult = { contractVersion: CONTRACT_VERSION, accepted: controlledVoice, status: controlledVoice ? "completed" : "rejected", correlationId: ctx.correlationId, message: voiceError ?? `Voice: ${action}` };
      return { status: 200, body };
    }
  }
  const method = action === "stop" ? "stopCommand" : action === "pause" ? "pauseCommand" : "resumeCommand";
  const result = await portHandler("commands", method, PORT_SPEC.commands[method])(ctx);
  if (!controlledVoice && voiceError === null) return result;
  const taskResult = result.body as ActionResult;
  const accepted = controlledVoice && taskResult.accepted;
  const body: ActionResult = {
    ...taskResult,
    accepted,
    status: accepted ? taskResult.status : "rejected",
    message: [controlledVoice ? "Voice gesteuert" : voiceError, taskResult.message].filter(Boolean).join("; "),
  };
  return { ...result, body };
}

function sameTypedIntent(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function clarificationChoiceAttempt(text: string): boolean {
  return /^(?:(?:use|choose|select|pick|take|nimm|waehle|wähle|option)\s+)?(?:[1-9][0-9]?|(?:the\s+)?(?:first|second|third|fourth)(?:\s+one)?|(?:die\s+|der\s+|den\s+|das\s+)?(?:erste[nr]?|zweite[nr]?|dritte[nr]?|vierte[nr]?))[.!?]?$/i.test(text.trim());
}

async function resumeClarification(ctx: Parameters<Handler>[0], request: CommandRequest,
  pendingId: string, payload: Extract<PendingCommandClarification, { kind: "calendar.clarify" | "mail.clarify" }>, choice: number): Promise<Awaited<ReturnType<Handler>>> {
  const ownerId = ctx.principal!.userId;
  if (choice < 0 || choice >= payload.candidates.length) throw validationFailed("Diese Auswahl ist ungueltig. Bitte eine angezeigte Option waehlen.");
  const consumed = ctx.runtime.pendingCommandClarifications.consume(ownerId, ctx.principal!.sessionId, pendingId);
  if (!consumed || consumed.kind !== payload.kind) throw conflict("Die Klaerung ist abgelaufen oder wurde bereits verwendet. Bitte den Befehl erneut senden.");
  if (payload.kind === "calendar.clarify") {
    const reference = payload.intent.ref;
    if (!reference) throw conflict("Die Kalenderreferenz ist nicht mehr eindeutig. Bitte den Titel erneut senden.");
    const calendar = new LocalCalendarService(ctx.runtime.db);
    const current = calendar.findOwnerByTitle(ownerId, reference);
    const prior = payload.candidates;
    if (current.length !== prior.length || current.some((event) => !prior.some((candidate) => candidate.id === event.id && candidate.version === event.version)))
      throw conflict("Die Termine haben sich seit der Klaerung geaendert. Bitte den Befehl erneut senden.");
    const chosen = prior[choice];
    if (!chosen) throw validationFailed("Diese Auswahl ist nicht verfuegbar. Bitte eine angezeigte Option waehlen.");
    const intent = { ...payload.intent, ref: chosen.id };
    const sessionBinding = ctx.runtime.pendingCommandClarifications.sessionBinding(ownerId, ctx.principal!.sessionId);
    const result = await executeCalendarAction(ctx, request, intent, sessionBinding);
    const response = result.body as CommandResponse;
    if (response.status === "requires_confirmation" && response.previewId) {
      ctx.runtime.pendingCommandClarifications.put(ownerId, ctx.principal!.sessionId, {
        kind: "calendar.confirm", previewId: response.previewId, choice,
        intent: payload.intent, selectedId: chosen.id,
      });
    }
    return result;
  }
  const currentAccountId = await mailAccountFor(ctx);
  if (currentAccountId !== payload.accountId) throw conflict("Das Mail-Postfach hat sich seit der Klaerung geaendert. Bitte den Befehl erneut senden.");
  const found = await ctx.runtime.mailAccounts.search(payload.accountId, "INBOX", payload.intent.recipient, 1);
  const currentChoices = mailRecipientChoices(found.items);
  const sameCandidates = currentChoices.length === payload.candidates.length
    && currentChoices.every((candidate) => payload.candidates.some((prior) => prior.address.toLowerCase() === candidate.address.toLowerCase()));
  if (!sameCandidates) throw conflict("Die Empfaengerliste hat sich seit der Klaerung geaendert. Bitte den Befehl erneut senden.");
  const chosen = payload.candidates[choice];
  if (!chosen) throw validationFailed("Diese Auswahl ist nicht verfuegbar. Bitte eine angezeigte Option waehlen.");
  const intent = { ...payload.intent, recipient: chosen.address };
  const sessionBinding = ctx.runtime.pendingCommandClarifications.sessionBinding(ownerId, ctx.principal!.sessionId);
  const result = await executeMailAction(ctx, request, intent, sessionBinding);
  const response = result.body as CommandResponse;
  if (response.status === "requires_confirmation" && response.previewId) {
    ctx.runtime.pendingCommandClarifications.put(ownerId, ctx.principal!.sessionId, {
      kind: "mail.confirm", previewId: response.previewId, choice,
      accountId: payload.accountId, intentHash: createHash("sha256").update(JSON.stringify(payload.intent)).digest("hex"),
      selectedAddress: chosen.address,
    });
  }
  return result;
}

async function resumeClarificationConfirmation(ctx: Parameters<Handler>[0], request: CommandRequest,
  pendingId: string, payload: Extract<PendingCommandClarification, { kind: "calendar.confirm" | "mail.confirm" }>): Promise<Awaited<ReturnType<Handler>>> {
  if (request.previewId !== payload.previewId) throw conflict("Die Bestaetigung gehoert nicht zu dieser geklaerten Vorschau.");
  if (payload.kind === "mail.confirm" && !request.confirm) {
    const sessionBinding = ctx.runtime.pendingCommandClarifications.sessionBinding(ctx.principal!.userId, ctx.principal!.sessionId);
    const staged = ctx.runtime.nativeApprovals.readAction(ctx.principal!.userId, payload.previewId);
    if (!staged || staged.kind !== "mail.send.clarified" || staged.sessionBinding !== sessionBinding
      || staged.accountId !== payload.accountId)
      throw conflict("Der verschluesselte Mailentwurf passt nicht mehr zur geklaerten Vorschau.");
    ctx.runtime.nativeApprovals.cancelDraft(ctx.principal!.userId, payload.previewId, staged);
    ctx.runtime.encryptedClarifiedMailDrafts.delete(ctx.principal!.userId, sessionBinding, staged.draftId);
    const consumed = ctx.runtime.pendingCommandClarifications.consume(ctx.principal!.userId, ctx.principal!.sessionId, pendingId);
    if (!consumed || consumed.kind !== "mail.confirm") throw conflict("Die geklaerte Vorschau wurde bereits verwendet.");
    return { status: 200, body: { contractVersion: CONTRACT_VERSION, commandId: createId("cmd"),
      correlationId: ctx.correlationId, riskTier: 2, status: "rejected", requiresConfirmation: false,
      previewText: null, approvalId: null, result: { message: "Entwurf verworfen." } } satisfies CommandResponse };
  }
  const timeZone = ctx.runtime.settings.area("profile").timeZone;
  const parsedCalendar = parseCalendarActionIntent(request.text, ctx.runtime.nowMs(), timeZone);
  const parsedMail = parseMailActionIntent(request.text);
  const matchingOriginal = payload.kind === "calendar.confirm"
    ? sameTypedIntent(parsedCalendar, payload.intent)
    : Boolean(parsedMail && createHash("sha256").update(JSON.stringify(parsedMail)).digest("hex") === payload.intentHash);
  const matchingChoice = parseClarificationChoice(request.text, 99) === payload.choice;
  if (!matchingOriginal && !matchingChoice)
    throw conflict("Der Befehl wurde seit der Vorschau geaendert. Bitte die geklaerte Aenderung erneut pruefen.");
  const consumed = ctx.runtime.pendingCommandClarifications.consume(ctx.principal!.userId, ctx.principal!.sessionId, pendingId);
  if (!consumed || consumed.kind !== payload.kind) throw conflict("Die geklaerte Vorschau ist abgelaufen oder wurde bereits verwendet.");
  const sessionBinding = ctx.runtime.pendingCommandClarifications.sessionBinding(ctx.principal!.userId, ctx.principal!.sessionId);
  if (payload.kind === "calendar.confirm")
    return executeCalendarAction(ctx, request, { ...payload.intent, ref: payload.selectedId }, sessionBinding);
  const currentAccountId = await mailAccountFor(ctx);
  if (currentAccountId !== payload.accountId) throw conflict("Das Mail-Postfach hat sich seit der Vorschau geaendert.");
  const staged = ctx.runtime.nativeApprovals.readAction(ctx.principal!.userId, payload.previewId);
  const stagedBody = staged?.kind === "mail.send.clarified"
    ? ctx.runtime.encryptedClarifiedMailDrafts.read(ctx.principal!.userId, staged.sessionBinding, staged.draftId, staged.intentHash) : null;
  if (!staged || staged.kind !== "mail.send.clarified" || staged.sessionBinding !== sessionBinding
    || staged.accountId !== payload.accountId || stagedBody?.to[0]?.toLowerCase() !== payload.selectedAddress.toLowerCase())
    throw conflict("Der gespeicherte Mailentwurf passt nicht mehr zur geklaerten Vorschau.");
  return executeMailAction(ctx, request, null, sessionBinding, staged);
}

/**
 * Commands are audited with their risk tier and outcome; the control-plane history stores sensitive texts redacted
 * (PLAN §43.5) and the audit trail never contains the command text of a sensitive command.
 */
export const commandHandlers: Partial<Record<OperationId, Handler>> = {
  async executeCommand(ctx) {
    const request = ctx.body as CommandRequest;
    const voiceResearch = ctx.voiceBridgeAuthorized ? parseResearchActionIntent(request.text) : null;
    if (ctx.voiceBridgeAuthorized && (request.source !== "voice" || !voiceResearch))
      throw new ApiError({ code: "FORBIDDEN", message: "Die Sprachkennung erlaubt hier nur Recherchebefehle." });
    const readQuery = parseReadQueryIntent(request.text);
    const settingsContentMutation = parseSettingsContentMutationIntent(request.text);
    const parsedMailIntent = parseMailActionIntent(request.text);
    const dialogPending = ctx.principal
      ? ctx.runtime.pendingCommandClarifications.read(ctx.principal.userId, ctx.principal.sessionId) : null;
    const dialogChoice = dialogPending && (dialogPending.payload.kind === "calendar.clarify" || dialogPending.payload.kind === "mail.clarify")
      ? parseClarificationChoice(request.text, dialogPending.payload.candidates.length) : null;
    const isDialogContinuation = Boolean(dialogPending && ((dialogChoice !== null)
      || ((dialogPending.payload.kind === "calendar.confirm" || dialogPending.payload.kind === "mail.confirm")
        && request.previewId === dialogPending.payload.previewId)));
    const sensitive = CommandHistoryStore.isSensitive(request.text) || readQuery !== null
      || settingsContentMutation !== null || parsedMailIntent !== null || isDialogContinuation;
    const privateInput = sensitive || isDialogContinuation
      || /nicht merken|do not store|private mode/i.test(request.text);
    captureCommand(ctx, `${ctx.correlationId}-u`, "user_utterance", request.text, "completed", privateInput);
    ctx.audit.action = "command.executed";
    let status = "failed";
    try {
      const taskCreate = settingsContentMutation ? null : parseTaskCreateIntent(request.text);
      const taskAction = taskCreate ? null : parseTaskActionIntent(request.text);
      const timeZone = ctx.runtime.settings.area("profile").timeZone;
      const calendarAction = taskCreate || taskAction ? null
        : parseCalendarActionIntent(request.text, ctx.runtime.nowMs(), timeZone);
      const knowledgeAction = taskCreate || taskAction || calendarAction ? null
        : parseKnowledgeActionIntent(request.text);
      const automationAction = taskCreate || taskAction || calendarAction || knowledgeAction ? null
        : parseAutomationActionIntent(request.text);
      const agentAction = taskCreate || taskAction || calendarAction || knowledgeAction || automationAction ? null
        : parseAgentActionIntent(request.text);
      const messengerAction = taskCreate || taskAction || calendarAction || agentAction || knowledgeAction || automationAction ? null
        : parseMessengerActionIntent(request.text);
      const mailAction = taskCreate || taskAction || calendarAction || agentAction || messengerAction || knowledgeAction || automationAction ? null
        : parseMailActionIntent(request.text);
      const researchAction = taskCreate || taskAction || calendarAction || agentAction || messengerAction || knowledgeAction || automationAction || mailAction ? null
        : parseResearchActionIntent(request.text);
      // Typed action parsers bind the full request, including free-text title/body/topic payloads. A read-shaped
      // phrase inside that payload must not replace the action that actually matched.
      const readQueryWins = Boolean(readQuery && !settingsContentMutation && !taskCreate && !taskAction && !calendarAction && !knowledgeAction
        && !automationAction && !agentAction && !messengerAction && !mailAction && !researchAction);
      const intent = request.confirm ? null : matchBuiltinIntent(request.text);
      if (dialogPending && (dialogPending.payload.kind === "calendar.clarify" || dialogPending.payload.kind === "mail.clarify")
        && dialogChoice === null && clarificationChoiceAttempt(request.text))
        throw validationFailed(`Bitte eine angezeigte Option von 1 bis ${dialogPending.payload.candidates.length} waehlen.`);
      const result = voiceResearch ? await executeResearchCommand(ctx, request, voiceResearch.topic)
        : dialogChoice !== null && dialogPending
          && (dialogPending.payload.kind === "calendar.clarify" || dialogPending.payload.kind === "mail.clarify")
          ? await resumeClarification(ctx, request, dialogPending.id, dialogPending.payload, dialogChoice)
          : isDialogContinuation && dialogPending
            && (dialogPending.payload.kind === "calendar.confirm" || dialogPending.payload.kind === "mail.confirm")
            ? await resumeClarificationConfirmation(ctx, request, dialogPending.id, dialogPending.payload)
        : settingsContentMutation ? await executeSettingsContentMutation(ctx, request, settingsContentMutation)
        : taskCreate ? await executeTaskCreate(ctx, request, taskCreate)
        : taskAction ? await executeTaskAction(ctx, request, taskAction)
        : calendarAction ? await executeCalendarAction(ctx, request, calendarAction)
        : knowledgeAction ? await executeKnowledgeAction(ctx, request, knowledgeAction)
        : automationAction ? await executeAutomationAction(ctx, request, automationAction)
        : agentAction ? await executeAgentAction(ctx, request, agentAction)
        : messengerAction ? await executeMessengerAction(ctx, request, messengerAction)
        : mailAction ? await executeMailAction(ctx, request, mailAction)
        : researchAction ? await executeResearchCommand(ctx, request, researchAction.topic)
        : readQueryWins ? await executeReadQuery(ctx, readQuery!)
        : intent ? await executeBuiltinIntent(ctx, intent, () => executeBase(ctx)) : await executeBase(ctx);
      const response = result.body as CommandResponse;
      status = response.status;
      ctx.audit.context = {
        commandId: response.commandId,
        status: response.status,
        riskTier: response.riskTier,
        approvalId: response.approvalId,
        source: request.source,
        ...(dialogChoice !== null ? { intent: "clarification_resolved" }
          : isDialogContinuation ? { intent: "clarification_confirmation" }
          : settingsContentMutation ? { intent: settingsContentMutation.kind.replaceAll(".", "_") }
          : readQueryWins ? { intent: `read_${readQuery!.kind}` } : intent ? { intent } : taskCreate ? { intent: "task_create" } : taskAction ? { intent: taskAction.kind.replace(".", "_") }
          : calendarAction ? { intent: calendarAction.kind.replace(".", "_") }
          : knowledgeAction ? { intent: knowledgeAction.kind.replace(".", "_") }
          : automationAction ? { intent: automationAction.kind.replace(".", "_") }
          : agentAction ? { intent: agentAction.kind.replace(".", "_") }
          : messengerAction ? { intent: messengerAction.kind.replace(".", "_") }
          : mailAction ? { intent: mailAction.kind.replace(".", "_") }
          : researchAction ? { intent: "research_create" } : {}),
        redacted: sensitive,
        ...(sensitive ? {} : { text: request.text.slice(0, 200) }),
      };
      if (response.approvalId) ctx.audit.approvalId = response.approvalId;
      const answer = response.result?.message ?? response.previewText;
      if (answer) captureCommand(ctx, `${ctx.correlationId}-a`, "assistant_response", answer,
        response.status === "executed" ? "completed" : "uncertain", privateInput);
      return result;
    } finally {
      ctx.runtime.stores.commands.record({
        id: ctx.correlationId.replace(/^corr_/, "cmdh_"),
        correlationId: ctx.correlationId,
        actor: ctx.actor.id,
        text: request.text,
        origin: request.source,
        status,
        createdAt: new Date().toISOString(),
        redact: sensitive,
      });
    }
  },

  async stopCommand(ctx) {
    ctx.audit.action = "command.stopped";
    return controlCommand(ctx, "stop");
  },

  async pauseCommand(ctx) {
    ctx.audit.action = "command.paused";
    return controlCommand(ctx, "pause");
  },

  async resumeCommand(ctx) {
    ctx.audit.action = "command.resumed";
    return controlCommand(ctx, "resume");
  },

  // friday-voice-http has no control channel of its own; the Control API holds the bridge key for /control/stop.
  async stopVoice(ctx) {
    if (ctx.runtime.config.adapters.voice.provider !== "friday-voice-http") return stopVoiceBase(ctx);
    ctx.audit.action = "voice.stopped";
    const voiceError = await controlLiveVoice(ctx, "stop");
    const body: ActionResult = { contractVersion: CONTRACT_VERSION, accepted: voiceError === null,
      status: voiceError === null ? "completed" : "rejected", correlationId: ctx.correlationId,
      message: voiceError ?? "Zuhören und Sprachausgabe gestoppt. F.R.I.D.A.Y. wartet auf das Aktivierungswort." };
    return { status: 200, body };
  },
};
