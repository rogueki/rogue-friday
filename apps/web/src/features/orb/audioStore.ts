"use client";

import { useEffect, useState } from "react";

/**
 * Audio level feed for the orb, the voice panel and the command bar.
 * `friday.voice.audio_level` events arrive at 20-60 Hz; they are written here WITHOUT touching React state. Consumers
 * sample the store at a bounded rate (`useAudioSamples`), so only the small waveform/orb subtree re-renders and the
 * page never re-renders per event.
 */

export type AudioDirection = "input" | "output";

const RING_SIZE = 48;
/** A level older than this counts as silence (the event stream stops while nobody speaks). */
const STALE_AFTER_MS = 600;

interface AudioState {
  ring: number[];
  version: number;
  updatedAt: number;
  direction: AudioDirection;
  level: number;
}

const state: AudioState = { ring: new Array<number>(RING_SIZE).fill(0), version: 0, updatedAt: 0, direction: "input", level: 0 };

export function pushAudioLevel(direction: AudioDirection, level: number, now: number = Date.now()): void {
  const clamped = Math.min(1, Math.max(0, level));
  state.ring.shift();
  state.ring.push(clamped);
  state.direction = direction;
  state.level = clamped;
  state.updatedAt = now;
  state.version += 1;
}

export function resetAudioLevels(): void {
  state.ring.fill(0);
  state.level = 0;
  state.updatedAt = 0;
  state.version += 1;
}

export interface AudioSample {
  /** Current level 0..1, decays to 0 when events stop. */
  level: number;
  /** Last RING_SIZE levels, oldest first. */
  levels: readonly number[];
  direction: AudioDirection;
}

const SILENT: AudioSample = { level: 0, levels: new Array<number>(RING_SIZE).fill(0), direction: "input" };

export function readAudioSample(now: number = Date.now()): AudioSample {
  if (state.updatedAt === 0 || now - state.updatedAt > STALE_AFTER_MS) return { ...SILENT, direction: state.direction };
  return { level: state.level, levels: state.ring.slice(), direction: state.direction };
}

/**
 * Cheap per-frame read for the orb (`getAudioLevel`): no allocation, decays to 0 when events stop. Called from the orb's
 * animation loop, so the level reaches the scene at display rate without any React update.
 */
export function readAudioLevel(now: number = Date.now()): number {
  return state.updatedAt === 0 || now - state.updatedAt > STALE_AFTER_MS ? 0 : state.level;
}

/**
 * Samples the store at most `maxHz` times per second while `active`. State is only set when the store changed (or just
 * went silent), so an idle stream causes no renders at all.
 */
export function useAudioSamples(active: boolean, maxHz = 12): AudioSample {
  const [sample, setSample] = useState<AudioSample>(SILENT);
  useEffect(() => {
    if (!active) {
      setSample((previous) => (previous.level === 0 ? previous : SILENT));
      return;
    }
    let lastVersion = -1;
    let wasSilent = true;
    const id = window.setInterval(() => {
      const next = readAudioSample();
      const silent = next.level === 0;
      if (state.version === lastVersion && silent === wasSilent) return;
      lastVersion = state.version;
      wasSilent = silent;
      setSample(next);
    }, Math.round(1000 / maxHz));
    return () => window.clearInterval(id);
  }, [active, maxHz]);
  return sample;
}
