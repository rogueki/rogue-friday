import { describe, expect, it, vi } from "vitest";
import type { OrbAudioFrameSource, OrbEventBridge } from "../orbApi";
import type { OrbAudioSink } from "../orbHub";
import { createBrowserVoiceBridge, type AnalyzerRuntime } from "./browserVoiceBridge";

type Call = [string, ...unknown[]];

function setup(options: { failAnalyzer?: boolean; loadError?: Error } = {}) {
  const calls: Call[] = [];
  const recorder = (target: string) => new Proxy({}, { get: (_o, name) => (...args: unknown[]) => { calls.push([`${target}.${String(name)}`, ...args]); } });
  const bridge = recorder("bridge") as OrbEventBridge;
  const audio = recorder("audio") as OrbAudioSink;
  const analysers: (OrbAudioFrameSource & { kind: string; disposed: boolean })[] = [];
  const runtime: AnalyzerRuntime = {
    createAnalyzer: (_context, _source, kind) => {
      if (options.failAnalyzer) throw new Error("no analyser");
      const analyser = { kind, disposed: false, sample: () => undefined, dispose: () => { analyser.disposed = true; } };
      analysers.push(analyser);
      return analyser;
    },
  };
  const errors: unknown[] = [];
  const timers: { callback: () => void; ms: number; cancelled: boolean }[] = [];
  const voice = createBrowserVoiceBridge({
    bridge,
    audio,
    loadRuntime: () => (options.loadError ? Promise.reject(options.loadError) : Promise.resolve(runtime)),
    onError: (error) => errors.push(error),
    setTimer: (callback, ms) => { timers.push({ callback, ms, cancelled: false }); return timers.length - 1; },
    clearTimer: (handle) => { timers[handle as number]!.cancelled = true; },
  });
  const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
  return { voice, calls, analysers, errors, timers, flush };
}
const context = {} as BaseAudioContext;
const node = {} as AudioNode;

describe("microphone", () => {
  it("announces the opened microphone immediately and installs the input analyser afterwards", async () => {
    const { voice, calls, analysers, flush } = setup();
    voice.microphoneOpened(context, node, { passive: false });
    expect(calls.filter(([name]) => name.startsWith("bridge."))).toEqual([["bridge.onMicrophoneOpened", { source: "browser", passive: false }]]);
    await flush();
    expect(analysers.map((a) => a.kind)).toEqual(["input"]);
    expect(calls.at(-1)?.[0]).toBe("audio.setLocalInput");
    expect(calls.at(-1)?.[1]).toBe(analysers[0]);
  });

  it("closing while the orb chunk is still loading never installs a stale analyser", async () => {
    const { voice, calls, analysers, flush } = setup();
    voice.microphoneOpened(context, node, { passive: false });
    voice.microphoneClosed();
    await flush();
    expect(analysers).toHaveLength(0);
    expect(calls.filter(([name]) => name === "audio.setLocalInput").every(([, arg]) => arg === null)).toBe(true);
    expect(calls.at(-1)).toEqual(["bridge.onMicrophoneClosed"]);
  });

  it("closing releases and disposes the analyser", async () => {
    const { voice, analysers, flush } = setup();
    voice.microphoneOpened(context, node, { passive: true });
    await flush();
    voice.microphoneClosed();
    expect(analysers[0]!.disposed).toBe(true);
  });

  it("reports an analyser failure but keeps the lifecycle facts", async () => {
    const { voice, calls, errors, flush } = setup({ failAnalyzer: true });
    voice.microphoneOpened(context, node, { passive: false });
    await flush();
    expect(errors).toHaveLength(1);
    expect(calls.find(([name]) => name.startsWith("bridge."))).toEqual(["bridge.onMicrophoneOpened", { source: "browser", passive: false }]);
  });

  it("reports a failed chunk load", async () => {
    const { voice, errors, flush } = setup({ loadError: new Error("chunk") });
    voice.microphoneOpened(context, node, { passive: false });
    await flush();
    expect(errors).toEqual([new Error("chunk")]);
  });
});

describe("tts", () => {
  it("starts with real analysis once the output analyser is attached, falls back to the envelope before", async () => {
    const early = setup();
    early.voice.attachOutput(context, node);
    early.voice.ttsStarted();
    expect(early.calls.slice(-2)).toEqual([
      ["audio.beginSpeech", { hasAudioAnalysis: false }],
      ["bridge.onTtsStarted", { engine: "browser", hasAudioAnalysis: false }],
    ]);
    const late = setup();
    late.voice.attachOutput(context, node);
    await late.flush();
    late.voice.ttsStarted({ utteranceId: "u" });
    expect(late.calls.slice(-2)).toEqual([
      ["audio.beginSpeech", { hasAudioAnalysis: true }],
      ["bridge.onTtsStarted", { utteranceId: "u", engine: "browser", hasAudioAnalysis: true }],
    ]);
  });

  it("keeps speaking until the already scheduled audio has played, then ends", () => {
    const { voice, calls, timers } = setup();
    voice.ttsStarted();
    voice.ttsFinished(900);
    expect(voice.speaking).toBe(true);
    expect(timers[0]!.ms).toBe(900);
    timers[0]!.callback();
    expect(voice.speaking).toBe(false);
    expect(calls.slice(-2)).toEqual([["audio.endSpeech", false], ["bridge.onTtsEnded", { interrupted: false }]]);
  });

  it("barge-in ends speaking immediately and cancels the pending end", () => {
    const { voice, calls, timers } = setup();
    voice.ttsStarted();
    voice.ttsFinished(900);
    voice.ttsInterrupted();
    expect(voice.speaking).toBe(false);
    expect(timers[0]!.cancelled).toBe(true);
    expect(calls.slice(-2)).toEqual([["audio.endSpeech", true], ["bridge.onTtsEnded", { interrupted: true }]]);
    voice.ttsInterrupted(); // idempotent
    expect(calls.filter(([name]) => name === "bridge.onTtsEnded")).toHaveLength(1);
  });

  it("a new utterance while the previous one drains cancels the pending end", () => {
    const { voice, timers } = setup();
    voice.ttsStarted();
    voice.ttsFinished(500);
    voice.ttsStarted();
    expect(timers[0]!.cancelled).toBe(true);
    expect(voice.speaking).toBe(true);
  });

  it("nothing left to play ends right away", () => {
    const { voice, calls } = setup();
    voice.ttsStarted();
    voice.ttsFinished(0);
    expect(calls.at(-1)).toEqual(["bridge.onTtsEnded", { interrupted: false }]);
  });

  it("dispose ends speech as interrupted and releases both analysers", async () => {
    const { voice, analysers, flush, calls } = setup();
    voice.microphoneOpened(context, node, { passive: false });
    voice.attachOutput(context, node);
    await flush();
    voice.ttsStarted();
    voice.dispose();
    expect(analysers.every((a) => a.disposed)).toBe(true);
    expect(calls.filter(([name]) => name === "bridge.onTtsEnded").at(-1)).toEqual(["bridge.onTtsEnded", { interrupted: true }]);
    expect(vi.isMockFunction(voice.dispose)).toBe(false);
  });
});
