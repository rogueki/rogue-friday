import { describe, expect, it } from "vitest";
import { MockWorld } from "../world";

describe("notification escalation", () => {
  it("persists due external steps as owner approval required, never as sent", () => {
    const saved: Array<{ id: string; pending: boolean }> = [];
    const world = new MockWorld({
      realTime: false,
      notifications: {
        list: () => [],
        save: (notification, pending) => saved.push({ id: notification.id, pending: pending ?? false }),
      },
    });
    const notification = world.notifications.raise({ priority: "P2", category: "system", title: "Test", body: "Test", chain: ["telegram"], stepSeconds: [30] });
    expect(notification.escalation[0]?.state).toBe("pending");
    world.clock.advance(30_000);
    expect(notification.escalation[0]?.state).toBe("awaiting_approval");
    expect(notification.escalation[0]?.sentAt).toBeNull();
    expect(saved.at(-1)).toEqual({ id: notification.id, pending: false });
  });

  it("restores persisted notifications into an empty-profile world and avoids reused ids", () => {
    const rows: Array<ReturnType<MockWorld["notifications"]["find"]>> = [];
    const persistence = {
      list: () => rows,
      save: (notification: (typeof rows)[number]) => {
        const index = rows.findIndex((row) => row.id === notification.id);
        if (index < 0) rows.push(notification);
        else rows[index] = notification;
      },
    };
    const first = new MockWorld({ profile: "empty", realTime: false, notifications: persistence });
    const original = first.notifications.raise({ priority: "P2", category: "system", title: "Saved", body: "Survives restart", chain: ["dashboard"] });
    const restarted = new MockWorld({ profile: "empty", realTime: false, notifications: persistence });
    expect(restarted.state.notifications).toContainEqual(original);
    const next = restarted.notifications.raise({ priority: "P2", category: "system", title: "New", body: "Unique id", chain: ["dashboard"] });
    expect(next.id).not.toBe(original.id);
  });

  it("stops pending escalation after acknowledgement when configured", () => {
    const world = new MockWorld({ realTime: false });
    world.state.settings.notifications.defaultEscalation = [
      { channel: "telegram", afterSeconds: 30, description: "Approval gate", stopOnAcknowledge: true },
    ];
    const notification = world.notifications.raise({ priority: "P1", category: "system", title: "Test", body: "Test" });
    world.notifications.acknowledge(notification.id);
    expect(notification.escalation[0]?.state).toBe("skipped");
    world.clock.advance(30_000);
    expect(notification.escalation[0]?.state).toBe("skipped");
  });

  it("continues escalation only when a step explicitly opts out of stop-on-ack", () => {
    const world = new MockWorld({ realTime: false });
    world.state.settings.notifications.defaultEscalation = [
      { channel: "telegram", afterSeconds: 30, description: "Approval gate", stopOnAcknowledge: false },
    ];
    const notification = world.notifications.raise({ priority: "P1", category: "system", title: "Test", body: "Test" });
    world.notifications.acknowledge(notification.id);
    world.clock.advance(30_000);
    expect(notification.status).toBe("acknowledged");
    expect(notification.escalation[0]?.state).toBe("awaiting_approval");
  });

  it("applies configured channel enablement and priority threshold", () => {
    const world = new MockWorld({ realTime: false });
    world.state.settings.notifications.channels = world.state.settings.notifications.channels.map((channel) =>
      channel.kind === "telegram" ? { ...channel, enabled: false } : channel,
    );
    const notification = world.notifications.raise({ priority: "P1", category: "system", title: "Test", body: "Test", chain: ["telegram"] });
    expect(notification.escalation[0]?.state).toBe("skipped");
  });

  it("does not offer a legacy non-default messenger account for an owner-reviewed send", () => {
    const world = new MockWorld({ realTime: false });
    world.state.settings.notifications.channels = world.state.settings.notifications.channels.map((channel) =>
      channel.kind === "telegram" ? { ...channel, enabled: true, accountId: "old-profile" } : channel,
    );
    const notification = world.notifications.raise({ priority: "P1", category: "system", title: "Test", body: "Test", chain: ["telegram"] });
    expect(notification.escalation[0]?.state).toBe("skipped");
  });

  it("defers non-critical external escalation during configured local quiet hours", () => {
    const world = new MockWorld({ realTime: false });
    world.state.settings.profile.timeZone = "UTC";
    world.state.settings.notifications.quietHours = { enabled: true, from: "00:00", to: "23:59" };
    const notification = world.notifications.raise({ priority: "P2", category: "system", title: "Test", body: "Test", chain: ["telegram"], stepSeconds: [1] });
    world.clock.advance(1_000);
    expect(notification.escalation[0]?.state).toBe("pending");
  });

  it("does not mark immediate external steps as delivered during quiet hours and keeps one retry timer", () => {
    const world = new MockWorld({ realTime: false });
    world.state.settings.profile.timeZone = "UTC";
    world.state.settings.notifications.quietHours = { enabled: true, from: "00:00", to: "23:59" };
    const timersBefore = world.clock.pendingTimers;
    const notification = world.notifications.raise({ priority: "P2", category: "system", title: "Test", body: "Test", chain: ["telegram"], stepSeconds: [0] });
    expect(notification.escalation[0]?.state).toBe("pending");
    expect(notification.escalation[0]?.sentAt).toBeNull();
    world.clock.advance(20 * 60_000);
    expect(notification.escalation[0]?.state).toBe("pending");
    expect(notification.escalation[0]?.sentAt).toBeNull();
    expect(world.clock.pendingTimers).toBeLessThanOrEqual(timersBefore + 1);
  });

  it("lets urgent notifications pass through quiet hours", () => {
    const world = new MockWorld({ realTime: false });
    world.state.settings.profile.timeZone = "UTC";
    world.state.settings.notifications.quietHours = { enabled: true, from: "00:00", to: "23:59" };
    const notification = world.notifications.raise({ priority: "P0", category: "security", title: "Test", body: "Test", chain: ["telegram"], stepSeconds: [1] });
    world.clock.advance(1_000);
    expect(notification.escalation[0]?.state).toBe("awaiting_approval");
  });

  it("records the receipt after policy or resolution changes while an admitted send is in flight", () => {
    const world = new MockWorld({ realTime: false });
    const notification = world.notifications.raise({ priority: "P1", category: "system", title: "Test", body: "Test", chain: ["telegram"], stepSeconds: [0] });
    world.notifications.assertMessengerStepActionable(notification.id, 1);
    world.notifications.resolve(notification.id);
    const updated = world.notifications.recordMessengerReceipt(notification.id, 1, "sent");
    expect(updated.status).toBe("resolved");
    expect(updated.escalation[0]).toMatchObject({ state: "sent" });
    expect(updated.escalation[0]?.sentAt).not.toBeNull();
  });

  it("invalidates an alert approval when the configured messenger recipient changes", () => {
    const world = new MockWorld({ realTime: false });
    world.state.settings.notifications.channels = world.state.settings.notifications.channels.map((channel) =>
      channel.kind === "telegram" ? { ...channel, enabled: true, minPriority: "P1", accountId: "default", recipient: "12345678" } : channel);
    const notification = world.notifications.raise({ priority: "P1", category: "system", title: "Test", body: "Test", chain: ["telegram"], stepSeconds: [0] });
    expect(() => world.notifications.assertMessengerStepActionable(notification.id, 1, "telegram", "12345678")).not.toThrow();
    world.state.settings.notifications.channels = world.state.settings.notifications.channels.map((channel) =>
      channel.kind === "telegram" ? { ...channel, recipient: "87654321" } : channel);
    expect(() => world.notifications.assertMessengerStepActionable(notification.id, 1, "telegram", "12345678")).toThrow("nicht mehr versandberechtigt");
  });
});
