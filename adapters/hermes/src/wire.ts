import { AdapterError } from "@friday/adapter-core";

/**
 * Hermes wire shapes (docs/MAPPING/hermes.md §3, §4) and their defensive parsers. Hermes is not pinned by the
 * installer, so parsers ignore unknown fields and tolerate missing optional ones, but reject structurally wrong data
 * with VALIDATION_FAILED instead of repairing it.
 */

export type Json = Record<string, unknown>;

export function bad(what: string, problem: string): AdapterError {
  return new AdapterError({
    code: "VALIDATION_FAILED",
    message: `Hermes-Antwort ungültig (${what}): ${problem}.`,
    retryable: false,
  });
}

export function asObject(value: unknown, what: string): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw bad(what, "Objekt erwartet");
  return value as Json;
}

export function asArray(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw bad(what, "Liste erwartet");
  return value;
}

export function reqString(o: Json, key: string, what: string, allowEmpty = false): string {
  const value = o[key];
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
    throw bad(what, `'${key}' muss ein nicht leerer Text sein`);
  }
  return value;
}

export function optString(o: Json, key: string, what: string): string | null {
  const value = o[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw bad(what, `'${key}' muss ein Text sein`);
  return value;
}

export function reqNumber(o: Json, key: string, what: string): number {
  const value = o[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw bad(what, `'${key}' muss eine Zahl sein`);
  return value;
}

export function optNumber(o: Json, key: string, what: string): number | null {
  const value = o[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw bad(what, `'${key}' muss eine Zahl sein`);
  return value;
}

export function optBoolean(o: Json, key: string, what: string): boolean | null {
  const value = o[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "boolean") throw bad(what, `'${key}' muss true oder false sein`);
  return value;
}

function stringList(value: unknown, what: string): string[] {
  if (value === undefined || value === null) return [];
  return asArray(value, what).map((entry) => {
    if (typeof entry !== "string") throw bad(what, "Texte erwartet");
    return entry;
  });
}

// ---- kanban ------------------------------------------------------------------------------------------------------------

export interface WireProgress {
  done: number;
  total: number;
}

export interface WireTask {
  id: string;
  title: string;
  body: string | null;
  assignee: string | null;
  status: string;
  priority: number;
  createdBy: string | null;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  tenant: string | null;
  lastFailureError: string | null;
  blockKind: string | null;
  lastHeartbeatAt: number | null;
  currentRunStartedAt: number | null;
  currentRunId: number | null;
  claimLock: string | null;
  modelOverride: string | null;
  reasoningEffort: string | null;
  sessionId: string | null;
  consecutiveFailures: number;
  timeToCompleteSeconds: number | null;
  latestSummary: string | null;
  /** Child progress of the card ("N/M"); `null` without children. */
  progress: WireProgress | null;
  parentCount: number | null;
}

export function parseTask(value: unknown, what = "Aufgabe"): WireTask {
  const o = asObject(value, what);
  const priority = o.priority === undefined || o.priority === null ? 0 : reqNumber(o, "priority", what);
  if (!Number.isInteger(priority)) throw bad(what, "'priority' muss eine ganze Zahl sein");
  const age = o.age === undefined || o.age === null ? {} : asObject(o.age, what);
  let progress: WireProgress | null = null;
  if (o.progress !== undefined && o.progress !== null) {
    // Shape per plugin_api.get_board: {done, total}. Anything else is treated as "no progress" rather than guessed.
    const raw = o.progress;
    if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
      const done = (raw as Json).done;
      const total = (raw as Json).total;
      if (typeof done === "number" && typeof total === "number" && total > 0 && done >= 0) {
        progress = { done: Math.min(done, total), total };
      }
    }
  }
  const links = o.link_counts;
  return {
    id: reqString(o, "id", what),
    title: reqString(o, "title", what),
    body: optString(o, "body", what),
    assignee: optString(o, "assignee", what),
    status: reqString(o, "status", what),
    priority,
    createdBy: optString(o, "created_by", what),
    createdAt: reqNumber(o, "created_at", what),
    startedAt: optNumber(o, "started_at", what),
    completedAt: optNumber(o, "completed_at", what),
    tenant: optString(o, "tenant", what),
    lastFailureError: optString(o, "last_failure_error", what),
    blockKind: optString(o, "block_kind", what),
    lastHeartbeatAt: optNumber(o, "last_heartbeat_at", what),
    currentRunStartedAt: optNumber(o, "current_run_started_at", what),
    currentRunId: optNumber(o, "current_run_id", what),
    claimLock: optString(o, "claim_lock", what),
    modelOverride: optString(o, "model_override", what),
    reasoningEffort: optString(o, "reasoning_effort", what),
    sessionId: optString(o, "session_id", what),
    consecutiveFailures: optNumber(o, "consecutive_failures", what) ?? 0,
    timeToCompleteSeconds: optNumber(age, "time_to_complete_seconds", what),
    latestSummary: optString(o, "latest_summary", what),
    progress,
    parentCount:
      typeof links === "object" && links !== null && typeof (links as Json).parents === "number"
        ? ((links as Json).parents as number)
        : null,
  };
}

export interface WireBoard {
  tasks: WireTask[];
  assignees: string[];
  latestEventId: number;
}

export function parseBoard(value: unknown): WireBoard {
  const o = asObject(value, "Board");
  const columns = asArray(o.columns, "Board.columns");
  const tasks: WireTask[] = [];
  for (const column of columns) {
    const c = asObject(column, "Board.column");
    reqString(c, "name", "Board.column");
    for (const task of asArray(c.tasks, "Board.column.tasks")) tasks.push(parseTask(task));
  }
  return {
    tasks,
    assignees: stringList(o.assignees, "Board.assignees"),
    latestEventId: optNumber(o, "latest_event_id", "Board") ?? 0,
  };
}

export interface WireEvent {
  id: number;
  taskId: string;
  runId: number | null;
  kind: string;
  payload: Json | null;
  createdAt: number;
}

export function parseEvent(value: unknown, what = "Kanban-Ereignis"): WireEvent {
  const o = asObject(value, what);
  const id = reqNumber(o, "id", what);
  if (!Number.isInteger(id)) throw bad(what, "'id' muss eine ganze Zahl sein");
  const payload = o.payload;
  return {
    id,
    taskId: reqString(o, "task_id", what),
    runId: optNumber(o, "run_id", what),
    kind: reqString(o, "kind", what),
    payload:
      payload === undefined || payload === null
        ? null
        : typeof payload === "object" && !Array.isArray(payload)
          ? (payload as Json)
          : null,
    createdAt: reqNumber(o, "created_at", what),
  };
}

export interface WireRun {
  id: number;
  profile: string | null;
  status: string;
  startedAt: number | null;
  endedAt: number | null;
  outcome: string | null;
  summary: string | null;
  error: string | null;
}

function parseRun(value: unknown): WireRun {
  const o = asObject(value, "Lauf");
  return {
    id: reqNumber(o, "id", "Lauf"),
    profile: optString(o, "profile", "Lauf"),
    status: reqString(o, "status", "Lauf"),
    startedAt: optNumber(o, "started_at", "Lauf"),
    endedAt: optNumber(o, "ended_at", "Lauf"),
    outcome: optString(o, "outcome", "Lauf"),
    summary: optString(o, "summary", "Lauf"),
    error: optString(o, "error", "Lauf"),
  };
}

export interface WireAttachment {
  id: string;
  filename: string;
  size: number | null;
}

export interface WireTaskDetail {
  task: WireTask;
  comments: Array<{ createdAt: number }>;
  events: WireEvent[];
  attachments: WireAttachment[];
  parents: string[];
  children: string[];
  runs: WireRun[];
}

export function parseTaskDetail(value: unknown): WireTaskDetail {
  const o = asObject(value, "Aufgabendetail");
  const links = o.links === undefined || o.links === null ? {} : asObject(o.links, "Aufgabendetail.links");
  return {
    task: parseTask(o.task, "Aufgabendetail.task"),
    comments: (o.comments === undefined ? [] : asArray(o.comments, "Aufgabendetail.comments")).map(
      (entry) => ({
        createdAt: reqNumber(asObject(entry, "Kommentar"), "created_at", "Kommentar"),
      }),
    ),
    events: (o.events === undefined ? [] : asArray(o.events, "Aufgabendetail.events")).map((entry) =>
      parseEvent(entry),
    ),
    attachments: (o.attachments === undefined
      ? []
      : asArray(o.attachments, "Aufgabendetail.attachments")
    ).map((entry) => {
      const a = asObject(entry, "Anhang");
      const id = a.id;
      if (typeof id !== "number" && typeof id !== "string") throw bad("Anhang", "'id' fehlt");
      return {
        id: String(id),
        filename: reqString(a, "filename", "Anhang"),
        size: optNumber(a, "size", "Anhang"),
      };
    }),
    parents: stringList(links.parents, "Aufgabendetail.links.parents"),
    children: stringList(links.children, "Aufgabendetail.links.children"),
    runs: (o.runs === undefined ? [] : asArray(o.runs, "Aufgabendetail.runs")).map(parseRun),
  };
}

export interface WireEventBatch {
  events: WireEvent[];
  cursor: number | null;
}

/** One WebSocket message of `/api/plugins/kanban/events`: `{events:[...], cursor}`. */
export function parseEventBatch(value: unknown): WireEventBatch {
  const o = asObject(value, "Ereignis-Nachricht");
  return {
    events: asArray(o.events, "Ereignis-Nachricht.events").map((entry) => parseEvent(entry)),
    cursor: optNumber(o, "cursor", "Ereignis-Nachricht"),
  };
}

export interface WireBoardInfo {
  slug: string;
  name: string;
  archived: boolean;
}

export function parseBoards(value: unknown): WireBoardInfo[] {
  const o = asObject(value, "Boards");
  return asArray(o.boards, "Boards.boards").map((entry) => {
    const b = asObject(entry, "Board");
    return {
      slug: reqString(b, "slug", "Board"),
      name: optString(b, "name", "Board") ?? "",
      archived: optBoolean(b, "archived", "Board") ?? false,
    };
  });
}

// ---- profiles / workers ----------------------------------------------------------------------------------------------

export interface WireProfile {
  name: string;
  displayName: string | null;
  isDefault: boolean;
  model: string | null;
  provider: string | null;
  description: string | null;
  skillCount: number | null;
}

/** Accepts `GET /api/profiles` and `GET /api/plugins/kanban/profiles` (same keys). */
export function parseProfiles(value: unknown): WireProfile[] {
  const o = asObject(value, "Profile");
  return asArray(o.profiles, "Profile.profiles").map((entry) => {
    const p = asObject(entry, "Profil");
    return {
      name: reqString(p, "name", "Profil"),
      displayName: optString(p, "display_name", "Profil"),
      isDefault: optBoolean(p, "is_default", "Profil") ?? false,
      model: optString(p, "model", "Profil"),
      provider: optString(p, "provider", "Profil"),
      description: optString(p, "description", "Profil"),
      skillCount: optNumber(p, "skill_count", "Profil"),
    };
  });
}

export interface WireWorker {
  runId: number;
  taskId: string;
  taskAssignee: string | null;
  profile: string | null;
  startedAt: number | null;
  lastHeartbeatAt: number | null;
}

export function parseWorkers(value: unknown): WireWorker[] {
  const o = asObject(value, "Worker");
  return asArray(o.workers, "Worker.workers").map((entry) => {
    const w = asObject(entry, "Worker");
    return {
      runId: reqNumber(w, "run_id", "Worker"),
      taskId: reqString(w, "task_id", "Worker"),
      taskAssignee: optString(w, "task_assignee", "Worker"),
      profile: optString(w, "profile", "Worker"),
      startedAt: optNumber(w, "started_at", "Worker"),
      lastHeartbeatAt: optNumber(w, "last_heartbeat_at", "Worker"),
    };
  });
}

// ---- API server sessions -----------------------------------------------------------------------------------------------

export interface WireSession {
  id: string;
  source: string | null;
  model: string | null;
  title: string | null;
  startedAt: number | null;
  lastActive: number;
  messageCount: number;
  preview: string | null;
}

export interface WireSessionPage {
  sessions: WireSession[];
  hasMore: boolean;
}

export function parseSessionPage(value: unknown): WireSessionPage {
  const o = asObject(value, "Sitzungen");
  const sessions = asArray(o.data, "Sitzungen.data").map((entry) => {
    const s = asObject(entry, "Sitzung");
    const startedAt = optNumber(s, "started_at", "Sitzung");
    return {
      id: reqString(s, "id", "Sitzung"),
      source: optString(s, "source", "Sitzung"),
      model: optString(s, "model", "Sitzung"),
      title: optString(s, "title", "Sitzung"),
      startedAt,
      lastActive: optNumber(s, "last_active", "Sitzung") ?? startedAt ?? 0,
      messageCount: optNumber(s, "message_count", "Sitzung") ?? 0,
      preview: optString(s, "preview", "Sitzung"),
    };
  });
  return { sessions, hasMore: optBoolean(o, "has_more", "Sitzungen") ?? false };
}

export interface WireToolCall {
  id: string;
  name: string;
}

export interface WireMessage {
  id: number;
  role: string;
  content: string | null;
  toolCalls: WireToolCall[];
  toolCallId: string | null;
  toolName: string | null;
  timestamp: number;
  finishReason: string | null;
}

export function parseMessages(value: unknown): WireMessage[] {
  const o = asObject(value, "Nachrichten");
  return asArray(o.data, "Nachrichten.data").map((entry) => {
    const m = asObject(entry, "Nachricht");
    const id = reqNumber(m, "id", "Nachricht");
    if (!Number.isInteger(id)) throw bad("Nachricht", "'id' muss eine ganze Zahl sein");
    const calls =
      m.tool_calls === undefined || m.tool_calls === null
        ? []
        : asArray(m.tool_calls, "Nachricht.tool_calls").map((call, index) => {
            const c = asObject(call, "Werkzeugaufruf");
            const fn = asObject(c.function, "Werkzeugaufruf.function");
            return {
              id: optString(c, "id", "Werkzeugaufruf") ?? `${id}-${index}`,
              name: reqString(fn, "name", "Werkzeugaufruf"),
            };
          });
    return {
      id,
      role: reqString(m, "role", "Nachricht"),
      content: typeof m.content === "string" ? m.content : null,
      toolCalls: calls,
      toolCallId: optString(m, "tool_call_id", "Nachricht"),
      toolName: optString(m, "tool_name", "Nachricht"),
      timestamp: reqNumber(m, "timestamp", "Nachricht"),
      finishReason: optString(m, "finish_reason", "Nachricht"),
    };
  });
}

export interface WireToolset {
  name: string;
  enabled: boolean;
}

export function parseToolsets(value: unknown): WireToolset[] {
  const o = asObject(value, "Toolsets");
  return asArray(o.data, "Toolsets.data").map((entry) => {
    const t = asObject(entry, "Toolset");
    return { name: reqString(t, "name", "Toolset"), enabled: optBoolean(t, "enabled", "Toolset") ?? false };
  });
}

export interface WireDashboardHealth {
  ok: boolean;
  displayVersion: string | null;
  commit: string | null;
}

export function parseDashboardHealth(value: unknown): WireDashboardHealth {
  const o = asObject(value, "Dashboard-Health");
  return {
    ok: optBoolean(o, "ok", "Dashboard-Health") ?? false,
    displayVersion: optString(o, "displayVersion", "Dashboard-Health"),
    commit: optString(o, "commit", "Dashboard-Health"),
  };
}

export interface WireGatewayStatus {
  gatewayRunning: boolean | null;
}

export function parseStatus(value: unknown): WireGatewayStatus {
  const o = asObject(value, "Status");
  return { gatewayRunning: optBoolean(o, "gateway_running", "Status") };
}
