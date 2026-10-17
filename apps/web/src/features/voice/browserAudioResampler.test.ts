import { describe, expect, it } from "vitest";
import { BrowserAudioResampler } from "./browserAudioResampler";

const sine = (hz: number, sampleRate: number, count: number) =>
  Float32Array.from({ length: count }, (_, i) => Math.sin(2 * Math.PI * hz * i / sampleRate));
const rms = (samples: number[]) => Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);

describe("browser PCM downsampling", () => {
  it("keeps 1 kHz speech energy while attenuating a 12 kHz alias at 48 kHz", () => {
    const low = new BrowserAudioResampler(48_000).push(sine(1_000, 48_000, 4_800));
    const high = new BrowserAudioResampler(48_000).push(sine(12_000, 48_000, 4_800));
    expect(low).toHaveLength(1_600);
    expect(rms(low)).toBeGreaterThan(0.65);
    expect(rms(high)).toBeLessThan(rms(low) * 0.4);
  });

  it("preserves phase and output count across small 44.1 kHz worklet chunks", () => {
    const source = sine(700, 44_100, 4_410);
    const whole = new BrowserAudioResampler(44_100).push(source);
    const streaming = new BrowserAudioResampler(44_100);
    const chunks: number[] = [];
    for (let i = 0; i < source.length; i += 128) chunks.push(...streaming.push(source.slice(i, i + 128)));
    expect(chunks.length).toBeGreaterThanOrEqual(1_599);
    expect(chunks.length).toBeLessThanOrEqual(1_600);
    expect(chunks).toEqual(whole);
  });
});
