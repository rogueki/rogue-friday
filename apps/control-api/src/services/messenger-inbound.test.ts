import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { stableUserId } from "../security/auth-service";
import type { DurableMemoryService, IntegrationEvent } from "./durable-memory";
import { MessengerInboundService, type InboundMessage } from "./messenger-inbound";

const message: InboundMessage = { platform: "discord", accountId: "default", senderId: "123456789012345678",
  chatId: "234567890123456789", chatType: "dm", messageId: "m-1", text: "Hallo Friday" };

describe("post-admission messenger identity and memory gate", () => {
  it("stores only sender metadata before owner link, then captures an exact private conversation once", () => {
    const db = new DatabaseSync(":memory:");
    const settings = { enabled: true, privateMode: false, channels: { messenger: true } };
    const captured: IntegrationEvent[] = [];
    const memory = { getSettings: () => settings, capture: vi.fn((event: IntegrationEvent) => {
      captured.push(event); return { eventId: event.eventId, accepted: true, pending: false };
    }) } as unknown as DurableMemoryService;
    const service = new MessengerInboundService(db, memory);
    expect(service.receive(message)).toEqual({ reason: "unlinked", eventId: null });
    const observed = service.observations();
    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({ platform: "discord", senderId: message.senderId, chatId: message.chatId, linked: false });
    expect(JSON.stringify(db.prepare("SELECT * FROM messenger_sender_observations").all())).not.toContain(message.text);
    expect(service.link(observed[0]!.id, "wrong-user")).toBeNull();
    expect(service.link(observed[0]!.id, stableUserId("owner"))?.linked).toBe(true);
    const first = service.receive(message);
    const replay = service.receive(message);
    expect(first).toMatchObject({ reason: "captured", eventId: expect.stringMatching(/^messenger-[a-f0-9]{64}$/) });
    expect(replay).toEqual(first);
    expect(captured).toHaveLength(2);
    expect(captured[0]).toEqual(captured[1]);
    expect(captured[0]).toMatchObject({ channel: "messenger", identityId: stableUserId("owner"),
      source: expect.stringMatching(/^messenger\/discord\/[a-f0-9]{16}$/), payload: { kind: "text", text: message.text } });
    service.unlink(observed[0]!.id);
    expect(service.receive({ ...message, messageId: "m-2" }).reason).toBe("unlinked");
    db.close();
  });

  it("rejects groups, missing scope, private directives and disabled channel before observation or spool", () => {
    const db = new DatabaseSync(":memory:");
    const settings = { enabled: true, privateMode: false, channels: { messenger: true } };
    const capture = vi.fn();
    const memory = { getSettings: () => settings, capture } as unknown as DurableMemoryService;
    const service = new MessengerInboundService(db, memory);
    expect(service.receive({ ...message, accountId: "unknown" }).reason).toBe("invalid");
    expect(service.receive({ ...message, chatType: "group" }).reason).toBe("not_private_dm");
    expect(service.receive({ ...message, text: "Bitte diesen Chat nicht speichern" }).reason).toBe("private");
    expect(service.receive({ ...message, text: "access token: synthetic" }).reason).toBe("private");
    expect(service.receive({ ...message, text: "", suppressionReason: "unsupported_profile" }).reason).toBe("unsupported_profile");
    expect(service.receive({ ...message, text: "secret text", suppressionReason: "private" }).reason).toBe("invalid");
    settings.channels.messenger = false;
    expect(service.receive(message).reason).toBe("policy_disabled");
    expect(service.observations()).toHaveLength(0);
    expect(capture).not.toHaveBeenCalled();
    db.close();
  });
});
