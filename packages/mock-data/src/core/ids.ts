import { hashString, mixInts, mulberry32Step } from "./prng";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeTime(value: number, length: number): string {
  let rest = Math.floor(value);
  let out = "";
  for (let i = 0; i < length; i++) {
    out = CROCKFORD[rest % 32] + out;
    rest = Math.floor(rest / 32);
  }
  return out;
}

/**
 * Deterministic ULID-like ids: `<prefix>_` + 10 chars (monotonic counter on a fixed epoch, sortable per prefix)
 * + 16 chars derived from seed + prefix + counter. Same seed and call order give the same ids.
 */
export class IdFactory {
  private counters: Record<string, number> = {};

  constructor(
    private readonly seed: number,
    private readonly epochMs: number,
  ) {}

  next(prefix: string): string {
    const counter = (this.counters[prefix] ?? 0) + 1;
    this.counters[prefix] = counter;
    return `${prefix}_${this.suffix(prefix, counter)}`;
  }

  /** Id for a fixed ordinal, independent of call order (used for curated seed objects). */
  fixed(prefix: string, ordinal: number): string {
    return `${prefix}_${this.suffix(prefix, ordinal + 0x100000)}`;
  }

  getCounters(): Record<string, number> {
    return { ...this.counters };
  }

  setCounters(counters: Record<string, number>): void {
    this.counters = { ...counters };
  }

  private suffix(prefix: string, counter: number): string {
    let state = mixInts(this.seed, hashString(prefix), counter);
    let random = "";
    for (let i = 0; i < 16; i++) {
      const [value, next] = mulberry32Step(state);
      state = next;
      random += CROCKFORD[Math.floor(value * 32)];
    }
    return encodeTime(this.epochMs + counter, 10) + random;
  }
}

export const ID_PREFIXES = {
  task: "task",
  agent: "agent",
  approval: "appr",
  memory: "mem",
  activity: "act",
  thread: "thr",
  message: "msg",
  draft: "draft",
  channel: "chan",
  calendar: "cal",
  conflict: "conf",
  briefing: "brief",
  proposal: "prop",
  automation: "auto",
  run: "run",
  research: "rsp",
  source: "src",
  finding: "fnd",
  artifact: "art",
  file: "file",
  notification: "ntf",
  service: "svc",
  audit: "aud",
  event: "evt",
  correlation: "corr",
  command: "cmd",
  step: "step",
  toolCall: "tcall",
  user: "usr",
  model: "mdl",
  volume: "vol",
  voiceDevice: "vdev",
  voiceProfile: "vprof",
} as const;
