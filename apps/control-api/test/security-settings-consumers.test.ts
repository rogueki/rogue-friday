import { afterEach, describe, expect, it } from "vitest";
import { startTestApi, type TestApi } from "./helpers";

const opened: TestApi[] = [];
const start = async (now: () => number) => {
  const api = await startTestApi({ now });
  opened.push(api);
  return api;
};
afterEach(async () => { for (const api of opened.splice(0)) await api.close(); });

describe("security settings runtime consumers", () => {
  it("tightens an existing session immediately, issues new sessions with the configured timeout, and never revives an expired session", async () => {
    let clock = Date.parse("2026-10-19T12:00:00Z");
    const api = await start(() => clock);
    const owner = api.client();
    await owner.loginDev("owner");
    const original = (await owner.get("/api/v1/settings")).json().data;
    const saved = await owner.patch("/api/v1/settings", { security: { ...original.security, sessionTimeoutMinutes: 1 } },
      { headers: { "if-match": String(original.version) } });
    expect(saved.statusCode, saved.body).toBe(200);
    const active = (await owner.get("/api/v1/auth/session")).json().data;
    expect(active.expiresAt).toBe(new Date(clock + 60_000).toISOString());

    clock += 61_000;
    expect((await owner.get("/api/v1/tasks")).statusCode).toBe(401);
    const stale = api.client();
    stale.cookies = new Map(owner.cookies);
    expect((await stale.get("/api/v1/tasks")).statusCode).toBe(401);
    expect((await owner.get("/api/v1/auth/session")).json().data.authenticated).toBe(true); // dev bootstrap issues a fresh owner session
    const fresh = api.client();
    await fresh.loginDev("owner");
    expect((await fresh.get("/api/v1/auth/session")).json().data.expiresAt).toBe(new Date(clock + 60_000).toISOString());
  });

  it("uses the saved reauth window for the session response and tier-3 decision", async () => {
    let clock = Date.parse("2026-10-19T12:00:00Z");
    const api = await start(() => clock);
    const owner = api.client();
    await owner.loginDev("owner");
    const original = (await owner.get("/api/v1/settings")).json().data;
    expect((await owner.patch("/api/v1/settings", { security: { ...original.security, reauthWindowMinutes: 1 } },
      { headers: { "if-match": String(original.version) } })).statusCode).toBe(200);
    expect((await owner.get("/api/v1/auth/session")).json().data.reauthUntil).toBe(new Date(clock + 60_000).toISOString());
    const approvals = (await owner.get("/api/v1/approvals", { query: { status: ["pending"], riskTier: ["3"], limit: "100" } })).json().items;
    expect(approvals.length).toBeGreaterThan(0);
    const id = approvals[0].id as string;
    const opened = await owner.get(`/api/v1/approvals/${id}`);
    clock += 61_000;
    expect((await owner.get("/api/v1/auth/session")).json().data.reauthUntil).toBeNull();
    const decision = await owner.post(`/api/v1/approvals/${id}/approve`, {},
      { headers: { "x-approval-token": String(opened.headers["x-approval-token"]) } });
    expect(decision.statusCode, decision.body).toBe(401);
    expect(decision.json().error.code).toBe("REAUTH_REQUIRED");
  });

  it("caps a remembered session and its cookie at the configured absolute lifetime", async () => {
    const clock = Date.parse("2026-10-19T12:00:00Z");
    const api = await startTestApi({ now: () => clock, authMode: "local", ownerPassword: "long-synthetic-owner-password" });
    opened.push(api);
    const owner = api.client();
    const login = await owner.post("/api/v1/auth/login", { username: "owner", password: "long-synthetic-owner-password" }, { csrf: false });
    expect(login.statusCode).toBe(200);
    owner.csrfToken = login.json().data.csrfToken;
    const settings = (await owner.get("/api/v1/settings")).json().data;
    const updated = await owner.patch("/api/v1/settings", { security: { ...settings.security, sessionTimeoutMinutes: 5 } },
      { headers: { "if-match": String(settings.version) } });
    expect(updated.statusCode, updated.body).toBe(200);
    const remembered = await api.client().post("/api/v1/auth/login",
      { username: "owner", password: "long-synthetic-owner-password", rememberMe: true }, { csrf: false });
    expect(remembered.statusCode).toBe(200);
    expect(remembered.json().data.expiresAt).toBe(new Date(clock + 5 * 60_000).toISOString());
    expect(String(remembered.headers["set-cookie"])).toContain("Max-Age=300");
  });

  it("applies trusted origins per request, rejects malformed or unavailable security changes, and preserves the prior policy", async () => {
    const api = await start(() => Date.parse("2026-10-19T12:00:00Z"));
    const owner = api.client();
    await owner.loginDev("owner");
    const original = (await owner.get("/api/v1/settings")).json().data;
    const trusted = "https://trusted.example";
    const saved = await owner.patch("/api/v1/settings", { security: { ...original.security, trustedOrigins: [...original.security.trustedOrigins, trusted] } },
      { headers: { "if-match": String(original.version) } });
    expect(saved.statusCode, saved.body).toBe(200);
    const allowed = await owner.post("/api/v1/tasks", { title: "allowed" }, { headers: { origin: trusted } });
    expect(allowed.statusCode).toBe(403);
    expect(allowed.json().error).toMatchObject({ code: "APPROVAL_REQUIRED", details: { stage: "preview" } });
    const version = saved.json().data.version as number;
    for (const security of [
      { ...original.security, trustedOrigins: ["https://evil.example/path"] },
      { ...original.security, allowRemoteAccess: true },
      { ...original.security, auditHashChain: false },
      { ...original.security, trustedOrigins: null },
    ]) {
      const rejected = await owner.patch("/api/v1/settings", { security }, { headers: { "if-match": String(version) } });
      expect(rejected.statusCode).toBe(422);
      expect((await owner.get("/api/v1/settings")).json().data.version).toBe(version);
      const stillAllowed = await owner.post("/api/v1/tasks", { title: "still allowed" }, { headers: { origin: trusted } });
      expect(stillAllowed.statusCode).toBe(403);
      expect(stillAllowed.json().error).toMatchObject({ code: "APPROVAL_REQUIRED", details: { stage: "preview" } });
    }
  });
});
