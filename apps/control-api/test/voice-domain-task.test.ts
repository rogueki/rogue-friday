import { expect, it } from "vitest";
import { startTestApi } from "./helpers";

it("hands a long spoken request to the domain agent without confirmation and scopes reads to voice tasks", async () => {
  const api = await startTestApi({ dataMode: "mock", authMode: "local", ownerPassword: "synthetic-test-password",
    responseValidation: "throw" });
  try {
    const voice = api.client();
    const owner = api.client();
    expect((await owner.loginOwner("synthetic-test-password")).statusCode).toBe(200);
    const headers = { authorization: `Bearer ${api.runtime.voiceBridgeKey.toString("base64")}` };
    const path = "/api/v1/voice/tasks";
    const request = { text: "Recherchiere die Strompreise in Europa der letzten Woche", domain: "research" };
    expect((await voice.post(path, request)).statusCode).toBe(401);
    expect((await api.fastify.inject({ method: "POST", url: path, remoteAddress: "192.0.2.7", headers,
      payload: request })).statusCode).toBe(401);
    const unkeyed = await voice.post(path, request, { headers });
    expect(unkeyed.statusCode, unkeyed.body).toBe(422);

    const keyed = { ...headers, "Idempotency-Key": "voice-domain-task-0001" };
    const created = await voice.post(path, request, { headers: keyed });
    expect(created.statusCode, created.body).toBe(201);
    const task = created.json().data;
    expect(task).toMatchObject({ domain: "research", taskId: expect.stringMatching(/^task_/),
      resultSummary: null, error: null });
    expect(task.agentName).toContain("Recherche");
    const taskId = task.taskId as string;

    const replayed = await voice.post(path, request, { headers: keyed });
    expect(replayed.statusCode, replayed.body).toBe(201);
    expect(replayed.json().data.taskId).toBe(taskId);
    expect(replayed.headers["idempotent-replayed"]).toBe("true");

    const read = await voice.get(`/api/v1/voice/tasks/${taskId}`, { headers });
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json().data.taskId).toBe(taskId);
    expect((await voice.get(`/api/v1/voice/tasks/${taskId}`)).statusCode).toBe(401);

    const owned = await owner.get(`/api/v1/tasks/${taskId}`);
    expect(owned.statusCode, owned.body).toBe(200);
    expect(owned.json().data.labels).toContain("tenant:voice-research");

    const items = (await owner.get("/api/v1/tasks")).json().items as Array<{ id: string }>;
    const foreign = items.find((item) => item.id !== taskId);
    expect(foreign).toBeDefined();
    expect((await voice.get(`/api/v1/voice/tasks/${foreign!.id}`, { headers })).statusCode).toBe(404);
  } finally { await api.close(); }
});

it("cancels only voice tasks by name and leaves finished ones unchanged", async () => {
  const api = await startTestApi({ dataMode: "mock", authMode: "local", ownerPassword: "synthetic-test-password",
    responseValidation: "throw" });
  try {
    const voice = api.client();
    const owner = api.client();
    expect((await owner.loginOwner("synthetic-test-password")).statusCode).toBe(200);
    const headers = { authorization: `Bearer ${api.runtime.voiceBridgeKey.toString("base64")}` };
    const path = "/api/v1/voice/tasks";
    const request = { text: "Recherchiere die Strompreise in Europa der letzten Woche", domain: "research" };
    const created = await voice.post(path, request,
      { headers: { ...headers, "Idempotency-Key": "voice-domain-cancel-create-0001" } });
    expect(created.statusCode, created.body).toBe(201);
    const taskId = created.json().data.taskId as string;

    const cancelPath = `/api/v1/voice/tasks/${taskId}/cancel`;
    expect((await voice.post(cancelPath)).statusCode).toBe(401);
    const cancelled = await voice.post(cancelPath, undefined,
      { headers: { ...headers, "Idempotency-Key": "voice-domain-cancel-0001" } });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(cancelled.json().data.status).toBe("cancelled");

    const repeated = await voice.post(cancelPath, undefined,
      { headers: { ...headers, "Idempotency-Key": "voice-domain-cancel-0002" } });
    expect(repeated.statusCode, repeated.body).toBe(200);
    expect(repeated.json().data.status).toBe("cancelled");

    const items = (await owner.get("/api/v1/tasks")).json().items as Array<{ id: string; status: string }>;
    const foreign = items.find((item) => item.id !== taskId);
    expect(foreign).toBeDefined();
    const before = (await owner.get(`/api/v1/tasks/${foreign!.id}`)).json().data;
    const rejected = await voice.post(`/api/v1/voice/tasks/${foreign!.id}/cancel`, undefined,
      { headers: { ...headers, "Idempotency-Key": "voice-domain-cancel-0003" } });
    expect(rejected.statusCode, rejected.body).toBe(404);
    const after = (await owner.get(`/api/v1/tasks/${foreign!.id}`)).json().data;
    expect(after.status).toBe(before.status);
  } finally { await api.close(); }
});
