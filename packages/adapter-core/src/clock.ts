/** Time source for everything in the adapter layer. Injectable so mocks and tests are deterministic. */
export interface Clock {
  /** Epoch milliseconds. */
  now(): number;
  /** Schedules `callback` once; returns a function that cancels the timer. */
  setTimeout(callback: () => void, delayMs: number): () => void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout(callback, delayMs) {
    const handle = setTimeout(callback, delayMs);
    return () => clearTimeout(handle);
  },
};

export const toIso = (clock: Clock): string => new Date(clock.now()).toISOString();

/** Resolves after `delayMs` on the given clock; rejects with the abort reason when the signal fires first. */
export function sleep(clock: Clock, delayMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const cancel = clock.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      cancel();
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export interface ManualClock extends Clock {
  /** Moves time forward and fires every timer that becomes due (in order), flushing microtasks between timers. */
  advance(ms: number): Promise<void>;
  /** Number of timers that are scheduled but not fired. */
  pending(): number;
  set(epochMs: number): void;
}

/** Fully manual clock: time only moves through `advance`. */
export function createManualClock(startEpochMs = Date.parse("2026-10-13T20:00:00.000Z")): ManualClock {
  let current = startEpochMs;
  let sequence = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();

  const flushMicrotasks = async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  };

  return {
    now: () => current,
    setTimeout(callback, delayMs) {
      const id = (sequence += 1);
      timers.set(id, { at: current + Math.max(0, delayMs), callback });
      return () => {
        timers.delete(id);
      };
    },
    async advance(ms) {
      const target = current + ms;
      await flushMicrotasks();
      for (;;) {
        let nextId: number | undefined;
        let nextAt = Infinity;
        for (const [id, timer] of timers) {
          if (
            timer.at <= target &&
            (timer.at < nextAt || (timer.at === nextAt && id < (nextId ?? Infinity)))
          ) {
            nextAt = timer.at;
            nextId = id;
          }
        }
        if (nextId === undefined) break;
        const timer = timers.get(nextId);
        timers.delete(nextId);
        current = Math.max(current, nextAt);
        timer?.callback();
        await flushMicrotasks();
      }
      current = target;
      await flushMicrotasks();
    },
    pending: () => timers.size,
    set(epochMs) {
      current = epochMs;
    },
  };
}
