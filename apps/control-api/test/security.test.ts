import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROUTE_TABLE } from "../src/http/route-table.generated";
import type { RouteSpec } from "../src/http/route-types";
import { ApiClient, startTestApi, type TestApi } from "./helpers";
import { pathOf } from "./support/contract";

const ROLES = ["owner", "operator", "viewer"] as const;
type Role = (typeof ROLES)[number];
const RANK: Record<Role, number> = { viewer: 1, operator: 2, owner: 3 };
const USER_ID = /^usr_[0-9A-Za-z]{26}$/;

const dummyParams = (spec: RouteSpec): Record<string, string> => Object.fromEntries(spec.pathParams.map((name) => [name, "x"]));
const errorOf = (response: { json(): unknown }) => (response.json() as { error: { code: string; details: Record<string, unknown> } }).error;

describe("security: sessions, CSRF and roles (dev auth)", () => {
  let api: TestApi;
  const clients = {} as Record<Role, ApiClient>;

  beforeAll(async () => {
    api = await startTestApi();
    for (const role of ROLES) {
      clients[role] = api.client();
      await clients[role].loginDev(role);
    }
  });
  afterAll(async () => {
    await api.close();
  });

  describe("authentication", () => {
    it("answers UNAUTHENTICATED for every session-bound operation without a cookie", async () => {
      const anonymous = api.client();
      let checked = 0;
      for (const spec of ROUTE_TABLE.filter((candidate) => candidate.requiresSession && candidate.operationId !== "getSession")) {
        const response = await anonymous.request(spec.method, pathOf(spec, dummyParams(spec)), { csrf: false, ...(spec.requestBody ? { body: {} } : {}) });
        expect(response.statusCode, spec.operationId).toBe(401);
        expect(errorOf(response).code, spec.operationId).toBe("UNAUTHENTICATED");
        checked += 1;
      }
      expect(checked).toBeGreaterThan(90);
    });

    it("keeps meta, health and login reachable without a session", async () => {
      const anonymous = api.client();
      expect((await anonymous.get("/api/v1/meta")).statusCode).toBe(200);
      expect((await anonymous.get("/api/v1/health")).statusCode).toBe(200);
      expect((await anonymous.post("/api/v1/auth/login", { username: "dev-owner", password: "dev" }, { csrf: false })).statusCode).toBe(200);
    });

    it("rejects a forged or unknown session cookie", async () => {
      const response = await api.client().get("/api/v1/tasks", { headers: { cookie: "jarvis_session=not-a-real-session-token" } });
      expect(response.statusCode).toBe(401);
    });

    it("issues contract-valid usr_ ids and the role of the dev user (dev-<role> / dev)", async () => {
      for (const role of ROLES) {
        const client = api.client();
        const response = await client.post("/api/v1/auth/login", { username: `dev-${role}`, password: "dev" }, { csrf: false });
        expect(response.statusCode, response.body).toBe(200);
        const { data } = response.json();
        expect(data.user.id).toMatch(USER_ID);
        expect(data.role).toBe(role);
        expect(data.csrfToken).toBeTruthy();
      }
      const first = await api.client().post("/api/v1/auth/login", { username: "dev-owner", password: "dev" }, { csrf: false });
      const second = await api.client().post("/api/v1/auth/login", { username: "dev-owner", password: "dev" }, { csrf: false });
      expect(first.json().data.user.id).toBe(second.json().data.user.id);
    });

    it("rejects unknown dev users and empty passwords", async () => {
      expect((await api.client().post("/api/v1/auth/login", { username: "dev-root", password: "dev" }, { csrf: false })).statusCode).toBe(401);
      expect((await api.client().post("/api/v1/auth/login", { username: "dev-owner", password: "" }, { csrf: false })).statusCode).toBeGreaterThanOrEqual(400);
    });

    it("sets HttpOnly, SameSite=Strict cookies and a readable CSRF cookie", async () => {
      const response = await api.client().post("/api/v1/auth/login", { username: "dev-owner", password: "dev" }, { csrf: false });
      const cookies = ([] as string[]).concat(response.headers["set-cookie"] ?? []);
      const session = cookies.find((cookie) => cookie.startsWith("jarvis_session="));
      const csrf = cookies.find((cookie) => cookie.startsWith("jarvis_csrf="));
      expect(session).toMatch(/HttpOnly/i);
      expect(session).toMatch(/SameSite=Strict/i);
      expect(session).toMatch(/Path=\//);
      expect(csrf).not.toMatch(/HttpOnly/i);
      expect(csrf).toMatch(/SameSite=Strict/i);
    });

    it("ends the session on logout and clears the cookies", async () => {
      const client = api.client();
      await client.loginDev("operator");
      const out = await client.post("/api/v1/auth/logout");
      expect(out.statusCode).toBe(200);
      expect(([] as string[]).concat(out.headers["set-cookie"] ?? []).join("\n")).toMatch(/Max-Age=0/);
      const stale = api.client();
      stale.cookies = new Map(client.cookies);
      // the browser dropped the cookie; a captured copy must be dead server-side as well
      const before = await api.client().post("/api/v1/auth/login", { username: "dev-operator", password: "dev" }, { csrf: false });
      expect(before.statusCode).toBe(200);
      const replay = await stale.get("/api/v1/tasks");
      expect(replay.statusCode).toBe(401);
    });

    it("logout-all revokes every session of the user (and only of that user)", async () => {
      const isolated = await startTestApi();
      try {
        const a = isolated.client();
        const b = isolated.client();
        const other = isolated.client();
        await a.loginDev("viewer");
        await b.loginDev("viewer");
        await other.loginDev("operator");
        expect((await a.get("/api/v1/tasks")).statusCode).toBe(200);
        expect((await a.post("/api/v1/auth/logout-all")).statusCode).toBe(200);
        expect((await a.get("/api/v1/tasks")).statusCode).toBe(401);
        expect((await b.get("/api/v1/tasks")).statusCode).toBe(401);
        expect((await other.get("/api/v1/tasks")).statusCode).toBe(200);
      } finally {
        await isolated.close();
      }
    });
  });

  describe("CSRF", () => {
    it("rejects mutations without or with a wrong token with CSRF_INVALID", async () => {
      const client = clients.operator;
      const missing = await client.post("/api/v1/tasks", { title: "ohne Token" }, { csrf: false });
      expect(missing.statusCode).toBe(403);
      expect(errorOf(missing).code).toBe("CSRF_INVALID");
      const wrong = await client.post("/api/v1/tasks", { title: "falsches Token" }, { headers: { "x-csrf-token": "forged" } });
      expect(wrong.statusCode).toBe(403);
      expect(errorOf(wrong).code).toBe("CSRF_INVALID");
    });

    it("rejects a token that belongs to another session", async () => {
      const response = await clients.operator.post("/api/v1/tasks", { title: "fremdes Token" }, { headers: { "x-csrf-token": clients.owner.csrfToken as string } });
      expect(response.statusCode).toBe(403);
      expect(errorOf(response).code).toBe("CSRF_INVALID");
    });

    it("rejects a header token that differs from the cookie token (double submit)", async () => {
      const client = api.client();
      await client.loginDev("operator");
      const other = (await api.client().post("/api/v1/auth/login", { username: "dev-operator", password: "dev" }, { csrf: false })).json().data.csrfToken;
      const response = await client.post("/api/v1/tasks", { title: "Doppel-Submit" }, { headers: { "x-csrf-token": other } });
      expect(response.statusCode).toBe(403);
    });

    it("exempts safe methods and accepts the valid token", async () => {
      expect((await clients.operator.get("/api/v1/tasks", { csrf: false })).statusCode).toBe(200);
      expect((await clients.operator.post("/api/v1/tasks", { title: "mit gültigem Token" })).statusCode).toBe(201);
    });

    it("refuses a foreign Origin on mutations and a foreign Host header", async () => {
      const origin = await clients.operator.post("/api/v1/tasks", { title: "fremder Origin" }, { headers: { origin: "https://evil.example" } });
      expect(origin.statusCode).toBe(403);
      expect(errorOf(origin).details.reason).toBe("origin_not_allowed");
      const host = await clients.operator.get("/api/v1/tasks", { headers: { host: "evil.example" } });
      expect(host.statusCode).toBe(403);
      expect(errorOf(host).details.reason).toBe("host_not_allowed");
      const same = await clients.operator.post("/api/v1/tasks", { title: "gleicher Origin" }, { headers: { origin: "http://127.0.0.1:3100" } });
      expect(same.statusCode).toBe(201);
    });
  });

  describe("role matrix", () => {
    const required = (spec: RouteSpec): Role => (spec.role === "none" ? "viewer" : spec.role);

    it("denies every operation to roles below its required role with FORBIDDEN (all mutating and privileged operations)", async () => {
      let denied = 0;
      for (const spec of ROUTE_TABLE.filter((candidate) => candidate.requiresSession)) {
        for (const role of ROLES.filter((candidate) => RANK[candidate] < RANK[required(spec)])) {
          const response = await clients[role].request(spec.method, pathOf(spec, dummyParams(spec)), spec.requestBody ? { body: {} } : {});
          expect(response.statusCode, `${role} → ${spec.operationId}`).toBe(403);
          expect(errorOf(response).code, `${role} → ${spec.operationId}`).toBe("FORBIDDEN");
          denied += 1;
        }
      }
      // 107 operations: operator is denied the owner-only ones, viewer everything operator/owner.
      expect(denied).toBeGreaterThan(60);
    });

    it("lets every role read what a viewer may read", async () => {
      const reads = ROUTE_TABLE.filter((spec) => spec.method === "GET" && spec.requiresSession && spec.role === "viewer" && spec.pathParams.length === 0 && spec.operationId !== "getSession");
      expect(reads.length).toBeGreaterThan(30);
      for (const role of ROLES) {
        for (const spec of reads) {
          const response = await clients[role].get(spec.path);
          expect(response.statusCode, `${role} → ${spec.operationId}`).toBe(200);
        }
      }
    });

    it("limits owner-only reads (audit export, adapter settings, settings export, dev console) to the owner", async () => {
      for (const path of ["/api/v1/audit/export", "/api/v1/settings/adapters", "/api/v1/settings/export", "/api/v1/dev/scenarios", "/api/v1/dev/scenarios/state"]) {
        expect((await clients.viewer.get(path)).statusCode, `viewer ${path}`).toBe(403);
        expect((await clients.operator.get(path)).statusCode, `operator ${path}`).toBe(403);
        expect((await clients.owner.get(path)).statusCode, `owner ${path}`).toBe(200);
      }
    });

    it("lets operators work but not change settings; viewers are read-only", async () => {
      expect((await clients.operator.post("/api/v1/tasks", { title: "Operator-Aufgabe" })).statusCode).toBe(201);
      expect((await clients.viewer.post("/api/v1/tasks", { title: "Viewer-Aufgabe" })).statusCode).toBe(403);
      const settings = (await clients.owner.get("/api/v1/settings")).json().data;
      const patch = { dashboard: { ...settings.dashboard, compact: true } };
      expect((await clients.operator.patch("/api/v1/settings", patch)).statusCode).toBe(403);
      expect((await clients.viewer.patch("/api/v1/settings", patch)).statusCode).toBe(403);
      expect((await clients.owner.patch("/api/v1/settings", patch)).statusCode).toBe(200);
    });

    it("lets the viewer search memory (read-only POST) but not write it", async () => {
      expect((await clients.viewer.post("/api/v1/memory/search", { query: "Arbeitszeit" })).statusCode).toBe(200);
      expect((await clients.viewer.post("/api/v1/memory", { type: "fact", content: "x" })).statusCode).toBe(403);
    });
  });

  describe("response hygiene", () => {
    it("sends strict security headers on API and static responses", async () => {
      const response = await clients.owner.get("/api/v1/meta");
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
      expect(response.headers["x-frame-options"]).toBe("DENY");
      expect(response.headers["referrer-policy"]).toBe("no-referrer");
      expect(response.headers["content-security-policy"]).toContain("default-src 'self'");
      expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
      expect(response.headers["cache-control"]).toBe("no-store");
    });

    it("answers unknown API paths with contract errors, never with the SPA shell", async () => {
      const unknown = await clients.owner.get("/api/v1/does-not-exist");
      expect(unknown.statusCode).toBe(404);
      expect(errorOf(unknown).code).toBe("NOT_FOUND");
      const wrongMethod = await clients.owner.request("DELETE", "/api/v1/meta");
      expect(wrongMethod.statusCode).toBe(405);
    });

    it("rejects malformed JSON and oversized path parameters with a contract error", async () => {
      const bad = await clients.operator.post("/api/v1/tasks", undefined, { rawBody: "{not json" });
      expect(bad.statusCode).toBe(400);
      expect(errorOf(bad).code).toBe("VALIDATION_FAILED");
      const long = await clients.owner.get(`/api/v1/tasks/${"a".repeat(200)}`);
      expect(long.statusCode).toBe(400);
    });

    it("accepts a valid inbound correlation id and generates one otherwise", async () => {
      const id = "corr_01ARZ3NDEKTSV4RRFFQ69G5FAV";
      expect((await clients.owner.get("/api/v1/meta", { headers: { "x-correlation-id": id } })).headers["x-correlation-id"]).toBe(id);
      expect((await clients.owner.get("/api/v1/meta", { headers: { "x-correlation-id": "../../etc/passwd" } })).headers["x-correlation-id"]).toMatch(/^corr_[0-9A-Za-z]{26}$/);
    });
  });
});

describe("security: local auth mode", () => {
  let api: TestApi;
  const PASSWORD = "korrekt-pferd-batterie-heftklammer";

  beforeAll(async () => {
    api = await startTestApi({ authMode: "local", ownerPassword: PASSWORD, dataMode: "mock" });
  });
  afterAll(async () => {
    await api.close();
  });

  it("does not offer dev logins and starts without a session", async () => {
    const client = api.client();
    expect((await client.post("/api/v1/auth/login", { username: "dev-owner", password: "dev" }, { csrf: false })).statusCode).toBe(401);
    const session = await client.get("/api/v1/auth/session");
    expect(session.json().data.authenticated).toBe(false);
  });

  it("logs the owner in with the password and returns a contract-valid user", async () => {
    const client = api.client();
    const response = await client.loginOwner(PASSWORD);
    expect(response.statusCode, response.body).toBe(200);
    const { data } = response.json();
    expect(data.user.id).toMatch(USER_ID);
    expect(data.role).toBe("owner");
    expect((await client.get("/api/v1/tasks")).statusCode).toBe(200);
  });

  it("rejects a wrong password and an unknown user the same way", async () => {
    const wrong = await api.client().post("/api/v1/auth/login", { username: "owner", password: "falsch" }, { csrf: false });
    const unknown = await api.client().post("/api/v1/auth/login", { username: "mallory", password: "falsch" }, { csrf: false });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(errorOf(wrong).code).toBe(errorOf(unknown).code);
    expect(wrong.json().error.message).toBe(unknown.json().error.message);
  });

  it("throttles repeated failures with RATE_LIMITED and Retry-After, even for the right password", async () => {
    const attacker = api.client();
    let failures = 0;
    for (; failures < 8; failures += 1) {
      const attempt = await attacker.post("/api/v1/auth/login", { username: "owner", password: `falsch-${failures}` }, { csrf: false });
      if (attempt.statusCode === 429) break;
      expect(attempt.statusCode).toBe(401);
    }
    expect(failures, "Sperre nach spätestens 5 Fehlversuchen").toBeLessThanOrEqual(5);
    const locked = await attacker.post("/api/v1/auth/login", { username: "owner", password: PASSWORD }, { csrf: false });
    expect(locked.statusCode).toBe(429);
    expect(errorOf(locked).code).toBe("RATE_LIMITED");
    expect(Number(locked.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("refuses dev auth outside mock data mode", async () => {
    await expect(startTestApi({ authMode: "dev", dataMode: "hybrid" })).rejects.toThrow(/dev auth/i);
  });
});

describe("security: session lifetime", () => {
  it("expires idle sessions and sessions beyond their absolute lifetime", async () => {
    let now = Date.now();
    const api = await startTestApi({ now: () => now });
    try {
      const idle = api.client();
      await idle.loginDev("owner");
      expect((await idle.get("/api/v1/tasks")).statusCode).toBe(200);
      now += (api.config.auth.idleTimeoutMinutes + 1) * 60_000;
      expect((await idle.get("/api/v1/tasks")).statusCode).toBe(401);

      const long = api.client();
      await long.loginDev("owner");
      // keep the session busy so only the absolute lifetime can end it
      const step = Math.floor((api.config.auth.idleTimeoutMinutes * 60_000) / 2);
      const end = now + api.config.auth.sessionTtlMinutes * 60_000;
      while (now + step < end) {
        now += step;
        expect((await long.get("/api/v1/tasks")).statusCode).toBe(200);
      }
      now = end + 1_000;
      expect((await long.get("/api/v1/tasks")).statusCode).toBe(401);
    } finally {
      await api.close();
    }
  });
});
