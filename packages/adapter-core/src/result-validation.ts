import { CONTRACT_VERSION, type SourceDescriptor } from "@jarvis/sdk";
import { assertContract, getContractValidator } from "./contract";
import { AdapterError } from "./errors";
import type { MethodSpec } from "./port-spec";

const invalid = (message: string): AdapterError =>
  new AdapterError({ code: "VALIDATION_FAILED", message, retryable: false, severity: "error" });

const asRecord = (value: unknown, what: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw invalid(`${what}: Ergebnis ist kein Objekt.`);
  return value as Record<string, unknown>;
};

/** Distinct `{adapterId, system}` pairs of the items' `source` descriptors, newest sync time wins. */
export function collectSources(items: unknown): SourceDescriptor[] {
  if (!Array.isArray(items)) return [];
  const seen = new Map<string, SourceDescriptor>();
  for (const item of items) {
    const source = (item as { source?: SourceDescriptor } | null)?.source;
    if (source && typeof source.adapterId === "string") {
      const key = `${source.adapterId}|${source.system}`;
      const previous = seen.get(key);
      if (!previous || previous.lastSyncedAt < source.lastSyncedAt) {
        seen.set(key, {
          adapterId: source.adapterId,
          system: source.system,
          lastSyncedAt: source.lastSyncedAt,
        });
      }
    }
  }
  return [...seen.values()];
}

export interface ResultValidationOptions {
  /** For messages, e.g. "example-tasks tasks.listTasks". */
  what: string;
  /** Called with the failing schema and issues before the error is thrown (registry logs them). */
  onInvalid?: (info: { schema: string; error: AdapterError }) => void;
}

/**
 * Validates a port method result against the contract schema of its operation, exactly as the registry does before it
 * forwards data. Throws VALIDATION_FAILED on mismatch. Returns the result, with `sources` derived for lists.
 */
export function validatePortResult(
  spec: MethodSpec,
  result: unknown,
  options: ResultValidationOptions,
): unknown {
  const { what } = options;
  const shape = spec.result;
  const validator = getContractValidator();
  const check = (schema: string, envelope: unknown): void => {
    try {
      assertContract(schema, envelope, what, validator);
    } catch (error) {
      if (error instanceof AdapterError) options.onInvalid?.({ schema, error });
      throw error;
    }
  };

  switch (shape.kind) {
    case "page":
    case "hits": {
      const value = asRecord(result, what);
      const sources = (value.sources as SourceDescriptor[] | undefined) ?? collectSources(value.items);
      check(shape.schema, { contractVersion: CONTRACT_VERSION, ...value, sources });
      return { ...value, sources };
    }
    case "single":
      check(shape.schema, { contractVersion: CONTRACT_VERSION, ...asRecord(result, what) });
      return result;
    case "action":
      check("ActionResult", { contractVersion: CONTRACT_VERSION, ...asRecord(result, what) });
      return result;
    case "flat":
      check(shape.schema, { contractVersion: CONTRACT_VERSION, ...asRecord(result, what) });
      return result;
    case "delete-file": {
      const value = asRecord(result, what);
      if (value.kind === "approval_required") {
        check("ApprovalResponse", { contractVersion: CONTRACT_VERSION, ...asRecord(value.approval, what) });
      } else {
        const { kind: _kind, ...outcome } = value;
        check("ActionResult", { contractVersion: CONTRACT_VERSION, ...outcome });
      }
      return result;
    }
    case "raw":
      asRecord(result, what);
      return result;
  }
}
