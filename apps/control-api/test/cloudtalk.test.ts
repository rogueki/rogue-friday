import { describe, expect, it, vi } from "vitest";
import { openDatabase } from "../src/db/database";
import { CloudTalkService } from "../src/services/cloudtalk";
import { LocalCalendarService } from "../src/services/local-calendar";
import { startTestApi } from "./helpers";

const profile = { agentId: 1234, accessKeyId: "test-key-id", accessKeySecret: "synthetic-secret-123" };

describe("CloudTalk API call safeguards", () => {
  it("calls the owner VoiceAgent once for a due local event and journals before POST", async () => {
    const db = openDatabase(":memory:");
    const clock = Date.parse("2026-10-17T12:45:00.000Z");
    const calendar = new LocalCalendarService(db);
    const due = calendar.create({ title: "Zahnarzt", start: "2026-10-17T13:00:00.000Z",
      end: "2026-10-17T13:30:00.000Z", timeZone: "Europe/Berlin" }, "owner");
    calendar.create({ title: "Fremder Termin", start: "2026-10-17T13:00:00.000Z",
      end: "2026-10-17T13:30:00.000Z", timeZone: "Europe/Berlin" }, "viewer");
    const request = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(url).toBe("https://api.cloudtalk.io/v1/voice-agent/calls");
      expect(init?.redirect).toBe("error");
      expect(db.prepare("SELECT state FROM cloudtalk_reminder_calls WHERE event_id = ?").get(due.id)).toMatchObject({ state: "pending" });
      expect(JSON.parse(String(init?.body))).toEqual({ call_number: "+491701234567", voice_agent_id: "friday-agent",
        call_properties: { system_prompt: { variables: { contact_name: "Alex",
          appointment_time: "Samstag, 17. Oktober 2026 um 15:00 (Zahnarzt)" } } } });
      return new Response(null, { status: 202 });
    });
    const service = new CloudTalkService(db, Buffer.alloc(32, 8), request as typeof fetch, () => clock, () => "Alex");
    await service.tickReminders();
    expect(request).not.toHaveBeenCalled();
    service.configure({ accessKeyId: profile.accessKeyId, accessKeySecret: profile.accessKeySecret,
      ownerPhone: "+491701234567", ownerPhoneConfirmed: true, voiceAgentId: "friday-agent",
      remindersEnabled: true, reminderMinutes: 15 }, 0, "owner");
    await service.tickReminders();
    await service.tickReminders();
    expect(request).toHaveBeenCalledTimes(1);
    expect(db.prepare("SELECT state FROM cloudtalk_reminder_calls WHERE event_id = ?").get(due.id)).toMatchObject({ state: "requested" });
    new CloudTalkService(db, Buffer.alloc(32, 8), request as typeof fetch, () => clock, () => "Alex");
    await service.tickReminders();
    expect(request).toHaveBeenCalledTimes(1);
    db.close();
  });

  it("does not retry an uncertain VoiceAgent response or call after deleting an event", async () => {
    const db = openDatabase(":memory:");
    const clock = Date.parse("2026-10-17T12:45:00.000Z");
    const calendar = new LocalCalendarService(db);
    const due = calendar.create({ title: "Besprechung", start: "2026-10-17T13:00:00.000Z",
      end: "2026-10-17T13:30:00.000Z", timeZone: "Europe/Berlin" }, "owner");
    const removed = calendar.create({ title: "Abgesagt", start: "2026-10-17T13:00:00.000Z",
      end: "2026-10-17T13:30:00.000Z", timeZone: "Europe/Berlin" }, "owner");
    calendar.delete(removed.id, "owner", removed.version);
    const request = vi.fn(async () => { throw new Error("timeout after send"); });
    const service = new CloudTalkService(db, Buffer.alloc(32, 9), request as typeof fetch, () => clock);
    service.configure({ ...profile, ownerPhone: "+491701234567", ownerPhoneConfirmed: true, voiceAgentId: "friday-agent",
      remindersEnabled: true, reminderMinutes: 15 }, 0, "owner");
    await service.tickReminders();
    await service.tickReminders();
    expect(request).toHaveBeenCalledTimes(1);
    expect(db.prepare("SELECT state FROM cloudtalk_reminder_calls WHERE event_id = ?").get(due.id)).toMatchObject({ state: "unknown" });
    expect(db.prepare("SELECT state FROM cloudtalk_reminder_calls WHERE event_id = ?").get(removed.id)).toBeUndefined();
    db.close();
  });
  it("encrypts credentials and journals before a single external POST", async () => {
    const db = openDatabase(":memory:");
    const request = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(_url).toBe("https://api.cloudtalk.io/api/calls/create.json");
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

  it("keeps encrypted credentials and the classical agent on nonsecret edits, and rotates only a complete pair", () => {
    const db = openDatabase(":memory:");
    const service = new CloudTalkService(db, Buffer.alloc(32, 6));
    expect(() => service.configure({ remindersEnabled: false }, 0, "owner")).toThrow();
    expect(() => service.configure({ accessKeyId: "new-key" }, 0, "owner")).toThrow();
    const first = service.configure({ ...profile, ownerPhone: "+491701234567",
      ownerPhoneConfirmed: true, voiceAgentId: "friday-agent", remindersEnabled: true }, 0, "owner");
    expect(first).toMatchObject({ revision: 1, agentId: 1234, ownerPhoneConfirmed: true });
    expect(() => service.configure({ ownerPhone: "+491701234568", reminderMinutes: 30 }, 1, "owner")).toThrow();
    const changed = service.configure({ ownerPhone: "+491701234568", ownerPhoneConfirmed: true, reminderMinutes: 30 }, 1, "owner");
    expect(changed).toMatchObject({ revision: 2, agentId: 1234, remindersEnabled: true,
      ownerPhone: "+491701234568", ownerPhoneConfirmed: true, reminderMinutes: 30 });
    expect(JSON.stringify(changed)).not.toContain(profile.accessKeySecret);
    expect(() => service.configure({ accessKeyId: "new-key" }, 2, "owner")).toThrow();
    expect(() => service.configure({ accessKeyId: "", accessKeySecret: "", ownerPhoneConfirmed: false }, 2, "owner")).toThrow();
    expect(() => service.configure({ remindersEnabled: false }, 1, "owner")).toThrow();
    expect(service.configure({ remindersEnabled: false, accessKeyId: "rotated-key",
      accessKeySecret: "rotated-secret-123" }, 2, "owner")).toMatchObject({ revision: 3, agentId: 1234 });
    expect(JSON.stringify(db.prepare("SELECT value FROM kv WHERE key = 'telephony.cloudtalk.profile'").get())).not.toContain("rotated-secret-123");
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
      const configured = await owner.request("PUT", "/api/v1/settings/cloudtalk", { headers: { "if-match": "0" },
        body: { accessKeyId: "synthetic-key", accessKeySecret: "synthetic-secret-123",
          ownerPhone: "+491701234567", ownerPhoneConfirmed: true, voiceAgentId: "friday-agent",
          remindersEnabled: true, reminderMinutes: 15 } });
      expect(configured.statusCode).toBe(200);
      expect(configured.json()).toMatchObject({ data: { agentId: null, remindersEnabled: true,
        ownerPhone: "+491701234567", ownerPhoneConfirmed: true, revision: 1 } });
      expect(JSON.stringify(configured.json())).not.toContain("synthetic-secret-123");
      expect((await viewer.request("PUT", "/api/v1/settings/cloudtalk", { headers: { "if-match": "1" },
        body: { reminderMinutes: 30 } })).statusCode).toBe(403);
      expect((await owner.request("PUT", "/api/v1/settings/cloudtalk", { headers: { "if-match": "1" },
        body: { reminderMinutes: 30 }, csrf: false })).statusCode).toBe(403);
      const edited = await owner.request("PUT", "/api/v1/settings/cloudtalk", { headers: { "if-match": "1" },
        body: { reminderMinutes: 30, ownerPhone: "+491701234568", ownerPhoneConfirmed: true } });
      expect(edited.statusCode).toBe(200);
      expect(edited.json()).toMatchObject({ data: { revision: 2, reminderMinutes: 30,
        ownerPhone: "+491701234568", voiceAgentId: "friday-agent", remindersEnabled: true } });
      expect((await owner.request("PUT", "/api/v1/settings/cloudtalk", { headers: { "if-match": "2" },
        body: { accessKeyId: "replacement-key" } })).statusCode).toBe(422);
      expect((await owner.request("PUT", "/api/v1/settings/cloudtalk", { headers: { "if-match": "1" },
        body: { reminderMinutes: 20 } })).statusCode).toBe(409);
      expect((await owner.post("/api/v1/telephony/cloudtalk/preview", { destination: "+491701234567" }, { csrf: false })).statusCode).toBe(403);
      expect((await owner.post("/api/v1/telephony/cloudtalk/preview", { destination: "+491701234567" })).statusCode).toBe(503);
      expect((await viewer.post("/api/v1/telephony/cloudtalk/preview", { destination: "+491701234567" })).statusCode).toBe(403);
    } finally { await api.close(); }
  });
});
