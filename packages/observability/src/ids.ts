const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_LEN = 10;
const RANDOM_LEN = 16;

export const ID_PREFIXES = [
  'task',
  'agent',
  'appr',
  'mem',
  'act',
  'thr',
  'msg',
  'cal',
  'auto',
  'run',
  'rsp',
  'src',
  'fnd',
  'file',
  'ntf',
  'svc',
  'aud',
  'evt',
  'corr',
  'cmd',
] as const;
export type IdPrefix = (typeof ID_PREFIXES)[number];

function encodeTime(ms: number): string {
  if (!Number.isSafeInteger(ms) || ms < 0 || ms > 0xffffffffffff) {
    throw new RangeError(`ULID timestamp out of range: ${ms}`);
  }
  let rest = ms;
  let out = '';
  for (let i = 0; i < TIME_LEN; i += 1) {
    out = CROCKFORD[rest % 32] + out;
    rest = Math.floor(rest / 32);
  }
  return out;
}

/** Increments a base32 digit array in place; returns false on overflow. */
function increment(digits: number[]): boolean {
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    const current = digits[i] ?? 0;
    if (current < 31) {
      digits[i] = current + 1;
      return true;
    }
    digits[i] = 0;
  }
  return false;
}

function digitsToString(digits: readonly number[]): string {
  return digits.map((d) => CROCKFORD[d]).join('');
}

export interface UlidGeneratorOptions {
  /** Millisecond clock. Defaults to `Date.now`. */
  now?: () => number;
  /** Returns `count` uniformly distributed base32 digits (0..31). Defaults to `crypto.getRandomValues`. */
  randomDigits?: (count: number) => number[];
}

function cryptoDigits(count: number): number[] {
  const bytes = new Uint8Array(count);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b & 31);
}

/**
 * Monotonic ULID generator: ids created in the same millisecond (or after a clock step back)
 * are strictly increasing by incrementing the random part.
 */
export function createUlidGenerator(options: UlidGeneratorOptions = {}): () => string {
  const now = options.now ?? Date.now;
  const randomDigits = options.randomDigits ?? cryptoDigits;
  let lastTime = -1;
  let lastRandom: number[] = [];

  return () => {
    let time = now();
    if (time <= lastTime) {
      time = lastTime;
      if (!increment(lastRandom)) {
        // 2^80 ids within one millisecond is not reachable; advance time instead of wrapping.
        time += 1;
        lastRandom = randomDigits(RANDOM_LEN);
      }
    } else {
      lastRandom = randomDigits(RANDOM_LEN);
    }
    lastTime = time;
    return encodeTime(time) + digitsToString(lastRandom);
  };
}

const defaultUlid = createUlidGenerator();

export function ulid(): string {
  return defaultUlid();
}

function normalizePrefix(prefix: string): string {
  return prefix.endsWith('_') ? prefix.slice(0, -1) : prefix;
}

/** `createId('task')` -> `task_01J...` (26-char ULID suffix). */
export function createId(prefix: string): string {
  return `${normalizePrefix(prefix)}_${defaultUlid()}`;
}

export function createCorrelationId(): string {
  return createId('corr');
}

/** Cheap string hash (xmur3) used to turn a textual seed into PRNG state. */
function xmur3(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i += 1) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

/** mulberry32 PRNG returning floats in [0, 1). */
function mulberry32(a: number): () => number {
  let state = a >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SeededIdFactoryOptions {
  /** Fixed base timestamp (ms). Default: 2026-01-01T00:00:00Z so mock ids sort like real ones. */
  baseTime?: number;
  /** Milliseconds added per generated id, keeps ids strictly ordered. Default 1. */
  stepMs?: number;
}

export interface SeededIdFactory {
  (prefix: string): string;
  ulid(): string;
}

/** Deterministic id factory for mocks and tests: same seed -> same id sequence. */
export function createSeededIdFactory(seed: string, options: SeededIdFactoryOptions = {}): SeededIdFactory {
  const rand = mulberry32(xmur3(seed)());
  const baseTime = options.baseTime ?? Date.UTC(2026, 0, 1);
  const stepMs = options.stepMs ?? 1;
  let counter = 0;
  const generate = createUlidGenerator({
    now: () => baseTime + counter * stepMs,
    randomDigits: (count) => Array.from({ length: count }, () => Math.floor(rand() * 32)),
  });
  const nextUlid = (): string => {
    const value = generate();
    counter += 1;
    return value;
  };
  const factory = ((prefix: string) => `${normalizePrefix(prefix)}_${nextUlid()}`) as SeededIdFactory;
  factory.ulid = nextUlid;
  return factory;
}

const ID_PATTERN = /^[a-z]+_[0-9A-HJKMNP-TV-Z]{26}$/;
export function isFridayId(value: string, prefix?: string): boolean {
  if (!ID_PATTERN.test(value)) return false;
  return prefix === undefined || value.startsWith(`${normalizePrefix(prefix)}_`);
}
