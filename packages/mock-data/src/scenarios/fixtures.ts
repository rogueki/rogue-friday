export type AudioFixture = "silence" | "normal" | "loud" | "tts" | "spike";

export const AUDIO_FIXTURES: readonly AudioFixture[] = ["silence", "normal", "loud", "tts", "spike"];

/** 12 Hz sampling, as the orb's audio-reactive halo expects. */
export const AUDIO_HZ = 12;
export const AUDIO_INTERVAL_MS = Math.round(1000 / AUDIO_HZ);

export interface AudioSample {
  level: number;
  peak: number;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * Deterministic audio level fixtures (PLAN §52.3). `t` is the time since the fixture started and `duration` its
 * length, both in ms; the result only depends on those two numbers, so replays are byte-identical.
 */
export function audioFixtureSample(fixture: AudioFixture, t: number, duration: number): AudioSample {
  const syllable = Math.abs(Math.sin((t / 430) * Math.PI));
  const phrase = 0.6 + 0.4 * Math.sin((t / 1300) * Math.PI * 2);
  let level: number;
  switch (fixture) {
    case "silence":
      level = 0.012 + 0.008 * Math.sin(t / 700);
      break;
    case "normal":
      level = 0.18 + 0.32 * syllable * phrase;
      break;
    case "loud":
      level = 0.55 + 0.4 * syllable * (0.7 + 0.3 * Math.sin(t / 310));
      break;
    case "tts":
      level = 0.32 + 0.3 * Math.pow(Math.sin(t / 290), 2) * (0.75 + 0.25 * Math.sin(t / 1700));
      break;
    case "spike": {
      const center = duration * 0.4;
      const distance = t - center;
      level = 0.05 + (distance >= 0 ? Math.exp(-distance / 90) : Math.exp(distance / 25)) * 0.95;
      break;
    }
  }
  const clamped = clamp01(level);
  return { level: Math.round(clamped * 1000) / 1000, peak: Math.round(clamp01(clamped * 1.18 + 0.02) * 1000) / 1000 };
}
