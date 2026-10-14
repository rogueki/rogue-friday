import type { ActivityEvent, ActivityKind, Severity } from "@jarvis/sdk";
import { createId, type MapContext } from "@jarvis/adapter-core";
import { correlationFor, type AgentIds, type TaskIds } from "./ids";
import { isoFromSeconds, truncate } from "./task-mapping";
import type { WireEvent, WireMessage, WireSession } from "./wire";

// Field tables: docs/MAPPING/hermes.md §6.2

/** An activity event before the buffer assigns its adapter-local `sequence`. */
export type ActivityDraft = Omit<ActivityEvent, "sequence">;

const SUMMARY_MAX = 160;

const KANBAN_TITLES: Readonly<Record<string, string>> = {
  created: "Aufgabe angelegt",
  commented: "Aufgabe kommentiert",
  blocked: "Aufgabe blockiert",
  unblocked: "Aufgabe freigegeben",
  completed: "Aufgabe abgeschlossen",
  edited: "Aufgabe bearbeitet",
  archived: "Aufgabe archiviert",
  reclaimed: "Aufgabe zurückgeholt",
  review_requested: "Prüfung angefordert",
  scheduled: "Aufgabe geplant",
  promoted_manual: "Aufgabe manuell hochgestuft",
  claim_rejected: "Übernahme abgelehnt",
  spawned: "Bearbeitung gestartet",
  crashed: "Bearbeitung abgestürzt",
  timed_out: "Zeitlimit überschritten",
  gave_up: "Bearbeitung aufgegeben",
  auto_blocked: "Automatisch blockiert",
  rate_limited: "Ratenlimit erreicht",
  status: "Status geändert",
};

const ERROR_KINDS: ReadonlySet<string> = new Set(["crashed", "gave_up", "spawn_failed"]);
const WARNING_KINDS: ReadonlySet<string> = new Set([
  "timed_out",
  "auto_blocked",
  "rate_limited",
  "claim_rejected",
]);

export function kanbanSeverity(kind: string): Severity {
  return ERROR_KINDS.has(kind) ? "error" : WARNING_KINDS.has(kind) ? "warning" : "info";
}

export function kanbanStatus(kind: string): ActivityEvent["status"] {
  switch (kind) {
    case "created":
      return "started";
    case "spawned":
      return "running";
    case "completed":
      return "succeeded";
    case "crashed":
    case "timed_out":
    case "gave_up":
    case "spawn_failed":
      return "failed";
    case "archived":
      return "cancelled";
    default:
      return "info";
  }
}

export function kanbanTitle(kind: string): string {
  return (
    KANBAN_TITLES[kind] ?? `Aufgabenereignis: ${kind.replace(/[^\w.-]/g, "").slice(0, 40) || "unbekannt"}`
  );
}

/** Kanban `task_events` row -> activity event (kind `task`). */
export function kanbanEventToDraft(
  board: string,
  event: WireEvent,
  context: MapContext,
  deps: { taskIds: TaskIds; agentIds: AgentIds },
): ActivityDraft {
  const payload = event.payload ?? {};
  const text = [payload.reason, payload.summary, payload.error].find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  const assignee = typeof payload.assignee === "string" && payload.assignee ? payload.assignee : null;
  const occurredAt = isoFromSeconds(event.createdAt);
  return {
    id: createId("act", `k:${board}:${event.id}`),
    version: 1,
    createdAt: occurredAt,
    updatedAt: occurredAt,
    source: context.source(`${board}#${event.id}`),
    kind: "task",
    severity: kanbanSeverity(event.kind),
    title: kanbanTitle(event.kind),
    ...(text ? { summary: truncate(text, SUMMARY_MAX) } : {}),
    status: kanbanStatus(event.kind),
    parentId: null,
    correlationId: correlationFor(`task:${board}/${event.taskId}`),
    agentId: assignee ? deps.agentIds.encode(assignee) : null,
    taskId: deps.taskIds.encode({ board, taskId: event.taskId }),
    adapterId: context.adapterId,
    occurredAt,
    endedAt: null,
    durationMs: null,
    details: { board, kind: event.kind, ...(event.runId !== null ? { runId: event.runId } : {}) },
  };
}

function messageDraft(
  session: WireSession,
  message: WireMessage,
  seed: string,
  context: MapContext,
  fields: {
    kind: ActivityKind;
    title: string;
    status: ActivityEvent["status"];
    parentId: string | null;
    summary?: string;
    tool?: string;
    endedAt?: string;
    actor: "user" | "agent";
    result?: boolean;
  },
): ActivityDraft {
  const occurredAt = isoFromSeconds(message.timestamp);
  return {
    id: createId("act", seed),
    version: 1,
    createdAt: occurredAt,
    updatedAt: fields.endedAt ?? occurredAt,
    source: context.source(`${session.id}#${message.id}`),
    kind: fields.kind,
    severity: "info",
    title: fields.title,
    ...(fields.summary ? { summary: fields.summary } : {}),
    status: fields.status,
    parentId: fields.parentId,
    correlationId: correlationFor(`session:${session.id}`),
    agentId: null,
    taskId: null,
    tool: fields.tool ?? null,
    adapterId: context.adapterId,
    model: session.model,
    occurredAt,
    endedAt: fields.endedAt ?? null,
    // Hermes stores no tool durations in sessions (only the run SSE has them): unknown stays null.
    durationMs: null,
    actor: fields.actor === "user" ? { type: "user", id: "user" } : { type: "agent", id: "hermes" },
    // Message contents and tool arguments are deliberately not copied; only a clipped summary is kept.
    details: {
      sessionSource: session.source ?? "unknown",
      role: message.role,
      messageId: message.id,
      ...(message.finishReason ? { finishReason: message.finishReason } : {}),
    },
  };
}

/**
 * Session messages -> activity drafts, parent/child linked: a user message is a root, assistant messages and tool calls
 * hang below the latest user message. `tool`-role messages are folded into the call they answer.
 */
export function sessionMessagesToDrafts(
  session: WireSession,
  messages: readonly WireMessage[],
  context: MapContext,
): Array<{ draft: ActivityDraft; messageId: number }> {
  const sorted = [...messages].sort((a, b) => a.id - b.id);
  const results = new Map<string, WireMessage>();
  for (const message of sorted)
    if (message.role === "tool" && message.toolCallId) results.set(message.toolCallId, message);

  const out: Array<{ draft: ActivityDraft; messageId: number }> = [];
  let root: string | null = null;
  for (const message of sorted) {
    if (message.role === "user") {
      const draft = messageDraft(session, message, `m:${session.id}:${message.id}`, context, {
        kind: "user_request",
        title: "Anfrage an Hermes",
        status: "info",
        parentId: null,
        actor: "user",
        ...(message.content ? { summary: truncate(message.content, SUMMARY_MAX) } : {}),
      });
      root = draft.id;
      out.push({ draft, messageId: message.id });
    } else if (message.role === "assistant") {
      if (message.toolCalls.length > 0) {
        message.toolCalls.forEach((call, index) => {
          const answer = results.get(call.id);
          out.push({
            messageId: message.id,
            draft: messageDraft(session, message, `m:${session.id}:${message.id}:${index}`, context, {
              kind: "tool_call",
              title: `Werkzeug ${call.name}`,
              status: answer ? "succeeded" : "running",
              parentId: root,
              tool: call.name,
              actor: "agent",
              ...(answer ? { endedAt: isoFromSeconds(answer.timestamp) } : {}),
            }),
          });
        });
      } else if (message.content) {
        const final = message.finishReason === "stop";
        out.push({
          messageId: message.id,
          draft: messageDraft(session, message, `m:${session.id}:${message.id}`, context, {
            kind: final ? "result" : "agent",
            title: final ? "Antwort von Hermes" : "Zwischenantwort von Hermes",
            status: final ? "succeeded" : "info",
            parentId: root,
            actor: "agent",
            summary: truncate(message.content, SUMMARY_MAX),
          }),
        });
      }
    }
  }
  return out;
}
