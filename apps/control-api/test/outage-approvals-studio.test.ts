/* eslint-disable @typescript-eslint/no-explicit-any -- test code reads untyped JSON bodies */
import { afterEach, describe, expect, it } from "vitest";
import { ContentStudioProductionService } from "../src/services/content-studio-production";
import { startTestApi, type ApiClient, type TestApi } from "./helpers";

/**
 * Letzte Ausfallpfade aus DASH-18.03: faellt der Freigaben-Adapter aus, bleiben eigene (native) Freigaben auf der Seite
 * und per Sprache sichtbar; fehlen Studio-Anbieter oder FFmpeg, lehnt die Produktion wiederholbar mit 503 ab, ohne
 * Anbieteraufruf und ohne angelegten Auftrag.
 */
const opened: TestApi[] = [];
afterEach(async () => {
  for (const api of opened.splice(0)) await api.close();
});

async function ownerOf(api: TestApi): Promise<ApiClient> {
  const owner = api.client();
  await owner.loginDev("owner");
  return owner;
}

describe("approvals adapter offline", () => {
  it("keeps native approvals visible on the page and by voice", async () => {
    const api = await startTestApi();
    opened.push(api);
    const owner = await ownerOf(api);
    const text = "Trage Ausfallprobe morgen 14 Uhr ein";
    const preview = await owner.post("/api/v1/commands", { text, source: "text" });
    expect(preview.json().status, preview.body).toBe("requires_confirmation");
    const confirmed = await owner.post("/api/v1/commands", { text, source: "text", confirm: true, previewId: preview.json().previewId });
    expect(confirmed.json().status, confirmed.body).toBe("requires_approval");
    const approvalId = confirmed.json().approvalId as string;

    const control = await owner.post("/api/v1/dev/scenarios/control", { action: "adapter_offline", adapterId: "mock-approvals", offline: true });
    expect(control.statusCode, control.body).toBe(200);

    const page = await owner.get("/api/v1/approvals", { query: { status: ["pending"] } });
    expect(page.statusCode, page.body).toBe(200);
    expect((page.json() as any).items.map((item: { id: string }) => item.id)).toEqual([approvalId]);
    const spoken = await owner.post("/api/v1/commands", { text: "Liste ausstehende Freigaben", source: "voice" });
    expect(spoken.statusCode, spoken.body).toBe(200);
    expect((spoken.json() as any).result.message).toContain(approvalId);
  });
});

describe("Content Studio production without providers", () => {
  async function studio(env: Record<string, string>, ffmpeg: boolean) {
    const calls: string[] = [];
    const api = await startTestApi({ env, providerFetch: async (input) => {
      calls.push(String(input));
      return Response.json({});
    } });
    opened.push(api);
    api.runtime.contentStudioProduction = new ContentStudioProductionService(api.runtime.db, api.runtime.contentStudioPlan,
      api.runtime.contentStudioKeys, api.runtime.contentStudioProviders, api.config.paths.dataDir, { ffmpegAvailable: () => ffmpeg });
    const owner = await ownerOf(api);
    const settings = (await owner.get("/api/v1/settings")).json().data;
    expect((await owner.patch("/api/v1/settings", { dashboard: { ...settings.dashboard, contentStudioEnabled: true } }, { headers: { "if-match": String(settings.version) } })).statusCode).toBe(200);
    const idea = { id: "planned-outage", titel: "Ausfall", plattform: "Instagram", format: "Feed-Post", beschreibung: "Probe ohne Anbieter.", zieldatum: "", status: "idee" };
    expect((await owner.request("PUT", "/api/v1/content-studio/plan", { body: { version: 1, content: [idea], postings: [] }, headers: { "if-match": "0" } })).statusCode).toBe(200);
    const response = await owner.post("/api/v1/content-studio/production-jobs", { ideaId: idea.id, planRevision: 1, voiceId: "voice1", confirmed: true },
      { headers: { "idempotency-key": `outage-${ffmpeg}` } });
    const jobs = api.runtime.db.prepare("SELECT COUNT(*) AS count FROM content_studio_jobs").get() as { count: number };
    return { response, calls, jobs: jobs.count };
  }

  it("refuses with 503 and points to the settings when kie.ai and ElevenLabs are not connected", async () => {
    const { response, calls, jobs } = await studio({}, true);
    expect(response.statusCode, response.body).toBe(503);
    const error = (response.json() as any).error;
    expect(error.code).toBe("ADAPTER_UNAVAILABLE");
    // Missing credentials are a configuration gap: retrying cannot help, the message names where to connect them.
    expect(error.retryable).toBe(false);
    expect(error.message).toContain("Einstellungen");
    expect(error.message).toContain("kie.ai und ElevenLabs");
    expect(calls).toEqual([]);
    expect(jobs).toBe(0);
  });

  it("refuses with 503 when FFmpeg is missing", async () => {
    const { response, calls, jobs } = await studio({ KIE_API_KEY: "private-kie", ELEVENLABS_API_KEY: "private-eleven" }, false);
    expect(response.statusCode, response.body).toBe(503);
    expect((response.json() as any).error.message).toContain("FFmpeg");
    expect(calls).toEqual([]);
    expect(jobs).toBe(0);
  });
});
