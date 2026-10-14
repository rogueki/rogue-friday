import { JARVIS_EVENT_TYPES, isControlFrame, isJarvisEvent, type JarvisEvent } from "@jarvis/sdk";
import { describe, expect, it } from "vitest";
import { MockEventHub, MockWorld, ScenarioEngine, SCENARIO_DEFINITIONS, createMockEventSource, scenarioDuration } from "../src";
import { eventProblems, record, validator } from "./support";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("event hub", () => {
  it("buffers events, replays after a cursor and falls back to resync_required", () => {
    const world = new MockWorld();
    const hub = new MockEventHub(world, { bufferSize: 5 });
    for (let i = 0; i < 8; i++) world.tasks.create({ title: `Aufgabe ${i}` });
    expect(hub.bufferedCount).toBe(5);
    const oldest = hub.oldestSequence as number;

    const replayed: JarvisEvent[] = [];
    hub.subscribe((event) => replayed.push(event), { since: hub.latestSequence - 2 });
    expect(replayed.map((event) => event.sequence)).toEqual([hub.latestSequence - 1, hub.latestSequence]);

    const stale: JarvisEvent[] = [];
    hub.subscribe((event) => stale.push(event), { since: oldest - 10 });
    expect(stale).toHaveLength(1);
    expect(stale[0]?.type).toBe("jarvis.status.resync_required");
    expect(stale[0]?.data).toMatchObject({ reason: "sequence_too_old", requestedSince: oldest - 10 });
    expect(validator.validate("EventEnvelope", stale[0]).errors).toEqual([]);
  });

  it("clears the buffer on reset and announces a resync", () => {
    const world = new MockWorld();
    const hub = new MockEventHub(world);
    world.tasks.create({ title: "x" });
    expect(hub.bufferedCount).toBeGreaterThan(0);
    const live: string[] = [];
    hub.subscribe((event) => live.push(event.type));
    world.reset();
    expect(hub.bufferedCount).toBe(0);
    expect(live).toContain("jarvis.status.resync_required");
  });
});

describe("mock event socket", () => {
  it("delivers envelopes with increasing sequence and heartbeat frames every 15 s", async () => {
    const world = new MockWorld();
    const source = createMockEventSource(world);
    const socket = source.connect();
    const frames: unknown[] = [];
    let opened = false;
    socket.onopen = () => {
      opened = true;
    };
    socket.onmessage = (message) => frames.push(JSON.parse((message as { data: string }).data));
    await tick();
    expect(opened).toBe(true);
    expect(socket.readyState).toBe(1);

    world.tasks.create({ title: "Live" });
    world.clock.advance(15_000);
    world.clock.advance(15_000);
    const events = frames.filter(isJarvisEvent);
    const pings = frames.filter(isControlFrame);
    expect(events.length).toBeGreaterThan(3);
    expect(pings.map((frame) => frame.kind)).toEqual(["ping", "ping"]);
    const sequences = events.map((event) => event.sequence);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
    expect(eventProblems(events)).toEqual([]);

    // client ping is answered with a pong carrying the same timestamp
    socket.send(JSON.stringify({ kind: "ping", ts: 123 }));
    expect(frames.at(-1)).toEqual({ kind: "pong", ts: 123 });
    socket.close();
    expect(socket.readyState).toBe(3);
    const count = frames.length;
    world.tasks.create({ title: "Nach dem Schließen" });
    expect(frames).toHaveLength(count);
  });

  it("honours ?since= replay and resync for unknown cursors", async () => {
    const world = new MockWorld();
    const source = createMockEventSource(world);
    world.tasks.create({ title: "A" });
    const cursor = source.hub.latestSequence;
    world.tasks.create({ title: "B" });
    const frames: JarvisEvent[] = [];
    const socket = source.connect(`ws://localhost/api/v1/events?since=${cursor}`);
    socket.onmessage = (message) => {
      const parsed = JSON.parse((message as { data: string }).data);
      if (isJarvisEvent(parsed)) frames.push(parsed);
    };
    await tick();
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.every((event) => event.sequence > cursor)).toBe(true);
    expect(frames.some((event) => event.type === "jarvis.task.created")).toBe(true);
    socket.close();

    const future: JarvisEvent[] = [];
    const socket2 = source.connect(`ws://localhost/api/v1/events?since=${source.hub.latestSequence + 1000}`);
    socket2.onmessage = (message) => future.push(JSON.parse((message as { data: string }).data));
    await tick();
    socket2.close();
    expect(future.length === 0 || future[0]?.type === "jarvis.status.resync_required").toBe(true);
  });

  it("install() swaps the global WebSocket for event URLs only", async () => {
    const world = new MockWorld();
    const source = createMockEventSource(world);
    const target: { WebSocket?: unknown } = { WebSocket: class Native { constructor(public url: string) {} } };
    const restore = source.install(target);
    const Patched = target.WebSocket as new (url: string) => { url: string; readyState: number };
    const mocked = new Patched("ws://127.0.0.1:3100/api/v1/events");
    expect(mocked.readyState).toBe(0);
    await tick();
    expect(mocked.readyState).toBe(1);
    expect((new Patched("ws://example.org/other") as { url: string }).url).toBe("ws://example.org/other");
    restore();
    expect(target.WebSocket).not.toBe(Patched);
  });
});

describe("event contract coverage", () => {
  it("every emitted event validates; the scenario suite plus operations cover all event types", () => {
    const world = new MockWorld();
    world.startTelemetry();
    const recorder = record(world);
    const engine = ScenarioEngine.for(world);
    for (const definition of SCENARIO_DEFINITIONS) {
      engine.play(definition.id);
      engine.runToCompletion(scenarioDuration(definition) + 5_000);
    }
    // operations the scenarios do not touch
    engine.play("clean-idle");
    const task = world.tasks.create({ title: "Zusatz" });
    world.tasks.cancel(task.id);
    const failing = world.tasks.create({ title: "Fehler", agentId: world.state.agents[0]?.id as string });
    world.tasks.fail(failing.id, { code: "INTERNAL", message: "Test" });
    const memory = world.memory.create({ type: "fact", content: "abc" });
    world.memory.update(memory.id, { pinned: true });
    world.memory.delete(memory.id);
    const temp = world.state.files.find((file) => file.category === "temporary" && file.sizeBytes < 10_000);
    if (temp) world.files.delete(temp.id);
    world.files.addVersion(world.state.files[0]?.id as string, 1234, "neu");
    world.files.createGenerated({ name: "Neu.md", mimeType: "text/markdown", sizeBytes: 10, category: "generated", content: "x" });
    const project = world.state.researchProjects[0];
    if (project) {
      const source = world.research.addSource(project.id, { title: "Quelle", domain: "quelle.example" });
      world.research.addFinding(project.id, { statement: "Aussage", sourceIds: [source.id] });
    }
    const approval = world.approvals.raise({ type: "system_change", action: "Neustart", riskTier: 1, rationale: "r", preview: { kind: "text", title: "t", body: "b" }, expiresInMs: 1000 });
    world.clock.advance(2000);
    expect(world.approvals.get(approval.id).status).toBe("expired");
    const agent = world.state.agents[1];
    if (agent) world.agents.pause(agent.id);
    const automation = world.state.automations[0];
    if (automation) world.automations.test(automation.id, { dryRun: false });
    const calendarEvent = world.state.calendarEvents[0];
    if (calendarEvent) {
      const proposal = world.calendar.createProposal({ type: "cancel", eventId: calendarEvent.id, reason: "Absage" });
      world.approvals.approve(proposal.approvalId as string);
    }
    const [first, second] = world.state.calendarEvents.filter((candidate) => !candidate.allDay && candidate.status !== "cancelled");
    if (first && second) {
      const overlap = world.calendar.createProposal({ type: "reschedule", eventId: first.id, start: second.start, end: second.end, reason: "Test" });
      world.approvals.approve(overlap.approvalId as string);
    }
    world.setCapability("voice", "test", false);
    world.clock.advance(20_000);

    const seen = new Set(recorder.events.map((event) => event.type));
    const missing = JARVIS_EVENT_TYPES.filter((type) => !seen.has(type));
    expect(missing).toEqual([]);
    expect(eventProblems(recorder.events)).toEqual([]);
  });
});
