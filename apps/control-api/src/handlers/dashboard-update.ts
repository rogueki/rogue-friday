import type { DashboardUpdateInstallRequest } from "@friday/sdk";
import type { Handler } from "../http/context";
import type { OperationId } from "../http/route-types";
import type { DashboardUpdateStatus } from "../services/dashboard-update";
import { conflict } from "../util/errors";

const NO_STORE = { "Cache-Control": "no-store" };

/** The process identity in `progress` is for liveness checks on the server only. */
function publicStatus(status: DashboardUpdateStatus): DashboardUpdateStatus {
  if (!status.progress) return status;
  const { pid: _pid, processStartedAt: _started, ...progress } = status.progress;
  return { ...status, progress };
}

// No contract envelope: an already open, older dashboard keeps polling this status while the update replaces the server.
export const dashboardUpdateHandlers: Partial<Record<OperationId, Handler>> = {
  async getDashboardUpdateStatus(ctx) {
    return { status: 200, headers: NO_STORE, body: publicStatus(await ctx.runtime.dashboardUpdates.status(ctx.query.refresh === "1")) };
  },
  async installDashboardUpdate(ctx) {
    const { commit } = ctx.body as DashboardUpdateInstallRequest;
    try { await ctx.runtime.dashboardUpdates.install(commit); }
    catch (error) { throw conflict(error instanceof Error ? error.message : "Update konnte nicht gestartet werden."); }
    ctx.audit.action = "system.dashboard_update_started";
    ctx.audit.after = { commit };
    return { status: 202, headers: NO_STORE, body: { accepted: true, commit } };
  },
};
