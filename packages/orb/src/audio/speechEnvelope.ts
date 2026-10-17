import type { OrbAudioFrame, OrbAudioFrameSource } from "../controller/types";
import { mulberry32 } from "../scene/rng";
import { clamp01, noise1 } from "./frame";

export interface SpeechEnvelopeOptions {
  seed?: number;
  /** Overall loudness 0..1 (default 0.85). */
  intensity?: number;
}

export interface SpeechEnvelopeSource extends OrbAudioFrameSource {
  start(nowMs?: number): void;
  /** `interrupted` = barge-in: the envelope is gone within ~120 ms instead of releasing over ~300 ms. */
  stop(interrupted?: boolean, nowMs?: number): void;
  readonly running: boolean;
}

const monotonicNow = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

type SegmentKind = 0 | 1 | 2; // syllable | word gap | sentence pause
const SYLLABLE = 0;
const WORD_GAP = 1;
const SENTENCE_PAUSE = 2;

const SYLLABLE_MIN_MS = 140;
const SYLLABLE_MAX_MS = 260;
const RELEASE_MS = 300;
const BARGE_IN_MS = 120;
const ATTACK_MS = 60;

/**
 * Speech-envelope fallback for TTS without audio analysis: a syllable model, not a periodic wave. Syllables last 140-260 ms
 * (log-uniform), form words of 2-6 syllables separated by 60-140 ms gaps, sentences of 8-20 syllables end with a 350-700 ms
 * pause; every syllable gets its own intensity and a vowel/fricative character that drives the low/mid/high split.
 * Deterministic for a given seed and independent of how often it is sampled.
 */
export function createSpeechEnvelopeSource(options: SpeechEnvelopeOptions = {}): SpeechEnvelopeSource {
  const seed = options.seed ?? 20260617;
  const intensity = clamp01(options.intensity ?? 0.85);
  let rand = mulberry32(seed);

  let running = false;
  let startMs = 0;
  let stopAt = -1; // seconds relative to start, -1 = not stopping
  let releaseSec = RELEASE_MS / 1000;
  let disposed = false;

  // current segment (seconds relative to start)
  let segKind: SegmentKind = SYLLABLE;
  let segStart = 0;
  let segEnd = 0;
  let segAmp = 0;
  let segVowel = 0.5;
  let segFric = 0;
  let wordCount = 0;
  let wordTarget = 3;
  let sentenceCount = 0;
  let sentenceTarget = 12;
  let sentenceGain = 1;

  const range = (lo: number, hi: number): number => lo + (hi - lo) * rand();

  function newSyllable(from: number): void {
    segKind = SYLLABLE;
    segStart = from;
    const dur = (SYLLABLE_MIN_MS * Math.exp(rand() * Math.log(SYLLABLE_MAX_MS / SYLLABLE_MIN_MS))) / 1000;
    segEnd = from + dur;
    segAmp = clamp01(sentenceGain * (0.35 + 0.65 * Math.pow(rand(), 0.8)));
    segVowel = rand();
    segFric = rand() < 0.3 ? range(0.5, 1) : range(0, 0.35);
  }

  function newSentence(): void {
    sentenceCount = 0;
    sentenceTarget = 8 + Math.floor(rand() * 13);
    sentenceGain = range(0.72, 1);
  }

  function resetModel(): void {
    rand = mulberry32(seed);
    wordCount = 0;
    wordTarget = 2 + Math.floor(rand() * 5);
    newSentence();
    newSyllable(0);
  }

  function advanceSegment(): void {
    const from = segEnd;
    if (segKind === SYLLABLE) {
      wordCount += 1;
      sentenceCount += 1;
      if (sentenceCount >= sentenceTarget) {
        segKind = SENTENCE_PAUSE;
        segStart = from;
        segEnd = from + range(0.35, 0.7);
        wordCount = 0;
        wordTarget = 2 + Math.floor(rand() * 5);
        newSentence();
        segAmp = 0;
        return;
      }
      if (wordCount >= wordTarget) {
        segKind = WORD_GAP;
        segStart = from;
        segEnd = from + range(0.06, 0.14);
        wordCount = 0;
        wordTarget = 2 + Math.floor(rand() * 5);
        segAmp = 0;
        return;
      }
    }
    newSyllable(from);
  }

  resetModel();

  return {
    get running() {
      return running;
    },
    start(nowMs = monotonicNow()) {
      if (disposed) return;
      running = true;
      startMs = nowMs;
      stopAt = -1;
      resetModel();
    },
    stop(interrupted = false, nowMs = monotonicNow()) {
      if (!running || stopAt >= 0) {
        if (interrupted && stopAt >= 0) releaseSec = Math.min(releaseSec, BARGE_IN_MS / 1000);
        return;
      }
      stopAt = Math.max(0, (nowMs - startMs) / 1000);
      releaseSec = (interrupted ? BARGE_IN_MS : RELEASE_MS) / 1000;
    },
    sample(nowMs, out: OrbAudioFrame) {
      if (!running || disposed) {
        out.rms = out.peak = out.low = out.mid = out.high = 0;
        out.gateOpen = false;
        out.source = "synthetic";
        out.bandsDerived = false;
        return;
      }
      const t = Math.max(0, (nowMs - startMs) / 1000);
      let guard = 0;
      while (t >= segEnd && guard++ < 64) advanceSegment();

      let env = 0;
      let burst = 0;
      if (segKind === SYLLABLE) {
        const dur = segEnd - segStart;
        const u = Math.min(1, Math.max(0, (t - segStart) / dur));
        const skewed = Math.pow(u, 0.8);
        env = segAmp * (0.5 - 0.5 * Math.cos(skewed * Math.PI * 2));
        const sinceStart = t - segStart;
        if (sinceStart < 0.045) burst = segFric * (1 - sinceStart / 0.045);
      }
      env *= 0.9 + 0.2 * noise1(t * 26, 5);

      // attack at the start of the utterance and release / barge-in cut after stop
      let gain = Math.min(1, t / (ATTACK_MS / 1000));
      if (stopAt >= 0) {
        const since = t - stopAt;
        gain *= Math.max(0, 1 - since / releaseSec);
        if (since >= releaseSec) running = false;
      }
      env = clamp01(env * gain * intensity);

      out.rms = env;
      out.peak = clamp01(env * 1.12 + burst * 0.25 * gain);
      out.low = clamp01(env * (0.45 + 0.55 * segVowel));
      out.mid = clamp01(env * (0.62 + 0.38 * (1 - Math.abs(segVowel - 0.5) * 2)));
      out.high = clamp01(env * (0.16 + 0.5 * segFric) + burst * 0.75 * gain * intensity);
      out.gateOpen = env > 0.05;
      out.source = "synthetic";
      out.bandsDerived = false;
    },
    dispose() {
      disposed = true;
      running = false;
    },
  };
}
