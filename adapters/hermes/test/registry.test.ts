import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AdapterRegistry } from "@jarvis/adapter-core";
import { createCorrelationId } from "@jarvis/sdk";
import { hermesFactories } from "../src";
import { createHermesFake, type HermesFake } from "./fake/server";

let fake: HermesFake;
let registry: AdapterRegistry | undefined;

beforeEach(async () => {
  fake = await createHermesFake();
  fake.state.addTask("default", { title: "Rechnung prüfen", assignee: "kira", priority: 3 });
  fake.state.addSession({ title: "Hallo", messages: [{ role: "user", content: "Hallo Welt" }] });
});

afterEach(async () => {
  await registry?.shutdownAll();
  registry = undefined;
  await fake.close();
});

describe("Hermes adapters behind the registry (config schema, secrets, result validation)", () => {
  it("load ONLINE with the documented config, resolve secrets and serve contract-valid results", async () => {
    registry = new AdapterRegistry({
      allowlist: hermesFactories.map((factory) => factory.providerId),
      secretProvider: ({ field }) => (field === "apiKey" ? fake.state.apiKey : undefined),
    });
    for (const factory of hermesFactories) registry.registerFactory(factory.providerId, factory);
    const config = {
      apiBaseUrl: fake.apiUrl,
      dashboardBaseUrl: fake.dashboardUrl,
      boards: ["default"],
      pollIntervalMs: 0,
    };

    const reports = await registry.initialize({
      mode: "live",
      adapters: {
        tasks: { provider: "hermes-tasks", enabled: true, config },
        activity: { provider: "hermes-activity", enabled: true, config },
        agents: { provider: "hermes-agents", enabled: true, config },
      },
    });
    expect(reports.map((report) => report.state)).toEqual(["ONLINE", "ONLINE", "ONLINE"]);

    const call = () => ({ correlationId: createCorrelationId() });
    const tasks = await registry.getPort("tasks").listTasks({}, call());
    expect(tasks.items.map((task) => task.title)).toEqual(["Rechnung prüfen"]);
    const created = await registry
      .getPort("tasks")
      .createTask?.(
        { body: { title: "Neu über Registry" } },
        { ...call(), idempotencyKey: "registry-idem-0001" },
      );
    expect(created?.data.title).toBe("Neu über Registry");
    expect((await registry.getPort("activity").listActivity({}, call())).items).toHaveLength(1);
    expect(
      (await registry.getPort("agents").listAgents({}, call())).items.map((agent) => agent.name),
    ).toEqual(["Hermes", "kira"]);

    const { modules } = registry.aggregateCapabilities();
    expect(modules.tasks).toMatchObject({
      read: true,
      create: true,
      update: true,
      stream: true,
      cancel: false,
    });
    expect(modules.activity).toMatchObject({ read: true, stream: true, backfill: true });
    expect(modules.agents).toMatchObject({ read: true, pause: false, resume: false, stop: false });
  });

  it("goes OFFLINE (not crashing) when the API server is unreachable at start", async () => {
    await fake.setOffline("both", true);
    registry = new AdapterRegistry({
      allowlist: ["hermes-tasks"],
      secretProvider: () => undefined,
    });
    const tasks = hermesFactories[0];
    if (!tasks) throw new Error("factory missing");
    registry.registerFactory("hermes-tasks", tasks);
    const reports = await registry.initialize({
      mode: "live",
      adapters: {
        tasks: {
          provider: "hermes-tasks",
          enabled: true,
          config: { apiBaseUrl: fake.apiUrl, dashboardBaseUrl: fake.dashboardUrl },
        },
      },
    });
    expect(reports[0]?.state).toBe("OFFLINE");
  });
});
