import { describe, expect, it } from "vitest";
import { MockWorld, handleApiRequest } from "../src";

const BASE = "http://127.0.0.1:3100/api/v1";
const OPTIONS = { approvalTokens: true, simulateLatency: false } as const;

const open = (world: MockWorld, id: string) => handleApiRequest(world, new Request(`${BASE}/approvals/${id}`), OPTIONS);
const approve = (world: MockWorld, id: string, token?: string, body: unknown = { comment: "ok" }) =>
  handleApiRequest(
    world,
    new Request(`${BASE}/approvals/${id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { "X-Approval-Token": token } : {}) },
      body: JSON.stringify(body),
    }),
    OPTIONS,
  );

const pending = (world: MockWorld, tier: number) => {
  const approval = world.state.approvals.find((candidate) => candidate.status === "pending" && candidate.riskTier === tier);
  if (!approval) throw new Error(`no pending tier ${tier} approval`);
  return approval;
};

describe("approval tokens in the standalone mock (PLAN §32.5)", () => {
  it("issues a token with its expiry when a pending approval is opened", async () => {
    const world = new MockWorld();
    const response = await open(world, pending(world, 2).id);
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Approval-Token")).toMatch(/^mat_[0-9a-f]{32}$/);
    expect(Date.parse(response.headers.get("X-Approval-Token-Expires") as string)).toBe(world.nowMs() + 120_000);
  });

  it("issues none for decided approvals or for viewers, and none without the option", async () => {
    const world = new MockWorld();
    const decided = world.state.approvals.find((candidate) => candidate.status !== "pending")!;
    expect((await open(world, decided.id)).headers.get("X-Approval-Token")).toBeNull();
    const pendingId = pending(world, 2).id;
    expect((await handleApiRequest(world, new Request(`${BASE}/approvals/${pendingId}`))).headers.get("X-Approval-Token")).toBeNull();
    world.state.session.role = "viewer";
    expect((await open(world, pendingId)).headers.get("X-Approval-Token")).toBeNull();
  });

  it("refuses an approve without a token (403 APPROVAL_REQUIRED) and does not decide", async () => {
    const world = new MockWorld();
    const approval = pending(world, 2);
    const response = await approve(world, approval.id);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "APPROVAL_REQUIRED", details: { reason: "missing_approval_token" } } });
    expect(world.state.approvals.find((candidate) => candidate.id === approval.id)?.status).toBe("pending");
  });

  it("accepts the issued token exactly once, and only for its own approval", async () => {
    const world = new MockWorld();
    const [a, b] = world.state.approvals.filter((candidate) => candidate.status === "pending" && candidate.riskTier === 2);
    expect(a && b).toBeTruthy();
    const tokenA = (await open(world, a!.id)).headers.get("X-Approval-Token") as string;
    const wrong = await approve(world, b!.id, tokenA);
    expect(wrong.status).toBe(403);
    expect(await wrong.json()).toMatchObject({ error: { code: "APPROVAL_REQUIRED" } });
    // the mismatching attempt burnt the token, like the real service
    expect((await approve(world, a!.id, tokenA)).status).toBe(403);
    const fresh = (await open(world, a!.id)).headers.get("X-Approval-Token") as string;
    const ok = await approve(world, a!.id, fresh);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ data: { id: a!.id, status: expect.stringMatching(/approved|executed/) } });
  });

  it("rejects an expired token", async () => {
    const world = new MockWorld();
    const approval = pending(world, 2);
    const token = (await open(world, approval.id)).headers.get("X-Approval-Token") as string;
    world.clock.advance(121_000);
    const live = world.state.approvals.find((candidate) => candidate.id === approval.id);
    if (live?.status !== "pending") return; // the approval itself timed out first; nothing left to decide
    const response = await approve(world, approval.id, token);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { details: { reason: "expired" } } });
  });

  it("keeps the token for a tier-3 approve that lacks the re-auth token", async () => {
    const world = new MockWorld();
    const approval = pending(world, 3);
    const token = (await open(world, approval.id)).headers.get("X-Approval-Token") as string;
    const first = await approve(world, approval.id, token);
    expect(first.status).toBe(401);
    expect(await first.json()).toMatchObject({ error: { code: "REAUTH_REQUIRED" } });
    // the token was not spent: with a re-auth token the same one still works
    const reauth = await handleApiRequest(world, new Request(`${BASE}/auth/reauth`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "mock" }) }), OPTIONS);
    const reauthToken = ((await reauth.json()) as { reauthToken: string }).reauthToken;
    const second = await approve(world, approval.id, token, { reauthToken });
    expect(second.status).toBe(200);
  });
});
