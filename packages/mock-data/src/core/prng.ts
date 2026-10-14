/** FNV-1a (32 bit) over UTF-16 code units; stable across platforms. */
export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Combines integers into a well-mixed 32 bit value (murmur3 finalizer style). */
export function mixInts(...values: number[]): number {
  let h = 0x9e3779b9;
  for (const value of values) {
    h ^= value | 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

/** mulberry32 step: returns [value in [0,1), nextState]. Pure, so the state is trivially serializable. */
export function mulberry32Step(state: number): [number, number] {
  const next = (state + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

/** Seeded PRNG with a serializable state (one uint32). */
export class Rng {
  private current: number;

  constructor(seed: number) {
    this.current = seed >>> 0;
  }

  get state(): number {
    return this.current;
  }

  set state(value: number) {
    this.current = value >>> 0;
  }

  /** Float in [0, 1). */
  next(): number {
    const [value, next] = mulberry32Step(this.current);
    this.current = next;
    return value;
  }

  /** Integer in [min, max] (inclusive). */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("Rng.pick: empty list");
    return items[Math.floor(this.next() * items.length)] as T;
  }

  pickMany<T>(items: readonly T[], count: number): T[] {
    return this.shuffle(items).slice(0, count);
  }

  shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const a = copy[i] as T;
      copy[i] = copy[j] as T;
      copy[j] = a;
    }
    return copy;
  }

  weighted<T>(entries: readonly (readonly [T, number])[]): T {
    const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
    let roll = this.next() * total;
    for (const [value, weight] of entries) {
      roll -= weight;
      if (roll < 0) return value;
    }
    return (entries[entries.length - 1] as readonly [T, number])[0];
  }

  /** Independent child stream; the parent state is not advanced. */
  fork(label: string): Rng {
    return new Rng(mixInts(this.current, hashString(label)));
  }
}
