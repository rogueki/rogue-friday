import type { operations } from "@friday/sdk";

export type OperationId = keyof operations;
export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
export type RequiredRole = "none" | "viewer" | "operator" | "owner";

export interface QueryParamSpec {
  name: string;
  required: boolean;
  /** JSON Schema fragment; `$ref`s point at `#/components/schemas/<Name>` and are resolved against the SDK registry. */
  schema: Record<string, unknown>;
}

export interface ResponseSpec {
  status: number;
  /** Contract schema name (SDK `SchemaName`), `binary` for downloads, or `null` for bodiless/untyped responses. */
  schema: string | null;
  contentTypes: string[];
}

export interface RouteSpec {
  operationId: OperationId;
  method: HttpMethod;
  /** OpenAPI path template, e.g. `/api/v1/tasks/{id}`. */
  path: string;
  tag: string;
  /** `x-capability`, e.g. `tasks.read`; null for auth/dev operations. */
  capability: string | null;
  /** `x-required-role`. */
  role: RequiredRole;
  /** False for operations declared with `security: []` (login). */
  requiresSession: boolean;
  pathParams: string[];
  query: QueryParamSpec[];
  /** Header parameters declared by the operation. */
  acceptsIfMatch: boolean;
  acceptsIdempotencyKey: boolean;
  /** Mutating operations carry an `X-CSRF-Token` parameter in the contract. */
  csrf: boolean;
  requestBody: { required: boolean; schema: string } | null;
  /** `x-max-body-bytes`: stricter request body limit than the server default (null = default). */
  maxBodyBytes: number | null;
  responses: ResponseSpec[];
}
