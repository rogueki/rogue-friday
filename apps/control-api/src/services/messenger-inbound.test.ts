import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { stableUserId } from "../security/auth-service";
import type { DurableMemoryService, IntegrationEvent } from "./durable-memory";
import { MessengerInboundService, type InboundMessage } from "./messenger-inbound";

const message: InboundMessage = { platform: "discord", accountId: "default", accountEpoch: "a".repeat(64), senderId: "123456789012345678",
  chatId: "234567890123456789", chatType: "dm", messageId: "m-1", text: "Hallo Friday" };

describe("post-admission messenger identity and memory gate", () => {
  it("retrieves owner context and binds a deduplicated assistant turn to the exact admitted DM", () => {
    const db = new DatabaseSync(":memory:");
    const settings = { enabled: true, privateMode: false, channels: { messenger: true } };
    const captured: IntegrationEvent[] = [];
    const memory = { getSettings: () => settings, capture: vi.fn((event: IntegrationEvent) => {
      captured.push(event); return { eventId: event.eventId, accepted: true, pending: false };
    }), search: vi.fn(() => [{ eventId: "prior", source: "voice/friday", occurredAt: "2026-01-01T00:00:00Z",
      text: "Earlier owner conversation", channel: "voice", identityId: stableUserId("owner"), sessionId: "voice-1", score: 1 },
    { eventId: "private", source: "voice/friday", occurredAt: "2026-01-01T00:00:00Z",
      text: "access token: hidden", channel: "voice", identityId: stableUserId("owner"), sessionId: "voice-1", score: 1 }]) } as unknown as DurableMemoryService;
    const service = new MessengerInboundService(db, memory);
    service.receive(message);
    service.link(service.observations()[0]!.id, stableUserId("owner"));
    const admitted = service.receive(message);
    expect(admitted.context).toEqual([{ source: "voice/friday", occurredAt: "2026-01-01T00:00:00Z",
      text: "Earlier owner conversation" }]);
    const reply: InboundMessage = { ...message, eventType: "assistant_response", admissionEventId: admitted.eventId!,
      turnId: "turn-1", text: "Friday antwortet" };
    expect(service.receive(reply).reason).toBe("captured");
    expect(service.receive(reply).reason).toBe("captured");
    expect(captured.at(-1)).toEqual(captured.at(-2));
    expect(captured.at(-1)).toMatchObject({ eventType: "assistant_response", identityId: stableUserId("owner"),
      channel: "messenger", correlationId: admitted.eventId, payload: { kind: "text", text: "Friday antwortet" } });
    const action: InboundMessage = { ...reply, eventType: "action_result", turnId: "turn-1:call-1",
      text: "", actionId: "terminal", outcome: "uncertain" };
    expect(service.receive(action).reason).toBe("captured");
    expect(captured.at(-1)).toMatchObject({ eventType: "action_result", outcome: "uncertain",
      payload: { kind: "action", actionId: "terminal", targetId: null, externalId: null } });
    expect(service.receive({ ...action, actionId: "bad tool name" }).reason).toBe("invalid");
    expect(service.receive({ ...reply, accountEpoch: "b".repeat(64) }).reason).toBe("unlinked");
    expect(service.receive({ ...reply, chatId: "other" }).reason).toBe("unlinked");
    expect(service.receive({ ...reply, text: "access token: fake" }).reason).toBe("private");
    service.unlink(service.observations()[0]!.id);
    expect(service.receive(reply).reason).toBe("unlinked");
    settings.channels.messenger = false;
    expect(service.receive(reply).reason).toBe("policy_disabled");
    db.close();
  });
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
    expect(service.receive({ ...message, accountEpoch: "b".repeat(64) }).reason).toBe("unlinked");
    expect(service.observations()).toHaveLength(2);
    service.unlink(observed[0]!.id);
    expect(service.receive({ ...message, messageId: "m-2" }).reason).toBe("unlinked");
    db.close();
  });

  it("links and unlinks an exact observation even after more than 100 newer senders", () => {
    const db = new DatabaseSync(":memory:");
    const memory = { getSettings: () => ({ enabled: true, privateMode: false, channels: { messenger: true } }) } as
      unknown as DurableMemoryService;
    const service = new MessengerInboundService(db, memory);
    service.receive(message);
    const oldest = service.observations()[0]!.id;
    db.prepare("UPDATE messenger_sender_observations SET last_seen_at=? WHERE id=?").run("2020-01-01T00:00:00Z", oldest);
    for (let index = 0; index < 101; index += 1) service.receive({ ...message, senderId: `sender-${index}` });
    expect(service.observations().some((item) => item.id === oldest)).toBe(false);
    expect(service.link(oldest, stableUserId("owner"))?.linked).toBe(true);
    service.unlink(oldest);
    expect(service.observation(oldest)?.linked).toBe(false);
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

  it("does not retain an admission when the Memory sink rejects it", () => {
    const db = new DatabaseSync(":memory:");
    const memory = { getSettings: () => ({ enabled: true, privateMode: false, channels: { messenger: true } }),
      capture: () => ({ accepted: false, pending: false }) } as unknown as DurableMemoryService;
    const service = new MessengerInboundService(db, memory);
    service.receive(message);
    service.link(service.observations()[0]!.id, stableUserId("owner"));
    expect(service.receive(message)).toEqual({ reason: "policy_disabled", eventId: null });
    expect(db.prepare("SELECT COUNT(*) AS n FROM messenger_inbound_events").get()).toEqual({ n: 0 });
    db.close();
  });
});
