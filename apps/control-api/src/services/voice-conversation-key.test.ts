import { afterEach, describe, expect, it, vi } from "vitest";
import type { Runtime } from "../runtime/types";
import { adoptBrainConversationKey, setConversationKey } from "./voice-conversation-key";

vi.mock("./voice-settings", () => ({
  readRuntimeVoiceSettings: vi.fn(async () => ({
    settings: { conversationRegion: "ap-southeast-1" },
    serviceStartedAt: "x",
    configRevision: "y",
  })),
}));

const brainKey = vi.fn(async (): Promise<{ key: string; region: "ap-southeast-1" | "cn-beijing" }> => ({
  key: "sk-sp-BRAINKEY-0123",
  region: "ap-southeast-1",
}));

const runtime = {
  config: { adapters: { voice: { provider: "friday-voice-http", config: { baseUrl: "http://127.0.0.1:43790" } } } },
  voiceBridgeKey: Buffer.alloc(32, 1),
  hermesConfig: { brainQwenKey: brainKey },
} as unknown as Runtime;

const foreignRuntime = {
  config: { adapters: { voice: { provider: "friday-voice-http", config: { baseUrl: "http://example.com:1" } } } },
  voiceBridgeKey: Buffer.alloc(32, 1),
} as unknown as Runtime;

afterEach(() => vi.restoreAllMocks());

describe("voice conversation key bridge", () => {
  it("stores the key through the local voice service and confirms it", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ keyConfigured: true })));
    await expect(setConversationKey(runtime, "good-key-1234")).resolves.toEqual({ keyConfigured: true });
    const [target, init] = fetcher.mock.calls[0] ?? [];
    expect(String(target).endsWith("/control/conversation-key")).toBe(true);
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ apiKey: "good-key-1234" }));
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${runtime.voiceBridgeKey.toString("base64")}`);
  });

  it("reports a rejected key without echoing the secret", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 422, statusText: "Qwen Audio rejected the key" }));
    const settlement = await setConversationKey(runtime, "bad-key-1234").then(() => null, (reason: unknown) => reason);
    expect(settlement).toMatchObject({ code: "VALIDATION_FAILED" });
    const message = settlement instanceof Error ? settlement.message : "";
    expect(message).toContain("abgelehnt");
    expect(message).not.toContain("bad-key-1234");
  });

  it("points to the installer when the runtime cannot store the key", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 422, statusText: "RuntimeError" }));
    const settlement = await setConversationKey(runtime, "good-key-1234").then(() => null, (reason: unknown) => reason);
    expect(settlement).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(settlement instanceof Error ? settlement.message : "").toContain("Installer");
  });

  it("refuses a non-local voice service address without calling it", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch");
    await expect(setConversationKey(foreignRuntime, "good-key-1234")).rejects.toMatchObject({ code: "ADAPTER_UNAVAILABLE" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not accept an unconfirmed key", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ keyConfigured: false })));
    await expect(setConversationKey(runtime, "good-key-1234")).rejects.toMatchObject({ code: "ADAPTER_UNAVAILABLE" });
  });
});

describe("brain key for Qwen Audio (LG-4.05)", () => {
  it("adopts the brain key through the local voice service", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ keyConfigured: true })));
    await expect(adoptBrainConversationKey(runtime)).resolves.toEqual({ keyConfigured: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ apiKey: "sk-sp-BRAINKEY-0123" }));
  });

  it("refuses a brain key from another region before contacting the voice service", async () => {
    brainKey.mockResolvedValueOnce({ key: "sk-sp-BRAINKEY-0123", region: "cn-beijing" });
    const fetcher = vi.spyOn(globalThis, "fetch");
    const settlement = await adoptBrainConversationKey(runtime).then(() => null, (reason: unknown) => reason);
    expect(settlement).toMatchObject({ code: "VALIDATION_FAILED" });
    const message = settlement instanceof Error ? settlement.message : "";
    expect(message).toContain("Festlandchina (Peking)");
    expect(message).not.toContain("sk-sp-BRAINKEY-0123");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
