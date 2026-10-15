import { CONTRACT_VERSION, type AdapterInfo, type Freshness, type Health, type HealthStatus, type Meta, type PageInfo } from "@jarvis/sdk";
import { EVENTS_PATH } from "../realtime/hub";
import type { Handler, RequestContext } from "../http/context";
import type { OperationId } from "../http/route-types";
import { ApiError } from "../util/errors";

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
    const devScenarios = Boolean(ctx.runtime.engine) && config.dev.scenarioConsole;
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
    const { runtime } = ctx;
    const base = runtime.status.health();
    const hubStats = runtime.hub.stats();
    let dbOk = true;
    try {
      runtime.db.prepare("SELECT 1").get();
    } catch {
      dbOk = false;
    }
    const chain = runtime.audit.verification();
    const components: Health["components"] = [
      ...base.components,
      { id: "event-stream", name: `Event Stream (${hubStats.clients} Clients, Sequenz ${hubStats.latestSequence})`, status: "online", latencyMs: null },
      { id: "database", name: "SQLite", status: dbOk ? "online" : "offline", latencyMs: null },
      { id: "audit-chain", name: `Audit-Hashkette (${chain.length} Einträge${chain.valid ? "" : ", beschädigt"})`, status: chain.valid ? "online" : "offline", latencyMs: null },
    ];
    let status: HealthStatus = base.status;
    if (!dbOk || !chain.valid) status = "degraded";
    return { status: 200, body: { ...base, status, components } satisfies Health };
  },

  async getCapabilities(ctx) {
    return { status: 200, body: ctx.runtime.capabilities() };
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
