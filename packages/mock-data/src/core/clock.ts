export interface TimerHandle {
  readonly id: number;
  cancel(): void;
}

interface Timer {
  id: number;
  due: number;
  seq: number;
  fn: () => void;
  /** Repeat interval in ms; undefined for one-shot timers. */
  every?: number;
}

export interface RealTimeOptions {
  /** Simulated milliseconds per wall-clock millisecond. */
  speed?: number;
  /** Wall-clock tick interval. */
  tickMs?: number;
}

/**
 * Controllable clock. Time only moves via `advance`/`setTime` or, in real-time mode, with the wall clock.
 * All mock timers (approval expiry, escalation chains, scenarios, latency) are scheduled here.
 */
export class MockClock {
  private nowMs: number;
  private readonly startMs: number;
  private timers: Timer[] = [];
  private nextTimerId = 1;
  private nextSeq = 1;
  private realTimeHandle: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(startIso: string) {
    const parsed = Date.parse(startIso);
    if (Number.isNaN(parsed)) throw new Error(`MockClock: invalid start time ${startIso}`);
    this.nowMs = parsed;
    this.startMs = parsed;
  }

  now(): number {
    return this.nowMs;
  }

  nowIso(): string {
    return new Date(this.nowMs).toISOString();
  }

  isoAt(offsetMs: number): string {
    return new Date(this.nowMs + offsetMs).toISOString();
  }

  /** Milliseconds the clock has moved since construction (ScenarioState.clockOffsetMs). */
  get offsetMs(): number {
    return this.nowMs - this.startMs;
  }

  get pendingTimers(): number {
    return this.timers.length;
  }

  get isRealTime(): boolean {
    return this.realTimeHandle !== null;
  }

  setTimeout(fn: () => void, delayMs: number): TimerHandle {
    return this.addTimer(fn, Math.max(0, delayMs));
  }

  setInterval(fn: () => void, intervalMs: number): TimerHandle {
    const every = Math.max(1, intervalMs);
    return this.addTimer(fn, every, every);
  }

  /** Moves the clock forward and runs all timers that become due, in order. Returns the number of timers fired. */
  advance(ms: number): number {
    if (ms < 0) throw new Error("MockClock.advance: negative duration");
    return this.advanceTo(this.nowMs + ms);
  }

  /** Jumps to an absolute time. Moving backwards does not fire timers and keeps their absolute due times. */
  setTime(iso: string): number {
    const target = Date.parse(iso);
    if (Number.isNaN(target)) throw new Error(`MockClock.setTime: invalid time ${iso}`);
    if (target < this.nowMs) {
      this.nowMs = target;
      return 0;
    }
    return this.advanceTo(target);
  }

  /** Runs timers until none are due within `horizonMs` (guards against infinite interval loops). */
  runPending(horizonMs: number): number {
    return this.advance(horizonMs);
  }

  clearTimers(): void {
    this.timers = [];
  }

  /** Real-time mode for dev: the clock follows the wall clock (optionally scaled). */
  startRealTime(options: RealTimeOptions = {}): void {
    if (this.realTimeHandle) return;
    const speed = options.speed ?? 1;
    const tickMs = options.tickMs ?? 100;
    let last = performance.now();
    this.realTimeHandle = setInterval(() => {
      const current = performance.now();
      const elapsed = (current - last) * speed;
      last = current;
      if (elapsed > 0) this.advance(Math.round(elapsed));
    }, tickMs);
    // Do not keep a Node process alive just for the dev clock.
    (this.realTimeHandle as { unref?: () => void }).unref?.();
  }

  stopRealTime(): void {
    if (this.realTimeHandle) clearInterval(this.realTimeHandle);
    this.realTimeHandle = null;
  }

  /** Restores the absolute time (timers are owned by their creators and rescheduled on restore). */
  restore(nowMs: number): void {
    this.nowMs = nowMs;
    this.timers = [];
  }

  private addTimer(fn: () => void, delayMs: number, every?: number): TimerHandle {
    const timer: Timer = {
      id: this.nextTimerId++,
      due: this.nowMs + delayMs,
      seq: this.nextSeq++,
      fn,
      ...(every !== undefined ? { every } : {}),
    };
    this.timers.push(timer);
    return {
      id: timer.id,
      cancel: () => {
        this.timers = this.timers.filter((candidate) => candidate.id !== timer.id);
      },
    };
  }

  private advanceTo(target: number): number {
    if (this.running) {
      // Re-entrant advance from a timer callback: only move the horizon, the outer loop continues.
      this.nowMs = Math.max(this.nowMs, target);
      return 0;
    }
    this.running = true;
    let fired = 0;
    try {
      for (;;) {
        let next: Timer | undefined;
        for (const timer of this.timers) {
          if (timer.due > target) continue;
          if (!next || timer.due < next.due || (timer.due === next.due && timer.seq < next.seq)) next = timer;
        }
        if (!next) break;
        this.nowMs = Math.max(this.nowMs, next.due);
        if (next.every !== undefined) {
          next.due += next.every;
          next.seq = this.nextSeq++;
        } else {
          const id = next.id;
          this.timers = this.timers.filter((candidate) => candidate.id !== id);
        }
        next.fn();
        fired++;
      }
      this.nowMs = Math.max(this.nowMs, target);
    } finally {
      this.running = false;
    }
    return fired;
  }
}
