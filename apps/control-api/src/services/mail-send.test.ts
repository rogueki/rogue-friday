import { describe, expect, it, vi } from "vitest";
import { openDatabase } from "../db/database";
import { MailSendService } from "./mail-send";

const request = { to: ["recipient@example.test"], subject: "Fixture", body: "Synthetic mail" };
function fixture() {
  const db = openDatabase(":memory:");
  const accounts = {
    list: vi.fn().mockResolvedValue({ accounts: [{ id: "work", secretState: { smtpPassword: true } }] }),
    check: vi.fn().mockResolvedValue({ ok: true }),
    send: vi.fn().mockResolvedValue({ state: "sent", archivePending: false }),
    archive: vi.fn().mockResolvedValue({ state: "archived", alreadyPresent: false }),
    probeSent: vi.fn().mockResolvedValue({ present: false }),
  };
  return { service: new MailSendService(db, accounts as never), accounts, db };
}

describe("multi-account SMTP journal", () => {
  it("never resends after a timed-out provider outcome", async () => {
    const { service, accounts, db } = fixture();
    accounts.send.mockRejectedValueOnce(new Error("timeout after DATA"));
    expect(await service.send("work", request, "owner", "mail-key-123")).toMatchObject({ state: "uncertain", replayed: false });
    expect(await service.send("work", request, "owner", "mail-key-123")).toMatchObject({ state: "uncertain", replayed: true });
    expect(accounts.send).toHaveBeenCalledOnce();
    db.close();
  });

  it("keeps accepted SMTP sent when the Sent copy is pending and scopes keys by account", async () => {
    const { service, accounts, db } = fixture();
    accounts.list.mockResolvedValue({ accounts: [
      { id: "work", secretState: { smtpPassword: true } }, { id: "home", secretState: { smtpPassword: true } },
    ] });
    accounts.send.mockResolvedValue({ state: "sent", archivePending: true });
    expect(await service.send("work", request, "owner", "mail-key-123")).toMatchObject({ state: "sent", archivePending: true });
    expect(await service.send("home", request, "owner", "mail-key-123")).toMatchObject({ state: "sent", archivePending: true });
    expect(accounts.send).toHaveBeenCalledTimes(2);
    db.close();
  });

  it("rejects changed content under the same account key", async () => {
    const { service, db } = fixture();
    await service.send("work", request, "owner", "mail-key-123");
    await expect(service.send("work", { ...request, body: "Different" }, "owner", "mail-key-123")).rejects.toThrow("andere Nachricht");
    db.close();
  });

  it("reconciles an accepted SMTP send by archive-only path without another send", async () => {
    const { service, accounts, db } = fixture();
    accounts.send.mockResolvedValue({ state: "sent", archivePending: true });
    await service.send("work", request, "owner", "mail-key-123");
    const receiptId = service.receipt("work", "owner", "mail-key-123").receiptId;
    await expect(service.reconcileArchive("work", receiptId, { ...request, body: "Changed" })).rejects.toThrow();
    expect(await service.reconcileArchive("work", receiptId, request)).toMatchObject({ state: "sent", archivePending: false });
    expect(accounts.send).toHaveBeenCalledTimes(1);
    expect(accounts.archive).toHaveBeenCalledOnce();
    db.close();
  });

  it("reviews an uncertain receipt read-only and never retries SMTP", async () => {
    const { service, accounts, db } = fixture();
    accounts.send.mockRejectedValueOnce(new Error("timeout after DATA"));
    await service.send("work", request, "owner", "mail-key-123");
    const receiptId = service.receipt("work", "owner", "mail-key-123").receiptId;
    expect(await service.review("work", receiptId)).toMatchObject({ state: "uncertain" });
    accounts.probeSent.mockResolvedValueOnce({ present: true });
    expect(await service.review("work", receiptId)).toMatchObject({ state: "sent", archivePending: false });
    expect(accounts.send).toHaveBeenCalledTimes(1);
    expect(accounts.archive).not.toHaveBeenCalled();
    db.close();
  });
});
