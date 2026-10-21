import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "@friday/config";
import type { AdapterOverrideStore } from "../db/stores";
import { describe, expect, it, vi } from "vitest";
import { wireAdapters } from "./adapter-wiring";

const ADAPTERS = `allowlist:
  hermes-tasks: "@friday/adapter-hermes"
adapters:
  tasks:
    provider: hermes-tasks
    enabled: true
    config:
      dashboardBaseUrl: http://127.0.0.1:43791
      dashboardAuth: scrape
      boards: [default]
`;

function config(mode: "live" | "hybrid") {
  const dir = mkdtempSync(join(tmpdir(), "friday-wiring-"));
  const configDir = join(dir, "config");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "dashboard.yaml"), `dataMode: ${mode}
server:
  host: 127.0.0.1
  port: 3100
paths:
  dataDir: ../data
  logDir: ../logs
  backupDir: ../backups
  webRoot: ../web
auth:
  mode: local
  ownerUsername: owner
  ownerPasswordHash: env:FRIDAY_OWNER_PASSWORD_HASH
  secureCookies: false
realtime:
  ringBufferSize: 100
  heartbeatSeconds: 15
dev:
  scenarioConsole: false
  responseValidation: true
logging:
  level: error
  file:
    enabled: false
`);
  writeFileSync(join(configDir, "adapters.yaml"), ADAPTERS);
  const loaded = loadConfig({ configDir, cwd: dir, env: { FRIDAY_DATA_MODE: mode, FRIDAY_OWNER_PASSWORD_HASH: "scrypt$1$2$3" } });
  return { loaded, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function wiring(mode: "live" | "hybrid") {
  const { loaded, cleanup } = config(mode);
  const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const overrides = {
    list: () => [{ adapterId: "mock-tasks", category: "tasks", provider: "mock-tasks", enabled: true, config: {}, version: 2 }],
  } as unknown as AdapterOverrideStore;
  const result = wireAdapters({
    config: loaded,
    logger: logger as never,
    hub: { publish: vi.fn() } as never,
    world: mode === "hybrid" ? ({ state: {} } as never) : undefined,
    overrides,
    secrets: { get: () => undefined, has: () => false } as never,
    env: {},
  });
  return { ...result, logger, cleanup };
}

describe("adapter wiring", () => {
  it("ignores a saved mock provider choice in live mode instead of simulating it", () => {
    const { entries, logger, cleanup } = wiring("live");
    try {
      expect(entries.get("tasks")?.provider).toBe("hermes-tasks");
      expect(logger.warn).toHaveBeenCalledWith(
        "Gespeicherte Provider-Wahl wird ignoriert: im Live-Betrieb gibt es keinen Mock-Adapter",
        expect.objectContaining({ category: "tasks", savedProvider: "mock-tasks" }),
      );
    } finally {
      cleanup();
    }
  });

  it("keeps the saved provider choice while a mock world exists", () => {
    const { entries, cleanup } = wiring("hybrid");
    try {
      expect(entries.get("tasks")?.provider).toBe("mock-tasks");
    } finally {
      cleanup();
    }
  });

  it("does not claim a missing build for the built-in mock allowlist in live mode", () => {
    const { logger, cleanup } = wiring("live");
    try {
      const warnings = logger.warn.mock.calls.map((call) => String(call[0]));
      expect(warnings.some((warning) => warning.includes("nicht im Build enthalten"))).toBe(false);
    } finally {
      cleanup();
    }
  });
});