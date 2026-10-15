import { randomBytes } from "node:crypto";
import { expect } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import { CONTRACT_VERSION, createCorrelationId } from "@friday/sdk";
import {
  AdapterError,
  allowedCapabilities,
  assertContract,
  createMemoryLogger,
  findForbiddenKeys,
  methodsOf,
  systemClock,
  validatePortResult,
  type AdapterContext,
  type AdapterEventInput,
  type CallContext,
  type FridayAdapter,
  type LogRecord,
  type PortCategory,
} from "@friday/adapter-core";

/**
 * Checks of the adapter conformance suite (PLAN §11.1, docs/ADAPTER_CONFORMANCE.md) for adapters whose primary read is a
 * single resource or a probe result and not a cursor-paged list of upstream items. `runConformanceSuite` of
 * `@friday/adapter-testkit` seeds N list items in the foreign system and expects list calls to fail when it is down;
 * that does not fit "status endpoint" and "probe" adapters (see README, "Conformance"). These helpers keep the same
 * check names and rules; the scenarios live in `conformance.test.ts`.
 */

export interface Session {
  adapter: FridayAdapter;
  context: AdapterContext;
  emitted: AdapterEventInput[];
  logs: LogRecord[];
  abort: AbortController;
  secrets: Record<string, string>;
  /** Everything the adapter returned, threw, emitted or logged; scanned for secrets. */
  observed: unknown[];
  shutDown: boolean;
}

export const call = (): CallContext => ({ correlationId: createCorrelationId() });

export async function settle<T>(promise: Promise<T>): Promise<{ value: T } | { error: unknown }> {
  try {
    return { value: await promise };
  } catch (error) {
    return { error };
  }
}

export function describeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...(error instanceof AdapterError ? { code: error.code, details: error.details } : {}),
      cause: error.cause === undefined ? undefined : describeError(error.cause),
    };
  }
  return { value: String(error) };
}

export async function openSession(
  adapter: FridayAdapter,
  config: Record<string, unknown>,
  options: { initialize?: boolean } = {},
): Promise<Session> {
  const secrets = Object.fromEntries(
    adapter.manifest.secretFields.map((field) => [
      field,
      `sk_canary_${field}_${randomBytes(8).toString("hex")}`,
    ]),
  );
  const logger = createMemoryLogger();
  const emitted: AdapterEventInput[] = [];
  const abort = new AbortController();
  const context: AdapterContext = {
    adapterId: adapter.manifest.id,
    mode: "live",
    logger,
    clock: systemClock,
    config: Object.freeze({ ...config }),
    getSecret: (field) => secrets[field],
    emit: (event) => emitted.push(event),
    signal: abort.signal,
    correlationId: () => createCorrelationId(),
  };
  const session: Session = {
    adapter,
    context,
    emitted,
    logs: logger.records,
    abort,
    secrets,
    observed: [],
    shutDown: false,
  };
  if (options.initialize !== false) await adapter.initialize(context);
  return session;
}

export async function closeSession(session: Session): Promise<void> {
  if (session.shutDown) return;
  session.shutDown = true;
  session.abort.abort(new DOMException("conformance shutdown", "AbortError"));
  await session.adapter.shutdown();
}

/** Calls a port method by name and records the outcome for the secret scan. */
export function invoke(session: Session, name: string, params: unknown = {}): Promise<unknown> {
  const fn = (
    session.adapter as unknown as Record<
      string,
      ((p: unknown, c: CallContext) => Promise<unknown>) | undefined
    >
  )[name];
  if (!fn) throw new Error(`Adapter implementiert ${name}() nicht`);
  const result = fn.call(session.adapter, params, call());
  void settle(result).then((outcome) =>
    session.observed.push("value" in outcome ? outcome.value : describeError(outcome.error)),
  );
  return result;
}

export async function expectCode(
  promise: Promise<unknown>,
  code: string,
  retryable?: boolean,
): Promise<AdapterError> {
  const outcome = await settle(promise);
  expect("error" in outcome, `Aufruf hätte ${code} liefern müssen, lieferte aber einen Wert`).toBe(true);
  const error = (outcome as { error: unknown }).error;
  expect(error, "Fehler muss ein AdapterError sein (nie rohe Fehler nach außen)").toBeInstanceOf(
    AdapterError,
  );
  expect((error as AdapterError).code).toBe(code);
  if (retryable !== undefined) expect((error as AdapterError).retryable).toBe(retryable);
  return error as AdapterError;
}

// ---- static checks (suite checks 1-3) -----------------------------------------------------------------------------------

export function assertManifestValid(
  adapter: FridayAdapter,
  category: PortCategory,
  configSchema: Readonly<Record<string, unknown>>,
): void {
  assertContract("AdapterManifest", adapter.manifest, "manifest");
  expect(adapter.manifest.category).toBe(category);
  expect(adapter.manifest.apiVersion).toMatch(/^v\d+$/);
  expect(adapter.manifest.configSchemaRef).toBe((configSchema as { $id?: string }).$id);
  expect(() => new Ajv2020({ strict: false }).compile(configSchema as object)).not.toThrow();
  const properties = ((configSchema as { properties?: Record<string, unknown> }).properties ?? {}) as Record<
    string,
    unknown
  >;
  for (const field of adapter.manifest.secretFields) {
    expect(Object.keys(properties), `Secret-Feld '${field}' fehlt im Config-Schema`).toContain(field);
    expect(
      (properties[field] as { writeOnly?: boolean }).writeOnly,
      `Secret-Feld '${field}' muss writeOnly sein`,
    ).toBe(true);
  }
}

export function assertContractVersionCompatible(adapter: FridayAdapter): void {
  const major = (version: string) => Number.parseInt(version.split(".")[0] ?? "", 10);
  expect(major(adapter.manifest.contractVersion)).toBe(major(CONTRACT_VERSION));
}

export async function assertCapabilitiesMatchMethods(
  adapter: FridayAdapter,
  category: PortCategory,
): Promise<void> {
  const declared = new Set(adapter.manifest.capabilities);
  const allowed = allowedCapabilities(category);
  for (const capability of declared)
    expect(allowed.has(capability), `Capability '${capability}' gehört nicht zur Kategorie ${category}`).toBe(
      true,
    );
  for (const capability of (await adapter.getCapabilities()).capabilities)
    expect(declared.has(capability), `getCapabilities() meldet '${capability}' ohne Manifest-Eintrag`).toBe(
      true,
    );
  for (const [name, spec] of methodsOf(category)) {
    const implemented = typeof (adapter as unknown as Record<string, unknown>)[name] === "function";
    if (declared.has(spec.capability))
      expect(implemented, `${spec.capability} ist deklariert, aber ${name}() fehlt`).toBe(true);
    else if (!spec.required)
      expect(implemented, `${name}() ist implementiert, aber ${spec.capability} nicht deklariert`).toBe(
        false,
      );
    if (spec.required) {
      expect(declared.has(spec.capability), `Pflicht-Capability ${spec.capability} fehlt`).toBe(true);
      expect(implemented, `${name}() fehlt`).toBe(true);
    }
  }
}

/** Suite check 14 for one method: the result validates against its SDK schema exactly like in the registry. */
export function assertValidResult(category: PortCategory, method: string, result: unknown): void {
  const spec = methodsOf(category).find(([name]) => name === method)?.[1];
  if (!spec) throw new Error(`${method} ist kein Port-Methodenname der Kategorie ${category}`);
  validatePortResult(spec, result, { what: `${method} result` });
}

export function assertNoForbiddenKeys(value: unknown, forbidden: readonly string[]): void {
  expect(findForbiddenKeys(value, forbidden), "Fremdsystem-Felder im kanonischen Ergebnis").toEqual([]);
}

/** Suite check 7: canary secrets must not appear in anything the adapter produced. */
export function assertNoSecretLeak(session: Session): void {
  const haystack = JSON.stringify(session.observed, (_, value: unknown) =>
    value instanceof Error ? describeError(value) : value,
  );
  for (const [field, secret] of Object.entries(session.secrets)) {
    expect(
      haystack.includes(secret),
      `Secret '${field}' taucht in Rückgabewerten, Fehlern, Events oder Logs auf`,
    ).toBe(false);
    expect(haystack.includes(encodeURIComponent(secret))).toBe(false);
  }
}

/** Suite check 6 (error part): after shutdown a required read fails with ADAPTER_UNAVAILABLE and sends nothing. */
export async function assertFailsCleanlyAfterShutdown(
  session: Session,
  category: PortCategory,
): Promise<void> {
  const readMethod = methodsOf(category).find(([, spec]) => spec.required)?.[0] ?? "";
  const outcome = await settle(
    (
      (session.adapter as unknown as Record<string, (p: unknown, c: CallContext) => Promise<unknown>>)[
        readMethod
      ] ?? (async () => undefined)
    ).call(session.adapter, {}, call()),
  );
  expect("error" in outcome, "Aufrufe nach shutdown() müssen mit einem Fehler enden").toBe(true);
  expect((outcome as { error: unknown }).error).toBeInstanceOf(AdapterError);
  expect((outcome as { error: AdapterError }).error.code).toBe("ADAPTER_UNAVAILABLE");
}
