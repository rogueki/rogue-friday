import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { startTestApi, type TestApi } from "./helpers";
import { WsProbe } from "./support/ws";
import { browserAudioOriginAllowed } from "../src/realtime/hub";
import type { IncomingMessage } from "node:http";

it("rejects malformed, duplicate and non-local insecure browser audio Origins without throwing", () => {
  const request = (origin: string | string[]) => ({ headers: { origin, host: "127.0.0.1:3100" } }) as IncomingMessage;
  expect(browserAudioOriginAllowed(request("http://127.0.0.1:3100"))).toBe(true);
  expect(browserAudioOriginAllowed(request("https://127.0.0.1:3100"))).toBe(true);
  for (const origin of ["http://%", "null", "http://127.0.0.1:3100/path", ["http://127.0.0.1:3100", "https://evil.example"], "http://evil.example:3100"]) {
    expect(browserAudioOriginAllowed(request(origin))).toBe(false);
  }
});

describe("browser voice gate", () => {
  let api: TestApi;
  afterEach(async () => { if (api) await api.close(); });

  it("keeps readiness behind owner auth and denies cross-origin or missing-origin upgrades", async () => {
    api = await startTestApi({ listen: true });
    const owner = api.client();
    await owner.loginDev("owner");
    const viewer = api.client();
    await viewer.loginDev("viewer");
    const path = "/api/v1/voice/browser-audio";
    expect((await owner.get("/api/v1/voice/browser-audio-availability")).json()).toMatchObject({ available: false });
    expect((await viewer.get("/api/v1/voice/browser-audio-availability")).statusCode).toBe(403);
    expect((await api.client().get("/api/v1/voice/browser-audio-availability")).statusCode).toBe(401);
    await expect(WsProbe.connect(api, null, { path })).rejects.toMatchObject({ status: 401 });
    await expect(WsProbe.connect(api, viewer, { path })).rejects.toMatchObject({ status: 403 });
    await expect(WsProbe.connect(api, owner, { path, origin: "https://foreign.example" })).rejects.toMatchObject({ status: 403 });
    await expect(WsProbe.connect(api, owner, { path })).rejects.toMatchObject({ status: 503 });

    const cookie = [...owner.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    const missingOrigin = new WebSocket(`ws://127.0.0.1:${api.port}${path}`, { headers: { cookie } });
    await expect(new Promise<number>((resolve, reject) => {
      missingOrigin.once("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0));
      missingOrigin.once("error", reject);
    })).resolves.toBe(403);
  });
});
