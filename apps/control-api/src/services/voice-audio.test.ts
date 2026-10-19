import { afterEach, expect, it, vi } from "vitest";
import type { Runtime } from "../runtime/types";
import { applyVoiceAudio } from "./voice-audio";

const runtime = (baseUrl = "http://127.0.0.1:43794") => ({
  config: { adapters: { voice: { provider: "friday-voice-http", config: { baseUrl } } } },
  voiceBridgeKey: Buffer.from("local-test-key"),
}) as unknown as Runtime;

afterEach(() => vi.restoreAllMocks());

it("requires an authenticated apply ACK and actual selected device read-back", async () => {
  const input = `vdev_${"a".repeat(26)}`;
  const output = `vdev_${"b".repeat(26)}`;
  const send = vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response(JSON.stringify({ applied: true, inputDeviceId: input, outputDeviceId: output,
      serviceStartedAt: "2026-10-19T00:00:00Z" }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ input_device_id: input, output_device_id: output,
      service_started_at: "2026-10-19T00:00:00Z" }), { status: 200 }));
  await expect(applyVoiceAudio(runtime(), input, output)).resolves.toBe("2026-10-19T00:00:00Z");
  expect(String(send.mock.calls[0]![0])).toBe("http://127.0.0.1:43794/control/audio");
  expect(send.mock.calls[0]![1]?.headers).toMatchObject({ Authorization: "Bearer bG9jYWwtdGVzdC1rZXk=" });
  expect(JSON.parse(String(send.mock.calls[0]![1]?.body))).toEqual({ inputDeviceId: input, outputDeviceId: output });
});

it("rejects mismatched live read-back and remote key destinations", async () => {
  const send = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ applied: true,
    inputDeviceId: null, outputDeviceId: null, serviceStartedAt: "process-A" }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ input_device_id: null, output_device_id: null,
      service_started_at: "process-B" }), { status: 200 }));
  await expect(applyVoiceAudio(runtime(), null, null)).rejects.toThrow("stimmt nicht");
  await expect(applyVoiceAudio(runtime("https://example.com:43794"), null, null)).rejects.toThrow("Ungültige");
  expect(send).toHaveBeenCalledTimes(2);
});
