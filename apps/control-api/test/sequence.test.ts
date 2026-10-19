/* eslint-disable @typescript-eslint/no-explicit-any -- test code reads untyped JSON bodies and frames that the contract validators check */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApi, type ApiClient, type TestApi } from "./helpers";
import { WsProbe } from "./support/ws";
import { createApprovedTask } from "./support/task-actions";
import { confirmedHeaders, stageKnowledgeWrite } from "./support/knowledge-actions";

/** In mock mode the world numbers its events with the hub's global sequence (one counter for REST backfill and stream). */
describe("hub sequence = activity sequence (mock mode)", () => {
  let api: TestApi;
  let owner: ApiClient;
  let probe: WsProbe;

  beforeAll(async () => {
    api = await startTestApi({ listen: true });
    owner = api.client();
    await owner.loginDev("owner");
    probe = await WsProbe.connect(api, owner);
    // Staged knowledge writes execute directly after confirmation in these sequence tests.
    const settings = (await owner.get("/api/v1/settings")).json().data;
    await owner.patch("/api/v1/settings", { approvals: { ...settings.approvals, confirmTier2: false } },
      { headers: { "if-match": String(settings.version) } });
  });
  afterAll(async () => {
    probe.close();
    await api.close();
  });

  const activityEnvelopes = (): any[] => probe.events().filter((event) => event.type === "friday.activity.appended");

  it("keeps seeded activity below every live event", async () => {
    const seeded = (await owner.get("/api/v1/activity", { query: { limit: "200" } })).json().items as any[];
    const maxSeeded = Math.max(...seeded.map((item) => item.sequence as number));
    expect(api.runtime.hub.latestSequence).toBeGreaterThanOrEqual(maxSeeded);
    const before = api.runtime.hub.latestSequence;
    await createApprovedTask(owner, { title: "Sequenz prüfen" });
    await probe.waitFor(() => activityEnvelopes().length > 0, 3_000, "activity.appended");
    expect(activityEnvelopes()[0].sequence).toBeGreaterThan(before);
    expect(activityEnvelopes()[0].sequence).toBeGreaterThan(maxSeeded);
  });

  it("gives the envelope of friday.activity.appended the sequence of its ActivityEvent", async () => {
    await createApprovedTask(owner, { title: "Zweite Aufgabe" });
    const memoryPreview = await stageKnowledgeWrite(owner, "POST", "/api/v1/memory", { type: "fact", content: "Sequenz-Gleichheit" });
    await owner.post("/api/v1/memory", { type: "fact", content: "Sequenz-Gleichheit" }, { headers: confirmedHeaders(memoryPreview) });
    await probe.waitFor(() => activityEnvelopes().length >= 3, 3_000, "mehrere activity.appended");
    const envelopes = activityEnvelopes();
    expect(envelopes.length).toBeGreaterThanOrEqual(3);
    for (const envelope of envelopes) expect(envelope.data.sequence, `Aktivität ${envelope.data.id}`).toBe(envelope.sequence);

    // The activity read model returns the very same numbers.
    for (const envelope of envelopes) {
      const read = await owner.get(`/api/v1/activity/${envelope.data.id}`);
      expect(read.statusCode).toBe(200);
      expect(read.json().data.sequence).toBe(envelope.sequence);
    }
  });

  it("backfills missed events with listActivity?sinceSequence= using the stream's numbers", async () => {
    const cursor = api.runtime.hub.latestSequence;
    probe.frames.length = 0;
    await createApprovedTask(owner, { title: "Backfill A" });
    await createApprovedTask(owner, { title: "Backfill B" });
    const head = api.runtime.hub.latestSequence;
    await probe.waitFor(() => probe.events().some((event) => event.sequence === head), 3_000, "Strom hat den Kopf der Sequenz erreicht");
    expect(activityEnvelopes().filter((envelope) => envelope.sequence > cursor).length).toBeGreaterThanOrEqual(2);

    const response = await owner.get("/api/v1/activity", { query: { sinceSequence: String(cursor), limit: "100" } });
    expect(response.statusCode, response.body).toBe(200);
    const items = response.json().items as any[];
    const streamed = activityEnvelopes()
      .filter((envelope) => envelope.sequence > cursor)
      .map((envelope) => ({ id: envelope.data.id, sequence: envelope.sequence }));
    expect(items.map((item) => ({ id: item.id, sequence: item.sequence }))).toEqual(streamed);
    expect(items.every((item) => item.sequence > cursor)).toBe(true);
    const sequences = items.map((item) => item.sequence as number);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));

    // Nothing is returned beyond the head, and a cursor in the middle only returns the later items.
    expect(((await owner.get("/api/v1/activity", { query: { sinceSequence: String(Math.max(...sequences)) } })).json().items as any[]).length).toBe(0);
    const middle = await owner.get("/api/v1/activity", { query: { sinceSequence: String(sequences[0]) } });
    expect((middle.json().items as any[]).map((item) => item.sequence)).toEqual(sequences.slice(1));
  });

  it("stays contiguous on the stream (no gaps caused by the world's own numbering)", async () => {
    probe.frames.length = 0;
    await createApprovedTask(owner, { title: "Lückenlos" });
    await probe.waitFor(() => probe.events().length >= 2, 3_000, "Ereignisse");
    const sequences = probe.events().map((event) => event.sequence as number);
    for (let index = 1; index < sequences.length; index += 1) expect(sequences[index]).toBe((sequences[index - 1] as number) + 1);
  });

  it("keeps the numbering after a scenario reset replaced the world state", async () => {
    await owner.post("/api/v1/dev/scenarios/control", { action: "reset" });
    const before = api.runtime.hub.latestSequence;
    probe.frames.length = 0;
    await createApprovedTask(owner, { title: "Nach Reset" });
    await probe.waitFor(() => activityEnvelopes().length > 0, 3_000, "activity.appended nach Reset");
    const envelope = activityEnvelopes()[0];
    expect(envelope.sequence).toBeGreaterThan(before);
    expect(envelope.data.sequence).toBe(envelope.sequence);
  });
});
