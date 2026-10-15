import type { LatencyStat, VoiceDevice, VoiceMetrics, VoiceProfile, VoiceStatus } from "@friday/sdk";
import { DAY, MIN, type SeedContext } from "./context";

export interface VoiceSeed {
  status: VoiceStatus;
  devices: VoiceDevice[];
  metrics: VoiceMetrics;
  profiles: VoiceProfile[];
  enrollments: [];
  history: string[];
}

const stat = (currentMs: number, avgMs: number, p95Ms: number, sampleCount: number): LatencyStat => ({
  currentMs,
  avgMs,
  p95Ms,
  sampleCount,
});

export function buildVoice(ctx: SeedContext): VoiceSeed {
  const device = (name: string, kind: VoiceDevice["kind"], isDefault: boolean, status: VoiceDevice["status"], channels: number, rate: number): VoiceDevice => ({
    id: ctx.id("vdev"),
    version: 1,
    createdAt: ctx.at(-40 * DAY),
    updatedAt: ctx.at(-2 * DAY),
    source: ctx.src("voice"),
    name,
    kind,
    isDefault,
    status,
    channels,
    sampleRateHz: rate,
  });
  const devices = [
    device("Mikrofon-Array (Realtek Audio)", "input", true, "online", 2, 48_000),
    device("Headset (Jabra Evolve2 65)", "input", false, "online", 1, 16_000),
    device("Lautsprecher (Realtek Audio)", "output", true, "online", 2, 48_000),
    device("Headset (Jabra Evolve2 65)", "output", false, "online", 2, 48_000),
  ];
  const input = devices[0] as VoiceDevice;
  const output = devices[2] as VoiceDevice;
  const status: VoiceStatus = {
    updatedAt: ctx.at(-20_000),
    source: ctx.src("voice"),
    mode: "idle",
    microphone: { state: "idle", active: false, deviceId: input.id, inputLevel: 0.02 },
    wakeWord: { enabled: true, state: "armed", phrase: "Hey Friday" },
    speakerVerification: { enabled: true, state: "idle", recognizedSpeaker: "Erik Brandt", confidence: 0.97 },
    trustedSession: { active: true, expiresAt: ctx.at(25 * MIN) },
    stt: { engine: "faster-whisper large-v3 (lokal)", state: "ready", latencyMs: 420 },
    tts: { engine: "Piper de_DE-thorsten (lokal)", state: "ready", latencyMs: 180 },
    localModel: { name: "Qwen Local", state: "ready", latencyMs: 310 },
    audioInputDeviceId: input.id,
    audioOutputDeviceId: output.id,
    pushToTalk: { enabled: true, active: false },
    focusMode: false,
    rawRecordingEnabled: false,
    voiceHistoryEnabled: true,
  };
  const metrics: VoiceMetrics = {
    sampledAt: ctx.at(-30_000),
    source: ctx.src("voice"),
    wakeWordLatency: stat(120, 135, 190, 312),
    speakerVerificationLatency: stat(95, 110, 160, 312),
    sttLatency: stat(420, 460, 820, 288),
    routerLatency: stat(35, 42, 90, 288),
    firstToken: stat(650, 720, 1400, 274),
    ttsFirstAudio: stat(180, 210, 380, 270),
  };
  const profile = (displayName: string, owner: boolean, samples: number, quality: number, calibrated: boolean, threshold: number, result: VoiceProfile["lastTestResult"]): VoiceProfile => ({
    id: ctx.id("vprof"),
    version: 2,
    createdAt: ctx.at(-60 * DAY),
    updatedAt: ctx.at(-2 * DAY),
    source: ctx.src("voice"),
    displayName,
    owner,
    sampleCount: samples,
    quality,
    calibratedAt: calibrated ? ctx.at(-20 * DAY) : null,
    threshold,
    lastTestAt: result === "unknown" ? null : ctx.at(-2 * DAY),
    lastTestResult: result,
  });
  return {
    status,
    devices,
    metrics,
    profiles: [
      profile("Erik Brandt", true, 24, 0.93, true, 0.72, "pass"),
      profile("Gastprofil Büro", false, 6, 0.58, false, 0.8, "unknown"),
    ],
    enrollments: [],
    // 38 stored utterances over the last ten days (deterministic offsets, no random draw).
    history: Array.from({ length: 38 }, (_, index) => ctx.at(-(index * 6 * 3_600_000 + 12 * MIN))),
  };
}
