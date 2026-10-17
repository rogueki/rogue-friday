import { describe, expect, it } from "vitest";
import type { OrbAudioFrame, OrbAudioFrameSource, OrbController } from "../orbApi";
import { createOrbAudioSources, SERVICE_LEVEL_FRESH_MS, type AudioSourceFactories, type SpeechEnvelopeSource } from "./audioSources";

const frame = (): OrbAudioFrame => ({ rms: 0, peak: 0, low: 0, mid: 0, high: 0, gateOpen: false, source: "none" });

function setup() {
  const installed: { input: OrbAudioFrameSource | null; output: OrbAudioFrameSource | null } = { input: null, output: null };
  const controller = {
    setInputAudioSource: (source: OrbAudioFrameSource | null) => { installed.input = source; },
    setOutputAudioSource: (source: OrbAudioFrameSource | null) => { installed.output = source; },
  } as unknown as OrbController;
  const envelopes: (SpeechEnvelopeSource & { stopped: boolean[]; disposed: boolean; value: number })[] = [];
  const services: { pushed: unknown[]; lastPushAt: number; value: number }[] = [];
  const factories: AudioSourceFactories = {
    createServiceLevelSource: () => {
      const state = { pushed: [] as unknown[], lastPushAt: Number.NEGATIVE_INFINITY, value: 0 };
      services.push(state);
      return {
        get lastPushAt() { return state.lastPushAt; },
        push: (level, nowMs = 0) => { state.pushed.push(level); state.lastPushAt = nowMs; state.value = typeof level === "number" ? level : (level.level ?? 0); },
        sample: (_now, out) => { out.rms = state.value; out.source = "service-level"; },
        dispose: () => undefined,
      };
    },
    createSpeechEnvelopeSource: () => {
      const envelope = {
        stopped: [] as boolean[],
        disposed: false,
        value: 0.8,
        start: () => undefined,
        stop: (interrupted?: boolean) => { envelope.stopped.push(Boolean(interrupted)); },
        sample: (_now: number, out: OrbAudioFrame) => { Object.assign(out, { rms: envelope.value, peak: envelope.value, low: envelope.value, mid: envelope.value, high: envelope.value, gateOpen: true, source: "synthetic" }); },
        dispose: () => { envelope.disposed = true; },
      };
      envelopes.push(envelope);
      return envelope;
    },
  };
  return { sources: createOrbAudioSources(controller, factories), installed, envelopes, services };
}

describe("input channel", () => {
  it("is empty until a service level or a local analyser exists; the local analyser wins", () => {
    const { sources, installed, services } = setup();
    expect(installed.input).toBeNull();
    sources.pushServiceInput(0.3);
    expect(installed.input).not.toBeNull();
    expect(services[0]!.pushed).toEqual([0.3]);
    const analyser: OrbAudioFrameSource = { sample: () => undefined, dispose: () => undefined };
    sources.setLocalInput(analyser);
    expect(installed.input).toBe(analyser);
    expect(sources.hasLocalInput).toBe(true);
    sources.setLocalInput(null);
    expect(installed.input).not.toBe(analyser); // falls back to the service level
  });
});

describe("output channel and the speech-envelope fallback", () => {
  it("uses the envelope without a local output analyser and removes it when speech ends", () => {
    const { sources, installed, envelopes } = setup();
    sources.beginSpeech({ hasAudioAnalysis: false });
    expect(sources.speechFallbackActive).toBe(true);
    expect(installed.output).not.toBeNull();
    sources.endSpeech(true);
    expect(envelopes[0]!.stopped).toEqual([true]);
    expect(envelopes[0]!.disposed).toBe(true);
    expect(installed.output).toBeNull();
    expect(sources.speechFallbackActive).toBe(false);
  });

  it("does not start a simulated envelope when a real output analyser reports analysis", () => {
    const { sources, installed, envelopes } = setup();
    const analyser: OrbAudioFrameSource = { sample: () => undefined, dispose: () => undefined };
    sources.setLocalOutput(analyser);
    sources.beginSpeech({ hasAudioAnalysis: true });
    expect(envelopes).toHaveLength(0);
    expect(installed.output).toBe(analyser);
  });

  it("a real analyser that appears mid-utterance replaces the envelope immediately", () => {
    const { sources, installed, envelopes } = setup();
    sources.beginSpeech({ hasAudioAnalysis: false });
    const analyser: OrbAudioFrameSource = { sample: () => undefined, dispose: () => undefined };
    sources.setLocalOutput(analyser);
    expect(envelopes[0]!.disposed).toBe(true);
    expect(installed.output).toBe(analyser);
  });

  it("scales the envelope by a fresh service level: silence darkens it, loud lifts it, stale levels are ignored", () => {
    const { sources, installed, envelopes } = setup();
    sources.beginSpeech({ hasAudioAnalysis: false });
    envelopes[0]!.value = 1;
    const out = frame();
    installed.output!.sample(1_000, out);
    expect(out.rms).toBe(1); // no service level yet: pure envelope
    sources.pushServiceOutput({ level: 0 }); // pushed at "0" in this fake clock
    installed.output!.sample(100, out);
    expect(out.rms).toBeCloseTo(0.2);
    sources.pushServiceOutput({ level: 0.5 });
    installed.output!.sample(100, out);
    expect(out.rms).toBeCloseTo(0.4 + 0.6 * 0.8);
    installed.output!.sample(SERVICE_LEVEL_FRESH_MS + 1, out);
    expect(out.rms).toBe(1);
  });

  it("reset forgets transient sources but keeps local analysers", () => {
    const { sources, installed } = setup();
    const analyser: OrbAudioFrameSource = { sample: () => undefined, dispose: () => undefined };
    sources.setLocalInput(analyser);
    sources.pushServiceOutput(0.5);
    sources.beginSpeech({ hasAudioAnalysis: false });
    sources.reset();
    expect(installed.input).toBe(analyser);
    expect(installed.output).toBeNull();
    sources.dispose();
    expect(installed.input).toBeNull();
  });
});
