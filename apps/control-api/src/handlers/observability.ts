import { CONTRACT_VERSION, type FrontendTelemetryBatch, type Freshness } from "@jarvis/sdk";
import type { Handler } from "../http/context";
import type { OperationId } from "../http/route-types";

const fresh = (): Freshness => ({ state: "fresh", asOf: new Date().toISOString() });

/** Prometheus text exposition format 0.0.4. */
const PROMETHEUS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

export const observabilityHandlers: Partial<Record<OperationId, Handler>> = {
  async getMetrics(ctx) {
    return { status: 200, raw: { contentType: PROMETHEUS_CONTENT_TYPE, data: ctx.runtime.renderMetrics() } };
  },

  async submitFrontendTelemetry(ctx) {
    const batch = ctx.body as FrontendTelemetryBatch;
    // The principal is always present here (the pipeline rejects anonymous callers before the handler runs).
    const sessionKey = ctx.principal?.session.idHash ?? ctx.ip;
    const receipt = ctx.runtime.telemetry.ingest(sessionKey, batch);
    return { status: 202, body: { contractVersion: CONTRACT_VERSION, data: receipt, freshness: fresh() } };
  },
};
