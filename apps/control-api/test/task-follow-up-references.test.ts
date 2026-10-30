import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApi, type ApiClient, type TestApi } from "./helpers";

/**
 * DASH-18.04: after "Zeige meine offenen Aufgaben" the listed tasks can be named by position or "sie", and the
 * follow-up runs through the same preview and confirmation as any other task command.
 */
const TASK_ID = /task_[0-9A-Za-z]{26}/g;

describe("follow-up references to listed tasks", () => {
  let api: TestApi;
  let owner: ApiClient;

  beforeEach(async () => {
    api = await startTestApi();
    owner = api.client();
    await owner.loginDev("owner");
    const settings = (await owner.get("/api/v1/settings")).json().data;
    expect((await owner.patch("/api/v1/settings", { approvals: { ...settings.approvals, confirmTier2: false } },
      { headers: { "if-match": String(settings.version) } })).statusCode).toBe(200);
  });

  afterEach(async () => {
    await api.close();
  });

  async function listOpenTasks(): Promise<string[]> {
    const response = await owner.post("/api/v1/commands", { text: "Zeige meine offenen Aufgaben", source: "voice" });
    expect(response.statusCode, response.body).toBe(200);
    const ids = [...new Set((response.json().result.message as string).match(TASK_ID) ?? [])];
    expect(ids.length).toBeGreaterThan(1);
    return ids;
  }

  it("changes exactly the task named by its position, after preview and confirmation", async () => {
    const ids = await listOpenTasks();
    const second = (await owner.get(`/api/v1/tasks/${ids[1]}`)).json().data as { id: string; title: string };
    const text = "Markiere die zweite als erledigt";
    const preview = await owner.post("/api/v1/commands", { text, source: "voice" });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json()).toMatchObject({ status: "requires_confirmation", previewText: expect.stringContaining(second.title) });
    const confirmed = await owner.post("/api/v1/commands",
      { text, source: "voice", confirm: true, previewId: preview.json().previewId });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json()).toMatchObject({ status: "executed", result: { taskId: second.id } });
    expect((await owner.get(`/api/v1/tasks/${second.id}`)).json().data.status).toBe("done");
  });

  it("asks back for a bare pronoun or a position outside the list instead of guessing", async () => {
    const ids = await listOpenTasks();
    const pronoun = await owner.post("/api/v1/commands", { text: "Lösche sie", source: "voice" });
    expect(pronoun.statusCode, pronoun.body).toBe(422);
    expect(pronoun.json().error.message).toContain(`Welche der ${ids.length} genannten Aufgaben`);
    if (ids.length < 5) {
      const outside = await owner.post("/api/v1/commands", { text: "Lösche die fünfte", source: "voice" });
      expect(outside.statusCode, outside.body).toBe(422);
      expect(outside.json().error.message).toContain(`nur ${ids.length} Aufgaben`);
    }
  });

  it("forgets the listing after another read and never shares it with another session", async () => {
    await listOpenTasks();
    const other = api.client();
    await other.loginDev("owner");
    const foreign = await other.post("/api/v1/commands", { text: "Markiere die erste als erledigt", source: "voice" });
    expect(foreign.statusCode, foreign.body).toBe(422);
    expect((await owner.post("/api/v1/commands", { text: "Zeige meine Termine heute", source: "voice" })).statusCode).toBe(200);
    const stale = await owner.post("/api/v1/commands", { text: "Markiere die erste als erledigt", source: "voice" });
    expect(stale.statusCode, stale.body).toBe(422);
    expect(stale.json().error.message).toContain("zuerst die Aufgaben auflisten");
  });
});
