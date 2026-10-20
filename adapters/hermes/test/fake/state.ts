/**
 * In-memory model of a Hermes instance for the fake upstream (docs/MAPPING/hermes.md §8). Deterministic: ids and
 * timestamps come from counters, never from the wall clock. Names, paths and texts are fictional.
 */

export const T0 = 1_791_988_000; // fixed epoch seconds (2026-10-14)

export class HttpFail extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`HTTP ${status}`);
  }
}

export interface FakeTask {
  id: string;
  title: string;
  body: string | null;
  assignee: string | null;
  status: string;
  priority: number;
  created_by: string | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  tenant: string | null;
  last_failure_error: string | null;
  block_kind: string | null;
  last_heartbeat_at: number | null;
  current_run_started_at: number | null;
  current_run_id: number | null;
  claim_lock: string | null;
  model_override: string | null;
  reasoning_effort: string | null;
  session_id: string | null;
  consecutive_failures: number;
  idempotency_key: string | null;
  parents: string[];
  children: string[];
  result: string | null;
}

export interface FakeEvent {
  id: number;
  task_id: string;
  run_id: number | null;
  kind: string;
  payload: Record<string, unknown> | null;
  created_at: number;
}

export interface FakeRun {
  id: number;
  task_id: string;
  profile: string | null;
  status: string;
  started_at: number | null;
  ended_at: number | null;
  outcome: string | null;
  summary: string | null;
  error: string | null;
}

export interface FakeComment {
  id: number;
  task_id: string;
  author: string;
  body: string;
  created_at: number;
}

export interface FakeBoard {
  slug: string;
  name: string;
  tasks: Map<string, FakeTask>;
  events: FakeEvent[];
  comments: FakeComment[];
  runs: FakeRun[];
  /** Id of the next event; survives `events` being cleared (ids never go backwards). */
  nextEventId: number;
}

export interface FakeWorker {
  board: string;
  run_id: number;
  task_id: string;
  task_assignee: string | null;
  profile: string | null;
  started_at: number | null;
  last_heartbeat_at: number | null;
}

export interface FakeProfile {
  name: string;
  display_name?: string;
  is_default: boolean;
  model: string | null;
  provider: string | null;
  description: string;
  skill_count: number;
}

export interface FakeMessage {
  id: number;
  role: "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Array<{ id: string; name: string }>;
  tool_call_id?: string;
  tool_name?: string;
  finish_reason?: string | null;
  timestamp: number;
}

export interface FakeSession {
  id: string;
  source: string;
  model: string;
  title: string;
  started_at: number;
  last_active: number;
  messages: FakeMessage[];
}

/** `manual` transition matrix of the default workflow (kanban_workflow.py). */
const TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  triage: ["todo", "ready"],
  todo: ["triage", "scheduled", "ready"],
  scheduled: ["triage", "todo", "ready"],
  ready: ["triage", "todo", "scheduled", "blocked", "review", "done"],
  running: ["triage", "todo", "scheduled", "ready", "blocked", "review", "done"],
  blocked: ["triage", "todo", "scheduled", "ready", "done"],
  review: ["triage", "todo", "ready", "done"],
  done: ["triage", "todo", "ready"],
  archived: ["triage", "todo", "ready"],
};
const KNOWN_STATUSES = new Set([...Object.keys(TRANSITIONS)]);
export const COLUMNS = [
  "triage",
  "todo",
  "scheduled",
  "ready",
  "running",
  "blocked",
  "review",
  "done",
] as const;

export class HermesState {
  /** Dashboard session token; `rotateToken()` simulates a dashboard restart. */
  token = "fake-dashboard-token-0001";
  apiKey = "fake-api-key-0000000001";
  /** Accept any credential (conformance: the suite generates its own canary secrets). */
  acceptAnyCredentials = false;
  gatewayRunning = true;
  /** Dashboard HTML as the real one injects the token (false = gated mode without token). */
  injectToken = true;
  sessionPageSize = 50;
  /** Board responses carry structurally invalid tasks (invalid foreign data). */
  invalidData = false;
  /** Posts that created a task (side effects for idempotency checks). */
  createdCount = 0;
  /** Test-only delay after a Kanban mutation has committed, before HTTP responds. */
  mutationResponseDelayMs = 0;

  readonly boards = new Map<string, FakeBoard>();
  readonly profiles: FakeProfile[] = [
    {
      name: "default",
      display_name: "Hermes",
      is_default: true,
      model: "k3",
      provider: "kimi-coding",
      description: "",
      skill_count: 58,
    },
  ];
  readonly workers: FakeWorker[] = [];
  runStopPatched = true;
  archiveWorkerSurvives = false;
  beforeLifecycleMutation: (() => void) | undefined;
  readonly sessions: FakeSession[] = [];
  readonly toolsets: Array<{ name: string; enabled: boolean }> = [
    { name: "web", enabled: true },
    { name: "kanban", enabled: false },
  ];

  private clock = T0;
  private taskCounter = 0;
  private commentCounter = 0;
  private runCounter = 0;
  private messageCounter = 0;
  private lifecycle: { board: string; taskId: string; step: number } | undefined;

  constructor() {
    this.addBoard("default", "Default");
  }

  tick(): number {
    this.clock += 1;
    return this.clock;
  }

  now(): number {
    return this.clock;
  }

  rotateToken(): string {
    this.token = `fake-dashboard-token-${String(Number(this.token.slice(-4)) + 1).padStart(4, "0")}`;
    return this.token;
  }

  addBoard(slug: string, name: string): FakeBoard {
    const board: FakeBoard = {
      slug,
      name,
      tasks: new Map(),
      events: [],
      comments: [],
      runs: [],
      nextEventId: 1,
    };
    this.boards.set(slug, board);
    return board;
  }

  board(slug: string | undefined): FakeBoard {
    const key = slug && slug.length > 0 ? slug : "default";
    const board = this.boards.get(key);
    if (!board) throw new HttpFail(404, { detail: `board '${key}' does not exist` });
    return board;
  }

  // ---- kanban -----------------------------------------------------------------------------------------------------

  task(board: FakeBoard, id: string): FakeTask {
    const task = board.tasks.get(id);
    if (!task) throw new HttpFail(404, { detail: `task ${id} not found` });
    return task;
  }

  addEvent(
    board: FakeBoard,
    task: FakeTask,
    kind: string,
    payload: Record<string, unknown> | null = null,
    runId: number | null = null,
  ): FakeEvent {
    const event: FakeEvent = {
      id: board.nextEventId++,
      task_id: task.id,
      run_id: runId,
      kind,
      payload,
      created_at: this.tick(),
    };
    board.events.push(event);
    return event;
  }

  addTask(boardSlug: string, init: Partial<FakeTask> & { title: string }): FakeTask {
    const board = this.board(boardSlug);
    this.taskCounter += 1;
    const created = this.tick();
    const task: FakeTask = {
      id: `t_${this.taskCounter.toString(16).padStart(8, "0")}`,
      body: null,
      assignee: null,
      status: init.assignee ? "ready" : "todo",
      priority: 0,
      created_by: "user",
      created_at: created,
      started_at: null,
      completed_at: null,
      tenant: null,
      last_failure_error: null,
      block_kind: null,
      last_heartbeat_at: null,
      current_run_started_at: null,
      current_run_id: null,
      claim_lock: null,
      model_override: null,
      reasoning_effort: null,
      session_id: null,
      consecutive_failures: 0,
      idempotency_key: null,
      parents: [],
      children: [],
      result: null,
      ...init,
    };
    board.tasks.set(task.id, task);
    this.addEvent(board, task, "created", {
      assignee: task.assignee,
      status: task.status,
      parents: task.parents,
      tenant: task.tenant,
    });
    return task;
  }

  /** Moves a task like `PATCH status` (validates the matrix) and records the matching event. */
  setStatus(
    board: FakeBoard,
    task: FakeTask,
    status: string,
    extra: { reason?: string; result?: string } = {},
  ): void {
    if (status === "running") {
      throw new HttpFail(400, {
        detail: "Cannot set status to 'running' directly; use the dispatcher/claim path",
      });
    }
    if (!KNOWN_STATUSES.has(status)) throw new HttpFail(400, { detail: `unknown status: ${status}` });
    if (status !== "archived" && !(TRANSITIONS[task.status] ?? []).includes(status) && task.status !== status) {
      throw new HttpFail(409, { detail: `status transition to '${status}' not valid from current state` });
    }
    const previous = task.status;
    task.status = status;
    if (status === "done") {
      task.completed_at = this.tick();
      task.result = extra.result ?? null;
      this.addEvent(board, task, "completed", {
        result_len: (extra.result ?? "").length,
        summary: extra.result ?? null,
      });
    } else if (status === "blocked") {
      task.block_kind = null;
      this.addEvent(board, task, "blocked", { reason: extra.reason ?? null, source_status: previous });
    } else if (previous === "blocked" && status === "ready") {
      task.block_kind = null;
      this.addEvent(board, task, "unblocked");
    } else if (status === "archived") {
      for (const run of board.runs.filter((candidate) => candidate.task_id === task.id && candidate.ended_at === null)) {
        run.ended_at = this.tick();
        run.status = "reclaimed";
        run.outcome = "reclaimed";
      }
      task.current_run_id = null;
      task.claim_lock = null;
      if (!this.archiveWorkerSurvives) {
        for (let index = this.workers.length - 1; index >= 0; index -= 1) {
          if (this.workers[index]?.board === board.slug && this.workers[index]?.task_id === task.id) this.workers.splice(index, 1);
        }
      }
      this.addEvent(board, task, "archived");
    } else {
      this.addEvent(board, task, "status", { status, requested_status: status });
    }
  }

  addComment(board: FakeBoard, task: FakeTask, author: string, body: string): void {
    this.commentCounter += 1;
    board.comments.push({ id: this.commentCounter, task_id: task.id, author, body, created_at: this.tick() });
    this.addEvent(board, task, "commented", { author });
  }

  addRun(board: FakeBoard, task: FakeTask, init: Partial<FakeRun> = {}): FakeRun {
    this.runCounter += 1;
    const run: FakeRun = {
      id: this.runCounter,
      task_id: task.id,
      profile: task.assignee,
      status: "running",
      started_at: this.tick(),
      ended_at: null,
      outcome: null,
      summary: null,
      error: null,
      ...init,
    };
    board.runs.push(run);
    return run;
  }

  startWorker(boardSlug: string, task: FakeTask, pid = 4711): FakeWorker {
    const board = this.board(boardSlug);
    task.status = "running";
    task.started_at ??= this.tick();
    const run = this.addRun(board, task, { started_at: this.tick() });
    task.current_run_id = run.id;
    task.claim_lock = `fake-lock-${run.id}`;
    task.current_run_started_at = run.started_at;
    task.last_heartbeat_at = this.tick();
    this.addEvent(board, task, "spawned", { pid }, run.id);
    const worker: FakeWorker = {
      board: boardSlug,
      run_id: run.id,
      task_id: task.id,
      task_assignee: task.assignee,
      profile: task.assignee,
      started_at: run.started_at,
      last_heartbeat_at: task.last_heartbeat_at,
    };
    this.workers.push(worker);
    return worker;
  }

  heartbeat(worker: FakeWorker): void {
    worker.last_heartbeat_at = this.tick();
  }

  /** `count` simple tasks with a spread of statuses and priorities (list/pagination fixtures). */
  seedTasks(count: number, boardSlug = "default"): void {
    const statuses = ["triage", "todo", "ready", "review", "done", "blocked", "ready"];
    for (let index = 0; index < count; index += 1) {
      const task = this.addTask(boardSlug, {
        title: `Fixture-Aufgabe ${index + 1}`,
        body: index % 2 === 0 ? `Beschreibung ${index + 1}` : null,
        assignee: index % 3 === 0 ? "kira" : null,
        priority: index % 5,
        status: statuses[index % statuses.length] ?? "todo",
      });
      if (task.status === "done") task.completed_at = this.tick();
    }
    // Seed history is silent: only events published afterwards are visible to the event stream.
    this.board(boardSlug).events.length = 0;
  }

  /**
   * Appends `count` raw Kanban events following one task lifecycle: created, blocked, unblocked, completed (then the
   * next task). Used by the task conformance fixture: [created, updated, updated, completed].
   */
  publishTaskLifecycle(count: number, boardSlug = "default"): void {
    const board = this.board(boardSlug);
    for (let index = 0; index < count; index += 1) {
      let life = this.lifecycle;
      if (!life || life.step >= 4) {
        const task = this.addTask(boardSlug, {
          title: `Ereignis-Aufgabe ${this.taskCounter + 1}`,
          assignee: "kira",
        });
        life = { board: boardSlug, taskId: task.id, step: 1 };
        this.lifecycle = life;
        continue;
      }
      const task = this.task(board, life.taskId);
      if (life.step === 1) this.setStatus(board, task, "blocked", { reason: "Rückfrage offen" });
      else if (life.step === 2) this.setStatus(board, task, "ready");
      else this.setStatus(board, task, "done", { result: "fertig" });
      life.step += 1;
    }
  }

  /** Raw events that move an agent: spawned, blocked, completed on a task of `kira` (agent conformance fixture). */
  publishAgentEvents(count: number, boardSlug = "default"): void {
    const board = this.board(boardSlug);
    const task = this.addTask(boardSlug, { title: "Agenten-Aufgabe", assignee: "kira" });
    const kinds = ["spawned", "blocked", "completed"];
    for (let index = 0; index < count; index += 1) {
      const kind = kinds[index % kinds.length] as string;
      if (kind === "spawned") task.status = "running";
      if (kind === "blocked") task.status = "blocked";
      if (kind === "completed") {
        task.status = "done";
        task.completed_at = this.tick();
      }
      this.addEvent(board, task, kind);
    }
  }

  // ---- sessions ---------------------------------------------------------------------------------------------------

  nextMessageId(): number {
    this.messageCounter += 1;
    return this.messageCounter;
  }

  /** Message ids of published events start here, above everything the seed fixtures create. */
  setMessageFloor(floor: number): void {
    this.messageCounter = Math.max(this.messageCounter, floor);
  }

  addSession(init: {
    id?: string;
    title: string;
    source?: string;
    model?: string;
    messages: Array<Omit<FakeMessage, "id" | "timestamp">>;
  }): FakeSession {
    const started = this.tick();
    const session: FakeSession = {
      id: init.id ?? `sess-${String(this.sessions.length + 1).padStart(3, "0")}`,
      source: init.source ?? "api_server",
      model: init.model ?? "fake-model",
      title: init.title,
      started_at: started,
      last_active: started,
      messages: [],
    };
    for (const message of init.messages) this.appendMessage(session, message);
    this.sessions.push(session);
    return session;
  }

  appendMessage(session: FakeSession, message: Omit<FakeMessage, "id" | "timestamp">): FakeMessage {
    const full: FakeMessage = { ...message, id: this.nextMessageId(), timestamp: this.tick() + 0.5 };
    session.messages.push(full);
    session.last_active = full.timestamp;
    return full;
  }

  /** `count` sessions with one user message each (list/pagination fixtures), ids 1..count. */
  seedSessions(count: number): void {
    for (let index = 0; index < count; index += 1) {
      this.addSession({
        title: `Gespräch ${index + 1}`,
        messages: [{ role: "user", content: `Frage ${index + 1} an den Assistenten` }],
      });
    }
  }

  /** New sessions with one user message each, above the message floor (events fixture). */
  publishSessionMessages(count: number): void {
    for (let index = 0; index < count; index += 1) {
      this.setMessageFloor(Math.max(this.messageCounter, 1000));
      this.addSession({
        title: `Neues Gespräch ${this.sessions.length + 1}`,
        messages: [{ role: "user", content: "Was steht heute an?" }],
      });
    }
  }
}
