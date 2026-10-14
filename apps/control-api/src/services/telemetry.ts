import { redactString, type JarvisMetrics, type Logger } from "@jarvis/observability";
import type { FrontendTelemetryBatch, FrontendTelemetryReceipt } from "@jarvis/sdk";
import { ApiError } from "../util/errors";

export interface TelemetryLimits {
  /** Batches one session may send per window. */
  maxBatches: number;
  windowMs: number;
}

export const DEFAULT_TELEMETRY_LIMITS: TelemetryLimits = { maxBatches: 30, windowMs: 60_000 };

const URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s)'"]+/gi;
/** Phone-number- and account-number-like digit runs (PLAN §50.4: no personal data in telemetry). */
const NUMBER_PATTERN = /\+?\d[\d\s/().-]{7,}\d/g;

/** Browser error text may echo user input or URLs; only a scrubbed, shortened message ever reaches logs. */
export function scrubTelemetryMessage(message: string): string {
  const scrubbed = redactString(message.replace(URL_PATTERN, "[URL]").replace(NUMBER_PATTERN, "[NUMBER]"), { redactEmails: true });
  return scrubbed.replace(/\s+/g, " ").trim().slice(0, 300);
}

/**
 * Receives frontend errors and orb performance samples (PLAN §50.3). Only aggregated metrics (error kind counters, orb
 * gauges) and a scrubbed log line per error are kept; raw messages are never stored or exported.
 */
export class FrontendTelemetryService {
  private readonly windows = new Map<string, number[]>();

  constructor(
    private readonly metrics: JarvisMetrics,
    private readonly logger: Logger,
    private readonly limits: TelemetryLimits = DEFAULT_TELEMETRY_LIMITS,
    private readonly now: () => number = Date.now,
  ) {}

  ingest(sessionKey: string, batch: FrontendTelemetryBatch): FrontendTelemetryReceipt {
    this.consume(sessionKey);
    const errors = batch.errors ?? [];
    const samples = batch.orbSamples ?? [];
    this.metrics.recordFrontendReport({
      errors: errors.map((error) => ({ kind: error.kind, count: error.count ?? 1 })),
      orbSamples: samples.map((sample) => ({
        fps: sample.fps,
        frameTimeMs: sample.frameTimeMs,
        ...(sample.webglMemoryBytes !== undefined ? { webglMemoryBytes: sample.webglMemoryBytes } : {}),
      })),
    });
    for (const error of errors) {
      this.logger.warn("Frontend-Fehler gemeldet", {
        kind: error.kind,
        errorMessage: scrubTelemetryMessage(error.message),
        count: error.count ?? 1,
        ...(error.route ? { route: error.route } : {}),
      });
    }
    return { acceptedErrors: errors.length, acceptedOrbSamples: samples.length };
  }

  private consume(sessionKey: string): void {
    const now = this.now();
    const stamps = (this.windows.get(sessionKey) ?? []).filter((stamp) => stamp > now - this.limits.windowMs);
    if (stamps.length >= this.limits.maxBatches) {
      this.windows.set(sessionKey, stamps);
      const retryAfter = Math.max(1, Math.ceil(((stamps[0] ?? now) + this.limits.windowMs - now) / 1000));
      throw new ApiError({
        code: "RATE_LIMITED",
        message: "Zu viele Telemetrie-Berichte. Bitte später erneut senden.",
        details: { retryAfterSeconds: retryAfter },
        headers: { "Retry-After": String(retryAfter) },
      });
    }
    stamps.push(now);
    this.windows.set(sessionKey, stamps);
    if (this.windows.size > 1000) {
      for (const [key, list] of this.windows) if (list.every((stamp) => stamp <= now - this.limits.windowMs)) this.windows.delete(key);
    }
  }
}
