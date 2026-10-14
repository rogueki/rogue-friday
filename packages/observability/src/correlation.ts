import { AsyncLocalStorage } from 'node:async_hooks';
import { createCorrelationId } from './ids';

export interface CorrelationContext {
  correlationId: string;
  /** Extra bound fields (e.g. userId, route) merged into every log line inside the scope. */
  fields?: Readonly<Record<string, unknown>>;
}

const storage = new AsyncLocalStorage<CorrelationContext>();

export function runWithCorrelation<T>(
  correlationId: string,
  fn: () => T,
  fields?: Readonly<Record<string, unknown>>,
): T {
  return storage.run({ correlationId, fields }, fn);
}

/** Runs `fn` under the given id, or a freshly generated one when `correlationId` is empty. */
export function runWithNewCorrelation<T>(fn: () => T, correlationId?: string | null): T {
  return runWithCorrelation(correlationId || createCorrelationId(), fn);
}

export function getCorrelationContext(): CorrelationContext | undefined {
  return storage.getStore();
}

export function getCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}

const SAFE_HEADER_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

/** Accepts an inbound `X-Correlation-Id` only when it is a harmless token (no log injection). */
export function sanitizeInboundCorrelationId(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  return SAFE_HEADER_ID.test(value) ? value : undefined;
}
