import { ApprovalTokenService, SqliteNonceStore } from "@friday/auth";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { openDatabase } from "../db/database";
import { MessengerSendService, type MessengerDraft } from "./messenger-send";

const draft: MessengerDraft = { accountId: "default", platform: "telegram", recipient: "12345678", text: "Synthetic hello" };
function fixture() {
  const db = openDatabase(":memory:");
  const approvals = new ApprovalTokenService({ key: Buffer.alloc(32, 4), nonceStore: new SqliteNonceStore(db) });
  const invoke = vi.fn(async (_script: string, _distro: string, _user: string, _args: string[], input?: string,
    _timeoutMs?: number): Promise<Record<string, unknown>> =>
    JSON.parse(input ?? "{}").action === "check" ? { state: "configured", revision: "r1" } : { state: "sent", externalId: "synthetic-1" });
  const service = new MessengerSendService(db, "unused", approvals, invoke);
  service.register("owner", draft);
  vi.spyOn(service as unknown as { target: () => { script: string; distro: string; user: string } }, "target")
    .mockReturnValue({ script: "/fixed/messaging_send.py", distro: "Friday-Ubuntu", user: "friday" });
  return { db, service, invoke, approvals };
}

describe("messenger preview and durable send", () => {
  it("invalidates approval after connector or target enrollment changes", async () => {
    const { db, service, invoke } = fixture();
    const preview = await service.preview("owner", draft);
    invoke.mockImplementation(async (_script, _distro, _user, _args, input) =>
      JSON.parse(input ?? "{}").action === "check" ? { state: "configured", revision: "r2" } : { state: "sent", externalId: "synthetic-2" });
    await expect(service.confirm("owner", draft, preview.token, "account-change-key")).rejects.toThrow();
    expect(invoke.mock.calls.filter((call) => JSON.parse(call[4] as string).action === "send")).toHaveLength(0);
    const second = await service.preview("owner", draft);
    const target = service.targets("owner")[0]!;
    service.remove("owner", target.id);
    service.register("owner", draft);
    await expect(service.confirm("owner", draft, second.token, "target-change-key")).rejects.toThrow();
    db.close();
  });

  it("denies a target revoked while the connector check was in flight", async () => {
    const { db, service, invoke } = fixture();
    const preview = await service.preview("owner", draft);
    invoke.mockImplementation(async (_script, _distro, _user, _args, input) => {
      if (JSON.parse(input ?? "{}").action === "check") {
        service.remove("owner", service.targets("owner")[0]!.id);
        return { state: "configured", revision: "r1" };
      }
      return { state: "sent", externalId: "synthetic-3" };
    });
    await expect(service.confirm("owner", draft, preview.token, "revoked-target-key")).rejects.toThrow();
    expect(invoke.mock.calls.filter((call) => JSON.parse(call[4] as string).action === "send")).toHaveLength(0);
    db.close();
  });

  it("separates unavailable configuration probing from absent channel configuration", async () => {
    const { db, service, invoke } = fixture();
    invoke.mockResolvedValue({ state: "rejected", reason: "config_probe_unavailable" });
    await expect(service.preview("owner", draft)).rejects.toThrow("Konfigurationsprüfung ist nicht erreichbar");
    invoke.mockResolvedValue({ state: "rejected", reason: "platform_not_configured" });
    await expect(service.preview("owner", draft)).rejects.toThrow("nicht konfiguriert");
    expect(invoke.mock.calls.every((call) => call[5] === 15000)).toBe(true);
    db.close();
  });

  it("accepts an explicit Matrix user with a colon in its identifier", async () => {
    const { db, service } = fixture();
    const matrix = { ...draft, platform: "matrix", recipient: "@alice:example.org" };
    service.register("owner", matrix);
    const preview = await service.preview("owner", matrix);
    expect(await service.confirm("owner", matrix, preview.token, "matrix-message-key")).toMatchObject({ state: "sent" });
    db.close();
  });
  it("enrolls only source-backed exact IDs for additional native transports", async () => {
    const { db, service } = fixture();
    for (const [platform, recipient] of Object.entries({ teams: "a:conversation_123", google_chat: "spaces/AAAA-123",
      simplex: "group:123", weixin: "wxid_abc123", bluebubbles: "+15551234567",
      dingtalk: "webhook", whatsapp_cloud: "+15551234567", qqbot: "group:open_id_123" })) {
      expect(service.register("owner", { accountId: "default", platform, recipient })).toMatchObject({ platform, recipient });
    }
    for (const [platform, recipient] of Object.entries({ teams: "a/conversation", google_chat: "spaces/../bad",
      simplex: "@displayname", weixin: "friend", bluebubbles: "group name",
      dingtalk: "user123", whatsapp_cloud: "group:123", qqbot: "123456" })) {
      expect(() => service.register("owner", { accountId: "default", platform, recipient })).toThrow();
    }
    await expect(service.preview("owner", { ...draft, platform: "qqbot", recipient: "group:open_id_123",
      text: "x".repeat(4001) })).rejects.toThrow();
    db.close();
  });
  it("binds actor, account, transport, recipient and text; corrections invalidate approval", async () => {
    const { db, service, invoke } = fixture();
    const preview = await service.preview("owner", draft);
    for (const changed of [{ ...draft, recipient: "87654321" }, { ...draft, platform: "discord" }, { ...draft, text: "Changed" }]) {
      await expect(service.confirm("owner", changed, preview.token, "message-key-123")).rejects.toThrow();
    }
    await expect(service.confirm("another-owner", draft, preview.token, "message-key-123")).rejects.toThrow();
    expect(invoke.mock.calls.filter((call) => JSON.parse(call[4] as string).action === "send")).toHaveLength(0);
    expect(await service.confirm("owner", draft, preview.token, "message-key-123")).toMatchObject({ state: "sent", replayed: false });
    expect(await service.confirm("owner", draft, preview.token, "message-key-123")).toMatchObject({ state: "sent", replayed: true });
    expect(invoke.mock.calls.filter((call) => JSON.parse(call[4] as string).action === "send")).toHaveLength(1);
    expect(JSON.parse(invoke.mock.calls.find((call) => JSON.parse(call[4] as string).action === "send")![4] as string)
      .expectedConfigRevision).toBe("r1");
    expect(invoke.mock.calls.find((call) => JSON.parse(call[4] as string).action === "send")![5]).toBe(35000);
    db.close();
  });

  it("reserves before external send and never repeats ambiguous outcome", async () => {
    const { db, service, invoke } = fixture();
    invoke.mockImplementation(async (_script, _distro, _user, _args, input) => {
      if (JSON.parse(input ?? "{}").action === "check") return { state: "configured", revision: "r1" };
      expect(service.receipts("owner")[0]?.state).toBe("pending");
      throw new Error("timeout after possible delivery");
    });
    const preview = await service.preview("owner", draft);
    expect(await service.confirm("owner", draft, preview.token, "message-key-456")).toMatchObject({ state: "uncertain", replayed: false });
    expect(await service.confirm("owner", draft, preview.token, "message-key-456")).toMatchObject({ state: "uncertain", replayed: true });
    expect(invoke.mock.calls.filter((call) => JSON.parse(call[4] as string).action === "send")).toHaveLength(1);
    await expect(service.confirm("owner", { ...draft, text: "different" }, preview.token, "message-key-456")).rejects.toThrow();
    db.close();
  });

  it("rechecks a notification-origin authorization immediately before reserving the send", async () => {
    const { db, service, invoke } = fixture();
    const preview = await service.preview("owner", draft);
    const authorization = vi.fn(() => { throw new Error("origin is no longer actionable"); });
    await expect(service.confirm("owner", draft, preview.token, "origin-denied-key", { beforeSend: authorization })).rejects.toThrow("origin is no longer actionable");
    expect(authorization).toHaveBeenCalledOnce();
    expect(invoke.mock.calls.filter((call) => JSON.parse(call[4] as string).action === "send")).toHaveLength(0);
    expect(service.receipts("owner")).toHaveLength(0);
    db.close();
  });

  it("does not allow completed notification origins to mint a new send when their journal row is absent", async () => {
    const { db, service, invoke } = fixture();
    const originated = { ...draft, notificationId: "ntf_01JAAAAAAAAAAAAAAAAAAAAAAA", notificationStep: 1 };
    service.register("owner", originated);
    const preview = await service.preview("owner", originated);
    await expect(service.confirm("owner", originated, preview.token, "origin-replay-only-key", { replayOnly: true })).rejects.toThrow("kein Versandbeleg");
    expect(invoke.mock.calls.filter((call) => JSON.parse(call[4] as string).action === "send")).toHaveLength(0);
    db.close();
  });

  it("allows only one concurrent confirm of a preview", async () => {
    const { db, service, invoke } = fixture();
    const preview = await service.preview("owner", draft);
    const results = await Promise.allSettled([
      service.confirm("owner", draft, preview.token, "concurrent-key-a"),
      service.confirm("owner", draft, preview.token, "concurrent-key-b"),
    ]);
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(invoke.mock.calls.filter((call) => JSON.parse(call[4] as string).action === "send")).toHaveLength(1);
    db.close();
  });

  it("keeps uncertain receipt across DB reopen and rejects wrong account", async () => {
    const directory = mkdtempSync(join(tmpdir(), "friday-messenger-"));
    try {
      const path = join(directory, "journal.sqlite");
      const db = openDatabase(path);
      const approvals = new ApprovalTokenService({ key: Buffer.alloc(32, 5), nonceStore: new SqliteNonceStore(db) });
      const invoke = vi.fn(async (_script: string, _distro: string, _user: string, _args: string[], input?: string) =>
        JSON.parse(input ?? "{}").action === "check" ? { state: "configured", revision: "r1" } : { state: "uncertain" });
      const first = new MessengerSendService(db, "unused", approvals, invoke);
      first.register("owner", draft);
      vi.spyOn(first as unknown as { target: () => { script: string; distro: string; user: string } }, "target")
        .mockReturnValue({ script: "/fixed/messaging_send.py", distro: "Friday-Ubuntu", user: "friday" });
      await expect(first.preview("owner", { ...draft, accountId: "other" } as never)).rejects.toThrow();
      const preview = await first.preview("owner", draft);
      expect(await first.confirm("owner", draft, preview.token, "restart-key-123")).toMatchObject({ state: "uncertain" });
      db.prepare("UPDATE messenger_send_journal SET state='pending'").run();
      db.close();
      const reopened = openDatabase(path);
      const second = new MessengerSendService(reopened, "unused", new ApprovalTokenService({
        key: Buffer.alloc(32, 5), nonceStore: new SqliteNonceStore(reopened),
      }), invoke);
      expect(await second.confirm("owner", draft, preview.token, "restart-key-123")).toMatchObject({ state: "uncertain", replayed: true });
      expect(invoke.mock.calls.filter((call) => JSON.parse(call[4] as string).action === "send")).toHaveLength(1);
      reopened.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
