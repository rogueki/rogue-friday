import { afterEach, describe, expect, it, vi } from "vitest";

type Call = [string, ...unknown[]];
const calls: Call[] = [];
const analyzers: { kind: string; context: unknown; source: unknown }[] = [];

vi.mock("@/features/orb/orbHub", () => {
  const recorder = (target: string) => new Proxy({}, { get: (_o, name) => (...args: unknown[]) => { calls.push([`${target}.${String(name)}`, ...args]); } });
  return {
    orbBridgeHandle: { proxy: recorder("bridge") },
    orbAudioHandle: { proxy: recorder("audio") },
    loadOrbRuntime: async () => ({
      createAnalyzer: (context: unknown, source: unknown, kind: string) => {
        analyzers.push({ kind, context, source });
        return { sample: () => undefined, dispose: () => undefined };
      },
    }),
  };
});

const { browserAudio, setBrowserAudioPassiveProbe } = await import("./browserAudio");

class FakeSocket {
  static OPEN = 1;
  static latest: FakeSocket;
  readyState = 0;
  bufferedAmount = 0;
  binaryType = "";
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  constructor() { FakeSocket.latest = this; queueMicrotask(() => { this.readyState = 1; this.onopen?.(); }); }
  send() {}
  close() { this.readyState = 3; queueMicrotask(() => this.onclose?.()); }
}
class FakeContext {
  static latest: FakeContext;
  sampleRate = 48_000;
  currentTime = 0;
  destination = { name: "destination" };
  gains: { connectedTo: unknown[] }[] = [];
  bufferSources: { connectedTo: unknown }[] = [];
  audioWorklet = { addModule: async () => {} };
  constructor() { FakeContext.latest = this; }
  resume = async () => {};
  close = async () => {};
  createMediaStreamSource() { return { name: "mic", connect: (node: unknown) => node }; }
  createGain() {
    const gain = { gain: { value: 0 }, connectedTo: [] as unknown[], connect(node: unknown) { gain.connectedTo.push(node); return node; } };
    this.gains.push(gain);
    return gain;
  }
  createBuffer(_channels: number, length: number) { return { duration: length / 16_000, getChannelData: () => new Float32Array(length) }; }
  createBufferSource() {
    const source = { connectedTo: undefined as unknown, buffer: null, onended: null, connect(node: unknown) { source.connectedTo = node; }, start() {}, stop() {} };
    this.bufferSources.push(source);
    return source;
  }
}
class FakeWorklet {
  port = { onmessage: null };
  connect(node: unknown) { return node; }
  disconnect() {}
}

async function open(): Promise<void> {
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("AudioContext", FakeContext);
  vi.stubGlobal("AudioWorkletNode", FakeWorklet);
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop: vi.fn() }] }) } });
  await browserAudio.start();
  await new Promise((resolve) => setTimeout(resolve, 0));
}
const message = (value: unknown): void => FakeSocket.latest.onmessage?.({ data: JSON.stringify(value) });
const names = (): string[] => calls.map(([name]) => name);

afterEach(() => {
  browserAudio.stop();
  calls.length = 0;
  analyzers.length = 0;
  setBrowserAudioPassiveProbe(() => false);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("browser audio -> orb taps", () => {
  it("opening the microphone announces it, taps the stream with an input analyser and routes TTS through the output bus", async () => {
    await open();
    expect(calls).toContainEqual(["audio.setLocalInput", null]);
    expect(calls).toContainEqual(["bridge.onMicrophoneOpened", { source: "browser", passive: false }]);
    expect(analyzers.map((a) => a.kind).sort()).toEqual(["input", "output"]);
    const context = FakeContext.latest;
    const bus = context.gains.find((gain) => gain.connectedTo.includes(context.destination));
    expect(bus, "output bus connected to the destination").toBeDefined();
    expect(analyzers.find((a) => a.kind === "output")?.source).toBe(bus);
    // A PCM frame is played through the bus (not straight into the destination), so the analyser sees it and playback stays unblocked.
    FakeSocket.latest.onmessage?.({ data: new ArrayBuffer(2_560) });
    expect(context.bufferSources.at(-1)?.connectedTo).toBe(bus);
  });

  it("uses the passive probe: a wake word armed microphone is announced as passive", async () => {
    setBrowserAudioPassiveProbe(() => true);
    await open();
    expect(calls).toContainEqual(["bridge.onMicrophoneOpened", { source: "browser", passive: true }]);
  });
});

describe("browser audio -> orb TTS lifecycle", () => {
  it("audio_start -> speaking; audio_end ends after the queued audio drained; clear interrupts at once", async () => {
    await open();
    const context = FakeContext.latest;
    calls.length = 0;
    message({ type: "audio_start" });
    expect(names()).toEqual(["audio.beginSpeech", "bridge.onTtsStarted"]);
    FakeSocket.latest.onmessage?.({ data: new ArrayBuffer(2_560) }); // 80 ms scheduled
    FakeSocket.latest.onmessage?.({ data: new ArrayBuffer(2_560) });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    calls.length = 0;
    context.currentTime = 0;
    message({ type: "audio_end" });
    expect(names(), "still speaking while audio is queued").toEqual([]);
    vi.advanceTimersByTime(1_000);
    expect(calls).toEqual([["audio.endSpeech", false], ["bridge.onTtsEnded", { interrupted: false }]]);

    calls.length = 0;
    message({ type: "audio_start" });
    calls.length = 0;
    message({ type: "clear" });
    expect(calls).toEqual([["audio.endSpeech", true], ["bridge.onTtsEnded", { interrupted: true }]]);
  });

  it("stop() (Stop button / barge-in by the user) ends speaking and closes the microphone", async () => {
    await open();
    message({ type: "audio_start" });
    calls.length = 0;
    browserAudio.stop();
    expect(names()).toContain("bridge.onTtsEnded");
    expect(calls.find(([name]) => name === "bridge.onTtsEnded")).toEqual(["bridge.onTtsEnded", { interrupted: true }]);
    expect(names()).toContain("bridge.onMicrophoneClosed");
  });

  it("pause closes the microphone fact and interrupts speech; resume reopens it", async () => {
    await open();
    message({ type: "audio_start" });
    calls.length = 0;
    browserAudio.pause();
    expect(names()).toEqual(expect.arrayContaining(["bridge.onTtsEnded", "bridge.onMicrophoneClosed"]));
    calls.length = 0;
    browserAudio.resume();
    expect(calls).toContainEqual(["bridge.onMicrophoneOpened", { source: "browser", passive: false }]);
  });
});
