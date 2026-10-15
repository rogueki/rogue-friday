import {
  createMemoryLogger,
  systemClock,
  type AdapterContext,
  type AdapterEventInput,
  type FridayAdapter,
  type LogRecord,
} from "@friday/adapter-core";
import { createCorrelationId } from "@friday/sdk";

export interface Harness<A extends FridayAdapter> {
  adapter: A;
  context: AdapterContext;
  emitted: AdapterEventInput[];
  logs: LogRecord[];
  call(): { correlationId: string };
  mutation(extra?: { idempotencyKey?: string; ifMatchVersion?: number }): {
    correlationId: string;
    idempotencyKey?: string;
    ifMatchVersion?: number;
  };
  stop(): Promise<void>;
}

/** Wires an adapter to a hand-built context with known secrets (the conformance suite uses random canaries). */
export async function start<A extends FridayAdapter>(
  adapter: A,
  config: Record<string, unknown>,
  secrets: Record<string, string> = {},
): Promise<Harness<A>> {
  const logger = createMemoryLogger();
  const emitted: AdapterEventInput[] = [];
  const abort = new AbortController();
  const context: AdapterContext = {
    adapterId: adapter.manifest.id,
    mode: "live",
    logger,
    clock: systemClock,
    config: Object.freeze({
      pollIntervalMs: 0,
      timeoutMs: 400,
      maxAttempts: 2,
      retryBaseDelayMs: 5,
      ...config,
    }),
    getSecret: (field) => secrets[field],
    emit: (event) => emitted.push(event),
    signal: abort.signal,
    correlationId: () => createCorrelationId(),
  };
  await adapter.initialize(context);
  return {
    adapter,
    context,
    emitted,
    logs: logger.records,
    call: () => ({ correlationId: createCorrelationId() }),
    mutation: (extra = {}) => ({ correlationId: createCorrelationId(), ...extra }),
    stop: async () => {
      abort.abort();
      await adapter.shutdown();
    },
  };
}
