import type { Actor, AdapterCategory, SourceDescriptor } from "@jarvis/sdk";
import { adapterIdFor } from "../core/constants";
import type { IdFactory } from "../core/ids";
import type { Rng } from "../core/prng";

export interface SeedSizes {
  tasks: number;
  activity: number;
  agents: number;
  memory: number;
  threads: number;
  files: number;
  notifications: number;
  audit: number;
}

/** Everything a generator needs; all randomness and ids flow through here so a seed reproduces the world exactly. */
export interface SeedContext {
  readonly seed: number;
  readonly rng: Rng;
  readonly ids: IdFactory;
  /** Epoch ms of "now" at build time. */
  readonly now: number;
  readonly sizes: SeedSizes;
  readonly owner: Actor;
  /** ISO timestamp at `now + offsetMs` (negative = past). */
  at(offsetMs: number): string;
  src(category: AdapterCategory, externalId?: string): SourceDescriptor;
  id(prefix: string): string;
}

export function createSeedContext(
  seed: number,
  rng: Rng,
  ids: IdFactory,
  now: number,
  sizes: SeedSizes,
): SeedContext {
  const owner: Actor = { type: "user", id: ids.fixed("usr", 1), name: "Erik" };
  return {
    seed,
    rng,
    ids,
    now,
    sizes,
    owner,
    at: (offsetMs) => new Date(now + offsetMs).toISOString(),
    src: (category, externalId) => ({
      adapterId: adapterIdFor(category),
      system: "mock",
      ...(externalId ? { externalId } : {}),
      lastSyncedAt: new Date(now - 45_000).toISOString(),
    }),
    id: (prefix) => ids.next(prefix),
  };
}

export const MIN = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
