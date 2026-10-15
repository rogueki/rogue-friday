import { afterEach, describe, expect, it } from "vitest";
import { AdapterRegistry } from "@friday/adapter-core";
import { hermesFactories } from "../src";

const registries: AdapterRegistry[] = [];
afterEach(async () => {
  await Promise.all(registries.splice(0).map((registry) => registry.shutdownAll()));
});

describe("Hermes placeholders behind the registry", () => {
  it("load as OFFLINE 'Nicht konfiguriert' without breaking anything and advertise no capabilities", async () => {
    const registry = new AdapterRegistry({ allowlist: hermesFactories.map((factory) => factory.providerId) });
    registries.push(registry);
    for (const factory of hermesFactories) registry.registerFactory(factory.providerId, factory);

    const reports = await registry.initialize({
      mode: "live",
      adapters: {
        tasks: { provider: "hermes-tasks", enabled: true },
        activity: { provider: "hermes-activity", enabled: true },
        agents: { provider: "hermes-agents", enabled: true },
      },
    });

    expect(reports.map((report) => report.state)).toEqual(["OFFLINE", "OFFLINE", "OFFLINE"]);
    expect(registry.getHealth("hermes-tasks")).toMatchObject({
      status: "offline",
      lastError: { code: "NOT_CONFIGURED", message: "Nicht konfiguriert" },
    });
    const { modules } = registry.aggregateCapabilities();
    expect(modules.tasks).toMatchObject({ read: false, sources: [] });
    expect(modules.agents).toMatchObject({ read: false, sources: [] });
    await expect(
      registry.getPort("tasks").listTasks({}, { correlationId: "corr_00000000000000000000000001" }),
    ).rejects.toMatchObject({ code: "ADAPTER_UNAVAILABLE" });
  });

  it("report 'konfiguriert, aber nicht implementiert' once base URL and token are present", async () => {
    const registry = new AdapterRegistry({
      allowlist: ["hermes-tasks"],
      secretProvider: ({ field }) => (field === "apiToken" ? "token-for-tests-123" : undefined),
    });
    registries.push(registry);
    const [tasks] = hermesFactories;
    if (!tasks) throw new Error("hermes-tasks factory missing");
    registry.registerFactory("hermes-tasks", tasks);
    await registry.initialize({
      mode: "live",
      adapters: {
        tasks: { provider: "hermes-tasks", enabled: true, config: { baseUrl: "http://127.0.0.1:8642" } },
      },
    });
    expect(registry.getHealth("hermes-tasks").lastError?.message).toContain("noch nicht implementiert");
  });
});
