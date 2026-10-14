import type { Handler } from "../http/context";
import type { OperationId } from "../http/route-types";
import { approvalHandlers } from "./approvals";
import { authHandlers } from "./auth";
import { commandHandlers } from "./commands";
import { devHandlers } from "./dev";
import { metaHandlers } from "./meta";
import { buildPortHandlers } from "./ports";
import { settingsHandlers } from "./settings";

/** Port-backed operations come from `PORT_SPEC`; the explicit handlers add enforcement or are served locally. */
export function buildHandlers(): Map<OperationId, Handler> {
  const handlers = buildPortHandlers();
  const overrides: Array<Partial<Record<OperationId, Handler>>> = [
    metaHandlers,
    authHandlers,
    settingsHandlers,
    devHandlers,
    approvalHandlers,
    commandHandlers,
  ];
  for (const group of overrides) {
    for (const [operationId, handler] of Object.entries(group) as Array<[OperationId, Handler]>) handlers.set(operationId, handler);
  }
  return handlers;
}
