import { CONTRACT_VERSION, type Freshness, type ScenarioControlRequest } from "@friday/sdk";
import type { ScenarioEngine } from "@friday/mock-data";
import type { Handler, RequestContext } from "../http/context";
import type { OperationId } from "../http/route-types";
import { ApiError, notFound } from "../util/errors";
import { localList } from "./meta";

const fresh = (): Freshness => ({ state: "fresh", asOf: new Date().toISOString() });

/** The scenario console exists only with mock data and `dev.scenarioConsole`; everywhere else it is simply not there. */
function engineOf(ctx: RequestContext): ScenarioEngine {
  const { engine, config } = ctx.runtime;
  if (!engine || !config.dev.scenarioConsole || !ctx.runtime.settings.area("developer").scenarioConsole) throw notFound("Szenario-Konsole");
  return engine;
}

export const devHandlers: Partial<Record<OperationId, Handler>> = {
  async listScenarios(ctx) {
    const engine = engineOf(ctx);
    return { status: 200, body: localList(ctx, engine.list(), [{ adapterId: "control-api", system: "mock", lastSyncedAt: new Date().toISOString() }]) };
  },

  async playScenario(ctx) {
    const engine = engineOf(ctx);
    // `speed` is an optional extension of the contract (query parameter) used by `pnpm scenario play --speed`.
    const speed = Number(ctx.rawQuery.get("speed") ?? "1");
    const state = engine.play(ctx.pathParams.id as string, { speed: Number.isFinite(speed) && speed > 0 ? speed : 1 });
    ctx.audit.action = "dev.scenario_played";
    ctx.audit.after = { scenarioId: state.activeScenarioId, speed };
    await ctx.runtime.refreshAdapters();
    return { status: 200, body: { contractVersion: CONTRACT_VERSION, data: state, freshness: fresh() } };
  },

  async controlScenario(ctx) {
    const engine = engineOf(ctx);
    const request = ctx.body as ScenarioControlRequest;
    let state;
    try {
      state = engine.control(request);
    } catch (error) {
      // Keep the field-level details of the mock's validation errors (unknown event type, payload violates its schema).
      if (ctx.runtime.simulation?.isApiError(error)) throw new ApiError({ code: error.code, message: error.message, details: error.details });
      throw error;
    }
    ctx.audit.action = `dev.${request.action}`;
    ctx.audit.after = { ...request };
    if (request.action === "reset") ctx.runtime.db.prepare("DELETE FROM native_approval_requests").run();
    // Availability/capability changes reach the registry through health checks; make the response consistent with them.
    await ctx.runtime.refreshAdapters();
    return { status: 200, body: { contractVersion: CONTRACT_VERSION, data: state, freshness: fresh() } };
  },

  async getScenarioState(ctx) {
    return { status: 200, body: { contractVersion: CONTRACT_VERSION, data: engineOf(ctx).getState(), freshness: fresh() } };
  },
};
