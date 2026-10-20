import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { openDatabase } from "../src/db/database";
import { localCalendarReads } from "../src/handlers/local-calendar";
import type { Handler, RequestContext } from "../src/http/context";
import { LocalCalendarService } from "../src/services/local-calendar";
import { startTestApi } from "./helpers";

const folders: string[] = [];
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });

it("persists local events across database restart and enforces owner and revision on edits", () => {
  const folder = mkdtempSync(join(tmpdir(), "friday-local-calendar-"));
  folders.push(folder);
  const path = join(folder, "dashboard.sqlite");
  const firstDb = openDatabase(path);
  const first = new LocalCalendarService(firstDb);
  const input = { title: "  Freitag Planung  ", start: "2026-11-02T10:00:00.000Z", end: "2026-11-02T11:00:00.000Z", timeZone: "Europe/Berlin" };
  const created = first.create(input, "owner-1");
  expect(created.title).toBe("Freitag Planung");
  expect(first.list("2026-11-02T00:00:00Z", "2026-11-03T00:00:00Z").map((item) => item.id)).toEqual([created.id]);
  firstDb.close();

  const secondDb = openDatabase(path);
  const second = new LocalCalendarService(secondDb);
  expect(second.get(created.id).version).toBe(1);
  expect(() => second.update(created.id, { ...input, title: "Fremd" }, "owner-2", 1)).toThrow();
  const updated = second.update(created.id, { ...input, title: "Planung 2" }, "owner-1", 1);
  expect(updated.version).toBe(2);
  expect(() => second.update(created.id, input, "owner-1", 1)).toThrow();
  expect(() => second.delete(created.id, "owner-1", 1)).toThrow();
  second.delete(created.id, "owner-1", 2);
  expect(second.list("2026-11-02T00:00:00Z", "2026-11-03T00:00:00Z")).toEqual([]);
  secondDb.close();
});

it("rejects invalid local times and zones", () => {
  const db = openDatabase(":memory:");
  const calendar = new LocalCalendarService(db);
  expect(() => calendar.create({ title: "A", start: "2026-11-02T11:00:00Z", end: "2026-11-02T10:00:00Z", timeZone: "Europe/Berlin" }, "owner")).toThrow();
  expect(() => calendar.create({ title: "A", start: "2026-11-02T10:00:00Z", end: "2026-11-02T11:00:00Z", timeZone: "Nowhere/Invalid" }, "owner")).toThrow();
  db.close();
});

it("serves the local event through the calendar API while requiring owner and CSRF for writes", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const mockNow = new Date(api.runtime.nowMs()).toISOString();
    const owner = api.client();
    const viewer = api.client();
    await owner.loginDev("owner");
    await viewer.loginDev("viewer");
    // Tier-2 approval off: a confirmed preview executes directly and stores its receipt.
    const settings = (await owner.get("/api/v1/settings")).json().data;
    expect((await owner.patch("/api/v1/settings", { approvals: { ...settings.approvals, confirmTier2: false } },
      { headers: { "if-match": String(settings.version) } })).statusCode).toBe(200);
    const path = "/api/v1/calendar/local/events";
    const body = { title: "Lokaler Termin", start: "2026-11-02T10:00:00.000Z", end: "2026-11-02T11:00:00.000Z", timeZone: "Europe/Berlin" };
    expect((await viewer.post(path, body, { headers: { "Idempotency-Key": "local-key-123456" } })).statusCode).toBe(403);
    expect((await owner.post(path, body, { csrf: false, headers: { "Idempotency-Key": "local-key-123456" } })).statusCode).toBe(403);
    // The first write only stages an exact preview; nothing is persisted yet.
    const staged = await owner.post(path, body, { headers: { "Idempotency-Key": "local-key-123456" } });
    expect(staged.statusCode, staged.body).toBe(403);
    expect(staged.json().error.code).toBe("APPROVAL_REQUIRED");
    expect(staged.json().error.details.stage).toBe("preview");
    const previewId = staged.json().error.details.previewId as string;
    expect(api.runtime.db.prepare("SELECT COUNT(*) AS count FROM local_calendar_events").get()).toMatchObject({ count: 0 });
    const confirmHeaders = { "Idempotency-Key": "local-key-123456", "x-action-preview-id": previewId };
    // A changed body no longer matches the saved preview.
    expect((await owner.post(path, { ...body, title: "Anderer Termin" }, { headers: confirmHeaders })).statusCode).toBe(409);
    const created = await owner.post(path, body, { headers: confirmHeaders });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json().freshness.asOf).toBe(mockNow);
    const id = created.json().data.id as string;
    const replay = await owner.post(path, body, { headers: confirmHeaders });
    expect(replay.statusCode).toBe(201);
    expect(replay.json().data.id).toBe(id);
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    expect((await owner.post(path, { ...body, title: "Anderer Termin" }, { headers: { "Idempotency-Key": "local-key-123456" } })).statusCode).toBe(409);
    expect(api.runtime.db.prepare("SELECT COUNT(*) AS count FROM local_calendar_events").get()).toMatchObject({ count: 1 });
    const listed = await owner.get("/api/v1/calendar/events?from=2026-11-02T00:00:00.000Z&to=2026-11-03T00:00:00.000Z");
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json().freshness.asOf).toBe(mockNow);
    expect(listed.json().freshness.state).toBe("fresh");
    expect(listed.json().items.some((item: { id: string }) => item.id === id)).toBe(true);
    const bridge = await api.client().get("/api/v1/calendar/events?from=2026-11-02T00:00:00.000Z&to=2026-11-03T00:00:00.000Z", { headers: { authorization: `Bearer ${api.runtime.calendarBridgeKey.toString("base64")}` } });
    expect(bridge.statusCode).toBe(200);
    expect(bridge.json().items.some((item: { id: string }) => item.id === id)).toBe(true);
    const detail = await owner.get(`/api/v1/calendar/events/${id}`);
    expect(detail.statusCode).toBe(200);
    expect(detail.json().freshness.asOf).toBe(mockNow);
    expect(detail.json().data.source.adapterId).toBe("friday-local-calendar");
    // Updates stage the same way; a stale If-Match fails before anything is staged.
    const stale = await owner.request("PUT", `${path}/${id}`, { body: { ...body, title: "Neu" }, headers: { "If-Match": "2" } });
    expect(stale.statusCode).toBe(409);
    const stagedUpdate = await owner.request("PUT", `${path}/${id}`, { body: { ...body, title: "Neu" }, headers: { "If-Match": "1" } });
    expect(stagedUpdate.statusCode, stagedUpdate.body).toBe(403);
    const updatePreviewId = stagedUpdate.json().error.details.previewId as string;
    const changed = await owner.request("PUT", `${path}/${id}`,
      { body: { ...body, title: "Neu" }, headers: { "If-Match": "1", "x-action-preview-id": updatePreviewId } });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json().data.version).toBe(2);
    expect((await owner.request("DELETE", `${path}/${id}`, { headers: { "If-Match": "1" } })).statusCode).toBe(409);
    const stagedDelete = await owner.request("DELETE", `${path}/${id}`, { headers: { "If-Match": "2" } });
    expect(stagedDelete.statusCode, stagedDelete.body).toBe(403);
    const deleted = await owner.request("DELETE", `${path}/${id}`,
      { headers: { "If-Match": "2", "x-action-preview-id": stagedDelete.json().error.details.previewId as string } });
    expect(deleted.statusCode, deleted.body).toBe(200);
    expect((await owner.get(`/api/v1/calendar/events/${id}`)).statusCode).toBe(404);
  } finally { await api.close(); }
});

it("paginates mixed local and remote events without repeats or dangling cursors", async () => {
  const db = openDatabase(":memory:");
  try {
    const calendar = new LocalCalendarService(db);
    const make = (hour: number) => ({ title: `Termin ${hour}`, start: `2026-11-02T${String(hour).padStart(2, "0")}:00:00.000Z`, end: `2026-11-02T${String(hour + 1).padStart(2, "0")}:00:00.000Z`, timeZone: "Europe/Berlin" });
    calendar.create(make(10), "owner");
    calendar.create(make(12), "owner");
    const remoteEvents = [9, 11, 14].map((hour) => ({ ...calendar.create(make(hour), "remote"), id: `remote-${hour}`, source: { adapterId: "ics-calendar", system: "ics", lastSyncedAt: new Date().toISOString() } }));
    for (const hour of [9, 11, 14]) {
      const row = db.prepare("SELECT id FROM local_calendar_events WHERE owner_id = 'remote' AND title = ?").get(`Termin ${hour}`) as { id: string };
      db.prepare("DELETE FROM local_calendar_events WHERE id = ?").run(row.id);
    }
    const remote: Handler = async (ctx) => {
      const offset = Number(ctx.query.cursor ?? 0);
      const limit = Number(ctx.query.limit ?? 200);
      return { status: 200, body: {
        contractVersion: "2.0.0", items: remoteEvents.slice(offset, offset + limit),
        pageInfo: { hasNextPage: offset + limit < remoteEvents.length, nextCursor: offset + limit < remoteEvents.length ? String(offset + limit) : null },
        freshness: { state: "fresh", asOf: new Date().toISOString() }, sources: [remoteEvents[0]!.source],
      } };
    };
    const list = localCalendarReads(remote, remote).listCalendarEvents!;
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 4; page++) {
      const ctx = { runtime: { db, config: { dataMode: "mock" }, nowMs: () => Date.parse("2026-10-14T08:00:00.000Z") }, query: { from: "2026-11-02T00:00:00.000Z", to: "2026-11-03T00:00:00.000Z", limit: 2, ...(cursor ? { cursor } : {}) } } as unknown as RequestContext;
      const body = (await list(ctx)).body as { items: Array<{ title: string; source: { system: string } }>; sources: Array<{ system: string }>; pageInfo: { hasNextPage: boolean; nextCursor: string | null } };
      seen.push(...body.items.map((item) => item.title));
      expect(body.items.every((item) => item.source.system === "friday-local" || item.source.system === "ics")).toBe(true);
      expect(body.pageInfo.hasNextPage).toBe(body.pageInfo.nextCursor !== null);
      if (!body.pageInfo.hasNextPage) break;
      cursor = body.pageInfo.nextCursor;
    }
    expect(seen).toEqual(["Termin 9", "Termin 10", "Termin 11", "Termin 12", "Termin 14"]);
  } finally { db.close(); }
});
