import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createFridayClient, isFridayApiError, type SchemaName } from "@friday/sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MockWorld, ROUTES, ScenarioEngine, createMswHandlers, handleApiRequest, setupNodeMocks, type NodeMocks } from "../src";
import { validator } from "./support";

const BASE = "http://127.0.0.1:3100/api/v1";

interface Sample {
  operationId: string;
  method: string;
  path: string;
  status: number;
  schema?: SchemaName;
  text?: RegExp;
  body?: unknown;
  headers?: Record<string, string>;
  setup?: (world: MockWorld) => void;
  label?: string;
}

const ref = new MockWorld();
const s = ref.state;
const first = <T>(items: T[], predicate: (item: T) => boolean): T => {
  const found = items.find(predicate);
  if (!found) throw new Error("fixture missing");
  return found;
};
const runningTask = first(s.tasks, (task) => task.status === "running" && task.agentId !== null);
const failedTask = first(s.tasks, (task) => task.status === "failed");
const pendingMail = first(s.approvals, (a) => a.status === "pending" && a.type === "send_email");
const pendingOther = first(s.approvals, (a) => a.status === "pending" && a.type === "order");
const pendingContext = first(s.approvals, (a) => a.status === "pending" && a.type === "delete_file");
const emailChannel = first(s.channels, (c) => c.kind === "email");
const draft = first(s.drafts, (d) => d.status === "draft");
const thread = s.threads[0]!;
const event = first(s.calendarEvents, (e) => e.title.startsWith("Zahnarzt"));
const automation = s.automations[0]!;
const project = s.researchProjects[0]!;
const tempFile = first(s.files, (f) => f.category === "temporary" && f.sizeBytes < 10_000);
const reportFile = first(s.files, (f) => f.category === "reports");
const textFile = first(s.files, (f) => f.previewKind === "markdown");
const openNotification = first(s.notifications, (n) => n.status === "open");
const service = s.system.services[0]!;
const unlockedMemory = first(s.memory, (m) => !m.locked);
const idleAgent = first(s.agents, (a) => a.status === "idle");
const workingAgent = first(s.agents, (a) => a.status === "working");
const conflictMemory = first(s.memory, (m) => m.conflicts.some((entry) => entry.resolution === "pending"));
const pendingConflict = conflictMemory.conflicts.find((entry) => entry.resolution === "pending")!;
const inputTask = first(s.tasks, (t) => t.blockers.some((blocker) => blocker.kind === "input_needed"));
const draftThread = first(s.drafts, (d) => d.threadId !== null);
const voiceProfile = s.voice.profiles[0]!;
// Ids are deterministic per seed, so a throw-away world yields the id the sample world will create in `setup`.
const enrollmentId = new MockWorld().voice.enroll(voiceProfile.id, { sampleTarget: 5 }).id;

const SAMPLES: Sample[] = [
  { operationId: "getMeta", method: "GET", path: "/meta", status: 200, schema: "Meta" },
  { operationId: "getHealth", method: "GET", path: "/health", status: 200, schema: "Health" },
  { operationId: "getCapabilities", method: "GET", path: "/capabilities", status: 200, schema: "Capabilities" },
  { operationId: "listAdapters", method: "GET", path: "/adapters", status: 200, schema: "AdapterInfoListResponse" },
  { operationId: "getAdapterHealth", method: "GET", path: "/adapters/mock-tasks/health", status: 200, schema: "AdapterHealthResponse" },
  { operationId: "restartAdapter", method: "POST", path: "/adapters/mock-tasks/restart", status: 200, schema: "ActionResult" },
  { operationId: "getAdapterLogs", method: "GET", path: "/adapters/mock-tasks/logs?limit=5&level=info", status: 200, schema: "AdapterLogListResponse" },
  { operationId: "getOverview", method: "GET", path: "/overview", status: 200, schema: "OverviewResponse" },
  { operationId: "getStatus", method: "GET", path: "/status", status: 200, schema: "FridayStatusResponse" },
  { operationId: "getOrbStatus", method: "GET", path: "/orb/status", status: 200, schema: "OrbSnapshotResponse" },
  { operationId: "login", method: "POST", path: "/auth/login", status: 200, schema: "SessionResponse", body: { username: "erik", password: "mock" } },
  { operationId: "logout", method: "POST", path: "/auth/logout", status: 200, schema: "ActionResult" },
  { operationId: "logoutAll", method: "POST", path: "/auth/logout-all", status: 200, schema: "ActionResult" },
  { operationId: "getSession", method: "GET", path: "/auth/session", status: 200, schema: "SessionResponse" },
  { operationId: "reauth", method: "POST", path: "/auth/reauth", status: 200, schema: "ReauthResponse", body: { password: "mock" } },
  { operationId: "listTasks", method: "GET", path: "/tasks?status=running&status=waiting&sort=-updatedAt&limit=10", status: 200, schema: "TaskListResponse" },
  { operationId: "createTask", method: "POST", path: "/tasks", status: 201, schema: "TaskResponse", body: { title: "Neue Aufgabe für Frau Müller", priority: "P2" }, headers: { "Idempotency-Key": "idem-api-create-1" } },
  { operationId: "getTask", method: "GET", path: `/tasks/${runningTask.id}`, status: 200, schema: "TaskResponse" },
  { operationId: "updateTask", method: "PATCH", path: `/tasks/${runningTask.id}`, status: 200, schema: "TaskResponse", body: { priority: "P1" }, headers: { "If-Match": String(runningTask.version) } },
  { operationId: "cancelTask", method: "POST", path: `/tasks/${runningTask.id}/cancel`, status: 200, schema: "TaskResponse", body: { reason: "Test" } },
  { operationId: "retryTask", method: "POST", path: `/tasks/${failedTask.id}/retry`, status: 200, schema: "TaskResponse" },
  { operationId: "pauseTask", method: "POST", path: `/tasks/${runningTask.id}/pause`, status: 200, schema: "TaskResponse" },
  { operationId: "resumeTask", method: "POST", path: `/tasks/${runningTask.id}/resume`, status: 200, schema: "TaskResponse", setup: (w) => void w.tasks.pause(runningTask.id) },
  { operationId: "assignTask", method: "POST", path: `/tasks/${runningTask.id}/assign`, status: 200, schema: "TaskResponse", body: { agentId: idleAgent.id } },
  { operationId: "provideTaskInput", method: "POST", path: `/tasks/${inputTask.id}/input`, status: 200, schema: "TaskResponse", body: { input: "Bitte das günstigere Angebot verwenden." } },
  { operationId: "listActivity", method: "GET", path: "/activity?limit=20&kind=tool_call", status: 200, schema: "ActivityEventListResponse" },
  { operationId: "getActivityEvent", method: "GET", path: `/activity/${s.activity[0]!.id}`, status: 200, schema: "ActivityEventResponse" },
  { operationId: "listMemory", method: "GET", path: "/memory?type=person&type=company&limit=10", status: 200, schema: "MemoryListResponse" },
  { operationId: "createMemory", method: "POST", path: "/memory", status: 201, schema: "MemoryResponse", body: { type: "fact", content: "Der Drucker steht im Flur.", tags: ["büro"] } },
  { operationId: "searchMemory", method: "POST", path: "/memory/search", status: 200, schema: "MemorySearchResponse", body: { query: "Becker", limit: 5 } },
  { operationId: "exportMemory", method: "GET", path: "/memory/export", status: 200, schema: "MemoryExport" },
  { operationId: "resolveMemoryConflict", method: "POST", path: `/memory/${conflictMemory.id}/conflicts/${pendingConflict.memoryId}/resolve`, status: 200, schema: "MemoryResponse", body: { resolution: "keep_both" } },
  { operationId: "getMemory", method: "GET", path: `/memory/${unlockedMemory.id}`, status: 200, schema: "MemoryResponse" },
  { operationId: "updateMemory", method: "PATCH", path: `/memory/${unlockedMemory.id}`, status: 200, schema: "MemoryResponse", body: { pinned: true, confirm: true } },
  { operationId: "deleteMemory", method: "DELETE", path: `/memory/${unlockedMemory.id}`, status: 200, schema: "ActionResult" },
  { operationId: "listAgents", method: "GET", path: "/agents?status=working", status: 200, schema: "AgentListResponse" },
  { operationId: "getAgent", method: "GET", path: `/agents/${workingAgent.id}`, status: 200, schema: "AgentResponse" },
  { operationId: "pauseAgent", method: "POST", path: `/agents/${idleAgent.id}/pause`, status: 200, schema: "AgentResponse" },
  { operationId: "resumeAgent", method: "POST", path: `/agents/${idleAgent.id}/resume`, status: 200, schema: "AgentResponse", setup: (w) => void w.agents.pause(idleAgent.id) },
  { operationId: "stopAgent", method: "POST", path: `/agents/${workingAgent.id}/stop`, status: 200, schema: "AgentResponse" },
  { operationId: "listApprovals", method: "GET", path: "/approvals?status=pending&riskTier=2", status: 200, schema: "ApprovalListResponse" },
  { operationId: "getApproval", method: "GET", path: `/approvals/${pendingMail.id}`, status: 200, schema: "ApprovalResponse" },
  { operationId: "approveApproval", method: "POST", path: `/approvals/${pendingMail.id}/approve`, status: 200, schema: "ApprovalResponse", body: { comment: "Freigegeben" }, headers: { "Idempotency-Key": "idem-api-approve-1" } },
  { operationId: "rejectApproval", method: "POST", path: `/approvals/${pendingOther.id}/reject`, status: 200, schema: "ApprovalResponse", body: { comment: "Nein" } },
  { operationId: "requestApprovalContext", method: "POST", path: `/approvals/${pendingContext.id}/request-context`, status: 200, schema: "ApprovalResponse", body: { question: "Welche Dateien sind betroffen?" } },
  { operationId: "listChannels", method: "GET", path: "/communication/channels", status: 200, schema: "ChannelListResponse" },
  { operationId: "listThreads", method: "GET", path: "/communication/threads?needsReply=true&priority=P1&priority=P2", status: 200, schema: "ThreadListResponse" },
  { operationId: "getThread", method: "GET", path: `/communication/threads/${thread.id}`, status: 200, schema: "ThreadResponse" },
  { operationId: "listDrafts", method: "GET", path: `/communication/drafts?threadId=${draftThread.threadId}&status=draft`, status: 200, schema: "DraftListResponse" },
  { operationId: "createDraft", method: "POST", path: "/communication/drafts", status: 201, schema: "DraftResponse", body: { channelId: emailChannel.id, to: [{ name: "Thomas Albrecht", address: "t.albrecht@albrecht-partner.example" }], subject: "Belege", body: "Anbei die Belege." } },
  { operationId: "updateDraft", method: "PATCH", path: `/communication/drafts/${draft.id}`, status: 200, schema: "DraftResponse", body: { subject: "Geänderter Betreff" }, headers: { "If-Match": String(draft.version) } },
  { operationId: "requestDraftSend", method: "POST", path: `/communication/drafts/${draft.id}/request-send`, status: 202, schema: "ApprovalResponse", body: {} },
  { operationId: "listCalendarEvents", method: "GET", path: "/calendar/events?from=2026-10-14T00:00:00Z&to=2026-10-25T00:00:00Z", status: 200, schema: "CalendarEventListResponse" },
  { operationId: "getCalendarEvent", method: "GET", path: `/calendar/events/${event.id}`, status: 200, schema: "CalendarEventResponse" },
  { operationId: "listCalendarConflicts", method: "GET", path: "/calendar/conflicts", status: 200, schema: "CalendarConflictListResponse" },
  { operationId: "listCalendarBriefings", method: "GET", path: "/calendar/briefings", status: 200, schema: "CalendarBriefingListResponse" },
  { operationId: "createCalendarProposal", method: "POST", path: "/calendar/proposals", status: 201, schema: "CalendarProposalResponse", body: { type: "reschedule", eventId: event.id, start: "2026-10-20T09:00:00Z", end: "2026-10-20T09:45:00Z", reason: "Neuer Vorschlag" } },
  { operationId: "listAutomations", method: "GET", path: "/automations?enabled=true", status: 200, schema: "AutomationListResponse" },
  { operationId: "createAutomation", method: "POST", path: "/automations", status: 201, schema: "AutomationResponse", body: { name: "Wochenbericht", trigger: { type: "schedule", schedule: "0 8 * * 1", timeZone: "Europe/Berlin", description: "Montags 08:00" }, conditions: [], actions: [{ id: "act_1", type: "notify", channel: "dashboard", requiresApproval: false, description: "Hinweis" }] } },
  { operationId: "pauseAllAutomations", method: "POST", path: "/automations/pause-all", status: 200, schema: "AutomationPauseAllResponse", body: { reason: "Urlaub" } },
  { operationId: "getAutomation", method: "GET", path: `/automations/${automation.id}`, status: 200, schema: "AutomationResponse" },
  { operationId: "updateAutomation", method: "PATCH", path: `/automations/${automation.id}`, status: 200, schema: "AutomationResponse", body: { name: "Umbenannt" }, headers: { "If-Match": String(automation.version) } },
  { operationId: "testAutomation", method: "POST", path: `/automations/${automation.id}/test`, status: 200, schema: "AutomationRunResponse", body: { dryRun: true } },
  { operationId: "enableAutomation", method: "POST", path: `/automations/${automation.id}/enable`, status: 200, schema: "AutomationResponse" },
  { operationId: "disableAutomation", method: "POST", path: `/automations/${automation.id}/disable`, status: 200, schema: "AutomationResponse" },
  { operationId: "listAutomationRuns", method: "GET", path: `/automations/${automation.id}/runs`, status: 200, schema: "AutomationRunListResponse" },
  { operationId: "listAutomationVersions", method: "GET", path: `/automations/${automation.id}/versions`, status: 200, schema: "AutomationVersionListResponse" },
  { operationId: "listResearchProjects", method: "GET", path: "/research/projects", status: 200, schema: "ResearchProjectListResponse" },
  { operationId: "getResearchProject", method: "GET", path: `/research/projects/${project.id}`, status: 200, schema: "ResearchProjectResponse" },
  { operationId: "listResearchSources", method: "GET", path: `/research/projects/${project.id}/sources`, status: 200, schema: "ResearchSourceListResponse" },
  { operationId: "listResearchFindings", method: "GET", path: `/research/projects/${project.id}/findings`, status: 200, schema: "ResearchFindingListResponse" },
  { operationId: "listResearchArtifacts", method: "GET", path: `/research/projects/${project.id}/artifacts`, status: 200, schema: "ResearchArtifactListResponse" },
  { operationId: "listFiles", method: "GET", path: "/files?category=reports&category=research&q=bericht", status: 200, schema: "FileItemListResponse" },
  { operationId: "getFile", method: "GET", path: `/files/${reportFile.id}`, status: 200, schema: "FileItemResponse" },
  { operationId: "renameFile", method: "PATCH", path: `/files/${reportFile.id}`, status: 200, schema: "FileItemResponse", body: { name: "Umbenannter Bericht.md" }, headers: { "If-Match": String(reportFile.version) } },
  { operationId: "deleteFile", method: "DELETE", path: `/files/${tempFile.id}`, status: 200, schema: "ActionResult", label: "temporary file" },
  { operationId: "deleteFile", method: "DELETE", path: `/files/${reportFile.id}`, status: 202, schema: "ApprovalResponse", label: "needs approval" },
  { operationId: "getFilePreview", method: "GET", path: `/files/${textFile.id}/preview`, status: 200, schema: "FilePreviewResponse" },
  { operationId: "downloadFile", method: "GET", path: `/files/${textFile.id}/download`, status: 200, text: /./ },
  { operationId: "getVoiceStatus", method: "GET", path: "/voice/status", status: 200, schema: "VoiceStatusResponse" },
  { operationId: "listVoiceDevices", method: "GET", path: "/voice/devices", status: 200, schema: "VoiceDeviceListResponse" },
  { operationId: "getVoiceMetrics", method: "GET", path: "/voice/metrics", status: 200, schema: "VoiceMetricsResponse" },
  { operationId: "listVoiceProfiles", method: "GET", path: "/voice/profiles", status: 200, schema: "VoiceProfileListResponse" },
  { operationId: "enrollVoiceProfile", method: "POST", path: `/voice/profiles/${voiceProfile.id}/enroll`, status: 202, schema: "VoiceEnrollmentResponse", body: { sampleTarget: 5 } },
  { operationId: "getVoiceEnrollment", method: "GET", path: `/voice/enrollments/${enrollmentId}`, status: 200, schema: "VoiceEnrollmentResponse", setup: (w) => void w.voice.enroll(voiceProfile.id, { sampleTarget: 5 }) },
  { operationId: "deleteVoiceHistory", method: "DELETE", path: "/voice/history?confirm=true", status: 200, schema: "ActionResult" },
  { operationId: "runVoiceTest", method: "POST", path: "/voice/test", status: 200, schema: "VoiceTestResultResponse", body: { kind: "full_pipeline" } },
  { operationId: "stopVoice", method: "POST", path: "/voice/stop", status: 200, schema: "ActionResult", setup: (w) => void w.voice.setMode("listening") },
  { operationId: "listNotifications", method: "GET", path: "/notifications?priority=P1&status=open", status: 200, schema: "NotificationListResponse" },
  { operationId: "acknowledgeNotification", method: "POST", path: `/notifications/${openNotification.id}/acknowledge`, status: 200, schema: "NotificationResponse", body: {} },
  { operationId: "snoozeNotification", method: "POST", path: `/notifications/${openNotification.id}/snooze`, status: 200, schema: "NotificationResponse", body: { durationMinutes: 15 } },
  { operationId: "resolveNotification", method: "POST", path: `/notifications/${openNotification.id}/resolve`, status: 200, schema: "NotificationResponse", body: {} },
  { operationId: "getSystemMetrics", method: "GET", path: "/system/metrics", status: 200, schema: "SystemMetricsResponse" },
  { operationId: "listServices", method: "GET", path: "/system/services", status: 200, schema: "ServiceListResponse" },
  { operationId: "listStorageVolumes", method: "GET", path: "/system/storage", status: 200, schema: "StorageVolumeListResponse" },
  { operationId: "listModelProviders", method: "GET", path: "/system/models", status: 200, schema: "ModelProviderListResponse" },
  { operationId: "runServiceHealthcheck", method: "POST", path: `/system/services/${service.id}/healthcheck`, status: 200, schema: "HealthcheckResultResponse" },
  { operationId: "listAuditEvents", method: "GET", path: "/audit/events?category=approval&limit=10", status: 200, schema: "AuditEventListResponse" },
  { operationId: "getAuditEvent", method: "GET", path: `/audit/events/${s.audit[0]!.id}`, status: 200, schema: "AuditEventResponse" },
  { operationId: "exportAudit", method: "GET", path: "/audit/export?format=json", status: 200, schema: "AuditEventListResponse", label: "json" },
  { operationId: "exportAudit", method: "GET", path: "/audit/export", status: 200, text: /"hash":"[0-9a-f]{64}"/, label: "ndjson" },
  { operationId: "getSettings", method: "GET", path: "/settings", status: 200, schema: "SettingsResponse" },
  { operationId: "updateSettings", method: "PATCH", path: "/settings", status: 200, schema: "SettingsResponse", body: { dashboard: { ...s.settings.dashboard, compact: true } }, headers: { "If-Match": String(s.settings.version) } },
  { operationId: "getContentStudioKeys", method: "GET", path: "/settings/content-studio-keys", status: 200, schema: "ContentStudioKeysResponse" },
  { operationId: "updateContentStudioKey", method: "PATCH", path: "/settings/content-studio-keys", status: 200, schema: "ContentStudioKeysResponse", body: { provider: "kie", key: "mock-value" } },
  { operationId: "createKieTask", method: "POST", path: "/content-studio/kie/tasks", status: 202, schema: "KieTaskResponse", body: { kind: "image", prompt: "A studio still life", aspectRatio: "1:1", confirmed: true } },
  { operationId: "getKieTask", method: "GET", path: "/content-studio/kie/tasks/mock-image-task", status: 200, schema: "KieTaskResponse" },
  { operationId: "createElevenSpeech", method: "POST", path: "/content-studio/elevenlabs/speech", status: 200, text: /^ID3/, body: { text: "Hallo", voiceId: "voice123", confirmed: true } },
  { operationId: "getSettingsSchema", method: "GET", path: "/settings/schema", status: 200, schema: "SettingsSchemaResponse" },
  { operationId: "listAdapterSettings", method: "GET", path: "/settings/adapters", status: 200, schema: "AdapterConfigSettingsListResponse" },
  { operationId: "updateAdapterSettings", method: "PATCH", path: "/settings/adapters/mock-communication", status: 200, schema: "AdapterConfigSettingsResponse", body: { config: { latencyMs: 10 }, secrets: { imapPassword: "x-geheim" } } },
  { operationId: "testAdapterSettings", method: "POST", path: "/settings/adapters/mock-tasks/test", status: 200, schema: "AdapterTestResultResponse" },
  { operationId: "listThemes", method: "GET", path: "/settings/themes", status: 200, schema: "ThemeListResponse" },
  { operationId: "importTheme", method: "POST", path: "/settings/themes/import", status: 201, schema: "ThemeResponse", body: { theme: { ...s.themes[0]!, id: "mein-thema", name: "Mein Thema", builtIn: false }, activate: false } },
  { operationId: "listLayouts", method: "GET", path: "/settings/layouts", status: 200, schema: "LayoutListResponse" },
  { operationId: "importLayout", method: "POST", path: "/settings/layouts/import", status: 201, schema: "LayoutResponse", body: { layout: { ...s.layouts[1]!, layoutId: "mein-layout" } } },
  { operationId: "exportSettings", method: "GET", path: "/settings/export", status: 200, schema: "SettingsExport" },
  { operationId: "importSettings", method: "POST", path: "/settings/import", status: 200, schema: "SettingsResponse", body: ref.settings.export() },
  { operationId: "executeCommand", method: "POST", path: "/commands", status: 200, schema: "CommandResponse", body: { text: "Öffne die Aufgaben", source: "palette" } },
  { operationId: "stopCommand", method: "POST", path: "/commands/stop", status: 200, schema: "ActionResult", body: { scope: "all" } },
  { operationId: "pauseCommand", method: "POST", path: "/commands/pause", status: 200, schema: "ActionResult", body: { scope: "automations" } },
  { operationId: "resumeCommand", method: "POST", path: "/commands/resume", status: 200, schema: "ActionResult", body: { scope: "automations" } },
  { operationId: "listCommandHistory", method: "GET", path: "/commands/history", status: 200, schema: "CommandHistoryEntryListResponse" },
  { operationId: "getMetrics", method: "GET", path: "/metrics", status: 200, text: /# TYPE friday_adapter_health gauge/ },
  { operationId: "submitFrontendTelemetry", method: "POST", path: "/telemetry/frontend", status: 202, schema: "FrontendTelemetryReceiptResponse", body: { errors: [{ kind: "js_error", message: "Fehler in OrbScene" }], orbSamples: [{ fps: 60, frameTimeMs: 16.7 }] } },
  { operationId: "listScenarios", method: "GET", path: "/dev/scenarios", status: 200, schema: "ScenarioListResponse" },
  { operationId: "playScenario", method: "POST", path: "/dev/scenarios/clean-idle/play", status: 200, schema: "ScenarioStateResponse" },
  { operationId: "controlScenario", method: "POST", path: "/dev/scenarios/control", status: 200, schema: "ScenarioStateResponse", body: { action: "latency", ms: 10 } },
  { operationId: "getScenarioState", method: "GET", path: "/dev/scenarios/state", status: 200, schema: "ScenarioStateResponse" },
];

async function call(world: MockWorld, sample: Sample): Promise<Response> {
  const hasBody = sample.body !== undefined;
  return handleApiRequest(
    world,
    new Request(`${BASE}${sample.path}`, {
      method: sample.method,
      headers: { ...(hasBody ? { "Content-Type": "application/json" } : {}), "X-CSRF-Token": "tolerated", ...(sample.headers ?? {}) },
      ...(hasBody ? { body: JSON.stringify(sample.body) } : {}),
    }),
  );
}

describe("REST route coverage", () => {
  it("implements its declared mock routes and tracks live-only beta operations", () => {
    const yaml = readFileSync(resolve(__dirname, "../../contracts/openapi/friday-api.yaml"), "utf8");
    const contract = [...yaml.matchAll(/operationId:\s*(\w+)/g)].map((match) => match[1] as string).sort();
    const liveOnly = [
      "addLinuxVoiceSample", "cancelContentProductionJob", "checkHermesSkillKey", "checkHimalayaSmtp", "confirmVoiceLocalCalendar", "confirmVoiceMail", "createCalendarEvent", "createCodingRun", "createContentProductionJob", "createLocalCalendarEvent", "createPowerPointDeck", "createVoiceCodingRun", "createVoicePowerPointDeck", "deleteLocalCalendarEvent", "downloadPowerPointDeck", "getBrowserAudioAvailability", "getCloudTalk", "getCodingCliStatus", "getCodingRun", "getCodingVoiceRepository",
      "getContentProductionArtifact", "getContentProductionJob", "getContentStudioPlan", "getCurrentWeather", "getDiscordGateway", "getHermesSkillKeys", "getHimalayaAccount", "getHimalayaMessage", "getLinuxVoiceEnrollment", "getObsidianVault", "getOnboarding", "getTelegramGateway", "getTelephony", "getTelephonyCall", "getWhatsappGateway", "getWikiPath", "hangupTelephonyCall", "listHimalayaEnvelopes", "listHimalayaMailboxes", "listPowerPointDecks", "listSkills", "originateCloudTalkCall", "originateTelephonyCall",
      "previewCalDavEvent", "previewCloudTalkCall", "previewTelephonyCall", "previewVoiceLocalCalendar", "previewVoiceMail", "putCloudTalk", "putCodingVoiceRepository", "putContentStudioPlan", "putDiscordGateway", "putHimalayaAccount", "putObsidianVault", "putOnboarding", "putTelegramGateway", "putTelephony", "putWhatsappGateway", "putWikiPath", "searchLocations", "sendHimalayaMessage", "setSkillActivation", "startLinuxVoiceTraining", "stopCodingRun", "updateHermesSkillKey", "updateLocalCalendarEvent",
      // Connected integrations use local WSL helpers or authenticated provider bridges; mock-data has no provider credentials.
      "actOnCalendarAccount", "backupDurableMemory", "cancelWhatsappPairing", "captureDurableMemoryEvent", "changeMailMessage",
      "checkMailAccount", "completeGoogleMailOAuth", "confirmVoiceConnectedCalendar", "correctDurableMemoryEvent",
      "createMailAccount", "deleteMailAccount", "forgetDurableMemoryEvent", "getDurableMemoryStatus", "getMailAttachment",
      "getMailMessage", "getVoiceIntegrationStatus", "getWhatsappPairing", "listCalendarAccounts", "listMailAccounts",
      "listMailEnvelopes", "listMailFolders", "listMailReceipts", "logoutWhatsappGateway", "pollMailOAuth",
      "previewVoiceConnectedCalendar", "putDurableMemorySettings", "reconcileMailArchive", "reconnectWhatsappGateway",
      "reindexDurableMemory", "restoreDurableMemory", "retryDurableMemory", "reviewMailReceipt", "revokeMailOAuth",
      "saveMailDraft", "searchDurableMemory", "searchMailEnvelopes", "sendMailMessage", "setDefaultMailAccount",
      "startMailOAuth", "startWhatsappPairing", "updateMailAccount",
    ].sort();
    const mocked = ROUTES.map((route) => route.operationId).sort();
    expect(contract.filter((id) => !mocked.includes(id))).toEqual(liveOnly);
    expect(mocked).toEqual(contract.filter((id) => !liveOnly.includes(id)));
    expect(new Set(SAMPLES.map((sample) => sample.operationId))).toEqual(new Set(mocked));
  });

  it("exposes one msw handler per route plus a catch-all", () => {
    expect(createMswHandlers(new MockWorld())).toHaveLength(ROUTES.length + 1);
  });
});

describe.each(SAMPLES.map((sample) => [`${sample.operationId}${sample.label ? ` (${sample.label})` : ""}`, sample] as const))("%s", (_name, sample) => {
  it("answers with the contract status, headers and schema", async () => {
    const world = new MockWorld();
    sample.setup?.(world);
    const response = await call(world, sample);
    const raw = await response.text();
    expect({ status: response.status, body: raw.slice(0, 300) }).toEqual({ status: sample.status, body: raw.slice(0, 300) });
    expect(response.headers.get("X-Correlation-Id")).toMatch(/^corr_[0-9A-Za-z]{26}$/);
    if (sample.schema) {
      const result = validator.validate(sample.schema, JSON.parse(raw));
      expect(result.errors).toEqual([]);
    }
    if (sample.text) expect(raw).toMatch(sample.text);
  });
});

describe("envelopes and errors", () => {
  it("list responses carry contractVersion, pageInfo, freshness and sources", async () => {
    const world = new MockWorld();
    const response = await handleApiRequest(world, new Request(`${BASE}/tasks?limit=3`));
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ contractVersion: "2.0.0", freshness: { state: "fresh" }, pageInfo: { hasNextPage: true } });
    expect(body.sources).toEqual([expect.objectContaining({ adapterId: "mock-tasks" })]);
    const next = (body.pageInfo as { nextCursor: string }).nextCursor;
    const page2 = (await (await handleApiRequest(world, new Request(`${BASE}/tasks?limit=3&cursor=${next}`))).json()) as { items: { id: string }[] };
    expect(page2.items).toHaveLength(3);
  });

  it.each([
    ["unknown resource", "GET", "/tasks/task_00000000000000000000000000", undefined, 404, "NOT_FOUND"],
    ["unknown route", "GET", "/nichtvorhanden", undefined, 404, "NOT_FOUND"],
    ["validation", "POST", "/tasks", {}, 422, "VALIDATION_FAILED"],
    ["bad cursor", "GET", "/tasks?cursor=kaputt", undefined, 422, "VALIDATION_FAILED"],
  ] as const)("%s yields the error envelope", async (_label, method, path, body, status, code) => {
    const world = new MockWorld();
    const response = await handleApiRequest(world, new Request(`${BASE}${path}`, { method, ...(body !== undefined ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}) }));
    expect(response.status).toBe(status);
    const json = await response.json();
    expect(validator.validate("ErrorResponse", json).errors).toEqual([]);
    expect(json.error.code).toBe(code);
  });

  it("If-Match conflict returns 409 CONFLICT", async () => {
    const world = new MockWorld();
    const response = await handleApiRequest(world, new Request(`${BASE}/tasks/${runningTask.id}`, { method: "PATCH", headers: { "Content-Type": "application/json", "If-Match": "999" }, body: JSON.stringify({ title: "x" }) }));
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("CONFLICT");
  });

  it("Idempotency-Key replays the stored response", async () => {
    const world = new MockWorld();
    const make = () => handleApiRequest(world, new Request(`${BASE}/tasks`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "idem-replay-0001" }, body: JSON.stringify({ title: "Doppelklick" }) }));
    const a = await (await make()).json();
    const b = await (await make()).json();
    expect(b.data.id).toBe(a.data.id);
    expect(world.state.tasks.filter((task) => task.title === "Doppelklick")).toHaveLength(1);
  });

  it("outage maps to 503 ADAPTER_UNAVAILABLE / ADAPTER_TIMEOUT, capability toggle to 403 CAPABILITY_MISSING", async () => {
    const world = new MockWorld();
    world.setAdapterState("communication", "offline");
    world.setAdapterState("calendar", "timeout");
    world.setCapability("tasks", "create", false);
    const offline = await handleApiRequest(world, new Request(`${BASE}/communication/threads`));
    expect(offline.status).toBe(503);
    expect((await offline.json()).error).toMatchObject({ code: "ADAPTER_UNAVAILABLE", retryable: true });
    const timeout = await handleApiRequest(world, new Request(`${BASE}/calendar/events`));
    expect((await timeout.json()).error.code).toBe("ADAPTER_TIMEOUT");
    const missing = await handleApiRequest(world, new Request(`${BASE}/tasks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "x" }) }));
    expect(missing.status).toBe(403);
    expect((await missing.json()).error.code).toBe("CAPABILITY_MISSING");
    const overview = await handleApiRequest(world, new Request(`${BASE}/overview`));
    expect(overview.status).toBe(200);
    const body = await overview.json();
    expect(body.data.degradedSections.map((section: { adapterId: string }) => section.adapterId).sort()).toEqual(["mock-calendar", "mock-communication"]);
    expect(validator.validate("OverviewResponse", body).errors).toEqual([]);
  });

  it("logout makes protected routes answer 401, health and meta stay public", async () => {
    const world = new MockWorld();
    await handleApiRequest(world, new Request(`${BASE}/auth/logout`, { method: "POST" }));
    expect((await handleApiRequest(world, new Request(`${BASE}/tasks`))).status).toBe(401);
    expect((await handleApiRequest(world, new Request(`${BASE}/health`))).status).toBe(200);
    expect((await handleApiRequest(world, new Request(`${BASE}/meta`))).status).toBe(200);
    const login = await handleApiRequest(world, new Request(`${BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "d", password: "p" }) }));
    expect(login.status).toBe(200);
    expect((await handleApiRequest(world, new Request(`${BASE}/tasks`))).status).toBe(200);
  });

  it("CSRF is tolerated by default and enforceable", async () => {
    const world = new MockWorld();
    const post = (options: Parameters<typeof handleApiRequest>[2]) => handleApiRequest(world, new Request(`${BASE}/tasks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "csrf" }) }), options);
    expect((await post({})).status).toBe(201);
    expect((await post({ enforceCsrf: true })).status).toBe(403);
  });

  it("injected latency delays responses", async () => {
    const world = new MockWorld();
    world.setLatency(60);
    const started = performance.now();
    await handleApiRequest(world, new Request(`${BASE}/tasks?limit=1`));
    expect(performance.now() - started).toBeGreaterThanOrEqual(40);
  });
});

describe("msw node integration with the SDK client", () => {
  let mocks: NodeMocks;
  beforeAll(async () => {
    mocks = await setupNodeMocks({ handlers: { simulateLatency: false } });
  });
  afterAll(() => mocks.stop());

  it("serves the typed client via msw", async () => {
    const client = createFridayClient({ baseUrl: "http://127.0.0.1:3100" });
    const tasks = await client.GET("/api/v1/tasks", { params: { query: { status: ["running"], limit: 5 } } });
    expect(tasks.data?.items.length).toBeGreaterThan(0);
    const created = await client.POST("/api/v1/tasks", { body: { title: "Über msw angelegt" } });
    expect(created.data?.data.title).toBe("Über msw angelegt");
    try {
      await client.GET("/api/v1/tasks/{id}", { params: { path: { id: "task_00000000000000000000000000" } } });
      expect.unreachable();
    } catch (error) {
      expect(isFridayApiError(error) && error.code).toBe("NOT_FOUND");
    }
    ScenarioEngine.for(mocks.world).play("clean-idle");
    const orb = await client.GET("/api/v1/orb/status");
    expect(orb.data?.data.status.mode).toBe("idle");
  });
});
