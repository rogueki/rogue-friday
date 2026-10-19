/* eslint-disable @typescript-eslint/no-explicit-any -- test code reads untyped JSON bodies and frames that the contract validators check */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { ROUTE_TABLE } from "../src/http/route-table.generated";
import { ContentStudioProductionService } from "../src/services/content-studio-production";
import { ApiClient, startTestApi, type TestApi } from "./helpers";
import { ContractProbe, specOf } from "./support/contract";

/**
 * Exercises the mock-platform routes against the running API and validates their success responses.
 * Hermes-backed Skills and Onboarding routes use focused API tests; the final gate lists those exceptions explicitly.
 */
describe("contract: all operations", () => {
  let api: TestApi;
  let owner: ApiClient;
  const probe = new ContractProbe();
  const ids = {
    pauseTask: "", cancelTask: "", retryTask: "", updateTask: "", createdTask: "", agentPause: "", agentStop: "",
    approve: "", reject: "", context: "", ack: "", snooze: "", resolve: "", automation: "",
  };
  const versions: Record<string, number> = {};

  const idsOf = async (path: string, query: Record<string, string | string[]> = {}): Promise<any[]> => {
    const response = await owner.get(path, { query: { limit: "100", ...query } });
    expect(response.statusCode, response.body).toBe(200);
    return response.json().items as any[];
  };

  beforeAll(async () => {
    api = await startTestApi({ ringBufferSize: 5000, env: { KIE_API_KEY: "contract-kie", ELEVENLABS_API_KEY: "contract-eleven" }, providerFetch: async (input) => {
      const url = String(input);
      if (url.includes("createTask")) return Response.json({ code: 200, data: { taskId: "contract-kie-task" } });
      if (url.includes("recordInfo")) return Response.json({ code: 200, data: { state: "success", resultJson: JSON.stringify({ resultUrls: ["https://example.invalid/image.png"] }), creditsConsumed: 2 } });
      if (url.includes("download-url")) return Response.json({ code: 200, data: "https://tempfile.aiquickdraw.com/contract.png" });
      return new Response(new Uint8Array([73, 68, 51, 1]), { headers: { "content-type": "audio/mpeg" } });
    } });
    owner = api.client();
    await owner.loginDev("owner");

    const tasks = await idsOf("/api/v1/tasks");
    const running = tasks.filter((task) => task.status === "running");
    ids.pauseTask = running[0].id;
    ids.cancelTask = running[1].id;
    ids.retryTask = tasks.find((task) => task.status === "failed").id;
    ids.updateTask = tasks.find((task) => task.status === "todo").id;
    const agents = await idsOf("/api/v1/agents");
    const working = agents.filter((agent) => agent.status === "working");
    ids.agentPause = working[0].id;
    ids.agentStop = working[1].id;
    const notifications = await idsOf("/api/v1/notifications", { status: ["open"] });
    ids.ack = notifications[0].id;
    ids.snooze = notifications[1].id;
    ids.resolve = notifications[2].id;
    const automations = await idsOf("/api/v1/automations");
    ids.automation = automations[0].id;
  });

  afterAll(async () => {
    await api.close();
  });

  const call = (operation: Parameters<ContractProbe["call"]>[1], options?: Parameters<ContractProbe["call"]>[2], client: ApiClient = owner) =>
    probe.call(client, operation, options);

  describe("meta and status", () => {
    it("serves meta, health and capabilities without a session", async () => {
      const anonymous = api.client();
      const meta = await call("getMeta", {}, anonymous);
      expect(meta.json).toMatchObject({ dataMode: "mock", eventsPath: "/api/v1/events" });
      await call("getHealth", {}, anonymous);
      await call("getCapabilities");
    });

    it("lists adapters and reports adapter health", async () => {
      const adapters = await call("listAdapters");
      expect(adapters.json.items).toHaveLength(15);
      const first = adapters.json.items[0] as { manifest: { id: string } };
      const health = await call("getAdapterHealth", { params: { id: first.manifest.id } });
      expect(health.json.data.adapterId).toBe(first.manifest.id);
    });

    it("restarts an adapter and reads its log lines", async () => {
      const restarted = await call("restartAdapter", { params: { id: "mock-tasks" }, headers: { "idempotency-key": "idem-contract-restart-1" } });
      expect(restarted.json).toMatchObject({ accepted: true, status: "completed", resourceId: "mock-tasks" });
      const logs = await call("getAdapterLogs", { params: { id: "mock-tasks" }, query: { limit: "20", level: "info" } });
      expect(logs.json.items.length).toBeGreaterThan(0);
      expect(logs.json.items.every((entry: any) => entry.adapterId === "mock-tasks")).toBe(true);
    });

    it("serves overview, status and orb status", async () => {
      const overview = await call("getOverview");
      expect(overview.json.data).toBeDefined();
      await call("getStatus");
      await call("getOrbStatus");
    });
  });

  describe("auth", () => {
    it("logs in, reads the session and re-authenticates", async () => {
      const viewer = api.client();
      const login = await call("login", { body: { username: "dev-viewer", password: "dev" }, csrf: false }, viewer);
      expect(login.json.data.user.id).toMatch(/^usr_[0-9A-Za-z]{26}$/);
      expect(login.json.data.role).toBe("viewer");
      const session = await call("getSession", {}, viewer);
      expect(session.json.data.authenticated).toBe(true);
      const reauth = await call("reauth", { body: { password: "dev" } });
      expect(reauth.json.reauthToken).toBeTruthy();
    });
  });

  describe("tasks", () => {
    it("lists and filters tasks, creates (idempotent) and reads one", async () => {
      await call("listTasks", { query: { status: ["running", "waiting"], priority: ["P1", "P2"], sort: "-updatedAt", limit: "5" } });
      const created = await call("createTask", { body: { title: "Reisekosten abrechnen", priority: "P2", labels: ["finanzen"] }, headers: { "idempotency-key": "idem-contract-task-0001" } });
      ids.createdTask = created.json.data.id;
      expect(created.response.headers.location).toContain(ids.createdTask);
      const task = await call("getTask", { params: { id: ids.createdTask } });
      versions.createdTask = task.json.data.version;
    });

    it("updates with If-Match and runs the lifecycle actions", async () => {
      const current = await call("getTask", { params: { id: ids.updateTask } });
      await call("updateTask", { params: { id: ids.updateTask }, body: { title: "Angebot nachfassen (aktualisiert)" }, headers: { "if-match": String(current.json.data.version) } });
      await call("pauseTask", { params: { id: ids.pauseTask }, body: { reason: "Rückfrage" } });
      await call("resumeTask", { params: { id: ids.pauseTask } });
      await call("cancelTask", { params: { id: ids.cancelTask }, body: { reason: "nicht mehr nötig" } });
      await call("retryTask", { params: { id: ids.retryTask } });
    });

    it("assigns a task to an agent and answers a task that waits for input", async () => {
      const agents = await idsOf("/api/v1/agents");
      const idle = agents.find((agent) => agent.status === "idle");
      const open = (await idsOf("/api/v1/tasks", { status: ["todo", "ready"] }))[0];
      const assigned = await call("assignTask", { params: { id: open.id }, body: { agentId: idle.id }, headers: { "idempotency-key": "idem-contract-assign-01", "if-match": String(open.version) } });
      expect(assigned.json.data.agentId).toBe(idle.id);
      const waiting = (await idsOf("/api/v1/tasks", { status: ["waiting"] })).find((task) => task.blockers.some((blocker: any) => blocker.kind === "input_needed"));
      const answered = await call("provideTaskInput", { params: { id: waiting.id }, body: { input: "Bitte das günstigere Angebot nehmen." }, headers: { "idempotency-key": "idem-contract-input-01" } });
      expect(answered.json.data.blockers.some((blocker: any) => blocker.kind === "input_needed")).toBe(false);
    });
  });

  describe("activity and memory", () => {
    it("lists activity and reads an event", async () => {
      const list = await call("listActivity", { query: { limit: "5" } });
      await call("getActivityEvent", { params: { id: list.json.items[0].id } });
    });

    it("creates, reads, updates, searches and deletes memory", async () => {
      await call("listMemory", { query: { q: "Arbeitszeit", limit: "5" } });
      const created = await call("createMemory", { body: { type: "fact", content: "Dienstreise im November geplant", tags: ["reise"] }, headers: { "idempotency-key": "idem-contract-memory-01" } });
      const id = created.json.data.id as string;
      const read = await call("getMemory", { params: { id } });
      await call("updateMemory", { params: { id }, body: { content: "Dienstreise im November bestätigt" }, headers: { "if-match": String(read.json.data.version) } });
      const search = await call("searchMemory", { body: { query: "Dienstreise" } });
      expect(search.json.items.length).toBeGreaterThan(0);
      await call("deleteMemory", { params: { id } });
    });

    it("exports the memory and resolves a conflict", async () => {
      const exported = await call("exportMemory");
      expect(exported.response.headers["content-disposition"]).toContain("attachment");
      expect(exported.json.count).toBe(exported.json.items.length);
      expect(exported.json.items.some((memory: any) => memory.sensitivity === "restricted")).toBe(false);
      const conflicting = (await idsOf("/api/v1/memory")).find((memory) => memory.conflicts.some((entry: any) => entry.resolution === "pending"));
      const conflictId = conflicting.conflicts.find((entry: any) => entry.resolution === "pending").memoryId as string;
      const resolved = await call("resolveMemoryConflict", { params: { id: conflicting.id, conflictId }, body: { resolution: "keep_both" }, headers: { "idempotency-key": "idem-contract-conflict-1" } });
      expect(resolved.json.data.conflicts.find((entry: any) => entry.memoryId === conflictId).resolution).toBe("keep_both");
    });
  });

  describe("agents", () => {
    it("lists, reads and controls agents", async () => {
      await call("listAgents", { query: { status: ["working"] } });
      await call("getAgent", { params: { id: ids.agentPause } });
      await call("pauseAgent", { params: { id: ids.agentPause } });
      await call("resumeAgent", { params: { id: ids.agentPause } });
      await call("stopAgent", { params: { id: ids.agentStop } });
    });
  });

  describe("approvals", () => {
    it("lists approvals and decides tier-2 approvals with the issued approval token", async () => {
      const pending = await call("listApprovals", { query: { status: ["pending"], riskTier: ["2"] } });
      const [approve, reject, context] = pending.json.items.map((approval: any) => approval.id as string);
      ids.approve = approve;
      ids.reject = reject;
      ids.context = context;
      const opened = await call("getApproval", { params: { id: ids.approve } });
      const token = opened.response.headers["x-approval-token"] as string;
      expect(token).toBeTruthy();
      const approved = await call("approveApproval", { params: { id: ids.approve }, body: { comment: "Passt so." }, headers: { "x-approval-token": token } });
      expect(approved.json.data.status).toMatch(/approved|executed/);
      await call("rejectApproval", { params: { id: ids.reject }, body: { comment: "Nicht jetzt." } });
      await call("requestApprovalContext", { params: { id: ids.context }, body: { question: "Welche Rechnung ist gemeint?" } });
    });
  });

  describe("communication and calendar", () => {
    it("reads channels and threads, drafts and requests sending", async () => {
      const channels = await call("listChannels");
      const email = channels.json.items.find((channel: any) => channel.kind === "email");
      const threads = await call("listThreads", { query: { channelId: email.id, limit: "5" } });
      await call("getThread", { params: { id: threads.json.items[0].id } });
      const draft = await call("createDraft", {
        body: { channelId: email.id, to: [{ name: "Anna Keller", address: "anna.keller@example.invalid" }], subject: "Terminabstimmung", body: "Guten Tag, passt Ihnen Donnerstag?" },
        headers: { "idempotency-key": "idem-contract-draft-01" },
      });
      const id = draft.json.data.id as string;
      await call("updateDraft", { params: { id }, body: { subject: "Terminabstimmung Donnerstag" }, headers: { "if-match": String(draft.json.data.version) } });
      const fresh = await owner.get(`/api/v1/communication/threads/${threads.json.items[0].id}`);
      expect(fresh.statusCode).toBe(200);
      const drafts = await call("listDrafts", { query: { threadId: threads.json.items[0].id } });
      expect(drafts.json.items.every((entry: any) => entry.threadId === threads.json.items[0].id)).toBe(true);
      const send = await call("requestDraftSend", { params: { id }, body: { comment: "Bitte freigeben" } });
      expect(send.status).toBe(202);
    });

    it("reads calendar data and creates a proposal", async () => {
      const events = await call("listCalendarEvents", { query: { limit: "5" } });
      await call("getCalendarEvent", { params: { id: events.json.items[0].id } });
      await call("listCalendarConflicts");
      await call("listCalendarBriefings");
      await call("createCalendarProposal", {
        body: { type: "reschedule", eventId: events.json.items[0].id, start: "2026-10-16T09:00:00.000Z", end: "2026-10-16T10:00:00.000Z", reason: "Überschneidung mit dem Quartalsreview" },
        headers: { "idempotency-key": "idem-contract-calendar-1" },
      });
    });
  });

  describe("automations and research", () => {
    it("manages automations", async () => {
      await call("listAutomations", { query: { enabled: "true" } });
      const existing = await call("getAutomation", { params: { id: ids.automation } });
      const { trigger, conditions, actions } = existing.json.data;
      const created = await call("createAutomation", {
        body: { name: "Wöchentlicher Rechnungscheck", enabled: false, trigger, conditions, actions },
        headers: { "idempotency-key": "idem-contract-auto-001" },
      });
      const id = created.json.data.id as string;
      await call("updateAutomation", { params: { id }, body: { description: "Prüft offene Rechnungen." }, headers: { "if-match": String(created.json.data.version) } });
      await call("testAutomation", { params: { id }, body: { dryRun: true } });
      await call("enableAutomation", { params: { id } });
      await call("disableAutomation", { params: { id } });
      await call("listAutomationRuns", { params: { id: ids.automation } });
      const versions = await call("listAutomationVersions", { params: { id } });
      expect(versions.json.items.length).toBeGreaterThanOrEqual(4);
      expect(versions.json.items[0]).toMatchObject({ current: true });
    });

    it("pauses all automations with one request", async () => {
      const result = await call("pauseAllAutomations", { body: { reason: "Urlaub" }, headers: { "idempotency-key": "idem-contract-pauseall-1" } });
      expect(result.json.data.pausedCount).toBeGreaterThan(0);
      expect(result.json.data.results.length).toBeGreaterThanOrEqual(result.json.data.pausedCount);
    });

    it("reads research projects and their parts", async () => {
      const projects = await call("listResearchProjects");
      const id = projects.json.items[0].id as string;
      await call("getResearchProject", { params: { id } });
      await call("listResearchSources", { params: { id } });
      await call("listResearchFindings", { params: { id } });
      await call("listResearchArtifacts", { params: { id } });
    });
  });

  describe("files", () => {
    it("lists, previews, downloads and deletes files", async () => {
      const files = await call("listFiles", { query: { limit: "50" } });
      const text = files.json.items.find((file: any) => file.mimeType === "text/markdown");
      await call("getFile", { params: { id: text.id } });
      await call("getFilePreview", { params: { id: text.id } });
      const download = await call("downloadFile", { params: { id: text.id } });
      expect(download.response.headers["content-disposition"]).toContain("attachment");
      expect(download.response.headers["content-type"]).toBe("application/octet-stream");
      const temporary = files.json.items.find((file: any) => file.category === "temporary");
      const target = files.json.items.find((file: any) => file.category === "reports");
      const renamed = await call("renameFile", { params: { id: target.id }, body: { name: "Umbenannter Bericht.md" }, headers: { "if-match": String(target.version) } });
      expect(renamed.json.data).toMatchObject({ id: target.id, name: "Umbenannter Bericht.md", version: target.version + 1 });
      const removed = await call("deleteFile", { params: { id: temporary.id }, expect: [200, 202] });
      expect([200, 202]).toContain(removed.status);
    });
  });

  describe("voice, notifications and system", () => {
    it("reads and controls voice", async () => {
      await call("getVoiceStatus");
      await call("listVoiceDevices");
      await call("getVoiceMetrics");
      const profiles = await call("listVoiceProfiles");
      const enrollment = await call("enrollVoiceProfile", { params: { id: profiles.json.items[0].id }, body: { sampleTarget: 5 }, headers: { "idempotency-key": "idem-contract-enroll-01" }, expect: 202 });
      expect(enrollment.response.headers.location).toBe(`/api/v1/voice/enrollments/${enrollment.json.data.id}`);
      const job = await call("getVoiceEnrollment", { params: { id: enrollment.json.data.id } });
      expect(job.json.data).toMatchObject({ profileId: profiles.json.items[0].id, samplesRequired: 5 });
      const deleted = await call("deleteVoiceHistory", { query: { confirm: "true" }, headers: { "idempotency-key": "idem-contract-history-01" } });
      expect(deleted.json.message).toMatch(/Verlaufseinträge/);
      await call("runVoiceTest", { body: { kind: "stt" } });
      const started = await call("executeCommand", { body: { text: "Sprachaufnahme starten", source: "voice" } });
      expect(started.json.status).toBe("executed");
      await call("stopVoice");
    });

    it("handles notifications", async () => {
      await call("listNotifications", { query: { status: ["open"], priority: ["P0", "P1"] } });
      await call("acknowledgeNotification", { params: { id: ids.ack }, body: { comment: "gesehen" } });
      await call("snoozeNotification", { params: { id: ids.snooze }, body: { durationMinutes: 30 } });
      await call("resolveNotification", { params: { id: ids.resolve }, body: {} });
    });

    it("reads system data and runs a service healthcheck", async () => {
      await call("getSystemMetrics");
      const services = await call("listServices");
      await call("listStorageVolumes");
      await call("listModelProviders");
      await call("runServiceHealthcheck", { params: { id: services.json.items[0].id } });
    });

    it("serves Prometheus metrics and accepts frontend telemetry", async () => {
      const metrics = await call("getMetrics");
      expect(metrics.response.headers["content-type"]).toContain("text/plain");
      expect(metrics.response.body).toContain("# TYPE friday_http_requests_total counter");
      const receipt = await call("submitFrontendTelemetry", {
        body: { errors: [{ kind: "js_error", message: "ReferenceError in OrbScene" }], orbSamples: [{ fps: 59.4, frameTimeMs: 16.8, webglMemoryBytes: 52428800 }] },
        expect: 202,
      });
      expect(receipt.json.data).toEqual({ acceptedErrors: 1, acceptedOrbSamples: 1 });
    });
  });

  describe("audit", () => {
    it("lists, reads and exports audit events", async () => {
      const list = await call("listAuditEvents", { query: { limit: "5" } });
      await call("getAuditEvent", { params: { id: list.json.items[0].id } });
      const json = await call("exportAudit", { query: { format: "json" } });
      expect(json.json.items.length).toBeGreaterThan(0);
      const ndjson = await call("exportAudit", { query: { format: "ndjson" } });
      expect(ndjson.response.headers["content-type"]).toContain("ndjson");
      await call("exportAudit", { query: { format: "csv" } });
    });
  });

  describe("settings", () => {
    it("reads and updates settings with If-Match", async () => {
      const current = await call("getSettings");
      expect(current.json.data.profile.assistantName).toBe("F.R.I.D.A.Y.");
      await call("getSettingsSchema");
      const keys = await call("getContentStudioKeys");
      expect(keys.json.data).toMatchObject({ kie: true, elevenlabs: true, capcut: false });
      const keyUpdate = await call("updateContentStudioKey", { body: { provider: "kie", key: "contract-value" } });
      expect(keyUpdate.json.data.kie).toBe(true);
      expect(keyUpdate.response.body).not.toContain("contract-value");
      const updated = await call("updateSettings", { body: { dashboard: { ...current.json.data.dashboard, compact: true, contentStudioEnabled: true } }, headers: { "if-match": String(current.json.version ?? current.json.data.version) } });
      expect(updated.json.data.dashboard.compact).toBe(true);
    });

    it("creates media, reads status and returns speech through server-side provider adapters", async () => {
      const created = await call("createKieTask", { body: { kind: "image", prompt: "A studio still life", aspectRatio: "1:1", confirmed: true }, headers: { "idempotency-key": "contract-kie-create-1" } });
      expect(created.json.data.taskId).toBe("contract-kie-task");
      const status = await call("getKieTask", { params: { id: created.json.data.taskId } });
      expect(status.json.data.state).toBe("success");
      const speech = await call("createElevenSpeech", { body: { text: "Hallo", voiceId: "voice123", confirmed: true }, headers: { "idempotency-key": "contract-eleven-1" } });
      expect(speech.response.headers["content-type"]).toContain("audio/mpeg");
    });

    it("reads and writes the versioned Content Studio plan", async () => {
      const empty = await call("getContentStudioPlan");
      expect(empty.json.data).toMatchObject({ revision: 0, plan: null });
      const saved = await call("putContentStudioPlan", {
        body: { version: 1, content: [{ id: "contract-idea", titel: "Freitag", plattform: "Instagram", format: "Feed-Post", beschreibung: "Kurzer Beitrag.", zieldatum: "", status: "idee" }], postings: [] },
        headers: { "if-match": "0" },
      });
      expect(saved.json.data).toMatchObject({ revision: 1, plan: { version: 1, content: [{ id: "contract-idea" }], postings: [] } });
    });

    it("starts a planned production job and downloads its locally rendered artifact", async () => {
      api.runtime.contentStudioProduction = new ContentStudioProductionService(api.runtime.db, api.runtime.contentStudioPlan,
        api.runtime.contentStudioKeys, api.runtime.contentStudioProviders, api.config.paths.dataDir, {
          ffmpegAvailable: () => true,
          download: async () => Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
          render: async ({ outputPath }) => { await writeFile(outputPath, Buffer.from("contract-mp4")); },
        });
      const created = await call("createContentProductionJob", {
        body: { ideaId: "contract-idea", planRevision: 1, voiceId: "voice123", confirmed: true },
        headers: { "idempotency-key": "contract-production-1" },
      });
      await api.runtime.contentStudioProduction.processPending();
      const job = await call("getContentProductionJob", { params: { id: created.json.data.id } });
      expect(job.json.data.state).toBe("completed");
      await call("getContentProductionArtifact", { params: { id: created.json.data.id } });
      const waiting = await call("createContentProductionJob", {
        body: { ideaId: "contract-idea", planRevision: 1, confirmed: true },
        headers: { "idempotency-key": "contract-production-cancel-1" },
      });
      const cancelled = await call("cancelContentProductionJob", { params: { id: waiting.json.data.id } });
      expect(cancelled.json.data.state).toBe("cancelled");
    });

    it("configures adapters", async () => {
      const list = await call("listAdapterSettings");
      const id = list.json.items[0].adapterId ?? list.json.items[0].id;
      const current = list.json.items[0];
      expect(current.adapterId).toBe(id);
      await call("updateAdapterSettings", { params: { id }, body: { config: {} } });
      await call("testAdapterSettings", { params: { id } });
    });

    it("lists, imports and exports themes, layouts and the full settings", async () => {
      const themes = await call("listThemes");
      const theme = { ...themes.json.items[0], id: "contract-import", name: "Importiertes Theme", builtIn: false };
      await call("importTheme", { body: { theme, activate: false } });
      const layouts = await call("listLayouts");
      const source = layouts.json.items[0];
      const layout = {
        layoutId: "contract-import",
        name: "Importiertes Layout",
        columns: source.columns,
        widgets: source.widgets.map((widget: any) => ({ id: widget.id, x: widget.x, y: widget.y, w: widget.w, h: widget.h, visible: widget.visible })),
      };
      await call("importLayout", { body: { layout, activate: false } });
      const exported = await call("exportSettings");
      await call("importSettings", { body: exported.json });
    });
  });

  describe("commands and dev console", () => {
    it("executes commands and controls the voice scope", async () => {
      await call("executeCommand", { body: { text: "Öffne die Aufgaben", source: "palette" } });
      await call("pauseCommand", { body: { scope: "voice" } });
      await call("resumeCommand", { body: { scope: "voice" } });
      await call("stopCommand", { body: { scope: "voice" } });
      await call("listCommandHistory");
    });

    it("drives the scenario console", async () => {
      const scenarios = await call("listScenarios");
      expect(scenarios.json.items.length).toBeGreaterThan(5);
      await call("playScenario", { params: { id: "clean-idle" } });
      await call("controlScenario", { body: { action: "clock_advance", ms: 60_000 } });
      await call("getScenarioState");
    });
  });

  describe("sessions end", () => {
    it("logs out and logs out everywhere", async () => {
      const single = api.client();
      await single.loginDev("operator");
      await call("logout", {}, single);
      const all = api.client();
      await all.loginDev("viewer");
      await call("logoutAll", {}, all);
    });
  });

  it("covers mock-platform operations with contract-valid success responses", () => {
    expect(ROUTE_TABLE).toHaveLength(254);
    // Hermes-backed Skills/Onboarding routes have focused API tests instead of mock-platform success fixtures.
    const focusedRoutes = new Set(["searchLocations", "getCurrentWeather", "getBrowserAudioAvailability", "getLinuxVoiceEnrollment", "addLinuxVoiceSample", "startLinuxVoiceTraining", "listSkills", "setSkillActivation", "createPowerPointDeck", "createVoicePowerPointDeck", "listPowerPointDecks", "downloadPowerPointDeck", "getOnboarding", "putOnboarding", "getObsidianVault", "putObsidianVault", "getWikiPath", "putWikiPath", "getHimalayaAccount", "putHimalayaAccount", "checkHimalayaSmtp", "listHimalayaMailboxes", "listHimalayaEnvelopes", "getHimalayaMessage", "sendHimalayaMessage", "previewVoiceMail", "confirmVoiceMail", "previewCalDavEvent", "createCalendarEvent", "createLocalCalendarEvent", "updateLocalCalendarEvent", "deleteLocalCalendarEvent", "previewVoiceLocalCalendar", "confirmVoiceLocalCalendar", "getHermesSkillKeys", "updateHermesSkillKey", "checkHermesSkillKey", "createCodingRun", "getCodingRun", "stopCodingRun", "getCodingCliStatus", "getCodingVoiceRepository", "putCodingVoiceRepository", "createVoiceCodingRun", "getTelegramGateway", "putTelegramGateway", "getDiscordGateway", "putDiscordGateway", "getWhatsappGateway", "putWhatsappGateway", "getCloudTalk", "putCloudTalk", "previewCloudTalkCall", "originateCloudTalkCall", "getTelephony", "putTelephony", "previewTelephonyCall", "originateTelephonyCall", "getTelephonyCall", "hangupTelephonyCall"]);
    // Native/provider integration operations have dedicated route, protocol and auth tests with synthetic providers.
    const integrationFocusedRoutes = new Set(["actOnCalendarAccount", "backupDurableMemory", "cancelWhatsappPairing",
      "captureDurableMemoryEvent", "changeMailMessage", "checkMailAccount", "completeGoogleMailOAuth",
      "confirmVoiceConnectedCalendar", "correctDurableMemoryEvent", "createMailAccount", "deleteMailAccount",
      "forgetDurableMemoryEvent", "getDurableMemoryStatus", "getMailAttachment", "getMailMessage",
      "getHermesConfig", "getVoiceIntegrationStatus", "getWhatsappPairing", "listCalendarAccounts", "listMailAccounts",
      "listMailEnvelopes", "listMailFolders", "listMailReceipts", "logoutWhatsappGateway", "pollMailOAuth",
      "patchHermesConfig", "previewVoiceConnectedCalendar", "putDurableMemorySettings", "reconcileMailArchive", "reconnectWhatsappGateway",
      "reindexDurableMemory", "restoreDurableMemory", "retryDurableMemory", "reviewMailReceipt",
      "revokeMailOAuth", "saveMailDraft", "searchDurableMemory", "searchMailEnvelopes", "sendMailMessage",
      "setDefaultMailAccount", "startMailOAuth", "startWhatsappPairing", "updateMailAccount",
      "previewMessengerMessage", "confirmMessengerMessage", "listMessengerReceipts",
      "listMessengerTargets", "registerMessengerTarget", "removeMessengerTarget", "getMessengerCatalog",
      "getSystemBackupStatus", "performSystemBackupAction", "getDataRetentionStatus", "performDataRetentionAction",
      "getMessengerProvider", "updateMessengerProvider", "applyMessengerProvider", "listMessengerSenders",
      "linkMessengerSender", "unlinkMessengerSender", "captureMessengerInbound"]);
    expect(integrationFocusedRoutes.size).toBe(61);
    for (const operationId of integrationFocusedRoutes) expect(ROUTE_TABLE.some((spec) => spec.operationId === operationId), operationId).toBe(true);
    expect(probe.uncovered().filter((id) => !focusedRoutes.has(id) && !integrationFocusedRoutes.has(id)), "Operationen ohne erfolgreichen, vertragsgültigen Aufruf").toEqual([]);
    expect(probe.problems).toEqual([]);
    const smtpCheck = specOf("checkHimalayaSmtp");
    expect(smtpCheck.role).toBe("owner");
    expect(smtpCheck.csrf).toBe(true);
    for (const spec of ROUTE_TABLE) expect(specOf(spec.operationId)).toBe(spec);
  });
});
