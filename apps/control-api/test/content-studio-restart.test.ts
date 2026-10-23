import { mkdtempSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ContentStudioProductionService } from "../src/services/content-studio-production";
import { startTestApi, type TestApi } from "./helpers";

const ROUTE = "/api/v1/content-studio/production-jobs";
const fakePng = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const fakeMp4 = Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);
const idea = { id: "restart-idea", titel: "Restart", plattform: "Instagram", format: "Feed-Post",
  beschreibung: "Bleibt nach einem Neustart erhalten.", zieldatum: "2026-11-02", status: "idee" };

const providerFetch = async (input: RequestInfo | URL): Promise<Response> => {
  const url = String(input);
  if (url.includes("/v2/voices")) return Response.json({ voices: [{ voice_id: "auto_female_de" }] });
  if (url.includes("createTask")) return Response.json({ code: 200, data: { taskId: "restart-task" } });
  if (url.includes("recordInfo"))
    return Response.json({ code: 200, data: { state: "success", resultJson: JSON.stringify({ resultUrls: ["https://tempfile.aiquickdraw.com/restart.png"] }) } });
  if (url.includes("download-url")) return Response.json({ code: 200, data: "https://tempfile.aiquickdraw.com/restart" });
  return new Response(Buffer.from("ID3-voice"), { headers: { "content-type": "audio/mpeg" } });
};

const stubProduction = (api: TestApi): void => {
  api.runtime.contentStudioProduction = new ContentStudioProductionService(api.runtime.db,
    api.runtime.contentStudioPlan, api.runtime.contentStudioKeys, api.runtime.contentStudioProviders,
    api.config.paths.dataDir, {
      ffmpegAvailable: () => true,
      download: async (url) => (url.endsWith(".mp4") ? fakeMp4 : fakePng),
      render: async ({ outputPath }) => { await writeFile(outputPath, Buffer.from("restart-mp4")); },
    });
};

// DASH-14.05: plan and production jobs have to survive a new process, otherwise "durable" is just a word.
describe("Content Studio state across a restart", () => {
  it("keeps the plan, the job and its artifact when the API is started again on the same data root", async () => {
    const dir = mkdtempSync(join(tmpdir(), "friday-studio-restart-"));
    const env = { KIE_API_KEY: "restart-kie", ELEVENLABS_API_KEY: "restart-eleven" };
    const first = await startTestApi({ dir, env, providerFetch });
    stubProduction(first);
    try {
      const owner = first.client();
      await owner.loginDev("owner");
      const settings = (await owner.get("/api/v1/settings")).json().data;
      expect((await owner.patch("/api/v1/settings", { dashboard: { ...settings.dashboard, contentStudioEnabled: true } },
        { headers: { "if-match": String(settings.version) } })).statusCode).toBe(200);

      const plan = { version: 1, exportiert_am: "2026-10-23T00:00:00.000Z", content: [idea], postings: [] };
      expect((await owner.request("PUT", "/api/v1/content-studio/plan", { body: plan, headers: { "if-match": "0" } })).statusCode).toBe(200);

      const created = await owner.post(ROUTE, { ideaId: idea.id, planRevision: 1, confirmed: true },
        { headers: { "idempotency-key": "restart-job-1" } });
      expect(created.statusCode, created.body).toBe(202);
      const jobId = created.json().data.id as string;
      await first.runtime.contentStudioProduction.processPending();
      expect((await owner.get(`${ROUTE}/${jobId}`)).json().data).toMatchObject({ state: "completed", artifactReady: true });
    } finally {
      await first.close();
    }

    const second = await startTestApi({ dir, env, providerFetch });
    try {
      const owner = second.client();
      await owner.loginDev("owner");
      const plan = (await owner.get("/api/v1/content-studio/plan")).json().data;
      expect(plan.revision).toBe(1);
      expect(plan.plan.content[0].id).toBe(idea.id);

      const jobs = second.runtime.db.prepare("SELECT id, state FROM content_studio_jobs").all() as Array<{ id: string; state: string }>;
      expect(jobs).toHaveLength(1);
      const jobId = jobs[0]!.id;
      const job = (await owner.get(`${ROUTE}/${jobId}`)).json().data;
      expect(job).toMatchObject({ state: "completed", artifactReady: true, providerTaskId: "restart-task" });
      const artifact = await owner.get(`${ROUTE}/${jobId}/artifact`);
      expect(artifact.statusCode, artifact.body).toBe(200);
      expect(artifact.rawPayload.toString()).toBe("restart-mp4");
    } finally {
      await second.close();
    }
  }, 60_000);
});