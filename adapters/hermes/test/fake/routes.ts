import type { RouteResponse, UpstreamRequest } from "@friday/adapter-testkit";
import { COLUMNS, HttpFail, HermesState, type FakeBoard, type FakeSession, type FakeTask } from "./state";

export interface RouteDef {
  method: string;
  /** Path pattern in the testkit's syntax (`/items/:id`). */
  pattern: string;
  handler: (request: UpstreamRequest) => RouteResponse;
}

const json = (body: unknown, status = 200): RouteResponse => ({ status, body });

function guard(fn: (request: UpstreamRequest) => RouteResponse): (request: UpstreamRequest) => RouteResponse {
  return (request) => {
    try {
      return fn(request);
    } catch (error) {
      if (error instanceof HttpFail) return { status: error.status, body: error.body };
      throw error;
    }
  };
}

const num = (value: string | string[] | undefined): number | undefined => {
  const text = Array.isArray(value) ? value[0] : value;
  if (text === undefined || text === "") return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
};
const str = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

// ---- auth --------------------------------------------------------------------------------------------------------------

export function requireDashboardAuth(state: HermesState, request: UpstreamRequest): void {
  if (state.acceptAnyCredentials) return;
  const header = request.headers["x-hermes-session-token"];
  const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (header === state.token || bearer === state.token) return;
  throw new HttpFail(401, { detail: "Unauthorized" });
}

export function requireApiAuth(state: HermesState, request: UpstreamRequest): void {
  if (state.acceptAnyCredentials) return;
  if (request.headers.authorization === `Bearer ${state.apiKey}`) return;
  throw new HttpFail(401, {
    error: {
      message: "Invalid gateway API key (API_SERVER_KEY)",
      type: "gateway_auth_error",
      code: "gateway_auth_failed",
    },
  });
}

// ---- kanban shapes -----------------------------------------------------------------------------------------------------

export function cardOf(board: FakeBoard, task: FakeTask, state: HermesState): Record<string, unknown> {
  const children = task.children
    .map((id) => board.tasks.get(id))
    .filter((child): child is FakeTask => !!child);
  const run = [...board.runs].reverse().find((candidate) => candidate.task_id === task.id);
  return {
    id: task.id,
    title: task.title,
    body: task.body,
    assignee: task.assignee,
    status: task.status,
    priority: task.priority,
    created_by: task.created_by,
    created_at: task.created_at,
    started_at: task.started_at,
    completed_at: task.completed_at,
    workspace_kind: "scratch",
    workspace_path: null,
    claim_lock: task.claim_lock,
    claim_expires: null,
    tenant: task.tenant,
    branch_name: null,
    project_id: null,
    result: task.result,
    idempotency_key: task.idempotency_key,
    consecutive_failures: task.consecutive_failures,
    last_failure_error: task.last_failure_error,
    block_kind: task.block_kind,
    last_heartbeat_at: task.last_heartbeat_at,
    current_run_started_at: task.current_run_started_at,
    current_run_id: task.current_run_id,
    model_override: task.model_override,
    provider_override: task.provider_override,
    reasoning_effort: task.reasoning_effort,
    session_id: task.session_id,
    completion_contract: "local-only",
    age: {
      created_age_seconds: state.now() - task.created_at,
      started_age_seconds: task.started_at === null ? null : state.now() - task.started_at,
      time_to_complete_seconds:
        task.completed_at === null || task.started_at === null ? null : task.completed_at - task.started_at,
    },
    latest_summary: run?.summary ?? null,
    link_counts: { parents: task.parents.length, children: task.children.length },
    comment_count: board.comments.filter((comment) => comment.task_id === task.id).length,
    progress:
      children.length > 0
        ? { done: children.filter((c) => c.status === "done").length, total: children.length }
        : null,
  };
}

function boardResponse(state: HermesState, board: FakeBoard, includeArchived: boolean): unknown {
  if (state.invalidData) {
    return {
      columns: [
        {
          name: "todo",
          tasks: [{ id: "t_bad", title: "", status: "weird", priority: "hoch", created_at: "gestern" }],
        },
      ],
      tenants: [],
      assignees: [],
      latest_event_id: 0,
    };
  }
  const names: string[] = includeArchived ? [...COLUMNS, "archived"] : [...COLUMNS];
  const assignees = new Set<string>(state.profiles.map((profile) => profile.name));
  for (const task of board.tasks.values()) if (task.assignee) assignees.add(task.assignee);
  return {
    columns: names.map((name) => ({
      name,
      tasks: [...board.tasks.values()]
        .filter(
          (task) =>
            task.status === name ||
            (name === "todo" && !names.includes(task.status) && task.status !== "archived"),
        )
        .map((task) => cardOf(board, task, state)),
    })),
    tenants: [],
    assignees: [...assignees],
    latest_event_id: board.nextEventId - 1,
    now: state.now(),
  };
}

function detailResponse(state: HermesState, board: FakeBoard, task: FakeTask): unknown {
  return {
    task: cardOf(board, task, state),
    comments: board.comments.filter((comment) => comment.task_id === task.id),
    events: board.events.filter((event) => event.task_id === task.id),
    attachments: [],
    links: { parents: task.parents, children: task.children },
    link_tasks: [],
    child_results: [],
    runs: board.runs.filter((run) => run.task_id === task.id),
  };
}

function readBody(request: UpstreamRequest): Record<string, unknown> {
  if (typeof request.body !== "object" || request.body === null || Array.isArray(request.body)) {
    throw new HttpFail(422, { detail: [{ loc: ["body"], msg: "Field required", type: "missing" }] });
  }
  return request.body as Record<string, unknown>;
}

// ---- dashboard (Fake B) ------------------------------------------------------------------------------------------------

export function dashboardHtml(state: HermesState): string {
  const script = state.injectToken
    ? `window.__HERMES_SESSION_TOKEN__="${state.token}";window.__HERMES_AUTH_REQUIRED__=false;`
    : "window.__HERMES_AUTH_REQUIRED__=true;";
  return `<!doctype html><html><head><title>Hermes</title><script>${script}</script></head><body><div id="root"></div></body></html>`;
}

export function dashboardRoutes(state: HermesState): RouteDef[] {
  const PLUGIN = "/api/plugins/kanban";
  const authed = (
    fn: (request: UpstreamRequest) => RouteResponse,
  ): ((request: UpstreamRequest) => RouteResponse) =>
    guard((request) => {
      requireDashboardAuth(state, request);
      return fn(request);
    });

  return [
    {
      method: "GET",
      pattern: "/",
      handler: () => ({
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
        raw: dashboardHtml(state),
      }),
    },
    {
      method: "GET",
      pattern: "/api/health",
      handler: () =>
        json({
          ok: true,
          version: "unknown",
          displayVersion: "git.0e427d7",
          commit: "0e427d788d253630d38a3a51cd76849e73cd6925",
          auth_required: false,
        }),
    },
    {
      method: "GET",
      pattern: "/api/status",
      handler: () =>
        json({
          version: "unknown",
          release_date: "2026.9.24",
          gateway_running: state.gatewayRunning,
          gateway_state: state.gatewayRunning ? "running" : "stopped",
          gateway_platforms: { api_server: { state: "connected" } },
        }),
    },
    {
      method: "GET",
      pattern: `${PLUGIN}/boards`,
      handler: authed(() =>
        json({
          boards: [...state.boards.values()].map((board, index) => ({
            slug: board.slug,
            name: board.name,
            description: "",
            icon: "",
            color: "",
            archived: false,
            is_current: index === 0,
            counts: {},
            total: board.tasks.size,
          })),
          current: "default",
        }),
      ),
    },
    {
      method: "GET",
      pattern: `${PLUGIN}/board`,
      handler: authed((request) =>
        json(
          boardResponse(
            state,
            state.board(str(request.query.board)),
            str(request.query.include_archived) === "true",
          ),
        ),
      ),
    },
    {
      method: "GET",
      pattern: `${PLUGIN}/tasks/:id`,
      handler: authed((request) => {
        const board = state.board(str(request.query.board));
        return json(detailResponse(state, board, state.task(board, request.params.id ?? "")));
      }),
    },
    {
      method: "POST",
      pattern: `${PLUGIN}/tasks`,
      handler: authed((request) => {
        const board = state.board(str(request.query.board));
        const body = readBody(request);
        if (typeof body.title !== "string" || body.title.trim() === "") {
          throw new HttpFail(422, {
            detail: [{ loc: ["body", "title"], msg: "Field required", type: "missing" }],
          });
        }
        const key = typeof body.idempotency_key === "string" ? body.idempotency_key : null;
        const existing = key
          ? [...board.tasks.values()].find(
              (task) => task.idempotency_key === key && task.status !== "archived",
            )
          : undefined;
        if (existing) return json({ task: cardOf(board, existing, state) });
        state.createdCount += 1;
        const assignee = typeof body.assignee === "string" && body.assignee ? body.assignee : null;
        const task = state.addTask(board.slug, {
          title: body.title.trim(),
          body: typeof body.body === "string" ? body.body : null,
          assignee,
          priority: typeof body.priority === "number" ? body.priority : 0,
          tenant: typeof body.tenant === "string" ? body.tenant : null,
          model_override: typeof body.model_override === "string" ? body.model_override : null,
          provider_override: typeof body.provider_override === "string" ? body.provider_override : null,
          reasoning_effort: typeof body.reasoning_effort === "string" ? body.reasoning_effort : null,
          idempotency_key: key,
          created_by: "dashboard",
        });
        return json({ task: cardOf(board, task, state) });
      }),
    },
    {
      method: "PATCH",
      pattern: `${PLUGIN}/tasks/:id`,
      handler: authed((request) => {
        const board = state.board(str(request.query.board));
        const task = state.task(board, request.params.id ?? "");
        const body = readBody(request);
        if (typeof body.assignee === "string") {
          task.assignee = body.assignee === "" ? null : body.assignee;
          state.addEvent(board, task, "assigned", { assignee: task.assignee });
        }
        if (typeof body.status === "string") {
          state.setStatus(board, task, body.status, {
            ...(typeof body.block_reason === "string" ? { reason: body.block_reason } : {}),
            ...(typeof body.result === "string" ? { result: body.result } : {}),
          });
          if (body.status === "archived" && state.archiveWorkerSurvives) {
            throw new HttpFail(500, { detail: "archived task still has a live worker" });
          }
        }
        if (typeof body.priority === "number") task.priority = body.priority;
        if (typeof body.title === "string") {
          if (body.title.trim() === "") throw new HttpFail(400, { detail: "title cannot be empty" });
          task.title = body.title.trim();
          state.addEvent(board, task, "edited");
        }
        if (typeof body.body === "string") {
          task.body = body.body;
          state.addEvent(board, task, "edited");
        }
        return json({ task: cardOf(board, task, state) });
      }),
    },
    {
      method: "POST",
      pattern: `${PLUGIN}/tasks/:id/comments`,
      handler: authed((request) => {
        const board = state.board(str(request.query.board));
        const task = state.task(board, request.params.id ?? "");
        const body = readBody(request);
        if (typeof body.body !== "string" || body.body.trim() === "") {
          throw new HttpFail(400, { detail: "body is required" });
        }
        state.addComment(board, task, typeof body.author === "string" ? body.author : "dashboard", body.body);
        return json({ ok: true });
      }),
    },
    {
      method: "GET",
      pattern: `${PLUGIN}/stats`,
      handler: authed((request) => {
        const board = state.board(str(request.query.board));
        const byStatus: Record<string, number> = {};
        for (const task of board.tasks.values()) byStatus[task.status] = (byStatus[task.status] ?? 0) + 1;
        return json({
          by_status: byStatus,
          by_assignee: {},
          oldest_ready_age_seconds: null,
          now: state.now(),
        });
      }),
    },
    {
      method: "GET",
      pattern: `${PLUGIN}/assignees`,
      handler: authed((request) => {
        const board = state.board(str(request.query.board));
        const names = new Set<string>(state.profiles.map((profile) => profile.name));
        for (const task of board.tasks.values()) if (task.assignee) names.add(task.assignee);
        return json({
          assignees: [...names].map((name) => ({
            name,
            on_disk: state.profiles.some((profile) => profile.name === name),
            counts: {},
          })),
        });
      }),
    },
    {
      method: "GET",
      pattern: `${PLUGIN}/profiles`,
      handler: authed(() =>
        json({ profiles: state.profiles.map((profile) => ({ ...profile, description_auto: false })) }),
      ),
    },
    {
      method: "GET",
      pattern: "/api/profiles",
      handler: authed(() =>
        json({
          profiles: state.profiles.map((profile) => ({
            ...profile,
            path: "/home/hermes/.hermes",
            has_env: true,
            gateway_running: state.gatewayRunning,
          })),
        }),
      ),
    },
    {
      method: "GET",
      pattern: `${PLUGIN}/workers/active`,
      handler: authed((request) => {
        const slug = state.board(str(request.query.board)).slug;
        const workers = state.workers.filter((worker) => worker.board === slug);
        return json({
          workers: workers.map(({ board: _board, ...worker }) => ({
            ...worker,
            task_title: "Aufgabe",
            task_status: "running",
            worker_pid: 4711,
            claim_lock: "lock",
            claim_expires: state.now() + 600,
            max_runtime_seconds: null,
          })),
          count: workers.length,
          checked_at: state.now(),
        });
      }),
    },
    {
      method: "GET",
      pattern: `${PLUGIN}/friday/run-stop-capability`,
      handler: authed(() => {
        if (!state.runStopPatched) throw new HttpFail(404, { detail: "not found" });
        return json({ patch: "FRIDAY_RUN_STOP_CAS_V1", lifecycle: "FRIDAY_LIFECYCLE_CAS_V1" });
      }),
    },
    {
      method: "POST",
      pattern: `${PLUGIN}/friday/tasks/:id/:action`,
      handler: authed((request) => {
        if (!state.runStopPatched) throw new HttpFail(404, { detail: "not found" });
        const board = state.board(str(request.query.board));
        const task = state.task(board, request.params.id ?? "");
        const body = readBody(request);
        const before = state.beforeLifecycleMutation;
        state.beforeLifecycleMutation = undefined;
        before?.();
        const latest = board.events.filter((event) => event.task_id === task.id).at(-1)?.id ?? 0;
        if (body.expected_event_id !== latest || body.expected_status !== task.status ||
            (body.expected_run_id ?? null) !== task.current_run_id ||
            (body.expected_claim_lock ?? null) !== task.claim_lock) {
          throw new HttpFail(409, { detail: "Friday lifecycle precondition changed" });
        }
        if (request.params.action === "cancel") {
          if (["done", "archived"].includes(task.status)) throw new HttpFail(409, { detail: "already terminal" });
          if (state.archiveWorkerSurvives) throw new HttpFail(500, { detail: "worker still live; archive rolled back" });
          state.setStatus(board, task, "archived");
        } else if (request.params.action === "retry") {
          if (task.current_run_id !== null || task.claim_lock !== null ||
              !(task.status === "archived" || task.status === "blocked" &&
                (task.last_failure_error || task.block_kind === "friday_stopped"))) {
            throw new HttpFail(409, { detail: "not retryable" });
          }
          state.setStatus(board, task, "ready");
        } else {
          throw new HttpFail(404, { detail: "not found" });
        }
        return json({ task: cardOf(board, task, state) });
      }),
    },
    {
      method: "POST",
      pattern: `${PLUGIN}/runs/:id/terminate`,
      handler: authed((request) => {
        const board = state.board(str(request.query.board));
        const runId = Number(request.params.id);
        const run = board.runs.find((candidate) => candidate.id === runId);
        if (!run) throw new HttpFail(404, { detail: `run ${runId} not found` });
        if (run.ended_at !== null) throw new HttpFail(409, { detail: `run ${runId} already ended` });
        const task = state.task(board, run.task_id);
        if (task.status !== "running") throw new HttpFail(409, { detail: "not reclaimable" });
        const workerIndex = state.workers.findIndex((worker) => worker.board === board.slug && worker.run_id === runId);
        if (workerIndex < 0) throw new HttpFail(409, { detail: "run no longer owns the worker" });
        run.ended_at = state.tick();
        run.status = "reclaimed";
        run.outcome = "reclaimed";
        task.status = "blocked";
        task.block_kind = "friday_stopped";
        task.current_run_id = null;
        task.claim_lock = null;
        state.workers.splice(workerIndex, 1);
        state.addEvent(board, task, "reclaimed", null, runId);
        return json({ ok: true, run_id: runId, task_id: task.id });
      }),
    },
    {
      // HTTP twin of the WebSocket stream, same payload; lets the testkit's HTTP-only upstream inject faults.
      method: "GET",
      pattern: `${PLUGIN}/events`,
      handler: authed((request) => {
        const board = state.board(str(request.query.board));
        const since = num(request.query.since) ?? 0;
        return json(eventPayload(board, since));
      }),
    },
  ];
}

export function eventPayload(board: FakeBoard, since: number): { events: unknown[]; cursor: number } {
  const events = board.events.filter((event) => event.id > since).slice(0, 200);
  return { events, cursor: events.at(-1)?.id ?? since };
}

// ---- API server (Fake A) -----------------------------------------------------------------------------------------------

function sessionObject(session: FakeSession, withPreview: boolean): Record<string, unknown> {
  return {
    id: session.id,
    source: session.source,
    user_id: null,
    model: session.model,
    title: session.title,
    started_at: session.started_at,
    ended_at: null,
    end_reason: null,
    message_count: session.messages.length,
    tool_call_count: session.messages.reduce((sum, message) => sum + (message.tool_calls?.length ?? 0), 0),
    input_tokens: 20,
    output_tokens: 10,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    reasoning_tokens: 0,
    estimated_cost_usd: 0,
    actual_cost_usd: null,
    api_call_count: 1,
    parent_session_id: null,
    ...(withPreview ? { last_active: session.last_active, preview: session.title } : {}),
    pinned: false,
    archived: false,
    hidden: false,
    has_system_prompt: true,
    has_model_config: true,
    is_internal_child: false,
  };
}

function messageObject(sessionId: string, message: FakeSession["messages"][number]): Record<string, unknown> {
  return {
    id: message.id,
    session_id: sessionId,
    role: message.role,
    content: message.content,
    tool_call_id: message.tool_call_id ?? null,
    tool_calls: message.tool_calls
      ? message.tool_calls.map((call) => ({
          id: call.id,
          call_id: call.id,
          response_item_id: `fc_${call.id}`,
          type: "function",
          function: { name: call.name, arguments: "{}" },
        }))
      : null,
    tool_name: message.tool_name ?? null,
    timestamp: message.timestamp,
    token_count: null,
    finish_reason: message.finish_reason ?? null,
    reasoning: null,
    reasoning_content: null,
    display_kind: null,
  };
}

const sessionNotFound = (id: string): HttpFail =>
  new HttpFail(404, {
    error: {
      message: `Session not found: ${id}`,
      type: "invalid_request_error",
      param: null,
      code: "session_not_found",
    },
  });

export function apiRoutes(state: HermesState): RouteDef[] {
  const authed = (
    fn: (request: UpstreamRequest) => RouteResponse,
  ): ((request: UpstreamRequest) => RouteResponse) =>
    guard((request) => {
      requireApiAuth(state, request);
      return fn(request);
    });
  const health = (): RouteResponse => json({ status: "ok", platform: "hermes-agent", version: "unknown" });

  return [
    { method: "GET", pattern: "/health", handler: health },
    { method: "GET", pattern: "/v1/health", handler: health },
    {
      method: "GET",
      pattern: "/health/detailed",
      handler: authed(() =>
        json({
          status: "ok",
          readiness: {
            status: "ok",
            checks: { state_db: { status: "ok" }, gateway: { status: "ok", state: "running" } },
          },
          platform: "hermes-agent",
          version: "unknown",
          gateway_state: state.gatewayRunning ? "running" : "stopped",
          active_agents: 0,
          last_heartbeat: "2026-10-14T14:29:31.151724+00:00",
          pid: 5065,
        }),
      ),
    },
    {
      method: "GET",
      pattern: "/v1/models",
      handler: authed(() =>
        json({
          object: "list",
          data: [
            {
              id: "friday",
              object: "model",
              created: 1791988171,
              owned_by: "hermes",
              permission: [],
              root: "friday",
              parent: null,
            },
          ],
        }),
      ),
    },
    {
      method: "GET",
      pattern: "/v1/capabilities",
      handler: authed(() =>
        json({
          object: "hermes.api_server.capabilities",
          platform: "hermes-agent",
          model: "friday",
          auth: { type: "bearer", required: true },
          features: {
            chat_completions: true,
            run_submission: true,
            run_events_sse: true,
            session_resources: true,
          },
          endpoints: {},
        }),
      ),
    },
    {
      method: "GET",
      pattern: "/v1/toolsets",
      handler: authed(() =>
        json({
          object: "list",
          platform: "api_server",
          data: state.toolsets.map((toolset) => ({
            ...toolset,
            label: toolset.name,
            description: "",
            configured: true,
            tools: [],
          })),
        }),
      ),
    },
    {
      method: "GET",
      pattern: "/api/sessions",
      handler: authed((request) => {
        const limit = Math.min(num(request.query.limit) ?? 50, 200, state.sessionPageSize);
        const offset = num(request.query.offset) ?? 0;
        const sorted = [...state.sessions].sort((a, b) => b.last_active - a.last_active);
        const page = sorted.slice(offset, offset + limit);
        return json({
          object: "list",
          data: page.map((session) => sessionObject(session, true)),
          limit,
          offset,
          has_more: offset + page.length < sorted.length,
        });
      }),
    },
    {
      method: "POST",
      pattern: "/api/sessions",
      handler: authed((request) => {
        const body =
          typeof request.body === "object" && request.body !== null
            ? (request.body as Record<string, unknown>)
            : {};
        const session = state.addSession({
          title: typeof body.title === "string" ? body.title : "Neu",
          messages: [],
        });
        return json({ object: "hermes.session", session: sessionObject(session, false) }, 201);
      }),
    },
    {
      method: "GET",
      pattern: "/api/sessions/:id",
      handler: authed((request) => {
        const session = state.sessions.find((candidate) => candidate.id === request.params.id);
        if (!session) throw sessionNotFound(request.params.id ?? "");
        return json({ object: "hermes.session", session: sessionObject(session, false) });
      }),
    },
    {
      method: "GET",
      pattern: "/api/sessions/:id/messages",
      handler: authed((request) => {
        const session = state.sessions.find((candidate) => candidate.id === request.params.id);
        if (!session) throw sessionNotFound(request.params.id ?? "");
        const order = str(request.query.order);
        if (order !== undefined && order !== "oldest" && order !== "latest") {
          throw new HttpFail(400, {
            error: { message: "order must be one of: oldest, latest", code: "invalid_pagination" },
          });
        }
        const limit = Math.min(num(request.query.limit) ?? 500, 500);
        const offset = num(request.query.offset) ?? 0;
        const latest = order === "latest" || (order === undefined && request.query.limit === undefined);
        const messages = latest
          ? session.messages.slice(
              Math.max(0, session.messages.length - offset - limit),
              session.messages.length - offset,
            )
          : session.messages.slice(offset, offset + limit);
        return json({
          object: "list",
          session_id: session.id,
          data: messages.map((message) => messageObject(session.id, message)),
          pagination: { limit, offset, order: order ?? "latest", returned: messages.length },
        });
      }),
    },
    {
      method: "POST",
      pattern: "/v1/chat/completions",
      handler: authed(() =>
        json({
          id: "chatcmpl-abc",
          object: "chat.completion",
          created: 1791988324,
          model: "friday",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Hallo, das ist die Fake-Antwort." },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        }),
      ),
    },
    {
      method: "POST",
      pattern: "/v1/runs",
      handler: authed(() =>
        json({ run_id: `run_${"a".repeat(32)}`, status: "started", replayed: false }, 202),
      ),
    },
    {
      method: "GET",
      pattern: "/v1/runs/:id",
      handler: authed((request) => {
        if (request.params.id !== `run_${"a".repeat(32)}`) {
          throw new HttpFail(404, {
            error: {
              message: `Run not found: ${request.params.id}`,
              type: "invalid_request_error",
              param: null,
              code: "run_not_found",
            },
          });
        }
        return json({
          object: "hermes.run",
          run_id: request.params.id,
          status: "completed",
          completed: true,
        });
      }),
    },
    {
      method: "GET",
      pattern: "/v1/runs/:id/events",
      handler: authed((request) => ({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        raw: [
          ": open\n",
          `id: 0\ndata: ${JSON.stringify({ event: "run.completed", run_id: request.params.id, seq: 0, completed: true })}\n`,
          ": stream closed\n",
          "",
        ].join("\n"),
      })),
    },
  ];
}
