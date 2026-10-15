import {
  CONTRACT_VERSION,
  type AdapterCategory,
  type AdapterConfigPatch,
  type ApprovalContextRequest,
  type ApprovalDecisionRequest,
  type AutomationCreateRequest,
  type AutomationPauseAllRequest,
  type AutomationTestRequest,
  type AutomationUpdateRequest,
  type CalendarProposalRequest,
  type CommandControlRequest,
  type CommandRequest,
  type DraftCreateRequest,
  type DraftSendRequest,
  type DraftUpdateRequest,
  type FileRenameRequest,
  type FrontendTelemetryBatch,
  type LayoutImportRequest,
  type LoginRequest,
  type MemoryConflictResolveRequest,
  type MemoryCreateRequest,
  type MemorySearchRequest,
  type MemoryUpdateRequest,
  type NotificationActionRequest,
  type NotificationSnoozeRequest,
  type ReauthRequest,
  type Role,
  type ScenarioControlRequest,
  type SettingsExport,
  type SettingsPatch,
  type TaskActionRequest,
  type TaskAssignRequest,
  type TaskCreateRequest,
  type TaskInputRequest,
  type TaskUpdateRequest,
  type ThemeImportRequest,
  type VoiceEnrollRequest,
  type VoiceTestRequest,
} from "@friday/sdk";
import type { Page } from "../core/util";
import { ScenarioEngine } from "../scenarios/engine";
import type { OpContext } from "../world/types";
import type { MockWorld } from "../world/world";

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface RouteInput {
  params: Record<string, string>;
  /** Query parameters; repeated keys become arrays. */
  query: Record<string, string | string[]>;
  body: unknown;
  ctx: OpContext;
  /** Optional `?speed=` for scenario playback. */
  raw: URLSearchParams;
}

export interface RouteResult {
  status?: number;
  /** JSON body. */
  body?: unknown;
  headers?: Record<string, string>;
  /** Non-JSON body (downloads, ndjson, csv). */
  text?: { contentType: string; body: string; fileName?: string };
  /** Adapter category whose injected latency applies. */
  category: AdapterCategory | null;
}

export interface RouteDef {
  operationId: string;
  method: HttpMethod;
  /** Path below /api/v1 with `:param` segments (msw syntax). */
  path: string;
  role: Role | "none";
  run(world: MockWorld, engine: ScenarioEngine, input: RouteInput): RouteResult;
}

function single(world: MockWorld, category: AdapterCategory | null, data: unknown, status = 200, headers?: Record<string, string>): RouteResult {
  return {
    status,
    category,
    ...(headers ? { headers } : {}),
    body: { contractVersion: CONTRACT_VERSION, data, freshness: category ? world.freshness(category) : { state: "fresh", asOf: world.nowIso() } },
  };
}

function list<T>(world: MockWorld, category: AdapterCategory, page: Page<T>): RouteResult {
  return {
    category,
    body: { contractVersion: CONTRACT_VERSION, items: page.items, pageInfo: page.pageInfo, freshness: world.freshness(category), sources: world.sources(category) },
  };
}

const bare = (body: unknown, category: AdapterCategory | null = null, status = 200): RouteResult => ({ status, body, category });

/** Query as typed by the generated operation parameters (strings and repeated strings at the wire). */
const q = <T>(query: RouteInput["query"]): T => query as unknown as T;
const body = <T>(input: RouteInput): T => input.body as T;
const bodyOr = <T extends object>(input: RouteInput): T => ((input.body ?? {}) as T);

/** Static Prometheus sample for the browser mock (the real series come from the Control API's registry). */
function prometheusSample(world: MockWorld): string {
  const lines = [
    "# HELP friday_ws_connections Open WebSocket connections",
    "# TYPE friday_ws_connections gauge",
    "friday_ws_connections 1",
    "# HELP friday_http_error_ratio Share of HTTP responses with status >= 500 since start",
    "# TYPE friday_http_error_ratio gauge",
    "friday_http_error_ratio 0",
    "# HELP friday_events_per_second Realtime events per second (10 s window)",
    "# TYPE friday_events_per_second gauge",
    "friday_events_per_second 0.4",
    "# HELP friday_adapter_health Adapter health: 1 healthy, 0.5 degraded, 0 down, -1 unknown",
    "# TYPE friday_adapter_health gauge",
  ];
  for (const adapter of world.state.adapters) {
    lines.push(`friday_adapter_health{adapter="${adapter.manifest.id}"} ${adapter.mode === "online" ? 1 : adapter.mode === "offline" ? 0 : 0.5}`);
  }
  return `${lines.join("\n")}\n`;
}

export const ROUTES: RouteDef[] = [
  // ---- meta / overview / orb
  { operationId: "getMeta", method: "GET", path: "/meta", role: "none", run: (w) => bare(w.meta.getMeta()) },
  { operationId: "getHealth", method: "GET", path: "/health", role: "none", run: (w) => bare(w.meta.getHealth()) },
  { operationId: "getCapabilities", method: "GET", path: "/capabilities", role: "viewer", run: (w) => bare(w.meta.getCapabilities()) },
  { operationId: "listAdapters", method: "GET", path: "/adapters", role: "viewer", run: (w, _e, i) => list(w, "system", w.meta.listAdapters(q(i.query))) },
  { operationId: "getAdapterHealth", method: "GET", path: "/adapters/:id/health", role: "viewer", run: (w, _e, i) => single(w, "system", w.meta.getAdapterHealth(i.params.id as string)) },
  { operationId: "restartAdapter", method: "POST", path: "/adapters/:id/restart", role: "owner", run: (w, _e, i) => bare(w.meta.restartAdapter(i.params.id as string, i.ctx), "system") },
  {
    operationId: "getAdapterLogs",
    method: "GET",
    path: "/adapters/:id/logs",
    role: "owner",
    run: (w, _e, i) => {
      const page = w.meta.listAdapterLogs(i.params.id as string, { ...(typeof i.query.limit === "string" ? { limit: i.query.limit } : {}), ...(typeof i.query.level === "string" ? { level: i.query.level } : {}) });
      return { category: "system", body: { contractVersion: CONTRACT_VERSION, items: page.items, freshness: w.freshness("system"), sources: w.sources("system") } };
    },
  },
  { operationId: "getOverview", method: "GET", path: "/overview", role: "viewer", run: (w) => single(w, null, w.meta.getOverview()) },
  { operationId: "getStatus", method: "GET", path: "/status", role: "viewer", run: (w) => single(w, null, w.meta.getStatus()) },
  { operationId: "getOrbStatus", method: "GET", path: "/orb/status", role: "viewer", run: (w) => single(w, null, w.meta.getOrb()) },

  // ---- observability
  { operationId: "getMetrics", method: "GET", path: "/metrics", role: "owner", run: (w) => ({ category: null, text: { contentType: "text/plain; version=0.0.4; charset=utf-8", body: prometheusSample(w) } }) },
  {
    operationId: "submitFrontendTelemetry",
    method: "POST",
    path: "/telemetry/frontend",
    role: "operator",
    run: (w, _e, i) => {
      const batch = w.validate<FrontendTelemetryBatch>("FrontendTelemetryBatch", body(i));
      return single(w, null, { acceptedErrors: batch.errors?.length ?? 0, acceptedOrbSamples: batch.orbSamples?.length ?? 0 }, 202);
    },
  },

  // ---- auth
  { operationId: "login", method: "POST", path: "/auth/login", role: "none", run: (w, _e, i) => single(w, null, w.auth.login(body<LoginRequest>(i))) },
  { operationId: "logout", method: "POST", path: "/auth/logout", role: "viewer", run: (w, _e, i) => bare(w.auth.logout(i.ctx)) },
  { operationId: "logoutAll", method: "POST", path: "/auth/logout-all", role: "viewer", run: (w, _e, i) => bare(w.auth.logout(i.ctx)) },
  { operationId: "getSession", method: "GET", path: "/auth/session", role: "none", run: (w) => single(w, null, w.auth.getSession()) },
  { operationId: "reauth", method: "POST", path: "/auth/reauth", role: "operator", run: (w, _e, i) => bare(w.auth.reauth(body<ReauthRequest>(i), i.ctx)) },

  // ---- tasks
  { operationId: "listTasks", method: "GET", path: "/tasks", role: "viewer", run: (w, _e, i) => list(w, "tasks", w.tasks.list(q(i.query))) },
  { operationId: "createTask", method: "POST", path: "/tasks", role: "operator", run: (w, _e, i) => { const task = w.tasks.create(body<TaskCreateRequest>(i), i.ctx); return single(w, "tasks", task, 201, { Location: `/api/v1/tasks/${task.id}` }); } },
  { operationId: "getTask", method: "GET", path: "/tasks/:id", role: "viewer", run: (w, _e, i) => single(w, "tasks", w.tasks.get(i.params.id as string)) },
  { operationId: "updateTask", method: "PATCH", path: "/tasks/:id", role: "operator", run: (w, _e, i) => single(w, "tasks", w.tasks.update(i.params.id as string, body<TaskUpdateRequest>(i), i.ctx)) },
  { operationId: "cancelTask", method: "POST", path: "/tasks/:id/cancel", role: "operator", run: (w, _e, i) => single(w, "tasks", w.tasks.cancel(i.params.id as string, bodyOr<TaskActionRequest>(i), i.ctx)) },
  { operationId: "retryTask", method: "POST", path: "/tasks/:id/retry", role: "operator", run: (w, _e, i) => single(w, "tasks", w.tasks.retry(i.params.id as string, bodyOr<TaskActionRequest>(i), i.ctx)) },
  { operationId: "pauseTask", method: "POST", path: "/tasks/:id/pause", role: "operator", run: (w, _e, i) => single(w, "tasks", w.tasks.pause(i.params.id as string, bodyOr<TaskActionRequest>(i), i.ctx)) },
  { operationId: "resumeTask", method: "POST", path: "/tasks/:id/resume", role: "operator", run: (w, _e, i) => single(w, "tasks", w.tasks.resume(i.params.id as string, bodyOr<TaskActionRequest>(i), i.ctx)) },
  { operationId: "assignTask", method: "POST", path: "/tasks/:id/assign", role: "operator", run: (w, _e, i) => single(w, "tasks", w.tasks.assign(i.params.id as string, body<TaskAssignRequest>(i), i.ctx)) },
  { operationId: "provideTaskInput", method: "POST", path: "/tasks/:id/input", role: "operator", run: (w, _e, i) => single(w, "tasks", w.tasks.provideInput(i.params.id as string, body<TaskInputRequest>(i), i.ctx)) },

  // ---- activity
  { operationId: "listActivity", method: "GET", path: "/activity", role: "viewer", run: (w, _e, i) => list(w, "activity", w.activity.list(q(i.query))) },
  { operationId: "getActivityEvent", method: "GET", path: "/activity/:id", role: "viewer", run: (w, _e, i) => single(w, "activity", w.activity.get(i.params.id as string)) },

  // ---- memory
  { operationId: "listMemory", method: "GET", path: "/memory", role: "viewer", run: (w, _e, i) => list(w, "memory", w.memory.list(q(i.query))) },
  { operationId: "createMemory", method: "POST", path: "/memory", role: "operator", run: (w, _e, i) => { const memory = w.memory.create(body<MemoryCreateRequest>(i), i.ctx); return single(w, "memory", memory, 201, { Location: `/api/v1/memory/${memory.id}` }); } },
  { operationId: "searchMemory", method: "POST", path: "/memory/search", role: "viewer", run: (w, _e, i) => ({ category: "memory", body: { contractVersion: CONTRACT_VERSION, items: w.memory.search(body<MemorySearchRequest>(i)), freshness: w.freshness("memory"), sources: w.sources("memory") } }) },
  // `/memory/export` must precede `/memory/:id` (the matcher takes the first pattern that fits).
  {
    operationId: "exportMemory",
    method: "GET",
    path: "/memory/export",
    role: "owner",
    run: (w) => ({
      category: "memory",
      body: { contractVersion: CONTRACT_VERSION, ...w.memory.exportAll() },
      headers: { "Content-Disposition": 'attachment; filename="memory-export.json"' },
    }),
  },
  { operationId: "getMemory", method: "GET", path: "/memory/:id", role: "viewer", run: (w, _e, i) => single(w, "memory", w.memory.get(i.params.id as string)) },
  { operationId: "updateMemory", method: "PATCH", path: "/memory/:id", role: "operator", run: (w, _e, i) => single(w, "memory", w.memory.update(i.params.id as string, body<MemoryUpdateRequest>(i), i.ctx)) },
  { operationId: "deleteMemory", method: "DELETE", path: "/memory/:id", role: "operator", run: (w, _e, i) => bare(w.memory.delete(i.params.id as string, i.ctx), "memory") },
  { operationId: "resolveMemoryConflict", method: "POST", path: "/memory/:id/conflicts/:conflictId/resolve", role: "operator", run: (w, _e, i) => single(w, "memory", w.memory.resolveConflict(i.params.id as string, i.params.conflictId as string, body<MemoryConflictResolveRequest>(i), i.ctx)) },

  // ---- agents
  { operationId: "listAgents", method: "GET", path: "/agents", role: "viewer", run: (w, _e, i) => list(w, "agents", w.agents.list(q(i.query))) },
  { operationId: "getAgent", method: "GET", path: "/agents/:id", role: "viewer", run: (w, _e, i) => single(w, "agents", w.agents.get(i.params.id as string)) },
  { operationId: "pauseAgent", method: "POST", path: "/agents/:id/pause", role: "operator", run: (w, _e, i) => single(w, "agents", w.agents.pause(i.params.id as string, i.ctx)) },
  { operationId: "resumeAgent", method: "POST", path: "/agents/:id/resume", role: "operator", run: (w, _e, i) => single(w, "agents", w.agents.resume(i.params.id as string, i.ctx)) },
  { operationId: "stopAgent", method: "POST", path: "/agents/:id/stop", role: "operator", run: (w, _e, i) => single(w, "agents", w.agents.stop(i.params.id as string, i.ctx)) },

  // ---- approvals
  { operationId: "listApprovals", method: "GET", path: "/approvals", role: "viewer", run: (w, _e, i) => list(w, "approvals", w.approvals.list(q(i.query))) },
  { operationId: "getApproval", method: "GET", path: "/approvals/:id", role: "viewer", run: (w, _e, i) => single(w, "approvals", w.approvals.get(i.params.id as string)) },
  { operationId: "approveApproval", method: "POST", path: "/approvals/:id/approve", role: "operator", run: (w, _e, i) => single(w, "approvals", w.approvals.approve(i.params.id as string, bodyOr<ApprovalDecisionRequest>(i), i.ctx)) },
  { operationId: "rejectApproval", method: "POST", path: "/approvals/:id/reject", role: "operator", run: (w, _e, i) => single(w, "approvals", w.approvals.reject(i.params.id as string, bodyOr<ApprovalDecisionRequest>(i), i.ctx)) },
  { operationId: "requestApprovalContext", method: "POST", path: "/approvals/:id/request-context", role: "operator", run: (w, _e, i) => single(w, "approvals", w.approvals.requestContext(i.params.id as string, body<ApprovalContextRequest>(i), i.ctx)) },

  // ---- communication
  { operationId: "listChannels", method: "GET", path: "/communication/channels", role: "viewer", run: (w, _e, i) => list(w, "communication", w.communication.listChannels(q(i.query))) },
  { operationId: "listThreads", method: "GET", path: "/communication/threads", role: "viewer", run: (w, _e, i) => list(w, "communication", w.communication.listThreads(q(i.query))) },
  { operationId: "getThread", method: "GET", path: "/communication/threads/:id", role: "viewer", run: (w, _e, i) => single(w, "communication", w.communication.getThread(i.params.id as string)) },
  { operationId: "listDrafts", method: "GET", path: "/communication/drafts", role: "viewer", run: (w, _e, i) => list(w, "communication", w.communication.listDrafts(q(i.query))) },
  { operationId: "createDraft", method: "POST", path: "/communication/drafts", role: "operator", run: (w, _e, i) => { const draft = w.communication.createDraft(body<DraftCreateRequest>(i), i.ctx); return single(w, "communication", draft, 201, { Location: `/api/v1/communication/drafts/${draft.id}` }); } },
  { operationId: "updateDraft", method: "PATCH", path: "/communication/drafts/:id", role: "operator", run: (w, _e, i) => single(w, "communication", w.communication.updateDraft(i.params.id as string, body<DraftUpdateRequest>(i), i.ctx)) },
  { operationId: "requestDraftSend", method: "POST", path: "/communication/drafts/:id/request-send", role: "operator", run: (w, _e, i) => single(w, "approvals", w.communication.requestSend(i.params.id as string, bodyOr<DraftSendRequest>(i), i.ctx), 202) },

  // ---- calendar
  { operationId: "listCalendarEvents", method: "GET", path: "/calendar/events", role: "viewer", run: (w, _e, i) => list(w, "calendar", w.calendar.listEvents(q(i.query))) },
  { operationId: "getCalendarEvent", method: "GET", path: "/calendar/events/:id", role: "viewer", run: (w, _e, i) => single(w, "calendar", w.calendar.getEvent(i.params.id as string)) },
  { operationId: "listCalendarConflicts", method: "GET", path: "/calendar/conflicts", role: "viewer", run: (w, _e, i) => list(w, "calendar", w.calendar.listConflicts(q(i.query))) },
  { operationId: "listCalendarBriefings", method: "GET", path: "/calendar/briefings", role: "viewer", run: (w, _e, i) => list(w, "calendar", w.calendar.listBriefings(q(i.query))) },
  { operationId: "createCalendarProposal", method: "POST", path: "/calendar/proposals", role: "operator", run: (w, _e, i) => single(w, "calendar", w.calendar.createProposal(body<CalendarProposalRequest>(i), i.ctx), 201) },

  // ---- automations
  { operationId: "listAutomations", method: "GET", path: "/automations", role: "viewer", run: (w, _e, i) => list(w, "automations", w.automations.list(q(i.query))) },
  { operationId: "createAutomation", method: "POST", path: "/automations", role: "operator", run: (w, _e, i) => { const automation = w.automations.create(body<AutomationCreateRequest>(i), i.ctx); return single(w, "automations", automation, 201, { Location: `/api/v1/automations/${automation.id}` }); } },
  { operationId: "pauseAllAutomations", method: "POST", path: "/automations/pause-all", role: "operator", run: (w, _e, i) => single(w, "automations", w.automations.pauseAll(bodyOr<AutomationPauseAllRequest>(i), i.ctx)) },
  { operationId: "getAutomation", method: "GET", path: "/automations/:id", role: "viewer", run: (w, _e, i) => single(w, "automations", w.automations.get(i.params.id as string)) },
  { operationId: "updateAutomation", method: "PATCH", path: "/automations/:id", role: "operator", run: (w, _e, i) => single(w, "automations", w.automations.update(i.params.id as string, body<AutomationUpdateRequest>(i), i.ctx)) },
  { operationId: "testAutomation", method: "POST", path: "/automations/:id/test", role: "operator", run: (w, _e, i) => single(w, "automations", w.automations.test(i.params.id as string, bodyOr<AutomationTestRequest>(i), i.ctx)) },
  { operationId: "enableAutomation", method: "POST", path: "/automations/:id/enable", role: "operator", run: (w, _e, i) => single(w, "automations", w.automations.enable(i.params.id as string, i.ctx)) },
  { operationId: "disableAutomation", method: "POST", path: "/automations/:id/disable", role: "operator", run: (w, _e, i) => single(w, "automations", w.automations.disable(i.params.id as string, i.ctx)) },
  { operationId: "listAutomationRuns", method: "GET", path: "/automations/:id/runs", role: "viewer", run: (w, _e, i) => list(w, "automations", w.automations.listRuns(i.params.id as string, q(i.query))) },
  { operationId: "listAutomationVersions", method: "GET", path: "/automations/:id/versions", role: "viewer", run: (w, _e, i) => list(w, "automations", w.automations.listVersions(i.params.id as string, q(i.query))) },

  // ---- research
  { operationId: "listResearchProjects", method: "GET", path: "/research/projects", role: "viewer", run: (w, _e, i) => list(w, "research", w.research.listProjects(q(i.query))) },
  { operationId: "getResearchProject", method: "GET", path: "/research/projects/:id", role: "viewer", run: (w, _e, i) => single(w, "research", w.research.getProject(i.params.id as string)) },
  { operationId: "listResearchSources", method: "GET", path: "/research/projects/:id/sources", role: "viewer", run: (w, _e, i) => list(w, "research", w.research.listSources(i.params.id as string, q(i.query))) },
  { operationId: "listResearchFindings", method: "GET", path: "/research/projects/:id/findings", role: "viewer", run: (w, _e, i) => list(w, "research", w.research.listFindings(i.params.id as string, q(i.query))) },
  { operationId: "listResearchArtifacts", method: "GET", path: "/research/projects/:id/artifacts", role: "viewer", run: (w, _e, i) => list(w, "research", w.research.listArtifacts(i.params.id as string, q(i.query))) },

  // ---- files
  { operationId: "listFiles", method: "GET", path: "/files", role: "viewer", run: (w, _e, i) => list(w, "files", w.files.list(q(i.query))) },
  { operationId: "getFile", method: "GET", path: "/files/:id", role: "viewer", run: (w, _e, i) => single(w, "files", w.files.get(i.params.id as string)) },
  { operationId: "renameFile", method: "PATCH", path: "/files/:id", role: "operator", run: (w, _e, i) => single(w, "files", w.files.rename(i.params.id as string, body<FileRenameRequest>(i), i.ctx)) },
  {
    operationId: "deleteFile",
    method: "DELETE",
    path: "/files/:id",
    role: "operator",
    run: (w, _e, i) => {
      const outcome = w.files.delete(i.params.id as string, i.ctx);
      return outcome.kind === "deleted" ? bare(outcome.result, "files") : single(w, "approvals", outcome.approval, 202);
    },
  },
  { operationId: "getFilePreview", method: "GET", path: "/files/:id/preview", role: "viewer", run: (w, _e, i) => single(w, "files", w.files.preview(i.params.id as string)) },
  {
    operationId: "downloadFile",
    method: "GET",
    path: "/files/:id/download",
    role: "viewer",
    run: (w, _e, i) => {
      const version = typeof i.query.version === "string" ? Number(i.query.version) : undefined;
      const file = w.files.download(i.params.id as string, version);
      return { category: "files", text: { contentType: "application/octet-stream", body: file.body, fileName: file.fileName } };
    },
  },

  // ---- voice
  { operationId: "getVoiceStatus", method: "GET", path: "/voice/status", role: "viewer", run: (w) => single(w, "voice", w.voice.getStatus()) },
  { operationId: "listVoiceDevices", method: "GET", path: "/voice/devices", role: "viewer", run: (w, _e, i) => list(w, "voice", w.voice.listDevices(q(i.query))) },
  { operationId: "getVoiceMetrics", method: "GET", path: "/voice/metrics", role: "viewer", run: (w) => single(w, "voice", w.voice.getMetrics()) },
  { operationId: "listVoiceProfiles", method: "GET", path: "/voice/profiles", role: "viewer", run: (w, _e, i) => list(w, "voice", w.voice.listProfiles(q(i.query))) },
  {
    operationId: "enrollVoiceProfile",
    method: "POST",
    path: "/voice/profiles/:id/enroll",
    role: "operator",
    run: (w, _e, i) => {
      const job = w.voice.enroll(i.params.id as string, bodyOr<VoiceEnrollRequest>(i), i.ctx);
      return single(w, "voice", job, 202, { Location: `/api/v1/voice/enrollments/${job.id}` });
    },
  },
  { operationId: "getVoiceEnrollment", method: "GET", path: "/voice/enrollments/:id", role: "viewer", run: (w, _e, i) => single(w, "voice", w.voice.getEnrollment(i.params.id as string)) },
  { operationId: "deleteVoiceHistory", method: "DELETE", path: "/voice/history", role: "owner", run: (w, _e, i) => bare(w.voice.deleteHistory({ confirm: String(i.query.confirm ?? "false") === "true", ...(typeof i.query.before === "string" ? { before: i.query.before } : {}) }, i.ctx), "voice") },
  { operationId: "runVoiceTest", method: "POST", path: "/voice/test", role: "operator", run: (w, _e, i) => single(w, "voice", w.voice.test(body<VoiceTestRequest>(i), i.ctx)) },
  { operationId: "stopVoice", method: "POST", path: "/voice/stop", role: "operator", run: (w, _e, i) => bare(w.voice.stop(i.ctx), "voice") },

  // ---- notifications
  { operationId: "listNotifications", method: "GET", path: "/notifications", role: "viewer", run: (w, _e, i) => list(w, "notifications", w.notifications.list(q(i.query))) },
  { operationId: "acknowledgeNotification", method: "POST", path: "/notifications/:id/acknowledge", role: "operator", run: (w, _e, i) => single(w, "notifications", w.notifications.acknowledge(i.params.id as string, bodyOr<NotificationActionRequest>(i), i.ctx)) },
  { operationId: "snoozeNotification", method: "POST", path: "/notifications/:id/snooze", role: "operator", run: (w, _e, i) => single(w, "notifications", w.notifications.snooze(i.params.id as string, bodyOr<NotificationSnoozeRequest>(i), i.ctx)) },
  { operationId: "resolveNotification", method: "POST", path: "/notifications/:id/resolve", role: "operator", run: (w, _e, i) => single(w, "notifications", w.notifications.resolve(i.params.id as string, bodyOr<NotificationActionRequest>(i), i.ctx)) },

  // ---- system
  { operationId: "getSystemMetrics", method: "GET", path: "/system/metrics", role: "viewer", run: (w) => single(w, "system", w.system.getMetrics()) },
  { operationId: "listServices", method: "GET", path: "/system/services", role: "viewer", run: (w, _e, i) => list(w, "system", w.system.listServices(q(i.query))) },
  { operationId: "listStorageVolumes", method: "GET", path: "/system/storage", role: "viewer", run: (w, _e, i) => list(w, "system", w.system.listStorage(q(i.query))) },
  { operationId: "listModelProviders", method: "GET", path: "/system/models", role: "viewer", run: (w, _e, i) => list(w, "system", w.system.listModels(q(i.query))) },
  { operationId: "runServiceHealthcheck", method: "POST", path: "/system/services/:id/healthcheck", role: "operator", run: (w, _e, i) => single(w, "system", w.system.healthcheck(i.params.id as string, i.ctx)) },

  // ---- audit
  { operationId: "listAuditEvents", method: "GET", path: "/audit/events", role: "viewer", run: (w, _e, i) => list(w, "audit", w.audit.list(q(i.query))) },
  { operationId: "getAuditEvent", method: "GET", path: "/audit/events/:id", role: "viewer", run: (w, _e, i) => single(w, "audit", w.audit.get(i.params.id as string)) },
  {
    operationId: "exportAudit",
    method: "GET",
    path: "/audit/export",
    role: "owner",
    run: (w, _e, i) => {
      const format = (typeof i.query.format === "string" ? i.query.format : "ndjson") as "json" | "ndjson" | "csv";
      const exported = w.audit.export({ format, ...(typeof i.query.from === "string" ? { from: i.query.from } : {}), ...(typeof i.query.to === "string" ? { to: i.query.to } : {}) });
      if (exported.text !== undefined) return { category: "audit", text: { contentType: exported.contentType, body: exported.text, fileName: exported.fileName } };
      return {
        category: "audit",
        body: { contractVersion: CONTRACT_VERSION, items: exported.events, pageInfo: { nextCursor: null, hasNextPage: false, totalCount: exported.events.length }, freshness: w.freshness("audit"), sources: w.sources("audit") },
      };
    },
  },

  // ---- settings
  { operationId: "getSettings", method: "GET", path: "/settings", role: "viewer", run: (w) => single(w, "system", w.settings.get()) },
  { operationId: "updateSettings", method: "PATCH", path: "/settings", role: "owner", run: (w, _e, i) => single(w, "system", w.settings.patch(body<SettingsPatch>(i), i.ctx)) },
  { operationId: "getSettingsSchema", method: "GET", path: "/settings/schema", role: "viewer", run: (w) => single(w, "system", w.settings.schema()) },
  { operationId: "listAdapterSettings", method: "GET", path: "/settings/adapters", role: "owner", run: (w, _e, i) => list(w, "system", w.settings.listAdapters(q(i.query))) },
  { operationId: "updateAdapterSettings", method: "PATCH", path: "/settings/adapters/:id", role: "owner", run: (w, _e, i) => single(w, "system", w.settings.updateAdapter(i.params.id as string, body<AdapterConfigPatch>(i), i.ctx)) },
  { operationId: "testAdapterSettings", method: "POST", path: "/settings/adapters/:id/test", role: "owner", run: (w, _e, i) => single(w, "system", w.settings.testAdapter(i.params.id as string, i.ctx)) },
  { operationId: "listThemes", method: "GET", path: "/settings/themes", role: "viewer", run: (w, _e, i) => list(w, "system", w.settings.listThemes(q(i.query))) },
  { operationId: "importTheme", method: "POST", path: "/settings/themes/import", role: "owner", run: (w, _e, i) => single(w, "system", w.settings.importTheme(body<ThemeImportRequest>(i), i.ctx), 201) },
  { operationId: "listLayouts", method: "GET", path: "/settings/layouts", role: "viewer", run: (w, _e, i) => list(w, "system", w.settings.listLayouts(q(i.query))) },
  { operationId: "importLayout", method: "POST", path: "/settings/layouts/import", role: "owner", run: (w, _e, i) => single(w, "system", w.settings.importLayout(body<LayoutImportRequest>(i), i.ctx), 201) },
  { operationId: "exportSettings", method: "GET", path: "/settings/export", role: "owner", run: (w) => bare(w.settings.export()) },
  { operationId: "importSettings", method: "POST", path: "/settings/import", role: "owner", run: (w, _e, i) => single(w, "system", w.settings.import(body<SettingsExport>(i), i.ctx)) },

  // ---- commands
  { operationId: "executeCommand", method: "POST", path: "/commands", role: "operator", run: (w, _e, i) => bare(w.commands.execute(body<CommandRequest>(i), i.ctx), "commands") },
  { operationId: "stopCommand", method: "POST", path: "/commands/stop", role: "operator", run: (w, _e, i) => bare(w.commands.stop(body<CommandControlRequest>(i), i.ctx), "commands") },
  { operationId: "pauseCommand", method: "POST", path: "/commands/pause", role: "operator", run: (w, _e, i) => bare(w.commands.pause(body<CommandControlRequest>(i), i.ctx), "commands") },
  { operationId: "resumeCommand", method: "POST", path: "/commands/resume", role: "operator", run: (w, _e, i) => bare(w.commands.resume(body<CommandControlRequest>(i), i.ctx), "commands") },
  { operationId: "listCommandHistory", method: "GET", path: "/commands/history", role: "viewer", run: (w, _e, i) => list(w, "commands", w.commands.history(q(i.query))) },

  // ---- dev (scenario console)
  { operationId: "listScenarios", method: "GET", path: "/dev/scenarios", role: "owner", run: (w, e) => ({ category: null, body: { contractVersion: CONTRACT_VERSION, items: e.list(), pageInfo: { nextCursor: null, hasNextPage: false, totalCount: e.list().length }, freshness: { state: "fresh", asOf: w.nowIso() }, sources: [w.source("system")] } }) },
  {
    operationId: "playScenario",
    method: "POST",
    path: "/dev/scenarios/:id/play",
    role: "owner",
    run: (w, e, i) => {
      const speed = i.raw.get("speed");
      return single(w, null, e.play(i.params.id as string, speed ? { speed: Number(speed) } : {}));
    },
  },
  { operationId: "controlScenario", method: "POST", path: "/dev/scenarios/control", role: "owner", run: (w, e, i) => single(w, null, e.control(body<ScenarioControlRequest>(i))) },
  { operationId: "getScenarioState", method: "GET", path: "/dev/scenarios/state", role: "owner", run: (w, e) => single(w, null, e.getState()) },
];
