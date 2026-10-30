import type { Health, HealthStatus } from "@friday/sdk";
import type { Runtime } from "../runtime/types";

/** Component view of GET /api/v1/health; the spoken status read uses the same snapshot. */
export function healthSnapshot(runtime: Runtime): Health {
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
  return { ...base, status, components } satisfies Health;
}
