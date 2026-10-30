import { expect, it } from "vitest";
import type { CalendarEvent } from "@friday/sdk";
import { LocalCalendarService } from "../src/services/local-calendar";
import { startTestApi, type TestApi } from "./helpers";

// Monday 2026-10-19 10:00 Europe/Berlin (CEST, UTC+2). Commands resolve relative dates against runtime.nowMs(),
// which is the mock world's clock in tests — so every test pins the world clock to this instant.
const NOW_ISO = "2026-10-19T08:00:00.000Z";
const ZONE = "Europe/Berlin";

async function startApiAtNow(): Promise<TestApi> {
  const api = await startTestApi({ responseValidation: "throw" });
  api.runtime.world?.clock.setTime(NOW_ISO);
  expect(api.runtime.nowMs()).toBe(Date.parse(NOW_ISO));
  return api;
}

async function ownerIdOf(owner: ReturnType<TestApi["client"]>): Promise<string> {
  return (await owner.get("/api/v1/auth/session")).json().data.user.id as string;
}

function seedEvent(api: TestApi, ownerId: string, title: string, start: string, hours = 1): CalendarEvent {
  return new LocalCalendarService(api.runtime.db).create({
    title, start, end: new Date(Date.parse(start) + hours * 3_600_000).toISOString(), timeZone: ZONE }, ownerId);
}

async function listEvents(owner: ReturnType<TestApi["client"]>, q: string): Promise<Array<{ id: string; title: string; start: string; version: number }>> {
  const list = await owner.get("/api/v1/calendar/events", { query: { from: "2026-01-01T00:00:00Z", to: "2027-12-31T00:00:00Z", q } });
  expect(list.statusCode, list.body).toBe(200);
  return list.json().items;
}

async function disableTier2(owner: ReturnType<TestApi["client"]>): Promise<void> {
  const settings = (await owner.get("/api/v1/settings")).json().data;
  expect((await owner.patch("/api/v1/settings", { approvals: { ...settings.approvals, confirmTier2: false } },
    { headers: { "if-match": String(settings.version) } })).statusCode).toBe(200);
}

async function approveNative(owner: ReturnType<TestApi["client"]>, approvalId: string) {
  const opened = await owner.get(`/api/v1/approvals/${approvalId}`);
  expect(opened.statusCode, opened.body).toBe(200);
  const decision = await owner.post(`/api/v1/approvals/${approvalId}/approve`, {},
    { headers: { "x-approval-token": String(opened.headers["x-approval-token"]) } });
  expect(decision.statusCode, decision.body).toBe(200);
  return decision.json().data;
}

it("takes a spoken create through preview and native approval exactly once", async () => {
  const api = await startApiAtNow();
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    const text = "Trage Quartalsplanung morgen 14 Uhr ein";
    const preview = await owner.post("/api/v1/commands", { text, source: "text" });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().status).toBe("requires_confirmation");
    expect(preview.json().previewText).toContain("eintragen");
    expect(preview.json().previewText).toContain("20. Oktober 2026");
    const previewId = preview.json().previewId as string;
    const changed = await owner.post("/api/v1/commands",
      { text: "Trage Quartalsplanung morgen 15 Uhr ein", source: "text", confirm: true, previewId });
    expect(changed.statusCode).toBe(409);
    const confirmed = await owner.post("/api/v1/commands", { text, source: "text", confirm: true, previewId });
    expect(confirmed.json().status).toBe("requires_approval");
    const approvalId = confirmed.json().approvalId as string;
    const opened = await owner.get(`/api/v1/approvals/${approvalId}`);
    expect(opened.json().data.action).toBe("Termin eintragen: Quartalsplanung");
    const decided = await approveNative(owner, approvalId);
    expect(decided.status).toBe("executed");
    expect(decided.executionResult).toMatch(/^Termin cal_[0-9A-Za-z]{26} eingetragen\.$/);
    const events = await listEvents(owner, "Quartalsplanung");
    expect(events).toHaveLength(1);
    expect(events[0]!.start).toBe("2026-10-20T12:00:00.000Z");
    const reopened = await owner.get(`/api/v1/approvals/${approvalId}`);
    expect((await owner.post(`/api/v1/approvals/${approvalId}/approve`, {},
      { headers: { "x-approval-token": String(reopened.headers["x-approval-token"] ?? "") } })).statusCode).toBe(409);
  } finally { await api.close(); }
});

it("executes a spoken move by title once when tier-2 approval is disabled, keeping the duration", async () => {
  const api = await startApiAtNow();
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    const ownerId = await ownerIdOf(owner);
    await disableTier2(owner);
    const event = seedEvent(api, ownerId, "Sprintreview", "2026-11-02T09:00:00.000Z", 2);
    const text = "Verschieb den Termin Sprintreview auf Freitag 10 Uhr";
    const preview = await owner.post("/api/v1/commands", { text, source: "text" });
    expect(preview.json().previewText).toContain("verschieben");
    expect(preview.json().previewText).toContain("23. Oktober 2026");
    const previewId = preview.json().previewId as string;
    const confirmed = await owner.post("/api/v1/commands", { text, source: "text", confirm: true, previewId });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json().status).toBe("executed");
    expect(confirmed.json().result.message).toBe("Termin wurde verschoben.");
    const moved = (await owner.get(`/api/v1/calendar/events/${event.id}`)).json().data;
    expect(moved.start).toBe("2026-10-23T08:00:00.000Z");
    expect(Date.parse(moved.end) - Date.parse(moved.start)).toBe(2 * 3_600_000);
    expect(moved.version).toBe(2);
    // A repeated confirmation re-resolves the reference and no longer matches the stored draft: no silent second write.
    const repeated = await owner.post("/api/v1/commands", { text, source: "text", confirm: true, previewId });
    expect(repeated.statusCode).toBe(409);
  } finally { await api.close(); }
});

it("deletes the single selected event after confirmation and never revives a dismissed draft", async () => {
  const api = await startApiAtNow();
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    const ownerId = await ownerIdOf(owner);
    const event = seedEvent(api, ownerId, "Daily Abgleich", "2026-10-20T07:00:00.000Z");
    const none = await owner.post("/api/v1/commands", { text: "Lösche den Termin", source: "text" });
    expect(none.statusCode).toBe(422);
    const text = "Lösche den Termin";
    const context = { route: "/calendar", selectedIds: [event.id] };
    const preview = await owner.post("/api/v1/commands", { text, source: "text", context });
    expect(preview.json().previewText).toContain("loeschen");
    const previewId = preview.json().previewId as string;
    const dismissed = await owner.post("/api/v1/commands", { text, source: "text", context, previewId, confirm: false });
    expect(dismissed.json().status).toBe("rejected");
    expect((await owner.post("/api/v1/commands", { text, source: "text", context, previewId, confirm: true })).statusCode).toBe(409);
    expect((await owner.get(`/api/v1/calendar/events/${event.id}`)).statusCode).toBe(200);
    const again = await owner.post("/api/v1/commands", { text, source: "text", context });
    const done = await owner.post("/api/v1/commands",
      { text, source: "text", context, previewId: again.json().previewId, confirm: true });
    expect(done.json().status).toBe("requires_approval");
    const decided = await approveNative(owner, done.json().approvalId as string);
    expect(decided.executionResult).toMatch(/^Termin cal_[0-9A-Za-z]{26} geloescht\.$/);
    expect((await owner.get(`/api/v1/calendar/events/${event.id}`)).statusCode).toBe(404);
  } finally { await api.close(); }
});

it("fails unknown or ambiguous references before any preview is staged", async () => {
  const api = await startApiAtNow();
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    const ownerId = await ownerIdOf(owner);
    seedEvent(api, ownerId, "Doppeltermin", "2026-10-21T08:00:00.000Z");
    seedEvent(api, ownerId, "Doppeltermin", "2026-10-22T08:00:00.000Z");
    const unknown = await owner.post("/api/v1/commands", { text: "Lösche den Termin Gibtesnicht", source: "text" });
    expect(unknown.statusCode, unknown.body).toBe(404);
    const ambiguous = await owner.post("/api/v1/commands", { text: "Verschieb den Termin Doppeltermin auf morgen 9 Uhr", source: "text" });
    expect(ambiguous.statusCode, ambiguous.body).toBe(409);
    expect(ambiguous.json().error.message).toContain("Mehrere Termine");
    expect(ambiguous.json().error.details).toMatchObject({ clarificationRequired: true });
    const stagedRows = api.runtime.db.prepare("SELECT COUNT(*) AS count FROM native_approval_requests").get() as { count: number };
    expect(stagedRows.count).toBe(0);
  } finally { await api.close(); }
});

it("resolves a duplicate calendar reference in a session-bound turn, then requires confirmation", async () => {
  const api = await startApiAtNow();
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    await disableTier2(owner);
    const ownerId = await ownerIdOf(owner);
    seedEvent(api, ownerId, "Doppeltermin", "2026-10-21T08:00:00.000Z");
    const chosen = seedEvent(api, ownerId, "Doppeltermin", "2026-10-22T08:00:00.000Z");
    const text = "Verschieb den Termin Doppeltermin auf morgen 9 Uhr";
    const ambiguous = await owner.post("/api/v1/commands", { text, source: "text" });
    expect(ambiguous.statusCode).toBe(409);
    expect(ambiguous.json().error.details).toMatchObject({ clarificationRequired: true, optionCount: 2 });
    expect(ambiguous.json().error.message).toContain("22. Oktober 2026");
    expect((await owner.get(`/api/v1/calendar/events/${chosen.id}`)).json().data.version).toBe(1);

    const otherSession = api.client();
    await otherSession.loginDev("owner");
    const crossSession = await otherSession.post("/api/v1/commands", { text: "use the second one", source: "text" });
    expect(crossSession.json().status).not.toBe("requires_confirmation");
    expect((await owner.get(`/api/v1/calendar/events/${chosen.id}`)).json().data.version).toBe(1);

    const clarification = await owner.post("/api/v1/commands", { text: "use the second one", source: "text" });
    expect(clarification.statusCode, clarification.body).toBe(200);
    expect(clarification.json()).toMatchObject({ status: "requires_confirmation", requiresConfirmation: true });
    expect(clarification.json().previewText).toContain("Doppeltermin");
    expect((await owner.get(`/api/v1/calendar/events/${chosen.id}`)).json().data.version).toBe(1);
    const crossSessionConfirm = await otherSession.post("/api/v1/commands", {
      text, source: "text", confirm: true, previewId: clarification.json().previewId,
    });
    expect(crossSessionConfirm.statusCode).toBe(409);
    expect((await owner.get(`/api/v1/calendar/events/${chosen.id}`)).json().data.version).toBe(1);

    const corrected = "Verschieb den Termin Doppeltermin auf morgen 10 Uhr";
    const rejectedCorrection = await owner.post("/api/v1/commands", { text: corrected, source: "text", confirm: true, previewId: clarification.json().previewId });
    expect(rejectedCorrection.statusCode).toBe(409);
    const confirmed = await owner.post("/api/v1/commands", { text, source: "text", confirm: true, previewId: clarification.json().previewId });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json().status).toBe("executed");
    expect((await owner.get(`/api/v1/calendar/events/${chosen.id}`)).json().data.version).toBe(2);
    expect((await owner.get(`/api/v1/calendar/events/${chosen.id}`)).json().data.start).toBe("2026-10-20T07:00:00.000Z");
  } finally { await api.close(); }
});

it("rejects a calendar clarification if candidate revisions changed before selection", async () => {
  const api = await startApiAtNow();
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    const ownerId = await ownerIdOf(owner);
    const first = seedEvent(api, ownerId, "Doppeltermin alt", "2026-10-21T08:00:00.000Z");
    const second = seedEvent(api, ownerId, "Doppeltermin alt", "2026-10-22T08:00:00.000Z");
    const ambiguous = await owner.post("/api/v1/commands", { text: "Verschieb den Termin Doppeltermin alt auf morgen 9 Uhr", source: "text" });
    expect(ambiguous.statusCode).toBe(409);
    new LocalCalendarService(api.runtime.db).update(second.id,
      { title: second.title, start: second.start, end: second.end, timeZone: second.timeZone }, ownerId, second.version);
    const clarification = await owner.post("/api/v1/commands", { text: "second", source: "text" });
    expect(clarification.statusCode).toBe(409);
    expect(clarification.json().error.message).toContain("geaendert");
    const staged = api.runtime.db.prepare("SELECT COUNT(*) AS count FROM native_approval_requests").get() as { count: number };
    expect(staged.count).toBe(0);
    expect(new LocalCalendarService(api.runtime.db).get(first.id).version).toBe(1);
  } finally { await api.close(); }
});

it("gates direct calendar POST through the same saved preview and native approval", async () => {
  const api = await startApiAtNow();
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    const body = { title: "Direkter API-Termin", start: "2026-11-05T10:00:00.000Z", end: "2026-11-05T11:00:00.000Z", timeZone: ZONE };
    const invalid = await owner.post("/api/v1/calendar/local/events", { ...body, end: "2026-11-05T09:00:00.000Z" });
    expect(invalid.statusCode).toBe(422);
    const staged = await owner.post("/api/v1/calendar/local/events", body);
    expect(staged.statusCode, staged.body).toBe(403);
    expect(staged.json().error.code).toBe("APPROVAL_REQUIRED");
    expect(staged.json().error.details.stage).toBe("preview");
    expect(staged.json().error.details.previewText).toContain("Direkter API-Termin");
    const previewId = staged.json().error.details.previewId as string;
    expect(await listEvents(owner, "Direkter API-Termin")).toHaveLength(0);
    const changed = await owner.post("/api/v1/calendar/local/events", { ...body, title: "Ausgetauscht" },
      { headers: { "x-action-preview-id": previewId } });
    expect(changed.statusCode).toBe(409);
    const confirmed = await owner.post("/api/v1/calendar/local/events", body, { headers: { "x-action-preview-id": previewId } });
    expect(confirmed.statusCode, confirmed.body).toBe(403);
    expect(confirmed.json().error.details.stage).toBe("approval");
    const decided = await approveNative(owner, confirmed.json().error.details.approvalId as string);
    expect(decided.status).toBe("executed");
    expect(decided.executionResult).toMatch(/^Termin cal_[0-9A-Za-z]{26} eingetragen\.$/);
    expect(await listEvents(owner, "Direkter API-Termin")).toHaveLength(1);
    expect((await owner.post("/api/v1/calendar/local/events", body, { headers: { "x-action-preview-id": previewId } })).statusCode).toBe(409);
  } finally { await api.close(); }
});

it("gates update and delete with If-Match through staging and replays the direct receipt", async () => {
  const api = await startApiAtNow();
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    const ownerId = await ownerIdOf(owner);
    await disableTier2(owner);
    const event = seedEvent(api, ownerId, "Wochenplanung", "2026-10-22T09:00:00.000Z");
    const updateBody = { title: "Wochenplanung", start: "2026-10-23T09:00:00.000Z", end: "2026-10-23T10:00:00.000Z", timeZone: ZONE };
    // Guards before staging: unknown id, missing If-Match, stale If-Match.
    expect((await owner.request("PUT", `/api/v1/calendar/local/events/cal_${"Z".repeat(26)}`,
      { body: updateBody, headers: { "If-Match": "1" } })).statusCode).toBe(404);
    expect((await owner.request("PUT", `/api/v1/calendar/local/events/${event.id}`, { body: updateBody })).statusCode).toBe(422);
    expect((await owner.request("PUT", `/api/v1/calendar/local/events/${event.id}`,
      { body: updateBody, headers: { "If-Match": "99" } })).statusCode).toBe(409);
    const stagedRows = api.runtime.db.prepare("SELECT COUNT(*) AS count FROM native_approval_requests").get() as { count: number };
    expect(stagedRows.count).toBe(0);

    const staged = await owner.request("PUT", `/api/v1/calendar/local/events/${event.id}`,
      { body: updateBody, headers: { "If-Match": "1" } });
    expect(staged.statusCode, staged.body).toBe(403);
    const previewId = staged.json().error.details.previewId as string;
    const changed = await owner.request("PUT", `/api/v1/calendar/local/events/${event.id}`,
      { body: { ...updateBody, title: "Manipuliert" }, headers: { "If-Match": "1", "x-action-preview-id": previewId } });
    expect(changed.statusCode).toBe(409);
    const confirmed = await owner.request("PUT", `/api/v1/calendar/local/events/${event.id}`,
      { body: updateBody, headers: { "If-Match": "1", "x-action-preview-id": previewId } });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json().data.version).toBe(2);
    expect(confirmed.json().data.start).toBe("2026-10-23T09:00:00.000Z");
    const replay = await owner.request("PUT", `/api/v1/calendar/local/events/${event.id}`,
      { body: updateBody, headers: { "If-Match": "1", "x-action-preview-id": previewId } });
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json().data.version).toBe(2);

    expect((await owner.request("DELETE", `/api/v1/calendar/local/events/${event.id}`)).statusCode).toBe(422);
    const stagedDelete = await owner.request("DELETE", `/api/v1/calendar/local/events/${event.id}`, { headers: { "If-Match": "2" } });
    expect(stagedDelete.statusCode, stagedDelete.body).toBe(403);
    const deletePreviewId = stagedDelete.json().error.details.previewId as string;
    expect(stagedDelete.json().error.details.previewText).toContain("loeschen");
    const deleted = await owner.request("DELETE", `/api/v1/calendar/local/events/${event.id}`,
      { headers: { "If-Match": "2", "x-action-preview-id": deletePreviewId } });
    expect(deleted.statusCode, deleted.body).toBe(200);
    expect(deleted.json().data.title).toBe("Wochenplanung");
    expect((await owner.get(`/api/v1/calendar/events/${event.id}`)).statusCode).toBe(404);
    // The replayed delete confirmation still answers with the snapshot stored in the draft.
    const replayedDelete = await owner.request("DELETE", `/api/v1/calendar/local/events/${event.id}`,
      { headers: { "If-Match": "2", "x-action-preview-id": deletePreviewId } });
    expect(replayedDelete.statusCode, replayedDelete.body).toBe(200);
    expect(replayedDelete.json().data.id).toBe(event.id);
  } finally { await api.close(); }
});

it("uses one intent key across calendar staging and confirmation without caching the preview error", async () => {
  const api = await startApiAtNow();
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    await disableTier2(owner);
    const body = { title: "Gleicher Kalender-Intent", start: "2026-11-06T10:00:00.000Z", end: "2026-11-06T11:00:00.000Z", timeZone: ZONE };
    const key = "native-calendar-preview-direct-001";
    const staged = await owner.post("/api/v1/calendar/local/events", body, { headers: { "idempotency-key": key } });
    expect(staged.statusCode).toBe(403);
    const previewId = staged.json().error.details.previewId as string;
    const headers = { "idempotency-key": key, "x-action-preview-id": previewId };
    const confirmed = await owner.post("/api/v1/calendar/local/events", body, { headers });
    expect(confirmed.statusCode, confirmed.body).toBe(201);
    expect(confirmed.json().data.id).toMatch(/^cal_[0-9A-Za-z]{26}$/);
    const repeated = await owner.post("/api/v1/calendar/local/events", body, { headers });
    expect(repeated.statusCode, repeated.body).toBe(201);
    expect(repeated.json().data.id).toBe(confirmed.json().data.id);
    expect((await owner.post("/api/v1/calendar/local/events", { ...body, title: "Anderer Inhalt" },
      { headers: { "idempotency-key": key } })).statusCode).toBe(409);
    expect(await listEvents(owner, "Kalender-Intent")).toHaveLength(1);
  } finally { await api.close(); }
});

it("records uncertain for a calendar.update when the write fails after the decision, without resending", async () => {
  const api = await startApiAtNow();
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    const ownerId = await ownerIdOf(owner);
    const action = { kind: "calendar.update" as const, id: `cal_${"D".repeat(26)}`, version: 1,
      body: { title: "Synthetisch", start: "2026-11-02T10:00:00.000Z", end: "2026-11-02T11:00:00.000Z", timeZone: ZONE } };
    const captured = api.runtime.nativeApprovals.propose({ ownerId, requestKey: "request-cal-uncertain-001",
      correlationId: `corr_${"C".repeat(26)}`, riskTier: 2, type: "system_change", action: "Termin aktualisieren",
      rationale: "Test", preview: { kind: "text", title: "Termin", body: "synthetisch" }, impacts: [], execution: action });
    const approvalId = captured.approval!.id;
    api.runtime.nativeApprovals.confirm(ownerId, "request-cal-uncertain-001", action);
    const actor = { type: "user" as const, id: ownerId, name: "Owner" };
    let effects = 0;
    const dispatch = async () => { effects += 1; throw new Error("response lost after update"); };
    await expect(api.runtime.nativeApprovals.approve(ownerId, approvalId, actor, dispatch)).rejects.toThrow("response lost");
    expect(api.runtime.nativeApprovals.getApproval(ownerId, approvalId)).toMatchObject({ status: "approved",
      executionResult: expect.stringContaining("Termin") });
    expect(api.runtime.nativeApprovals.getApproval(ownerId, approvalId)).toMatchObject({
      executionResult: expect.stringContaining("unklar") });
    expect((api.runtime.db.prepare("SELECT state FROM native_approval_requests WHERE owner_id = ? AND request_key = ?")
      .get(ownerId, "request-cal-uncertain-001") as { state: string }).state).toBe("uncertain");
    await expect(api.runtime.nativeApprovals.approve(ownerId, approvalId, actor, dispatch)).rejects.toThrow();
    expect(effects).toBe(1);
  } finally { await api.close(); }
});

it("clears staged calendar drafts with the dev scenario reset", async () => {
  const api = await startApiAtNow();
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    const staged = await owner.post("/api/v1/calendar/local/events",
      { title: "Reset-Kandidat", start: "2026-11-06T10:00:00.000Z", end: "2026-11-06T11:00:00.000Z", timeZone: ZONE });
    expect(staged.statusCode).toBe(403);
    expect((api.runtime.db.prepare("SELECT COUNT(*) AS count FROM native_approval_requests").get() as { count: number }).count).toBe(1);
    await owner.post("/api/v1/dev/scenarios/control", { action: "reset" });
    expect((api.runtime.db.prepare("SELECT COUNT(*) AS count FROM native_approval_requests").get() as { count: number }).count).toBe(0);
    expect((await owner.post("/api/v1/calendar/local/events",
      { title: "Reset-Kandidat", start: "2026-11-06T10:00:00.000Z", end: "2026-11-06T11:00:00.000Z", timeZone: ZONE },
      { headers: { "x-action-preview-id": staged.json().error.details.previewId } })).statusCode).toBe(409);
  } finally { await api.close(); }
});

it("refuses spoken calendar writes to an operator exactly like the calendar route", async () => {
  const api = await startApiAtNow();
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    const operator = api.client();
    await operator.loginDev("operator");
    const body = { title: "Nur Owner", start: "2026-10-20T12:00:00.000Z", end: "2026-10-20T13:00:00.000Z", timeZone: ZONE };
    expect((await operator.post("/api/v1/calendar/local/events", body)).statusCode).toBe(403);
    const create = await operator.post("/api/v1/commands", { text: "Trage Nur Owner morgen 14 Uhr ein", source: "voice" });
    expect(create.statusCode, create.body).toBe(403);
    expect(create.json().error.code).toBe("FORBIDDEN");
    const seeded = seedEvent(api, await ownerIdOf(owner), "Bestand", "2026-10-21T08:00:00.000Z");
    const move = await operator.post("/api/v1/commands", { text: "Verschieb den Termin Bestand auf morgen 16 Uhr", source: "voice" });
    expect(move.statusCode, move.body).toBe(403);
    const remove = await operator.post("/api/v1/commands", { text: "Lösche den Termin Bestand", source: "voice" });
    expect(remove.statusCode, remove.body).toBe(403);
    expect((await listEvents(owner, "Nur Owner"))).toHaveLength(0);
    expect((await listEvents(owner, "Bestand"))[0]!.version).toBe(seeded.version);
    expect((await owner.get("/api/v1/approvals", { query: { status: "pending" } })).json().items
      .filter((item: { action: string }) => item.action.startsWith("Termin"))).toHaveLength(0);
  } finally { await api.close(); }
});
