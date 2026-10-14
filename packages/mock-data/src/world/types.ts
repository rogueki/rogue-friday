import type { Actor, JarvisEvent, JarvisEventMap, JarvisEventType } from "@jarvis/sdk";

/** Per-call context a transport (MSW, Control API, port adapter) hands to world operations. */
export interface OpContext {
  /** `Idempotency-Key` header: repeated keys replay the stored result. */
  idempotencyKey?: string | undefined;
  /** `If-Match` header or `ifMatchVersion`: resource version, optionally quoted (`"3"`, `W/"3"`). */
  ifMatch?: string | number | null | undefined;
  /** `X-Correlation-Id`; generated when absent. */
  correlationId?: string | undefined;
  /** Acting principal; defaults to the owner. */
  actor?: Actor | undefined;
  /** Channel a decision arrived on (Tier-3 approvals are never approvable by voice alone). */
  inputChannel?: "dashboard" | "voice" | "api" | undefined;
}

export interface EmitOptions {
  subject: string;
  /** `adapter://mock-tasks` or `control-api://core`. */
  source: string;
  correlationId?: string | undefined;
  causationId?: string | undefined;
}

export type WorldEvent<K extends JarvisEventType = JarvisEventType> = JarvisEvent<K>;
export type WorldEventListener = (event: JarvisEvent) => void;
export type EventData<K extends JarvisEventType> = JarvisEventMap[K];

/** Result of deleting a resource that may need an approval first. */
export type DeleteOutcome<A, R> = { kind: "deleted"; result: R } | { kind: "approval"; approval: A };
