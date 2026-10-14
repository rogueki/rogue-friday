import { describe, expect, it, vi } from "vitest";
import { createManualClock } from "./clock";
import { AdapterError } from "./errors";
import {
  CircuitBreaker,
  backoffCeiling,
  computeBackoffDelay,
  createResilientCaller,
  normalizeBreakerConfig,
  normalizeRetryConfig,
  retry,
  withTimeout,
  type CircuitStateChange,
  type RetryPolicy,
} from "./resilience";

const transient = () => new AdapterError({ code: "ADAPTER_UNAVAILABLE", message: "503" });
const permanent = () => new AdapterError({ code: "FORBIDDEN", message: "403" });

describe("withTimeout", () => {
  it("rejects with ADAPTER_TIMEOUT when the deadline passes and aborts the operation", async () => {
    const clock = createManualClock();
    let seen: AbortSignal | undefined;
    const pending = withTimeout(
      (signal) => {
        seen = signal;
        return new Promise<never>(() => {});
      },
      { timeoutMs: 1000, clock, operation: "slow" },
    );
    const assertion = expect(pending).rejects.toMatchObject({ code: "ADAPTER_TIMEOUT", retryable: true });
    await clock.advance(999);
    expect(seen?.aborted).toBe(false);
    await clock.advance(1);
    await assertion;
    expect(seen?.aborted).toBe(true);
    expect(clock.pending()).toBe(0);
  });

  it("returns the result and clears the timer when the operation wins", async () => {
    const clock = createManualClock();
    await expect(withTimeout(async () => 42, { timeoutMs: 1000, clock })).resolves.toBe(42);
    expect(clock.pending()).toBe(0);
  });

  it("aborts on parent signal", async () => {
    const clock = createManualClock();
    const parent = new AbortController();
    const pending = withTimeout(() => new Promise<never>(() => {}), {
      timeoutMs: 1000,
      clock,
      signal: parent.signal,
    });
    const assertion = expect(pending).rejects.toMatchObject({
      code: "ADAPTER_UNAVAILABLE",
      retryable: false,
    });
    parent.abort(new DOMException("shutdown", "AbortError"));
    await assertion;
  });

  it("normalizes operation errors", async () => {
    await expect(
      withTimeout(async () => Promise.reject(Object.assign(new Error("x"), { status: 404 })), {
        timeoutMs: 10,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("backoff", () => {
  const policy: RetryPolicy = {
    maxAttempts: 6,
    baseDelayMs: 100,
    maxDelayMs: 1000,
    factor: 2,
    jitter: "full",
  };

  it("doubles up to the cap", () => {
    expect([1, 2, 3, 4, 5].map((n) => backoffCeiling(policy, n))).toEqual([100, 200, 400, 800, 1000]);
  });

  it("full jitter stays within [0, ceiling] for the whole random range", () => {
    for (let retryIndex = 1; retryIndex <= 5; retryIndex += 1) {
      const ceiling = backoffCeiling(policy, retryIndex);
      expect(computeBackoffDelay(policy, retryIndex, () => 0)).toBe(0);
      expect(computeBackoffDelay(policy, retryIndex, () => 0.999999)).toBeLessThanOrEqual(ceiling);
      for (let i = 0; i < 200; i += 1) {
        const delay = computeBackoffDelay(policy, retryIndex);
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThanOrEqual(ceiling);
      }
    }
  });

  it("jitter 'none' is deterministic", () => {
    expect(computeBackoffDelay({ ...policy, jitter: "none" }, 3)).toBe(400);
  });
});

describe("retry", () => {
  const policy = { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1000, factor: 2, jitter: "none" } as const;

  it("retries retryable errors with the configured delays and then succeeds", async () => {
    const clock = createManualClock();
    const delays: number[] = [];
    const operation = vi.fn<(attempt: number) => Promise<string>>(async (attempt) => {
      if (attempt < 3) throw transient();
      return "ok";
    });
    const result = retry(operation, policy, { clock, onRetry: ({ delayMs }) => delays.push(delayMs) });
    await clock.advance(100);
    await clock.advance(200);
    await expect(result).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([100, 200]);
  });

  it("is bounded: gives up after maxAttempts and throws the last error", async () => {
    const clock = createManualClock();
    const operation = vi.fn(async () => {
      throw transient();
    });
    const result = retry(operation, policy, { clock });
    const assertion = expect(result).rejects.toMatchObject({ code: "ADAPTER_UNAVAILABLE" });
    await clock.advance(10_000);
    await assertion;
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("does not retry permanent errors", async () => {
    const operation = vi.fn(async () => {
      throw permanent();
    });
    await expect(retry(operation, policy, { clock: createManualClock() })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("honours a retryAfterMs hint up to maxDelayMs", async () => {
    const clock = createManualClock();
    const delays: number[] = [];
    const operation = vi.fn(async (attempt: number) => {
      if (attempt === 1)
        throw new AdapterError({ code: "RATE_LIMITED", message: "429", details: { retryAfterMs: 700 } });
      return "ok";
    });
    const result = retry(operation, policy, { clock, onRetry: ({ delayMs }) => delays.push(delayMs) });
    await clock.advance(700);
    await expect(result).resolves.toBe("ok");
    expect(delays).toEqual([700]);
  });

  it("can be aborted while waiting for the next attempt", async () => {
    const clock = createManualClock();
    const controller = new AbortController();
    const result = retry(async () => Promise.reject(transient()), policy, {
      clock,
      signal: controller.signal,
    });
    const assertion = expect(result).rejects.toBeDefined();
    await clock.advance(0);
    controller.abort(new DOMException("stop", "AbortError"));
    await assertion;
  });
});

describe("CircuitBreaker", () => {
  const options = { failureThreshold: 3, resetTimeoutMs: 1000, successThreshold: 1, halfOpenMaxCalls: 1 };

  it("opens after the failure threshold, rejects fast, half-opens after the reset timeout and closes on success", async () => {
    const clock = createManualClock();
    const breaker = new CircuitBreaker(options, { clock });
    const changes: CircuitStateChange[] = [];
    breaker.onStateChange((change) => changes.push(change));
    const fail = () => breaker.execute(async () => Promise.reject(transient())).catch((e: unknown) => e);

    await fail();
    await fail();
    expect(breaker.state).toBe("closed");
    await fail();
    expect(breaker.state).toBe("open");

    const operation = vi.fn(async () => "ok");
    await expect(breaker.execute(operation)).rejects.toMatchObject({
      code: "ADAPTER_UNAVAILABLE",
      details: { circuit: "open" },
    });
    expect(operation).not.toHaveBeenCalled();

    await clock.advance(1000);
    expect(breaker.state).toBe("half_open");
    await expect(breaker.execute(operation)).resolves.toBe("ok");
    expect(breaker.state).toBe("closed");
    expect(changes.map((c) => `${c.from}->${c.to}`)).toEqual([
      "closed->open",
      "open->half_open",
      "half_open->closed",
    ]);
  });

  it("re-opens when the half-open probe fails", async () => {
    const clock = createManualClock();
    const breaker = new CircuitBreaker({ ...options, failureThreshold: 1 }, { clock });
    await breaker.execute(async () => Promise.reject(transient())).catch(() => {});
    await clock.advance(1000);
    expect(breaker.state).toBe("half_open");
    await breaker.execute(async () => Promise.reject(transient())).catch(() => {});
    expect(breaker.state).toBe("open");
  });

  it("allows only halfOpenMaxCalls concurrent probes", async () => {
    const clock = createManualClock();
    const breaker = new CircuitBreaker({ ...options, failureThreshold: 1 }, { clock });
    await breaker.execute(async () => Promise.reject(transient())).catch(() => {});
    await clock.advance(1000);
    let release: () => void = () => {};
    const probe = breaker.execute(() => new Promise<void>((resolve) => (release = resolve)));
    await expect(breaker.execute(async () => "second")).rejects.toMatchObject({
      details: { circuit: "open" },
    });
    release();
    await probe;
    expect(breaker.state).toBe("closed");
  });

  it("does not count client errors as failures and resets the failure streak on success", async () => {
    const breaker = new CircuitBreaker(options, { clock: createManualClock() });
    for (let i = 0; i < 5; i += 1)
      await breaker.execute(async () => Promise.reject(permanent())).catch(() => {});
    expect(breaker.state).toBe("closed");
    await breaker.execute(async () => Promise.reject(transient())).catch(() => {});
    await breaker.execute(async () => Promise.reject(transient())).catch(() => {});
    await breaker.execute(async () => "ok");
    expect(breaker.consecutiveFailures).toBe(0);
  });
});

describe("createResilientCaller", () => {
  it("retries transient errors, counts every attempt in the breaker and stops retrying once the circuit is open", async () => {
    const clock = createManualClock();
    const caller = createResilientCaller(
      {
        timeoutMs: 500,
        retry: { maxAttempts: 5, baseDelayMs: 10, maxDelayMs: 10, factor: 1, jitter: "none" },
        circuitBreaker: { failureThreshold: 2, resetTimeoutMs: 60_000 },
      },
      { clock },
    );
    const operation = vi.fn(async () => {
      throw transient();
    });
    const result = caller.call(operation);
    const assertion = expect(result).rejects.toMatchObject({
      code: "ADAPTER_UNAVAILABLE",
      details: { circuit: "open" },
    });
    await clock.advance(1000);
    await assertion;
    expect(operation).toHaveBeenCalledTimes(2);
    expect(caller.breaker?.state).toBe("open");
  });

  it("applies the timeout per attempt", async () => {
    const clock = createManualClock();
    const caller = createResilientCaller({ timeoutMs: 100, retry: false, circuitBreaker: false }, { clock });
    const result = caller.call(() => new Promise<never>(() => {}), { operation: "x" });
    const assertion = expect(result).rejects.toMatchObject({ code: "ADAPTER_TIMEOUT" });
    await clock.advance(100);
    await assertion;
  });

  it("skips retries when the call is flagged as not retryable", async () => {
    const caller = createResilientCaller(
      { timeoutMs: 100, retry: { maxAttempts: 3 }, circuitBreaker: false },
      { clock: createManualClock() },
    );
    const operation = vi.fn(async () => {
      throw transient();
    });
    await expect(caller.call(operation, { retry: false })).rejects.toBeDefined();
    expect(operation).toHaveBeenCalledTimes(1);
  });
});

describe("config dialect", () => {
  it("accepts the config/adapters.yaml spelling of retry and circuit breaker settings", () => {
    expect(normalizeRetryConfig({ maxAttempts: 3, jitter: 0.2 })).toEqual({ maxAttempts: 3, jitter: "full" });
    expect(normalizeRetryConfig({ jitter: 0 })).toEqual({ jitter: "none" });
    expect(normalizeRetryConfig(false)).toBe(false);
    expect(normalizeBreakerConfig({ failureThreshold: 5, resetAfterMs: 30000 })).toEqual({
      failureThreshold: 5,
      resetTimeoutMs: 30000,
    });
    expect(normalizeBreakerConfig(undefined)).toBeUndefined();
  });
});
