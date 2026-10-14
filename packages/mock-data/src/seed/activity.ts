import type { ActivityEvent, ActivityKind, Actor, Agent, Severity, Task, TaskToolCall } from "@jarvis/sdk";
import { MIN, type SeedContext } from "./context";

type ActivityStatus = ActivityEvent["status"];

const TASK_STATUS_TO_ACTIVITY: Record<Task["status"], ActivityStatus> = {
  triage: "info",
  todo: "info",
  ready: "info",
  running: "running",
  waiting: "running",
  review: "succeeded",
  done: "succeeded",
  failed: "failed",
  cancelled: "cancelled",
};

const SOURCE_DOMAINS = [
  "buero-nord.example",
  "foerderdatenbank.example",
  "netzagentur-info.example",
  "hannover-region.example",
  "kfw-programme.example",
  "moebelhaus-weserstrasse.example",
];

const EXTRA_TOOLS = ["fs.read", "memory.search", "web.fetch", "calendar.read", "mail.read", "system.metrics"];

/** An event before ids, sequence and the resource envelope fields are assigned. */
type Node = Omit<ActivityEvent, "id" | "sequence" | "version" | "createdAt" | "updatedAt" | "source" | "occurredAt"> & {
  occurredMs: number;
};

export interface ActivityBuildOptions {
  tasks: Task[];
  agents: Agent[];
  /** Exact number of events to produce. */
  target: number;
  /** Additional synthetic tool calls per task tree (used by the high-load profile). */
  extraToolCallsPerTask: number;
}

const toolStatus = (status: TaskToolCall["status"]): ActivityStatus =>
  status === "running" ? "running" : status === "failed" ? "failed" : "succeeded";

const iso = (ms: number): string => new Date(ms).toISOString();

/**
 * Builds the activity tree (PLAN §29.4): user_request → task → agent → tool_call/source_read/result, task → artifact,
 * plus adapter/system noise. Sequence numbers follow chronological order so `sinceSequence` backfill is consistent.
 */
export function buildActivity(ctx: SeedContext, options: ActivityBuildOptions): ActivityEvent[] {
  const agentById = new Map(options.agents.map((agent) => [agent.id, agent]));
  const nodes: (Node & { id: string })[] = [];

  const push = (node: Node): string => {
    const id = ctx.id("act");
    nodes.push({ ...node, id });
    return id;
  };

  const systemActor: Actor = { type: "system", id: "control-api", name: "Control API" };

  const tree = (task: Task, ordinal: number): void => {
    const agent = task.agentId ? agentById.get(task.agentId) : undefined;
    const created = Date.parse(task.createdAt);
    const started = task.startedAt ? Date.parse(task.startedAt) : created + 30_000;
    const correlationId = ctx.id("corr");
    const base = { correlationId, taskId: task.id, model: task.model, status: "succeeded" as ActivityStatus };
    const agentActor: Actor | undefined = agent ? { type: "agent", id: agent.id, name: agent.name } : undefined;

    const rootId = push({
      ...base,
      kind: "user_request",
      severity: "info",
      title: `Anfrage: ${task.title}`,
      summary: "Auftrag von Erik über Dashboard oder Sprache erhalten.",
      parentId: null,
      agentId: null,
      tool: null,
      adapterId: "mock-commands",
      occurredMs: created,
      endedAt: iso(created + 1_200),
      durationMs: 1_200,
      actor: ctx.owner,
    });
    const taskNode = push({
      ...base,
      kind: "task",
      severity: "info",
      title: `Aufgabe angelegt: ${task.title}`,
      parentId: rootId,
      agentId: null,
      tool: null,
      adapterId: "mock-tasks",
      occurredMs: created + 1_500,
      endedAt: iso(created + 1_800),
      durationMs: 300,
      actor: systemActor,
      details: { priority: task.priority, ordinal },
    });
    if (!agent || !agentActor) return;

    const agentNode = push({
      ...base,
      kind: "agent",
      severity: task.status === "failed" ? "error" : "info",
      title: `${agent.name} bearbeitet: ${task.title}`,
      status: TASK_STATUS_TO_ACTIVITY[task.status],
      parentId: taskNode,
      agentId: agent.id,
      tool: null,
      adapterId: "mock-agents",
      occurredMs: started,
      endedAt: task.status === "running" || task.status === "waiting" ? null : task.updatedAt,
      durationMs: task.runtimeMs,
      actor: agentActor,
    });

    task.toolCalls.forEach((call, index) => {
      const callStart = Date.parse(call.startedAt);
      const failed = call.status === "failed";
      push({
        ...base,
        kind: "tool_call",
        severity: failed ? "error" : "info",
        title: call.summary ?? `Werkzeug ${call.tool} wird ausgeführt`,
        summary: `${call.tool} ${call.status === "running" ? "läuft" : failed ? "schlug fehl" : "erfolgreich"}`,
        status: toolStatus(call.status),
        parentId: agentNode,
        agentId: agent.id,
        tool: call.tool,
        adapterId: call.adapterId ?? "mock-tasks",
        occurredMs: callStart,
        endedAt: call.durationMs !== undefined ? iso(callStart + call.durationMs) : null,
        durationMs: call.durationMs ?? null,
        result: call.status === "succeeded" ? (call.summary ?? "ok") : null,
        ...(failed && task.errors[0] ? { error: task.errors[0] } : {}),
        actor: agentActor,
        details: { callIndex: index },
      });
    });

    for (let i = 0; i < options.extraToolCallsPerTask; i++) {
      const tool = EXTRA_TOOLS[(ordinal + i) % EXTRA_TOOLS.length] as string;
      const callStart = started + (i + 1) * 40_000;
      const duration = ctx.rng.int(60, 3_000);
      push({
        ...base,
        kind: i % 3 === 2 ? "source_read" : "tool_call",
        severity: "info",
        title: `${tool} ausgeführt (${i + 1})`,
        status: "succeeded",
        parentId: agentNode,
        agentId: agent.id,
        tool,
        adapterId: "mock-tasks",
        occurredMs: callStart,
        endedAt: iso(callStart + duration),
        durationMs: duration,
        result: "ok",
        actor: agentActor,
      });
    }

    if (agent.role.toLowerCase().includes("recherche")) {
      for (let i = 0; i < 2; i++) {
        const domain = SOURCE_DOMAINS[(ordinal + i) % SOURCE_DOMAINS.length] as string;
        const readStart = started + (i + 1) * 90_000;
        push({
          ...base,
          kind: "source_read",
          severity: "info",
          title: `Quelle gelesen: ${domain}`,
          parentId: agentNode,
          agentId: agent.id,
          tool: "web.fetch",
          adapterId: "mock-research",
          occurredMs: readStart,
          endedAt: iso(readStart + 1_400),
          durationMs: 1_400,
          result: "Inhalt extrahiert",
          actor: agentActor,
        });
      }
    }

    const finished = Date.parse(task.updatedAt);
    if (task.status === "done" || task.status === "review") {
      push({
        ...base,
        kind: "result",
        severity: "info",
        title: `Ergebnis: ${task.title}`,
        summary: task.status === "review" ? "Ergebnis liegt zur Prüfung vor." : "Aufgabe abgeschlossen.",
        parentId: agentNode,
        agentId: agent.id,
        tool: null,
        adapterId: "mock-tasks",
        occurredMs: finished - 5_000,
        endedAt: task.updatedAt,
        durationMs: 5_000,
        result: "Ergebnis bereitgestellt",
        actor: agentActor,
      });
    }
    for (const artifact of task.artifacts) {
      push({
        ...base,
        kind: "artifact",
        severity: "info",
        title: `Artefakt erzeugt: ${artifact.name}`,
        parentId: taskNode,
        agentId: agent.id,
        tool: "fs.write",
        adapterId: "mock-files",
        occurredMs: finished - 3_000,
        endedAt: task.updatedAt,
        durationMs: 2_000,
        result: artifact.name,
        actor: agentActor,
        details: { fileId: artifact.fileId ?? null },
      });
    }
  };

  for (let index = 0; index < options.tasks.length && nodes.length < options.target; index++) {
    tree(options.tasks[index] as Task, index);
  }

  const noise: { kind: ActivityKind; title: string; severity: Severity; adapterId: string }[] = [
    { kind: "adapter", title: "Adapter mock-communication synchronisiert (5 neue Nachrichten)", severity: "info", adapterId: "mock-communication" },
    { kind: "adapter", title: "Adapter mock-calendar synchronisiert", severity: "info", adapterId: "mock-calendar" },
    { kind: "system", title: "Dienst Windows Worker: Antwortzeit erhöht", severity: "warning", adapterId: "mock-system" },
    { kind: "system", title: "Heartbeat-Prüfung aller Agenten abgeschlossen", severity: "info", adapterId: "mock-agents" },
    { kind: "adapter", title: "Adapter mock-memory: Index aktualisiert", severity: "info", adapterId: "mock-memory" },
  ];
  for (let noiseIndex = 0; nodes.length < options.target; noiseIndex++) {
    const entry = noise[noiseIndex % noise.length] as (typeof noise)[number];
    push({
      kind: entry.kind,
      severity: entry.severity,
      title: entry.title,
      status: "info",
      parentId: null,
      correlationId: ctx.id("corr"),
      adapterId: entry.adapterId,
      tool: null,
      agentId: null,
      taskId: null,
      model: null,
      occurredMs: ctx.now - (noiseIndex + 1) * 4 * MIN - ctx.rng.int(0, 120_000),
      endedAt: null,
      durationMs: null,
      actor: systemActor,
    });
  }

  // Trees are appended parent-first, so trimming the tail never orphans a remaining child.
  const kept = nodes.slice(0, options.target);
  kept.sort((a, b) => a.occurredMs - b.occurredMs);
  return kept.map((node, index) => {
    const { occurredMs, ...rest } = node;
    const at = iso(occurredMs);
    return { ...rest, version: 1, createdAt: at, updatedAt: at, occurredAt: at, source: ctx.src("activity"), sequence: index + 1 };
  });
}
