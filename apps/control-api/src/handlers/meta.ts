import { CONTRACT_VERSION, type AdapterInfo, type Freshness, type Meta, type PageInfo } from "@friday/sdk";
import { EVENTS_PATH } from "../realtime/hub";
import type { Handler, RequestContext } from "../http/context";
import type { OperationId } from "../http/route-types";
import { ApiError } from "../util/errors";
import { healthSnapshot } from "../services/health-snapshot";
import { voiceIntegrationStatus } from "../services/integration-status";

const fresh = (): Freshness => ({ state: "fresh", asOf: new Date().toISOString() });

/** Cursor pagination for lists the Control API assembles itself (adapters, themes, scenarios, ...). */
export function paginateLocal<T>(items: readonly T[], query: Record<string, unknown>): { items: T[]; pageInfo: PageInfo } {
  const limit = typeof query.limit === "number" ? query.limit : 50;
  let offset = 0;
  if (typeof query.cursor === "string" && query.cursor.length > 0) {
    if (!/^c[0-9a-z]+$/.test(query.cursor)) {
      throw new ApiError({ code: "VALIDATION_FAILED", status: 400, message: "Ungültiger Cursor.", details: { fieldErrors: [{ path: "cursor", message: "unbekanntes Format" }] } });
    }
    offset = parseInt(query.cursor.slice(1), 36);
  }
  const slice = items.slice(offset, offset + limit);
  const end = offset + slice.length;
  const hasNextPage = end < items.length;
  return { items: slice, pageInfo: { nextCursor: hasNextPage ? `c${end.toString(36)}` : null, hasNextPage, totalCount: items.length } };
}

export function localList<T>(ctx: RequestContext, items: readonly T[], sources = [{ adapterId: "control-api", system: "control-api", lastSyncedAt: new Date().toISOString() }]) {
  const page = paginateLocal(items, ctx.query);
  return { contractVersion: CONTRACT_VERSION, items: page.items, pageInfo: page.pageInfo, freshness: fresh(), sources };
}

export function mockAwareAdapterInfo(info: AdapterInfo): AdapterInfo {
  // The registry labels everything but exactly-mock factories "live"; mock providers also run in hybrid mode.
  return { ...info, mode: info.provider.startsWith("mock-") ? "mock" : "live" };
}

export const metaHandlers: Partial<Record<OperationId, Handler>> = {
  async getMeta(ctx) {
    const { config } = ctx.runtime;
    const scenarioControls = Boolean(ctx.runtime.engine) && config.dev.scenarioConsole;
    const devScenarios = scenarioControls && ctx.runtime.settings.area("developer").scenarioConsole;
    const meta: Meta = {
      contractVersion: CONTRACT_VERSION,
      apiVersion: "v1",
      dataMode: config.dataMode,
      eventsPath: EVENTS_PATH,
      buildVersion: ctx.runtime.buildVersion,
      features: {
        // Scenario-driven UI hints of the mock world (forceOrbFallback2D, reducedMotion) first, so they can never shadow a core flag.
        ...(ctx.runtime.world?.state.uiHints ?? {}),
        devScenarios,
        scenarioControls,
        mockData: config.dataMode !== "live",
        eventReplay: true,
        devAuth: config.auth.mode === "dev",
        rawJsonView: ctx.runtime.settings.area("developer").showRawJson,
      },
      serverTime: new Date().toISOString(),
      defaultLocale: ctx.runtime.settings.area("profile").locale,
    };
    return { status: 200, body: meta };
  },

  async getHealth(ctx) {
    return { status: 200, body: healthSnapshot(ctx.runtime) };
  },

  async getCapabilities(ctx) {
    const status = await voiceIntegrationStatus(ctx.runtime, ctx.call);
    return { status: 200, body: { ...ctx.runtime.capabilities(), integrations: [{
      id: "voice", contractVersion: CONTRACT_VERSION, actions: [], settingsArea: "voice", requires: ["friday-voice-http"],
      roles: ["viewer", "operator", "owner"], availability: status.connected ? "available" : status.configured ? "offline" : "needs_setup",
      reasonCode: status.errorCode,
    }] } };
  },

  async listAdapters(ctx) {
    const infos = ctx.runtime.registry.listAdapters().map(mockAwareAdapterInfo);
    return { status: 200, body: localList(ctx, infos) };
  },

  async getAdapterHealth(ctx) {
    const health = ctx.runtime.registry.getHealth(ctx.pathParams.id as string);
    return { status: 200, body: { contractVersion: CONTRACT_VERSION, data: health, freshness: fresh() } };
  },

  async getOverview(ctx) {
    const { overview, failedSections } = await ctx.runtime.overview.build(ctx.call);
    const freshness: Freshness = { state: failedSections > 0 ? "stale" : "fresh", asOf: overview.lastUpdatedAt };
    return { status: 200, body: { contractVersion: CONTRACT_VERSION, data: overview, freshness } };
  },

  async getStatus(ctx) {
    return { status: 200, body: { contractVersion: CONTRACT_VERSION, data: ctx.runtime.status.get(), freshness: fresh() } };
  },

  async getOrbStatus(ctx) {
    const snapshot = await ctx.runtime.orb.snapshot(ctx.call);
    return { status: 200, body: { contractVersion: CONTRACT_VERSION, data: snapshot, freshness: fresh() } };
  },
};
