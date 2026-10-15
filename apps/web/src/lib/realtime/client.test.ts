import type { ControlFrame, FridayEvent } from "@friday/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POLL_INTERVAL_MS, RECONNECT_MAX_MS, RECONNECT_MIN_MS, reconnectDelay } from "./backoff";
import { RealtimeClient, type RealtimeSnapshot } from "./client";
import type { RealtimeTransport, TransportCloseInfo, TransportHandlers, TransportRequest } from "./transport";
import { buildEventsUrl } from "./url";

class FakeTransport implements RealtimeTransport {
  handlers: TransportHandlers | null = null;
  sent: ControlFrame[] = [];
  closed = false;
  constructor(readonly request: TransportRequest) {}
  connect(handlers: TransportHandlers): void {
    this.handlers = handlers;
  }
  send(frame: ControlFrame): void {
    this.sent.push(frame);
  }
  close(): void {
    this.closed = true;
  }
  open(): void {
    this.handlers?.onOpen();
  }
  message(data: unknown): void {
    this.handlers?.onMessage(data);
  }
  drop(info: Partial<TransportCloseInfo> = {}): void {
    this.handlers?.onClose({ clean: false, ...info });
  }
}

function event(sequence: number, type: FridayEvent["type"] = "friday.task.updated", data: unknown = {}): unknown {
  return {
    specversion: "1.0",
    id: `evt_${sequence}`,
    type,
    source: "adapter://mock",
    subject: "task/x",
    time: "2026-10-14T08:00:00Z",
    sequence,
    correlationId: "corr_x",
    contractVersion: "2.0.0",
    data,
  };
}

function memoryStorage(initial?: Record<string, string>) {
  const map = new Map(Object.entries(initial ?? {}));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    map,
  };
}

interface Harness {
  client: RealtimeClient;
  transports: FakeTransport[];
  events: number[];
  gaps: { lastApplied: number; received: number }[];
  resyncs: unknown[];
  polls: { count: number };
  states: RealtimeSnapshot[];
  storage: ReturnType<typeof memoryStorage>;
  urls: string[];
}

function createHarness(options: { storage?: Record<string, string>; random?: () => number } = {}): Harness {
  const transports: FakeTransport[] = [];
  const events: number[] = [];
  const gaps: Harness["gaps"] = [];
  const resyncs: unknown[] = [];
  const polls = { count: 0 };
  const states: RealtimeSnapshot[] = [];
  const urls: string[] = [];
  const storage = memoryStorage(options.storage);
  const client = new RealtimeClient({
    getUrl: (since) => {
      const url = `ws://test/api/v1/events${since === null ? "" : `?since=${since}`}`;
      urls.push(url);
      return url;
    },
    transportFactory: (request) => {
      const transport = new FakeTransport(request);
      transports.push(transport);
      return transport;
    },
    storage,
    random: options.random ?? (() => 0.5),
    callbacks: {
      onEvent: (e) => events.push(e.sequence),
      onGap: (gap) => gaps.push(gap),
      onResync: (data) => resyncs.push(data),
      onPoll: () => {
        polls.count += 1;
      },
      onStateChange: (snapshot) => states.push(snapshot),
    },
  });
  return { client, transports, events, gaps, resyncs, polls, states, storage, urls };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-14T08:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("reconnectDelay", () => {
  it("stays within 0.5 s and 15 s for every attempt and any random value", () => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      for (const random of [0, 0.25, 0.5, 0.99, 1]) {
        const delay = reconnectDelay(attempt, () => random);
        expect(delay).toBeGreaterThanOrEqual(RECONNECT_MIN_MS);
        expect(delay).toBeLessThanOrEqual(RECONNECT_MAX_MS);
      }
    }
  });

  it("grows exponentially (ceiling doubles) until the cap", () => {
    const ceilings = [0, 1, 2, 3, 4, 5, 6, 7].map((attempt) => reconnectDelay(attempt, () => 1));
    expect(ceilings).toEqual([500, 1000, 2000, 4000, 8000, 15000, 15000, 15000]);
    expect(reconnectDelay(5, () => 0)).toBe(RECONNECT_MIN_MS);
  });
});

describe("RealtimeClient events", () => {
  it("applies each sequence once: duplicates and older events are ignored", () => {
    const h = createHarness();
    h.client.start();
    const transport = h.transports[0] as FakeTransport;
    transport.open();
    for (const seq of [1, 2, 2, 1, 3]) transport.message(JSON.stringify(event(seq)));
    expect(h.events).toEqual([1, 2, 3]);
    expect(h.client.stats.duplicates).toBe(2);
    expect(h.client.getSequence()).toBe(3);
  });

  it("detects gaps, reports them and still applies the event", () => {
    const h = createHarness();
    h.client.start();
    const transport = h.transports[0] as FakeTransport;
    transport.open();
    transport.message(event(1));
    transport.message(event(2));
    transport.message(event(6));
    expect(h.gaps).toEqual([{ lastApplied: 2, received: 6 }]);
    expect(h.events).toEqual([1, 2, 6]);
    expect(h.client.getSequence()).toBe(6);
  });

  it("does not report a gap for the first event after a fresh start", () => {
    const h = createHarness();
    h.client.start();
    const transport = h.transports[0] as FakeTransport;
    transport.open();
    transport.message(event(1842));
    expect(h.gaps).toEqual([]);
  });

  it("persists the sequence and resumes with ?since= after a reload", () => {
    const first = createHarness();
    first.client.start();
    const transport = first.transports[0] as FakeTransport;
    transport.open();
    transport.message(event(41));
    transport.message(event(42));
    expect(first.storage.map.get("friday.realtime.sequence")).toBe("42");

    const reloaded = createHarness({ storage: Object.fromEntries(first.storage.map) });
    reloaded.client.start();
    expect(reloaded.urls[0]).toBe("ws://test/api/v1/events?since=42");
    expect((reloaded.transports[0] as FakeTransport).request.since).toBe(42);
    // The replay may repeat events the previous page already applied.
    const replay = reloaded.transports[0] as FakeTransport;
    replay.open();
    replay.message(event(42));
    replay.message(event(43));
    expect(reloaded.events).toEqual([43]);
  });

  it("handles resync_required: callback, sequence jump, no duplicate delivery", () => {
    const h = createHarness();
    h.client.start();
    const transport = h.transports[0] as FakeTransport;
    transport.open();
    transport.message(event(5));
    transport.message(
      event(50, "friday.status.resync_required", { reason: "sequence_too_old", requestedSince: 5, oldestAvailableSequence: 40, latestSequence: 50 }),
    );
    expect(h.resyncs).toHaveLength(1);
    expect(h.client.getSequence()).toBe(50);
    transport.message(event(50));
    transport.message(event(51));
    expect(h.events).toEqual([5, 51]);
  });

  it("ignores malformed frames instead of throwing", () => {
    const h = createHarness();
    h.client.start();
    const transport = h.transports[0] as FakeTransport;
    transport.open();
    transport.message("not json");
    transport.message({ foo: "bar" });
    expect(h.client.stats.malformed).toBe(2);
    expect(h.events).toEqual([]);
  });
});

describe("RealtimeClient heartbeat", () => {
  it("answers server pings with the echoed timestamp", () => {
    const h = createHarness();
    h.client.start();
    const transport = h.transports[0] as FakeTransport;
    transport.open();
    transport.message({ kind: "ping", ts: 1234 });
    expect(transport.sent).toContainEqual({ kind: "pong", ts: 1234 });
  });

  it("measures the roundtrip from its own ping", () => {
    const h = createHarness();
    h.client.start();
    const transport = h.transports[0] as FakeTransport;
    transport.open();
    const ping = transport.sent.find((frame) => frame.kind === "ping") as ControlFrame;
    vi.advanceTimersByTime(28);
    transport.message({ kind: "pong", ts: ping.ts });
    expect(h.client.snapshot().roundtripMs).toBe(28);
    expect(h.client.snapshot().state).toBe("online");
  });

  it("marks the stream degraded when a pong stays out, and recovers on the next pong", () => {
    const h = createHarness();
    h.client.start();
    const transport = h.transports[0] as FakeTransport;
    transport.open();
    vi.advanceTimersByTime(10_000 + 6_000);
    expect(h.client.snapshot().state).toBe("degraded");
    vi.advanceTimersByTime(4_000);
    const ping = transport.sent.filter((frame) => frame.kind === "ping").at(-1) as ControlFrame;
    transport.message({ kind: "pong", ts: ping.ts });
    expect(h.client.snapshot().state).toBe("online");
  });
});

describe("RealtimeClient reconnect and polling", () => {
  it("reconnects after a drop with backoff inside the bounds and resumes from the last sequence", () => {
    const h = createHarness({ random: () => 1 });
    h.client.start();
    const first = h.transports[0] as FakeTransport;
    first.open();
    first.message(event(7));
    first.drop();
    expect(h.client.snapshot().state).toBe("connecting");
    expect(h.transports).toHaveLength(1);
    vi.advanceTimersByTime(RECONNECT_MIN_MS - 1);
    expect(h.transports).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(h.transports).toHaveLength(2);
    expect(h.urls[1]).toBe("ws://test/api/v1/events?since=7");
  });

  it("falls back to polling after three failed attempts and stops when the stream is back", () => {
    const h = createHarness({ random: () => 0 });
    h.client.start();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      (h.transports.at(-1) as FakeTransport).drop();
      vi.advanceTimersByTime(RECONNECT_MIN_MS);
    }
    (h.transports.at(-1) as FakeTransport).drop();
    expect(h.client.snapshot().state).toBe("polling");
    expect(h.polls.count).toBe(1);
    vi.advanceTimersByTime(POLL_INTERVAL_MS * 2);
    expect(h.polls.count).toBe(3);

    vi.advanceTimersByTime(RECONNECT_MAX_MS);
    (h.transports.at(-1) as FakeTransport).open();
    expect(h.client.snapshot().state).toBe("online");
    const pollsAtOpen = h.polls.count;
    vi.advanceTimersByTime(POLL_INTERVAL_MS * 3);
    expect(h.polls.count).toBe(pollsAtOpen);
  });

  it("goes offline without retrying and reconnects immediately when the browser is back online", () => {
    const h = createHarness();
    h.client.start();
    (h.transports[0] as FakeTransport).open();
    h.client.notifyOffline();
    expect(h.client.snapshot().state).toBe("offline");
    expect((h.transports[0] as FakeTransport).closed).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(h.transports).toHaveLength(1);
    h.client.notifyOnline();
    expect(h.transports).toHaveLength(2);
    expect(h.client.snapshot().state).toBe("connecting");
  });

  it("replaces a silent half-open connection", () => {
    const h = createHarness({ random: () => 0 });
    h.client.start();
    (h.transports[0] as FakeTransport).open();
    vi.advanceTimersByTime(46_000 + 10_000);
    expect(h.transports.length).toBeGreaterThan(1);
  });

  it("reconnects when the tab becomes visible while disconnected", () => {
    const h = createHarness({ random: () => 1 });
    h.client.start();
    (h.transports[0] as FakeTransport).drop();
    expect(h.transports).toHaveLength(1);
    h.client.notifyVisibility(true);
    // transport is null while waiting for the backoff timer, so visibility triggers the immediate attempt
    expect(h.transports).toHaveLength(2);
  });
});

describe("buildEventsUrl", () => {
  it("derives ws/wss from the page and appends since", () => {
    expect(buildEventsUrl({ eventsPath: "/api/v1/events" }, null, { protocol: "http:", host: "127.0.0.1:3100" })).toBe("ws://127.0.0.1:3100/api/v1/events");
    expect(buildEventsUrl({ eventsPath: "/api/v1/events" }, 12, { protocol: "https:", host: "friday.local" })).toBe("wss://friday.local/api/v1/events?since=12");
  });

  it("prefers eventsOrigin and converts http to ws", () => {
    expect(buildEventsUrl({ eventsPath: "/api/v1/events", eventsOrigin: "http://127.0.0.1:3100" }, 3, { protocol: "http:", host: "localhost:3000" })).toBe(
      "ws://127.0.0.1:3100/api/v1/events?since=3",
    );
  });
});
