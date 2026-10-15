import type { Agent, AgentStatus, Task } from "@friday/sdk";
import { conflict, notFound } from "../../core/errors";
import { asList, clone, compareAsc, matchesQuery, type Page } from "../../core/util";
import type { MockWorld } from "../world";
import type { OpContext } from "../types";
import { AGENT_STATUSES, checkEnum, pageOf, type Query } from "./shared";

export type AgentListQuery = Query<"listAgents">;

const PAUSE_BLOCKER = "Vom Benutzer pausiert";

export class AgentService {
  constructor(private readonly w: MockWorld) {}

  find(id: string): Agent {
    const agent = this.w.state.agents.find((candidate) => candidate.id === id);
    if (!agent) throw notFound("Agent", id);
    return agent;
  }

  list(query: AgentListQuery = {}): Page<Agent> {
    return this.w.read("listAgents", () => {
      const statuses = asList(query.status);
      checkEnum("status", statuses, AGENT_STATUSES);
      const items = this.w.state.agents
        .filter((agent) => (statuses.length ? statuses.includes(agent.status) : true))
        .filter((agent) => matchesQuery(`${agent.name} ${agent.role} ${agent.capabilities.join(" ")}`, query.q))
        .sort((a, b) => compareAsc(a.name, b.name) || compareAsc(a.id, b.id));
      return pageOf(items, query);
    });
  }

  get(id: string): Agent {
    return this.w.read("getAgent", () => clone(this.find(id)));
  }

  pause(id: string, ctx?: OpContext): Agent {
    return this.w.run("pauseAgent", ctx, { id }, () => {
      const agent = this.find(id);
      if (!(["idle", "starting", "working", "waiting"] as AgentStatus[]).includes(agent.status)) {
        throw conflict(`Agent ${agent.name} kann im Status ${agent.status} nicht pausiert werden.`, { status: agent.status });
      }
      const before = agent.status;
      const task = agent.currentTaskId ? this.w.state.tasks.find((candidate) => candidate.id === agent.currentTaskId) : undefined;
      if (task && task.status === "running") {
        task.status = "waiting";
        task.blockers = [...task.blockers, { id: this.w.id("blk"), kind: "other", description: PAUSE_BLOCKER, since: this.w.nowIso() }];
        this.w.bump(task);
        this.w.emitFor("tasks", "friday.task.updated", task, `task/${task.id}`);
      }
      agent.status = "paused";
      this.commit(agent, ctx, "agent.paused", { status: before });
      return clone(agent);
    });
  }

  resume(id: string, ctx?: OpContext): Agent {
    return this.w.run("resumeAgent", ctx, { id }, () => {
      const agent = this.find(id);
      if (agent.status !== "paused") throw conflict(`Agent ${agent.name} ist nicht pausiert.`, { status: agent.status });
      const task = agent.currentTaskId ? this.w.state.tasks.find((candidate) => candidate.id === agent.currentTaskId) : undefined;
      if (task && task.status === "waiting" && task.blockers.some((blocker) => blocker.description === PAUSE_BLOCKER)) {
        task.blockers = task.blockers.filter((blocker) => blocker.description !== PAUSE_BLOCKER);
        task.status = "running";
        this.w.bump(task);
        this.w.emitFor("tasks", "friday.task.updated", task, `task/${task.id}`);
      }
      agent.status = task && task.status === "running" ? "working" : "idle";
      this.commit(agent, ctx, "agent.resumed", { status: "paused" });
      return clone(agent);
    });
  }

  stop(id: string, ctx?: OpContext): Agent {
    return this.w.run("stopAgent", ctx, { id }, () => {
      const agent = this.find(id);
      if (agent.status === "idle" || agent.status === "offline") throw conflict(`Agent ${agent.name} führt keine Arbeit aus.`, { status: agent.status });
      const before = agent.status;
      const taskId = agent.currentTaskId;
      agent.status = "idle";
      agent.currentTaskId = null;
      agent.activeTools = [];
      agent.startedAt = null;
      agent.runtimeMs = null;
      if (taskId) {
        const task = this.w.state.tasks.find((candidate) => candidate.id === taskId);
        if (task && (task.status === "running" || task.status === "waiting")) this.w.tasks.setStatus(taskId, "cancelled", ctx, "Agent wurde gestoppt");
      }
      this.commit(agent, ctx, "agent.stopped", { status: before });
      return clone(agent);
    });
  }

  // ---- internal hooks ----

  /** Assigns the agent to a task it starts working on. */
  attach(agentId: string, taskId: string): void {
    const agent = this.w.state.agents.find((candidate) => candidate.id === agentId);
    if (!agent) return;
    const now = this.w.nowIso();
    agent.status = "working";
    agent.currentTaskId = taskId;
    agent.startedAt ??= now;
    agent.runtimeMs ??= 0;
    if (agent.activeTools.length === 0) agent.activeTools = [agent.capabilities.length ? "fs.read" : "web.fetch"];
    agent.heartbeatAt = now;
    agent.lastActivityAt = now;
    this.publish(agent);
  }

  /** Frees agents working on a task (finished, cancelled, failed or blocked). */
  release(taskId: string, status: AgentStatus = "idle"): void {
    for (const agent of this.w.state.agents) {
      if (agent.currentTaskId !== taskId) continue;
      agent.status = status;
      if (status === "idle") {
        agent.currentTaskId = null;
        agent.startedAt = null;
        agent.runtimeMs = null;
      }
      agent.activeTools = [];
      agent.lastActivityAt = this.w.nowIso();
      this.publish(agent);
    }
  }

  setStatusForTask(task: Task, status: AgentStatus): void {
    const agent = task.agentId ? this.w.state.agents.find((candidate) => candidate.id === task.agentId) : undefined;
    if (!agent) return;
    agent.status = status;
    this.publish(agent);
  }

  /** Simulation hook (scenarios): sets an agent status and publishes the change. */
  setStatus(id: string, status: AgentStatus, options: { taskId?: string | null; error?: string } = {}): Agent {
    const agent = this.find(id);
    agent.status = status;
    if (options.taskId !== undefined) agent.currentTaskId = options.taskId;
    if (status === "working") {
      agent.startedAt ??= this.w.nowIso();
      agent.runtimeMs ??= 0;
      if (agent.activeTools.length === 0) agent.activeTools = ["fs.read"];
    } else {
      agent.activeTools = [];
      if (status === "idle") {
        agent.currentTaskId = null;
        agent.startedAt = null;
        agent.runtimeMs = null;
      }
    }
    if (status === "error" && options.error) {
      agent.lastError = { code: "INTERNAL", message: options.error, severity: "error", retryable: true, correlationId: this.w.correlationId(), details: {} };
    }
    agent.lastActivityAt = this.w.nowIso();
    this.publish(agent);
    this.w.refresh();
    return agent;
  }

  publishHeartbeats(): void {
    const now = this.w.nowIso();
    for (const agent of this.w.state.agents) {
      if (agent.status === "offline") continue;
      agent.heartbeatAt = now;
      if (agent.startedAt && (agent.status === "working" || agent.status === "waiting")) {
        agent.runtimeMs = Math.max(0, this.w.nowMs() - Date.parse(agent.startedAt));
      }
      this.w.emitFor("agents", "friday.agent.heartbeat", { agentId: agent.id, heartbeatAt: now, status: agent.status, currentTaskId: agent.currentTaskId }, `agent/${agent.id}`);
    }
  }

  private publish(agent: Agent): void {
    this.w.bump(agent);
    this.w.emitFor("agents", "friday.agent.status_changed", agent, `agent/${agent.id}`);
  }

  private commit(agent: Agent, ctx: OpContext | undefined, action: string, before: Record<string, unknown>): void {
    const correlationId = this.w.correlationId(ctx);
    agent.lastActivityAt = this.w.nowIso();
    this.w.bump(agent);
    this.w.emitFor("agents", "friday.agent.status_changed", agent, `agent/${agent.id}`, correlationId);
    this.w.logActivity({
      kind: "agent",
      title: `${agent.name}: ${action === "agent.paused" ? "pausiert" : action === "agent.resumed" ? "fortgesetzt" : "gestoppt"}`,
      correlationId,
      agentId: agent.id,
      taskId: agent.currentTaskId,
      adapterId: "mock-agents",
      actor: this.w.actorOf(ctx),
    });
    this.w.recordAudit({
      category: "user_action",
      action,
      correlationId,
      agentId: agent.id,
      adapterId: "mock-agents",
      actor: this.w.actorOf(ctx),
      before,
      after: { status: agent.status },
    });
  }
}
