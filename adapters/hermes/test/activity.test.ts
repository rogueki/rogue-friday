import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterError, PORT_SPEC, validatePortResult } from "@jarvis/adapter-core";
import { HermesActivityAdapter, createTaskIds } from "../src";
import { createHermesFake, type HermesFake } from "./fake/server";
import { start, type Harness } from "./helpers";

let fake: HermesFake;
let harness: Harness<HermesActivityAdapter> | undefined;

const baseConfig = () => ({
  apiBaseUrl: fake.apiUrl,
  dashboardBaseUrl: fake.dashboardUrl,
  boards: ["default"],
  eventsDrainMs: 150,
});

async function open(
  config: Record<string, unknown> = {},
  secrets: Record<string, string> = { apiKey: fake.state.apiKey },
) {
  harness = await start(new HermesActivityAdapter(), { ...baseConfig(), ...config }, secrets);
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

/** user -> assistant tool call -> tool result -> assistant answer (the shape of a voice request with one tool). */
function toolSession(id = "sess-demo-1") {
  return fake.state.addSession({
    id,
    title: "Sag hallo",
    messages: [
      { role: "user", content: "Sag hallo und zeig mir meine Fähigkeiten" },
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "call_1", name: "skills_list" }],
        finish_reason: "tool_calls",
      },
      {
        role: "tool",
        content: '{"success": true, "secret": "nicht ausgeben"}',
        tool_call_id: "call_1",
        tool_name: "skills_list",
      },
      { role: "assistant", content: "Hallo, das ist die Fake-Antwort.", finish_reason: "stop" },
    ],
  });
}

beforeEach(async () => {
  fake = await createHermesFake();
});

afterEach(async () => {
  await harness?.stop();
  harness = undefined;
  await fake.close();
});

describe("activity: sessions", () => {
  it("builds a linked tree of user request, tool call and result without copying contents", async () => {
    toolSession();
    const h = await open();

    const page = await h.adapter.listActivity({}, h.call());

    validatePortResult(PORT_SPEC.activity.listActivity, page, { what: "listActivity" });
    expect(page.items.map((event) => event.kind).reverse()).toEqual(["user_request", "tool_call", "result"]);
    const byKind = Object.fromEntries(page.items.map((event) => [event.kind, event]));
    expect(byKind.user_request).toMatchObject({
      parentId: null,
      status: "info",
      title: "Anfrage an Hermes",
      model: "fake-model",
    });
    expect(byKind.tool_call).toMatchObject({
      tool: "skills_list",
      status: "succeeded",
      parentId: byKind.user_request?.id,
      title: "Werkzeug skills_list",
    });
    expect(byKind.tool_call?.endedAt).not.toBeNull();
    expect(byKind.tool_call?.summary).toBeUndefined();
    expect(byKind.result).toMatchObject({
      status: "succeeded",
      parentId: byKind.user_request?.id,
      summary: "Hallo, das ist die Fake-Antwort.",
    });
    // one correlation id per session, deterministic
    expect(new Set(page.items.map((event) => event.correlationId)).size).toBe(1);
    // tool output and arguments are not part of the canonical event
    expect(JSON.stringify(page)).not.toContain("nicht ausgeben");
    expect(byKind.tool_call?.details).toMatchObject({ sessionSource: "api_server", role: "assistant" });
  });

  it("sends the API key as Bearer and rejects a wrong key with UNAUTHENTICATED", async () => {
    toolSession();
    const h = await open();
    await h.adapter.listActivity({}, h.call());
    expect(
      fake
        .callsTo("api", "/api/sessions")
        .every((c) => c.headers.authorization === `Bearer ${fake.state.apiKey}`),
    ).toBe(true);

    await h.stop();
    const wrong = await start(new HermesActivityAdapter(), baseConfig(), {
      apiKey: "falscher-schluessel-123",
    });
    harness = wrong;
    expect((await rejection(wrong.adapter.listActivity({}, wrong.call()))).code).toBe("UNAUTHENTICATED");
  });

  it("reads the API key from a key file and re-reads it when it was replaced", async () => {
    toolSession();
    const dir = await mkdtemp(join(tmpdir(), "hermes-adapter-"));
    try {
      const file = join(dir, "hermes_api.key");
      await writeFile(file, "veralteter-schluessel-000\n");
      const h = await open({ apiKeyFile: file }, {});
      expect((await rejection(h.adapter.listActivity({}, h.call()))).code).toBe("UNAUTHENTICATED");

      await writeFile(file, `${fake.state.apiKey}\n`);
      const page = await h.adapter.listActivity({}, h.call());
      expect(page.items.length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports a missing API key as UNAUTHENTICATED without calling Hermes", async () => {
    const h = await open({}, {});
    expect((await rejection(h.adapter.listActivity({}, h.call()))).code).toBe("UNAUTHENTICATED");
    expect(fake.callsTo("api", "/api/sessions")).toHaveLength(0);
  });

  it("starts at the tail: history is listed but only new messages are emitted, once", async () => {
    const session = toolSession();
    const h = await open({ eventsStartCursor: "tail" });

    expect(await h.adapter.pollEvents?.()).toBe(0);
    expect((await h.adapter.listActivity({}, h.call())).items).toHaveLength(3);

    fake.state.appendMessage(session, { role: "user", content: "Noch eine Frage" });
    fake.state.addSession({
      title: "Zweites Gespräch",
      messages: [{ role: "user", content: "Guten Morgen" }],
    });
    expect(await h.adapter.pollEvents?.()).toBe(2);
    expect(await h.adapter.pollEvents?.()).toBe(0);
    expect(h.emitted.every((event) => event.type === "jarvis.activity.appended")).toBe(true);
    expect((await h.adapter.listActivity({}, h.call())).items).toHaveLength(5);
  });

  it("emits what a list call discovers, so the stream has no gaps without background polling", async () => {
    const h = await open({ eventsStartCursor: 0 });
    toolSession();

    await h.adapter.listActivity({}, h.call());
    expect(h.emitted).toHaveLength(3);
    expect(await h.adapter.pollEvents?.()).toBe(0);
  });

  it("refreshes a tool call whose result arrived later without emitting it twice", async () => {
    const session = fake.state.addSession({
      title: "Langsames Werkzeug",
      messages: [
        { role: "user", content: "Suche etwas" },
        {
          role: "assistant",
          content: "",
          tool_calls: [{ id: "call_9", name: "web_search" }],
          finish_reason: "tool_calls",
        },
      ],
    });
    const h = await open({ eventsStartCursor: 0 });
    await h.adapter.pollEvents?.();
    expect(h.emitted).toHaveLength(2);
    const running = (await h.adapter.listActivity({ kind: ["tool_call"] }, h.call())).items[0];
    expect(running).toMatchObject({ status: "running", endedAt: null });

    fake.state.appendMessage(session, {
      role: "tool",
      content: "ok",
      tool_call_id: "call_9",
      tool_name: "web_search",
    });
    await h.adapter.pollEvents?.();

    const done = (await h.adapter.listActivity({ kind: ["tool_call"] }, h.call())).items[0];
    expect(done).toMatchObject({ id: running?.id, status: "succeeded", version: 2 });
    expect(h.emitted).toHaveLength(2);
  });

  it("filters, paginates by keyset and backfills by sequence", async () => {
    toolSession("s-a");
    toolSession("s-b");
    const h = await open();

    const all = await h.adapter.listActivity({}, h.call());
    expect(all.items).toHaveLength(6);
    const first = await h.adapter.listActivity({ limit: 4 }, h.call());
    const second = await h.adapter.listActivity(
      { limit: 4, cursor: first.pageInfo.nextCursor ?? "" },
      h.call(),
    );
    expect([...first.items, ...second.items].map((e) => e.id)).toEqual(all.items.map((e) => e.id));
    expect(second.pageInfo.hasNextPage).toBe(false);

    expect((await h.adapter.listActivity({ kind: ["tool_call"] }, h.call())).items).toHaveLength(2);
    expect((await h.adapter.listActivity({ tool: "skills_list" }, h.call())).items).toHaveLength(2);
    const one = all.items[0];
    expect(
      (await h.adapter.listActivity({ correlationId: one?.correlationId ?? "" }, h.call())).items,
    ).toHaveLength(3);

    const maxSeq = Math.max(...all.items.map((e) => e.sequence));
    const backfill = await h.adapter.listActivity({ sinceSequence: maxSeq - 2 }, h.call());
    expect(backfill.items.map((e) => e.sequence)).toEqual([maxSeq - 1, maxSeq]);
    expect((await rejection(h.adapter.listActivity({ cursor: "x" }, h.call()))).code).toBe(
      "VALIDATION_FAILED",
    );
  });

  it("returns single events and NOT_FOUND for unknown ids", async () => {
    toolSession();
    const h = await open();
    const item = (await h.adapter.listActivity({}, h.call())).items[0];
    const single = await h.adapter.getActivityEvent({ id: item?.id ?? "" }, h.call());
    expect(single.data).toEqual(item);
    expect(
      (await rejection(h.adapter.getActivityEvent({ id: "act_00000000000000000000000000" }, h.call()))).code,
    ).toBe("NOT_FOUND");
  });

  it("follows more sessions than one page", async () => {
    fake.state.sessionPageSize = 2;
    fake.state.seedSessions(5);
    const h = await open();
    expect((await h.adapter.listActivity({}, h.call())).items).toHaveLength(5);
    expect(fake.callsTo("api", "/api/sessions").length).toBe(3);
  });
});

describe("activity: Kanban events", () => {
  it("maps task events with German titles, severity and task ids shared with the tasks adapter", async () => {
    const board = fake.state.board("default");
    fake.state.addTask("default", { title: "Alt" }); // id 1 -> history
    const h = await open({ eventsStartCursor: "tail" });
    expect(await h.adapter.pollEvents?.()).toBe(0);
    // history look-back: the old `created` event is buffered although it was not emitted
    expect((await h.adapter.listActivity({ kind: ["task"] }, h.call())).items.map((e) => e.title)).toEqual([
      "Aufgabe angelegt",
    ]);

    const task = fake.state.addTask("default", { title: "Neu", assignee: "kira" });
    fake.state.addEvent(board, task, "crashed", { error: "Worker abgestürzt" });
    fake.state.addEvent(board, task, "blocked", { reason: "Warte auf Freigabe" });
    expect(await h.adapter.pollEvents?.()).toBe(3);

    const events = h.emitted.map(
      (event) =>
        event.data as { title: string; severity: string; status: string; taskId: string; summary?: string },
    );
    expect(events.map((e) => e.title)).toEqual([
      "Aufgabe angelegt",
      "Bearbeitung abgestürzt",
      "Aufgabe blockiert",
    ]);
    expect(events[1]).toMatchObject({ severity: "error", status: "failed", summary: "Worker abgestürzt" });
    expect(events[2]).toMatchObject({ severity: "info", summary: "Warte auf Freigabe" });
    expect(events[0]?.taskId).toBe(createTaskIds().encode({ board: "default", taskId: task.id }));
  });

  it("uses a numeric start cursor to replay history", async () => {
    fake.state.addTask("default", { title: "A" });
    fake.state.addTask("default", { title: "B" });
    const h = await open({ eventsStartCursor: 0 });
    // sessions use the same cursor as message id; no sessions here, Kanban replays from event id 0
    expect(await h.adapter.pollEvents?.()).toBe(2);
  });

  it("keeps the sessions part working when the dashboard is down and still reports the failure", async () => {
    const session = toolSession();
    const h = await open({ eventsStartCursor: "tail" });
    await h.adapter.listActivity({}, h.call());
    fake.state.appendMessage(session, { role: "user", content: "Neu" });
    await fake.setOffline("dashboard", true);

    const error = await rejection(h.adapter.pollEvents?.() ?? Promise.resolve(0));

    expect(error.code).toBe("ADAPTER_UNAVAILABLE");
    expect(h.emitted).toHaveLength(1); // the session message was emitted, only the Kanban source failed
  });
});

describe("activity: capabilities and health", () => {
  it("declares read, stream and backfill only", async () => {
    const h = await open();
    expect((await h.adapter.getCapabilities()).capabilities.sort()).toEqual([
      "activity.backfill",
      "activity.read",
      "activity.stream",
    ]);
  });

  it("is online with both listeners, degraded without the dashboard, offline with a wrong key", async () => {
    const h = await open();
    expect((await h.adapter.healthCheck()).status).toBe("online");

    await fake.setOffline("dashboard", true);
    const degraded = await h.adapter.healthCheck();
    expect(degraded.status).toBe("degraded");
    expect(degraded.message).toContain("Kanban");
    await fake.setOffline("dashboard", false);

    fake.state.apiKey = "anderer-schluessel-9999";
    const offline = await h.adapter.healthCheck();
    expect(offline).toMatchObject({ status: "offline", errorCode: "UNAUTHENTICATED" });
  });
});
