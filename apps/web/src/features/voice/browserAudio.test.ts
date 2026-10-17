import { afterEach, describe, expect, it, vi } from "vitest";
import { browserAudio } from "./browserAudio";

class FakeSocket {
  static OPEN = 1;
  static latest: FakeSocket;
  readyState = 0;
  bufferedAmount = 0;
  binaryType = "";
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  sent: string[] = [];
  constructor() { FakeSocket.latest = this; queueMicrotask(() => { this.readyState = 1; this.onopen?.(); }); }
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = 3; queueMicrotask(() => this.onclose?.()); }
}

class FakeContext {
  sampleRate = 48_000;
  currentTime = 0;
  destination = {};
  audioWorklet = { addModule: async () => {} };
  resume = async () => {};
  close = async () => {};
  createMediaStreamSource() { return { connect: (node: unknown) => node }; }
  createGain() { return { gain: { value: 0 }, connect: (node: unknown) => node }; }
}

class FakeWorklet {
  port = { onmessage: null };
  connect(node: unknown) { return node; }
  disconnect() {}
}

afterEach(() => { browserAudio.stop(); vi.unstubAllGlobals(); });

describe("browser audio lifecycle", () => {
  it("does not report an error after deliberate Stop and reflects speaking/status frames", async () => {
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.stubGlobal("AudioContext", FakeContext);
    vi.stubGlobal("AudioWorkletNode", FakeWorklet);
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop: vi.fn() }] }) } });
    await browserAudio.start();
    expect(browserAudio.snapshot()).toMatchObject({ active: true, speaking: false, paused: false });
    // A Python status frame and TTS frames drive the visible state.
    FakeSocket.latest.onmessage?.({ data: '{"type":"audio_start"}' });
    expect(browserAudio.snapshot().speaking).toBe(true);
    FakeSocket.latest.onmessage?.({ data: '{"type":"audio_end"}' });
    expect(browserAudio.snapshot().speaking).toBe(false);
    FakeSocket.latest.onmessage?.({ data: '{"type":"status","state":"paused"}' });
    expect(browserAudio.snapshot().paused).toBe(true);
    browserAudio.stop();
    await Promise.resolve();
    expect(browserAudio.snapshot()).toMatchObject({ active: false, error: null });
  });

  it("reports an unexpected transport close", async () => {
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.stubGlobal("AudioContext", FakeContext);
    vi.stubGlobal("AudioWorkletNode", FakeWorklet);
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop: vi.fn() }] }) } });
    await browserAudio.start();
    FakeSocket.latest.close();
    await Promise.resolve();
    expect(browserAudio.snapshot()).toMatchObject({ active: false, error: "Sprachverbindung beendet." });
  });
});
