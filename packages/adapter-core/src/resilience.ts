import { systemClock, sleep, type Clock } from "./clock";
import { AdapterError, normalizeError } from "./errors";

// ---------------------------------------------------------------------------------------------------------------------
// Timeout
// ---------------------------------------------------------------------------------------------------------------------

export interface TimeoutOptions {
  timeoutMs: number;
  clock?: Clock;
  /** Aborting the parent signal aborts the operation (shutdown). */
  signal?: AbortSignal;
  /** Used in the error message, e.g. "listTasks". */
  operation?: string;
}

/** Runs `operation` with a deadline. The operation receives a signal that fires on timeout or parent abort. */
export async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: TimeoutOptions,
): Promise<T> {
  const clock = options.clock ?? systemClock;
  const controller = new AbortController();
  const label = options.operation ? `${options.operation}: ` : "";

  if (options.signal?.aborted)
    throw normalizeError(options.signal.reason ?? new DOMException("Aborted", "AbortError"));

  let cancelTimer: () => void = () => {};
  let removeParentListener: () => void = () => {};

  const guard = new Promise<never>((_, reject) => {
    cancelTimer = clock.setTimeout(() => {
      const error = new AdapterError({
        code: "ADAPTER_TIMEOUT",
        message: `${label}Zeitüberschreitung nach ${options.timeoutMs} ms.`,
        retryable: true,
        details: { timeoutMs: options.timeoutMs },
      });
      controller.abort(error);
      reject(error);
    }, options.timeoutMs);

    if (options.signal) {
      const parent = options.signal;
      const onAbort = () => {
        const error = normalizeError(parent.reason ?? new DOMException("Aborted", "AbortError"));
        controller.abort(error);
        reject(error);
      };
      parent.addEventListener("abort", onAbort, { once: true });
      removeParentListener = () => parent.removeEventListener("abort", onAbort);
    }
  });
  // The guard may reject after the operation already settled; that must not surface as an unhandled rejection.
  guard.catch(() => {});

  try {
    const running = operation(controller.signal);
    running.catch(() => {});
    return await Promise.race([running, guard]);
  } catch (error) {
    throw normalizeError(error, options.operation ? { operation: options.operation } : undefined);
  } finally {
    cancelTimer();
    removeParentListener();
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Retry with exponential backoff and full jitter
// ---------------------------------------------------------------------------------------------------------------------

export interface RetryPolicy {
  /** Total attempts including the first one. Bounded; there is no unbounded retry. Default 3. */
  maxAttempts: number;
  /** Delay base for the first retry. Default 200 ms. */
  baseDelayMs: number;
  /** Upper bound for a single backoff delay. Default 5 000 ms. */
  maxDelayMs: number;
  /** Exponent base. Default 2. */
  factor: number;
  /** "full": uniform in [0, backoff]; "none": exact backoff (tests). Default "full". */
  jitter: "full" | "none";
}

export const DEFAULT_RETRY_POLICY: Readonly<RetryPolicy> = {
  maxAttempts: 3,
  baseDelayMs: 200,
  maxDelayMs: 5_000,
  factor: 2,
  jitter: "full",
};

/** Upper bound of the delay before retry number `retryIndex` (1 = first retry). */
export function backoffCeiling(policy: RetryPolicy, retryIndex: number): number {
  return Math.min(policy.maxDelayMs, policy.baseDelayMs * policy.factor ** (retryIndex - 1));
}

/** Delay before retry number `retryIndex`; with full jitter uniform in [0, ceiling]. */
export function computeBackoffDelay(
  policy: RetryPolicy,
  retryIndex: number,
  random: () => number = Math.random,
): number {
  const ceiling = backoffCeiling(policy, retryIndex);
  return policy.jitter === "full" ? Math.floor(random() * (ceiling + 1)) : ceiling;
}

export interface RetryOptions {
  clock?: Clock;
  signal?: AbortSignal;
  random?: () => number;
  /** Defaults to `error.retryable` of the normalized error. */
  shouldRetry?: (error: AdapterError, attempt: number) => boolean;
  onRetry?: (info: { attempt: number; delayMs: number; error: AdapterError }) => void;
  operation?: string;
}

/**
 * Runs `operation` up to `policy.maxAttempts` times. Only retryable errors are retried; every error is normalized;
 * the last error is thrown unchanged (never swallowed). A `details.retryAfterMs` hint (HTTP 429) raises the delay.
 */
export async function retry<T>(
  operation: (attempt: number, signal: AbortSignal | undefined) => Promise<T>,
  policy: Partial<RetryPolicy> = {},
  options: RetryOptions = {},
): Promise<T> {
  const resolved: RetryPolicy = { ...DEFAULT_RETRY_POLICY, ...policy };
  const maxAttempts = Math.max(1, Math.floor(resolved.maxAttempts));
  const clock = options.clock ?? systemClock;
  for (let attempt = 1; ; attempt += 1) {
    if (options.signal?.aborted)
      throw normalizeError(options.signal.reason ?? new DOMException("Aborted", "AbortError"));
    try {
      return await operation(attempt, options.signal);
    } catch (raw) {
      const error = normalizeError(raw, options.operation ? { operation: options.operation } : undefined);
      const retryable = options.shouldRetry ? options.shouldRetry(error, attempt) : error.retryable;
      if (!retryable || attempt >= maxAttempts) throw error;
      const hint = typeof error.details.retryAfterMs === "number" ? error.details.retryAfterMs : 0;
      const delayMs = Math.min(
        resolved.maxDelayMs,
        Math.max(computeBackoffDelay(resolved, attempt, options.random), hint),
      );
      options.onRetry?.({ attempt, delayMs, error });
      await sleep(clock, delayMs, options.signal);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------------------------------------------------

export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerOptions {
  /** Consecutive failures that open the circuit. Default 5. */
  failureThreshold: number;
  /** Time in `open` before one probe is allowed. Default 30 000 ms. */
  resetTimeoutMs: number;
  /** Successful probes needed in `half_open` to close. Default 1. */
  successThreshold: number;
  /** Concurrent probe calls allowed in `half_open`. Default 1. */
  halfOpenMaxCalls: number;
}

export const DEFAULT_BREAKER_OPTIONS: Readonly<CircuitBreakerOptions> = {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  successThreshold: 1,
  halfOpenMaxCalls: 1,
};

export interface CircuitStateChange {
  from: CircuitState;
  to: CircuitState;
  at: number;
  reason: string;
}

/** Errors that say something about the upstream's health; client errors (404, 409, ...) must not trip the circuit. */
export const defaultIsBreakerFailure = (error: AdapterError): boolean =>
  error.retryable || error.code === "ADAPTER_UNAVAILABLE" || error.code === "ADAPTER_TIMEOUT";

export class CircuitBreaker {
  private readonly options: CircuitBreakerOptions;
  private readonly clock: Clock;
  private readonly isFailure: (error: AdapterError) => boolean;
  private readonly listeners = new Set<(change: CircuitStateChange) => void>();
  private current: CircuitState = "closed";
  private failures = 0;
  private probeSuccesses = 0;
  private inFlightProbes = 0;
  private openedAt = 0;

  constructor(
    options: Partial<CircuitBreakerOptions> = {},
    dependencies: { clock?: Clock; isFailure?: (error: AdapterError) => boolean } = {},
  ) {
    this.options = { ...DEFAULT_BREAKER_OPTIONS, ...options };
    this.clock = dependencies.clock ?? systemClock;
    this.isFailure = dependencies.isFailure ?? defaultIsBreakerFailure;
  }

  /** Current state; an `open` circuit whose reset timeout elapsed is reported (and becomes) `half_open`. */
  get state(): CircuitState {
    if (this.current === "open" && this.clock.now() - this.openedAt >= this.options.resetTimeoutMs) {
      this.transition("half_open", "reset timeout elapsed");
    }
    return this.current;
  }

  get consecutiveFailures(): number {
    return this.failures;
  }

  onStateChange(listener: (change: CircuitStateChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  reset(): void {
    this.failures = 0;
    this.probeSuccesses = 0;
    this.inFlightProbes = 0;
    if (this.current !== "closed") this.transition("closed", "manual reset");
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    const state = this.state;
    let probe = false;
    if (state === "open") throw this.openError();
    if (state === "half_open") {
      if (this.inFlightProbes >= this.options.halfOpenMaxCalls) throw this.openError();
      this.inFlightProbes += 1;
      probe = true;
    }
    try {
      const result = await operation();
      this.recordSuccess(probe);
      return result;
    } catch (raw) {
      const error = normalizeError(raw);
      if (this.isFailure(error)) this.recordFailure(probe, error);
      else this.recordSuccess(probe); // The upstream answered; a client error proves it is reachable.
      throw error;
    } finally {
      if (probe) this.inFlightProbes = Math.max(0, this.inFlightProbes - 1);
    }
  }

  private recordSuccess(probe: boolean): void {
    if (probe) {
      this.probeSuccesses += 1;
      if (this.probeSuccesses >= this.options.successThreshold) {
        this.failures = 0;
        this.transition("closed", "probe succeeded");
      }
      return;
    }
    this.failures = 0;
  }

  private recordFailure(probe: boolean, error: AdapterError): void {
    this.failures += 1;
    if (probe) {
      this.transition("open", `probe failed: ${error.code}`);
      return;
    }
    if (this.current === "closed" && this.failures >= this.options.failureThreshold) {
      this.transition("open", `${this.failures} consecutive failures (${error.code})`);
    }
  }

  private transition(to: CircuitState, reason: string): void {
    if (this.current === to) return;
    const change: CircuitStateChange = { from: this.current, to, at: this.clock.now(), reason };
    this.current = to;
    if (to === "open") this.openedAt = change.at;
    if (to === "half_open" || to === "closed") this.probeSuccesses = 0;
    if (to === "closed") this.failures = 0;
    for (const listener of this.listeners) listener(change);
  }

  private openError(): AdapterError {
    const remaining = Math.max(0, this.options.resetTimeoutMs - (this.clock.now() - this.openedAt));
    return new AdapterError({
      code: "ADAPTER_UNAVAILABLE",
      message: "Der Adapter ist vorübergehend gesperrt (Circuit Breaker offen).",
      retryable: true,
      details: { circuit: "open", retryAfterMs: remaining },
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Config normalisation (config/adapters.yaml dialect)
// ---------------------------------------------------------------------------------------------------------------------

/** Retry settings as they appear in config/adapters.yaml: `jitter` may be a ratio (> 0 = full jitter, 0 = none). */
export type RetryConfigInput = Omit<Partial<RetryPolicy>, "jitter"> & {
  jitter?: RetryPolicy["jitter"] | number;
};

/** Breaker settings as they appear in config/adapters.yaml: `resetAfterMs` is an alias of `resetTimeoutMs`. */
export type BreakerConfigInput = Partial<CircuitBreakerOptions> & { resetAfterMs?: number };

export function normalizeRetryConfig(
  input: RetryConfigInput | false | undefined,
): Partial<RetryPolicy> | false | undefined {
  if (input === false || input === undefined) return input;
  const { jitter, ...rest } = input;
  return {
    ...rest,
    ...(jitter === undefined
      ? {}
      : { jitter: typeof jitter === "number" ? (jitter > 0 ? "full" : "none") : jitter }),
  };
}

export function normalizeBreakerConfig(
  input: BreakerConfigInput | false | undefined,
): Partial<CircuitBreakerOptions> | false | undefined {
  if (input === false || input === undefined) return input;
  const { resetAfterMs, ...rest } = input;
  return {
    ...rest,
    ...(resetAfterMs !== undefined && rest.resetTimeoutMs === undefined
      ? { resetTimeoutMs: resetAfterMs }
      : {}),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------------------------------------------------

export interface ResilientCallerPolicy {
  /** Per attempt. Default 10 000 ms. */
  timeoutMs: number;
  /** `false` disables retries. */
  retry: Partial<RetryPolicy> | false;
  /** `false` disables the breaker. */
  circuitBreaker: Partial<CircuitBreakerOptions> | false;
}

export const DEFAULT_RESILIENCE_POLICY: Readonly<ResilientCallerPolicy> = {
  timeoutMs: 10_000,
  retry: DEFAULT_RETRY_POLICY,
  circuitBreaker: DEFAULT_BREAKER_OPTIONS,
};

export interface ResilientCallOptions {
  signal?: AbortSignal;
  operation?: string;
  /** Set false for non-idempotent calls without an idempotency key. */
  retry?: boolean;
}

export interface ResilientCaller {
  call<T>(operation: (signal: AbortSignal) => Promise<T>, options?: ResilientCallOptions): Promise<T>;
  readonly breaker: CircuitBreaker | undefined;
  readonly policy: ResilientCallerPolicy;
}

export interface ResilientCallerDependencies {
  clock?: Clock;
  random?: () => number;
  breaker?: CircuitBreaker;
  onRetry?: (info: { attempt: number; delayMs: number; error: AdapterError; operation?: string }) => void;
}

/** retry( breaker( timeout( operation ) ) ): every attempt has its own deadline and counts toward the circuit. */
export function createResilientCaller(
  policy: Partial<ResilientCallerPolicy> = {},
  dependencies: ResilientCallerDependencies = {},
): ResilientCaller {
  const resolved: ResilientCallerPolicy = { ...DEFAULT_RESILIENCE_POLICY, ...policy };
  const clock = dependencies.clock ?? systemClock;
  const breaker =
    dependencies.breaker ??
    (resolved.circuitBreaker === false ? undefined : new CircuitBreaker(resolved.circuitBreaker, { clock }));

  return {
    breaker,
    policy: resolved,
    async call<T>(
      operation: (signal: AbortSignal) => Promise<T>,
      options: ResilientCallOptions = {},
    ): Promise<T> {
      const attemptOnce = (): Promise<T> => {
        const run = () =>
          withTimeout(operation, {
            timeoutMs: resolved.timeoutMs,
            clock,
            ...(options.signal ? { signal: options.signal } : {}),
            ...(options.operation ? { operation: options.operation } : {}),
          });
        return breaker ? breaker.execute(run) : run();
      };

      if (resolved.retry === false || options.retry === false) return attemptOnce();

      return retry(attemptOnce, resolved.retry, {
        clock,
        ...(options.signal ? { signal: options.signal } : {}),
        ...(dependencies.random ? { random: dependencies.random } : {}),
        // An open circuit is answered immediately; retrying would only burn the attempts.
        shouldRetry: (error) => error.retryable && error.details.circuit !== "open",
        onRetry: (info) =>
          dependencies.onRetry?.({ ...info, ...(options.operation ? { operation: options.operation } : {}) }),
      });
    },
  };
}
