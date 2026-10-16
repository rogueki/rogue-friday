import { describe, expect, it, vi } from "vitest";
import { openDatabase } from "../src/db/database";
import { CloudTalkService } from "../src/services/cloudtalk";
import { startTestApi } from "./helpers";

const profile = { agentId: 1234, accessKeyId: "test-key-id", accessKeySecret: "synthetic-secret-123" };

describe("CloudTalk API call safeguards", () => {
  it("encrypts credentials and journals before a single external POST", async () => {
    const db = openDatabase(":memory:");
    const request = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(db.prepare("SELECT state FROM cloudtalk_calls").get()).toMatchObject({ state: "pending" });
      expect(init?.method).toBe("POST");
      expect(init?.redirect).toBe("error");
      expect(JSON.parse(String(init?.body))).toEqual({ agent_id: 1234, callee_number: "+491701234567" });
      return new Response(JSON.stringify({ responseData: { status: 200 } }), { status: 200 });
    });
    const service = new CloudTalkService(db, Buffer.alloc(32, 3), request as typeof fetch);
    expect(service.configure(profile, 0).configured).toBe(true);
    expect(JSON.stringify(db.prepare("SELECT value FROM kv WHERE key = 'telephony.cloudtalk.profile'").get())).not.toContain(profile.accessKeySecret);
    const preview = service.preview("+491701234567", "owner");
    const first = await service.originate(preview.destination, preview.token, "owner", "cloudtalk-key-123");
    expect(first.state).toBe("requested");
    expect((await service.originate(preview.destination, preview.token, "owner", "cloudtalk-key-123")).replayed).toBe(true);
    await expect(service.originate(preview.destination, preview.token, "owner", "different-key-123")).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
    db.close();
  });

  it("keeps an uncertain API outcome without retrying", async () => {
    const db = openDatabase(":memory:");
    const request = vi.fn(async () => { throw new Error("timeout after send"); });
    const service = new CloudTalkService(db, Buffer.alloc(32, 4), request as typeof fetch);
    service.configure(profile, 0);
    const preview = service.preview("+491701234567", "owner");
    expect((await service.originate(preview.destination, preview.token, "owner", "cloudtalk-key-456")).state).toBe("unknown");
    expect((await service.originate(preview.destination, preview.token, "owner", "cloudtalk-key-456")).replayed).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    db.close();
  });

  it("records an HTTP 4xx rejection even when the provider body is not JSON", async () => {
    const db = openDatabase(":memory:");
    const request = vi.fn(async () => new Response("Forbidden", { status: 403 }));
    const service = new CloudTalkService(db, Buffer.alloc(32, 5), request as typeof fetch);
    service.configure(profile, 0);
    const preview = service.preview("+491701234567", "owner");
    const result = await service.originate(preview.destination, preview.token, "owner", "cloudtalk-key-789");
    expect(result.state).toBe("rejected");
    expect(result.providerStatus).toBe(403);
    expect(request).toHaveBeenCalledTimes(1);
    db.close();
  });

  it("requires owner session and CSRF for setup and preview", async () => {
    const api = await startTestApi({ responseValidation: "throw" });
    try {
      const guest = api.client();
      const viewer = api.client(); await viewer.loginDev("viewer");
      const owner = api.client(); await owner.loginDev("owner");
      expect((await guest.get("/api/v1/settings/cloudtalk")).statusCode).toBe(401);
      expect((await viewer.get("/api/v1/settings/cloudtalk")).statusCode).toBe(403);
      expect((await owner.get("/api/v1/settings/cloudtalk")).statusCode).toBe(200);
      expect((await owner.post("/api/v1/telephony/cloudtalk/preview", { destination: "+491701234567" }, { csrf: false })).statusCode).toBe(403);
      expect((await viewer.post("/api/v1/telephony/cloudtalk/preview", { destination: "+491701234567" })).statusCode).toBe(403);
    } finally { await api.close(); }
  });
});
