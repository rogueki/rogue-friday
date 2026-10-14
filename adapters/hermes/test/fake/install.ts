import type { FakeUpstream } from "@jarvis/adapter-testkit";
import { apiRoutes, dashboardRoutes } from "./routes";
import { HermesState } from "./state";

/**
 * Installs Fake A (API server) and Fake B (dashboard) on ONE testkit upstream. The paths do not overlap, so a single
 * origin can serve both base URLs. The suite's secrets are random canaries, therefore credentials are not checked here
 * (authentication is covered by the adapter tests against the standalone fake).
 */
export function installHermes(upstream: FakeUpstream, seed: (state: HermesState) => void): HermesState {
  const state = new HermesState();
  state.acceptAnyCredentials = true;
  state.sessionPageSize = 200;
  seed(state);
  for (const def of [...dashboardRoutes(state), ...apiRoutes(state)]) {
    upstream.route(def.method, def.pattern, def.handler);
  }
  return state;
}
