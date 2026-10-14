/* eslint-disable @typescript-eslint/no-explicit-any -- test code reads untyped JSON bodies and frames that the contract validators check */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROUTE_TABLE } from "../src/http/route-table.generated";
import { ApiClient, startTestApi, type TestApi } from "./helpers";
import { ContractProbe, specOf } from "./support/contract";

/**
 * Exercises every OpenAPI operation of the generated route table against the running API and validates status, body,
 * content type and correlation header of each response against the contract. A new operation without a case here
 * fails the final coverage test.
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
    api = await startTestApi({ ringBufferSize: 5000 });
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
      const removed = await call("deleteFile", { params: { id: temporary.id }, expect: [200, 202] });
      expect([200, 202]).toContain(removed.status);
    });
  });

  describe("voice, notifications and system", () => {
    it("reads and controls voice", async () => {
      await call("getVoiceStatus");
      await call("listVoiceDevices");
      await call("getVoiceMetrics");
      await call("listVoiceProfiles");
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
      expect(metrics.response.body).toContain("# TYPE jarvis_http_requests_total counter");
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
      const updated = await call("updateSettings", { body: { dashboard: { ...current.json.data.dashboard, compact: true } }, headers: { "if-match": String(current.json.version ?? current.json.data.version) } });
      expect(updated.json.data.dashboard.compact).toBe(true);
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

  it("covers every operation of the route table with a contract-valid success response", () => {
    expect(ROUTE_TABLE).toHaveLength(109);
    expect(probe.uncovered(), "Operationen ohne erfolgreichen, vertragsgültigen Aufruf").toEqual([]);
    expect(probe.problems).toEqual([]);
    for (const spec of ROUTE_TABLE) expect(specOf(spec.operationId)).toBe(spec);
  });
});
