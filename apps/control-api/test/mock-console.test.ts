/* eslint-disable @typescript-eslint/no-explicit-any -- test code reads untyped JSON bodies and frames that the contract validators check */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { run } from "../../mock-console/src/commands";
import { ApiClient, startTestApi, type TestApi } from "./helpers";

/** The scenario CLI against a real listening Control API (HTTP, dev login, CSRF, WebSocket). */
describe("mock-console CLI against the Control API", () => {
  let api: TestApi;
  let observer: ApiClient;

  beforeAll(async () => {
    api = await startTestApi({ listen: true });
    observer = api.client();
    await observer.loginDev("owner");
  });
  afterAll(async () => {
    await api.close();
  });

  const cli = async (...argv: string[]) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await run(argv, { io: { out: (line) => out.push(line), err: (line) => err.push(line) }, env: { JARVIS_API_URL: api.origin }, sleep: async () => {} });
    return { code, out: out.join("\n"), err: err.join("\n") };
  };

  it("lists the scenarios of the plan", async () => {
    const result = await cli("list");
    expect(result.code, result.err).toBe(0);
    for (const id of ["clean-idle", "voice-pipeline", "multi-agent-working", "approval-waiting", "partial-outage", "adapter-recovery"]) expect(result.out).toContain(id);
  });

  it("plays a scenario and reports the state as JSON", async () => {
    const result = await cli("play", "clean-idle", "--json");
    expect(result.code, result.err).toBe(0);
    expect(JSON.parse(result.out)).toMatchObject({ activeScenarioId: "clean-idle" });
    expect((await cli("state")).out).toContain("clean-idle");
  });

  it("takes an adapter offline and back, visible in the API", async () => {
    expect((await cli("offline", "mock-communication")).code).toBe(0);
    expect((await observer.get("/api/v1/communication/threads")).statusCode).toBe(503);
    expect((await observer.get("/api/v1/health")).json().status).toBe("degraded");
    expect((await cli("online", "mock-communication")).code).toBe(0);
    expect((await observer.get("/api/v1/communication/threads")).statusCode).toBe(200);
  });

  it("forces orb states and the status command shows them", async () => {
    expect((await cli("orb", "thinking", "--text", "ANALYSE LÄUFT")).code).toBe(0);
    const orb = (await observer.get("/api/v1/orb/status")).json().data.status;
    expect(orb.mode).toBe("thinking");
    expect(orb.activityText).toBe("ANALYSE LÄUFT");
    const status = await cli("status");
    expect(status.out).toContain("thinking");
    expect((await cli("event", "recovery")).code).toBe(0);
    expect((await observer.get("/api/v1/orb/status")).json().data.status.mode).toBe("success");
  });

  it("advances the clock, sets latency and error rate, toggles capabilities and resets", async () => {
    const before = (await observer.get("/api/v1/dev/scenarios/state")).json().data.simulatedTime as string;
    expect((await cli("advance", "2h")).code).toBe(0);
    const after = (await observer.get("/api/v1/dev/scenarios/state")).json().data.simulatedTime as string;
    expect(Date.parse(after) - Date.parse(before)).toBe(2 * 3_600_000);

    expect((await cli("latency", "120", "--adapter", "mock-tasks")).code).toBe(0);
    expect((await cli("error-rate", "0.5", "--adapter", "mock-tasks")).code).toBe(0);
    const overrides = (await observer.get("/api/v1/dev/scenarios/state")).json().data.adapterOverrides as Array<{ adapterId: string; latencyMs?: number; errorRate?: number }>;
    expect(overrides.find((entry) => entry.adapterId === "mock-tasks")).toMatchObject({ latencyMs: 120, errorRate: 0.5 });

    expect((await cli("capability", "tasks.create", "off")).code).toBe(0);
    expect((await observer.get("/api/v1/capabilities")).json().modules.tasks.create).toBe(false);
    expect((await cli("capability", "tasks.create", "on")).code).toBe(0);
    expect((await observer.get("/api/v1/capabilities")).json().modules.tasks.create).toBe(true);

    expect((await cli("reset")).code).toBe(0);
    const reset = (await observer.get("/api/v1/dev/scenarios/state")).json().data;
    expect(reset.adapterOverrides.every((entry: any) => !entry.offline && !entry.latencyMs && !entry.errorRate)).toBe(true);
  });

  it("streams events over the WebSocket while another command changes the world", async () => {
    const lines: string[] = [];
    const watching = run(["watch", "--count", "2", "--for", "4000", "--type", "jarvis.orb"], {
      io: { out: (line) => lines.push(line), err: (line) => lines.push(`ERR ${line}`) },
      env: { JARVIS_API_URL: api.origin },
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    await cli("orb", "working");
    await cli("orb", "speaking");
    expect(await watching).toBe(0);
    const events = lines.filter((line) => line.startsWith("#"));
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.every((line) => /^#\d+ jarvis\.orb\./.test(line))).toBe(true);
  });

  it("works as a viewer only for what a viewer may do", async () => {
    const result = await cli("reset", "--role", "viewer");
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/FORBIDDEN/);
  });

  it("reports an unreachable API without a stack trace", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await run(["state", "--url", "http://127.0.0.1:1"], { io: { out: (l) => out.push(l), err: (l) => err.push(l) }, env: {} });
    expect(code).toBe(1);
    expect(err.join("\n")).toMatch(/Fehler|API-Fehler/);
    expect(err.join("\n")).not.toMatch(/\bat \S+ \(/);
  });
});
