import type { CallContext } from "@friday/adapter-core";
import type { Runtime } from "../runtime/types";
import { voiceRuntimeStatus } from "./voice-audio";
import { runtimeVoiceFields, type RuntimeVoiceSettings } from "./voice-settings";

export interface IntegrationStatus {
  kind: string;
  id: string | null;
  installed: boolean;
  configured: boolean;
  authenticated: boolean | null;
  connected: boolean | null;
  canRead: boolean | null;
  canWrite: boolean | null;
  checkedAt: string;
  errorCode: string | null;
  persistedRevision: number;
  appliedRevision: number | null;
  verification: "verified" | "unverified" | "failed" | "requires_restart";
  settings: Record<string, { verification: "verified" | "unverified" | "failed" | "requires_restart"; reasonCode: string | null }>;
}

// A voice ACK is process-local. Reboot, external changes, or adapter loss must not inherit it.
const voiceAcks = new WeakMap<Runtime, { revision: number; choice: string; serviceStartedAt: string | null }>();
const audioAcks = new WeakMap<Runtime, { revision: number; input: string | null; output: string | null; serviceStartedAt: string | null }>();
const settingsAcks = new WeakMap<Runtime, { revision: number; settings: RuntimeVoiceSettings; serviceStartedAt: string }>();

export function recordVoiceAck(runtime: Runtime, revision: number, choice: string, serviceStartedAt: string | null = null): void {
  voiceAcks.set(runtime, { revision, choice, serviceStartedAt });
}

export function recordAudioAck(runtime: Runtime, revision: number, input: string | null, output: string | null, serviceStartedAt: string | null = null): void {
  audioAcks.set(runtime, { revision, input, output, serviceStartedAt });
}

export function recordVoiceSettingsAck(runtime: Runtime, revision: number, settings: RuntimeVoiceSettings, serviceStartedAt: string): void {
  settingsAcks.set(runtime, { revision, settings: structuredClone(settings), serviceStartedAt });
}

export async function voiceIntegrationStatus(runtime: Runtime, call: CallContext): Promise<IntegrationStatus> {
  const checkedAt = new Date().toISOString();
  const persistedRevision = runtime.settings.version();
  const voice = runtime.settings.area("voice");
  const installed = runtime.config.adapters.voice.provider === "friday-voice-http";
  const configured = installed && typeof runtime.config.adapters.voice.config.baseUrl === "string";
  const settingsAck = settingsAcks.get(runtime);
  let connected = false;
  let actualInput: string | null | undefined;
  let actualOutput: string | null | undefined;
  let actualChoice: string | null | undefined;
  let serviceStartedAt: string | null | undefined;
  let actualRuntime: Record<string, unknown> | undefined;
  let actualTransport: unknown;
  let errorCode: string | null = configured ? null : "VOICE_NOT_CONFIGURED";
  if (configured) {
    try {
      const result = await runtime.registry.getPort("voice").getVoiceStatus({}, call);
      connected = result.data.source.system !== "mock" && result.data.tts.state !== "offline";
      actualInput = result.data.audioInputDeviceId;
      actualOutput = result.data.audioOutputDeviceId;
      actualChoice = result.data.ttsVoiceChoice;
      serviceStartedAt = result.data.serviceStartedAt;
      if (connected && settingsAck) {
        const raw = await voiceRuntimeStatus(runtime);
        actualTransport = raw.audio_transport;
        if (raw.service_started_at === serviceStartedAt && raw.runtime_settings &&
            typeof raw.runtime_settings === "object" && !Array.isArray(raw.runtime_settings))
          actualRuntime = raw.runtime_settings as Record<string, unknown>;
      }
      if (!connected) errorCode = "VOICE_OFFLINE";
    } catch {
      errorCode = "VOICE_OFFLINE";
    }
  }
  const ack = voiceAcks.get(runtime);
  const sameVoiceProcess = (started: string | null | undefined) => started !== null && started !== undefined && serviceStartedAt === started;
  const verified = connected && ack?.revision === persistedRevision && ack.choice === voice.ttsVoice &&
    actualChoice === voice.ttsVoice && sameVoiceProcess(ack.serviceStartedAt);
  const audioAck = audioAcks.get(runtime);
  const inputVerified = connected && audioAck?.revision === persistedRevision && sameVoiceProcess(audioAck.serviceStartedAt) && actualInput !== undefined && actualInput === audioAck.input && audioAck.input === voice.inputDeviceId;
  const outputVerified = connected && audioAck?.revision === persistedRevision && sameVoiceProcess(audioAck.serviceStartedAt) && actualOutput !== undefined && actualOutput === audioAck.output && audioAck.output === voice.outputDeviceId;
  const runtimeFields = Object.fromEntries(runtimeVoiceFields.map((field) => {
    const fieldVerified = connected && actualRuntime !== undefined && settingsAck?.revision === persistedRevision &&
      sameVoiceProcess(settingsAck.serviceStartedAt) && (field !== "pushToTalkKey" || actualTransport === "browser") &&
      actualRuntime[field] === settingsAck.settings[field] &&
      actualRuntime[field] === voice[field];
    return [field, { verification: fieldVerified ? "verified" : connected ? "unverified" : "failed",
      reasonCode: fieldVerified ? null : errorCode ?? "VOICE_SETTINGS_ACK_NOT_AVAILABLE" }];
  }));
  return {
    kind: "voice", id: null, installed, configured,
    authenticated: null, connected,
    canRead: connected, canWrite: null,
    checkedAt, errorCode, persistedRevision,
    appliedRevision: null,
    verification: connected ? "unverified" : "failed",
    settings: {
      ...runtimeFields,
      ttsVoice: { verification: verified ? "verified" : connected ? "unverified" : "failed", reasonCode: verified ? null : errorCode ?? "VOICE_ACK_NOT_AVAILABLE" },
      inputDeviceId: { verification: inputVerified ? "verified" : "unverified", reasonCode: inputVerified ? null : "AUDIO_DEVICE_ACK_NOT_AVAILABLE" },
      outputDeviceId: { verification: outputVerified ? "verified" : "unverified", reasonCode: outputVerified ? null : "AUDIO_DEVICE_ACK_NOT_AVAILABLE" },
    },
  };
}
