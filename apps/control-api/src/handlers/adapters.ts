import { CONTRACT_VERSION, type ActionResult, type AdapterLogEntry, type Freshness } from "@friday/sdk";
import type { Handler } from "../http/context";
import type { OperationId } from "../http/route-types";
import { ApiError, notFound } from "../util/errors";

const fresh = (): Freshness => ({ state: "fresh", asOf: new Date().toISOString() });

function requireCapability(enabled: boolean, capability: string): void {
  if (!enabled) {
    throw new ApiError({
      code: "CAPABILITY_MISSING",
      message: `Die Fähigkeit ${capability} wird derzeit nicht angeboten.`,
      details: { capability },
    });
  }
}

/** Adapter operations of the System page (PLAN §40.4): restart and logs are served by the control plane itself. */
export const adapterHandlers: Partial<Record<OperationId, Handler>> = {
  async restartAdapter(ctx) {
    const { runtime } = ctx;
    const id = ctx.pathParams.id as string;
    const info = runtime.registry.listAdapters().find((candidate) => candidate.manifest.id === id);
    if (!info) throw notFound("Adapter", id);
    requireCapability(runtime.capabilityEnabled("system.restartAdapter"), "system.restartAdapter");

    ctx.audit.category = "system";
    ctx.audit.action = "adapter.restarted";
    ctx.audit.severity = "warning";
    ctx.audit.adapterId = id;
    ctx.audit.before = { lifecycle: info.health.lifecycle };

    runtime.logger.warn("Adapter wird neu gestartet", { adapterId: id, category: info.manifest.category, requestedBy: ctx.principal?.userId });
    const report = await runtime.registry.restart(id);
    ctx.audit.after = { lifecycle: report.state };
    if (report.error) {
      runtime.logger.error("Adapter nach dem Neustart nicht verfügbar", { adapterId: id, state: report.state, error: report.error.message });
      throw new ApiError({
        code: "ADAPTER_UNAVAILABLE",
        message: `Der Adapter „${info.manifest.name}“ konnte nach dem Neustart nicht gestartet werden: ${report.error.message}`,
        retryable: true,
        details: { adapterId: id, lifecycle: report.state },
      });
    }
    runtime.logger.info("Adapter neu gestartet", { adapterId: id, state: report.state });
    // Capabilities and health changed with the new instance; clients get them through the registry's events.
    const body: ActionResult = {
      contractVersion: CONTRACT_VERSION,
      accepted: true,
      status: "completed",
      correlationId: ctx.correlationId,
      resourceId: id,
      message: `Adapter „${info.manifest.name}“ wurde neu gestartet (${report.state}).`,
    };
    return { status: 200, body };
  },

  async getAdapterLogs(ctx) {
    const { runtime } = ctx;
    const id = ctx.pathParams.id as string;
    const info = runtime.registry.listAdapters().find((candidate) => candidate.manifest.id === id);
    if (!info) throw notFound("Adapter", id);
    requireCapability(runtime.capabilityEnabled("system.openLogs"), "system.openLogs");
    const limit = typeof ctx.query.limit === "number" ? ctx.query.limit : undefined;
    const level = ctx.query.level as AdapterLogEntry["level"] | undefined;
    const items = runtime.logBuffer.query(
      { id, category: info.manifest.category },
      { ...(limit !== undefined ? { limit } : {}), ...(level ? { level } : {}) },
    );
    return {
      status: 200,
      body: {
        contractVersion: CONTRACT_VERSION,
        items,
        freshness: fresh(),
        sources: [{ adapterId: "control-api", system: "control-api", lastSyncedAt: new Date().toISOString() }],
      },
    };
  },
};
