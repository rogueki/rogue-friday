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

/** Port-backed operations come from `PORT_SPEC`; the explicit handlers add enforcement or are served locally. */
export function buildHandlers(): Map<OperationId, Handler> {
  const handlers = buildPortHandlers();
  const localReads = localCalendarReads(handlers.get("listCalendarEvents")!, handlers.get("getCalendarEvent")!);
  const overrides: Array<Partial<Record<OperationId, Handler>>> = [
    metaHandlers,
    authHandlers,
    settingsHandlers,
    contentStudioHandlers,
    skillsHandlers,
    caldavHandlers,
    localCalendarHandlers,
    voiceCalendarHandlers,
    localReads,
    devHandlers,
    approvalHandlers,
    adapterHandlers,
    domainOpHandlers,
    commandHandlers,
    observabilityHandlers,
  ];
  for (const group of overrides) {
    for (const [operationId, handler] of Object.entries(group) as Array<[OperationId, Handler]>) handlers.set(operationId, handler);
  }
  return handlers;
}
