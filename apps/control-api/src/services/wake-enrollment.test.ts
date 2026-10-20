import { afterEach, describe, expect, it, vi } from "vitest";
import type { Runtime } from "../runtime/types";
import { startWakeEnrollment, wakeEnrollmentRequest } from "./wake-enrollment";

const runtime = (baseUrl: string) => ({
  config: { adapters: { voice: { provider: "friday-voice-http", config: { baseUrl } } } },
  voiceBridgeKey: Buffer.alloc(32, 7),
}) as unknown as Runtime;

afterEach(() => vi.unstubAllGlobals());

describe("private wake enrollment bridge", () => {
  it("refuses a non-local voice endpoint before sending samples or its bridge key", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(wakeEnrollmentRequest(runtime("https://example.com"), "/sample", { pcmBase64: "private" })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("binds enrollment start to the observed voice instance and config revision", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: URL, init?: RequestInit) => {
      requests.push({ path: url.pathname, init });
      if (url.pathname === "/") return { ok: true, json: async () => ({
        runtime_settings: { wakeWordEnabled: true, wakeWord: "Hey Friday", pushToTalkKey: "Ctrl+Space",
          speakerVerificationRequired: true, storeRawRecordings: false, voiceHistoryEnabled: true, ttsRate: 1 },
        service_started_at: "instance", config_revision: "revision",
      }) };
      return { ok: true, json: async () => ({ state: "capturing", jobId: "a".repeat(32), phrase: "Hey Test",
        shortPhrase: "Test", required: { wake: 12, short: 8, negatives: 8, speech: 8 },
        counts: { wake: 0, short: 0, negatives: 0, speech: 0 }, error: null }) };
    }));
    const result = await startWakeEnrollment(runtime("http://127.0.0.1:43694"), "Hey Test");
    expect(result.state).toBe("capturing");
    const post = requests.find(({ path }) => path === "/control/wake-enrollment/start")!;
    expect(JSON.parse(String(post.init?.body))).toEqual({ phrase: "Hey Test", expectedConfigRevision: "revision",
      expectedServiceStartedAt: "instance" });
    expect(new Headers(post.init?.headers).get("Authorization")).toBe(`Bearer ${Buffer.alloc(32, 7).toString("base64")}`);
  });
});
