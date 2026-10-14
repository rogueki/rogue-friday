/* eslint-disable @typescript-eslint/no-explicit-any -- test code reads untyped JSON bodies that the contract validators check */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiClient, startTestApi, type TestApi } from "./helpers";

const ID = "mock-notifications";
const PATH = `/api/v1/settings/adapters/${ID}`;

describe("adapter settings: version and If-Match", () => {
  let api: TestApi;
  let owner: ApiClient;

  beforeAll(async () => {
    api = await startTestApi();
    owner = api.client();
    await owner.loginDev("owner");
  });
  afterAll(async () => {
    await api.close();
  });

  const read = async (): Promise<any> => {
    const list = (await owner.get("/api/v1/settings/adapters", { query: { limit: "100" } })).json().items as any[];
    return list.find((item) => item.adapterId === ID);
  };
  const patch = (body: unknown, ifMatch?: string) => owner.patch(PATH, body, ifMatch === undefined ? {} : { headers: { "if-match": ifMatch } });

  it("reports a version for every adapter, starting at 1", async () => {
    const list = (await owner.get("/api/v1/settings/adapters", { query: { limit: "100" } })).json().items as any[];
    expect(list.length).toBeGreaterThan(5);
    for (const item of list) expect(item.version, item.adapterId).toBe(1);
  });

  it("increments the version with every change and returns it", async () => {
    const first = await patch({ config: { latencyMs: 5 } }, "1");
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().data.version).toBe(2);
    expect((await read()).version).toBe(2);
    const second = await patch({ config: { latencyMs: 0 } }, "2");
    expect(second.json().data.version).toBe(3);
  });

  it("answers 409 CONFLICT for a stale If-Match and changes nothing", async () => {
    const before = await read();
    const stale = await patch({ config: { latencyMs: 9 } }, "1");
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toMatchObject({ code: "CONFLICT", details: { expectedVersion: 1, currentVersion: before.version, id: ID } });
    const after = await read();
    expect(after.version).toBe(before.version);
    expect(after.config.latencyMs).toBe(before.config.latencyMs);
  });

  it("accepts the version in the quoted and weak ETag notations", async () => {
    const current = (await read()).version as number;
    const quoted = await patch({ config: { latencyMs: 1 } }, `"${current}"`);
    expect(quoted.statusCode, quoted.body).toBe(200);
    const weak = await patch({ config: { latencyMs: 2 } }, `W/"${current + 1}"`);
    expect(weak.statusCode, weak.body).toBe(200);
    expect(weak.json().data.version).toBe(current + 2);
  });

  it("rejects a malformed If-Match with 400", async () => {
    const response = await patch({ config: { latencyMs: 3 } }, "abc");
    expect(response.statusCode).toBe(400);
  });

  it("works without If-Match (last write wins, like the other resources) and keeps the version for no-op patches", async () => {
    const before = (await read()).version as number;
    expect((await patch({ config: {} })).json().data.version).toBe(before);
    expect((await patch({ config: { latencyMs: 4 } })).json().data.version).toBe(before + 1);
  });

  it("does not leak the version check into other adapters", async () => {
    const other = (await owner.get("/api/v1/settings/adapters", { query: { limit: "100" } })).json().items.find((item: any) => item.adapterId !== ID);
    expect(other.version).toBe(1);
  });

  it("keeps the version across a restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-adapter-version-"));
    try {
      const first = await startTestApi({ dir });
      const client = first.client();
      await client.loginDev("owner");
      expect((await client.patch(PATH, { config: { latencyMs: 7 } }, { headers: { "if-match": "1" } })).json().data.version).toBe(2);
      await first.app.close();
      const second = await startTestApi({ dir });
      try {
        const again = second.client();
        await again.loginDev("owner");
        const item = (await again.get("/api/v1/settings/adapters", { query: { limit: "100" } })).json().items.find((candidate: any) => candidate.adapterId === ID);
        expect(item.version).toBe(2);
        expect((await again.patch(PATH, { config: { latencyMs: 8 } }, { headers: { "if-match": "1" } })).statusCode).toBe(409);
      } finally {
        await second.app.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
