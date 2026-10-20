/* eslint-disable @typescript-eslint/no-explicit-any -- test code reads untyped JSON bodies that the contract validators check */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiClient, startTestApi, type TestApi } from "./helpers";

const errorOf = (response: { json(): unknown }) => (response.json() as { error: { code: string; message: string; details: Record<string, any> } }).error;

/** Behaviour of the operations that close the contract gaps: roles, CSRF, capabilities, idempotency, audit, secrets. */
describe("contract gaps: authorization and enforcement", () => {
  let api: TestApi;
  let owner: ApiClient;
  let operator: ApiClient;
  let viewer: ApiClient;
  const logs: string[] = [];

  beforeAll(async () => {
    api = await startTestApi({ logs });
    owner = api.client();
    operator = api.client();
    viewer = api.client();
    await owner.loginDev("owner");
    await operator.loginDev("operator");
    await viewer.loginDev("viewer");
  });
  afterAll(async () => {
    await api.close();
  });

  const list = async (path: string, query: Record<string, string | string[]> = {}): Promise<any[]> => (await owner.get(path, { query: { limit: "100", ...query } })).json().items;
  /** Entries of the control plane's hash-chained audit log (newest first), not the mock audit adapter behind GET /audit/events. */
  const auditOf = (action: string): any[] => api.runtime.stores.audit.recent(500).filter((entry) => entry.action === action);
  /** The staged knowledge writes execute directly after confirmation while tier-2 approvals stay tested in the native suites. */
  const disableTier2 = async (): Promise<void> => {
    const settings = (await owner.get("/api/v1/settings")).json().data;
    expect((await owner.patch("/api/v1/settings", { approvals: { ...settings.approvals, confirmTier2: false } },
      { headers: { "if-match": String(settings.version) } })).statusCode).toBe(200);
  };
  const confirm = (previewId: string) => ({ headers: { "x-action-preview-id": previewId } });

  describe("roles and CSRF", () => {
    const FILE = "file_00000000000000000000000000";
    const mem = "mem_00000000000000000000000000";
    const cases: Array<{ name: string; method: "POST" | "PATCH" | "DELETE" | "GET"; path: string; body?: unknown; minimum: "viewer" | "operator" | "owner" }> = [
      { name: "renameFile", method: "PATCH", path: `/api/v1/files/${FILE}`, body: { name: "a.md" }, minimum: "operator" },
      { name: "restartAdapter", method: "POST", path: "/api/v1/adapters/mock-tasks/restart", minimum: "owner" },
      { name: "getAdapterLogs", method: "GET", path: "/api/v1/adapters/mock-tasks/logs", minimum: "owner" },
      { name: "exportMemory", method: "GET", path: "/api/v1/memory/export", minimum: "owner" },
      { name: "resolveMemoryConflict", method: "POST", path: `/api/v1/memory/${mem}/conflicts/${mem}/resolve`, body: { resolution: "dismiss" }, minimum: "operator" },
      { name: "pauseAllAutomations", method: "POST", path: "/api/v1/automations/pause-all", minimum: "operator" },
      { name: "enrollVoiceProfile", method: "POST", path: "/api/v1/voice/profiles/vprof_00000000000000000000000000/enroll", minimum: "operator" },
      { name: "deleteVoiceHistory", method: "DELETE", path: "/api/v1/voice/history?confirm=true", minimum: "owner" },
      { name: "assignTask", method: "POST", path: "/api/v1/tasks/task_00000000000000000000000000/assign", body: { agentId: null }, minimum: "operator" },
      { name: "provideTaskInput", method: "POST", path: "/api/v1/tasks/task_00000000000000000000000000/input", body: { input: "x" }, minimum: "operator" },
    ];
    const rank = { viewer: 1, operator: 2, owner: 3 } as const;

    it.each(cases)("$name needs at least the role $minimum", async ({ method, path, body, minimum }) => {
      for (const [role, client] of [["viewer", viewer], ["operator", operator]] as const) {
        if (rank[role] >= rank[minimum]) continue;
        const response = await client.request(method, path, body !== undefined ? { body } : {});
        expect(response.statusCode, `${role} ${response.body}`).toBe(403);
        expect(errorOf(response).code).toBe("FORBIDDEN");
      }
    });

    it.each(cases.filter((entry) => entry.method !== "GET"))("$name refuses a request without CSRF token", async ({ method, path, body }) => {
      const response = await owner.request(method, path, { csrf: false, ...(body !== undefined ? { body } : {}) });
      expect(response.statusCode).toBe(403);
      expect(errorOf(response).code).toBe("CSRF_INVALID");
    });
  });

  describe("files: rename", () => {
    it("renames with If-Match through the staged preview, audits old and new name and answers 409 for a stale version", async () => {
      await disableTier2();
      const file = (await list("/api/v1/files")).find((candidate) => candidate.category === "reports");
      const staged = await owner.patch(`/api/v1/files/${file.id}`, { name: "Quartalsbericht final.md" }, { headers: { "if-match": String(file.version) } });
      expect(staged.statusCode, staged.body).toBe(403);
      expect(errorOf(staged).details.stage).toBe("preview");
      const renamed = await owner.patch(`/api/v1/files/${file.id}`, { name: "Quartalsbericht final.md" },
        { headers: { "if-match": String(file.version), ...confirm(staged.json().error.details.previewId).headers } });
      expect(renamed.statusCode, renamed.body).toBe(200);
      expect(renamed.json().data).toMatchObject({ name: "Quartalsbericht final.md", version: file.version + 1 });
      const audit = auditOf("file.renamed")[0];
      expect(audit).toMatchObject({ action: "file.renamed", result: "success", before: { name: file.name }, after: { name: "Quartalsbericht final.md" } });
      const stale = await owner.patch(`/api/v1/files/${file.id}`, { name: "Nochmal.md" }, { headers: { "if-match": String(file.version) } });
      expect(stale.statusCode).toBe(409);
      expect(errorOf(stale).code).toBe("CONFLICT");
    });

    it("rejects names with path separators (422) and unknown files (404)", async () => {
      const file = (await list("/api/v1/files"))[0];
      const bad = await owner.patch(`/api/v1/files/${file.id}`, { name: "../geheim.md" });
      expect(bad.statusCode).toBe(422);
      expect(errorOf(bad).code).toBe("VALIDATION_FAILED");
      expect((await owner.patch("/api/v1/files/file_00000000000000000000000000", { name: "a.md" })).statusCode).toBe(404);
    });

    it("answers 403 CAPABILITY_MISSING when the capability is switched off", async () => {
      const file = (await list("/api/v1/files"))[0];
      await owner.post("/api/v1/dev/scenarios/control", { action: "capability_toggle", module: "files", capability: "rename", enabled: false });
      const response = await owner.patch(`/api/v1/files/${file.id}`, { name: "x.md" });
      expect(response.statusCode).toBe(403);
      expect(errorOf(response).code).toBe("CAPABILITY_MISSING");
      expect((await owner.get("/api/v1/capabilities")).json().modules.files.rename).toBe(false);
      await owner.post("/api/v1/dev/scenarios/control", { action: "capability_toggle", module: "files", capability: "rename", enabled: true });
    });
  });

  describe("system: adapter restart and logs", () => {
    it("restarts an adapter through the registry, audits it as a system action and replays an idempotent repeat", async () => {
      const headers = { "idempotency-key": "idem-gaps-restart-0001" };
      const first = await owner.post("/api/v1/adapters/mock-notifications/restart", undefined, { headers });
      expect(first.statusCode, first.body).toBe(200);
      expect(first.json()).toMatchObject({ accepted: true, status: "completed", resourceId: "mock-notifications" });
      const again = await owner.post("/api/v1/adapters/mock-notifications/restart", undefined, { headers });
      expect(again.headers["idempotent-replayed"]).toBe("true");
      const audit = auditOf("adapter.restarted")[0];
      expect(audit).toMatchObject({ category: "system", severity: "warning", result: "success", adapterId: "mock-notifications" });
      expect(auditOf("adapter.restarted")).toHaveLength(1);
      expect((await owner.get("/api/v1/adapters/mock-notifications/health")).json().data.lifecycle).toBe("ONLINE");
    });

    it("answers 404 for an unknown adapter", async () => {
      expect((await owner.post("/api/v1/adapters/gibt-es-nicht/restart")).statusCode).toBe(404);
      expect((await owner.get("/api/v1/adapters/gibt-es-nicht/logs")).statusCode).toBe(404);
    });

    it("serves the adapter's log lines (newest last), filtered by level and limit", async () => {
      await owner.post("/api/v1/adapters/mock-research/restart");
      const all = (await owner.get("/api/v1/adapters/mock-research/logs", { query: { limit: "50" } })).json();
      expect(all.items.map((entry: any) => entry.message)).toEqual(expect.arrayContaining(["Adapter wird neu gestartet", "Adapter neu gestartet"]));
      expect(all.items.every((entry: any) => entry.adapterId === "mock-research")).toBe(true);
      const times = all.items.map((entry: any) => entry.timestamp) as string[];
      expect(times).toEqual([...times].sort());
      const warnings = (await owner.get("/api/v1/adapters/mock-research/logs", { query: { level: "warn" } })).json().items;
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings.every((entry: any) => entry.level === "warn" || entry.level === "error")).toBe(true);
      const limited = (await owner.get("/api/v1/adapters/mock-research/logs", { query: { limit: "1" } })).json().items;
      expect(limited).toHaveLength(1);
      expect((await owner.get("/api/v1/adapters/mock-research/logs", { query: { level: "laut" } })).statusCode).toBe(400);
      expect((await owner.get("/api/v1/adapters/mock-research/logs", { query: { limit: "9999" } })).statusCode).toBe(400);
    });

    it("never exposes secrets, tokens or e-mail addresses in log lines", () => {
      const secret = "sk-abcdefghijklmnopqrstuvwxyz0123456789";
      api.runtime.logger.child({ adapterId: "mock-audit" }).warn(`Upstream lehnte den Schlüssel ${secret} ab`, { token: "geheim-123", password: "pw", note: "Bearer abcdefghijklmnop", detail: { apiKey: secret } });
      const entries = api.runtime.logBuffer.query({ id: "mock-audit", category: "audit" });
      const text = JSON.stringify(entries);
      expect(entries.length).toBeGreaterThan(0);
      for (const forbidden of [secret, "geheim-123", "\"pw\"", "abcdefghijklmnop"]) expect(text).not.toContain(forbidden);
      expect(text).toContain("[REDACTED]");
    });

    it("keeps the buffer bounded and drops the oldest lines", () => {
      const bounded = new (api.runtime.logBuffer.constructor as new (options: { capacity: number }) => typeof api.runtime.logBuffer)({ capacity: 5 });
      for (let index = 0; index < 20; index++) bounded.record("info", `Zeile ${index}`, { adapterId: "mock-tasks" });
      expect(bounded.size).toBe(5);
      expect(bounded.query({ id: "mock-tasks", category: "tasks" }).map((entry) => entry.message)).toEqual(["Zeile 15", "Zeile 16", "Zeile 17", "Zeile 18", "Zeile 19"]);
    });

    it("hides the restart and log capabilities when the console switches them off", async () => {
      await owner.post("/api/v1/dev/scenarios/control", { action: "capability_toggle", module: "system", capability: "restartAdapter", enabled: false });
      await owner.post("/api/v1/dev/scenarios/control", { action: "capability_toggle", module: "system", capability: "openLogs", enabled: false });
      const restart = await owner.post("/api/v1/adapters/mock-tasks/restart");
      expect(restart.statusCode).toBe(403);
      expect(errorOf(restart).code).toBe("CAPABILITY_MISSING");
      const logsResponse = await owner.get("/api/v1/adapters/mock-tasks/logs");
      expect(logsResponse.statusCode).toBe(403);
      expect(errorOf(logsResponse).details.capability).toBe("system.openLogs");
      await owner.post("/api/v1/dev/scenarios/control", { action: "capability_toggle", module: "system", capability: "restartAdapter", enabled: true });
      await owner.post("/api/v1/dev/scenarios/control", { action: "capability_toggle", module: "system", capability: "openLogs", enabled: true });
    });
  });

  describe("memory: export and conflicts", () => {
    it("exports without restricted memories, as a download, and writes an audit entry", async () => {
      const response = await owner.get("/api/v1/memory/export");
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-disposition"]).toMatch(/^attachment; filename="memory-export-\d{4}-\d{2}-\d{2}\.json"$/);
      const document = response.json();
      expect(document.count).toBe(document.items.length);
      expect(document.omittedRestricted).toBeGreaterThan(0);
      expect(document.items.some((memory: any) => memory.sensitivity === "restricted")).toBe(false);
      const audit = auditOf("memory.exported")[0];
      expect(audit).toMatchObject({ result: "success", severity: "warning" });
    });

    it("masks secrets that slipped into a memory text", async () => {
      const secret = "sk-abcdefghijklmnopqrstuvwxyz0123456789";
      const staged = await owner.post("/api/v1/memory", { type: "fact", content: `Der Schlüssel lautet ${secret}.`, tags: ["test"] });
      expect(staged.statusCode, staged.body).toBe(403);
      const created = await owner.post("/api/v1/memory", { type: "fact", content: `Der Schlüssel lautet ${secret}.`, tags: ["test"] },
        confirm(staged.json().error.details.previewId));
      expect(created.statusCode, created.body).toBe(201);
      const exported = (await owner.get("/api/v1/memory/export")).body;
      expect(exported).not.toContain(secret);
      expect(exported).toContain("[REDACTED]");
    });

    it("resolves a conflict (replace forgets the other memory) and refuses to resolve it twice", async () => {
      const memories = await list("/api/v1/memory");
      const memory = memories.find((candidate) => candidate.conflicts.some((entry: any) => entry.resolution === "pending"));
      const conflictId = memory.conflicts.find((entry: any) => entry.resolution === "pending").memoryId as string;
      const path = `/api/v1/memory/${memory.id}/conflicts/${conflictId}/resolve`;
      const staged = await owner.post(path, { resolution: "replace", note: "Rahmenvertrag gilt." });
      expect(staged.statusCode, staged.body).toBe(403);
      expect(errorOf(staged).details.stage).toBe("preview");
      const resolved = await owner.post(path, { resolution: "replace", note: "Rahmenvertrag gilt." },
        confirm(staged.json().error.details.previewId));
      expect(resolved.statusCode, resolved.body).toBe(200);
      expect(resolved.json().data.conflicts.find((entry: any) => entry.memoryId === conflictId).resolution).toBe("replaced");
      expect((await owner.get(`/api/v1/memory/${conflictId}`)).statusCode).toBe(404);
      const audit = auditOf("memory.conflict_resolved")[0];
      expect(audit).toMatchObject({ severity: "warning", result: "success" });
      const again = await owner.post(path, { resolution: "dismiss" });
      expect(again.statusCode).toBe(409);
      expect(errorOf(again).code).toBe("CONFLICT");
    });

    it("validates the resolution and the conflict id", async () => {
      const memory = (await list("/api/v1/memory"))[0];
      expect((await owner.post(`/api/v1/memory/${memory.id}/conflicts/mem_00000000000000000000000000/resolve`, { resolution: "dismiss" })).statusCode).toBe(404);
      expect((await owner.post(`/api/v1/memory/${memory.id}/conflicts/mem_00000000000000000000000000/resolve`, { resolution: "wegwerfen" })).statusCode).toBe(422);
      expect((await owner.post(`/api/v1/memory/${memory.id}/conflicts/keine-id/resolve`, { resolution: "dismiss" })).statusCode).toBe(404);
    });
  });

  describe("automations: versions and Pause All", () => {
    it("lists the version history with exactly one current entry and one entry per change", async () => {
      const automation = (await list("/api/v1/automations"))[0];
      const staged = await owner.patch(`/api/v1/automations/${automation.id}`, { description: "Neu beschrieben" }, { headers: { "if-match": String(automation.version) } });
      expect(staged.statusCode, staged.body).toBe(403);
      expect(errorOf(staged).details.stage).toBe("preview");
      await owner.patch(`/api/v1/automations/${automation.id}`, { description: "Neu beschrieben" },
        { headers: { "if-match": String(automation.version), ...confirm(staged.json().error.details.previewId).headers } });
      const versions = (await owner.get(`/api/v1/automations/${automation.id}/versions`)).json().items;
      expect(versions[0]).toMatchObject({ version: automation.version + 1, current: true, snapshot: { description: "Neu beschrieben" } });
      expect(versions.filter((entry: any) => entry.current)).toHaveLength(1);
      expect((await owner.get("/api/v1/automations/auto_00000000000000000000000000/versions")).statusCode).toBe(404);
    });

    it("pauses every enabled automation through the staged preview, reports per automation, audits once and is idempotent", async () => {
      const headers = { "idempotency-key": "idem-gaps-pauseall-0001" };
      const staged = await owner.post("/api/v1/automations/pause-all", { reason: "Betriebsferien" }, { headers });
      expect(staged.statusCode, staged.body).toBe(403);
      expect(errorOf(staged).details.stage).toBe("preview");
      const response = await owner.post("/api/v1/automations/pause-all", { reason: "Betriebsferien" },
        { headers: { ...headers, ...confirm(staged.json().error.details.previewId).headers } });
      expect(response.statusCode, response.body).toBe(200);
      const { results, pausedCount } = response.json().data;
      expect(pausedCount).toBeGreaterThan(0);
      expect(results.filter((entry: any) => entry.outcome === "paused")).toHaveLength(pausedCount);
      const automations = await list("/api/v1/automations");
      expect(automations.filter((entry) => entry.enabled).every((entry) => entry.paused)).toBe(true);
      const replay = await owner.post("/api/v1/automations/pause-all", { reason: "Betriebsferien" }, { headers });
      expect(replay.statusCode, replay.body).toBe(200);
      expect(replay.headers["idempotent-replayed"]).toBe("true");
      const audits = auditOf("automation.paused_all");
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ severity: "warning" });
      const stagedSecond = await owner.post("/api/v1/automations/pause-all", undefined, { headers: { "idempotency-key": "idem-gaps-pauseall-0002" } });
      expect(stagedSecond.statusCode).toBe(403);
      const second = await owner.post("/api/v1/automations/pause-all", undefined,
        { headers: { "idempotency-key": "idem-gaps-pauseall-0002", ...confirm(stagedSecond.json().error.details.previewId).headers } });
      expect(second.json().data.pausedCount).toBe(0);
    });
  });

  describe("communication: drafts", () => {
    it("lists the drafts of one thread and filters by status", async () => {
      const all = (await owner.get("/api/v1/communication/drafts")).json();
      const withThread = all.items.find((entry: any) => entry.threadId);
      const forThread = (await owner.get("/api/v1/communication/drafts", { query: { threadId: withThread.threadId } })).json().items;
      expect(forThread.length).toBeGreaterThan(0);
      expect(forThread.every((entry: any) => entry.threadId === withThread.threadId)).toBe(true);
      const sent = (await owner.get("/api/v1/communication/drafts", { query: { status: ["sent"] } })).json().items;
      expect(sent.every((entry: any) => entry.status === "sent")).toBe(true);
      expect((await owner.get("/api/v1/communication/drafts", { query: { threadId: "kaputt" } })).statusCode).toBe(400);
      expect((await viewer.get("/api/v1/communication/drafts")).statusCode).toBe(200);
    });
  });

  describe("voice: enrollment and history", () => {
    it("starts a job (202 + Location), polls it as the clock advances and audits the start", async () => {
      const profile = (await list("/api/v1/voice/profiles"))[0];
      const started = await owner.post(`/api/v1/voice/profiles/${profile.id}/enroll`, { sampleTarget: 4 });
      expect(started.statusCode, started.body).toBe(202);
      const job = started.json().data;
      expect(started.headers.location).toBe(`/api/v1/voice/enrollments/${job.id}`);
      expect(job).toMatchObject({ status: "queued", samplesRequired: 4 });
      expect((await owner.post(`/api/v1/voice/profiles/${profile.id}/enroll`)).statusCode).toBe(409);
      await owner.post("/api/v1/dev/scenarios/control", { action: "clock_advance", ms: 20_000 });
      const done = (await owner.get(`/api/v1/voice/enrollments/${job.id}`)).json().data;
      expect(done).toMatchObject({ status: "completed", samplesCaptured: 4, progress: { value: 1 } });
      const updated = (await list("/api/v1/voice/profiles")).find((entry) => entry.id === profile.id);
      expect(updated.sampleCount).toBe(profile.sampleCount + 4);
      expect(auditOf("voice.enrollment_started").map((entry) => entry.result).sort()).toEqual(["failure", "success"]); // the duplicate start is audited as a failure
      expect((await viewer.get(`/api/v1/voice/enrollments/${job.id}`)).statusCode).toBe(200);
    });

    it("answers 404 for an unknown profile or job", async () => {
      expect((await owner.post("/api/v1/voice/profiles/vprof_00000000000000000000000000/enroll")).statusCode).toBe(404);
      expect((await owner.get("/api/v1/voice/enrollments/venr_00000000000000000000000000")).statusCode).toBe(404);
    });

    it("refuses to delete the voice history without confirm=true and audits the deletion", async () => {
      const refused = await owner.delete("/api/v1/voice/history", { query: { confirm: "false" } });
      expect(refused.statusCode).toBe(422);
      expect(errorOf(refused).code).toBe("VALIDATION_FAILED");
      expect((await owner.delete("/api/v1/voice/history")).statusCode).toBe(400);
      const deleted = await owner.delete("/api/v1/voice/history", { query: { confirm: "true" } });
      expect(deleted.statusCode, deleted.body).toBe(200);
      expect(deleted.json()).toMatchObject({ accepted: true, status: "completed" });
      expect(api.runtime.world?.state.voice.history).toEqual([]);
      expect(auditOf("voice.history_deleted")[0]).toMatchObject({ severity: "warning", result: "success" });
    });
  });

  describe("tasks: assign and input", () => {
    it("assigns and releases a task, audits the assignment and answers 409 for a stale version", async () => {
      const settings = (await owner.get("/api/v1/settings")).json().data;
      expect((await owner.patch("/api/v1/settings", { approvals: { ...settings.approvals, confirmTier2: false } },
        { headers: { "if-match": String(settings.version) } })).statusCode).toBe(200);
      try {
        const task = (await list("/api/v1/tasks", { status: ["todo"] }))[0];
        const agent = (await list("/api/v1/agents")).find((entry) => entry.status === "idle");
        const confirm = (previewId: string) => ({ headers: { "x-action-preview-id": previewId } });
        const stagedAssign = await owner.post(`/api/v1/tasks/${task.id}/assign`, { agentId: agent.id }, { headers: { "if-match": String(task.version) } });
        expect(stagedAssign.statusCode, stagedAssign.body).toBe(403);
        expect(errorOf(stagedAssign).details.stage).toBe("preview");
        const assigned = await owner.post(`/api/v1/tasks/${task.id}/assign`, { agentId: agent.id },
          { headers: { "if-match": String(task.version), ...confirm(stagedAssign.json().error.details.previewId).headers } });
        expect(assigned.statusCode, assigned.body).toBe(200);
        expect(assigned.json().data).toMatchObject({ agentId: agent.id, agentName: agent.name });
        const audit = auditOf("task.assigned")[0];
        expect(audit).toMatchObject({ taskId: task.id, agentId: agent.id, result: "success" });
        // A stale If-Match survives staging unchanged and fails at dispatch.
        const stagedStale = await owner.post(`/api/v1/tasks/${task.id}/assign`, { agentId: null }, { headers: { "if-match": String(task.version) } });
        expect(stagedStale.statusCode).toBe(403);
        const stale = await owner.post(`/api/v1/tasks/${task.id}/assign`, { agentId: null },
          { headers: { "if-match": String(task.version), ...confirm(stagedStale.json().error.details.previewId).headers } });
        expect(stale.statusCode, stale.body).toBe(409);
        const stagedRelease = await owner.post(`/api/v1/tasks/${task.id}/assign`, { agentId: null });
        expect(stagedRelease.statusCode).toBe(403);
        const released = await owner.post(`/api/v1/tasks/${task.id}/assign`, { agentId: null },
          confirm(stagedRelease.json().error.details.previewId));
        expect(released.json().data.agentId).toBeNull();
        expect((await owner.post(`/api/v1/tasks/${task.id}/assign`, { agentId: "agent_00000000000000000000000000" })).statusCode).toBe(422);
      } finally {
        const latest = (await owner.get("/api/v1/settings")).json().data;
        await owner.patch("/api/v1/settings", { approvals: settings.approvals }, { headers: { "if-match": String(latest.version) } });
      }
    });

    it("answers a waiting task, keeps the text out of the audit trail and refuses a second answer", async () => {
      const waiting = (await list("/api/v1/tasks", { status: ["waiting"] })).find((task) => task.blockers.some((blocker: any) => blocker.kind === "input_needed"));
      const text = "Vertraulicher Hinweis zum Angebot 4711";
      const answered = await owner.post(`/api/v1/tasks/${waiting.id}/input`, { input: text });
      expect(answered.statusCode, answered.body).toBe(200);
      expect(answered.json().data.blockers.some((blocker: any) => blocker.kind === "input_needed")).toBe(false);
      const audit = auditOf("task.input_provided")[0];
      expect(audit).toMatchObject({ taskId: waiting.id, result: "success" });
      expect(JSON.stringify(api.runtime.stores.audit.recent(500))).not.toContain(text);
      const again = await owner.post(`/api/v1/tasks/${waiting.id}/input`, { input: "noch einmal" });
      expect(again.statusCode).toBe(409);
      expect((await owner.post(`/api/v1/tasks/${waiting.id}/input`, { input: "" })).statusCode).toBe(422);
    });
  });

  it("keeps the audit hash chain intact after all gap operations", () => {
    expect(api.runtime.audit.verifyNow().valid).toBe(true);
  });
});
