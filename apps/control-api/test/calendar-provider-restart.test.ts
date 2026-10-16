import { describe, expect, it } from "vitest";
import { noopLogger } from "@friday/adapter-core";
import type { FridayConfig } from "@friday/config";
import type { Logger } from "@friday/observability";
import type { AdapterOverrideStore } from "../src/db/stores";
import type { EventHub } from "../src/realtime/hub";
import { createRuntimeSecrets, wireAdapters } from "../src/runtime/adapter-wiring";

function calendarProvider(mode: "mock" | "hybrid", savedProvider: string): string | undefined {
  const config = {
    dataMode: mode,
    allowlist: { "caldav-calendar": "@friday/adapter-calendar-placeholder" },
    adapters: {
      calendar: {
        provider: "mock-calendar", enabled: true, config: {},
        timeoutMs: 5000, retry: false, circuitBreaker: false,
      },
    },
  } as unknown as FridayConfig;
  const overrides = {
    list: () => [{ adapterId: "caldav-calendar", category: "calendar", provider: savedProvider, enabled: true, config: {}, version: 2 }],
  } as unknown as AdapterOverrideStore;
  const wiring = wireAdapters({
    config, overrides, secrets: createRuntimeSecrets(), world: undefined,
    logger: noopLogger as unknown as Logger,
    hub: { publish() {} } as unknown as EventHub,
    env: {},
  });
  return wiring.entries.get("calendar")?.provider;
}

describe("saved calendar provider", () => {
  it("restores explicitly selected ICS in installed hybrid mode, retaining mock in mock mode", () => {
    expect(calendarProvider("hybrid", "caldav-calendar")).toBe("caldav-calendar");
    expect(calendarProvider("mock", "caldav-calendar")).toBe("mock-calendar");
  });
});
