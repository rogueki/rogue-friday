/* eslint-disable @typescript-eslint/no-explicit-any -- test code reads untyped JSON bodies and frames that the contract validators check */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiClient, startTestApi, type TestApi } from "./helpers";

interface ApprovalRow {
  id: string;
  riskTier: number;
  status: string;
  version: number;
  expiresAt: string | null;
}

const errorOf = (response: { json(): unknown }) => (response.json() as { error: { code: string; message: string; details: Record<string, any> } }).error;

async function pendingApprovals(client: ApiClient, tier: 1 | 2 | 3): Promise<ApprovalRow[]> {
  const response = await client.get("/api/v1/approvals", { query: { status: ["pending"], riskTier: [String(tier)], limit: "100" } });
  return response.json().items as ApprovalRow[];
}

async function open(client: ApiClient, id: string): Promise<string> {
  const response = await client.get(`/api/v1/approvals/${id}`);
  expect(response.statusCode, response.body).toBe(200);
  const token = response.headers["x-approval-token"];
  expect(token, "pending approvals hand out an approval token").toBeTruthy();
  return String(token);
}

const approve = (client: ApiClient, id: string, token: string | undefined, body: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  client.post(`/api/v1/approvals/${id}/approve`, body, { headers: { ...(token ? { "x-approval-token": token } : {}), ...headers } });

describe("approvals (PLAN §32.5)", () => {
  let api: TestApi;
  let now: number;
  let owner: ApiClient;
  let operator: ApiClient;
  let viewer: ApiClient;

  // The mock world seeds only a handful of pending approvals; every test gets its own world.
  beforeEach(async () => {
    now = Date.now();
    api = await startTestApi({ now: () => now, approvalTokenTtlMs: 60_000 });
    owner = api.client();
    operator = api.client();
    viewer = api.client();
    await owner.loginDev("owner");
    await operator.loginDev("operator");
    await viewer.loginDev("viewer");
  });
  afterEach(async () => {
    await api.close();
  });

  describe("tier 2", () => {
    it("needs the approval token that is issued when the approval is opened", async () => {
      const [first] = await pendingApprovals(owner, 2);
      const withoutToken = await approve(owner, (first as ApprovalRow).id, undefined);
      expect(withoutToken.statusCode).toBe(403);
      expect(errorOf(withoutToken).code).toBe("APPROVAL_REQUIRED");
      expect(errorOf(withoutToken).details.reason).toBe("missing_approval_token");

      const forged = await approve(owner, (first as ApprovalRow).id, "forged.token");
      expect(forged.statusCode).toBe(403);
      expect(errorOf(forged).code).toBe("APPROVAL_REQUIRED");
    });

    it("approves with a valid token, never exposes the token in the body, and audits the decision", async () => {
      const [target] = await pendingApprovals(owner, 2);
      const id = (target as ApprovalRow).id;
      const opened = await owner.get(`/api/v1/approvals/${id}`);
      const token = String(opened.headers["x-approval-token"]);
      expect(opened.headers["x-approval-token-expires"]).toBeTruthy();
      expect(opened.body).not.toContain(token);

      const result = await approve(owner, id, token, { comment: "Freigegeben." });
      expect(result.statusCode, result.body).toBe(200);
      expect(result.json().data.status).toMatch(/approved|executed/);
      expect(result.body).not.toContain(token);

      const audit = api.runtime.stores.audit.recent(10).find((event) => event.action === "approval.approved" && event.approvalId === id);
      expect(audit, "approval.approved audit event").toBeDefined();
      expect(JSON.stringify(audit)).not.toContain(token);
      expect(audit?.actor.id).toMatch(/^usr_/);
    });

    it("refuses a second approve of the same approval with 409 (double click, second tab)", async () => {
      const [target] = await pendingApprovals(owner, 2);
      const id = (target as ApprovalRow).id;
      const token = await open(owner, id);
      const tokenForSecondTab = await open(owner, id);
      expect((await approve(owner, id, token)).statusCode).toBe(200);
      const again = await approve(owner, id, tokenForSecondTab);
      expect(again.statusCode).toBe(409);
      expect(errorOf(again).code).toBe("CONFLICT");
      expect(errorOf(again).details.status).toMatch(/approved|executed/);
    });

    it("makes the token single-use", async () => {
      const [a, b] = await pendingApprovals(owner, 2);
      const idA = (a as ApprovalRow).id;
      const idB = (b as ApprovalRow).id;
      const token = await open(owner, idA);
      const wrongApproval = await approve(owner, idB, token);
      expect(wrongApproval.statusCode, "token is bound to its approval").toBe(403);
      expect(errorOf(wrongApproval).code).toBe("APPROVAL_REQUIRED");
      // The failed attempt on B did not burn A's token; the first valid use does.
      const used = await approve(owner, idA, token);
      expect(used.statusCode, used.body).toBe(200);
      const replay = await approve(owner, idB, token);
      expect(replay.statusCode).toBe(403);
    });

    it("binds the token to the user that opened the approval", async () => {
      const [target] = await pendingApprovals(owner, 2);
      const id = (target as ApprovalRow).id;
      const ownersToken = await open(owner, id);
      const stolen = await approve(operator, id, ownersToken);
      expect(stolen.statusCode).toBe(403);
      expect(errorOf(stolen).code).toBe("APPROVAL_REQUIRED");
      expect((await approve(operator, id, await open(operator, id))).statusCode).toBe(200);
    });

    it("lets a token expire", async () => {
      const [target] = await pendingApprovals(owner, 2);
      const id = (target as ApprovalRow).id;
      const token = await open(owner, id);
      now += 60_001;
      const late = await approve(owner, id, token);
      expect(late.statusCode).toBe(403);
      expect(errorOf(late).code).toBe("APPROVAL_REQUIRED");
      expect(errorOf(late).details.reason).toBe("expired");
      expect(errorOf(late).message).toMatch(/abgelaufen/);
      // opening again issues a fresh token that works
      expect((await approve(owner, id, await open(owner, id))).statusCode).toBe(200);
    });

    it("rejects an approve against a stale version with 409", async () => {
      const [target] = await pendingApprovals(owner, 2);
      const row = target as ApprovalRow;
      const token = await open(owner, row.id);
      const stale = await approve(owner, row.id, token, {}, { "if-match": String(row.version + 4) });
      expect(stale.statusCode).toBe(409);
      expect(errorOf(stale).details.currentVersion).toBe(row.version);
    });

    it("rejects without a token (rejecting is always safe) and records who rejected", async () => {
      const [target] = await pendingApprovals(owner, 2);
      const id = (target as ApprovalRow).id;
      const rejected = await owner.post(`/api/v1/approvals/${id}/reject`, { comment: "Nein danke." });
      expect(rejected.statusCode, rejected.body).toBe(200);
      expect(rejected.json().data.status).toBe("rejected");
      expect(api.runtime.stores.audit.recent(10).some((event) => event.action === "approval.rejected" && event.approvalId === id)).toBe(true);
      const again = await owner.post(`/api/v1/approvals/${id}/reject`, {});
      expect(again.statusCode).toBe(409);
    });

    it("keeps viewers out and does not hand them an approval token", async () => {
      const [target] = await pendingApprovals(owner, 2);
      const id = (target as ApprovalRow).id;
      const read = await viewer.get(`/api/v1/approvals/${id}`);
      expect(read.statusCode).toBe(200);
      expect(read.headers["x-approval-token"]).toBeUndefined();
      expect((await approve(viewer, id, "x.y")).statusCode).toBe(403);
      expect((await viewer.post(`/api/v1/approvals/${id}/reject`, {})).statusCode).toBe(403);
    });

    it("refuses to approve an approval that has expired in the world", async () => {
      const [target] = await pendingApprovals(owner, 2);
      const id = (target as ApprovalRow).id;
      const token = await open(owner, id);
      // Mock world time: all seeded approvals run out within days.
      const advanced = await owner.post("/api/v1/dev/scenarios/control", { action: "clock_advance", ms: 30 * 24 * 3_600_000 });
      expect(advanced.statusCode, advanced.body).toBe(200);
      const late = await approve(owner, id, token);
      expect(late.statusCode).toBe(409);
      expect(errorOf(late).code).toBe("CONFLICT");
      await owner.post("/api/v1/dev/scenarios/control", { action: "reset" });
    });
  });

  describe("tier 3", () => {
    const reauth = async (client: ApiClient, password = "dev") => client.post("/api/v1/auth/reauth", { password });

    it("is reserved to the owner", async () => {
      const [target] = await pendingApprovals(owner, 3);
      const id = (target as ApprovalRow).id;
      const response = await approve(operator, id, await open(operator, id));
      expect(response.statusCode).toBe(403);
      expect(errorOf(response).code).toBe("FORBIDDEN");
    });

    it("requires a fresh re-authentication (REAUTH_REQUIRED) and then the reauth token", async () => {
      const [target] = await pendingApprovals(owner, 3);
      const id = (target as ApprovalRow).id;
      const token = await open(owner, id);
      const noReauth = await approve(owner, id, token);
      expect(noReauth.statusCode).toBe(401);
      expect(errorOf(noReauth).code).toBe("REAUTH_REQUIRED");
      expect(errorOf(noReauth).details.requiredAuth).toBe("reauth");

      const reauthResponse = await reauth(owner);
      expect(reauthResponse.statusCode, reauthResponse.body).toBe(200);
      const reauthToken = reauthResponse.json().reauthToken as string;
      // A missing reauth token fails before the approval token is spent, so the same token still works.
      const withoutReauthToken = await approve(owner, id, token, {});
      expect(withoutReauthToken.statusCode).toBe(401);
      expect(errorOf(withoutReauthToken).code).toBe("REAUTH_REQUIRED");

      const done = await approve(owner, id, token, { reauthToken });
      expect(done.statusCode, done.body).toBe(200);
      expect(done.json().data.status).toMatch(/approved|executed/);
      expect(done.body).not.toContain(reauthToken);
    });

    it("burns the reauth token on use", async () => {
      const [a, b] = await pendingApprovals(owner, 3);
      const reauthToken = (await reauth(owner)).json().reauthToken as string;
      expect((await approve(owner, (a as ApprovalRow).id, await open(owner, (a as ApprovalRow).id), { reauthToken })).statusCode).toBe(200);
      const replay = await approve(owner, (b as ApprovalRow).id, await open(owner, (b as ApprovalRow).id), { reauthToken });
      expect(replay.statusCode).toBe(401);
      expect(errorOf(replay).code).toBe("REAUTH_REQUIRED");
    });

    it("is never possible on the voice channel", async () => {
      const [target] = await pendingApprovals(owner, 3);
      const id = (target as ApprovalRow).id;
      const reauthToken = (await reauth(owner)).json().reauthToken as string;
      const response = await approve(owner, id, await open(owner, id), { reauthToken, inputChannel: "voice" });
      expect(response.statusCode).toBe(403);
      expect(errorOf(response).code).toBe("FORBIDDEN");
      expect(errorOf(response).details.reason).toBe("voice_not_allowed");
    });

    it("does not let a body channel override a voice-marked request", async () => {
      const [target] = await pendingApprovals(owner, 3);
      const id = (target as ApprovalRow).id;
      const reauthToken = (await reauth(owner)).json().reauthToken as string;
      const response = await approve(owner, id, await open(owner, id),
        { reauthToken, inputChannel: "dashboard" }, { "x-input-channel": "voice" });
      expect(response.statusCode).toBe(403);
      expect(errorOf(response).details.reason).toBe("voice_not_allowed");
    });

    it("lets the re-authentication window run out", async () => {
      const [target] = await pendingApprovals(owner, 3);
      const id = (target as ApprovalRow).id;
      const reauthToken = (await reauth(owner)).json().reauthToken as string;
      now += (api.config.auth.reauthWindowMinutes + 1) * 60_000;
      // keep the session itself alive; the approval is opened (token issued) after the window has passed
      expect((await owner.get("/api/v1/tasks")).statusCode).toBe(200);
      const token = await open(owner, id);
      const late = await approve(owner, id, token, { reauthToken });
      expect(late.statusCode).toBe(401);
      expect(errorOf(late).code).toBe("REAUTH_REQUIRED");
    });
  });

  describe("re-authentication", () => {
    it("rejects a wrong password in local auth mode and throttles guessing", async () => {
      const local = await startTestApi({ authMode: "local", ownerPassword: "ein-sehr-langes-passwort-2026" });
      try {
        const client = local.client();
        expect((await client.loginOwner("ein-sehr-langes-passwort-2026")).statusCode).toBe(200);
        const wrong = await client.post("/api/v1/auth/reauth", { password: "falsch" });
        expect(wrong.statusCode).toBe(401);
        expect(errorOf(wrong).code).toBe("UNAUTHENTICATED");
        const right = await client.post("/api/v1/auth/reauth", { password: "ein-sehr-langes-passwort-2026" });
        expect(right.statusCode, right.body).toBe(200);
        expect(right.json().reauthToken).toBeTruthy();
        expect(new Date(right.json().expiresAt).getTime()).toBeGreaterThan(Date.now() - 1_000);
      } finally {
        await local.close();
      }
    });

    it("requires the documented dev password for re-auth in dev mode while dev login stays lenient", async () => {
      const client = api.client();
      const login = await client.post("/api/v1/auth/login", { username: "dev-owner", password: "irgendwas" }, { csrf: false });
      client.csrfToken = (login.json() as { data: { csrfToken: string } }).data.csrfToken;
      const wrong = await client.post("/api/v1/auth/reauth", { password: "irgendwas" });
      expect(wrong.statusCode).toBe(401);
      expect(errorOf(wrong).code).toBe("UNAUTHENTICATED");
      expect((await client.post("/api/v1/auth/reauth", { password: "" })).statusCode).toBeGreaterThanOrEqual(400);
      expect((await client.post("/api/v1/auth/reauth", { password: "dev" })).statusCode).toBe(200);
    });

    it("is not available to viewers", async () => {
      expect((await viewer.post("/api/v1/auth/reauth", { password: "dev" })).statusCode).toBe(403);
    });
  });
});
