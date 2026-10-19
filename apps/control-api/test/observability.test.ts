/* eslint-disable @typescript-eslint/no-explicit-any -- test code reads untyped JSON bodies that the contract validators check */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApi, type ApiClient, type TestApi } from "./helpers";

const TELEMETRY = "/api/v1/telemetry/frontend";
const batch = { errors: [{ kind: "js_error", message: "ReferenceError in OrbScene", route: "/overview", count: 3 }], orbSamples: [{ fps: 57.5, frameTimeMs: 17.4, webglMemoryBytes: 41943040 }] };

describe("metrics and frontend telemetry (PLAN §50.3)", () => {
  let api: TestApi;
  let owner: ApiClient;
  let operator: ApiClient;
  let viewer: ApiClient;
  const logs: string[] = [];

  beforeAll(async () => {
    api = await startTestApi({ logs });
    owner = api.client();
    operator = api.client();
    viewer = api.client();
    await owner.loginDev("owner");
    const settings = (await owner.get("/api/v1/settings")).json().data;
    const debugSettings = await owner.patch("/api/v1/settings", {
      developer: { ...settings.developer, debugMode: true, logLevel: "debug" },
    }, { headers: { "if-match": String(settings.version) } });
    expect(debugSettings.statusCode, debugSettings.body).toBe(200);
    expect(debugSettings.json().data.developer).toMatchObject({ debugMode: true, logLevel: "debug" });
    await operator.loginDev("operator");
    await viewer.loginDev("viewer");
  });
  afterAll(async () => {
    await api.close();
  });

  const metricValue = (text: string, series: string): number | undefined => {
    const line = text.split("\n").find((candidate) => candidate.startsWith(`${series} `));
    return line ? Number(line.slice(series.length + 1)) : undefined;
  };

  describe("GET /metrics", () => {
    it("is owner-only and requires a session", async () => {
      expect((await api.client().get("/api/v1/metrics")).statusCode).toBe(401);
      expect((await viewer.get("/api/v1/metrics")).statusCode).toBe(403);
      expect((await operator.get("/api/v1/metrics")).statusCode).toBe(403);
      expect((await owner.get("/api/v1/metrics")).statusCode).toBe(200);
    });

    it("exposes latency, error rate, WebSocket connections, events/s, adapter health and cache hits in Prometheus format", async () => {
      await owner.get("/api/v1/tasks");
      const current = (await owner.get("/api/v1/settings")).json().data;
      expect((await owner.patch("/api/v1/settings", { approvals: { ...current.approvals, confirmTier2: false } },
        { headers: { "if-match": String(current.version) } })).statusCode).toBe(200);
      const body = { title: "Metrik-Test" };
      const staged = await owner.post("/api/v1/tasks", body);
      expect(staged.statusCode).toBe(403);
      const previewId = staged.json().error.details.previewId as string;
      const headers = { "idempotency-key": "idem-metrics-task-001", "x-action-preview-id": previewId };
      expect((await owner.post("/api/v1/tasks", body, { headers })).statusCode).toBe(201);
      expect((await owner.post("/api/v1/tasks", body, { headers })).statusCode).toBe(201);
      const response = await owner.get("/api/v1/metrics");
      expect(response.headers["content-type"]).toBe("text/plain; version=0.0.4; charset=utf-8");
      const text = response.body;
      expect(text).toMatch(/# TYPE friday_http_request_duration_seconds histogram/);
      expect(text).toMatch(/friday_http_request_duration_seconds_bucket\{method="GET",route="\/api\/v1\/tasks",le="\+Inf"\} 1/);
      expect(text).toMatch(/friday_http_requests_total\{method="GET",route="\/api\/v1\/tasks",status="200"\} 1/);
      expect(text).toContain("# TYPE friday_http_error_ratio gauge");
      expect(text).toContain("# TYPE friday_ws_connections gauge");
      expect(text).toContain("# TYPE friday_events_per_second gauge");
      expect(text).toMatch(/friday_events_total\{type="friday\.task\.created"\} [1-9]/);
      expect(text).toMatch(/friday_adapter_health\{adapter="mock-tasks"\} 1\n/);
      // one miss (first idempotent POST) and one hit (replay)
      expect(metricValue(text, 'friday_cache_requests_total{result="hit"}')).toBe(1);
      expect(metricValue(text, 'friday_cache_requests_total{result="miss"}')).toBe(1);
      expect(metricValue(text, "friday_cache_hit_ratio")).toBe(0.5);
    });

    it("shows an adapter that goes offline as down", async () => {
      const control = await owner.post("/api/v1/dev/scenarios/control", { action: "adapter_offline", adapterId: "mock-calendar", offline: true });
      expect(control.statusCode, control.body).toBe(200);
      const text = (await owner.get("/api/v1/metrics")).body;
      expect(text).toMatch(/friday_adapter_health\{adapter="mock-calendar"\} 0\n/);
      await owner.post("/api/v1/dev/scenarios/control", { action: "adapter_offline", adapterId: "mock-calendar", offline: false });
    });

    it("contains no personal data or secrets", async () => {
      const text = (await owner.get("/api/v1/metrics")).body;
      expect(text).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i);
      expect(text).not.toMatch(/friday_session|csrf/i);
    });
  });

  describe("POST /telemetry/frontend", () => {
    it("is operator+ and needs CSRF", async () => {
      expect((await viewer.post(TELEMETRY, batch)).statusCode).toBe(403);
      expect((await api.client().post(TELEMETRY, batch)).statusCode).toBe(401);
      const noCsrf = await operator.post(TELEMETRY, batch, { csrf: false });
      expect(noCsrf.statusCode).toBe(403);
      expect(noCsrf.json().error.code).toBe("CSRF_INVALID");
      const accepted = await operator.post(TELEMETRY, batch);
      expect(accepted.statusCode, accepted.body).toBe(202);
      expect(accepted.json().data).toEqual({ acceptedErrors: 1, acceptedOrbSamples: 1 });
    });

    it("turns the batch into orb gauges, frame-time histogram and error counters", async () => {
      const text = (await owner.get("/api/v1/metrics")).body;
      expect(metricValue(text, "friday_frontend_orb_fps")).toBe(57.5);
      expect(metricValue(text, "friday_frontend_orb_frame_time_ms")).toBe(17.4);
      expect(metricValue(text, "friday_frontend_webgl_memory_bytes")).toBe(41943040);
      expect(metricValue(text, "friday_frontend_orb_frame_time_seconds_count")).toBe(1);
      expect(metricValue(text, 'friday_frontend_errors_total{kind="js_error"}')).toBe(3);
    });

    it("rejects invalid batches with VALIDATION_FAILED", async () => {
      for (const body of [
        {},
        { errors: [{ kind: "something_else", message: "x" }] },
        { errors: [{ kind: "js_error", message: "x", route: "/overview?token=abc" }] },
        { errors: [{ kind: "js_error", message: "x", stack: "at foo (file.js:1)" }] },
        { orbSamples: [{ fps: -1, frameTimeMs: 10 }] },
        { orbSamples: Array.from({ length: 61 }, () => ({ fps: 60, frameTimeMs: 16 })) },
        { errors: Array.from({ length: 21 }, () => ({ kind: "js_error", message: "x" })) },
      ]) {
        const response = await operator.post(TELEMETRY, body);
        expect(response.statusCode, JSON.stringify(body).slice(0, 80)).toBe(422);
        expect(response.json().error.code).toBe("VALIDATION_FAILED");
      }
    });

    it("limits the body size to 32 KiB", async () => {
      const oversized = JSON.stringify({ errors: [{ kind: "js_error", message: "x".repeat(250) }], padding: "y".repeat(40 * 1024) });
      const response = await operator.post(TELEMETRY, undefined, { rawBody: oversized });
      expect(response.statusCode).toBe(413);
      expect(response.json().error.code).toBe("VALIDATION_FAILED");
    });

    it("scrubs personal data from the log line and never puts messages into metrics", async () => {
      logs.length = 0;
      const response = await operator.post(TELEMETRY, {
        errors: [{ kind: "network_error", message: "Fetch failed for https://example.org/a?token=abc123 by erik.brandt@example.org phone +49 170 1234567" }],
      });
      expect(response.statusCode).toBe(202);
      const line = logs.map((entry) => JSON.parse(entry)).find((entry) => entry.message === "Frontend-Fehler gemeldet");
      expect(line).toBeTruthy();
      expect(line.kind).toBe("network_error");
      expect(line.errorMessage).toContain("[URL]");
      expect(line.errorMessage).toContain("[NUMBER]");
      expect(line.errorMessage).not.toMatch(/erik|brandt|1234567|abc123/);
      const text = (await owner.get("/api/v1/metrics")).body;
      expect(text).not.toMatch(/erik|brandt|example\.org|1234567/);
    });

    it("does not write an audit entry per batch", async () => {
      const before = api.runtime.stores.audit.verify().length;
      await operator.post(TELEMETRY, batch);
      expect(api.runtime.stores.audit.verify().length).toBe(before);
    });
  });

  describe("rate limit", () => {
    it("answers 429 with Retry-After after 30 batches per minute and recovers after the window", async () => {
      let now = 1_000_000;
      const limited = await startTestApi({ now: () => now });
      try {
        const client = limited.client();
        await client.loginDev("operator");
        const statuses: number[] = [];
        let last: any;
        for (let i = 0; i < 31; i += 1) {
          last = await client.post(TELEMETRY, { orbSamples: [{ fps: 60, frameTimeMs: 16 }] });
          statuses.push(last.statusCode);
        }
        expect(statuses.slice(0, 30).every((status) => status === 202)).toBe(true);
        expect(statuses[30]).toBe(429);
        expect(last.json().error.code).toBe("RATE_LIMITED");
        expect(Number(last.headers["retry-after"])).toBeGreaterThan(0);
        // another session is not affected
        const other = limited.client();
        await other.loginDev("owner");
        expect((await other.post(TELEMETRY, { orbSamples: [{ fps: 60, frameTimeMs: 16 }] })).statusCode).toBe(202);
        now += 61_000;
        expect((await client.post(TELEMETRY, { orbSamples: [{ fps: 60, frameTimeMs: 16 }] })).statusCode).toBe(202);
      } finally {
        await limited.close();
      }
    });
  });
});
