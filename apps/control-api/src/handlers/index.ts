import type { Handler } from "../http/context";
import type { OperationId } from "../http/route-types";
import { adapterHandlers } from "./adapters";
import { approvalHandlers } from "./approvals";
import { authHandlers } from "./auth";
import { commandHandlers } from "./commands";
import { devHandlers } from "./dev";
import { domainOpHandlers } from "./domain-ops";
import { metaHandlers } from "./meta";
import { observabilityHandlers } from "./observability";
import { buildPortHandlers } from "./ports";
import { settingsHandlers } from "./settings";
import { contentStudioHandlers } from "./content-studio";
import { skillsHandlers } from "./skills";
import { caldavHandlers } from "./caldav";
import { localCalendarHandlers, localCalendarReads } from "./local-calendar";
import { voiceCalendarHandlers } from "./voice-calendar";
import { voiceMailHandlers } from "./voice-mail";
import { browserVoiceHandlers } from "./browser-voice";
import { integrationHandlers } from "./integrations";
import { durableMemoryHandlers } from "./durable-memory";
import { mailAccountHandlers } from "./mail-accounts";
import { calendarAccountHandlers } from "./calendar-accounts";
import { connectedCalendarVoiceHandlers } from "./connected-calendar-voice";
import { dataRetentionHandlers } from "./data-retention";
import { messengerSendHandlers } from "./messenger-send";
import { hermesConfigHandlers } from "./hermes-config";
import { systemBackupHandlers } from "./system-backups";
import { messengerInboundHandlers } from "./messenger-inbound";
import { taskActionHandlers } from "./task-actions";
import { agentActionHandlers } from "./agent-actions";
import { knowledgeActionHandlers } from "./knowledge-actions";
import { automationActionHandlers } from "./automation-actions";
import { researchActionHandlers, researchReads } from "./research-actions";

/** Port-backed operations come from `PORT_SPEC`; the explicit handlers add enforcement or are served locally. */
export function buildHandlers(): Map<OperationId, Handler> {
  const handlers = buildPortHandlers();
  const localReads = localCalendarReads(handlers.get("listCalendarEvents")!, handlers.get("getCalendarEvent")!);
  const localResearchReads = researchReads(handlers);
  const overrides: Array<Partial<Record<OperationId, Handler>>> = [
    metaHandlers,
    authHandlers,
    settingsHandlers,
    contentStudioHandlers,
    skillsHandlers,
    caldavHandlers,
    localCalendarHandlers,
    voiceCalendarHandlers,
    voiceMailHandlers,
    browserVoiceHandlers,
    integrationHandlers,
    durableMemoryHandlers,
    mailAccountHandlers,
    calendarAccountHandlers,
    connectedCalendarVoiceHandlers,
    dataRetentionHandlers,
    messengerSendHandlers,
    hermesConfigHandlers,
    systemBackupHandlers,
    messengerInboundHandlers,
    taskActionHandlers,
    localReads,
    localResearchReads,
    devHandlers,
    approvalHandlers,
    adapterHandlers,
    domainOpHandlers,
    agentActionHandlers,
    knowledgeActionHandlers,
    automationActionHandlers,
    researchActionHandlers,
    commandHandlers,
    observabilityHandlers,
  ];
  for (const group of overrides) {
    for (const [operationId, handler] of Object.entries(group) as Array<[OperationId, Handler]>) handlers.set(operationId, handler);
  }
  return handlers;
}
