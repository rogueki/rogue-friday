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

  it("does not redispatch an in-flight approval after restart or a long lease, and fences its receipt", async () => {
    let now = Date.parse("2026-10-19T12:00:00Z");
    const dir = mkdtempSync(join(tmpdir(), "friday-native-dispatch-"));
    const api = await startTestApi({ dir, now: () => now });
    let restarted: Awaited<ReturnType<typeof startTestApi>> | undefined;
    try {
      const owner = api.client();
      await owner.loginDev("owner");
      const ownerId = (await owner.get("/api/v1/auth/session")).json().data.user.id as string;
      const action = { kind: "task.create" as const, body: { title: "Synthetic recovery", priority: "P2" as const } };
      const captured = api.runtime.nativeApprovals.propose({ ...proposal("request-recovery-001", 2), ownerId, execution: action });
      const approvalId = captured.approval!.id;
      api.runtime.nativeApprovals.confirm(ownerId, "request-recovery-001", action);
      const actor = { type: "user" as const, id: ownerId, name: "Owner" };
      const keys: string[] = [];
      let finish!: (taskId: string) => void;
      const dispatch = (_action: NativeExecutableAction, key: string) => { keys.push(key);
        return new Promise<string>((resolve) => { finish = resolve; }); };
      const pending = api.runtime.nativeApprovals.approve(ownerId, approvalId, actor, dispatch);
      expect(api.runtime.nativeApprovals.getApproval(ownerId, approvalId)).toMatchObject({ status: "approved" });
      restarted = await startTestApi({ dir, now: () => now });
      now += 60_001;
      expect(restarted.runtime.nativeApprovals.getApproval(ownerId, approvalId)).toMatchObject({ status: "approved",
        executionResult: expect.stringContaining("noch nicht bestaetigt") });
      await expect(restarted.runtime.nativeApprovals.approve(ownerId, approvalId, actor, dispatch)).rejects.toThrow();
      finish("task_" + "A".repeat(26));
      const decided = await pending;
      expect(decided.status).toBe("executed");
      expect(decided.executionResult).toContain("task_");
      expect(keys).toEqual([`native-approval:${approvalId}`]);
      await expect(restarted.runtime.nativeApprovals.approve(ownerId, approvalId, actor, dispatch)).rejects.toThrow();
      expect(keys).toHaveLength(1);
    } finally { await api.app.close(); await restarted?.app.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  it("records uncertain after a side effect and adapter failure, without resending the action", async () => {
    const api = await startTestApi();
    try {
      const owner = api.client();
      await owner.loginDev("owner");
      const ownerId = (await owner.get("/api/v1/auth/session")).json().data.user.id as string;
      const action = { kind: "task.create" as const, body: { title: "Synthetic uncertain", priority: "P2" as const } };
      const captured = api.runtime.nativeApprovals.propose({ ...proposal("request-uncertain-001", 2), ownerId, execution: action });
      const approvalId = captured.approval!.id;
      api.runtime.nativeApprovals.confirm(ownerId, "request-uncertain-001", action);
      const actor = { type: "user" as const, id: ownerId, name: "Owner" };
      let effects = 0;
      const dispatch = async () => { effects += 1; throw new Error("response lost after create"); };
      await expect(api.runtime.nativeApprovals.approve(ownerId, approvalId, actor, dispatch)).rejects.toThrow("response lost");
      expect(api.runtime.nativeApprovals.getApproval(ownerId, approvalId)).toMatchObject({ status: "approved",
        executionResult: expect.stringContaining("unklar") });
      expect((api.runtime.db.prepare("SELECT state FROM native_approval_requests WHERE owner_id = ? AND request_key = ?")
        .get(ownerId, "request-uncertain-001") as { state: string }).state).toBe("uncertain");
      await expect(api.runtime.nativeApprovals.approve(ownerId, approvalId, actor, dispatch)).rejects.toThrow();
      expect(effects).toBe(1);
    } finally { await api.close(); }
  });

  it("records uncertain for a task.update after a side effect and adapter failure, without resending", async () => {
    const api = await startTestApi();
    try {
      const owner = api.client();
      await owner.loginDev("owner");
      const ownerId = (await owner.get("/api/v1/auth/session")).json().data.user.id as string;
      const action = { kind: "task.update" as const, id: `task_${"D".repeat(26)}`, body: { status: "done" as const } };
      const captured = api.runtime.nativeApprovals.propose({ ...proposal("request-update-uncertain-001", 2), ownerId, execution: action });
      const approvalId = captured.approval!.id;
      api.runtime.nativeApprovals.confirm(ownerId, "request-update-uncertain-001", action);
      const actor = { type: "user" as const, id: ownerId, name: "Owner" };
      let effects = 0;
      const dispatch = async () => { effects += 1; throw new Error("response lost after update"); };
      await expect(api.runtime.nativeApprovals.approve(ownerId, approvalId, actor, dispatch)).rejects.toThrow("response lost");
      expect(api.runtime.nativeApprovals.getApproval(ownerId, approvalId)).toMatchObject({ status: "approved",
        executionResult: expect.stringContaining("unklar") });
      expect((api.runtime.db.prepare("SELECT state FROM native_approval_requests WHERE owner_id = ? AND request_key = ?")
        .get(ownerId, "request-update-uncertain-001") as { state: string }).state).toBe("uncertain");
      await expect(api.runtime.nativeApprovals.approve(ownerId, approvalId, actor, dispatch)).rejects.toThrow();
      expect(effects).toBe(1);
    } finally { await api.close(); }
  });

  it("rejects a task.cancel confirmation that does not match the stored draft", async () => {
    const api = await startTestApi();
    try {
      const owner = api.client();
      await owner.loginDev("owner");
      const ownerId = (await owner.get("/api/v1/auth/session")).json().data.user.id as string;
      const action = { kind: "task.cancel" as const, id: `task_${"E".repeat(26)}` };
      api.runtime.nativeApprovals.propose({ ...proposal("request-cancel-match-001", 2), ownerId, execution: action });
      expect(() => api.runtime.nativeApprovals.confirm(ownerId, "request-cancel-match-001",
        { kind: "task.cancel", id: `task_${"F".repeat(26)}` })).toThrow();
      expect(() => api.runtime.nativeApprovals.confirm(ownerId, "request-cancel-match-001",
        { kind: "task.cancel", id: action.id, body: { reason: "geaendert" } })).toThrow();
      expect(api.runtime.nativeApprovals.confirm(ownerId, "request-cancel-match-001", action).approval?.status).toBe("pending");
    } finally { await api.close(); }
  });

  it("does not let a stale completion overwrite a newer dispatch state", async () => {
    const api = await startTestApi();
    try {
      const owner = api.client();
      await owner.loginDev("owner");
      const ownerId = (await owner.get("/api/v1/auth/session")).json().data.user.id as string;
      const action = { kind: "task.create" as const, body: { title: "Synthetic fence", priority: "P2" as const } };
      const key = "request-fence-001";
      const approvalId = api.runtime.nativeApprovals.propose({ ...proposal(key, 2), ownerId, execution: action }).approval!.id;
      api.runtime.nativeApprovals.confirm(ownerId, key, action);
      let finish!: (id: string) => void;
      const pending = api.runtime.nativeApprovals.approve(ownerId, approvalId,
        { type: "user", id: ownerId, name: "Owner" }, () => new Promise<string>((resolve) => { finish = resolve; }));
      api.runtime.db.prepare("UPDATE native_approval_requests SET state = 'uncertain', dispatch_token = ? WHERE owner_id = ? AND request_key = ?")
        .run("other-attempt", ownerId, key);
      finish("task_" + "B".repeat(26));
      await expect(pending).rejects.toThrow("Ausfuehrungsbeleg");
      const row = api.runtime.db.prepare("SELECT state, receipt_json FROM native_approval_requests WHERE owner_id = ? AND request_key = ?")
        .get(ownerId, key) as { state: string; receipt_json: string | null };
      expect(row).toEqual({ state: "uncertain", receipt_json: null });
    } finally { await api.close(); }
  });

  it("does not repeat a confirmed task action when its response is lost", async () => {
    const api = await startTestApi();
    try {
      const owner = api.client();
      await owner.loginDev("owner");
      const ownerId = (await owner.get("/api/v1/auth/session")).json().data.user.id as string;
      const key = "request-noapproval-001";
      const action = { kind: "task.create" as const, body: { title: "Synthetic direct", priority: "P2" as const } };
      const settings = (await owner.get("/api/v1/settings")).json().data;
      expect((await owner.patch("/api/v1/settings", { approvals: { ...settings.approvals, confirmTier2: false } },
        { headers: { "if-match": String(settings.version) } })).statusCode).toBe(200);
      api.runtime.nativeApprovals.propose({ ...proposal(key, 2), ownerId, execution: action });
      api.runtime.nativeApprovals.confirm(ownerId, key, action);
      let effects = 0;
      const dispatch = async () => { effects += 1; throw new Error("response lost after create"); };
      await expect(api.runtime.nativeApprovals.executeWithoutApproval(ownerId, key, dispatch)).rejects.toThrow("response lost");
      await expect(api.runtime.nativeApprovals.executeWithoutApproval(ownerId, key, dispatch)).rejects.toThrow();
      expect(effects).toBe(1);
    } finally { await api.close(); }
  });
});
