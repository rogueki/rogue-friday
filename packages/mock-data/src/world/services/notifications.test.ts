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
});
