import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApi, type ApiClient, type TestApi } from "./helpers";
import { WsProbe } from "./support/ws";

const CONTROL = "/api/v1/dev/scenarios/control";

describe("scenario console: release_orb_state and play_event", () => {
  let api: TestApi;
  let owner: ApiClient;
  let probe: WsProbe;

  beforeAll(async () => {
    api = await startTestApi({ listen: true });
    owner = api.client();
    await owner.loginDev("owner");
    probe = await WsProbe.connect(api, owner);
  });
  afterAll(async () => {
    probe.close();
    await api.close();
  });

  const control = (body: unknown) => owner.post(CONTROL, body);
  const orbMode = async (): Promise<string> => (await owner.get("/api/v1/orb/status")).json().data.status.mode;

  describe("release_orb_state", () => {
    it("forces an orb state and releases it again", async () => {
      const derived = await orbMode();
      const forced = await control({ action: "force_orb_state", mode: "error", activityText: "Verbindung zum Kalender verloren" });
      expect(forced.statusCode, forced.body).toBe(200);
      expect(forced.json().data.forcedOrbMode).toBe("error");
      expect(await orbMode()).toBe("error");

      const released = await control({ action: "release_orb_state" });
      expect(released.statusCode, released.body).toBe(200);
      expect(released.json().data.forcedOrbMode).toBeNull();
      expect(await orbMode()).toBe(derived);
    });

    it("is a no-op when nothing is forced and needs the owner role", async () => {
      expect((await control({ action: "release_orb_state" })).statusCode).toBe(200);
      const operator = api.client();
      await operator.loginDev("operator");
      expect((await operator.post(CONTROL, { action: "release_orb_state" })).statusCode).toBe(403);
    });
  });

  describe("play_event", () => {
    it("publishes the event with its payload on the event stream", async () => {
      probe.frames.length = 0;
      const payload = { utteranceId: "utt_demo_0001", text: "Wie ist der Stand", final: false, confidence: 0.8, language: "de", startedAt: "2026-10-14T08:15:00Z" };
      const response = await control({ action: "play_event", eventType: "friday.voice.transcript_partial", subject: "voice/utterance", payload });
      expect(response.statusCode, response.body).toBe(200);
      await probe.waitFor(() => probe.events().some((event) => event.type === "friday.voice.transcript_partial"), 3_000, "abgespieltes Ereignis");
      const event = probe.events().find((candidate) => candidate.type === "friday.voice.transcript_partial");
      expect(event.data).toEqual(payload);
      expect(event.subject).toBe("voice/utterance");
    });

    it("derives the payload from the current state for state-mirroring event types", async () => {
      probe.frames.length = 0;
      for (const eventType of ["friday.orb.status_changed", "friday.status.changed", "friday.system.metrics", "friday.voice.state_changed"]) {
        const response = await control({ action: "play_event", eventType });
        expect(response.statusCode, `${eventType}: ${response.body}`).toBe(200);
      }
      const wanted = ["friday.orb.status_changed", "friday.status.changed", "friday.system.metrics", "friday.voice.state_changed"];
      await probe.waitFor(() => wanted.every((type) => probe.events().some((event) => event.type === type)), 3_000, "vier abgespielte Ereignisse");
    });

    it("rejects an unknown event type, a missing payload and a payload that violates the event schema", async () => {
      const unknown = await control({ action: "play_event", eventType: "friday.nothing.happened", payload: {} });
      expect(unknown.statusCode).toBe(422);
      expect(unknown.json().error.code).toBe("VALIDATION_FAILED");

      const missing = await control({ action: "play_event", eventType: "friday.task.created" });
      expect(missing.statusCode).toBe(422);
      expect(missing.json().error.details.fieldErrors).toEqual([{ path: "payload", message: "erforderlich" }]);

      const invalid = await control({ action: "play_event", eventType: "friday.voice.transcript_partial", payload: { text: 5 } });
      expect(invalid.statusCode).toBe(422);
      expect(invalid.json().error.details.fieldErrors.length).toBeGreaterThan(0);

      const malformedType = await control({ action: "play_event", eventType: "not-an-event" });
      expect(malformedType.statusCode).toBe(422);
    });

    it("does not publish anything for rejected events", async () => {
      probe.frames.length = 0;
      const rejected = await control({ action: "play_event", eventType: "friday.task.created", payload: { id: "kaputt" } });
      expect(rejected.statusCode).toBe(422);
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(probe.events().some((event) => event.type === "friday.task.created")).toBe(false);
    });
  });
});

describe("GET /meta carries the mock world's UI hints", () => {
  let api: TestApi;
  let owner: ApiClient;

  beforeAll(async () => {
    api = await startTestApi();
    owner = api.client();
    await owner.loginDev("owner");
  });
  afterAll(async () => {
    await api.close();
  });

  const features = async (): Promise<Record<string, boolean>> => (await owner.get("/api/v1/meta")).json().features;

  it("passes forceOrbFallback2D and reducedMotion through while a scenario sets them and clears them on reset", async () => {
    const before = await features();
    expect(before.forceOrbFallback2D).toBeFalsy();
    expect(before.reducedMotion).toBeFalsy();

    expect((await owner.post("/api/v1/dev/scenarios/webgl-failure/play?speed=10")).statusCode).toBe(200);
    const webgl = await features();
    expect(webgl.forceOrbFallback2D).toBe(true);
    expect(webgl.reducedMotion).toBeFalsy();

    expect((await owner.post("/api/v1/dev/scenarios/reduced-motion/play?speed=10")).statusCode).toBe(200);
    const reduced = await features();
    expect(reduced.reducedMotion).toBe(true);
    expect(reduced.forceOrbFallback2D).toBeFalsy();

    await owner.post(CONTROL, { action: "reset" });
    const after = await features();
    expect(after.reducedMotion).toBeFalsy();
    expect(after.forceOrbFallback2D).toBeFalsy();
  });

  it("never lets a UI hint shadow a core feature flag", async () => {
    const flags = await features();
    expect(flags.devScenarios).toBe(true);
    expect(flags.mockData).toBe(true);
    expect(flags.devAuth).toBe(true);
  });
});
