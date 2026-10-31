import type { DashboardNavigation } from "@friday/sdk";

type Listener = (request: DashboardNavigation) => void;

const listeners = new Set<Listener>();

/** The voice service asks the dashboard to open a page or to start the tour. */
export function emitNavigationRequest(request: DashboardNavigation): void {
  for (const listener of [...listeners]) listener(request);
}

/** Subscribes to navigation requests; returns the unsubscribe function. */
export function subscribeNavigationRequests(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
