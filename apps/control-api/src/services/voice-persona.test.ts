import { afterEach, describe, expect, it, vi } from "vitest";
import type { Runtime } from "../runtime/types";
import { applyVoicePersona, VOICE_PERSONAS } from "./voice-persona";

const runtime = (baseUrl = "http://127.0.0.1:43794") => ({
  config: { adapters: { voice: { provider: "friday-voice-http", config: { baseUrl } } } },
  voiceBridgeKey: Buffer.from("local-test-key"),
}) as unknown as Runtime;

afterEach(() => vi.restoreAllMocks());

describe("voice persona bridge", () => {
  it("sends only the canonical choice with the existing local bridge key and requires applied ack", async () => {
    const send = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ applied: true, voice: "classic" }), { status: 200 }));
    await applyVoicePersona(runtime(), "classic");
    const [url, options] = send.mock.calls[0]!;
    expect(String(url)).toBe("http://127.0.0.1:43794/control/voice");
    expect(JSON.parse(String(options?.body))).toEqual({ voice: "classic" });
    expect(options?.headers).toMatchObject({ Authorization: "Bearer bG9jYWwtdGVzdC1rZXk=" });
    send.mockResolvedValueOnce(new Response(JSON.stringify({ applied: false, voice: "classic" }), { status: 200 }));
    await expect(applyVoicePersona(runtime(), "classic")).rejects.toThrow("nicht bestätigt");
  });

  it("rejects a remote bridge URL before sending the key", async () => {
    const send = vi.spyOn(globalThis, "fetch");
    await expect(applyVoicePersona(runtime("https://example.com:43794"), "classic")).rejects.toThrow("lokale Adresse");
    expect(send).not.toHaveBeenCalled();
  });

  it("reports old runtime and unavailable reference without claiming the choice saved", async () => {
    const send = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(applyVoicePersona(runtime(), "friday-female")).rejects.toThrow("Stimmen-Update");
    send.mockResolvedValueOnce(new Response(JSON.stringify({ applied: false, message: "Referenz fehlt" }), { status: 409 }));
    await expect(applyVoicePersona(runtime(), "classic")).rejects.toThrow("Referenz fehlt");
  });
  it("carries the own voice as a third persona and sends it unchanged", async () => {
    expect(VOICE_PERSONAS).toEqual(["friday-female", "classic", "custom"]);
    const send = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ applied: true, voice: "custom" }), { status: 200 }));
    await applyVoicePersona(runtime(), "custom");
    const [, options] = send.mock.calls[0]!;
    expect(JSON.parse(String(options?.body))).toEqual({ voice: "custom" });
  });
});