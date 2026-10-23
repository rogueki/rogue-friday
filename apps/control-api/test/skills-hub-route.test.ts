import { expect, it } from "vitest";
import { HermesConfigService } from "../src/services/hermes-config";
import { startTestApi } from "./helpers";

const stub = (overrides: Record<string, unknown> = {}) => ({
  hubSearch: async (query: string, source: string | undefined, limit: number) => ({
    query, source: source ?? "all", observedAt: "2026-10-23T02:00:00.000Z",
    results: Array.from({ length: Math.min(limit, 2) }, (_, index) => ({
      identifier: `official/devops/hermes-${index}`,
      name: `hermes-${index}`,
      source: "official",
      trustLevel: "builtin",
      description: "Registry hit",
    })),
  }),
  modifiedSkills: async () => ({ names: ["google-workspace"], at: "2026-10-23T02:00:00.000Z" }),
  ...overrides,
});

it("serves registry search hits and the locally modified skill names", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    api.runtime.hermesConfig = stub() as never;
    const owner = api.client();
    await owner.loginDev("owner");

    const search = await owner.get("/api/v1/skills/hub/search?query=hermes&limit=2");
    expect(search.statusCode).toBe(200);
    expect(search.json().data).toMatchObject({ query: "hermes", source: "all" });
    expect(search.json().data.results).toHaveLength(2);
    expect(search.json().data.results[0]).toEqual({
      identifier: "official/devops/hermes-0", name: "hermes-0", source: "official",
      trustLevel: "builtin", description: "Registry hit" });

    const modified = await owner.get("/api/v1/skills/modified");
    expect(modified.statusCode).toBe(200);
    expect(modified.json().data).toEqual({ names: ["google-workspace"], observedAt: "2026-10-23T02:00:00.000Z" });
  } finally {
    await api.close();
  }
});

it("rejects an out-of-range limit before the handler runs and never invents results", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    let called = 0;
    api.runtime.hermesConfig = stub({
      hubSearch: async () => {
        called += 1;
        throw new Error("must not be reached");
      },
    }) as never;
    const owner = api.client();
    await owner.loginDev("owner");

    expect((await owner.get("/api/v1/skills/hub/search?query=hermes&limit=99")).statusCode).toBe(400);
    expect((await owner.get("/api/v1/skills/hub/search")).statusCode).toBe(400);
    expect(called).toBe(0);
  } finally {
    await api.close();
  }
});

it("rejects a blank query and an unknown source before any CLI call", async () => {
  const service = new HermesConfigService("C:/friday/data", (async () => {
    throw new Error("the bridge must not be reached");
  }) as never);
  await expect(service.hubSearch("   ", undefined, 10)).rejects.toThrow("Suchbegriff");
  await expect(service.hubSearch("hermes", "Not A Source", 10)).rejects.toThrow("Skill-Quelle");
  await expect(service.hubSearch("hermes", undefined, 51)).rejects.toThrow("Limit");
});