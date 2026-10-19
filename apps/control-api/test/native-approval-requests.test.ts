import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startTestApi } from "./helpers";
import type { NativeApprovalProposal, NativeExecutableAction } from "../src/services/native-approval-requests";

const CORRELATION = `corr_${"A".repeat(26)}`;
const proposal = (requestKey: string, riskTier: 1 | 2 | 3): NativeApprovalProposal => ({
  ownerId: "owner-one",
  requestKey, correlationId: CORRELATION, riskTier, type: "send_message",
  action: "Nachricht versenden", rationale: "Gepruefter Empfaenger und Inhalt",
  preview: { kind: "message", title: "Nachricht", body: "Synthetischer Inhalt" }, impacts: [],
});

describe("native approval request policy capture", () => {
  it("persists new terms only, retains old pending terms and is idempotent across restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "friday-native-approval-"));
    const clock = Date.parse("2026-10-19T12:00:00Z");
    let first: Awaited<ReturnType<typeof startTestApi>> | undefined;
    let second: Awaited<ReturnType<typeof startTestApi>> | undefined;
    try {
      first = await startTestApi({ dir, now: () => clock });
      const initial = first.runtime.nativeApprovals.propose(proposal("request-old-001", 2));
      const oldMock = first.runtime.world!.approvals.raise({ type: "send_message", action: "Alt", riskTier: 2,
        rationale: "Test", preview: { kind: "message", title: "Alt", body: "synthetisch" } });
      expect(initial.approval).toMatchObject({ status: "pending", requiredAuth: "confirm", riskTier: 2 });
      expect(initial.approval?.expiresAt).toBe(new Date(clock + 60 * 60_000).toISOString());
      expect(initial).toMatchObject({ draftOnly: true, notifyOnRequest: true, requiresApproval: true });
      const owner = first.client();
      await owner.loginDev("owner");
      const settings = (await owner.get("/api/v1/settings")).json().data;
      const changed = await owner.patch("/api/v1/settings", { approvals: {
        ...settings.approvals, defaultExpiryMinutes: 5, draftOnlyByDefault: false,
        confirmTier2: false, notifyOnRequest: false,
      } }, { headers: { "if-match": String(settings.version) } });
      expect(changed.statusCode, changed.body).toBe(200);

      const newMock = first.runtime.world!.approvals.raise({ type: "send_message", action: "Neu", riskTier: 2,
        rationale: "Test", preview: { kind: "message", title: "Neu", body: "synthetisch" } });
      expect(oldMock.expiresAt).toBe(new Date(Date.parse(oldMock.createdAt) + 60 * 60_000).toISOString());
      expect(first.runtime.world!.approvals.get(oldMock.id).requiredAuth).toBe("confirm");
      expect(newMock.expiresAt).toBe(new Date(Date.parse(newMock.createdAt) + 5 * 60_000).toISOString());
      expect(newMock.requiredAuth).toBe("none");

      expect(first.runtime.nativeApprovals.propose(proposal("request-old-001", 2))).toEqual(initial);
      const tier2 = first.runtime.nativeApprovals.propose(proposal("request-new-002", 2));
      expect(tier2).toMatchObject({ draftOnly: false, notifyOnRequest: false, requiresApproval: false, approval: null });
      const tier3 = first.runtime.nativeApprovals.propose(proposal("request-new-003", 3));
      expect(tier3.approval).toMatchObject({ requiredAuth: "reauth", status: "pending" });
      expect(tier3.approval?.expiresAt).toBe(new Date(clock + 5 * 60_000).toISOString());
      expect(tier3.notifyOnRequest).toBe(false);
      expect(() => first?.runtime.nativeApprovals.propose({ ...proposal("request-old-001", 2), action: "Andere Aktion" })).toThrow();

      await first.app.close();
      first = undefined;
      second = await startTestApi({ dir, now: () => clock + 1_000 });
      expect(second.runtime.nativeApprovals.get("owner-one", "request-old-001")).toEqual(initial);
      expect(second.runtime.nativeApprovals.get("owner-two", "request-old-001")).toBeNull();
      const otherOwner = second.runtime.nativeApprovals.propose({ ...proposal("request-old-001", 2), ownerId: "owner-two", action: "Eigene Aktion" });
      expect(otherOwner.approval?.id).not.toBe(initial.approval?.id);
      expect(second.runtime.nativeApprovals.propose(proposal("request-new-003", 3))).toEqual(tier3);
    } finally {
      await first?.app.close();
      await second?.app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects weakening tier-3 reauth and preserves the effective policy", async () => {
    const api = await startTestApi();
    try {
      const owner = api.client();
      await owner.loginDev("owner");
      const settings = (await owner.get("/api/v1/settings")).json().data;
      const response = await owner.patch("/api/v1/settings", { approvals: { ...settings.approvals, reauthTier3: false } },
        { headers: { "if-match": String(settings.version) } });
      expect(response.statusCode).toBe(422);
      expect((await owner.get("/api/v1/settings")).json().data.approvals.reauthTier3).toBe(true);
      expect(api.runtime.nativeApprovals.propose(proposal("request-tier3-001", 3)).approval?.requiredAuth).toBe("reauth");
    } finally {
      await api.close();
    }
  });

  it("reclaims a crashed task dispatch with the same key and preserves one receipt", async () => {
    let now = Date.parse("2026-10-19T12:00:00Z");
    const api = await startTestApi({ now: () => now });
    try {
      const owner = api.client();
      await owner.loginDev("owner");
      const ownerId = (await owner.get("/api/v1/auth/session")).json().data.user.id as string;
      const action = { kind: "task.create" as const, body: { title: "Synthetic recovery", priority: "P2" as const } };
      const captured = api.runtime.nativeApprovals.propose({ ...proposal("request-recovery-001", 2), ownerId, execution: action });
      const approvalId = captured.approval!.id;
      api.runtime.nativeApprovals.confirm(ownerId, "request-recovery-001", action);
      api.runtime.db.prepare("UPDATE native_approval_requests SET state = 'dispatching', updated_at = ? WHERE owner_id = ? AND request_key = ?")
        .run(now, ownerId, "request-recovery-001");
      const actor = { type: "user" as const, id: ownerId, name: "Owner" };
      const keys: string[] = [];
      const dispatch = async (_action: NativeExecutableAction, key: string) => { keys.push(key); return "task_" + "A".repeat(26); };
      await expect(api.runtime.nativeApprovals.approve(ownerId, approvalId, actor, dispatch)).rejects.toThrow();
      now += 30_001;
      const decided = await api.runtime.nativeApprovals.approve(ownerId, approvalId, actor, dispatch);
      expect(decided.status).toBe("executed");
      expect(decided.executionResult).toContain("task_");
      expect(keys).toEqual([`native-approval:${approvalId}`]);
      await expect(api.runtime.nativeApprovals.approve(ownerId, approvalId, actor, dispatch)).rejects.toThrow();
      expect(keys).toHaveLength(1);
    } finally { await api.close(); }
  });
});
