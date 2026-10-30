import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalCalendarService } from "../src/services/local-calendar";
import { startTestApi, type ApiClient, type TestApi } from "./helpers";

/**
 * DASH-18.04: after "Zeige meine Termine morgen" the listed events can be named by position or "ihn"; a bare
 * "den zweiten" goes to the calendar, not to tasks. Mock clock 2026-10-14T08:15Z (Europe/Berlin).
 */
const EVENT_ID = /cal_[0-9A-Za-z]{26}/g;
const ORDINAL = ["ersten", "zweiten", "dritten", "vierten", "fünften"];

describe("follow-up references to listed events", () => {
  let api: TestApi;
  let owner: ApiClient;
  let early: { id: string; title: string };
  let later: { id: string; title: string };

  beforeEach(async () => {
    api = await startTestApi();
    owner = api.client();
    await owner.loginDev("owner");
    const settings = (await owner.get("/api/v1/settings")).json().data;
    expect((await owner.patch("/api/v1/settings", { approvals: { ...settings.approvals, confirmTier2: false } },
      { headers: { "if-match": String(settings.version) } })).statusCode).toBe(200);
    const ownerId = (await owner.get("/api/v1/auth/session")).json().data.user.id as string;
    const calendar = new LocalCalendarService(api.runtime.db);
    early = calendar.create({ title: "Frühbesprechung", start: "2026-10-15T04:00:00.000Z", end: "2026-10-15T04:30:00.000Z", timeZone: "Europe/Berlin" }, ownerId);
    later = calendar.create({ title: "Zweiter Frühtermin", start: "2026-10-15T04:30:00.000Z", end: "2026-10-15T05:00:00.000Z", timeZone: "Europe/Berlin" }, ownerId);
  });

  afterEach(async () => {
    await api.close();
  });

  async function listTomorrow(): Promise<string[]> {
    const response = await owner.post("/api/v1/commands", { text: "zeige meine termine morgen", source: "voice" });
    expect(response.statusCode, response.body).toBe(200);
    const ids = [...new Set((response.json().result.message as string).match(EVENT_ID) ?? [])];
    expect(ids).toContain(early.id);
    expect(ids).toContain(later.id);
    return ids;
  }

  it("moves exactly the event named by its position, after preview and confirmation", async () => {
    const ids = await listTomorrow();
    const text = `Verschiebe den ${ORDINAL[ids.indexOf(later.id)]} auf morgen 16 Uhr`;
    const preview = await owner.post("/api/v1/commands", { text, source: "voice" });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json()).toMatchObject({ status: "requires_confirmation", previewText: expect.stringContaining(later.title) });
    const confirmed = await owner.post("/api/v1/commands", { text, source: "voice", confirm: true, previewId: preview.json().previewId });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json().status).toBe("executed");
    expect(new LocalCalendarService(api.runtime.db).get(later.id).start).toBe("2026-10-15T14:00:00.000Z");
    expect(new LocalCalendarService(api.runtime.db).get(early.id).start).toBe("2026-10-15T04:00:00.000Z");
  });

  it("sends a bare ordinal to the calendar after a calendar listing and asks back for a bare pronoun", async () => {
    const ids = await listTomorrow();
    const remove = await owner.post("/api/v1/commands", { text: `Lösche den ${ORDINAL[ids.indexOf(early.id)]}`, source: "voice" });
    expect(remove.statusCode, remove.body).toBe(200);
    expect(remove.json()).toMatchObject({ status: "requires_confirmation", previewText: expect.stringContaining(early.title) });
    const pronoun = await owner.post("/api/v1/commands", { text: "Sag ihn ab", source: "voice" });
    expect(pronoun.statusCode, pronoun.body).toBe(422);
    expect(pronoun.json().error.message).toContain(`Welcher der ${ids.length} genannten Termine`);
  });

  it("refuses a listed event from a connected calendar and forgets the listing after a task read", async () => {
    const ids = await listTomorrow();
    const foreignIndex = ids.findIndex((id) => id !== early.id && id !== later.id && !new LocalCalendarService(api.runtime.db).has(id));
    if (foreignIndex >= 0) {
      const foreign = await owner.post("/api/v1/commands", { text: `Lösche den ${ORDINAL[foreignIndex]}`, source: "voice" });
      expect(foreign.statusCode, foreign.body).toBe(409);
      expect(foreign.json().error.message).toContain("verbundenen Kalender");
    }
    expect((await owner.post("/api/v1/commands", { text: "Zeige meine offenen Aufgaben", source: "voice" })).statusCode).toBe(200);
    const stale = await owner.post("/api/v1/commands", { text: "Sag ihn ab", source: "voice" });
    expect(stale.statusCode, stale.body).toBe(422);
    expect(stale.json().error.message).toContain("zuerst die Termine auflisten");
  });
});