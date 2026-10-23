import { writeFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ContentStudioProductionService } from "../src/services/content-studio-production";
import { startTestApi, type TestApi } from "./helpers";

const BRIDGE = "/api/v1/content-studio/skill-production-jobs";
const idea = { id: "planned-skill", titel: "Skill-Auftrag", plattform: "Instagram", format: "Feed-Post",
  beschreibung: "Ein kurzer Beitrag aus einem Skill heraus.", zieldatum: "2026-10-24", status: "idee" };
const fakePng = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const fakeMp4 = Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);

describe("content studio skill bridge", () => {
  let api: TestApi;
  let revision = 0;

  const startFromSkill = (client: ReturnType<TestApi["client"]>, body: unknown, key: string) =>
    client.post(BRIDGE, body, { headers: { "idempotency-key": key } });

  beforeAll(async () => {
    api = await startTestApi({ env: { KIE_API_KEY: "private-kie", ELEVENLABS_API_KEY: "private-eleven" }, providerFetch: async (input, init) => {
      const url = String(input);
      if (url.includes("/v2/voices")) return Response.json({ voices: [{ voice_id: "auto_female_de" }] });
      if (url.includes("createTask")) return Response.json({ code: 200, data: { taskId: "skill-task-1" } });
      if (url.includes("recordInfo")) return Response.json({ code: 200, data: { state: "success", resultJson: JSON.stringify({ resultUrls: ["https://example.invalid/skill.png"] }) } });
      if (url.includes("download-url")) return Response.json({ code: 200, data: String(init?.body).includes(".mp4") ? "https://example.invalid/skill.mp4" : "https://example.invalid/skill.png" });
      return new Response(Buffer.from("ID3skill"), { headers: { "content-type": "audio/mpeg" } });
    } });
    const replacement = new ContentStudioProductionService(api.runtime.db, api.runtime.contentStudioPlan, api.runtime.contentStudioKeys,
      api.runtime.contentStudioProviders, api.config.paths.dataDir, {
        ffmpegAvailable: () => true,
        download: async (url) => url.endsWith(".mp4") ? fakeMp4 : fakePng,
        render: async ({ outputPath }) => { await writeFile(outputPath, Buffer.from("skill-mp4")); },
      });
    api.runtime.contentStudioProduction = replacement;
    const owner = api.client();
    await owner.loginDev("owner");
    const settings = (await owner.get("/api/v1/settings")).json().data;
    const patched = await owner.patch("/api/v1/settings",
      { dashboard: { ...settings.dashboard, contentStudioEnabled: true } },
      { headers: { "if-match": String(settings.version) } });
    expect(patched.statusCode, `settings: ${patched.body}`).toBe(200);
    const stored = await owner.request("PUT", "/api/v1/content-studio/plan",
      { body: { version: 1, content: [idea], postings: [] }, headers: { "if-match": "0" } });
    expect(stored.statusCode, `plan: ${stored.body}`).toBe(200);
    revision = stored.json().data.revision;
  }, 60_000);

  afterAll(async () => { await api.close(); });

  it("starts one durable job for a skill, keeping the request idempotent", async () => {
    const owner = api.client();
    await owner.loginDev("owner");
    const body = { ideaId: idea.id, planRevision: revision, skillId: "content-studio", confirmed: true };
    const first = await startFromSkill(owner, body, "skill-run-1");
    expect(first.statusCode, `first: ${first.body}`).toBe(202);
    const job = first.json().data;
    expect(job.state).not.toBe("failed");
    const replay = await startFromSkill(owner, body, "skill-run-1");
    expect(replay.statusCode).toBe(202);
    expect(replay.json().data.id).toBe(job.id);
    expect(replay.headers["idempotent-replayed"]).toBe("true");
  }, 60_000);

  it("rejects a stale plan revision with 409 before starting anything", async () => {
    const owner = api.client();
    await owner.loginDev("owner");
    const response = await startFromSkill(owner,
      { ideaId: idea.id, planRevision: revision + 5, skillId: "content-studio", confirmed: true }, "skill-run-stale");
    expect(response.statusCode, `stale: ${response.body}`).toBe(409);
  }, 60_000);

  it("rejects an unknown idea and a malformed skill id", async () => {
    const owner = api.client();
    await owner.loginDev("owner");
    const unknown = await startFromSkill(owner,
      { ideaId: "does-not-exist", planRevision: revision, skillId: "content-studio", confirmed: true }, "skill-run-unknown");
    expect(unknown.statusCode, `unknown: ${unknown.body}`).toBe(404);
    const malformed = await startFromSkill(owner,
      { ideaId: idea.id, planRevision: revision, skillId: "Content Studio!", confirmed: true }, "skill-run-malformed");
    expect(malformed.statusCode, `malformed: ${malformed.body}`).toBe(422);
  }, 60_000);

  it("requires a session and a one-time confirmation", async () => {
    const anonymous = api.client();
    const unauthenticated = await startFromSkill(anonymous,
      { ideaId: idea.id, planRevision: revision, skillId: "content-studio", confirmed: true }, "skill-run-anon");
    expect(unauthenticated.statusCode, `anon: ${unauthenticated.body}`).toBe(401);
    const owner = api.client();
    await owner.loginDev("owner");
    const unconfirmed = await startFromSkill(owner,
      { ideaId: idea.id, planRevision: revision, skillId: "content-studio", confirmed: false }, "skill-run-unconfirmed");
    expect(unconfirmed.statusCode, `unconfirmed: ${unconfirmed.body}`).toBe(422);
  }, 60_000);

  it("records the triggering skill in the durable audit trail", async () => {
    const row = api.runtime.db
      .prepare("SELECT json FROM audit_log WHERE json LIKE '%skill_production_started%' ORDER BY seq DESC LIMIT 1")
      .get() as { json: string } | undefined;
    expect(row, "kein Audit-Eintrag fuer den Skill-Auftrag").toBeDefined();
    const event = JSON.parse(row!.json) as { action: string; after?: { skillId?: string; jobId?: string } };
    expect(event.action).toBe("content_studio.skill_production_started");
    expect(event.after?.skillId).toBe("content-studio");
    expect(event.after?.jobId).toBeTruthy();
  }, 60_000);
});
