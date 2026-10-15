import type { JarvisEvent } from "@jarvis/sdk";
import { describe, expect, it } from "vitest";
import { MockWorld, ORB_TEXT, ScenarioEngine, orbText } from "../src";
import { eventProblems, expectApiError, record } from "./support";

describe("injectable sequence provider", () => {
  it("numbers events and ActivityEvent.sequence with the provider (peek semantics, floor = seeded sequence)", () => {
    let head = 1000;
    const floors: number[] = [];
    const world = new MockWorld({
      nextSequence: (floor) => {
        floors.push(floor);
        return Math.max(head, floor) + 1;
      },
    });
    const seeded = Math.max(...world.state.activity.map((item) => item.sequence));
    const recorder = record(world);
    const activity = world.logActivity({ kind: "system", title: "Test", correlationId: world.correlationId(), adapterId: "mock-activity" });
    const appended = recorder.events.find((event) => event.type === "jarvis.activity.appended");
    expect(appended?.sequence).toBe(1001);
    expect(activity.sequence).toBe(1001);
    expect(activity.sequence).toBe(appended?.sequence);
    expect(floors.every((floor) => floor >= seeded - 1 || floor === world.state.sequence)).toBe(true);
    // the provider (a hub) advances when it publishes; the next event follows
    head = 1001;
    const next = world.logActivity({ kind: "system", title: "Nummer zwei", correlationId: world.correlationId(), adapterId: "mock-activity" });
    expect(next.sequence).toBe(1002);
  });

  it("serves listActivity?sinceSequence= with the provider's numbers", () => {
    let head = 500;
    const world = new MockWorld({ nextSequence: (floor) => Math.max(head, floor) + 1 });
    const first = world.logActivity({ kind: "system", title: "A", correlationId: world.correlationId(), adapterId: "mock-activity" });
    head = first.sequence;
    const second = world.logActivity({ kind: "system", title: "B", correlationId: world.correlationId(), adapterId: "mock-activity" });
    head = second.sequence;
    const page = world.activity.list({ sinceSequence: first.sequence, limit: 50 });
    expect(page.items.map((item) => item.title)).toEqual(["B"]);
    expect(world.activity.list({ sinceSequence: second.sequence, limit: 50 }).items).toEqual([]);
  });

  it("rejects a provider that does not return a number above the floor", () => {
    const world = new MockWorld({ nextSequence: () => 1 });
    expect(() => world.logActivity({ kind: "system", title: "x", correlationId: world.correlationId(), adapterId: "mock-activity" })).toThrow(/nextSequence/);
  });

  it("keeps the internal counter by default", () => {
    const world = new MockWorld();
    const recorder = record(world);
    const first = world.logActivity({ kind: "system", title: "x", correlationId: world.correlationId(), adapterId: "mock-activity" });
    const second = world.logActivity({ kind: "system", title: "y", correlationId: world.correlationId(), adapterId: "mock-activity" });
    expect(second.sequence).toBe(first.sequence + 1);
    expect(recorder.events.filter((event) => event.type === "jarvis.activity.appended").map((event) => event.sequence)).toEqual([first.sequence, second.sequence]);
  });
});

describe("scenario console: release_orb_state and play_event", () => {
  it("force_orb_state / release_orb_state round trip", () => {
    const world = new MockWorld();
    const engine = ScenarioEngine.for(world);
    const derived = world.orbSnapshot().status.mode;
    expect(engine.control({ action: "force_orb_state", mode: "error", activityText: "Test" }).forcedOrbMode).toBe("error");
    expect(world.orbSnapshot().status.mode).toBe("error");
    expect(engine.control({ action: "release_orb_state" }).forcedOrbMode).toBeNull();
    expect(world.orbSnapshot().status.mode).toBe(derived);
  });

  it("play_event emits the event with a payload validated against its schema", () => {
    const world = new MockWorld();
    const engine = ScenarioEngine.for(world);
    const recorder = record(world);
    const payload = { utteranceId: "utt_demo_0001", text: "Hallo", final: false, language: "de", startedAt: "2026-10-14T08:15:00Z" };
    engine.control({ action: "play_event", eventType: "jarvis.voice.transcript_partial", subject: "voice/utterance", payload });
    const played = recorder.events.find((event) => event.type === "jarvis.voice.transcript_partial") as JarvisEvent;
    expect(played.data).toEqual(payload);
    expect(played.subject).toBe("voice/utterance");
    expect(eventProblems(recorder.events)).toEqual([]);
  });

  it("play_event derives state-mirroring payloads and rejects everything else without a payload", () => {
    const world = new MockWorld();
    const engine = ScenarioEngine.for(world);
    const recorder = record(world);
    for (const eventType of ["jarvis.orb.status_changed", "jarvis.status.changed", "jarvis.system.metrics", "jarvis.voice.state_changed", "jarvis.status.resync_required"] as const) {
      engine.control({ action: "play_event", eventType });
      expect(recorder.events.some((event) => event.type === eventType), eventType).toBe(true);
    }
    expect(eventProblems(recorder.events)).toEqual([]);
    expect(expectApiError(() => engine.control({ action: "play_event", eventType: "jarvis.task.created" }))).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(expectApiError(() => engine.control({ action: "play_event", eventType: "jarvis.unknown.thing", payload: {} }))).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(expectApiError(() => engine.control({ action: "play_event", eventType: "jarvis.voice.transcript_partial", payload: { text: 5 } }))).toMatchObject({ code: "VALIDATION_FAILED" });
  });
});

describe("assistant name in generated texts", () => {
  it("words the orb status line and the status label with the configured name", () => {
    const world = new MockWorld({ assistantName: () => "Fridolin" });
    world.forceOrbState("speaking");
    expect(world.orbSnapshot().status.activityText).toBe("FRIDOLIN SPRICHT");
    world.forceOrbState("booting");
    expect(world.orbSnapshot().status.activityText).toBe("FRIDOLIN WIRD INITIALISIERT");
    expect(world.jarvisStatus().label).toMatch(/^Fridolin /);
  });

  it("defaults to F.R.I.D.A.Y. and follows the world's own profile setting", () => {
    const world = new MockWorld();
    world.forceOrbState("speaking");
    expect(world.orbSnapshot().status.activityText).toBe("F.R.I.D.A.Y. SPRICHT");
    world.state.settings.profile.assistantName = "Edith";
    expect(world.orbSnapshot().status.activityText).toBe("EDITH SPRICHT");
    expect(ORB_TEXT.speaking).toBe("F.R.I.D.A.Y. SPRICHT");
    expect(orbText("booting", "Edith")).toBe("EDITH WIRD INITIALISIERT");
  });

  it("contains no legacy brand in user-visible texts (install paths, event names, ids and the wake word are not texts)", () => {
    const allowed = [/D:\\Jarvis/, /^jarvis\./, /Ereignis jarvis\./, /^jarvis-/, /^Hey Jarvis$/];
    for (const profile of ["default", "empty", "highLoad", "longGerman"] as const) {
      const world = new MockWorld({ profile });
      const offenders: string[] = [];
      const walk = (value: unknown, path: string): void => {
        if (typeof value === "string") {
          if (/jarvis/i.test(value) && !allowed.some((pattern) => pattern.test(value))) offenders.push(`${path}: ${value.slice(0, 60)}`);
        } else if (Array.isArray(value)) value.forEach((item, index) => walk(item, `${path}[${index}]`));
        else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) walk(item, `${path}.${key}`);
      };
      walk(world.state, profile);
      walk(world.orbSnapshot(), "orb");
      expect(offenders).toEqual([]);
    }
  });
});

describe("built-in command intents", () => {
  const history = (world: MockWorld) => world.commands.history({ limit: 20 }).items;

  it("classifies 'Sprachaufnahme starten' and lists it in the command history", () => {
    const world = new MockWorld();
    const response = world.commands.execute({ text: "Sprachaufnahme starten", source: "voice" });
    expect(response).toMatchObject({ status: "executed", requiresConfirmation: false, riskTier: 1, approvalId: null });
    expect(world.state.voice.status.mode).toBe("listening");
    expect(history(world)[0]).toMatchObject({ text: "Sprachaufnahme starten", status: "executed", origin: "voice" });
  });

  it("toggles the focus mode and refuses a recording while it is on", () => {
    const world = new MockWorld();
    expect(world.state.voice.status.focusMode).toBe(false);
    expect(world.commands.execute({ text: "Fokus-Modus umschalten", source: "quick_command" }).status).toBe("executed");
    expect(world.state.voice.status.focusMode).toBe(true);
    expect(world.commands.execute({ text: "Sprachaufnahme starten", source: "voice" })).toMatchObject({ status: "rejected" });
    expect(world.commands.execute({ text: "Fokus-Modus umschalten", source: "quick_command" }).status).toBe("executed");
    expect(world.state.voice.status.focusMode).toBe(false);
    expect(history(world).map((entry) => entry.text).slice(0, 3)).toEqual(["Fokus-Modus umschalten", "Sprachaufnahme starten", "Fokus-Modus umschalten"]);
  });

  it("is tolerant against case, punctuation and spoken variants but not against free text", () => {
    const world = new MockWorld();
    for (const text of ["  sprachaufnahme   STARTEN! ", "Starte Sprachaufnahme", "fokusmodus umschalten", "Schalte den Fokus-Modus um"]) {
      expect(world.commands.execute({ text, source: "voice" }).status, text).toBe("executed");
    }
    const free = world.commands.execute({ text: "Sprachaufnahme starten und Mail schreiben", source: "voice" });
    expect(free.status).toBe("accepted"); // goes to the agent like any other request
  });
});

describe("empty profile", () => {
  it("has no linked memory entries (projects + people) and no memory at all", () => {
    const world = new MockWorld({ profile: "empty" });
    expect(world.memory.list({ limit: 1 }).pageInfo.totalCount).toBe(0);
    expect(world.memory.list({ type: ["project"], limit: 1 }).pageInfo.totalCount).toBe(0);
    expect(world.memory.list({ type: ["person"], limit: 1 }).pageInfo.totalCount).toBe(0);
  });

  it("the empty-new-installation scenario ends with zero linked memory entries, also when played from a populated world", () => {
    const world = new MockWorld();
    expect(world.memory.list({ type: ["project"], limit: 1 }).pageInfo.totalCount).toBeGreaterThan(0);
    const engine = ScenarioEngine.for(world);
    engine.play("empty-new-installation");
    engine.runToCompletion();
    const linked = (world.memory.list({ type: ["project"], limit: 1 }).pageInfo.totalCount ?? 0) + (world.memory.list({ type: ["person"], limit: 1 }).pageInfo.totalCount ?? 0);
    expect(linked).toBe(0);
  });
});

describe("command classifier: searches and reads are not payments", () => {
  it.each(["Suche Rechnung Becker Zahlungsziel", "suche nach Zahlungsziel", "Finde die Bestellung von gestern", "Zeige mir alle Zahlungen", "Wann ist die Zahlung fällig?"])(
    "%s executes read-only without confirmation or approval",
    (text) => {
      const world = new MockWorld();
      const response = world.commands.execute({ text, source: "text" });
      expect(response.requiresConfirmation, text).toBe(false);
      expect(response.approvalId).toBeNull();
      expect(response.riskTier === null || response.riskTier < 3, text).toBe(true);
    },
  );

  it.each(["Überweise 250 Euro an Erik Brandt", "Bezahle die Rechnung 2026-1142", "Bestelle Toner für das Büro"])("%s still needs a tier-3 confirmation", (text) => {
    const world = new MockWorld();
    expect(world.commands.execute({ text, source: "text" })).toMatchObject({ status: "requires_confirmation", riskTier: 3 });
  });
});
