import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AdapterError, PORT_SPEC, validatePortResult } from "@friday/adapter-core";
import { HermesAgentsAdapter, createTaskIds } from "../src";
import { createHermesFake, type HermesFake } from "./fake/server";
import { start, type Harness } from "./helpers";

let fake: HermesFake;
let harness: Harness<HermesAgentsAdapter> | undefined;

async function open(
  config: Record<string, unknown> = {},
  secrets: Record<string, string> = { apiKey: fake.state.apiKey },
) {
  harness = await start(
    new HermesAgentsAdapter(),
    {
      apiBaseUrl: fake.apiUrl,
      dashboardBaseUrl: fake.dashboardUrl,
      boards: ["default"],
      eventsStartCursor: 0,
      eventsDrainMs: 150,
      ...config,
    },
    secrets,
  );
  return harness;
}

async function rejection(promise: Promise<unknown>): Promise<AdapterError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AdapterError);
    return error as AdapterError;
  }
  throw new Error("expected a rejection");
}

beforeEach(async () => {
  fake = await createHermesFake();
  fake.state.profiles.push({
    name: "kira",
    display_name: "Kira",
    is_default: false,
    model: "k3",
    provider: "kimi-coding",
    description: "Recherche und Berichte",
    skill_count: 12,
  });
});

afterEach(async () => {
  await harness?.stop();
  harness = undefined;
  await fake.close();
});

describe("agents: read", () => {
  it("unions profiles and Kanban assignees and derives status, task and performance", async () => {
    const running = fake.state.addTask("default", { title: "Läuft", assignee: "kira" });
    fake.state.startWorker("default", running);
    const done = fake.state.addTask("default", { title: "Fertig", assignee: "kira", status: "done" });
    done.started_at = fake.state.now();
    done.completed_at = done.started_at + 120;
    fake.state.addTask("default", {
      title: "Abgestürzt",
      assignee: "kira",
      status: "blocked",
      last_failure_error: "Absturz",
    });
    fake.state.addTask("default", {
      title: "Rückfrage",
      assignee: "bob",
      status: "blocked",
      block_kind: "needs_input",
    });
    const h = await open();

    const page = await h.adapter.listAgents({}, h.call());

    validatePortResult(PORT_SPEC.agents.listAgents, page, { what: "listAgents" });
    expect(page.items.map((agent) => agent.name)).toEqual(["Hermes", "bob", "Kira"]);
    const agents = Object.fromEntries(page.items.map((agent) => [agent.name, agent]));
    expect(agents.Hermes).toMatchObject({
      status: "idle",
      role: "Assistent",
      model: "k3",
      currentTaskId: null,
    });
    expect(agents.bob).toMatchObject({ status: "waiting", model: null });
    expect(agents.bob?.configuration).toMatchObject({ onDisk: false, isDefault: false });
    expect(agents.Kira).toMatchObject({
      status: "working",
      role: "Recherche und Berichte",
      model: "k3",
      reasoningLevel: "none",
      activeTools: [],
      capabilities: ["web"],
      currentTaskId: createTaskIds().encode({ board: "default", taskId: running.id }),
      performance: { tasksCompleted: 1, tasksFailed: 1, avgTaskDurationMs: 120_000 },
      successRate: 0.5,
      lastError: { code: "INTERNAL", message: "Absturz" },
    });
    expect(agents.Kira?.runtimeMs).toBeGreaterThanOrEqual(0);
    expect(agents.Kira?.heartbeatAt).not.toBeNull();
    expect(agents.Kira?.id).toMatch(/^agent_[0-9A-Za-z]{26}$/);
  });

  it("marks every agent offline while the gateway is stopped", async () => {
    fake.state.gatewayRunning = false;
    const h = await open();
    expect(
      (await h.adapter.listAgents({}, h.call())).items.every((agent) => agent.status === "offline"),
    ).toBe(true);
  });

  it("works without an API key: capabilities stay empty and the problem is logged once", async () => {
    const h = await open({}, {});
    const first = await h.adapter.listAgents({}, h.call());
    await h.adapter.listAgents({}, h.call());
    expect(first.items.every((agent) => agent.capabilities.length === 0)).toBe(true);
    expect(h.logs.filter((record) => record.message.includes("Toolsets"))).toHaveLength(1);
    expect(fake.callsTo("api", "/v1/toolsets")).toHaveLength(0);
  });

  it("filters by status and text, pages and keeps versions monotonic per state change", async () => {
    const h = await open();
    const initial = await h.adapter.listAgents({}, h.call());
    expect((await h.adapter.listAgents({ q: "recherche" }, h.call())).items.map((a) => a.name)).toEqual([
      "Kira",
    ]);
    expect((await h.adapter.listAgents({ status: ["working"] }, h.call())).items).toHaveLength(0);
    const firstPage = await h.adapter.listAgents({ limit: 1 }, h.call());
    expect(firstPage.pageInfo).toEqual({ nextCursor: "o1", hasNextPage: true });

    const task = fake.state.addTask("default", { title: "Neu", assignee: "kira" });
    fake.state.startWorker("default", task);
    const later = await h.adapter.listAgents({}, h.call());
    const before = initial.items.find((a) => a.name === "Kira");
    const after = later.items.find((a) => a.name === "Kira");
    expect(after?.version).toBeGreaterThan(before?.version ?? 0);
    expect(later.items.find((a) => a.name === "Hermes")?.version).toBe(
      initial.items.find((a) => a.name === "Hermes")?.version,
    );
    expect(after?.createdAt).toBe(before?.createdAt);
  });

  it("returns single agents and NOT_FOUND", async () => {
    const h = await open();
    const kira = (await h.adapter.listAgents({}, h.call())).items.find((a) => a.name === "Kira");
    expect((await h.adapter.getAgent({ id: kira?.id ?? "" }, h.call())).data.name).toBe("Kira");
    expect(
      (await rejection(h.adapter.getAgent({ id: "agent_00000000000000000000000000" }, h.call()))).code,
    ).toBe("NOT_FOUND");
  });
});

describe("agents: capabilities and health", () => {
  it("declares agents.stop and leaves pause/resume absent", async () => {
    const h = await open();
    expect((await h.adapter.getCapabilities()).capabilities).toEqual(["agents.read", "agents.stop"]);
    for (const method of ["pauseAgent", "resumeAgent"]) {
      expect((h.adapter as unknown as Record<string, unknown>)[method]).toBeUndefined();
    }
    expect((await h.adapter.healthCheck()).status).toBe("online");
  });
});

describe("agents: stop", () => {
  it("fails closed when the installed Hermes has no run-scoped stop patch", async () => {
    const task = fake.state.addTask("default", { title: "Lauf", assignee: "kira" });
    fake.state.startWorker("default", task);
    fake.state.runStopPatched = false;
    const h = await open();
    const agent = (await h.adapter.listAgents({}, h.call())).items.find((item) => item.name === "Kira")!;
    expect((await rejection(h.adapter.stopAgent({ id: agent.id }, h.mutation()))).code).toBe("CAPABILITY_MISSING");
    expect(fake.callsTo("dashboard", /\/terminate$/)).toHaveLength(0);
    expect(fake.state.workers).toHaveLength(1);
  });

  it("terminates exactly one live run and checks the worker disappeared", async () => {
    const task = fake.state.addTask("default", { title: "Lauf", assignee: "kira" });
    fake.state.startWorker("default", task);
    const h = await open();
    const agent = (await h.adapter.listAgents({}, h.call())).items.find((item) => item.name === "Kira")!;
    const stopped = await h.adapter.stopAgent({ id: agent.id }, h.mutation({ ifMatchVersion: agent.version }));
    expect(stopped.data.status).toBe("idle");
    expect(fake.state.workers).toHaveLength(0);
    expect(task.status).toBe("blocked");
    expect(task.block_kind).toBe("friday_stopped");
    expect(fake.callsTo("dashboard", /\/terminate$/).filter((call) => call.method === "POST")).toHaveLength(1);
  });

  it("refuses zero or multiple runs without sending terminate", async () => {
    const h = await open();
    const agent = (await h.adapter.listAgents({}, h.call())).items.find((item) => item.name === "Kira")!;
    expect((await rejection(h.adapter.stopAgent({ id: agent.id }, h.mutation()))).code).toBe("CONFLICT");
    const first = fake.state.addTask("default", { title: "Erster", assignee: "kira" });
    const second = fake.state.addTask("default", { title: "Zweiter", assignee: "kira" });
    fake.state.startWorker("default", first);
    fake.state.startWorker("default", second);
    expect((await rejection(h.adapter.stopAgent({ id: agent.id }, h.mutation()))).code).toBe("CONFLICT");
    expect(fake.callsTo("dashboard", /\/terminate$/)).toHaveLength(0);
  });
});

describe("agents: events", () => {
  it("emits status_changed with the agent snapshot after Kanban events that move an agent", async () => {
    const h = await open();
    fake.state.publishAgentEvents(3); // spawned, blocked, completed on a task of kira

    expect(await h.adapter.pollEvents?.()).toBe(3);

    expect(h.emitted.map((event) => event.type)).toEqual(Array(3).fill("friday.agent.status_changed"));
    expect((h.emitted[0]?.data as { name: string }).name).toBe("Kira");
    expect(await h.adapter.pollEvents?.()).toBe(0);
  });

  it("emits a heartbeat when a worker's heartbeat advances, once per advance", async () => {
    const task = fake.state.addTask("default", { title: "Läuft", assignee: "kira" });
    const worker = fake.state.startWorker("default", task);
    const h = await open({ eventsStartCursor: "tail" });

    expect(await h.adapter.pollEvents?.()).toBe(1);
    expect(h.emitted[0]).toMatchObject({ type: "friday.agent.heartbeat" });
    expect(h.emitted[0]?.data as { status: string; currentTaskId: string }).toMatchObject({
      status: "working",
      currentTaskId: createTaskIds().encode({ board: "default", taskId: task.id }),
    });
    expect(await h.adapter.pollEvents?.()).toBe(0);

    fake.state.heartbeat(worker);
    expect(await h.adapter.pollEvents?.()).toBe(1);
  });

  it("does not advance the Kanban cursor when the worker query fails", async () => {
    const h = await open();
    fake.state.publishAgentEvents(1);
    fake.forceStatus("api", undefined);
    const original = fake.state.workers.slice();
    Object.defineProperty(fake.state, "workers", {
      get: () => {
        throw new Error("boom");
      },
      configurable: true,
    });
    await expect(h.adapter.pollEvents?.()).rejects.toBeInstanceOf(AdapterError);
    expect(h.emitted).toHaveLength(0);

    Object.defineProperty(fake.state, "workers", { value: original, configurable: true, writable: true });
    expect(await h.adapter.pollEvents?.()).toBe(1);
  });
});
