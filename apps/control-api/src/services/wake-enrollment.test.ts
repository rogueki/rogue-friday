import { afterEach, describe, expect, it, vi } from "vitest";
import type { Runtime } from "../runtime/types";
import { startWakeEnrollment, wakeEnrollmentRequest } from "./wake-enrollment";
import { browserVoiceHandlers } from "../handlers/browser-voice";

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
          speakerVerificationRequired: true, storeRawRecordings: false, voiceHistoryEnabled: true, sttLanguage: "de", sttModel: "small", conversationBackend: "local", ttsRate: 1 },
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

  it("routes all five owner wake operations to the local voice bridge", async () => {
    const paths: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: URL) => {
      paths.push(url.pathname);
      if (url.pathname === "/") return { ok: true, json: async () => ({
        runtime_settings: { wakeWordEnabled: true, wakeWord: "Hey Friday", pushToTalkKey: "Ctrl+Space",
          speakerVerificationRequired: true, storeRawRecordings: false, voiceHistoryEnabled: true, sttLanguage: "de", sttModel: "small", conversationBackend: "local", ttsRate: 1 },
        service_started_at: "instance", config_revision: "revision",
      }) };
      return { ok: true, json: async () => ({ state: "capturing", jobId: "a".repeat(32), phrase: "Hey Test",
        shortPhrase: "Test", required: { wake: 12, short: 8, negatives: 8, speech: 8 },
        counts: { wake: 0, short: 0, negatives: 0, speech: 0 }, error: null }) };
    }));
    const context = (body?: object) => ({ runtime: runtime("http://127.0.0.1:43694"), body }) as never;
    await browserVoiceHandlers.getWakeEnrollment!(context());
    await browserVoiceHandlers.startWakeEnrollment!(context({ phrase: "Hey Test" }));
    await browserVoiceHandlers.addWakeEnrollmentSample!(context({ jobId: "a".repeat(32), kind: "wake", pcmBase64: "cGNt" }));
    await browserVoiceHandlers.trainWakeEnrollment!(context({ jobId: "a".repeat(32) }));
    await browserVoiceHandlers.discardWakeEnrollment!(context({ jobId: "a".repeat(32) }));
    expect(paths.filter((path) => path.startsWith("/control/wake-enrollment"))).toEqual([
      "/control/wake-enrollment", "/control/wake-enrollment/start", "/control/wake-enrollment/sample",
      "/control/wake-enrollment/train", "/control/wake-enrollment/discard",
    ]);
  });
});
