import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { openDatabase } from "../src/db/database";
import { HimalayaSendService } from "../src/services/himalaya-send";
import type { HimalayaAccountService } from "../src/services/himalaya-account";
import { startTestApi } from "./helpers";

const message = { to: ["recipient@example.test"], subject: "Test", body: "A short synthetic message" };
const ready = { readyForLocalUse: true } as Awaited<ReturnType<HimalayaAccountService["status"]>>;

describe("Himalaya SMTP send journal", () => {
  it("reserves before SMTP and replays across parallel calls and database restart", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "friday-mail-send-")), "journal.sqlite");
    let db = openDatabase(path);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const sendRaw = vi.fn(async () => blocked);
    const account = { status: vi.fn(async () => ready), sendRaw };
    const service = new HimalayaSendService(db, account);
    const first = service.send(message, "owner", "key-12345678");
    await vi.waitFor(() => expect(sendRaw).toHaveBeenCalledTimes(1));
    expect(await service.send(message, "owner", "key-12345678")).toEqual({ state: "unknown", replayed: true });
    await expect(service.send({ ...message, subject: "Other" }, "owner", "key-12345678")).rejects.toThrow();
    release();
    expect(await first).toEqual({ state: "sent", replayed: false });
    db.close();
    db = openDatabase(path);
    expect(await new HimalayaSendService(db, account).send(message, "owner", "key-12345678"))
      .toEqual({ state: "sent", replayed: true });
    expect(sendRaw).toHaveBeenCalledTimes(1);
    db.close();
  });

  it("keeps ambiguous SMTP outcome permanently unknown and stores no message text", async () => {
    const db = openDatabase(":memory:");
    const sendRaw = vi.fn(async () => { throw new Error("timeout after SMTP acceptance"); });
    const service = new HimalayaSendService(db, { status: async () => ready, sendRaw });
    expect(await service.send(message, "owner", "key-12345678")).toEqual({ state: "unknown", replayed: false });
    expect(await service.send(message, "owner", "key-12345678")).toEqual({ state: "unknown", replayed: true });
    expect(sendRaw).toHaveBeenCalledTimes(1);
    const row = db.prepare("SELECT * FROM himalaya_send_journal").get();
    expect(JSON.stringify(row)).not.toContain(message.body);
    expect(JSON.stringify(row)).not.toContain(message.to[0]);
    db.close();
  });

  it("rejects injected headers and fails before reservation when no account exists", async () => {
    const db = openDatabase(":memory:");
    const sendRaw = vi.fn();
    const service = new HimalayaSendService(db, { status: async () => ({ ...ready, readyForLocalUse: false }), sendRaw });
    await expect(service.send({ ...message, subject: "Hi\r\nBcc: x@example.test" }, "owner", "key-12345678")).rejects.toThrow();
    await expect(service.send(message, "owner", "key-12345678")).rejects.toThrow();
    expect(db.prepare("SELECT COUNT(*) AS count FROM himalaya_send_journal").get()).toMatchObject({ count: 0 });
    expect(sendRaw).not.toHaveBeenCalled();
    db.close();
  });

  it("requires an owner session and CSRF at the send route", async () => {
    const api = await startTestApi({ authMode: "local", ownerPassword: "synthetic-test-password" });
    try {
      const guest = api.client();
      expect((await guest.post("/api/v1/communication/himalaya/send", message, { headers: { "Idempotency-Key": "key-12345678" } })).statusCode).toBe(401);
      const owner = api.client();
      await owner.loginOwner("synthetic-test-password");
      expect((await owner.post("/api/v1/communication/himalaya/send", message, { csrf: false, headers: { "Idempotency-Key": "key-12345678" } })).statusCode).toBe(403);
    } finally { await api.close(); }
  });

  it("sends once through the authenticated route and replays the same key", async () => {
    const api = await startTestApi({ authMode: "local", ownerPassword: "synthetic-test-password", responseValidation: "throw" });
    try {
      const sendRaw = vi.spyOn(api.runtime.himalayaAccount, "sendRaw").mockResolvedValue();
      vi.spyOn(api.runtime.himalayaAccount, "status").mockResolvedValue(ready);
      const owner = api.client();
      await owner.loginOwner("synthetic-test-password");
      const headers = { "Idempotency-Key": "key-12345678" };
      const first = await owner.post("/api/v1/communication/himalaya/send", message, { headers });
      expect(first.statusCode).toBe(200);
      expect(first.json().data).toEqual({ state: "sent", replayed: false });
      const replay = await owner.post("/api/v1/communication/himalaya/send", message, { headers });
      expect(replay.json().data).toEqual({ state: "sent", replayed: true });
      expect(sendRaw).toHaveBeenCalledTimes(1);
      const conflict = await owner.post("/api/v1/communication/himalaya/send", { ...message, subject: "Another" }, { headers });
      expect(conflict.statusCode).toBe(409);
    } finally { await api.close(); }
  });
});
