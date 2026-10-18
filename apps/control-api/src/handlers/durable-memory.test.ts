import { describe, expect, it, vi } from "vitest";
import type { RequestContext } from "../http/context";
import { durableMemoryHandlers } from "./durable-memory";

const base = {
  eventId: "voice-1", contractVersion: "1.0.0", eventType: "user_utterance", actor: { type: "user", id: "owner", role: null },
  identityId: "owner", channel: "voice", sessionId: null, dialogId: null, correlationId: null,
  source: "voice/friday", occurredAt: "2026-10-19T10:00:00Z", outcome: "completed",
  captureEligibility: "eligible", redaction: "required", payload: { kind: "text", text: "hello" },
};

function context(body: unknown): RequestContext {
  return { body, principal: null, voiceBridgeAuthorized: true, audit: {}, runtime: {
    auth: { ownerPasswordConfigured: () => true, devMode: false }, config: { server: { allowRemote: false } },
    durableMemory: { capture: vi.fn(() => ({ eventId: "voice-1", accepted: true, pending: false })) },
  } } as unknown as RequestContext;
}

describe("durable memory bridge authorization", () => {
  it("binds a trusted voice event to the owner identity", async () => {
    const ctx = context(base);
    await durableMemoryHandlers.captureDurableMemoryEvent!(ctx);
    const stored = vi.mocked(ctx.runtime.durableMemory.capture).mock.calls[0]![0];
    expect(stored.identityId).not.toBe("owner");
    expect(stored.actor.id).toBe(stored.identityId);
  });
  it("rejects a voice event for an arbitrary identity or source", async () => {
    for (const body of [{ ...base, identityId: "other" }, { ...base, source: "dashboard/command" }]) {
      const ctx = context(body);
      await expect(durableMemoryHandlers.captureDurableMemoryEvent!(ctx)).rejects.toThrow();
      expect(ctx.runtime.durableMemory.capture).not.toHaveBeenCalled();
    }
  });
  it("allows only scoped local Hermes CLI events under its separate bridge identity", async () => {
    const cli = { ...base, channel: "hermes", source: "hermes/cli", eventId: "cli-1" };
    const ctx = context(cli);
    ctx.voiceBridgeAuthorized = false;
    ctx.hermesMemoryBridgeAuthorized = true;
    await durableMemoryHandlers.captureDurableMemoryEvent!(ctx);
    expect(vi.mocked(ctx.runtime.durableMemory.capture).mock.calls[0]![0].identityId).not.toBe("owner");
    for (const invalid of [{ ...cli, source: "hermes/gateway" }, { ...cli, identityId: "other" },
      { ...cli, actor: { type: "user", id: "other", role: null } }]) {
      const denied = context(invalid);
      denied.voiceBridgeAuthorized = false;
      denied.hermesMemoryBridgeAuthorized = true;
      await expect(durableMemoryHandlers.captureDurableMemoryEvent!(denied)).rejects.toThrow();
    }
  });
});
