import type { Readable } from "node:stream";
import type { CallContext, MutationContext } from "@friday/adapter-core";
import type { Actor, AuditEvent } from "@friday/sdk";
import type { Principal } from "../security/auth-service";
import type { Runtime } from "../runtime/types";
import type { RouteSpec } from "./route-types";

/** What a handler may add to the audit entry the pipeline writes for every mutation. */
export interface AuditNote {
  action?: string;
  category?: AuditEvent["category"];
  severity?: AuditEvent["severity"];
  approvalId?: string;
  taskId?: string | null;
  agentId?: string | null;
  adapterId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  context?: Record<string, unknown>;
}

export interface RequestContext {
  runtime: Runtime;
  spec: RouteSpec;
  correlationId: string;
  principal: Principal | null;
  voiceBridgeAuthorized: boolean;
  calendarBridgeAuthorized: boolean;
  mailBridgeAuthorized: boolean;
  hermesMemoryBridgeAuthorized: boolean;
  messengerInboundBridgeAuthorized: boolean;
  actor: Actor;
  pathParams: Record<string, string>;
  /** Query parameters after schema validation and coercion. */
  query: Record<string, unknown>;
  rawQuery: URLSearchParams;
  /** Request body as received (JSON text); validated into `body`. */
  rawBody: string | undefined;
  /** Request body after schema validation (undefined when absent). */
  body: unknown;
  headers: Record<string, string | undefined>;
  ip: string;
  call: CallContext;
  mutation: MutationContext;
  idempotencyKey: string | undefined;
  audit: AuditNote;
}

export interface HandlerResult {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  setCookie?: string[];
  /** Non-JSON payload (file download, NDJSON/CSV export). */
  raw?: { contentType: string; data: string | Uint8Array | Readable; disposition?: string };
}

export type Handler = (ctx: RequestContext) => Promise<HandlerResult>;

export const SYSTEM_ACTOR: Actor = { type: "system", id: "control-api", name: "Control API" };
