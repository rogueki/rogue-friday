import type {
  HealthcheckResult,
  ModelProvider,
  Service,
  StorageVolume,
  SystemMetrics,
} from "@jarvis/sdk";
import { notFound } from "../../core/errors";
import { compareAsc, type Page } from "../../core/util";
import type { MockWorld } from "../world";
import type { OpContext } from "../types";
import { pageOf, type Query } from "./shared";

export class SystemService {
  constructor(private readonly w: MockWorld) {}

  /** Metrics sampled for "now" (deterministic for a given clock time and load). */
  getMetrics(): SystemMetrics {
    return this.w.read("getSystemMetrics", () => {
      const metrics = this.w.currentMetrics();
      this.w.state.system.metrics = metrics;
      return structuredClone(metrics);
    });
  }

  listServices(query: Query<"listServices"> = {}): Page<Service> {
    return this.w.read("listServices", () => pageOf([...this.w.state.system.services].sort((a, b) => compareAsc(a.name, b.name)), query));
  }

  listStorage(query: Query<"listStorageVolumes"> = {}): Page<StorageVolume> {
    return this.w.read("listStorageVolumes", () => pageOf(this.w.state.system.storage, query));
  }

  listModels(query: Query<"listModelProviders"> = {}): Page<ModelProvider> {
    return this.w.read("listModelProviders", () => pageOf(this.w.state.system.models, query));
  }

  findService(id: string): Service {
    const service = this.w.state.system.services.find((candidate) => candidate.id === id);
    if (!service) throw notFound("Dienst", id);
    return service;
  }

  healthcheck(id: string, ctx?: OpContext): HealthcheckResult {
    return this.w.run("runServiceHealthcheck", ctx, { id }, () => {
      const service = this.findService(id);
      const now = this.w.nowIso();
      const correlationId = this.w.correlationId(ctx);
      const status = service.status;
      const latencyMs = status === "offline" ? null : Math.max(1, Math.round((service.latencyMs ?? 20) * (0.9 + this.w.rng.next() * 0.2)));
      service.lastCheckAt = now;
      service.latencyMs = latencyMs;
      if (status === "online" || status === "degraded") service.lastSuccessAt = now;
      service.updatedAt = now;
      this.w.emitFor("system", "jarvis.system.service_status_changed", service, `service/${service.id}`, correlationId);
      this.w.recordAudit({
        category: "user_action",
        action: "service.healthcheck",
        severity: status === "online" ? "info" : "warning",
        correlationId,
        adapterId: "mock-system",
        actor: this.w.actorOf(ctx),
        durationMs: latencyMs ?? 0,
        context: { service: service.name, status },
      });
      return {
        serviceId: service.id,
        status,
        latencyMs,
        checkedAt: now,
        message:
          status === "online"
            ? `${service.name} antwortet normal (${latencyMs} ms).`
            : status === "degraded"
              ? `${service.name} antwortet verzögert (${latencyMs} ms). ${service.detail ?? ""}`.trim()
              : `${service.name} ist nicht erreichbar.`,
        correlationId,
      };
    });
  }

  /** Publishes the current metrics as `jarvis.system.metrics` (used by telemetry). */
  publishMetrics(): void {
    const metrics = this.w.currentMetrics();
    this.w.state.system.metrics = metrics;
    this.w.emitFor("system", "jarvis.system.metrics", metrics, "system/metrics");
  }

  /** Simulation hook: changes the status of a monitored service and publishes the change. */
  setServiceStatus(name: string, status: Service["status"], detail?: string): Service {
    const service = this.w.state.system.services.find((candidate) => candidate.name === name);
    if (!service) throw notFound("Dienst", name);
    service.status = status;
    service.latencyMs = status === "offline" ? null : service.latencyMs ?? 40;
    if (detail) service.detail = detail;
    service.updatedAt = this.w.nowIso();
    service.lastCheckAt = service.updatedAt;
    if (status === "online") service.lastSuccessAt = service.updatedAt;
    this.w.emitFor("system", "jarvis.system.service_status_changed", service, `service/${service.id}`);
    this.w.refresh();
    return service;
  }
}
