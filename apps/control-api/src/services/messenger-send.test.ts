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
  const invoke = vi.fn(async (_script: string, _distro: string, _user: string, _args: string[], input?: string) =>
    JSON.parse(input ?? "{}").action === "check" ? { state: "ready" } : { state: "sent", externalId: "synthetic-1" });
  const service = new MessengerSendService(db, "unused", approvals, invoke);
  vi.spyOn(service as unknown as { target: () => { script: string; distro: string; user: string } }, "target")
    .mockReturnValue({ script: "/fixed/messaging_send.py", distro: "Friday-Ubuntu", user: "friday" });
  return { db, service, invoke, approvals };
}

describe("messenger preview and durable send", () => {
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
    db.close();
  });

  it("reserves before external send and never repeats ambiguous outcome", async () => {
    const { db, service, invoke } = fixture();
    invoke.mockImplementation(async (_script, _distro, _user, _args, input) => {
      if (JSON.parse(input ?? "{}").action === "check") return { state: "ready" };
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
        JSON.parse(input ?? "{}").action === "check" ? { state: "ready" } : { state: "uncertain" });
      const first = new MessengerSendService(db, "unused", approvals, invoke);
      vi.spyOn(first as unknown as { target: () => { script: string; distro: string; user: string } }, "target")
        .mockReturnValue({ script: "/fixed/messaging_send.py", distro: "Friday-Ubuntu", user: "friday" });
      await expect(first.preview("owner", { ...draft, accountId: "other" } as never)).rejects.toThrow();
      const preview = await first.preview("owner", draft);
      expect(await first.confirm("owner", draft, preview.token, "restart-key-123")).toMatchObject({ state: "uncertain" });
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
