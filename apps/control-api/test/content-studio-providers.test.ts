import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApi, type TestApi } from "./helpers";

const KIE = "/api/v1/content-studio/kie/tasks";
const SPEECH = "/api/v1/content-studio/elevenlabs/speech";

describe("Content Studio paid provider operations", () => {
  let api: TestApi;
  const calls: string[] = [];
  const image = { kind: "image", prompt: "A blue room", aspectRatio: "1:1", confirmed: true };

  beforeAll(async () => {
    api = await startTestApi({ env: { KIE_API_KEY: "server-only-kie", ELEVENLABS_API_KEY: "server-only-eleven" }, providerFetch: async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes("createTask")) {
        expect(init?.headers).toMatchObject({ Authorization: "Bearer server-only-kie" });
        return Response.json({ code: 200, data: { taskId: "provider-task-1" } });
      }
      if (url.includes("recordInfo")) return Response.json({ code: 200, data: { state: "success", resultJson: '{"resultUrls":["https://example.invalid/result.png","http://unsafe.invalid/file"]}' } });
      expect(init?.headers).toMatchObject({ "xi-api-key": "server-only-eleven" });
      return new Response(new Uint8Array([73, 68, 51]), { headers: { "content-type": "audio/mpeg" } });
    } });
  });
  afterAll(async () => { await api.close(); });

  it("rejects disabled, unauthorized, unconfirmed and CSRF-free requests before billing", async () => {
    const owner = api.client();
    await owner.loginDev("owner");
    expect((await owner.post(KIE, image, { headers: { "idempotency-key": "studio-disabled" } })).statusCode).toBe(403);
    const current = (await owner.get("/api/v1/settings")).json();
    const enabled = await owner.patch("/api/v1/settings", { dashboard: { ...current.data.dashboard, contentStudioEnabled: true } }, { headers: { "if-match": String(current.data.version) } });
    expect(enabled.statusCode, enabled.body).toBe(200);
    const viewer = api.client();
    await viewer.loginDev("viewer");
    expect((await viewer.post(KIE, image, { headers: { "idempotency-key": "studio-viewer" } })).statusCode).toBe(403);
    expect((await owner.post(KIE, image, { csrf: false, headers: { "idempotency-key": "studio-csrf" } })).statusCode).toBe(403);
    expect((await owner.post(KIE, { ...image, confirmed: false }, { headers: { "idempotency-key": "studio-unconfirmed" } })).statusCode).toBe(422);
    expect(calls).toHaveLength(0);
  });

  it("creates once, polls only known tasks, and filters unsafe result links", async () => {
    const owner = api.client();
    await owner.loginDev("owner");
    const first = await owner.post(KIE, image, { headers: { "idempotency-key": "studio-image-1" } });
    expect(first.statusCode, first.body).toBe(202);
    expect(first.json().data.taskId).toBe("provider-task-1");
    expect((await owner.get(`${KIE}/unknown-task`)).statusCode).toBe(404);
    const status = await owner.get(`${KIE}/provider-task-1`);
    expect(status.json().data.resultUrls).toEqual(["https://example.invalid/result.png"]);
    const repeat = await owner.post(KIE, image, { headers: { "idempotency-key": "studio-image-1" } });
    expect(repeat.statusCode).toBe(202);
    expect(calls.filter((call) => call.includes("createTask"))).toHaveLength(1);
  });

  it("returns an MP3 payload without exposing credentials", async () => {
    const owner = api.client();
    await owner.loginDev("owner");
    const response = await owner.post(SPEECH, { text: "Hallo", voiceId: "voice123", confirmed: true }, { headers: { "idempotency-key": "studio-speech-1" } });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers["content-type"]).toContain("audio/mpeg");
    expect(response.rawPayload).toEqual(Buffer.from([73, 68, 51]));
    expect(response.body).not.toContain("server-only");
    const repeat = await owner.post(SPEECH, { text: "Hallo", voiceId: "voice123", confirmed: true }, { headers: { "idempotency-key": "studio-speech-1" } });
    expect(repeat.statusCode).toBe(409);
    expect(calls.filter((call) => call.includes("text-to-speech"))).toHaveLength(1);
  });
});
