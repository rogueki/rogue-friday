import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApi, type ApiClient, type TestApi } from "./helpers";

describe("developer controls", () => {
  let api: TestApi;
  let owner: ApiClient;
  const logs: string[] = [];

  beforeAll(async () => {
    api = await startTestApi({ logs, scenarioConsole: true });
    owner = api.client();
    await owner.loginDev("owner");
  });
  afterAll(async () => api.close());

  it("applies verbosity and safe debug diagnostics; scenario setting gates the real mock console", async () => {
    const current = (await owner.get("/api/v1/settings")).json().data;
    const developer = { ...current.developer, debugMode: true, showRawJson: true, scenarioConsole: false, orbPerfOverlay: true, logLevel: "debug" };
    const saved = await owner.patch("/api/v1/settings", { developer }, { headers: { "if-match": String(current.version) } });
    expect(saved.statusCode).toBe(200);
    expect(api.runtime.logger.level).toBe("debug");

    const meta = (await owner.get("/api/v1/meta")).json();
    expect(meta.features).toMatchObject({ rawJsonView: true, scenarioControls: true, devScenarios: false });
    expect((await owner.get("/api/v1/dev/scenarios")).statusCode).toBe(404);

    const diagnostics = logs.map((line) => JSON.parse(line) as Record<string, unknown>).filter((entry) => entry.message === "request diagnostic");
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.find((entry) => entry.operationId === "getMeta")).toMatchObject({ level: "debug", correlationId: expect.stringMatching(/^corr_/) });
    const diagnosticText = JSON.stringify(diagnostics);
    expect(diagnosticText).not.toContain("userId");
    expect(diagnosticText).not.toContain("127.0.0.1");

    const latest = (await owner.get("/api/v1/settings")).json().data;
    const reenabled = await owner.patch("/api/v1/settings", { developer: { ...latest.developer, scenarioConsole: true, debugMode: false, logLevel: "warn" } }, { headers: { "if-match": String(latest.version) } });
    expect(reenabled.statusCode).toBe(200);
    expect(api.runtime.logger.level).toBe("warn");
    expect((await owner.get("/api/v1/meta")).json().features.devScenarios).toBe(true);
  });
});

describe("developer scenario controls in live mode", () => {
  let api: TestApi;
  let owner: ApiClient;

  beforeAll(async () => {
    api = await startTestApi({ dataMode: "hybrid", authMode: "local", ownerPassword: "test-owner-password", scenarioConsole: true, env: { FRIDAY_DATA_MODE: "live" } });
    owner = api.client();
    await owner.loginOwner("test-owner-password");
  });
  afterAll(async () => api.close());

  it("cannot activate a mock scenario console without its mock engine", async () => {
    const current = (await owner.get("/api/v1/settings")).json().data;
    expect((await owner.get("/api/v1/meta")).json().features).toMatchObject({ scenarioControls: false, devScenarios: false });
    const response = await owner.patch("/api/v1/settings", { developer: { ...current.developer, scenarioConsole: true } }, { headers: { "if-match": String(current.version) } });
    expect(response.statusCode).toBe(422);
    expect((await owner.get("/api/v1/dev/scenarios")).statusCode).toBe(404);
  });
});
