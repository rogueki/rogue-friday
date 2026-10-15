import { createFakeUpstream, type FakeUpstream } from "@jarvis/adapter-testkit";
import { JarvisVoiceHttpAdapter } from "../../src";
import { createFakeVoiceService, type FakeVoiceService } from "../fake/voice-status-server";
import { installLlamaServer } from "../fake/llama-server";
import { openSession, closeSession, type Session } from "./conformance-kit";

/** Short timings so that fault tests finish in milliseconds. */
export const FAST = { timeoutMs: 250, maxAttempts: 3, retryBaseDelayMs: 5 } as const;

export interface Rig {
  voice: FakeVoiceService;
  llama: FakeUpstream;
  session: Session;
  adapter: JarvisVoiceHttpAdapter;
  config: Record<string, unknown>;
  close(): Promise<void>;
}

export async function createRig(
  overrides: Record<string, unknown> = {},
  options: { initialize?: boolean } = {},
): Promise<Rig> {
  const voice = await createFakeVoiceService();
  const llama = await createFakeUpstream();
  installLlamaServer(llama);
  const adapter = new JarvisVoiceHttpAdapter();
  // Level polling is off by default so request counting tests stay exact; level tests switch it on.
  const config = { baseUrl: voice.url, localModelUrl: llama.url, ...FAST, levelPollIntervalMs: 0, ...overrides };
  const session = await openSession(adapter, config, options);
  return {
    voice,
    llama,
    session,
    adapter,
    config,
    async close() {
      await closeSession(session).catch(() => undefined);
      await voice.close();
      await llama.close();
    },
  };
}
