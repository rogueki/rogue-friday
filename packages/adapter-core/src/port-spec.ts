import type { operations, SchemaName } from "@jarvis/sdk";
import type { PortCategory, PortMap } from "./ports";

/** How the result of a port method is validated against the contract before it is forwarded. */
export type ResultShape =
  /** `{items, pageInfo, freshness, sources}`; schema is the `*ListResponse`. */
  | { kind: "page"; schema: SchemaName }
  /** `{data, freshness}`; schema is the `*Response`. */
  | { kind: "single"; schema: SchemaName }
  /** `{items, freshness, sources}` without pagination. */
  | { kind: "hits"; schema: SchemaName }
  /** `ActionResult`. */
  | { kind: "action" }
  /** Flat document that carries `contractVersion` itself (CommandResponse). */
  | { kind: "flat"; schema: SchemaName }
  /** `ActionResult` or an `ApprovalResponse` (HTTP 202). */
  | { kind: "delete-file" }
  /** Not validated by schema (binary content). */
  | { kind: "raw" };

export interface MethodSpec {
  /** OpenAPI operation this method implements. */
  operationId: keyof operations;
  /** `x-capability` of the operation, e.g. `tasks.create`. */
  capability: string;
  /** Changes state at the provider; retried only with an idempotency key. */
  mutating: boolean;
  /** `*.read` methods: part of the minimal port every configured adapter implements. */
  required: boolean;
  result: ResultShape;
}

const method = (
  operationId: keyof operations,
  capability: string,
  result: ResultShape,
  mutating = false,
): MethodSpec => ({ operationId, capability, mutating, required: capability.endsWith(".read"), result });

const page = (op: keyof operations, cap: string, schema: SchemaName) =>
  method(op, cap, { kind: "page", schema });
const single = (op: keyof operations, cap: string, schema: SchemaName, mutating = false) =>
  method(op, cap, { kind: "single", schema }, mutating);
const action = (op: keyof operations, cap: string) => method(op, cap, { kind: "action" }, true);

type Spec = { [C in PortCategory]: Record<keyof Required<PortMap[C]>, MethodSpec> };

/**
 * Single source of truth that ties port methods to OpenAPI operations and capabilities. The registry derives
 * capability enforcement and result validation from it; the conformance suite derives its checks.
 * The mapped type guarantees that every port method has an entry (and vice versa).
 */
export const PORT_SPEC: Spec = {
  tasks: {
    listTasks: page("listTasks", "tasks.read", "TaskListResponse"),
    getTask: single("getTask", "tasks.read", "TaskResponse"),
    createTask: single("createTask", "tasks.create", "TaskResponse", true),
    updateTask: single("updateTask", "tasks.update", "TaskResponse", true),
    cancelTask: single("cancelTask", "tasks.cancel", "TaskResponse", true),
    retryTask: single("retryTask", "tasks.retry", "TaskResponse", true),
    pauseTask: single("pauseTask", "tasks.pause", "TaskResponse", true),
    resumeTask: single("resumeTask", "tasks.resume", "TaskResponse", true),
  },
  activity: {
    listActivity: page("listActivity", "activity.read", "ActivityEventListResponse"),
    getActivityEvent: single("getActivityEvent", "activity.read", "ActivityEventResponse"),
  },
  memory: {
    listMemory: page("listMemory", "memory.read", "MemoryListResponse"),
    getMemory: single("getMemory", "memory.read", "MemoryResponse"),
    createMemory: single("createMemory", "memory.write", "MemoryResponse", true),
    updateMemory: single("updateMemory", "memory.write", "MemoryResponse", true),
    deleteMemory: action("deleteMemory", "memory.delete"),
    searchMemory: method("searchMemory", "memory.search", { kind: "hits", schema: "MemorySearchResponse" }),
  },
  agents: {
    listAgents: page("listAgents", "agents.read", "AgentListResponse"),
    getAgent: single("getAgent", "agents.read", "AgentResponse"),
    pauseAgent: single("pauseAgent", "agents.pause", "AgentResponse", true),
    resumeAgent: single("resumeAgent", "agents.resume", "AgentResponse", true),
    stopAgent: single("stopAgent", "agents.stop", "AgentResponse", true),
  },
  approvals: {
    listApprovals: page("listApprovals", "approvals.read", "ApprovalListResponse"),
    getApproval: single("getApproval", "approvals.read", "ApprovalResponse"),
    approveApproval: single("approveApproval", "approvals.decide", "ApprovalResponse", true),
    rejectApproval: single("rejectApproval", "approvals.decide", "ApprovalResponse", true),
    requestApprovalContext: single(
      "requestApprovalContext",
      "approvals.requestContext",
      "ApprovalResponse",
      true,
    ),
  },
  communication: {
    listChannels: page("listChannels", "communication.read", "ChannelListResponse"),
    listThreads: page("listThreads", "communication.read", "ThreadListResponse"),
    getThread: single("getThread", "communication.read", "ThreadResponse"),
    createDraft: single("createDraft", "communication.draft", "DraftResponse", true),
    updateDraft: single("updateDraft", "communication.draft", "DraftResponse", true),
    requestDraftSend: single("requestDraftSend", "communication.send", "ApprovalResponse", true),
  },
  calendar: {
    listCalendarEvents: page("listCalendarEvents", "calendar.read", "CalendarEventListResponse"),
    getCalendarEvent: single("getCalendarEvent", "calendar.read", "CalendarEventResponse"),
    listCalendarConflicts: page("listCalendarConflicts", "calendar.read", "CalendarConflictListResponse"),
    listCalendarBriefings: page("listCalendarBriefings", "calendar.read", "CalendarBriefingListResponse"),
    createCalendarProposal: single(
      "createCalendarProposal",
      "calendar.propose",
      "CalendarProposalResponse",
      true,
    ),
  },
  automations: {
    listAutomations: page("listAutomations", "automations.read", "AutomationListResponse"),
    getAutomation: single("getAutomation", "automations.read", "AutomationResponse"),
    listAutomationRuns: page("listAutomationRuns", "automations.read", "AutomationRunListResponse"),
    createAutomation: single("createAutomation", "automations.create", "AutomationResponse", true),
    updateAutomation: single("updateAutomation", "automations.update", "AutomationResponse", true),
    testAutomation: single("testAutomation", "automations.test", "AutomationRunResponse", true),
    enableAutomation: single("enableAutomation", "automations.enable", "AutomationResponse", true),
    disableAutomation: single("disableAutomation", "automations.disable", "AutomationResponse", true),
  },
  research: {
    listResearchProjects: page("listResearchProjects", "research.read", "ResearchProjectListResponse"),
    getResearchProject: single("getResearchProject", "research.read", "ResearchProjectResponse"),
    listResearchSources: page("listResearchSources", "research.read", "ResearchSourceListResponse"),
    listResearchFindings: page("listResearchFindings", "research.read", "ResearchFindingListResponse"),
    listResearchArtifacts: page("listResearchArtifacts", "research.read", "ResearchArtifactListResponse"),
  },
  files: {
    listFiles: page("listFiles", "files.read", "FileItemListResponse"),
    getFile: single("getFile", "files.read", "FileItemResponse"),
    getFilePreview: single("getFilePreview", "files.preview", "FilePreviewResponse"),
    downloadFile: method("downloadFile", "files.download", { kind: "raw" }),
    deleteFile: method("deleteFile", "files.delete", { kind: "delete-file" }, true),
  },
  voice: {
    getVoiceStatus: single("getVoiceStatus", "voice.read", "VoiceStatusResponse"),
    listVoiceDevices: page("listVoiceDevices", "voice.read", "VoiceDeviceListResponse"),
    getVoiceMetrics: single("getVoiceMetrics", "voice.read", "VoiceMetricsResponse"),
    listVoiceProfiles: page("listVoiceProfiles", "voice.read", "VoiceProfileListResponse"),
    runVoiceTest: single("runVoiceTest", "voice.test", "VoiceTestResultResponse", true),
    stopVoice: action("stopVoice", "voice.stop"),
  },
  notifications: {
    listNotifications: page("listNotifications", "notifications.read", "NotificationListResponse"),
    acknowledgeNotification: single(
      "acknowledgeNotification",
      "notifications.acknowledge",
      "NotificationResponse",
      true,
    ),
    snoozeNotification: single("snoozeNotification", "notifications.snooze", "NotificationResponse", true),
    resolveNotification: single("resolveNotification", "notifications.resolve", "NotificationResponse", true),
  },
  system: {
    getSystemMetrics: single("getSystemMetrics", "system.read", "SystemMetricsResponse"),
    listServices: page("listServices", "system.read", "ServiceListResponse"),
    listStorageVolumes: page("listStorageVolumes", "system.read", "StorageVolumeListResponse"),
    listModelProviders: page("listModelProviders", "system.read", "ModelProviderListResponse"),
    runServiceHealthcheck: single(
      "runServiceHealthcheck",
      "system.healthcheck",
      "HealthcheckResultResponse",
      true,
    ),
  },
  audit: {
    listAuditEvents: page("listAuditEvents", "audit.read", "AuditEventListResponse"),
    getAuditEvent: single("getAuditEvent", "audit.read", "AuditEventResponse"),
    exportAudit: page("exportAudit", "audit.export", "AuditEventListResponse"),
  },
  commands: {
    listCommandHistory: {
      ...page("listCommandHistory", "commands.history", "CommandHistoryEntryListResponse"),
      required: true,
    },
    executeCommand: method(
      "executeCommand",
      "commands.execute",
      { kind: "flat", schema: "CommandResponse" },
      true,
    ),
    stopCommand: action("stopCommand", "commands.stop"),
    pauseCommand: action("pauseCommand", "commands.pause"),
    resumeCommand: action("resumeCommand", "commands.resume"),
  },
};

/**
 * Capabilities that only toggle UI/runtime behaviour and have no dedicated port method
 * (e.g. `tasks.stream` = the adapter emits events through `AdapterContext.emit`).
 */
export const FLAG_ONLY_CAPABILITIES: Readonly<Record<PortCategory, readonly string[]>> = {
  tasks: ["tasks.stream"],
  activity: ["activity.stream", "activity.backfill"],
  memory: ["memory.lock"],
  agents: ["agents.assignTask"],
  approvals: ["approvals.editBeforeApprove"],
  communication: ["communication.multiChannel"],
  calendar: [
    "calendar.create",
    "calendar.reschedule",
    "calendar.cancel",
    "calendar.invite",
    "calendar.respond",
  ],
  automations: ["automations.pauseAll"],
  research: ["research.create", "research.export"],
  files: ["files.upload"],
  voice: ["voice.enroll"],
  notifications: [],
  system: ["system.restartAdapter", "system.openLogs"],
  audit: ["audit.hashChain"],
  commands: [],
};

export type MethodName<C extends PortCategory> = keyof PortMap[C] & string;

/** All method specs of a category as `[methodName, spec]` pairs. */
export function methodsOf(category: PortCategory): Array<[string, MethodSpec]> {
  return Object.entries(PORT_SPEC[category]);
}

/** Every capability string a manifest of this category may declare. */
export function allowedCapabilities(category: PortCategory): Set<string> {
  const allowed = new Set<string>(FLAG_ONLY_CAPABILITIES[category]);
  for (const [, spec] of methodsOf(category)) allowed.add(spec.capability);
  return allowed;
}

/** Capabilities that map to at least one port method. */
export function methodCapabilities(category: PortCategory): Set<string> {
  return new Set(methodsOf(category).map(([, spec]) => spec.capability));
}

export function findMethodSpec(category: PortCategory, name: string): MethodSpec | undefined {
  return (PORT_SPEC[category] as Record<string, MethodSpec>)[name];
}
