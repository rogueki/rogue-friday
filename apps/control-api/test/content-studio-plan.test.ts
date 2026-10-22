import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApi, type TestApi } from "./helpers";

const ENDPOINT = "/api/v1/content-studio/plan";
const plan = {
  version: 1,
  exportiert_am: "2026-10-16T00:00:00.000Z",
  content: [{ id: "idea-1", titel: "Start", plattform: "Instagram", ziele: ["Instagram", "Facebook"], format: "Story", beschreibung: "", zieldatum: "2026-10-20", status: "idee" }],
  postings: [],
};

describe("Content Studio authoritative plan", () => {
  let api: TestApi;

  beforeAll(async () => { api = await startTestApi(); });
  afterAll(async () => { await api.close(); });

  it("requires owner, feature switch and CSRF", async () => {
    const anonymous = api.client();
    expect((await anonymous.get(ENDPOINT)).statusCode).toBe(401);
    const owner = api.client();
    await owner.loginDev("owner");
    const initial = (await owner.get("/api/v1/settings")).json().data;
    expect((await owner.patch("/api/v1/settings", { dashboard: { ...initial.dashboard, contentStudioEnabled: false } }, { headers: { "if-match": String(initial.version) } })).statusCode).toBe(200);
    expect((await owner.get(ENDPOINT)).statusCode).toBe(403);
    const settings = (await owner.get("/api/v1/settings")).json().data;
    expect((await owner.patch("/api/v1/settings", { dashboard: { ...settings.dashboard, contentStudioEnabled: true } }, { headers: { "if-match": String(settings.version) } })).statusCode).toBe(200);
    const viewer = api.client();
    await viewer.loginDev("viewer");
    expect((await viewer.get(ENDPOINT)).statusCode).toBe(403);
    expect((await viewer.request("PUT", ENDPOINT, { body: plan, headers: { "if-match": "0" } })).statusCode).toBe(403);
    expect((await owner.request("PUT", ENDPOINT, { body: plan, csrf: false, headers: { "if-match": "0" } })).statusCode).toBe(403);
  });

  it("validates the plan and enforces compare-and-swap revisions", async () => {
    const first = api.client();
    await first.loginDev("owner");
    const second = api.client();
    await second.loginDev("owner");
    expect((await first.get(ENDPOINT)).json().data).toMatchObject({ revision: 0, plan: null });
    expect((await first.request("PUT", ENDPOINT, { body: plan })).statusCode).toBe(422);
    expect((await first.request("PUT", ENDPOINT, { body: { ...plan, content: [plan.content[0], plan.content[0]] }, headers: { "if-match": "0" } })).statusCode).toBe(422);
    const legacyPlan = { version: plan.version, content: plan.content, postings: plan.postings };
    const saved = await first.request("PUT", ENDPOINT, { body: legacyPlan, headers: { "if-match": "0" } });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().data).toMatchObject({ revision: 1, plan: { content: [{ id: "idea-1" }] } });
    expect(saved.json().data.plan.exportiert_am).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect((await second.request("PUT", ENDPOINT, { body: { ...plan, content: [] }, headers: { "if-match": "0" } })).statusCode).toBe(409);
    expect((await first.get(ENDPOINT)).json().data.plan.content).toHaveLength(1);
    const updated = await second.request("PUT", ENDPOINT, { body: { ...plan, content: [] }, headers: { "if-match": "1" } });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(updated.json().data.revision).toBe(2);
    expect((await first.get(ENDPOINT)).json().data.plan.content).toHaveLength(0);
    const stored = api.runtime.db.prepare("SELECT revision, json FROM content_studio_plan WHERE id = 1").get() as { revision: number; json: string };
    expect(stored.revision).toBe(2);
    expect(JSON.parse(stored.json).content).toHaveLength(0);
    expect((await first.request("PUT", ENDPOINT, { body: { ...plan, content: [{ ...plan.content[0], beschreibung: "x".repeat(2_000_000) }] }, headers: { "if-match": "2" } })).statusCode).toBe(413);
    expect((await first.get(ENDPOINT)).json().data.revision).toBe(2);
  });
});
