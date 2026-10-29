/* eslint-disable @typescript-eslint/no-explicit-any -- test code reads untyped JSON bodies and frames that the contract validators check */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FRIDAY_EVENT_DATA_SCHEMA_IDS, createSchemaValidator, isFridayEventType } from "@friday/sdk";
import { ApiClient, startTestApi, type TestApi } from "./helpers";
import { WsProbe } from "./support/ws";
import { createApprovedTask } from "./support/task-actions";
import { confirmedHeaders, stageKnowledgeWrite } from "./support/knowledge-actions";

const validator = createSchemaValidator();

function assertEnvelope(event: any): void {
  const envelope = validator.validate("EventEnvelope", event);
  expect(envelope.valid, `${event.type}: ${JSON.stringify(envelope.errors)}`).toBe(true);
  expect(isFridayEventType(event.type), `bekannter Ereignistyp ${event.type}`).toBe(true);
  const data = validator.validate(FRIDAY_EVENT_DATA_SCHEMA_IDS[event.type as keyof typeof FRIDAY_EVENT_DATA_SCHEMA_IDS], event.data);
  expect(data.valid, `${event.type} data: ${JSON.stringify(data.errors)}`).toBe(true);
}

describe("WebSocket /api/v1/events", () => {
  let api: TestApi;
  let owner: ApiClient;
  const open: WsProbe[] = [];

  const connect = async (client: ApiClient | null, options?: Parameters<typeof WsProbe.connect>[2]) => {
    const probe = await WsProbe.connect(api, client, options);
    open.push(probe);
    return probe;
  };
  const createTask = (title: string, client = owner) => createApprovedTask(client, { title });

  beforeEach(async () => {
    api = await startTestApi({ listen: true, ringBufferSize: 100, heartbeatSeconds: 1 });
    owner = api.client();
    await owner.loginDev("owner");
    // Staged knowledge writes execute directly after confirmation in these event-stream tests.
    const settings = (await owner.get("/api/v1/settings")).json().data;
    await owner.patch("/api/v1/settings", { approvals: { ...settings.approvals, confirmTier2: false } },
      { headers: { "if-match": String(settings.version) } });
  });
  afterEach(async () => {
    for (const probe of open.splice(0)) probe.close();
    await api.close();
  });

  describe("connection", () => {
    it("refuses unauthenticated clients with 401", async () => {
      await expect(connect(null)).rejects.toMatchObject({ status: 401 });
      const forged = api.client();
      forged.cookies.set("friday_session", "forged-session");
      await expect(connect(forged)).rejects.toMatchObject({ status: 401 });
    });

    it("refuses foreign origins and foreign hosts with 403", async () => {
      await expect(connect(owner, { origin: "https://evil.example" })).rejects.toMatchObject({ status: 403 });
      await expect(connect(owner, { host: "evil.example" })).rejects.toMatchObject({ status: 403 });
    });

    it("answers other upgrade paths with a closed socket", async () => {
      await expect(connect(owner, { path: "/api/v1/other" })).rejects.toBeDefined();
    });

    it("serves viewers too (read-only role)", async () => {
      const viewer = api.client();
      await viewer.loginDev("viewer");
      const probe = await connect(viewer);
      await createTask("Viewer sieht Ereignisse");
      await probe.waitFor((p) => p.events().some((event) => event.type === "friday.task.created"), 3_000, "task.created beim Viewer");
    });

    it("announces the stream address in /meta", async () => {
      expect((await owner.get("/api/v1/meta")).json()).toMatchObject({ eventsPath: "/api/v1/events" });
    });
  });

  describe("envelopes", () => {
    it("delivers contract-valid envelopes with a strictly increasing global sequence", async () => {
      const probe = await connect(owner);
      const correlationId = "corr_01ARZ3NDEKTSV4RRFFQ69G5FAV";
      const created = await createApprovedTask(owner, { title: "Ereignistest" }, undefined, { "x-correlation-id": correlationId });
      const taskId = created.task.id;
      const memoryPreview = await stageKnowledgeWrite(owner, "POST", "/api/v1/memory", { type: "fact", content: "Ereignis aus dem Gedächtnis" });
      await owner.post("/api/v1/memory", { type: "fact", content: "Ereignis aus dem Gedächtnis" },
        { headers: confirmedHeaders(memoryPreview, { "x-correlation-id": correlationId }) });
      await probe.waitFor((p) => p.events().length >= 3 && p.events().some((event) => event.type === "friday.task.created"), 3_000, "mindestens 3 Ereignisse");

      const events = probe.events();
      for (const event of events) assertEnvelope(event);
      const sequences = events.map((event) => event.sequence as number);
      expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
      expect(new Set(sequences).size, "keine doppelte Sequenznummer").toBe(sequences.length);
      for (let index = 1; index < sequences.length; index += 1) expect(sequences[index]).toBe((sequences[index - 1] as number) + 1);
      expect(new Set(events.map((event) => event.id)).size).toBe(events.length);

      const task = events.find((event) => event.type === "friday.task.created");
      expect(task.subject).toContain(taskId);
      expect(task.correlationId, "the request's correlation id travels into its events").toBe(correlationId);
      expect(task.source).toMatch(/^adapter:\/\/mock-tasks$/);
      expect(task.contractVersion).toBe("2.0.0");
    });

    it("emits one frame per message (JSON text) and never leaks session data", async () => {
      const probe = await connect(owner);
      await createTask("Leck-Test");
      await probe.waitFor((p) => p.events().length > 0, 3_000, "Ereignis");
      // Prefixed ULIDs (corr_01M6…CSRF3…) are random Crockford base32 and can spell CSRF or SECRET; blank them first.
      const text = probe.frames.map((frame) => frame.raw).join("\n").replace(/\b[a-z]+_[0-9A-HJKMNP-TV-Z]{26}\b/g, "<id>");
      expect(text).not.toMatch(/friday_session|csrf|password|secret/i);
      for (const frame of probe.frames) expect(() => JSON.parse(frame.raw)).not.toThrow();
    });
  });

  describe("?since replay", () => {
    it("replays exactly the events after the given sequence, then continues live", async () => {
      const marker = api.runtime.hub.latestSequence;
      for (let index = 0; index < 3; index += 1) await createTask(`Replay ${index}`);
      const latest = api.runtime.hub.latestSequence;
      expect(latest).toBeGreaterThan(marker);

      const probe = await connect(owner, { since: marker });
      await probe.waitFor((p) => p.events().length >= latest - marker, 3_000, "Replay");
      const replayed = probe.events().map((event) => event.sequence as number);
      expect(replayed).toEqual(Array.from({ length: latest - marker }, (_, index) => marker + index + 1));
      for (const event of probe.events()) assertEnvelope(event);

      await createTask("Live nach Replay");
      await probe.waitFor((p) => p.events().some((event) => event.sequence > latest), 3_000, "Live-Ereignis");
      const sequences = probe.events().map((event) => event.sequence as number);
      expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
      expect(new Set(sequences).size).toBe(sequences.length);
    });

    it("replays nothing when the client is up to date", async () => {
      await createTask("Aktuell");
      const probe = await connect(owner, { since: api.runtime.hub.latestSequence });
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(probe.events()).toEqual([]);
    });

    it("sends friday.status.resync_required when the cursor fell out of the ring buffer", async () => {
      const first = api.runtime.hub.latestSequence;
      for (let index = 0; index < 300 && (api.runtime.hub.oldestSequence ?? 0) <= first + 1; index += 1) await createTask(`Überlauf ${index}`);
      expect(api.runtime.hub.stats().buffered).toBeLessThanOrEqual(100);
      expect(api.runtime.hub.oldestSequence).toBeGreaterThan(first + 1);

      const probe = await connect(owner, { since: first });
      await probe.waitFor((p) => p.events().length > 0, 3_000, "resync_required");
      const [resync] = probe.events();
      assertEnvelope(resync);
      expect(resync.type).toBe("friday.status.resync_required");
      expect(resync.data).toMatchObject({ reason: "sequence_too_old", requestedSince: first, latestSequence: api.runtime.hub.latestSequence });
      expect(resync.data.oldestAvailableSequence).toBe(api.runtime.hub.oldestSequence);
      expect(probe.events(), "no partial replay after a resync request").toHaveLength(1);

      // the resync reuses the head sequence: it must not look like a gap to the other clients
      expect(resync.sequence).toBe(api.runtime.hub.latestSequence);
    });

    it("reports a cursor from the future (server restart) as resync_required", async () => {
      const probe = await connect(owner, { since: api.runtime.hub.latestSequence + 1_000 });
      await probe.waitFor((p) => p.events().length > 0, 3_000, "resync_required");
      expect(probe.events()[0].data.reason).toBe("server_restart");
    });

    it.each(["abc", "-1", "1.5"])("closes the connection for an invalid since=%s", async (since) => {
      const probe = await connect(owner, { since });
      await probe.waitFor((p) => p.closed !== null, 3_000, "close");
      expect(probe.closed?.code).toBe(1008);
    });

    it("announces a reset of the world (scenario reset) with resync_required to live clients and drops the old replay", async () => {
      const probe = await connect(owner);
      const before = api.runtime.hub.latestSequence;
      expect((await owner.post("/api/v1/dev/scenarios/control", { action: "reset" })).statusCode).toBe(200);
      await probe.waitFor((p) => p.events().some((event) => event.type === "friday.status.resync_required"), 3_000, "resync nach Reset");
      const late = await connect(owner, { since: before });
      await late.waitFor((p) => p.events().length > 0, 3_000, "Antwort auf spätes Replay");
      expect(late.events()[0].type).toBe("friday.status.resync_required");
    });
  });

  describe("heartbeat", () => {
    it("pings with control frames (no envelope, no sequence) and keeps pong-answering clients connected", async () => {
      const probe = await connect(owner);
      await probe.waitFor((p) => p.frames.filter((frame) => frame.json.kind === "ping").length >= 2, 4_000, "zwei Pings");
      const pings = probe.frames.map((frame) => frame.json).filter((json) => json.kind === "ping");
      for (const ping of pings) {
        expect(Object.keys(ping).sort()).toEqual(["kind", "ts"]);
        expect(typeof ping.ts).toBe("number");
        expect(Math.abs(ping.ts - Date.now())).toBeLessThan(10_000);
      }
      expect(pings[1].ts).toBeGreaterThan(pings[0].ts);
      expect(probe.closed).toBeNull();
      expect(api.runtime.hub.stats().clients).toBe(1);
    });

    it("answers a client ping with a pong that echoes ts", async () => {
      const probe = await connect(owner);
      probe.socket.send(JSON.stringify({ kind: "ping", ts: 1234567890 }));
      await probe.waitFor((p) => p.frames.some((frame) => frame.json.kind === "pong"), 2_000, "pong");
      expect(probe.frames.find((frame) => frame.json.kind === "pong")?.json).toEqual({ kind: "pong", ts: 1234567890 });
    });

    it("terminates a client that never answers (half-open connection)", async () => {
      const probe = await connect(owner);
      probe.autoPong = false;
      await probe.waitFor((p) => p.closed !== null, 5_000, "Abbruch der stillen Verbindung");
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(api.runtime.hub.stats().clients).toBe(0);
    });

    it("ignores garbage frames without dropping the connection", async () => {
      const probe = await connect(owner);
      probe.socket.send("not json at all");
      probe.socket.send(JSON.stringify({ kind: "unknown" }));
      probe.socket.send(JSON.stringify([1, 2, 3]));
      await createTask("Danach noch Ereignisse");
      await probe.waitFor((p) => p.events().length > 0, 3_000, "Ereignis nach Müll-Frames");
      expect(probe.closed).toBeNull();
    });
  });

  describe("session lifecycle", () => {
    it("closes the socket with 4401 when the session logs out", async () => {
      const client = api.client();
      await client.loginDev("operator");
      const probe = await connect(client);
      expect((await client.post("/api/v1/auth/logout")).statusCode).toBe(200);
      await probe.waitFor((p) => p.closed !== null, 3_000, "close nach Logout");
      expect(probe.closed?.code).toBe(4401);
    });

    it("closes all sockets of the user on logout-all", async () => {
      const a = api.client();
      const b = api.client();
      await a.loginDev("operator");
      await b.loginDev("operator");
      const probeA = await connect(a);
      const probeB = await connect(b);
      await a.post("/api/v1/auth/logout-all");
      await probeA.waitFor((p) => p.closed !== null, 3_000, "close A");
      await probeB.waitFor((p) => p.closed !== null, 3_000, "close B");
      expect(probeB.closed?.code).toBe(4401);
    });

    it("closes with 1001 when the server shuts down", async () => {
      const probe = await connect(owner);
      await api.close();
      await probe.waitFor((p) => p.closed !== null, 3_000, "close beim Shutdown");
      expect(probe.closed?.code).toBe(1001);
      api = await startTestApi({ listen: true }); // keep afterEach symmetrical
    });
  });
});

describe("sequence continuity across restarts", () => {
  it("never reuses sequence numbers after a restart (cursors cannot go backwards)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "friday-seq-"));
    try {
      const first = await startTestApi({ dir, listen: true });
      const client = first.client();
      await client.loginDev("owner");
      for (let index = 0; index < 5; index += 1) await createApprovedTask(client, { title: `Vor Neustart ${index}` });
      const before = first.runtime.hub.latestSequence;
      await first.app.close();

      const second = await startTestApi({ dir, listen: true });
      try {
        const again = second.client();
        await again.loginDev("owner");
        await createApprovedTask(again, { title: "Nach Neustart" });
        expect(second.runtime.hub.latestSequence, "sequence continues above the previous run").toBeGreaterThan(before);
        const probe = await WsProbe.connect(second, again, { since: before });
        try {
          await probe.waitFor((p) => p.events().length > 0, 3_000, "Antwort auf altes Cursor");
          // the ring buffer is gone: a client holding an old cursor must resync, not silently miss events
          expect(probe.events()[0].type).toBe("friday.status.resync_required");
        } finally {
          probe.close();
        }
      } finally {
        await second.app.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
