import { AdapterError } from "@friday/adapter-core";
import type { AdapterInfo } from "@friday/sdk";
import { describe, expect, it } from "vitest";
import { sectionStatusOf } from "../src/services/core-views";

const info = (status: "online" | "degraded" | "offline"): AdapterInfo => ({ health: { status } }) as AdapterInfo;
const unavailable = (details: Record<string, unknown> = {}) => new AdapterError({ code: "ADAPTER_UNAVAILABLE", message: "x", details });

describe("overview section status of a failed call", () => {
  it("is offline for a refused connection or an open circuit breaker while the health monitor still says degraded (voice outage)", () => {
    // Regression: health lags (15 s cadence, 3 failed checks) so the same outage flipped offline -> degraded -> offline.
    expect(sectionStatusOf(unavailable(), info("degraded"))).toBe("offline");
    expect(sectionStatusOf(unavailable({ circuit: "open", retryAfterMs: 4000 }), info("degraded"))).toBe("offline");
    expect(sectionStatusOf(unavailable(), info("online"))).toBe("offline");
    expect(sectionStatusOf(unavailable(), undefined)).toBe("offline");
  });

  it("stays degraded for timeouts and for a reachable upstream that answers with errors", () => {
    expect(sectionStatusOf(new AdapterError({ code: "ADAPTER_TIMEOUT", message: "x" }), info("online"))).toBe("degraded");
    expect(sectionStatusOf(unavailable({ upstreamStatus: 503 }), info("degraded"))).toBe("degraded");
    expect(sectionStatusOf(unavailable({ upstreamStatus: 503 }), info("offline"))).toBe("offline");
  });
});
