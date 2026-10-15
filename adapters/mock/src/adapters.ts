import type {
  ActionOutcome,
  ActivityPort,
  AgentPort,
  ApprovalPort,
  AuditPort,
  CalendarPort,
  CommandPort,
  CommunicationPort,
  DeleteFileResult,
  FileDownload,
  FilePort,
  MemoryPort,
  NotificationPort,
  ResearchPort,
  SystemPort,
  TaskPort,
  VoicePort,
  AutomationPort,
  CallContext,
  MutationContext,
  Page,
  PageParams,
  Single,
} from "@friday/adapter-core";
import type { ActionResult, CommandResponse } from "@friday/sdk";
import { MockAdapterBase, type MockAdapterOptions } from "./base";

const outcome = (result: ActionResult): ActionOutcome => {
  const { contractVersion: _contractVersion, ...rest } = result;
  return rest;
};

export class MockTasksAdapter extends MockAdapterBase implements TaskPort {
  constructor(options: MockAdapterOptions) {
    super("tasks", options);
  }
  listTasks: TaskPort["listTasks"] = (params, call) =>
    this.call("listTasks", call, () => this.page(this.world.tasks.list(this.q(params))));
  getTask: TaskPort["getTask"] = ({ id }, call) =>
    this.call("getTask", call, () => this.single(this.world.tasks.get(id)));
  createTask: NonNullable<TaskPort["createTask"]> = ({ body }, call) =>
    this.call("createTask", call, () => this.single(this.world.tasks.create(body, this.op(call))), { mutating: true });
  updateTask: NonNullable<TaskPort["updateTask"]> = ({ id, body }, call) =>
    this.call("updateTask", call, () => this.single(this.world.tasks.update(id, body, this.op(call))), { mutating: true });
  cancelTask: NonNullable<TaskPort["cancelTask"]> = ({ id, body }, call) =>
    this.call("cancelTask", call, () => this.single(this.world.tasks.cancel(id, body, this.op(call))), { mutating: true });
  retryTask: NonNullable<TaskPort["retryTask"]> = ({ id, body }, call) =>
    this.call("retryTask", call, () => this.single(this.world.tasks.retry(id, body, this.op(call))), { mutating: true });
  pauseTask: NonNullable<TaskPort["pauseTask"]> = ({ id, body }, call) =>
    this.call("pauseTask", call, () => this.single(this.world.tasks.pause(id, body, this.op(call))), { mutating: true });
  resumeTask: NonNullable<TaskPort["resumeTask"]> = ({ id, body }, call) =>
    this.call("resumeTask", call, () => this.single(this.world.tasks.resume(id, body, this.op(call))), { mutating: true });
  provideTaskInput: NonNullable<TaskPort["provideTaskInput"]> = ({ id, body }, call) =>
    this.call("provideTaskInput", call, () => this.single(this.world.tasks.provideInput(id, body, this.op(call))), { mutating: true });
}

export class MockActivityAdapter extends MockAdapterBase implements ActivityPort {
  constructor(options: MockAdapterOptions) {
    super("activity", options);
  }
  listActivity: ActivityPort["listActivity"] = (params, call) =>
    this.call("listActivity", call, () => this.page(this.world.activity.list(this.q(params))));
  getActivityEvent: ActivityPort["getActivityEvent"] = ({ id }, call) =>
    this.call("getActivityEvent", call, () => this.single(this.world.activity.get(id)));
}

export class MockMemoryAdapter extends MockAdapterBase implements MemoryPort {
  constructor(options: MockAdapterOptions) {
    super("memory", options);
  }
  listMemory: MemoryPort["listMemory"] = (params, call) =>
    this.call("listMemory", call, () => this.page(this.world.memory.list(this.q(params))));
  getMemory: MemoryPort["getMemory"] = ({ id }, call) =>
    this.call("getMemory", call, () => this.single(this.world.memory.get(id)));
  createMemory: NonNullable<MemoryPort["createMemory"]> = ({ body }, call) =>
    this.call("createMemory", call, () => this.single(this.world.memory.create(body, this.op(call))), { mutating: true });
  updateMemory: NonNullable<MemoryPort["updateMemory"]> = ({ id, body }, call) =>
    this.call("updateMemory", call, () => this.single(this.world.memory.update(id, body, this.op(call))), { mutating: true });
  deleteMemory: NonNullable<MemoryPort["deleteMemory"]> = ({ id }, call) =>
    this.call("deleteMemory", call, () => outcome(this.world.memory.delete(id, this.op(call))), { mutating: true });
  exportMemory: NonNullable<MemoryPort["exportMemory"]> = (_params, call) =>
    this.call("exportMemory", call, () => this.world.memory.exportAll());
  resolveMemoryConflict: NonNullable<MemoryPort["resolveMemoryConflict"]> = ({ id, conflictId, body }, call) =>
    this.call("resolveMemoryConflict", call, () => this.single(this.world.memory.resolveConflict(id, conflictId, body, this.op(call))), {
      mutating: true,
    });
  searchMemory: NonNullable<MemoryPort["searchMemory"]> = ({ body }, call) =>
    this.call("searchMemory", call, () => ({
      items: this.world.memory.search(body),
      freshness: this.world.freshness("memory"),
      sources: this.world.sources("memory"),
    }));
}

export class MockAgentsAdapter extends MockAdapterBase implements AgentPort {
  constructor(options: MockAdapterOptions) {
    super("agents", options);
  }
  listAgents: AgentPort["listAgents"] = (params, call) =>
    this.call("listAgents", call, () => this.page(this.world.agents.list(this.q(params))));
  getAgent: AgentPort["getAgent"] = ({ id }, call) =>
    this.call("getAgent", call, () => this.single(this.world.agents.get(id)));
  pauseAgent: NonNullable<AgentPort["pauseAgent"]> = ({ id }, call) =>
    this.call("pauseAgent", call, () => this.single(this.world.agents.pause(id, this.op(call))), { mutating: true });
  resumeAgent: NonNullable<AgentPort["resumeAgent"]> = ({ id }, call) =>
    this.call("resumeAgent", call, () => this.single(this.world.agents.resume(id, this.op(call))), { mutating: true });
  stopAgent: NonNullable<AgentPort["stopAgent"]> = ({ id }, call) =>
    this.call("stopAgent", call, () => this.single(this.world.agents.stop(id, this.op(call))), { mutating: true });
  assignTask: NonNullable<AgentPort["assignTask"]> = ({ id, body }, call) =>
    this.call("assignTask", call, () => this.single(this.world.tasks.assign(id, body, this.op(call))), { mutating: true });
}

export class MockApprovalsAdapter extends MockAdapterBase implements ApprovalPort {
  constructor(options: MockAdapterOptions) {
    super("approvals", options);
  }
  listApprovals: ApprovalPort["listApprovals"] = (params, call) =>
    this.call("listApprovals", call, () => this.page(this.world.approvals.list(this.q(params))));
  getApproval: ApprovalPort["getApproval"] = ({ id }, call) =>
    this.call("getApproval", call, () => this.single(this.world.approvals.get(id)));
  approveApproval: NonNullable<ApprovalPort["approveApproval"]> = ({ id, body }, call) =>
    this.call(
      "approveApproval",
      call,
      () => {
        const approval = this.world.approvals.find(id);
        // The Control API has already verified the re-authentication (tier 3); the mock world keeps its own token
        // store, so the adapter hands it a fresh world token instead of the API's.
        const decision =
          approval.requiredAuth === "reauth"
            ? { ...body, reauthToken: this.world.auth.reauth({ password: "verified-by-control-api" }, this.op(call)).reauthToken }
            : (body ?? {});
        return this.single(this.world.approvals.approve(id, decision, this.op(call)));
      },
      { mutating: true },
    );
  rejectApproval: NonNullable<ApprovalPort["rejectApproval"]> = ({ id, body }, call) =>
    this.call("rejectApproval", call, () => this.single(this.world.approvals.reject(id, body, this.op(call))), { mutating: true });
  requestApprovalContext: NonNullable<ApprovalPort["requestApprovalContext"]> = ({ id, body }, call) =>
    this.call("requestApprovalContext", call, () => this.single(this.world.approvals.requestContext(id, body, this.op(call))), {
      mutating: true,
    });
}

export class MockCommunicationAdapter extends MockAdapterBase implements CommunicationPort {
  constructor(options: MockAdapterOptions) {
    super("communication", options);
  }
  listChannels: CommunicationPort["listChannels"] = (params, call) =>
    this.call("listChannels", call, () => this.page(this.world.communication.listChannels(this.q(params))));
  listThreads: CommunicationPort["listThreads"] = (params, call) =>
    this.call("listThreads", call, () => this.page(this.world.communication.listThreads(this.q(params))));
  getThread: CommunicationPort["getThread"] = ({ id }, call) =>
    this.call("getThread", call, () => this.single(this.world.communication.getThread(id)));
  listDrafts: NonNullable<CommunicationPort["listDrafts"]> = (params, call) =>
    this.call("listDrafts", call, () => this.page(this.world.communication.listDrafts(this.q(params))));
  createDraft: NonNullable<CommunicationPort["createDraft"]> = ({ body }, call) =>
    this.call("createDraft", call, () => this.single(this.world.communication.createDraft(body, this.op(call))), { mutating: true });
  updateDraft: NonNullable<CommunicationPort["updateDraft"]> = ({ id, body }, call) =>
    this.call("updateDraft", call, () => this.single(this.world.communication.updateDraft(id, body, this.op(call))), { mutating: true });
  requestDraftSend: NonNullable<CommunicationPort["requestDraftSend"]> = ({ id, body }, call) =>
    this.call("requestDraftSend", call, () => this.single(this.world.communication.requestSend(id, body, this.op(call))), {
      mutating: true,
    });
}

export class MockCalendarAdapter extends MockAdapterBase implements CalendarPort {
  constructor(options: MockAdapterOptions) {
    super("calendar", options);
  }
  listCalendarEvents: CalendarPort["listCalendarEvents"] = (params, call) =>
    this.call("listCalendarEvents", call, () => this.page(this.world.calendar.listEvents(this.q(params))));
  getCalendarEvent: CalendarPort["getCalendarEvent"] = ({ id }, call) =>
    this.call("getCalendarEvent", call, () => this.single(this.world.calendar.getEvent(id)));
  listCalendarConflicts: CalendarPort["listCalendarConflicts"] = (params, call) =>
    this.call("listCalendarConflicts", call, () => this.page(this.world.calendar.listConflicts(this.q(params))));
  listCalendarBriefings: CalendarPort["listCalendarBriefings"] = (params, call) =>
    this.call("listCalendarBriefings", call, () => this.page(this.world.calendar.listBriefings(this.q(params))));
  createCalendarProposal: NonNullable<CalendarPort["createCalendarProposal"]> = ({ body }, call) =>
    this.call("createCalendarProposal", call, () => this.single(this.world.calendar.createProposal(body, this.op(call))), {
      mutating: true,
    });
}

export class MockAutomationsAdapter extends MockAdapterBase implements AutomationPort {
  constructor(options: MockAdapterOptions) {
    super("automations", options);
  }
  listAutomations: AutomationPort["listAutomations"] = (params, call) =>
    this.call("listAutomations", call, () => this.page(this.world.automations.list(this.q(params))));
  getAutomation: AutomationPort["getAutomation"] = ({ id }, call) =>
    this.call("getAutomation", call, () => this.single(this.world.automations.get(id)));
  listAutomationRuns: AutomationPort["listAutomationRuns"] = ({ id, ...paging }, call) =>
    this.call("listAutomationRuns", call, () => this.page(this.world.automations.listRuns(id, this.q(paging))));
  createAutomation: NonNullable<AutomationPort["createAutomation"]> = ({ body }, call) =>
    this.call("createAutomation", call, () => this.single(this.world.automations.create(body, this.op(call))), { mutating: true });
  updateAutomation: NonNullable<AutomationPort["updateAutomation"]> = ({ id, body }, call) =>
    this.call("updateAutomation", call, () => this.single(this.world.automations.update(id, body, this.op(call))), { mutating: true });
  testAutomation: NonNullable<AutomationPort["testAutomation"]> = ({ id, body }, call) =>
    this.call("testAutomation", call, () => this.single(this.world.automations.test(id, body, this.op(call))), { mutating: true });
  enableAutomation: NonNullable<AutomationPort["enableAutomation"]> = ({ id }, call) =>
    this.call("enableAutomation", call, () => this.single(this.world.automations.enable(id, this.op(call))), { mutating: true });
  disableAutomation: NonNullable<AutomationPort["disableAutomation"]> = ({ id }, call) =>
    this.call("disableAutomation", call, () => this.single(this.world.automations.disable(id, this.op(call))), { mutating: true });
  listAutomationVersions: NonNullable<AutomationPort["listAutomationVersions"]> = ({ id, ...paging }, call) =>
    this.call("listAutomationVersions", call, () => this.page(this.world.automations.listVersions(id, this.q(paging))));
  pauseAllAutomations: NonNullable<AutomationPort["pauseAllAutomations"]> = ({ body }, call) =>
    this.call("pauseAllAutomations", call, () => this.single(this.world.automations.pauseAll(body, this.op(call))), { mutating: true });
}

export class MockResearchAdapter extends MockAdapterBase implements ResearchPort {
  constructor(options: MockAdapterOptions) {
    super("research", options);
  }
  listResearchProjects: ResearchPort["listResearchProjects"] = (params, call) =>
    this.call("listResearchProjects", call, () => this.page(this.world.research.listProjects(this.q(params))));
  getResearchProject: ResearchPort["getResearchProject"] = ({ id }, call) =>
    this.call("getResearchProject", call, () => this.single(this.world.research.getProject(id)));
  listResearchSources: ResearchPort["listResearchSources"] = ({ id, ...paging }, call) =>
    this.call("listResearchSources", call, () => this.page(this.world.research.listSources(id, this.q(paging))));
  listResearchFindings: ResearchPort["listResearchFindings"] = ({ id, ...paging }, call) =>
    this.call("listResearchFindings", call, () => this.page(this.world.research.listFindings(id, this.q(paging))));
  listResearchArtifacts: ResearchPort["listResearchArtifacts"] = ({ id, ...paging }, call) =>
    this.call("listResearchArtifacts", call, () => this.page(this.world.research.listArtifacts(id, this.q(paging))));
}

export class MockFilesAdapter extends MockAdapterBase implements FilePort {
  constructor(options: MockAdapterOptions) {
    super("files", options);
  }
  listFiles: FilePort["listFiles"] = (params, call) =>
    this.call("listFiles", call, () => this.page(this.world.files.list(this.q(params))));
  getFile: FilePort["getFile"] = ({ id }, call) =>
    this.call("getFile", call, () => this.single(this.world.files.get(id)));
  getFilePreview: NonNullable<FilePort["getFilePreview"]> = ({ id }, call) =>
    this.call("getFilePreview", call, () => this.single(this.world.files.preview(id)));
  downloadFile: NonNullable<FilePort["downloadFile"]> = ({ id, version }, call) =>
    this.call("downloadFile", call, (): FileDownload => {
      const download = this.world.files.download(id, version);
      const body = new TextEncoder().encode(download.body);
      return { fileId: id, filename: download.fileName, contentType: download.contentType, sizeBytes: body.byteLength, body };
    });
  renameFile: NonNullable<FilePort["renameFile"]> = ({ id, body }, call) =>
    this.call("renameFile", call, () => this.single(this.world.files.rename(id, body, this.op(call))), { mutating: true });
  deleteFile: NonNullable<FilePort["deleteFile"]> = ({ id }, call) =>
    this.call(
      "deleteFile",
      call,
      (): DeleteFileResult => {
        const result = this.world.files.delete(id, this.op(call));
        if (result.kind === "deleted") return { kind: "deleted", ...outcome(result.result) };
        return { kind: "approval_required", approval: this.single(result.approval) };
      },
      { mutating: true },
    );
}

export class MockVoiceAdapter extends MockAdapterBase implements VoicePort {
  constructor(options: MockAdapterOptions) {
    super("voice", options);
  }
  getVoiceStatus: VoicePort["getVoiceStatus"] = (_params, call) =>
    this.call("getVoiceStatus", call, () => this.single(this.world.voice.getStatus()));
  listVoiceDevices: VoicePort["listVoiceDevices"] = (params: PageParams, call) =>
    this.call("listVoiceDevices", call, () => this.page(this.world.voice.listDevices(this.q(params))));
  getVoiceMetrics: VoicePort["getVoiceMetrics"] = (_params, call) =>
    this.call("getVoiceMetrics", call, () => this.single(this.world.voice.getMetrics()));
  listVoiceProfiles: VoicePort["listVoiceProfiles"] = (params: PageParams, call) =>
    this.call("listVoiceProfiles", call, () => this.page(this.world.voice.listProfiles(this.q(params))));
  runVoiceTest: NonNullable<VoicePort["runVoiceTest"]> = ({ body }, call) =>
    this.call("runVoiceTest", call, () => this.single(this.world.voice.test(body, this.op(call))), { mutating: true });
  stopVoice: NonNullable<VoicePort["stopVoice"]> = (_params, call) =>
    this.call("stopVoice", call, () => outcome(this.world.voice.stop(this.op(call))), { mutating: true });
  enrollVoiceProfile: NonNullable<VoicePort["enrollVoiceProfile"]> = ({ id, body }, call) =>
    this.call("enrollVoiceProfile", call, () => this.single(this.world.voice.enroll(id, body, this.op(call))), { mutating: true });
  getVoiceEnrollment: NonNullable<VoicePort["getVoiceEnrollment"]> = ({ id }, call) =>
    this.call("getVoiceEnrollment", call, () => this.single(this.world.voice.getEnrollment(id)));
  deleteVoiceHistory: NonNullable<VoicePort["deleteVoiceHistory"]> = (params, call) =>
    this.call("deleteVoiceHistory", call, () => outcome(this.world.voice.deleteHistory(params, this.op(call))), { mutating: true });
}

export class MockNotificationsAdapter extends MockAdapterBase implements NotificationPort {
  constructor(options: MockAdapterOptions) {
    super("notifications", options);
  }
  listNotifications: NotificationPort["listNotifications"] = (params, call) =>
    this.call("listNotifications", call, () => this.page(this.world.notifications.list(this.q(params))));
  acknowledgeNotification: NonNullable<NotificationPort["acknowledgeNotification"]> = ({ id, body }, call) =>
    this.call("acknowledgeNotification", call, () => this.single(this.world.notifications.acknowledge(id, body, this.op(call))), {
      mutating: true,
    });
  snoozeNotification: NonNullable<NotificationPort["snoozeNotification"]> = ({ id, body }, call) =>
    this.call("snoozeNotification", call, () => this.single(this.world.notifications.snooze(id, body, this.op(call))), { mutating: true });
  resolveNotification: NonNullable<NotificationPort["resolveNotification"]> = ({ id, body }, call) =>
    this.call("resolveNotification", call, () => this.single(this.world.notifications.resolve(id, body, this.op(call))), { mutating: true });
}

export class MockSystemAdapter extends MockAdapterBase implements SystemPort {
  constructor(options: MockAdapterOptions) {
    super("system", options);
  }
  getSystemMetrics: SystemPort["getSystemMetrics"] = (_params, call) =>
    this.call("getSystemMetrics", call, () => this.single(this.world.system.getMetrics()));
  listServices: SystemPort["listServices"] = (params, call) =>
    this.call("listServices", call, () => this.page(this.world.system.listServices(this.q(params))));
  listStorageVolumes: SystemPort["listStorageVolumes"] = (params, call) =>
    this.call("listStorageVolumes", call, () => this.page(this.world.system.listStorage(this.q(params))));
  listModelProviders: SystemPort["listModelProviders"] = (params, call) =>
    this.call("listModelProviders", call, () => this.page(this.world.system.listModels(this.q(params))));
  runServiceHealthcheck: NonNullable<SystemPort["runServiceHealthcheck"]> = ({ id }, call) =>
    this.call("runServiceHealthcheck", call, () => this.single(this.world.system.healthcheck(id, this.op(call))), { mutating: true });
}

export class MockAuditAdapter extends MockAdapterBase implements AuditPort {
  constructor(options: MockAdapterOptions) {
    super("audit", options);
  }
  listAuditEvents: AuditPort["listAuditEvents"] = (params, call) =>
    this.call("listAuditEvents", call, () => this.page(this.world.audit.list(this.q(params))));
  getAuditEvent: AuditPort["getAuditEvent"] = ({ id }, call) =>
    this.call("getAuditEvent", call, () => this.single(this.world.audit.get(id)));
  exportAudit: NonNullable<AuditPort["exportAudit"]> = (params, call) =>
    this.call("exportAudit", call, () => {
      const exported = this.world.audit.export({ ...params, format: "json" });
      return this.page({ items: exported.events, pageInfo: { nextCursor: null, hasNextPage: false, totalCount: exported.events.length } });
    });
}

export class MockCommandsAdapter extends MockAdapterBase implements CommandPort {
  constructor(options: MockAdapterOptions) {
    super("commands", options);
  }
  listCommandHistory: CommandPort["listCommandHistory"] = (params, call) =>
    this.call("listCommandHistory", call, () => this.page(this.world.commands.history(this.q(params))));
  executeCommand: NonNullable<CommandPort["executeCommand"]> = ({ body }, call) =>
    this.call(
      "executeCommand",
      call,
      () => {
        const { contractVersion: _contractVersion, ...response }: CommandResponse = this.world.commands.execute(body, this.op(call));
        return response;
      },
      { mutating: true },
    );
  stopCommand: NonNullable<CommandPort["stopCommand"]> = ({ body }, call) =>
    this.call("stopCommand", call, () => outcome(this.world.commands.stop(body, this.op(call))), { mutating: true });
  pauseCommand: NonNullable<CommandPort["pauseCommand"]> = ({ body }, call) =>
    this.call("pauseCommand", call, () => outcome(this.world.commands.pause(body, this.op(call))), { mutating: true });
  resumeCommand: NonNullable<CommandPort["resumeCommand"]> = ({ body }, call) =>
    this.call("resumeCommand", call, () => outcome(this.world.commands.resume(body, this.op(call))), { mutating: true });
}

export type { CallContext, MutationContext, Page, Single };
