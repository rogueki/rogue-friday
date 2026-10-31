import type { Task } from "@friday/sdk";
import { expect, it, vi } from "vitest";
import { startTestApi } from "./helpers";

it("announces an agent question and forwards the spoken answer only while the voice task waits for input", async () => {
  const api = await startTestApi({ dataMode: "mock", authMode: "local", ownerPassword: "synthetic-test-password",
    responseValidation: "throw" });
  try {
    const voice = api.client();
    const owner = api.client();
    expect((await owner.loginOwner("synthetic-test-password")).statusCode).toBe(200);
    const headers = { authorization: `Bearer ${api.runtime.voiceBridgeKey.toString("base64")}` };
    const created = await voice.post("/api/v1/voice/tasks",
      { text: "Recherchiere die Strompreise in Europa der letzten Woche", domain: "research" },
      { headers: { ...headers, "Idempotency-Key": "voice-reply-task-0001" } });
    expect(created.statusCode, created.body).toBe(201);
    const taskId = created.json().data.taskId as string;

    // The tasks port is a proxy, so the waiting world is injected by wrapping registry.getPort itself.
    const registry = api.runtime.registry;
    const original = registry.getPort.bind(registry);
    const realTasks = original("tasks");
    const real = (await realTasks.getTask({ id: taskId }, { correlationId: `corr_${"0".repeat(26)}` })).data;
    let current: Task = { ...real, status: "waiting",
      blockers: [{ id: "blk_x", kind: "input_needed", description: "Welche Region?", since: new Date().toISOString() }] };
    const provided: unknown[] = [];
    vi.spyOn(registry, "getPort").mockImplementation(((category: string) =>
      category === "tasks"
        ? { ...realTasks,
            getTask: async () => ({ data: current, freshness: { state: "fresh", asOf: new Date().toISOString() } }),
            provideTaskInput: async (params: unknown) => {
              provided.push(params);
              return { data: { ...current, status: "ready", blockers: [] },
                freshness: { state: "fresh", asOf: new Date().toISOString() } };
            } }
        : original(category as never)) as never);

    const read = await voice.get(`/api/v1/voice/tasks/${taskId}`, { headers });
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json().data).toMatchObject({ status: "waiting", question: "Welche Region?" });

    const path = `/api/v1/voice/tasks/${taskId}/reply`;
    const unkeyed = await voice.post(path, { answer: "Nur Europa" }, { headers });
    expect(unkeyed.statusCode, unkeyed.body).toBe(422);

    // A dashboard session is not the local voice bridge.
    const dashboard = await owner.post(path, { answer: "Nur Europa" }, { headers: { "Idempotency-Key": "voice-reply-owner-0001" } });
    expect(dashboard.statusCode, dashboard.body).toBe(403);
    expect(provided).toHaveLength(0);

    const answered = await voice.post(path, { answer: "Nur Europa" },
      { headers: { ...headers, "Idempotency-Key": "voice-reply-answer-0001" } });
    expect(answered.statusCode, answered.body).toBe(200);
    expect(answered.json().data.question).toBeNull();
    expect(provided).toEqual([{ id: taskId, body: { input: "Nur Europa", blockerId: "blk_x" } }]);

    // A leftover blocker on a running task must not let an answer through.
    current = { ...current, status: "running" };
    const notWaiting = await voice.post(path, { answer: "Nur Europa" },
      { headers: { ...headers, "Idempotency-Key": "voice-reply-answer-0002" } });
    expect(notWaiting.statusCode, notWaiting.body).toBe(409);
    expect(provided).toHaveLength(1);
  } finally {
    vi.restoreAllMocks();
    await api.close();
  }
});
