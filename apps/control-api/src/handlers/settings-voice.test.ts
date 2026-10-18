import { afterEach, describe, expect, it, vi } from "vitest";
import { settingsHandlers } from "./settings";

afterEach(() => vi.restoreAllMocks());

function context(version: () => number, patch: (expected?: number) => never) {
  const settings = {
    area: () => ({ ttsVoice: "friday-female" }),
    version,
    validateAreas: vi.fn(),
    patch: (_value: unknown, expected?: number) => patch(expected),
  };
  return {
    body: { voice: { ttsVoice: "classic" } },
    mutation: { ifMatchVersion: 1 },
    runtime: {
      settings,
      config: { adapters: { voice: { provider: "friday-voice-http", config: { baseUrl: "http://127.0.0.1:43794" } } } },
      voiceBridgeKey: Buffer.from("fixture-key"),
    },
    audit: {},
  } as unknown as Parameters<NonNullable<typeof settingsHandlers.updateSettings>>[0];
}

describe("voice settings commit", () => {
  it("uses the captured settings version after the voice acknowledgement and restores on conflict", async () => {
    let release: ((response: Response) => void) | undefined;
    const first = new Promise<Response>((resolve) => { release = resolve; });
    const send = vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => first)
      .mockResolvedValueOnce(new Response(JSON.stringify({ applied: true, voice: "friday-female" }), { status: 200 }));
    let current = 1;
    const patch = vi.fn((expected?: number): never => { expect(expected).toBe(1); throw new Error("concurrent version"); });
    const ctx = context(() => current, patch);
    const pending = settingsHandlers.updateSettings!(ctx);
    current = 2;
    release!(new Response(JSON.stringify({ applied: true, voice: "classic" }), { status: 200 }));
    await expect(pending).rejects.toThrow("concurrent version");
    expect(patch).toHaveBeenCalledOnce();
    expect(send.mock.calls.map(([, options]) => JSON.parse(String(options?.body)).voice)).toEqual(["classic", "friday-female"]);
  });

  it("reports unconfirmed recovery when the storage write and switchback fail", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ applied: true, voice: "classic" }), { status: 200 }))
      .mockRejectedValueOnce(new Error("bridge offline"));
    const ctx = context(() => 1, () => { throw new Error("disk failed"); });
    await expect(settingsHandlers.updateSettings!(ctx)).rejects.toThrow("Rückkehr zur vorherigen Stimme konnten nicht bestätigt");
  });
});
