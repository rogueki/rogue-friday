import { expect, it } from "vitest";
import { LocalCalendarService } from "../src/services/local-calendar";
import { startTestApi, type TestApi } from "./helpers";

// KEEP-03 channel switch: a preview is bound to the owner, its unguessable previewId and the exact action, so another
// owner tab may finish it, but a changed action or another role may not. The voice bridge may run research commands
// only, so a spoken "ja" or a replayed previewId never confirms a dashboard preview.
const NOW_ISO = "2026-10-19T08:00:00.000Z";

async function ownerIdOf(owner: ReturnType<TestApi["client"]>): Promise<string> {
  return (await owner.get("/api/v1/auth/session")).json().data.user.id as string;
}

async function disableTier2(owner: ReturnType<TestApi["client"]>): Promise<void> {
  const settings = (await owner.get("/api/v1/settings")).json().data;
  expect((await owner.patch("/api/v1/settings", { approvals: { ...settings.approvals, confirmTier2: false } },
    { headers: { "if-match": String(settings.version) } })).statusCode).toBe(200);
}

it("lets another owner tab finish the identical preview but never the voice bridge, a changed action or another role", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    api.runtime.world?.clock.setTime(NOW_ISO);
    const owner = api.client();
    await owner.loginDev("owner");
    await disableTier2(owner);
    const event = new LocalCalendarService(api.runtime.db).create({
      title: "Kanalprobe", start: "2026-11-02T09:00:00.000Z", end: "2026-11-02T10:00:00.000Z", timeZone: "Europe/Berlin",
    }, await ownerIdOf(owner));
    const text = "Verschieb den Termin Kanalprobe auf Freitag 10 Uhr";
    const preview = await owner.post("/api/v1/commands", { text, source: "text" });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().status).toBe("requires_confirmation");
    const previewId = preview.json().previewId as string;

    const bridge = api.client();
    const headers = { authorization: `Bearer ${api.runtime.voiceBridgeKey.toString("base64")}` };
    const replayed = await bridge.post("/api/v1/commands", { text, source: "voice", confirm: true, previewId }, { headers });
    expect(replayed.statusCode, replayed.body).toBe(403);
    const spokenYes = await bridge.post("/api/v1/commands", { text: "ja", source: "voice" }, { headers });
    expect(spokenYes.statusCode, spokenYes.body).toBe(403);
    expect((await owner.get(`/api/v1/calendar/events/${event.id}`)).json().data.version).toBe(1);

    const viewer = api.client();
    await viewer.loginDev("viewer");
    const viewerConfirm = await viewer.post("/api/v1/commands", { text, source: "text", confirm: true, previewId });
    expect([403, 409]).toContain(viewerConfirm.statusCode);
    expect((await owner.get(`/api/v1/calendar/events/${event.id}`)).json().data.version).toBe(1);

    const otherTab = api.client();
    await otherTab.loginDev("owner");
    const changed = await otherTab.post("/api/v1/commands",
      { text: "Verschieb den Termin Kanalprobe auf Freitag 11 Uhr", source: "text", confirm: true, previewId });
    expect(changed.statusCode, changed.body).toBe(409);
    expect((await owner.get(`/api/v1/calendar/events/${event.id}`)).json().data.version).toBe(1);

    const confirmed = await otherTab.post("/api/v1/commands", { text, source: "text", confirm: true, previewId });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json().status).toBe("executed");
    expect((await owner.get(`/api/v1/calendar/events/${event.id}`)).json().data.version).toBe(2);
    const replay = await owner.post("/api/v1/commands", { text, source: "text", confirm: true, previewId });
    expect(replay.json().status).not.toBe("executed");
    expect((await owner.get(`/api/v1/calendar/events/${event.id}`)).json().data.version).toBe(2);
  } finally {
    await api.close();
  }
});
