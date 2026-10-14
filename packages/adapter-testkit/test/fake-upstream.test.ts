import { afterEach, describe, expect, it } from "vitest";
import { createFakeUpstream, type FakeUpstream } from "../src";

let upstream: FakeUpstream | undefined;
afterEach(async () => {
  await upstream?.close();
  upstream = undefined;
});

const start = async () => {
  upstream = await createFakeUpstream();
  return upstream;
};

describe("createFakeUpstream", () => {
  it("serves programmable routes with params, query and records requests", async () => {
    const server = await start();
    server.route("GET", "/items/:id", (request) => ({
      body: { id: request.params.id, page: request.query.page },
    }));
    const response = await fetch(`${server.url}/items/a%20b?page=2`, { headers: { "x-test": "1" } });
    expect(await response.json()).toEqual({ id: "a b", page: "2" });
    expect(server.requestsFor("GET", "/items/:id")).toHaveLength(1);
    expect(server.requests[0]?.headers["x-test"]).toBe("1");
    expect((await fetch(`${server.url}/unknown`)).status).toBe(404);
  });

  it("consumes a status sequence and then behaves normally", async () => {
    const server = await start();
    server.route("GET", "/x", { body: { ok: true } });
    server.fault("GET", "/x", { statusSequence: [503, 429] });
    const statuses = [];
    for (let i = 0; i < 3; i += 1) statuses.push((await fetch(`${server.url}/x`)).status);
    expect(statuses).toEqual([503, 429, 200]);
  });

  it("limits a fault with `times`, drops connections and adds latency", async () => {
    const server = await start();
    server.route("GET", "/x", { body: { ok: true } });
    server.fault("GET", "/x", { drop: true, times: 1 });
    await expect(fetch(`${server.url}/x`)).rejects.toThrow();
    expect((await fetch(`${server.url}/x`)).status).toBe(200);

    server.clearFaults();
    server.fault("GET", "/x", { latencyMs: 80 });
    const started = Date.now();
    await fetch(`${server.url}/x`);
    expect(Date.now() - started).toBeGreaterThanOrEqual(70);
  });

  it("echoes request data through function bodies and supports raw payloads", async () => {
    const server = await start();
    server.route("POST", "/x", { body: {} });
    server.fault("POST", "/x", { status: 401, body: (request) => ({ saw: request.headers.authorization }) });
    const response = await fetch(`${server.url}/x`, {
      method: "POST",
      headers: { authorization: "Bearer abc" },
      body: "{}",
    });
    expect(await response.json()).toEqual({ saw: "Bearer abc" });
    server.clearFaults();
    server.fault("POST", "/x", { status: 200, raw: "{broken" });
    expect(await (await fetch(`${server.url}/x`, { method: "POST", body: "{}" })).text()).toBe("{broken");
  });

  it("goes offline and returns on the same port", async () => {
    const server = await start();
    server.route("GET", "/x", { body: { ok: true } });
    const { url, port } = server;
    await server.setOffline(true);
    await expect(fetch(`${url}/x`)).rejects.toThrow();
    await server.setOffline(false);
    expect(server.port).toBe(port);
    expect((await fetch(`${url}/x`)).status).toBe(200); // routes and faults survive an offline period
  });
});
