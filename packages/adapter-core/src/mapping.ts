import type { SchemaName, SourceDescriptor } from "@friday/sdk";
import { toIso, type Clock } from "./clock";
import { assertContract, checkContract } from "./contract";
import { AdapterError, normalizeError } from "./errors";

/** Builds the `source` descriptor every canonical resource carries (PLAN §8.8). */
export function sourceDescriptor(
  adapterId: string,
  system: string,
  externalId: string | undefined,
  lastSyncedAt: string,
): SourceDescriptor {
  return externalId === undefined || externalId === ""
    ? { adapterId, system, lastSyncedAt }
    : { adapterId, system, externalId, lastSyncedAt };
}

/** Per-sync context handed to mappers so that `lastSyncedAt` is consistent across one response. */
export interface MapContext {
  readonly adapterId: string;
  readonly system: string;
  readonly syncedAt: string;
  source(externalId?: string): SourceDescriptor;
}

export function createMapContext(options: { adapterId: string; system: string; clock: Clock }): MapContext {
  const syncedAt = toIso(options.clock);
  return {
    adapterId: options.adapterId,
    system: options.system,
    syncedAt,
    source: (externalId) => sourceDescriptor(options.adapterId, options.system, externalId, syncedAt),
  };
}

export interface MapperDefinition<Raw, Canonical> {
  /** For error messages, e.g. "ExampleTasks item -> Task". */
  name: string;
  /** Title or `$id` of the canonical schema the output must satisfy (e.g. `Task`). */
  schema: SchemaName;
  toCanonical(raw: Raw, context: MapContext): Canonical;
}

export interface Mapper<Raw, Canonical> {
  readonly name: string;
  readonly schema: SchemaName;
  /** Maps and validates one object. Throws VALIDATION_FAILED when the result violates the contract. */
  map(raw: Raw, context: MapContext): Canonical;
  mapMany(raws: readonly Raw[], context: MapContext): Canonical[];
}

/**
 * Wraps a `toCanonical` function with contract validation. The validator enforces `additionalProperties: false`
 * of the canonical schemas, so keys the provider invented (`owner_bot`, `item_id`) cannot reach the control API.
 */
export function defineMapper<Raw, Canonical>(
  definition: MapperDefinition<Raw, Canonical>,
): Mapper<Raw, Canonical> {
  const map = (raw: Raw, context: MapContext): Canonical => {
    let canonical: Canonical;
    try {
      canonical = definition.toCanonical(raw, context);
    } catch (error) {
      throw normalizeError(error, { operation: definition.name });
    }
    assertContract(definition.schema, canonical, definition.name);
    return canonical;
  };
  return {
    name: definition.name,
    schema: definition.schema,
    map,
    mapMany: (raws, context) => raws.map((raw) => map(raw, context)),
  };
}

/**
 * Fails when `value` carries keys that the canonical schema does not declare. Reports the offending paths only.
 * Equivalent to the validation inside `defineMapper`, exported for adapters that assemble objects by hand.
 */
export function assertNoProviderFields(schema: SchemaName, value: unknown, what = schema): void {
  const check = checkContract(schema, value);
  if (check.providerFieldLeak) {
    throw new AdapterError({
      code: "VALIDATION_FAILED",
      message: `${what}: provider-specific fields im kanonischen Objekt.`,
      retryable: false,
      details: {
        schema,
        issues: check.issues.filter((issue) => issue.message.includes("additional properties")),
      },
    });
  }
}

/** Returns every key path of `value` whose last segment is in `forbidden` (used by the conformance suite). */
export function findForbiddenKeys(value: unknown, forbidden: readonly string[], path = ""): string[] {
  if (value === null || typeof value !== "object") return [];
  if (Array.isArray(value))
    return value.flatMap((entry, index) => findForbiddenKeys(entry, forbidden, `${path}[${index}]`));
  return Object.entries(value).flatMap(([key, entry]) => [
    ...(forbidden.includes(key) ? [`${path}.${key}`] : []),
    ...findForbiddenKeys(entry, forbidden, `${path}.${key}`),
  ]);
}
