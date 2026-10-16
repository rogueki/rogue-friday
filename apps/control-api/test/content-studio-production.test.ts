import { writeFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ContentStudioProductionService } from "../src/services/content-studio-production";
import { startTestApi, type TestApi } from "./helpers";

const ROUTE = "/api/v1/content-studio/production-jobs";
const fakePng = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const fakeMp4 = Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);
const idea = { id: "planned-feed", titel: "Freitag", plattform: "Instagram", format: "Feed-Post", beschreibung: "Ein kurzer Beitrag über Freitag.", zieldatum: "", status: "idee" };
const story = { ...idea, id: "planned-story", format: "Story", beschreibung: "Ein kurzes Hochformatvideo." };
const timeoutIdea = { ...idea, id: "planned-timeout", titel: "Timeout Test", beschreibung: "Timeout bei Anbieterbestätigung." };

describe("automatic Content Studio production", () => {
  let api: TestApi;
  const calls: string[] = [];
  const kieBodies: Array<{ model: string; input: { aspect_ratio: string } }> = [];

  beforeAll(async () => {
    api = await startTestApi({ env: { KIE_API_KEY: "private-kie", ELEVENLABS_API_KEY: "private-eleven" }, providerFetch: async (input, init) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/v2/voices")) return Response.json({ voices: [{ voice_id: "auto_female_de" }] });
      if (url.includes("createTask")) {
        const body = JSON.parse(String(init?.body)) as { model: string; input: { aspect_ratio: string } };
        kieBodies.push(body);
        if (String(init?.body).includes("Timeout Test")) throw new Error("unknown network outcome");
        return Response.json({ code: 200, data: { taskId: body.input.aspect_ratio === "9:16" ? "production-story" : "production-task-1" } });
      }
      if (url.includes("recordInfo")) return Response.json({ code: 200, data: { state: "success", resultJson: JSON.stringify({ resultUrls: [`https://tempfile.aiquickdraw.com/test.${url.includes("production-story") ? "mp4" : "png"}`] }) } });
      if (url.includes("download-url")) return Response.json({ code: 200, data: String(init?.body).includes(".mp4") ? "https://tempfile.aiquickdraw.com/download.mp4" : "https://tempfile.aiquickdraw.com/download.png" });
      return new Response(Buffer.from("ID3mock-voice"), { headers: { "content-type": "audio/mpeg" } });
    } });
    const replacement = new ContentStudioProductionService(api.runtime.db, api.runtime.contentStudioPlan, api.runtime.contentStudioKeys,
      api.runtime.contentStudioProviders, api.config.paths.dataDir, {
        ffmpegAvailable: () => true,
        download: async (url) => url.endsWith(".mp4") ? fakeMp4 : fakePng,
        render: async ({ outputPath }) => { await writeFile(outputPath, Buffer.from("mock-mp4")); },
      });
    api.runtime.contentStudioProduction = replacement;
    const owner = api.client();
    await owner.loginDev("owner");
    const settings = (await owner.get("/api/v1/settings")).json().data;
    expect((await owner.patch("/api/v1/settings", { dashboard: { ...settings.dashboard, contentStudioEnabled: true } }, { headers: { "if-match": String(settings.version) } })).statusCode).toBe(200);
    const plan = { version: 1, content: [idea, story, timeoutIdea], postings: [] };
    expect((await owner.request("PUT", "/api/v1/content-studio/plan", { body: plan, headers: { "if-match": "0" } })).statusCode).toBe(200);
  });
  afterAll(async () => { await api.close(); });

  it("requires a planned idea, approval, owner session, CSRF and one idempotency key", async () => {
    const anonymous = api.client();
    expect((await anonymous.post(ROUTE, { ideaId: idea.id, planRevision: 1, voiceId: "voice1", confirmed: true }, { headers: { "idempotency-key": "production-anon" } })).statusCode).toBe(401);
    const viewer = api.client();
    await viewer.loginDev("viewer");
    expect((await viewer.post(ROUTE, { ideaId: idea.id, planRevision: 1, voiceId: "voice1", confirmed: true }, { headers: { "idempotency-key": "production-viewer" } })).statusCode).toBe(403);
    const owner = api.client();
    await owner.loginDev("owner");
    expect((await owner.post(ROUTE, { ideaId: "missing", planRevision: 1, voiceId: "voice1", confirmed: true }, { headers: { "idempotency-key": "production-missing" } })).statusCode).toBe(404);
    expect((await owner.post(ROUTE, { ideaId: idea.id, planRevision: 1, voiceId: "voice1", confirmed: false }, { headers: { "idempotency-key": "production-noapproval" } })).statusCode).toBe(422);
    expect((await owner.post(ROUTE, { ideaId: idea.id, planRevision: 1, voiceId: "voice1", confirmed: true }, { csrf: false, headers: { "idempotency-key": "production-nocsrf" } })).statusCode).toBe(403);
    expect((await owner.post(ROUTE, { ideaId: idea.id, planRevision: 99, voiceId: "voice1", confirmed: true }, { headers: { "idempotency-key": "production-stale" } })).statusCode).toBe(409);
    expect(calls).toHaveLength(0);
  });

  it("runs one durable job through Kie, ElevenLabs, render and authorized artifact download", async () => {
    const owner = api.client();
    await owner.loginDev("owner");
    const request = { ideaId: idea.id, planRevision: 1, voiceId: "voice1", confirmed: true as const };
    const first = await owner.post(ROUTE, request, { headers: { "idempotency-key": "production-happy-1" } });
    expect(first.statusCode, first.body).toBe(202);
    const id = first.json().data.id as string;
    expect(first.json().data.state).toBe("queued");
    const repeat = await owner.post(ROUTE, request, { headers: { "idempotency-key": "production-happy-1" } });
    expect(repeat.json().data.id).toBe(id);
    const saved = api.runtime.db.prepare("SELECT request_key FROM content_studio_jobs WHERE id = ?").get(id) as { request_key: string };
    expect(() => api.runtime.contentStudioProduction.create({ ...request, ideaId: story.id }, saved.request_key)).toThrow(/Idempotency-Key/);
    await api.runtime.contentStudioProduction.processPending();
    expect((await owner.get(`${ROUTE}/${id}`)).json().data).toMatchObject({ state: "completed", artifactReady: true, providerTaskId: "production-task-1" });
    const artifact = await owner.get(`${ROUTE}/${id}/artifact`);
    expect(artifact.statusCode).toBe(200);
    expect(artifact.headers["content-type"]).toContain("video/mp4");
    expect(artifact.rawPayload.toString()).toBe("mock-mp4");
    expect((await api.client().get(`${ROUTE}/${id}/artifact`)).statusCode).toBe(401);
    expect(calls.filter((url) => url.includes("createTask"))).toHaveLength(1);
    expect(calls.filter((url) => url.includes("text-to-speech"))).toHaveLength(1);
  });

  it("chooses an available female voice from the provider before paid generation when only keys are configured", async () => {
    const owner = api.client();
    await owner.loginDev("owner");
    const created = await owner.post(ROUTE, { ideaId: idea.id, planRevision: 1, confirmed: true },
      { headers: { "idempotency-key": "production-autovoice-1" } });
    expect(created.statusCode).toBe(202);
    await api.runtime.contentStudioProduction.processPending();
    expect((await owner.get(`${ROUTE}/${created.json().data.id}`)).json().data.state).toBe("completed");
    expect(calls.some((url) => url.includes("/v2/voices?language=de&gender=female"))).toBe(true);
  });

  it("uses a verified vertical provider profile for an automatic Story", async () => {
    const owner = api.client();
    await owner.loginDev("owner");
    const created = await owner.post(ROUTE, { ideaId: story.id, planRevision: 1, confirmed: true },
      { headers: { "idempotency-key": "production-story-1" } });
    expect(created.statusCode).toBe(202);
    await api.runtime.contentStudioProduction.processPending();
    expect((await owner.get(`${ROUTE}/${created.json().data.id}`)).json().data.state).toBe("completed");
    expect(kieBodies.some((body) => body.model === "kling-3.0/video" && body.input.aspect_ratio === "9:16")).toBe(true);
  });

  it("does not repeat a paid submission after an unknown network outcome", async () => {
    const owner = api.client();
    await owner.loginDev("owner");
    const created = await owner.post(ROUTE, { ideaId: timeoutIdea.id, planRevision: 1, confirmed: true },
      { headers: { "idempotency-key": "production-timeout-1" } });
    expect(created.statusCode).toBe(202);
    const id = created.json().data.id as string;
    await api.runtime.contentStudioProduction.processPending();
    expect((await owner.get(`${ROUTE}/${id}`)).json().data.state).toBe("provider_unknown");
    const submissions = calls.filter((url) => url.includes("createTask")).length;
    await api.runtime.contentStudioProduction.processPending();
    expect(calls.filter((url) => url.includes("createTask"))).toHaveLength(submissions);
    expect((await owner.post(ROUTE, { ideaId: timeoutIdea.id, planRevision: 1, confirmed: true },
      { headers: { "idempotency-key": "production-timeout-1" } })).json().data.id).toBe(id);
  });

  it("cancels a queued job before any paid provider request", async () => {
    const owner = api.client();
    await owner.loginDev("owner");
    const created = await owner.post(ROUTE, { ideaId: idea.id, planRevision: 1, confirmed: true },
      { headers: { "idempotency-key": "production-cancel-1" } });
    const id = created.json().data.id as string;
    const before = calls.length;
    expect((await owner.post(`${ROUTE}/${id}/cancel`)).json().data.state).toBe("cancelled");
    await api.runtime.contentStudioProduction.processPending();
    expect(calls).toHaveLength(before);
    expect((await owner.get(`${ROUTE}/${id}`)).json().data.state).toBe("cancelled");
  });
});
