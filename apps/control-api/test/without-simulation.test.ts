import { afterEach, describe, expect, it } from "vitest";
import { startTestApi, type TestApi } from "./helpers";

const PASSWORD = "shipped-server-password";

describe("a server without injected simulation (every shipped build)", () => {
  let api: TestApi | undefined;
  afterEach(async () => {
    await api?.close();
    api = undefined;
  });

  it.each(["mock", "hybrid"] as const)("runs a %s config from an older install as live and warns", async (dataMode) => {
    const logs: string[] = [];
    api = await startTestApi({ dataMode, authMode: "local", ownerPassword: PASSWORD, withoutSimulation: true, logs });
    expect(api.runtime.config.dataMode).toBe("live");
    expect(api.runtime.world).toBeUndefined();
    expect(api.runtime.engine).toBeUndefined();
    expect(logs.some((line) => line.includes("Simulationsdaten gibt es nicht mehr"))).toBe(true);
    const client = api.client();
    expect((await client.loginOwner(PASSWORD)).statusCode).toBe(200);
    expect((await client.get("/api/v1/meta")).json().dataMode).toBe("live");
    expect((await client.get("/api/v1/dev/scenarios")).statusCode).toBe(404);
    // No mock adapter survives: categories the old config filled with mocks are simply not configured.
    const providers = Object.values(api.runtime.config.adapters).map((entry) => entry.provider);
    expect(providers.filter((provider) => provider?.startsWith("mock-"))).toEqual([]);
    const adapters = (await client.get("/api/v1/adapters")).json() as { items: Array<{ provider?: string; id?: string }> };
    expect(JSON.stringify(adapters)).not.toMatch(/mock-/);
  });

  it("refuses the fixed dev accounts", async () => {
    await expect(startTestApi({ dataMode: "mock", authMode: "dev", withoutSimulation: true })).rejects.toThrow(/Dev-Login ist nur in Testumgebungen/);
  });
});
