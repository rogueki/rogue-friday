import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page, WebSocketRoute } from "@playwright/test";

/** Helpers for the orb rework specs: runtime probe, controller access, audio fixtures and a fake browser-voice gateway. */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Render probe (`window.__ORB_DEBUG__`); the rework fields are optional so older builds fail with a clear message. */
export interface OrbProbe {
  frames: number;
  draws: number;
  geometries: number;
  textures: number;
  triangles: number;
  quality: string;
  /** Visible orb extent in canvas pixels (CSS px, origin = canvas top-left). */
  bboxPx?: { x: number; y: number; w: number; h: number };
  canvasPx?: { w: number; h: number };
  groupPhases?: { rings: number[]; breath: number; mid: number; outer: number; drift: number[] };
  audioSource?: { input: string; output: string; envelope: boolean; gateIn: number; gateOut: number; inRms: number; outRms: number };
}

/** Group phases as a flat name -> value map. */
export function flatPhases(probe: OrbProbe | null): Record<string, number> {
  const g = probe?.groupPhases;
  if (!g) return {};
  const out: Record<string, number> = { breath: g.breath, mid: g.mid, outer: g.outer };
  g.rings.forEach((v, i) => { out[`ring${i}`] = v; });
  g.drift.forEach((v, i) => { out[`drift${i}`] = v; });
  return out;
}

export const orbProbe = (page: Page): Promise<OrbProbe | null> =>
  page.evaluate(() => (window as unknown as { __ORB_DEBUG__?: OrbProbe }).__ORB_DEBUG__ ?? null);

export interface OrbSnapshotState {
  mode: string;
  progressMode: string;
  progress: number | null;
  activeAgentCount: number;
  primaryInteraction: string;
  backgroundWork: string;
  approvalId: string | null;
  activityText: string | null;
  since: number;
}

/** Reads the controller state through the dev hook (`window.__FRIDAY_ORB__`, only present while devScenarios is on). */
export const orbState = (page: Page): Promise<OrbSnapshotState> =>
  page.evaluate(() => {
    const hook = (window as unknown as { __FRIDAY_ORB__?: { controller: { getState(): any } } }).__FRIDAY_ORB__; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!hook) throw new Error("window.__FRIDAY_ORB__ is missing (devScenarios off or orb not mounted)");
    const s = hook.controller.getState();
    return {
      mode: s.status.mode,
      progressMode: s.status.progressMode,
      progress: s.status.progress ?? null,
      activeAgentCount: s.status.activeAgentCount ?? 0,
      primaryInteraction: s.layers.primaryInteraction,
      backgroundWork: s.layers.backgroundWork,
      approvalId: s.layers.approval.approvalId ?? null,
      activityText: s.status.activityText ?? null,
      since: s.status.since,
    };
  });

export interface AudioReading {
  input: { rms: number; peak: number; low: number; mid: number; high: number; gateOpen: boolean; source: string };
  output: { rms: number; peak: number; low: number; mid: number; high: number; gateOpen: boolean; source: string };
  speechEnvelopeActive: boolean;
}

export const readAudio = (page: Page): Promise<AudioReading> =>
  page.evaluate(() => (window as unknown as { __FRIDAY_ORB__: { readAudio(): any } }).__FRIDAY_ORB__.readAudio()); // eslint-disable-line @typescript-eslint/no-explicit-any

/** Samples `field` of the input/output frame every `everyMs` for `durationMs`; returns the series. */
export async function sampleAudio(page: Page, channel: "input" | "output", field: "rms" | "peak" | "low" | "mid" | "high", durationMs: number, everyMs = 50): Promise<number[]> {
  const values: number[] = [];
  const end = Date.now() + durationMs;
  while (Date.now() < end) {
    values.push((await readAudio(page))[channel][field]);
    await page.waitForTimeout(everyMs);
  }
  return values;
}

export const mean = (values: readonly number[]): number => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
export const maxOf = (values: readonly number[]): number => values.reduce((a, b) => Math.max(a, b), 0);

/* ── WAV fixtures for Chromium's fake microphone ───────────────────────────────────────────────────────────────── */

const SAMPLE_RATE = 48_000;

function wavBuffer(samples: Float32Array): Buffer {
  const data = Buffer.alloc(44 + samples.length * 2);
  data.write("RIFF", 0);
  data.writeUInt32LE(36 + samples.length * 2, 4);
  data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(SAMPLE_RATE, 24);
  data.writeUInt32LE(SAMPLE_RATE * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i += 1) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i]!)) * 32767), 44 + i * 2);
  return data;
}

/** Deterministic pseudo random 0..1 (no Math.random, fixtures must be identical on every run). */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/**
 * Speech-like signal: harmonic voice (f0 ~ 140 Hz with formant-ish weighting) gated into 180-260 ms syllables with gaps,
 * plus a little noise. `amplitude` is the syllable peak; the browser's noise suppression keeps a harmonic, syllabic
 * signal, a stationary tone would be removed.
 */
function speechLike(seconds: number, amplitude: number, noise: number): Float32Array {
  const random = lcg(7);
  const out = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  let t = 0;
  while (t < seconds) {
    const syllable = 0.18 + random() * 0.08;
    const gap = 0.07 + random() * 0.07;
    const f0 = 120 + random() * 50;
    const level = amplitude * (0.55 + 0.45 * random());
    for (let i = Math.round(t * SAMPLE_RATE); i < Math.min(out.length, Math.round((t + syllable) * SAMPLE_RATE)); i += 1) {
      const local = i / SAMPLE_RATE - t;
      const env = Math.sin((Math.PI * local) / syllable) ** 2;
      let voice = 0;
      for (let h = 1; h <= 14; h += 1) voice += Math.sin(2 * Math.PI * f0 * h * (i / SAMPLE_RATE)) * Math.exp(-((h * f0 - 700) ** 2) / (2 * 500 ** 2)) / Math.sqrt(h);
      out[i] = (out[i] ?? 0) + voice * env * level * 0.6;
    }
    t += syllable + gap;
  }
  for (let i = 0; i < out.length; i += 1) out[i] = (out[i] ?? 0) + (random() - 0.5) * 2 * noise;
  return out;
}

export type MicFixture = "silence" | "quiet" | "loud";

/** Writes the 12 s loop for a fixture to the temp dir and returns its path (`--use-file-for-fake-audio-capture`). */
export function writeMicFixture(kind: MicFixture): string {
  const dir = join(tmpdir(), "friday-e2e-audio");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `mic-${kind}.wav`);
  const samples = kind === "silence" ? speechLike(12, 0, 0.0004) : kind === "quiet" ? speechLike(12, 0.05, 0.0006) : speechLike(12, 0.7, 0.0006);
  writeFileSync(path, wavBuffer(samples));
  return path;
}

/** Chromium switches that route `getUserMedia` to a WAV loop without a permission prompt. */
export const fakeMicArgs = (wavPath: string): string[] => ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${wavPath}`];

/* ── Fake browser-voice gateway (WebSocket) ────────────────────────────────────────────────────────────────────── */

export interface FakeGateway {
  /** The currently connected page socket, if any. */
  socket(): WebSocketRoute | undefined;
  /** Messages the page sent (text frames) and the number of binary capture frames. */
  sent: string[];
  captureFrames(): number;
  /** TTS: `audio_start`, `frames` x 80 ms of PCM, then optionally `audio_end`. Resolves after the frames were sent. */
  speak(options: { frames: number; pcm?: (index: number) => Int16Array; end?: boolean }): Promise<void>;
  send(message: Record<string, unknown>): void;
}

const FRAME_SAMPLES = 1_280;

/** A voiced burst for one 80 ms TTS frame (16 kHz mono PCM, what the Python service sends). */
export function ttsFrame(index: number, loud = true): Int16Array {
  const out = new Int16Array(FRAME_SAMPLES);
  const amplitude = loud ? 9000 : 400;
  for (let i = 0; i < FRAME_SAMPLES; i += 1) {
    const t = (index * FRAME_SAMPLES + i) / 16_000;
    out[i] = Math.round(amplitude * (Math.sin(2 * Math.PI * 180 * t) + 0.5 * Math.sin(2 * Math.PI * 540 * t) + 0.25 * Math.sin(2 * Math.PI * 1500 * t)) / 1.75);
  }
  return out;
}

/** Intercepts `/voice/browser-audio-availability` and the `/voice/browser-audio` WebSocket so the real browser voice path runs without a voice service. */
export async function installFakeGateway(page: Page): Promise<FakeGateway> {
  let current: WebSocketRoute | undefined;
  const sent: string[] = [];
  let frames = 0;
  await page.route("**/api/v1/voice/browser-audio-availability", (route) => route.fulfill({ json: { available: true } }));
  await page.routeWebSocket(/\/api\/v1\/voice\/browser-audio/, (ws) => {
    current = ws;
    ws.onMessage((message) => {
      if (typeof message === "string") sent.push(message);
      else frames += 1;
    });
    ws.onClose(() => {
      if (current === ws) current = undefined;
    });
  });
  const send = (message: Record<string, unknown>): void => current?.send(JSON.stringify(message));
  return {
    socket: () => current,
    sent,
    captureFrames: () => frames,
    send,
    async speak({ frames: count, pcm = (index) => ttsFrame(index), end = true }) {
      send({ type: "audio_start" });
      for (let index = 0; index < count; index += 1) {
        const samples = pcm(index);
        current?.send(Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
      }
      if (end) send({ type: "audio_end" });
    },
  };
}
