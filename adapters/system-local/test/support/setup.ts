import { createFakeUpstream, type FakeUpstream } from "@jarvis/adapter-testkit";
import { createCorrelationId } from "@jarvis/sdk";
import { createMemoryLogger, systemClock } from "@jarvis/adapter-core";
import { LocalSystemAdapter } from "../../src";
import { installHermesApi, installHermesDashboard, type FakeHermes } from "../fake/hermes-server";
import { installLlamaServer } from "../fake/llama-server";
import { createFakeVoiceService, type FakeVoiceService } from "../fake/voice-status-server";
import { createFakeHost, type FakeHostControl } from "./fake-host";
import { closeSession, openSession, type Session } from "./conformance-kit";

// Probe timeout for tests: short enough for the slow-service cases (fault latency 2 s), long enough that a loaded CI
// machine does not turn a healthy local fake into "degraded".
export const FAST = { timeoutMs: 1_000 } as const;

export interface Rig {
  qwen: FakeUpstream;
  hermes: FakeUpstream;
  hermesState: FakeHermes;
  dashboard: FakeUpstream;
  voice: FakeVoiceService;
  host: FakeHostControl;
  adapter: LocalSystemAdapter;
  session: Session;
  /** The canary the suite handed to the adapter as `hermesApiKey`. */
  hermesKey: string;
  close(): Promise<void>;
}

export async function createRig(
  options: { platform?: NodeJS.Platform; config?: Record<string, unknown>; withKey?: boolean } = {},
): Promise<Rig> {
  const [qwen, hermes, dashboard] = await Promise.all([
    createFakeUpstream(),
    createFakeUpstream(),
    createFakeUpstream(),
  ]);
  const voice = await createFakeVoiceService();
  const host = createFakeHost(options.platform ?? "linux");
  const adapter = new LocalSystemAdapter(host);
  installLlamaServer(qwen);
  installHermesDashboard(dashboard);
  const session = await openSession(adapter, {
    qwenUrl: qwen.url,
    hermesApiUrl: hermes.url,
    hermesDashboardUrl: dashboard.url,
    voiceUrl: voice.url,
    ...FAST,
    ...options.config,
  });
  const hermesKey = session.secrets.hermesApiKey ?? "";
  const hermesState = installHermesApi(hermes, {
    apiKey: options.withKey === false ? "another-key-entirely" : hermesKey,
  });
  return {
    qwen,
    hermes,
    hermesState,
    dashboard,
    voice,
    host,
    adapter,
    session,
    hermesKey,
    async close() {
      await closeSession(session).catch(() => undefined);
      await Promise.all([qwen.close(), hermes.close(), dashboard.close(), voice.close()]);
    },
  };
}

/**
 * A second adapter instance on the same rig whose context has no secrets at all (the suite helper always hands out
 * canary secrets). Used for "no key configured" and "key from file".
 */
export async function startWithoutSecrets(
  rig: Rig,
  config: Record<string, unknown>,
): Promise<{ adapter: LocalSystemAdapter; logger: ReturnType<typeof createMemoryLogger> }> {
  const logger = createMemoryLogger();
  const adapter = new LocalSystemAdapter(rig.host);
  await adapter.initialize({
    adapterId: adapter.manifest.id,
    mode: "live",
    logger,
    clock: systemClock,
    config: {
      qwenUrl: rig.qwen.url,
      hermesApiUrl: rig.hermes.url,
      hermesDashboardUrl: rig.dashboard.url,
      voiceUrl: rig.voice.url,
      ...FAST,
      ...config,
    },
    getSecret: () => undefined,
    emit: () => undefined,
    signal: new AbortController().signal,
    correlationId: () => createCorrelationId(),
  });
  return { adapter, logger };
}
