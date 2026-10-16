import { expect, it } from "vitest";
import { startTestApi } from "./helpers";

it("binds local voice CRUD to preview, owner, exact revision and one idempotent confirmation", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const key = api.runtime.voiceBridgeKey.toString("base64");
    const voice = api.client();
    const owner = api.client();
    await owner.loginDev("owner");
    const previewPath = "/api/v1/calendar/local/voice/preview";
    const confirmPath = "/api/v1/calendar/local/voice/confirm";
    const headers = { authorization: `Bearer ${key}` };
    const request = { action: "create", title: "Friseur", start: "2026-11-02T10:00:00Z", end: "2026-11-02T11:00:00Z", timeZone: "Europe/Berlin" };
    expect((await owner.post(previewPath, request)).statusCode).toBe(403);
    expect((await voice.post(previewPath, request)).statusCode).toBe(401);
    expect((await voice.post("/api/v1/calendar/local/events", request, { headers })).statusCode).toBe(401);
    const preview = await voice.post(previewPath, request, { headers });
    expect(preview.statusCode, preview.body).toBe(200);
    const data = preview.json().data;
    expect(data.event.title).toBe("Friseur");
    const body = { request, token: data.token, targetId: data.targetId, version: data.version };
    expect((await voice.post(confirmPath, { ...body, request: { ...request, title: "Fremd" } }, { headers: { ...headers, "Idempotency-Key": "voice-cal-tamper-123" } })).statusCode).toBe(409);
    const create = await voice.post(confirmPath, body, { headers: { ...headers, "Idempotency-Key": "voice-cal-create-123" } });
    expect(create.statusCode, create.body).toBe(201);
    const id = create.json().data.id;
    const replay = await voice.post(confirmPath, body, { headers: { ...headers, "Idempotency-Key": "voice-cal-create-123" } });
    expect(replay.statusCode).toBe(201);
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    expect((await voice.post(confirmPath, body, { headers: { ...headers, "Idempotency-Key": "voice-cal-create-456" } })).statusCode).toBe(409);
    expect(api.runtime.db.prepare("SELECT COUNT(*) AS count FROM local_calendar_events").get()).toMatchObject({ count: 1 });

    const move = { action: "update", targetTitle: "Friseur", start: "2026-11-03T10:00:00Z", timeZone: "Europe/Berlin" };
    const movePreview = (await voice.post(previewPath, move, { headers })).json().data;
    expect(movePreview.event.end).toBe("2026-11-03T11:00:00.000Z");
    const moved = await voice.post(confirmPath, { request: move, token: movePreview.token, targetId: movePreview.targetId, version: movePreview.version }, { headers: { ...headers, "Idempotency-Key": "voice-cal-move-123" } });
    expect(moved.statusCode, moved.body).toBe(200);
    expect(moved.json().data.version).toBe(2);
    const deletion = { action: "delete", targetTitle: "Friseur" };
    const deletePreview = (await voice.post(previewPath, deletion, { headers })).json().data;
    expect(deletePreview.targetId).toBe(id);
    expect((await voice.post(confirmPath, { request: deletion, token: deletePreview.token, targetId: deletePreview.targetId, version: 1 }, { headers: { ...headers, "Idempotency-Key": "voice-cal-stale-123" } })).statusCode).toBe(409);
    const deleted = await voice.post(confirmPath, { request: deletion, token: deletePreview.token, targetId: deletePreview.targetId, version: deletePreview.version }, { headers: { ...headers, "Idempotency-Key": "voice-cal-delete-123" } });
    expect(deleted.statusCode, deleted.body).toBe(200);
    expect(api.runtime.db.prepare("SELECT COUNT(*) AS count FROM local_calendar_events").get()).toMatchObject({ count: 0 });
  } finally { await api.close(); }
});

it("refuses ambiguous local titles and never selects an external event", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const voice = api.client();
    const headers = { authorization: `Bearer ${api.runtime.voiceBridgeKey.toString("base64")}` };
    const base = { title: "Team", start: "2026-11-02T10:00:00Z", end: "2026-11-02T11:00:00Z", timeZone: "Europe/Berlin" };
    const calendar = (await import("../src/services/local-calendar")).LocalCalendarService;
    const ownerId = (await import("../src/security/auth-service")).stableUserId("owner");
    new calendar(api.runtime.db).create(base, ownerId);
    new calendar(api.runtime.db).create({ ...base, start: "2026-11-03T10:00:00Z", end: "2026-11-03T11:00:00Z" }, ownerId);
    expect((await voice.post("/api/v1/calendar/local/voice/preview", { action: "delete", targetTitle: "Team" }, { headers })).statusCode).toBe(409);
    expect((await voice.post("/api/v1/calendar/local/voice/preview", { action: "delete", targetTitle: "Remote" }, { headers })).statusCode).toBe(409);
  } finally { await api.close(); }
});
