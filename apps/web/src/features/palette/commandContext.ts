import type { CommandRequest } from "@friday/sdk";

type ActiveSelection = { route: string; selectedIds: readonly string[]; owner: object };
let activeSelection: ActiveSelection | null = null;

/** Registers page-local selection for the global command surface; callers must unregister on unmount/change. */
export function registerCommandSelection(route: string, selectedIds: readonly string[]): () => void {
  const owner = {};
  activeSelection = { route, selectedIds: [...selectedIds], owner };
  return () => {
    if (activeSelection?.owner === owner) activeSelection = null;
  };
}

/** Builds fresh request context at send/confirm time so route or selection changes invalidate a preview. */
export function commandContextForRoute(route: string): NonNullable<CommandRequest["context"]> {
  const selectedIds = activeSelection?.route === route ? [...activeSelection.selectedIds] : [];
  return { route, ...(selectedIds.length > 0 ? { selectedIds } : {}) };
}

export function needsCommandClarification(details: Record<string, unknown>): boolean {
  return details.clarificationRequired === true;
}
