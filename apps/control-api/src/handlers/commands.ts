import { PORT_SPEC } from "@friday/adapter-core";
import { CONTRACT_VERSION, type ActionResult, type CommandControlRequest, type CommandRequest, type CommandResponse } from "@friday/sdk";
import type { Handler } from "../http/context";
import type { OperationId } from "../http/route-types";
import { CommandHistoryStore } from "../db/stores";
import type { IntegrationEvent } from "../services/durable-memory";
import { controlLiveVoice, executeBuiltinIntent, matchBuiltinIntent } from "../services/command-intents";
import { parseTaskCreateIntent } from "../services/task-create-intent";
import { parseTaskActionIntent, type TaskActionIntent } from "../services/task-action-intent";
import { parseCalendarActionIntent, type CalendarActionIntent } from "../services/calendar-action-intent";
import { derivedSubject, parseMailActionIntent, type MailActionIntent } from "../services/mail-action-intent";
import { checkedLocalEvent, LocalCalendarService } from "../services/local-calendar";
import { checkedMailSend, type MailSendRequest } from "../services/mail-send";
import { captureMailSend } from "./mail-memory";
import { mailJournalKey } from "./mail-accounts";
import type { CalendarEvent } from "@friday/sdk";
import { createId } from "@friday/observability";
import { conflict, notFound, validationFailed, ApiError } from "../util/errors";
import { portHandler } from "./ports";
import type { NativeExecutableAction } from "../services/native-approval-requests";

const executeBase = portHandler("commands", "executeCommand", PORT_SPEC.commands.executeCommand);

async function executeTaskCreate(ctx: Parameters<Handler>[0], request: CommandRequest,
  body: NonNullable<ReturnType<typeof parseTaskCreateIntent>>): Promise<Awaited<ReturnType<Handler>>> {
  const ownerId = ctx.principal?.userId;
  if (!ownerId) throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung erforderlich." });
  const create = ctx.runtime.registry.getPort("tasks").createTask;
  if (!create) throw new ApiError({ code: "CAPABILITY_MISSING", message: "Aufgaben koennen derzeit nicht angelegt werden." });
  const action = { kind: "task.create" as const, body };
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
        type: "system_change", action: `Aufgabe anlegen: ${body.title}`, rationale: "Lokale Aufgabe aus bestaetigtem Befehl",
        preview: { kind: "text", title: "Neue Aufgabe", body: body.title }, impacts: [], execution: action });
  const base = { contractVersion: CONTRACT_VERSION, commandId: createId("cmd"), correlationId: ctx.correlationId,
    riskTier: 2 as const };
  let response: CommandResponse;
  if (!request.confirm) {
    response = { ...base, status: "requires_confirmation", requiresConfirmation: true,
      previewText: `Aufgabe „${body.title}“ mit Prioritaet ${body.priority} anlegen?`, previewId: requestKey,
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
  const write = intent.kind === "task.update" ? tasks.updateTask : tasks.cancelTask;
  if (!write) {
    throw new ApiError({ code: "CAPABILITY_MISSING",
      message: intent.kind === "task.update" ? "Aufgaben koennen derzeit nicht geaendert werden."
        : "Aufgaben koennen derzeit nicht abgebrochen werden." });
  }
  const task = await resolveTaskRef(ctx, request, intent.ref);
  if (!request.confirm && intent.kind === "task.cancel" && ["done", "failed", "cancelled"].includes(task.status)) {
    throw conflict(`Aufgabe ${task.id} ist bereits beendet (${task.status}) und kann nicht abgebrochen werden.`, { status: task.status });
  }
  const action: NativeExecutableAction = intent.kind === "task.update"
    ? { kind: "task.update", id: task.id, body: { status: intent.status } }
    : { kind: "task.cancel", id: task.id };
  const actionText = intent.kind === "task.update" ? `Aufgabe aktualisieren: ${task.title}` : `Aufgabe abbrechen: ${task.title}`;
  const previewText = intent.kind === "task.update"
    ? `Aufgabe „${task.title}“ als ${STATUS_LABEL[intent.status]} markieren?`
    : `Aufgabe „${task.title}“ abbrechen?`;
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
        throw conflict("Die Bestaetigung passt nicht zum gespeicherten Entwurf.");
      });
    response = { ...base, status: "executed", requiresConfirmation: false, previewText: null,
      approvalId: null, result: { message: intent.kind === "task.update" ? "Aufgabe wurde aktualisiert." : "Aufgabe wurde abgebrochen.",
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
function resolveEventRef(ctx: Parameters<Handler>[0], request: CommandRequest, ref: string | null): CalendarEvent {
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
  if (matches.length > 1) throw conflict(`Mehrere Termine passen zu „${ref}“. Bitte die Kennung angeben.`, { ref });
  return matches[0]!;
}

const deDateTime = (iso: string, timeZone: string): string =>
  new Intl.DateTimeFormat("de-DE", { dateStyle: "full", timeStyle: "short", timeZone }).format(new Date(iso));

async function executeCalendarAction(ctx: Parameters<Handler>[0], request: CommandRequest,
  intent: CalendarActionIntent): Promise<Awaited<ReturnType<Handler>>> {
  const ownerId = ctx.principal?.userId;
  if (!ownerId) throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung erforderlich." });
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
    const event = resolveEventRef(ctx, request, intent.ref);
    const duration = Date.parse(event.end) - Date.parse(event.start);
    const body = checkedLocalEvent({ title: event.title, start: intent.start,
      end: new Date(Date.parse(intent.start) + duration).toISOString(), timeZone: event.timeZone });
    action = { kind: "calendar.update", id: event.id, version: event.version, body };
    actionText = `Termin verschieben: ${event.title}`;
    previewText = `Termin „${event.title}“ auf ${deDateTime(body.start, body.timeZone)} verschieben?`;
    doneMessage = "Termin wurde verschoben.";
  } else {
    const event = resolveEventRef(ctx, request, intent.ref);
    action = { kind: "calendar.delete", id: event.id, version: event.version, snapshot: event };
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
async function resolveMailRecipient(ctx: Parameters<Handler>[0], accountId: string, recipient: string): Promise<string> {
  if (MAIL_ADDRESS.test(recipient)) return recipient;
  const found = await ctx.runtime.mailAccounts.search(accountId, "INBOX", recipient, 1);
  const addresses = new Map<string, string>();
  for (const item of found.items as MailEnvelopeRef[]) {
    const address = mailHeaderAddress(item?.from);
    if (address) addresses.set(address.toLowerCase(), address);
  }
  if (addresses.size === 0) throw notFound("Empfaenger", recipient);
  if (addresses.size > 1) throw conflict(`Mehrere Empfaenger passen zu „${recipient}“. Bitte die Adresse angeben.`, { recipient });
  return [...addresses.values()][0]!;
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
  intent: MailActionIntent): Promise<Awaited<ReturnType<Handler>>> {
  const ownerId = ctx.principal?.userId;
  if (!ownerId) throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung erforderlich." });
  const accountId = await mailAccountFor(ctx);
  const body: MailSendRequest = intent.kind === "mail.compose"
    ? checkedMailSend({ to: [await resolveMailRecipient(ctx, accountId, intent.recipient)],
        subject: intent.subject ?? derivedSubject(intent.body), body: intent.body })
    : await (async () => {
        const target = await resolveMailReplyTarget(ctx, request, accountId, intent.sender);
        return checkedMailSend({ to: [target.to], subject: target.subject, body: intent.body,
          ...(target.inReplyTo ? { inReplyTo: target.inReplyTo } : {}),
          ...(target.references ? { references: target.references } : {}) });
      })();
  const action: NativeExecutableAction = { kind: "mail.send", accountId, body };
  const actionText = `Mail senden: ${body.subject}`;
  const previewText = `E-Mail an ${body.to.join(", ")} senden? Betreff: „${body.subject}“`;
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
        type: "system_change", action: actionText, rationale: "E-Mail aus bestaetigtem Befehl",
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
      result: { message: "E-Mail wartet auf Freigabe.", targetRoute: `/approvals?approval=${policy.approval.id}` } };
  } else {
    const receiptId = await ctx.runtime.nativeApprovals.executeWithoutApproval(ownerId, requestKey,
      async (actionToRun, idempotencyKey) => {
        if (actionToRun.kind !== "mail.send") throw conflict("Die Bestaetigung passt nicht zum gespeicherten Entwurf.");
        await ctx.runtime.mailSend.send(actionToRun.accountId, actionToRun.body, ownerId, idempotencyKey);
        return ctx.runtime.mailSend.receipt(actionToRun.accountId, ownerId, idempotencyKey).receiptId;
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

/**
 * Commands are audited with their risk tier and outcome; the control-plane history stores sensitive texts redacted
 * (PLAN §43.5) and the audit trail never contains the command text of a sensitive command.
 */
export const commandHandlers: Partial<Record<OperationId, Handler>> = {
  async executeCommand(ctx) {
    const request = ctx.body as CommandRequest;
    const sensitive = CommandHistoryStore.isSensitive(request.text);
    const privateInput = sensitive || /(?:dieses gespräch nicht speichern|nicht merken|do not store|private mode)/i.test(request.text);
    captureCommand(ctx, `${ctx.correlationId}-u`, "user_utterance", request.text, "completed", privateInput);
    ctx.audit.action = "command.executed";
    let status = "failed";
    try {
      const taskCreate = parseTaskCreateIntent(request.text);
      const taskAction = taskCreate ? null : parseTaskActionIntent(request.text);
      const timeZone = ctx.runtime.settings.area("profile").timeZone;
      const calendarAction = taskCreate || taskAction ? null
        : parseCalendarActionIntent(request.text, ctx.runtime.nowMs(), timeZone);
      const mailAction = taskCreate || taskAction || calendarAction ? null : parseMailActionIntent(request.text);
      const intent = request.confirm ? null : matchBuiltinIntent(request.text);
      const result = taskCreate ? await executeTaskCreate(ctx, request, taskCreate)
        : taskAction ? await executeTaskAction(ctx, request, taskAction)
        : calendarAction ? await executeCalendarAction(ctx, request, calendarAction)
        : mailAction ? await executeMailAction(ctx, request, mailAction)
        : intent ? await executeBuiltinIntent(ctx, intent, () => executeBase(ctx)) : await executeBase(ctx);
      const response = result.body as CommandResponse;
      status = response.status;
      ctx.audit.context = {
        commandId: response.commandId,
        status: response.status,
        riskTier: response.riskTier,
        approvalId: response.approvalId,
        source: request.source,
        ...(intent ? { intent } : taskCreate ? { intent: "task_create" } : taskAction ? { intent: taskAction.kind.replace(".", "_") }
          : calendarAction ? { intent: calendarAction.kind.replace(".", "_") }
          : mailAction ? { intent: mailAction.kind.replace(".", "_") } : {}),
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
};
