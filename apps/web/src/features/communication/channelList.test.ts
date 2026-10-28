import type { Channel } from "@friday/sdk";
import { describe, expect, it } from "vitest";
import { channelGroup, partitionChannels, VISIBLE_CHANNEL_KINDS } from "./channelList";

const channel = (kind: Channel["kind"], partial: Partial<Channel> = {}): Channel => ({
  id: `chan_${kind}`,
  version: 1,
  createdAt: "2026-10-01T08:00:00Z",
  updatedAt: "2026-10-02T08:00:00Z",
  source: { id: "mock", label: "Mock", mode: "mock" },
  kind,
  name: kind,
  status: "online",
  capabilities: { read: true, draft: true, send: true },
  unreadCount: 0,
  lastSyncAt: "2026-10-02T08:00:00Z",
  ...partial,
} as Channel);

describe("visible channel list", () => {
  it("keeps exactly the five standard kinds in the documented order", () => {
    expect(VISIBLE_CHANNEL_KINDS).toEqual(["email", "telegram", "whatsapp", "phone", "discord"]);
  });

  it("orders channels by kind and hides SMS and other kinds", () => {
    const { visible, hidden } = partitionChannels([
      channel("sms"),
      channel("discord"),
      channel("email"),
      channel("phone"),
      channel("other", { name: "Matrix" }),
      channel("telegram"),
      channel("whatsapp"),
    ]);
    expect(visible.map((entry) => entry.kind)).toEqual(["email", "telegram", "whatsapp", "phone", "discord"]);
    expect(hidden.map((entry) => entry.name)).toEqual(["sms", "Matrix"]);
  });

  it("sorts equal kinds by unread count and then by name", () => {
    const { visible } = partitionChannels([
      channel("email", { id: "chan_b", name: "B", unreadCount: 1 }),
      channel("email", { id: "chan_a", name: "A", unreadCount: 1 }),
      channel("email", { id: "chan_c", name: "C", unreadCount: 9 }),
    ]);
    expect(visible.map((entry) => entry.name)).toEqual(["C", "A", "B"]);
  });

  it("groups channels into the setup flows they need", () => {
    expect(channelGroup("email")).toBe("email");
    expect(channelGroup("telegram")).toBe("messenger");
    expect(channelGroup("whatsapp")).toBe("messenger");
    expect(channelGroup("discord")).toBe("messenger");
    expect(channelGroup("phone")).toBe("phone");
    expect(channelGroup("sms")).toBe("none");
    expect(channelGroup(undefined)).toBe("none");
  });
});