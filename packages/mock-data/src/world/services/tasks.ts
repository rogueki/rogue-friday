import type {
  ErrorDetail,
  Priority,
  Task,
  TaskActionRequest,
  TaskCreateRequest,
  TaskStatus,
  TaskUpdateRequest,
} from "@jarvis/sdk";
import { conflict, notFound, validationFailed } from "../../core/errors";
import { asIso, asList, clone, compareAsc, compareDesc, matchesQuery, priorityRank, type Page } from "../../core/util";
import type { MockWorld } from "../world";
import type { OpContext } from "../types";
import { checkEnum, pageOf, PRIORITIES, TASK_STATUSES, type Query } from "./shared";

export type TaskListQuery = Query<"listTasks">;

const PAUSE_BLOCKER = "Vom Benutzer pausiert";
const FINAL_STATES: TaskStatus[] = ["done", "failed", "cancelled"];

export class TaskService {
  constructor(private readonly w: MockWorld) {}

  /** Live reference for internal use; callers outside the world should use `get`. */
  find(id: string): Task {
    const task = this.w.state.tasks.find((candidate) => candidate.id === id);
    if (!task) throw notFound("Aufgabe", id);
    return task;
  }

  list(query: TaskListQuery = {}): Page<Task> {
    return this.w.read("listTasks", () => {
      const statuses = asList(query.status);
      const priorities = asList(query.priority);
      checkEnum("status", statuses, TASK_STATUSES);
      checkEnum("priority", priorities, PRIORITIES);
      const dueBefore = asIso(query.dueBefore, "dueBefore");
      const updatedSince = asIso(query.updatedSince, "updatedSince");
      const sort = query.sort ?? "-updatedAt";
      checkEnum("sort", [sort], ["-updatedAt", "updatedAt", "priority", "dueAt"]);
      const items = this.w.state.tasks.filter((task) => {
        if (statuses.length && !statuses.includes(task.status)) return false;
        if (priorities.length && !priorities.includes(task.priority)) return false;
        if (query.agentId && task.agentId !== query.agentId) return false;
        if (query.label && !(task.labels ?? []).includes(query.label)) return false;
        if (dueBefore !== undefined && (task.dueAt === null || Date.parse(task.dueAt) >= dueBefore)) return false;
        if (updatedSince !== undefined && Date.parse(task.updatedAt) <= updatedSince) return false;
        return matchesQuery(`${task.title} ${task.description ?? ""} ${(task.labels ?? []).join(" ")} ${task.agentName ?? ""}`, query.q);
      });
      items.sort((a, b) => {
        if (sort === "updatedAt") return compareAsc(a.updatedAt, b.updatedAt) || compareAsc(a.id, b.id);
        if (sort === "priority") return priorityRank(a.priority) - priorityRank(b.priority) || compareDesc(a.updatedAt, b.updatedAt);
        if (sort === "dueAt") return compareAsc(a.dueAt ?? "9999", b.dueAt ?? "9999") || compareAsc(a.id, b.id);
        return compareDesc(a.updatedAt, b.updatedAt) || compareDesc(a.id, b.id);
      });
      return pageOf(items, query);
    });
  }

  get(id: string): Task {
    return this.w.read("getTask", () => clone(this.find(id)));
  }

  create(body: TaskCreateRequest, ctx?: OpContext): Task {
    return this.w.run("createTask", ctx, body, () => {
      this.w.validate("TaskCreateRequest", body);
      const now = this.w.nowIso();
      const agent = body.agentId ? this.w.state.agents.find((candidate) => candidate.id === body.agentId) : undefined;
      if (body.agentId && !agent) throw validationFailed("Der angegebene Agent existiert nicht.", [{ path: "agentId", message: "unbekannt" }]);
      const correlationId = this.w.correlationId(ctx);
      const task: Task = {
        id: this.w.id("task"),
        version: 1,
        createdAt: now,
        updatedAt: now,
        labels: body.labels ?? [],
        source: this.w.source("tasks"),
        title: body.title,
        ...(body.description ? { description: body.description } : {}),
        status: agent ? "ready" : "todo",
        priority: body.priority ?? "P3",
        agentId: agent?.id ?? null,
        ...(agent ? { agentName: agent.name } : {}),
        model: body.model ?? agent?.model ?? null,
        progress: { mode: "none", value: null },
        startedAt: null,
        runtimeMs: null,
        dueAt: body.dueAt ?? null,
        estimatedCompletionAt: null,
        blockers: [],
        lastActivityAt: now,
        artifactCount: 0,
        artifacts: [],
        steps: [],
        toolCalls: [],
        sourceRefs: [],
        approvalIds: [],
        errors: [],
        createdBy: this.w.actorOf(ctx),
      };
      this.w.state.tasks.push(task);
      const request = this.w.logActivity({
        kind: "user_request",
        title: `Anfrage: ${task.title}`,
        correlationId,
        taskId: task.id,
        adapterId: "mock-commands",
        actor: this.w.actorOf(ctx),
      });
      this.w.logActivity({ kind: "task", title: `Aufgabe angelegt: ${task.title}`, correlationId, taskId: task.id, parentId: request.id, adapterId: "mock-tasks" });
      const event = this.w.emitFor("tasks", "jarvis.task.created", task, `task/${task.id}`, correlationId);
      this.w.recordAudit(
        { category: "user_action", action: "task.created", correlationId, taskId: task.id, adapterId: "mock-tasks", actor: this.w.actorOf(ctx), after: { status: task.status, priority: task.priority }, context: { causedBy: event.id } },
      );
      return clone(task);
    });
  }

  update(id: string, body: TaskUpdateRequest, ctx?: OpContext): Task {
    return this.w.run("updateTask", ctx, { id, body }, () => {
      this.w.validate("TaskUpdateRequest", body);
      const task = this.find(id);
      this.w.assertVersion(task, ctx, "Aufgabe");
      const before = { status: task.status, priority: task.priority, title: task.title, agentId: task.agentId };
      if (body.agentId !== undefined && body.agentId !== null) {
        const agent = this.w.state.agents.find((candidate) => candidate.id === body.agentId);
        if (!agent) throw validationFailed("Der angegebene Agent existiert nicht.", [{ path: "agentId", message: "unbekannt" }]);
        task.agentId = agent.id;
        task.agentName = agent.name;
        task.model ??= agent.model;
      } else if (body.agentId === null) {
        task.agentId = null;
        delete task.agentName;
      }
      if (body.title !== undefined) task.title = body.title;
      if (body.description !== undefined) task.description = body.description;
      if (body.priority !== undefined) task.priority = body.priority;
      if (body.dueAt !== undefined) task.dueAt = body.dueAt;
      if (body.labels !== undefined) task.labels = body.labels;
      const statusChanged = body.status !== undefined && body.status !== task.status;
      if (statusChanged) this.applyStatus(task, body.status as TaskStatus);
      this.finishMutation(task, ctx, "task.updated", before, statusChanged ? undefined : "jarvis.task.updated");
      return clone(task);
    });
  }

  cancel(id: string, body: TaskActionRequest = {}, ctx?: OpContext): Task {
    return this.w.run("cancelTask", ctx, { id, body }, () => {
      this.w.validate("TaskActionRequest", body);
      const task = this.find(id);
      this.w.assertVersion(task, ctx, "Aufgabe");
      if (FINAL_STATES.includes(task.status)) throw conflict(`Aufgabe ${id} ist bereits beendet (${task.status}) und kann nicht abgebrochen werden.`, { status: task.status });
      const before = { status: task.status };
      this.applyStatus(task, "cancelled");
      this.finishMutation(task, ctx, "task.cancelled", before, undefined, body.reason);
      return clone(task);
    });
  }

  retry(id: string, body: TaskActionRequest = {}, ctx?: OpContext): Task {
    return this.w.run("retryTask", ctx, { id, body }, () => {
      this.w.validate("TaskActionRequest", body);
      const task = this.find(id);
      this.w.assertVersion(task, ctx, "Aufgabe");
      if (task.status !== "failed" && task.status !== "cancelled") throw conflict(`Nur fehlgeschlagene oder abgebrochene Aufgaben können wiederholt werden (aktuell ${task.status}).`, { status: task.status });
      const before = { status: task.status };
      task.steps = task.steps.map((step, index) => {
        const { startedAt: _start, finishedAt: _end, detail: _detail, ...rest } = step;
        return index === 0 ? { ...rest, status: "running" as const, startedAt: this.w.nowIso() } : { ...rest, status: "pending" as const };
      });
      task.blockers = [];
      this.applyStatus(task, task.agentId ? "running" : "ready");
      this.finishMutation(task, ctx, "task.retried", before, "jarvis.task.updated", body.reason);
      return clone(task);
    });
  }

  pause(id: string, body: TaskActionRequest = {}, ctx?: OpContext): Task {
    return this.w.run("pauseTask", ctx, { id, body }, () => {
      this.w.validate("TaskActionRequest", body);
      const task = this.find(id);
      this.w.assertVersion(task, ctx, "Aufgabe");
      if (task.status !== "running" && task.status !== "ready") throw conflict(`Nur laufende Aufgaben können pausiert werden (aktuell ${task.status}).`, { status: task.status });
      const before = { status: task.status };
      this.applyStatus(task, "waiting");
      task.blockers = [{ id: this.w.id("blk"), kind: "other", description: PAUSE_BLOCKER, since: this.w.nowIso() }];
      this.w.agents.setStatusForTask(task, "paused");
      this.finishMutation(task, ctx, "task.paused", before, "jarvis.task.updated", body.reason);
      return clone(task);
    });
  }

  resume(id: string, body: TaskActionRequest = {}, ctx?: OpContext): Task {
    return this.w.run("resumeTask", ctx, { id, body }, () => {
      this.w.validate("TaskActionRequest", body);
      const task = this.find(id);
      this.w.assertVersion(task, ctx, "Aufgabe");
      if (task.status !== "waiting" || !task.blockers.some((blocker) => blocker.description === PAUSE_BLOCKER)) {
        throw conflict("Die Aufgabe ist nicht pausiert.", { status: task.status });
      }
      const before = { status: task.status };
      task.blockers = task.blockers.filter((blocker) => blocker.description !== PAUSE_BLOCKER);
      this.applyStatus(task, "running");
      this.finishMutation(task, ctx, "task.resumed", before, "jarvis.task.updated", body.reason);
      return clone(task);
    });
  }

  // ---- simulation hooks used by scenarios, commands and approval execution (no guard, no idempotency) ----

  /** Creates a task directly in the given state (scenarios, commands). */
  spawn(input: {
    title: string;
    description?: string;
    status?: TaskStatus;
    priority?: Priority;
    agentId?: string | null;
    progress?: Task["progress"];
    labels?: string[];
    steps?: string[];
    correlationId?: string;
    approvalIds?: string[];
  }): Task {
    const now = this.w.nowIso();
    const agent = input.agentId ? this.w.state.agents.find((candidate) => candidate.id === input.agentId) : undefined;
    const status = input.status ?? (agent ? "running" : "todo");
    const task: Task = {
      id: this.w.id("task"),
      version: 1,
      createdAt: now,
      updatedAt: now,
      labels: input.labels ?? [],
      source: this.w.source("tasks"),
      title: input.title,
      ...(input.description ? { description: input.description } : {}),
      status,
      priority: input.priority ?? "P3",
      agentId: agent?.id ?? null,
      ...(agent ? { agentName: agent.name } : {}),
      model: agent?.model ?? null,
      progress: input.progress ?? (status === "running" ? { mode: "indeterminate", value: null } : { mode: "none", value: null }),
      startedAt: status === "running" ? now : null,
      runtimeMs: status === "running" ? 0 : null,
      dueAt: null,
      estimatedCompletionAt: null,
      blockers: [],
      lastActivityAt: now,
      artifactCount: 0,
      artifacts: [],
      steps: (input.steps ?? []).map((title, index) => ({
        id: this.w.id("step"),
        index,
        title,
        status: status === "running" && index === 0 ? "running" : "pending",
        ...(status === "running" && index === 0 ? { startedAt: now } : {}),
      })),
      toolCalls: [],
      sourceRefs: [],
      approvalIds: input.approvalIds ?? [],
      errors: [],
      createdBy: this.w.defaultActor(),
    };
    this.w.state.tasks.push(task);
    if (agent && status === "running") this.w.agents.attach(agent.id, task.id);
    this.w.emitFor("tasks", "jarvis.task.created", task, `task/${task.id}`, input.correlationId);
    this.w.refresh();
    return task;
  }

  /** Sets real progress (fraction) or indeterminate when `value` is null; emits `jarvis.task.progress`. */
  setProgress(id: string, value: number | null, message?: string): Task {
    const task = this.find(id);
    task.progress = value === null ? { mode: "indeterminate", value: null } : { mode: "determinate", value: Math.max(0, Math.min(1, Math.round(value * 100) / 100)) };
    task.lastActivityAt = this.w.nowIso();
    this.w.bump(task);
    const runningStep = task.steps.find((step) => step.status === "running");
    this.w.emitFor(
      "tasks",
      "jarvis.task.progress",
      { taskId: task.id, progress: task.progress, currentStep: runningStep?.title ?? null, ...(message ? { message } : {}), agentId: task.agentId },
      `task/${task.id}`,
    );
    this.w.refresh();
    return task;
  }

  /** Marks a task completed (progress 100 %, agent released) and shows a short success pulse on the orb. */
  complete(id: string, ctx?: OpContext): Task {
    const task = this.find(id);
    const before = { status: task.status };
    this.applyStatus(task, "done");
    this.finishMutation(task, ctx, "task.completed", before);
    this.w.setTransientOrb("success", 1500, "ABGESCHLOSSEN", task.title);
    return task;
  }

  fail(id: string, error: Pick<ErrorDetail, "code" | "message"> & Partial<ErrorDetail>, ctx?: OpContext): Task {
    const task = this.find(id);
    const before = { status: task.status };
    task.errors.push({ severity: "error", retryable: true, correlationId: this.w.correlationId(ctx), details: {}, ...error });
    this.applyStatus(task, "failed");
    this.finishMutation(task, ctx, "task.failed", before);
    return task;
  }

  /** Moves a task to any status without guard/idempotency (agent stop, commands, scenarios). */
  setStatus(id: string, next: TaskStatus, ctx?: OpContext, reason?: string): Task {
    const task = this.find(id);
    if (task.status === next) return task;
    const before = { status: task.status };
    this.applyStatus(task, next);
    const action = next === "done" ? "task.completed" : next === "failed" ? "task.failed" : next === "cancelled" ? "task.cancelled" : "task.updated";
    this.finishMutation(task, ctx, action, before, undefined, reason);
    return task;
  }

  private applyStatus(task: Task, next: TaskStatus): void {
    const now = this.w.nowIso();
    const previous = task.status;
    task.status = next;
    if (next === "running") {
      task.startedAt ??= now;
      task.runtimeMs ??= 0;
      if (task.progress.mode === "none") task.progress = { mode: "indeterminate", value: null };
      if (task.agentId) this.w.agents.attach(task.agentId, task.id);
      if (!task.steps.some((step) => step.status === "running")) {
        const first = task.steps.find((step) => step.status === "pending");
        if (first) {
          first.status = "running";
          first.startedAt = now;
        }
      }
    }
    if (next === "done") {
      task.progress = { mode: "determinate", value: 1 };
      task.estimatedCompletionAt = null;
      task.blockers = [];
      for (const step of task.steps) if (step.status === "pending" || step.status === "running") step.status = "done";
      this.w.agents.release(task.id);
    }
    if (next === "failed" || next === "cancelled") {
      for (const step of task.steps) if (step.status === "running") step.status = next === "failed" ? "failed" : "skipped";
      task.estimatedCompletionAt = null;
      this.w.agents.release(task.id);
    }
    if (next === "cancelled") this.w.approvals.cancelForTask(task.id);
    if (next === "review" || next === "waiting") {
      if (previous === "running") this.w.agents.release(task.id, next === "waiting" ? "waiting" : "idle");
    }
  }

  /** Bumps version, publishes the right task event, logs activity and audit. */
  private finishMutation(
    task: Task,
    ctx: OpContext | undefined,
    action: string,
    before: Record<string, unknown>,
    forceType?: "jarvis.task.updated",
    reason?: string,
  ): void {
    task.lastActivityAt = this.w.nowIso();
    this.w.bump(task);
    const correlationId = this.w.correlationId(ctx);
    const type =
      forceType ??
      (task.status === "done" ? "jarvis.task.completed" : task.status === "failed" ? "jarvis.task.failed" : task.status === "cancelled" ? "jarvis.task.cancelled" : "jarvis.task.updated");
    const event = this.w.emitFor("tasks", type, task, `task/${task.id}`, correlationId);
    this.w.logActivity({
      kind: "task",
      title: `${ACTION_TITLES[action] ?? "Aufgabe aktualisiert"}: ${task.title}`,
      correlationId,
      taskId: task.id,
      agentId: task.agentId,
      adapterId: "mock-tasks",
      status: task.status === "failed" ? "failed" : task.status === "cancelled" ? "cancelled" : "succeeded",
      ...(reason ? { summary: `Grund: ${reason}` } : {}),
    });
    this.w.recordAudit({
      category: ctx?.actor?.type === "agent" ? "agent_action" : "user_action",
      action,
      correlationId,
      taskId: task.id,
      agentId: task.agentId,
      adapterId: "mock-tasks",
      actor: this.w.actorOf(ctx),
      before,
      after: { status: task.status, priority: task.priority },
      context: { causedBy: event.id, ...(reason ? { reason } : {}) },
    });
  }
}

const ACTION_TITLES: Record<string, string> = {
  "task.updated": "Aufgabe aktualisiert",
  "task.cancelled": "Aufgabe abgebrochen",
  "task.retried": "Aufgabe wird wiederholt",
  "task.paused": "Aufgabe pausiert",
  "task.resumed": "Aufgabe fortgesetzt",
  "task.completed": "Aufgabe abgeschlossen",
  "task.failed": "Aufgabe fehlgeschlagen",
};
