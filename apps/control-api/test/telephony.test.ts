import { describe, expect, it, vi } from "vitest";
import { openDatabase } from "../src/db/database";
import { TelephonyService, type TelephonyStatus } from "../src/services/telephony";
import { startTestApi } from "./helpers";

const ready: TelephonyStatus = { configured: true, mode: "trunk", ariReachable: true,
  registration: "registered", ownerEndpoint: "online", configurationApplied: true, dialplanLoaded: true,
  ready: true, revision: 1, callerId: "+491701234567" };

describe("Asterisk call contract", () => {
  it("consumes an action-bound preview once and journals before originate", async () => {
    const db = openDatabase(":memory:");
    const invoke = vi.fn(async (_script: string, _distro: string, _user: string, args: string[]) => {
      if (args[0] === "status") return { ...ready };
      if (args[0] === "originate") {
        expect(db.prepare("SELECT state FROM telephony_calls").get()).toMatchObject({ state: "pending" });
        return { accepted: true, adapterStatus: 200 };
      }
      if (args[0] === "channel") return { found: true, state: "Up", adapterReachable: true, adapterStatus: 200 };
      if (args[0] === "hangup") return { accepted: true, adapterStatus: 204 };
      throw new Error("Unexpected runner action");
    });
    const service = new TelephonyService(db, "unused", Buffer.alloc(32, 7), invoke);
    vi.spyOn(service as unknown as { target: () => { script: string; distro: string; user: string } }, "target")
      .mockReturnValue({ script: "/mnt/d/Friday/installer/wsl/telephony_runner.py", distro: "Friday-Ubuntu", user: "friday" });
    const preview = await service.preview("+491701234568", "owner");
    const first = await service.originate(preview.destination, preview.token, "owner", "call-key-12345678");
    expect(first.state).toBe("requested");
    expect((await service.originate(preview.destination, preview.token, "owner", "call-key-12345678")).replayed).toBe(true);
    await expect(service.originate(preview.destination, preview.token, "owner", "call-key-other123")).rejects.toThrow();
    expect(invoke.mock.calls.filter((entry) => entry[3][0] === "originate")).toHaveLength(1);
    expect((await service.get(first.id, "owner")).state).toBe("owner_answered");
    await expect(service.get(first.id, "another-owner")).rejects.toThrow();
    expect((await service.hangup(first.id, "owner")).state).toBe("ended");
    db.close();
  });

  it("does not dial when the adapter is unavailable or the preview is modified", async () => {
    const db = openDatabase(":memory:");
    let observed = { ...ready, ready: false };
    const invoke = vi.fn(async (_script: string, _distro: string, _user: string, args: string[]) =>
      args[0] === "status" ? observed : { accepted: true, adapterStatus: 200 });
    const service = new TelephonyService(db, "unused", Buffer.alloc(32, 9), invoke);
    vi.spyOn(service as unknown as { target: () => { script: string; distro: string; user: string } }, "target")
      .mockReturnValue({ script: "runner", distro: "Friday-Ubuntu", user: "friday" });
    await expect(service.preview("+491701234568", "owner")).rejects.toThrow();
    observed = ready;
    const preview = await service.preview("+491701234568", "owner");
    await expect(service.originate("+491701234569", preview.token, "owner", "call-key-12345678")).rejects.toThrow();
    expect(invoke.mock.calls.filter((entry) => entry[3][0] === "originate")).toHaveLength(0);
    db.close();
  });

  it("requires owner session and CSRF before status, preview or dialing", async () => {
    const api = await startTestApi({ responseValidation: "throw" });
    try {
      const guest = api.client();
      const viewer = api.client(); await viewer.loginDev("viewer");
      const operator = api.client(); await operator.loginDev("operator");
      const owner = api.client(); await owner.loginDev("owner");
      vi.spyOn(api.runtime.telephony, "status").mockResolvedValue(ready);
      vi.spyOn(api.runtime.telephony, "preview").mockResolvedValue({ destination: "+491701234568", callerId: ready.callerId!,
        mode: "trunk", expiresAt: new Date(Date.now() + 60000).toISOString(), token: "a".repeat(30) });
      expect((await guest.get("/api/v1/settings/telephony")).statusCode).toBe(401);
      expect((await viewer.get("/api/v1/settings/telephony")).statusCode).toBe(403);
      expect((await operator.post("/api/v1/telephony/preview", { destination: "+491701234568" })).statusCode).toBe(403);
      expect((await owner.get("/api/v1/settings/telephony")).statusCode).toBe(200);
      expect((await owner.post("/api/v1/telephony/preview", { destination: "+491701234568" }, { csrf: false })).statusCode).toBe(403);
      expect((await owner.post("/api/v1/telephony/preview", { destination: "+491701234568" })).statusCode).toBe(200);
      expect((await guest.post("/api/v1/telephony/calls", { destination: "+491701234568", previewToken: "a".repeat(30) },
        { headers: { "Idempotency-Key": "call-key-12345678" } })).statusCode).toBe(401);
      expect((await operator.post("/api/v1/telephony/calls", { destination: "+491701234568", previewToken: "a".repeat(30) },
        { headers: { "Idempotency-Key": "call-key-12345678" } })).statusCode).toBe(403);
    } finally { await api.close(); }
  });

  it("records a rejected originate as failed and a timeout as unknown", async () => {
    const db = openDatabase(":memory:");
    let originateError = new Error("runner_3:originate_400");
    const invoke = vi.fn(async (_script: string, _distro: string, _user: string, args: string[]) => {
      if (args[0] === "status") return { ...ready };
      if (args[0] === "originate") throw originateError;
      throw new Error("Unexpected runner action");
    });
    const service = new TelephonyService(db, "unused", Buffer.alloc(32, 11), invoke);
    vi.spyOn(service as unknown as { target: () => { script: string; distro: string; user: string } }, "target")
      .mockReturnValue({ script: "/mnt/d/Friday/installer/wsl/telephony_runner.py", distro: "Friday-Ubuntu", user: "friday" });
    const refusedPreview = await service.preview("+491701234568", "owner");
    const refused = await service.originate(refusedPreview.destination, refusedPreview.token, "owner", "call-key-refused123");
    expect(refused.state).toBe("failed");
    originateError = new Error("runner_timeout");
    const unclearPreview = await service.preview("+491701234568", "owner");
    const unclear = await service.originate(unclearPreview.destination, unclearPreview.token, "owner", "call-key-unclear123");
    expect(unclear.state).toBe("unknown");
    db.close();
  });

  it("issues distinct single-use previews within the same millisecond", async () => {
    const db = openDatabase(":memory:");
    const invoke = vi.fn(async (_script: string, _distro: string, _user: string, args: string[]) => {
      if (args[0] === "status") return { ...ready };
      throw new Error("Unexpected runner action");
    });
    const service = new TelephonyService(db, "unused", Buffer.alloc(32, 11), invoke, () => 1_800_000_000_000);
    vi.spyOn(service as unknown as { target: () => { script: string; distro: string; user: string } }, "target")
      .mockReturnValue({ script: "/mnt/d/Friday/installer/wsl/telephony_runner.py", distro: "Friday-Ubuntu", user: "friday" });
    const first = await service.preview("+491701234568", "owner");
    const second = await service.preview("+491701234568", "owner");
    expect(first.token).not.toBe(second.token);
    db.close();
  });
});
