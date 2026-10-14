import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApi, type TestApi } from "./helpers";

describe("control api smoke", () => {
  let api: TestApi;
  beforeAll(async () => {
    api = await startTestApi();
  });
  afterAll(async () => {
    await api.close();
  });

  it("serves meta without a session", async () => {
    const response = await api.client().get("/api/v1/meta");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ dataMode: "mock", eventsPath: "/api/v1/events" });
  });

  it("serves overview after dev login", async () => {
    const client = api.client();
    await client.loginDev();
    const response = await client.get("/api/v1/overview");
    expect(response.statusCode, response.body).toBe(200);
    const caps = await client.get("/api/v1/capabilities");
    expect(caps.statusCode, caps.body).toBe(200);
    const tasks = await client.get("/api/v1/tasks", { query: { status: ["running"] } });
    expect(tasks.statusCode, tasks.body).toBe(200);
  });
});
