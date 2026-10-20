import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterError, validatePortResult, PORT_SPEC } from "@friday/adapter-core";
import { HermesTasksAdapter } from "../src";
import { createHermesFake, type HermesFake } from "./fake/server";
import { start, type Harness } from "./helpers";

let fake: HermesFake;
let harness: Harness<HermesTasksAdapter> | undefined;

const baseConfig = () => ({
  apiBaseUrl: fake.apiUrl,
  dashboardBaseUrl: fake.dashboardUrl,
  boards: ["default", "business"],
  eventsStartCursor: 0,
  eventsDrainMs: 150,
});

async function open(config: Record<string, unknown> = {}, secrets: Record<string, string> = {}) {
  harness = await start(new HermesTasksAdapter(), { ...baseConfig(), ...config }, secrets);
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
  fake.state.addBoard("business", "Business");
});

afterEach(async () => {
  await harness?.stop();
  harness = undefined;
  await fake.close();
});

describe("tasks: read", () => {
  it("lists tasks of all configured boards with contract-valid, board-aware ids and metadata", async () => {
    fake.state.addTask("default", { title: "Rechnung prüfen", assignee: "kira", priority: 4 });
    const done = fake.state.addTask("business", {
      title: "Angebot für Kunde prüfen",
      body: "Details",
      assignee: "kira",
      priority: 2,
    });
    done.status = "done";
    done.completed_at = fake.state.tick();
    const h = await open();

    const page = await h.adapter.listTasks({}, h.call());

    validatePortResult(PORT_SPEC.tasks.listTasks, page, { what: "listTasks" });
    expect(page.items).toHaveLength(2);
    const byTitle = Object.fromEntries(page.items.map((task) => [task.title, task]));
    expect(byTitle["Rechnung prüfen"]).toMatchObject({
      status: "ready",
      priority: "P0",
      agentName: "kira",
      model: null,
      labels: ["board:default"],
    });
    expect(byTitle["Angebot für Kunde prüfen"]).toMatchObject({
      status: "done",
      priority: "P2",
      description: "Details",
      labels: ["board:business"],
      source: { adapterId: "hermes-tasks", system: "hermes" },
    });
    // The id is a contract id, the Hermes id and board are only in source.externalId.
    expect(byTitle["Angebot für Kunde prüfen"]?.id).toMatch(/^task_[0-9A-Za-z]{26}$/);
    expect(byTitle["Angebot für Kunde prüfen"]?.source.externalId).toMatch(/^business\/t_[0-9a-f]{8}$/);
    // Agent ids are shared with the agents adapter: same name -> same contract id.
    expect(byTitle["Rechnung prüfen"]?.agentId).toBe(byTitle["Angebot für Kunde prüfen"]?.agentId);
  });

  it("fills the model from the profile unless the task has an override", async () => {
    fake.state.profiles.push({
      name: "kira",
      is_default: false,
      model: "k3",
      provider: "kimi-coding",
      description: "",
      skill_count: 1,
    });
    fake.state.addTask("default", { title: "Mit Profilmodell", assignee: "kira" });
    fake.state.addTask("default", { title: "Mit Override", assignee: "kira", model_override: "qwen-local" });
    fake.state.addTask("default", { title: "Ohne Agent" });
    const h = await open({ boards: ["default"] });

    const items = (await h.adapter.listTasks({}, h.call())).items;

    expect(Object.fromEntries(items.map((task) => [task.title, task.model]))).toEqual({
      "Mit Profilmodell": "k3",
      "Mit Override": "qwen-local",
      "Ohne Agent": null,
    });
  });

  it("filters, sorts and pages client side", async () => {
    for (let index = 0; index < 5; index += 1) {
      fake.state.addTask("default", {
        title: `Aufgabe ${index}`,
        priority: index,
        assignee: index < 2 ? "kira" : null,
        status: index % 2 === 0 ? "ready" : "review",
      });
    }
    const h = await open({ boards: ["default"] });

    const ready = await h.adapter.listTasks({ status: ["ready"] }, h.call());
    expect(ready.items.map((t) => t.title).sort()).toEqual(["Aufgabe 0", "Aufgabe 2", "Aufgabe 4"]);

    const byPriority = await h.adapter.listTasks({ sort: "priority", limit: 2 }, h.call());
    expect(byPriority.items.map((t) => t.priority)).toEqual(["P0", "P1"]);
    expect(byPriority.pageInfo).toEqual({ nextCursor: "o2", hasNextPage: true });
    const second = await h.adapter.listTasks({ sort: "priority", limit: 2, cursor: "o2" }, h.call());
    expect(second.items.map((t) => t.priority)).toEqual(["P2", "P3"]);

    const search = await h.adapter.listTasks({ q: "aufgabe 3" }, h.call());
    expect(search.items.map((t) => t.title)).toEqual(["Aufgabe 3"]);

    const kira = (await h.adapter.listTasks({}, h.call())).items.find((t) => t.agentName === "kira");
    const forAgent = await h.adapter.listTasks({ agentId: kira?.agentId ?? "" }, h.call());
    expect(forAgent.items).toHaveLength(2);

    expect((await rejection(h.adapter.listTasks({ cursor: "kaputt" }, h.call()))).code).toBe(
      "VALIDATION_FAILED",
    );
  });

  it("includes archived tasks as cancelled only when asked for", async () => {
    const gone = fake.state.addTask("default", { title: "Verworfen" });
    gone.status = "archived";
    const h = await open({ boards: ["default"] });

    expect((await h.adapter.listTasks({}, h.call())).items).toHaveLength(0);
    const cancelled = await h.adapter.listTasks({ status: ["cancelled"] }, h.call());
    expect(cancelled.items.map((t) => [t.title, t.status])).toEqual([["Verworfen", "cancelled"]]);
  });

  it("derives waiting, failed, blockers, progress and runtime", async () => {
    const parent = fake.state.addTask("default", { title: "Eltern", assignee: "kira" });
    const child = fake.state.addTask("default", { title: "Kind", assignee: "kira", status: "done" });
    parent.children = [child.id];
    child.parents = [parent.id];
    fake.state.addTask("default", { title: "Braucht Eingabe", status: "blocked", block_kind: "needs_input" });
    fake.state.addTask("default", {
      title: "Abgestürzt",
      status: "blocked",
      last_failure_error: "Worker abgestürzt",
    });
    fake.state.addTask("default", { title: "Geplant", status: "scheduled" });
    const running = fake.state.addTask("default", { title: "Läuft", assignee: "kira" });
    fake.state.startWorker("default", running);
    const h = await open({ boards: ["default"] });

    const tasks = Object.fromEntries(
      (await h.adapter.listTasks({}, h.call())).items.map((t) => [t.title, t]),
    );

    expect(tasks["Eltern"]?.progress).toEqual({ mode: "determinate", value: 1 });
    expect(tasks["Braucht Eingabe"]).toMatchObject({ status: "waiting" });
    expect(tasks["Braucht Eingabe"]?.blockers[0]).toMatchObject({
      kind: "input_needed",
      description: "Wartet auf Eingabe",
    });
    expect(tasks["Abgestürzt"]).toMatchObject({ status: "failed" });
    expect(tasks["Abgestürzt"]?.errors[0]?.message).toBe("Worker abgestürzt");
    expect(tasks["Geplant"]).toMatchObject({ status: "waiting" });
    expect(tasks["Läuft"]).toMatchObject({
      status: "running",
      progress: { mode: "indeterminate", value: null },
    });
    expect(tasks["Läuft"]?.runtimeMs).toBeGreaterThan(0);
  });

  it("reads the detail with runs, events, comments and links", async () => {
    const board = fake.state.board("business");
    const task = fake.state.addTask("business", { title: "Detail", assignee: "kira", created_by: "kira" });
    const child = fake.state.addTask("business", { title: "Nachfolger" });
    task.children = [child.id];
    child.parents = [task.id];
    fake.state.setStatus(board, task, "blocked", { reason: "Warte auf Freigabe" });
    fake.state.addComment(board, task, "default", "Hallo Kommentar");
    fake.state.addRun(board, task, {
      status: "blocked",
      outcome: "blocked",
      summary: "Warte auf Freigabe",
      ended_at: fake.state.tick(),
    });
    const h = await open();

    const listed = (await h.adapter.listTasks({}, h.call())).items.find((t) => t.title === "Detail");
    const { data } = await h.adapter.getTask({ id: listed?.id ?? "" }, h.call());

    validatePortResult(
      PORT_SPEC.tasks.getTask,
      { data, freshness: { state: "fresh", asOf: data.updatedAt } },
      { what: "getTask" },
    );
    expect(data.blockers[0]).toMatchObject({ kind: "other", description: "Blockiert: Warte auf Freigabe" });
    expect(data.steps).toHaveLength(1);
    expect(data.steps[0]).toMatchObject({ status: "pending", detail: "Warte auf Freigabe" });
    expect(data.sourceRefs.map((ref) => ref.type)).toEqual(["task"]);
    expect(data.createdBy).toEqual({ type: "agent", id: "kira" });
    expect(data.parentTaskId).toBeNull();
    expect(Date.parse(data.lastActivityAt ?? "")).toBeGreaterThanOrEqual(Date.parse(data.updatedAt));
  });

  it("resolves hashed ids after a restart by re-reading the boards, and reports unknown ids as NOT_FOUND", async () => {
    const task = fake.state.addTask("business", { title: "Nach Neustart" });
    const first = await open();
    const id = (await first.adapter.listTasks({}, first.call())).items[0]?.id ?? "";
    await first.stop();

    const second = await open(); // new adapter instance: empty id table
    const { data } = await second.adapter.getTask({ id }, second.call());

    expect(data.title).toBe("Nach Neustart");
    expect(data.source.externalId).toBe(`business/${task.id}`);
    expect(
      (await rejection(second.adapter.getTask({ id: "task_00000000000000000000000000" }, second.call())))
        .code,
    ).toBe("NOT_FOUND");
  });

  it("rejects an unknown Hermes status instead of guessing a column", async () => {
    fake.state.addTask("default", { title: "Zukunft", status: "quantum" });
    const h = await open({ boards: ["default"] });
    // the fake only emits known columns for unknown statuses under "todo"; the card keeps its own status string
    const error = await rejection(h.adapter.listTasks({}, h.call()));
    expect(error.code).toBe("VALIDATION_FAILED");
    expect(error.message).toContain("quantum");
  });
});

describe("tasks: credentials", () => {
  it("scrapes the dashboard token once and sends it as X-Hermes-Session-Token", async () => {
    fake.state.addTask("default", { title: "A" });
    const h = await open({ boards: ["default"] });

    await h.adapter.listTasks({}, h.call());
    await h.adapter.listTasks({}, h.call());

    expect(fake.callsTo("dashboard", "/")).toHaveLength(1);
    const boardCalls = fake.callsTo("dashboard", "/api/plugins/kanban/board");
    expect(boardCalls.every((call) => call.headers["x-hermes-session-token"] === fake.state.token)).toBe(
      true,
    );
  });

  it("re-reads the token on 401 after a dashboard restart and repeats the request once", async () => {
    fake.state.addTask("default", { title: "A" });
    const h = await open({ boards: ["default"] });
    await h.adapter.listTasks({}, h.call());

    fake.state.rotateToken();
    const page = await h.adapter.listTasks({}, h.call());

    expect(page.items).toHaveLength(1);
    expect(fake.callsTo("dashboard", "/")).toHaveLength(2);
    const statuses = fake
      .callsTo("dashboard", "/api/plugins/kanban/board")
      .map((call) => call.headers["x-hermes-session-token"]);
    expect(statuses).toHaveLength(3); // ok, rejected (old token), ok (new token)
    expect(h.logs.some((record) => record.message.includes("rotiert"))).toBe(true);
  });

  it("does not loop on a rejected-but-unchanged token", async () => {
    const h = await open({ boards: ["default"] });
    await h.adapter.listTasks({}, h.call());
    fake.forceStatus("dashboard", 401);

    const error = await rejection(h.adapter.listTasks({}, h.call()));

    expect(error.code).toBe("UNAUTHENTICATED");
    expect(fake.callsTo("dashboard", "/api/plugins/kanban/board")).toHaveLength(2);
  });

  it("reports a gated dashboard (no token in the HTML) with an actionable message", async () => {
    fake.state.injectToken = false;
    const h = await open({ boards: ["default"] });

    const error = await rejection(h.adapter.listTasks({}, h.call()));

    expect(error.code).toBe("UNAUTHENTICATED");
    expect(error.message).toContain("HERMES_DASHBOARD_SESSION_TOKEN");
  });

  it("uses a fixed token from the secret store (dashboardAuth=secret) and never scrapes", async () => {
    const h = await open(
      { boards: ["default"], dashboardAuth: "secret" },
      { dashboardToken: fake.state.token },
    );

    await h.adapter.listTasks({}, h.call());

    expect(fake.callsTo("dashboard", "/")).toHaveLength(0);
    await h.stop();
    const wrong = await start(
      new HermesTasksAdapter(),
      { ...baseConfig(), boards: ["default"], dashboardAuth: "secret" },
      { dashboardToken: "falsches-token-0000" },
    );
    harness = wrong;
    expect((await rejection(wrong.adapter.listTasks({}, wrong.call()))).code).toBe("UNAUTHENTICATED");
  });

  it("reads a fixed token from a key file (dashboardAuth=file) and picks up a replaced file on 401", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hermes-adapter-"));
    try {
      const file = join(dir, "dashboard.token");
      await writeFile(file, `${fake.state.token}\n`);
      const h = await open({ boards: ["default"], dashboardAuth: "file", dashboardTokenFile: file });
      await h.adapter.listTasks({}, h.call());

      const rotated = fake.state.rotateToken();
      await writeFile(file, rotated);
      await h.adapter.listTasks({}, h.call());

      expect(fake.callsTo("dashboard", "/")).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("tasks: write", () => {
  it("pins a provider-qualified model and reasoning on the native Kanban card", async () => {
    const h = await open();
    const { data } = await h.adapter.createTask(
      { body: { title: "Geroutete Aufgabe", model: "kimi-coding:k3", reasoningLevel: "high" } },
      h.mutation(),
    );
    expect(data.model).toBe("kimi-coding:k3");
    expect(data.reasoningLevel).toBe("high");
    const post = fake.callsTo("dashboard", "/api/plugins/kanban/tasks").find((call) => call.method === "POST");
    expect(post?.body).toMatchObject({ model_override: "k3", provider_override: "kimi-coding", reasoning_effort: "high" });
    expect((await h.adapter.getTask({ id: data.id }, h.call())).data.model).toBe("kimi-coding:k3");
    expect((await h.adapter.getTask({ id: data.id }, h.call())).data.reasoningLevel).toBe("high");
  });
  it("creates a task on the first board with priority, assignee, model and idempotency key", async () => {
    fake.state.addTask("default", { title: "Vorhanden", assignee: "kira" });
    const h = await open({ boards: ["business", "default"] });
    const agentId = (await h.adapter.listTasks({}, h.call())).items[0]?.agentId ?? "";

    const { data } = await h.adapter.createTask(
      { body: { title: "Neue Aufgabe", description: "Text", priority: "P1", agentId, model: "k3" } },
      h.mutation({ idempotencyKey: "idem-key-0001" }),
    );

    expect(data).toMatchObject({
      title: "Neue Aufgabe",
      priority: "P1",
      agentName: "kira",
      model: "k3",
      labels: ["board:business"],
    });
    const post = fake
      .callsTo("dashboard", "/api/plugins/kanban/tasks")
      .find((call) => call.method === "POST");
    expect(post?.query).toEqual({ board: "business" });
    expect(post?.headers["idempotency-key"]).toBe("idem-key-0001");
    expect(post?.body).toMatchObject({
      title: "Neue Aufgabe",
      body: "Text",
      assignee: "kira",
      priority: 3,
      model_override: "k3",
      idempotency_key: "idem-key-0001",
    });
  });

  it("selects the board and tenant through labels and rejects labels Hermes cannot express", async () => {
    const h = await open();

    const created = await h.adapter.createTask(
      { body: { title: "Im Business-Board", labels: ["board:business", "tenant:acme"] } },
      h.mutation(),
    );
    expect(created.data.labels).toEqual(["board:business", "tenant:acme"]);

    expect(
      (await rejection(h.adapter.createTask({ body: { title: "x", labels: ["wichtig"] } }, h.mutation())))
        .code,
    ).toBe("VALIDATION_FAILED");
    expect(
      (
        await rejection(
          h.adapter.createTask({ body: { title: "x", labels: ["board:nirgends"] } }, h.mutation()),
        )
      ).code,
    ).toBe("VALIDATION_FAILED");
    expect(
      (
        await rejection(
          h.adapter.createTask({ body: { title: "x", dueAt: "2026-12-01T10:00:00.000Z" } }, h.mutation()),
        )
      ).code,
    ).toBe("VALIDATION_FAILED");
  });

  it("maps validation errors of Hermes ({detail}) to VALIDATION_FAILED without retrying", async () => {
    const h = await open({ boards: ["default"] });

    const error = await rejection(h.adapter.createTask({ body: { title: "   " } }, h.mutation()));

    expect(error.code).toBe("VALIDATION_FAILED");
    expect(
      fake.callsTo("dashboard", "/api/plugins/kanban/tasks").filter((c) => c.method === "POST"),
    ).toHaveLength(1);
  });

  it("updates title, description, priority, assignee and status; waiting becomes blocked", async () => {
    const task = fake.state.addTask("default", { title: "Alt", assignee: "kira" });
    const h = await open({ boards: ["default"] });
    const id = (await h.adapter.listTasks({}, h.call())).items[0]?.id ?? "";

    const { data } = await h.adapter.updateTask(
      {
        id,
        body: {
          title: "Neu",
          description: "Neu beschrieben",
          priority: "P0",
          agentId: null,
          status: "waiting",
        },
      },
      h.mutation(),
    );

    expect(data).toMatchObject({
      title: "Neu",
      description: "Neu beschrieben",
      priority: "P0",
      agentId: null,
      status: "waiting",
    });
    expect(fake.state.board("default").tasks.get(task.id)).toMatchObject({
      status: "blocked",
      assignee: null,
      priority: 4,
    });
    const patch = fake
      .callsTo("dashboard", `/api/plugins/kanban/tasks/${task.id}`)
      .find((call) => call.method === "PATCH");
    expect(patch?.body).toEqual({
      title: "Neu",
      body: "Neu beschrieben",
      status: "blocked",
      priority: 4,
      assignee: "",
    });
  });

  it("refuses statuses Hermes does not let a human set and maps refused transitions to CONFLICT", async () => {
    fake.state.addTask("default", { title: "Aufgabe", status: "done" });
    const h = await open({ boards: ["default"] });
    const id = (await h.adapter.listTasks({}, h.call())).items[0]?.id ?? "";

    for (const status of ["running", "failed", "cancelled"] as const) {
      expect((await rejection(h.adapter.updateTask({ id, body: { status } }, h.mutation()))).code).toBe(
        "VALIDATION_FAILED",
      );
    }
    const patches = fake.callsTo("dashboard", /\/tasks\/t_/).filter((call) => call.method === "PATCH");
    expect(patches).toHaveLength(0);

    // done -> review is not in the transition matrix
    const conflict = await rejection(h.adapter.updateTask({ id, body: { status: "review" } }, h.mutation()));
    expect(conflict.code).toBe("CONFLICT");
  });

  it("enforces If-Match against the derived revision", async () => {
    fake.state.addTask("default", { title: "Versioniert" });
    const h = await open({ boards: ["default"] });
    const task = (await h.adapter.listTasks({}, h.call())).items[0];
    if (!task) throw new Error("no task");

    const stale = await rejection(
      h.adapter.updateTask(
        { id: task.id, body: { title: "Zu spät" } },
        h.mutation({ ifMatchVersion: task.version - 1 }),
      ),
    );
    expect(stale.code).toBe("CONFLICT");

    const ok = await h.adapter.updateTask(
      { id: task.id, body: { title: "Rechtzeitig" } },
      h.mutation({ ifMatchVersion: task.version }),
    );
    expect(ok.data.title).toBe("Rechtzeitig");
  });

  it("accepts unchanged labels on update and rejects changed ones", async () => {
    fake.state.addTask("default", { title: "Etikett" });
    const h = await open({ boards: ["default"] });
    const task = (await h.adapter.listTasks({}, h.call())).items[0];
    if (!task) throw new Error("no task");

    await expect(
      h.adapter.updateTask({ id: task.id, body: { labels: task.labels ?? [] } }, h.mutation()),
    ).resolves.toBeDefined();
    expect(
      (await rejection(h.adapter.updateTask({ id: task.id, body: { labels: ["neu"] } }, h.mutation()))).code,
    ).toBe("VALIDATION_FAILED");
  });
});

describe("tasks: capabilities", () => {
  it("declares cancel and retry but no pause/resume", async () => {
    const h = await open();
    const { capabilities } = await h.adapter.getCapabilities();
    expect(capabilities.sort()).toEqual(["tasks.cancel", "tasks.create", "tasks.read", "tasks.retry", "tasks.stream", "tasks.update"]);
    for (const method of ["pauseTask", "resumeTask"]) {
      expect((h.adapter as unknown as Record<string, unknown>)[method]).toBeUndefined();
    }
  });
});

describe("tasks: lifecycle", () => {
  it("archives running work and confirms that its worker was closed", async () => {
    const raw = fake.state.addTask("default", { title: "Aktiv", assignee: "kira" });
    fake.state.startWorker("default", raw);
    const h = await open({ boards: ["default"] });
    const task = (await h.adapter.listTasks({}, h.call())).items[0]!;
    const result = await h.adapter.cancelTask({ id: task.id }, h.mutation({ ifMatchVersion: task.version }));
    expect(result.data.status).toBe("cancelled");
    expect(fake.state.workers).toHaveLength(0);
    expect(fake.state.board("default").runs[0]?.ended_at).not.toBeNull();
    expect(fake.callsTo("dashboard", /\/friday\/tasks\/t_.*\/cancel$/).filter((call) => call.method === "POST")).toHaveLength(1);
  });

  it("rolls back cancel when the worker survives", async () => {
    const raw = fake.state.addTask("default", { title: "Unbeendbar", assignee: "kira" });
    fake.state.startWorker("default", raw);
    fake.state.archiveWorkerSurvives = true;
    const h = await open({ boards: ["default"] });
    const task = (await h.adapter.listTasks({}, h.call())).items[0]!;
    await expect(h.adapter.cancelTask({ id: task.id }, h.mutation())).rejects.toBeDefined();
    expect(raw.status).toBe("running");
    expect(fake.state.workers).toHaveLength(1);
    expect(fake.callsTo("dashboard", /\/friday\/tasks\/t_.*\/cancel$/).filter((call) => call.method === "POST")).toHaveLength(1);
  });

  it("retries an archived task once and refuses an already-dispatchable failed task", async () => {
    const raw = fake.state.addTask("default", { title: "Archiv", status: "archived" });
    const h = await open({ boards: ["default"] });
    const task = (await h.adapter.listTasks({ status: ["cancelled"] }, h.call())).items[0]!;
    const result = await h.adapter.retryTask({ id: task.id }, h.mutation({ ifMatchVersion: task.version }));
    expect(result.data.status).toBe("ready");
    expect((await rejection(h.adapter.retryTask({ id: task.id }, h.mutation()))).code).toBe("CONFLICT");
    raw.last_failure_error = "alter Fehler";
    expect((await rejection(h.adapter.retryTask({ id: task.id }, h.mutation()))).code).toBe("CONFLICT");
  });

  it("refuses retry if a new run claims the task after the detail read", async () => {
    const raw = fake.state.addTask("default", { title: "Rennlauf", status: "archived", assignee: "kira" });
    const h = await open({ boards: ["default"] });
    const task = (await h.adapter.listTasks({ status: ["cancelled"] }, h.call())).items[0]!;
    fake.state.beforeLifecycleMutation = () => {
      fake.state.setStatus(fake.state.board("default"), raw, "ready");
      fake.state.startWorker("default", raw);
    };
    expect((await rejection(h.adapter.retryTask({ id: task.id }, h.mutation()))).code).toBe("CONFLICT");
    expect(raw.status).toBe("running");
    expect(raw.current_run_id).not.toBeNull();
    expect(fake.state.workers).toHaveLength(1);
  });

  it("refuses cancel when a new run claims the task after the detail read", async () => {
    const raw = fake.state.addTask("default", { title: "Neuer Lauf", assignee: "kira" });
    const h = await open({ boards: ["default"] });
    const task = (await h.adapter.listTasks({}, h.call())).items[0]!;
    fake.state.beforeLifecycleMutation = () => fake.state.startWorker("default", raw);
    expect((await rejection(h.adapter.cancelTask({ id: task.id }, h.mutation()))).code).toBe("CONFLICT");
    expect(raw.status).toBe("running");
    expect(raw.current_run_id).not.toBeNull();
    expect(fake.state.workers).toHaveLength(1);
  });

  it("refuses cancel when the pinned lifecycle endpoint is absent", async () => {
    fake.state.addTask("default", { title: "Alter Hermes" });
    fake.state.runStopPatched = false;
    const h = await open({ boards: ["default"] });
    const task = (await h.adapter.listTasks({}, h.call())).items[0]!;
    expect((await rejection(h.adapter.cancelTask({ id: task.id }, h.mutation()))).code).toBe("CAPABILITY_MISSING");
    expect(fake.callsTo("dashboard", /\/friday\/tasks\/t_.*\/cancel$/)).toHaveLength(0);
  });

  it("refuses stale If-Match before lifecycle writes", async () => {
    fake.state.addTask("default", { title: "Alt", status: "archived" });
    const h = await open({ boards: ["default"] });
    const task = (await h.adapter.listTasks({ status: ["cancelled"] }, h.call())).items[0]!;
    expect((await rejection(h.adapter.retryTask({ id: task.id }, h.mutation({ ifMatchVersion: task.version + 1 })))).code).toBe("CONFLICT");
    expect(fake.callsTo("dashboard", /\/friday\/tasks\/t_.*\/retry$/).filter((call) => call.method === "POST")).toHaveLength(0);
  });

  it("reopens a task blocked by a run-specific Friday stop", async () => {
    fake.state.addTask("default", { title: "Gestoppt", assignee: "kira", status: "blocked",
      block_kind: "friday_stopped" });
    const h = await open({ boards: ["default"] });
    const task = (await h.adapter.listTasks({}, h.call())).items[0]!;
    expect(task.status).toBe("waiting");
    expect((await h.adapter.retryTask({ id: task.id }, h.mutation())).data.status).toBe("ready");
  });
});

describe("tasks: health", () => {
  it("is online, logs the Hermes version once and degrades when a configured board is missing", async () => {
    const h = await open({ boards: ["default", "business"] });
    const online = await h.adapter.healthCheck();
    await h.adapter.healthCheck();
    expect(online.status).toBe("online");
    expect(h.logs.filter((record) => record.message === "Hermes Dashboard erkannt")).toHaveLength(1);
    expect(h.logs.find((record) => record.message === "Hermes Dashboard erkannt")?.fields).toMatchObject({
      version: "git.0e427d7",
      commit: "0e427d788d25",
    });

    fake.state.boards.delete("business");
    const degraded = await h.adapter.healthCheck();
    expect(degraded).toMatchObject({ status: "degraded", errorCode: "NOT_FOUND" });
    expect(degraded.message).toContain("business");
  });

  it("degrades while the gateway (which hosts the Kanban dispatcher) is stopped", async () => {
    const h = await open({ boards: ["default"] });
    fake.state.gatewayRunning = false;
    expect(await h.adapter.healthCheck()).toMatchObject({ status: "degraded", errorCode: "GATEWAY_STOPPED" });
  });

  it("reports an expired credential as offline with a German hint, without throwing", async () => {
    const h = await open(
      { boards: ["default"], dashboardAuth: "secret" },
      { dashboardToken: "veraltetes-token-1" },
    );
    const report = await h.adapter.healthCheck();
    expect(report).toMatchObject({ status: "offline", errorCode: "UNAUTHENTICATED" });
    expect(report.message).toContain("Authentifizierung");
  });
});

describe("tasks: events over the real WebSocket", () => {
  it("emits one canonical event per Kanban event with the task snapshot and never repeats them", async () => {
    const h = await open({ boards: ["default"] });
    const board = fake.state.board("default");

    fake.state.publishTaskLifecycle(4); // created, blocked, unblocked, completed
    const emitted = await h.adapter.pollEvents?.();

    expect(emitted).toBe(4);
    expect(h.emitted.map((event) => event.type)).toEqual([
      "friday.task.created",
      "friday.task.updated",
      "friday.task.updated",
      "friday.task.completed",
    ]);
    expect(h.emitted.every((event) => event.subject.startsWith("task/task_"))).toBe(true);
    expect(await h.adapter.pollEvents?.()).toBe(0);
    expect(fake.wsConnections).toBe(2);

    const task = [...board.tasks.values()][0];
    if (!task) throw new Error("no task");
    fake.state.setStatus(board, task, "triage");
    expect(await h.adapter.pollEvents?.()).toBe(1);
    expect(h.emitted.at(-1)?.type).toBe("friday.task.updated");
  });

  it("starts at the tail by default: pre-existing events are not replayed", async () => {
    fake.state.addTask("default", { title: "Schon da" });
    const h = await open({ boards: ["default"], eventsStartCursor: "tail" });

    expect(await h.adapter.pollEvents?.()).toBe(0);
    const task = fake.state.addTask("default", { title: "Neu" });
    expect(await h.adapter.pollEvents?.()).toBe(1);
    expect(h.emitted[0]).toMatchObject({ type: "friday.task.created" });
    expect((h.emitted[0]?.data as { title: string }).title).toBe(task.title);
  });

  it("maps archived to cancelled and crashes with a failure to failed; unknown kinds to updated", async () => {
    const h = await open({ boards: ["default"] });
    const board = fake.state.board("default");
    const a = fake.state.addTask("default", { title: "A", assignee: "kira" });
    const b = fake.state.addTask("default", {
      title: "B",
      assignee: "kira",
      status: "blocked",
      last_failure_error: "Absturz",
    });
    fake.state.setStatus(board, a, "ready");
    a.status = "archived";
    fake.state.addEvent(board, a, "archived");
    fake.state.addEvent(board, b, "crashed", { error: "Absturz" });
    fake.state.addEvent(board, b, "zukunftsereignis");

    await h.adapter.pollEvents?.();

    const types = h.emitted.map((event) => event.type);
    expect(types).toContain("friday.task.cancelled");
    expect(types).toContain("friday.task.failed");
    expect(types.at(-1)).toBe("friday.task.updated");
  });

  it("follows a rotated token: the rejected handshake triggers a re-read and one retry", async () => {
    const h = await open({ boards: ["default"] });
    fake.state.publishTaskLifecycle(1);
    await h.adapter.pollEvents?.();

    fake.state.rotateToken();
    fake.state.publishTaskLifecycle(1);
    expect(await h.adapter.pollEvents?.()).toBe(1);
  });

  it("does not advance the cursor when a task cannot be fetched, so nothing is lost", async () => {
    const h = await open({ boards: ["default"] });
    fake.state.publishTaskLifecycle(2);
    fake.forceStatus("dashboard", undefined);
    fake.setLatency("dashboard", 0);
    const original = fake.state.task.bind(fake.state);
    let failing = true;
    fake.state.task = (board, id) => {
      if (failing) throw Object.assign(new Error("boom"), {});
      return original(board, id);
    };

    await expect(h.adapter.pollEvents?.()).rejects.toBeInstanceOf(AdapterError);
    expect(h.emitted).toHaveLength(0);

    failing = false;
    expect(await h.adapter.pollEvents?.()).toBe(2);
  });

  it("reports a stream that keeps rejecting the token as UNAUTHENTICATED", async () => {
    const h = await open({ boards: ["default"] });
    fake.wsCloseWith = 1008;
    expect((await rejection(h.adapter.pollEvents?.() ?? Promise.resolve(0))).code).toBe("UNAUTHENTICATED");
  });

  it("reports an unreachable dashboard as ADAPTER_UNAVAILABLE and recovers", async () => {
    const h = await open({ boards: ["default"] });
    fake.state.publishTaskLifecycle(1);
    await fake.setOffline("dashboard", true);
    const error = await rejection(h.adapter.pollEvents?.() ?? Promise.resolve(0));
    expect(error.code).toBe("ADAPTER_UNAVAILABLE");
    expect(error.retryable).toBe(true);

    await fake.setOffline("dashboard", false);
    expect(await h.adapter.pollEvents?.()).toBe(1);
  });

  it("runs the background loop and stops it on shutdown", async () => {
    const h = await open({ boards: ["default"], pollIntervalMs: 30 });
    fake.state.publishTaskLifecycle(2);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(h.emitted.length).toBeGreaterThanOrEqual(2);

    await h.stop();
    const connections = fake.wsConnections;
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(fake.wsConnections).toBe(connections);
  });
});
