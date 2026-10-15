import type { AdapterContext } from "@friday/adapter-core";

export interface TransportCall {
  /** Port method name, e.g. `listTasks`. */
  method: string;
  mutating: boolean;
  idempotencyKey?: string;
  correlationId: string;
  signal?: AbortSignal;
}

/**
 * The seam between a mock adapter and "the outside". Real adapters talk HTTP/CLI to a foreign system; for the mocks the
 * world simulates availability and latency by itself, so the default transport is a no-op. A transport may throw an
 * `AdapterError` from `beforeCall`/`probe` to inject transport-level faults.
 */
export interface MockTransport {
  open?(context: AdapterContext): Promise<void>;
  close?(): Promise<void>;
  beforeCall(call: TransportCall): Promise<void>;
  probe(signal?: AbortSignal): Promise<{ latencyMs: number }>;
}

export function worldTransport(): MockTransport {
  return {
    async beforeCall() {},
    async probe() {
      return { latencyMs: 1 };
    },
  };
}
