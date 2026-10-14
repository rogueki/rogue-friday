import type { AdapterHealth } from "@jarvis/sdk";
import { toIso, type Clock } from "./clock";
import { AdapterError, normalizeError } from "./errors";
import { toContractLifecycle, toHealthStatus, type AdapterLifecycleMachine } from "./lifecycle";
import type { Logger } from "./logger";
import { withTimeout, type CircuitBreaker } from "./resilience";
import type { AdapterEventInput, AdapterHealthReport, CapabilitySet, JarvisAdapter } from "./types";

export interface HealthMonitorOptions {
  adapterId: string;
  adapter: Pick<JarvisAdapter, "healthCheck" | "getCapabilities">;
  lifecycle: AdapterLifecycleMachine;
  clock: Clock;
  logger: Logger;
  emit: (event: AdapterEventInput) => void;
  /** Called when the capability set differs from the previous successful check (recovery, upstream feature changes). */
  onCapabilitiesChanged?: (capabilities: CapabilitySet) => void;
  breaker?: CircuitBreaker;
  /** Poll interval. Default 15 000 ms. */
  intervalMs?: number;
  /** Deadline of one `healthCheck()`. Default 5 000 ms. */
  checkTimeoutMs?: number;
  /** Consecutive failed checks before an ONLINE/DEGRADED adapter is declared OFFLINE. Default 3. */
  failureThreshold?: number;
  /** An online report slower than this counts as DEGRADED. Default 3 000 ms. */
  degradedLatencyMs?: number;
}

/**
 * Polls `healthCheck()` on an interval, keeps latency / last success / last error / consecutive failures, drives the
 * lifecycle (ONLINE <-> DEGRADED -> OFFLINE -> RECOVERING -> ONLINE) and emits `jarvis.adapter.health_changed` and
 * `jarvis.adapter.capabilities_changed` only when something actually changed.
 */
export class HealthMonitor {
  private readonly intervalMs: number;
  private readonly checkTimeoutMs: number;
  private readonly failureThreshold: number;
  private readonly degradedLatencyMs: number;
  private cancelTimer: (() => void) | undefined;
  private running = false;
  private inFlight: Promise<AdapterHealth> | undefined;
  private lastEmittedKey: string | undefined;
  private lastCapabilities: string | undefined;

  private latencyMs: number | null = null;
  private lastSuccessAt: string | null = null;
  private lastError: { code: string; message: string } | null = null;
  private checkedAt: string;
  private consecutiveFailures = 0;

  constructor(private readonly options: HealthMonitorOptions) {
    this.intervalMs = options.intervalMs ?? 15_000;
    this.checkTimeoutMs = options.checkTimeoutMs ?? 5_000;
    this.failureThreshold = options.failureThreshold ?? 3;
    this.degradedLatencyMs = options.degradedLatencyMs ?? 3_000;
    this.checkedAt = toIso(options.clock);
  }

  /** Contract-shaped snapshot of the last known health. */
  snapshot(): AdapterHealth {
    return {
      adapterId: this.options.adapterId,
      status: toHealthStatus(this.options.lifecycle.state),
      lifecycle: toContractLifecycle(this.options.lifecycle.state),
      latencyMs: this.latencyMs,
      lastSuccessAt: this.lastSuccessAt,
      lastError: this.lastError,
      checkedAt: this.checkedAt,
      consecutiveFailures: this.consecutiveFailures,
      circuit: this.options.breaker?.state ?? "closed",
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule();
  }

  stop(): void {
    this.running = false;
    this.cancelTimer?.();
    this.cancelTimer = undefined;
  }

  /** Runs one check now (shares the in-flight check if one is running). */
  checkNow(): Promise<AdapterHealth> {
    this.inFlight ??= this.runCheck().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private schedule(): void {
    this.cancelTimer = this.options.clock.setTimeout(() => {
      if (!this.running) return;
      this.checkNow()
        .catch((error: unknown) =>
          this.options.logger.error("Health-Check fehlgeschlagen", { error: normalizeError(error).message }),
        )
        .finally(() => {
          if (this.running) this.schedule();
        });
    }, this.intervalMs);
  }

  private async runCheck(): Promise<AdapterHealth> {
    const { lifecycle, clock, adapter } = this.options;
    const before = lifecycle.state;
    if (before === "UNREGISTERED" || before === "STOPPING" || before === "STOPPED") return this.snapshot();
    if (before === "OFFLINE") lifecycle.transition("RECOVERING", "health probe");

    const report = await this.probe(adapter);
    this.checkedAt = toIso(clock);
    this.latencyMs = report.latencyMs;

    const slow =
      report.status === "online" && report.latencyMs !== null && report.latencyMs > this.degradedLatencyMs;
    const success = report.status === "online" || report.status === "degraded";

    if (success) {
      this.consecutiveFailures = 0;
      this.lastSuccessAt = this.checkedAt;
      const degraded = report.status === "degraded" || slow;
      this.lastError = degraded
        ? {
            code: report.errorCode ?? (slow ? "ADAPTER_TIMEOUT" : "DEGRADED"),
            message: report.message ?? "Eingeschränkte Leistung.",
          }
        : null;
      this.moveTo(degraded ? "DEGRADED" : "ONLINE", report.message ?? "health check");
    } else {
      this.consecutiveFailures += 1;
      this.lastError = {
        code: report.errorCode ?? "ADAPTER_UNAVAILABLE",
        message: report.message ?? "Fremdsystem nicht erreichbar.",
      };
      const state = lifecycle.state;
      const hardDown =
        state === "INITIALIZING" ||
        state === "RECOVERING" ||
        state === "OFFLINE" ||
        this.consecutiveFailures >= this.failureThreshold;
      this.moveTo(hardDown ? "OFFLINE" : "DEGRADED", this.lastError.message);
    }

    // Every successful check re-reads the capability set, so upstream feature changes surface without a restart.
    if (success) await this.refreshCapabilities();
    this.emitIfChanged();
    return this.snapshot();
  }

  private async probe(adapter: Pick<JarvisAdapter, "healthCheck">): Promise<AdapterHealthReport> {
    const started = this.options.clock.now();
    try {
      const report = await withTimeout(() => adapter.healthCheck(), {
        timeoutMs: this.checkTimeoutMs,
        clock: this.options.clock,
        operation: "healthCheck",
      });
      return { ...report, latencyMs: report.latencyMs ?? this.options.clock.now() - started };
    } catch (raw) {
      // healthCheck() must not throw; if it does, the adapter is treated as down rather than crashing the monitor.
      const error = normalizeError(raw, { operation: "healthCheck" });
      this.options.logger.warn("healthCheck() hat einen Fehler geworfen", { code: error.code });
      return { status: "offline", latencyMs: null, message: error.message, errorCode: error.code };
    }
  }

  private moveTo(target: "ONLINE" | "DEGRADED" | "OFFLINE", reason: string): void {
    const { lifecycle } = this.options;
    if (lifecycle.state === target) return;
    if (!lifecycle.canTransition(target)) {
      // Races with shutdown (STOPPING) are expected; anything else is a bug worth surfacing.
      if (lifecycle.state === "STOPPING" || lifecycle.state === "STOPPED") return;
      throw new AdapterError({
        code: "INTERNAL",
        message: `Lifecycle ${lifecycle.state} -> ${target} nicht erlaubt.`,
        retryable: false,
      });
    }
    lifecycle.transition(target, reason);
  }

  private async refreshCapabilities(): Promise<void> {
    try {
      const capabilities = await this.options.adapter.getCapabilities();
      const key = JSON.stringify([...capabilities.capabilities].sort());
      if (this.lastCapabilities !== undefined && key === this.lastCapabilities) return;
      const initial = this.lastCapabilities === undefined;
      this.lastCapabilities = key;
      if (!initial) this.options.onCapabilitiesChanged?.(capabilities);
    } catch (error) {
      this.options.logger.warn("getCapabilities() fehlgeschlagen", { error: normalizeError(error).message });
    }
  }

  /** Seeds the baseline so that the first refresh after init is not reported as a change. */
  rememberCapabilities(capabilities: CapabilitySet): void {
    this.lastCapabilities = JSON.stringify([...capabilities.capabilities].sort());
  }

  /** Records a failure that happened outside a health check (e.g. initialization), so `snapshot().lastError` explains OFFLINE. */
  setFailure(failure: { code: string; message: string }): void {
    this.lastError = failure;
    this.consecutiveFailures += 1;
    this.checkedAt = toIso(this.options.clock);
  }

  /** Emits `health_changed` when lifecycle, status, circuit or error differ from the last emitted state. */
  notifyChange(): void {
    this.emitIfChanged();
  }

  private emitIfChanged(): void {
    const health = this.snapshot();
    const key = [health.status, health.lifecycle, health.circuit, health.lastError?.code ?? ""].join("|");
    if (key === this.lastEmittedKey) return;
    this.lastEmittedKey = key;
    this.options.emit({
      type: "jarvis.adapter.health_changed",
      subject: `adapter/${this.options.adapterId}`,
      data: health,
    });
  }
}
