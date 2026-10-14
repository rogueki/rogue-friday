import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import {
  CONTRACT_VERSION,
  createCorrelationId,
  createIdempotencyKey,
  type JarvisEventType,
} from "@jarvis/sdk";
import {
  AdapterError,
  allowedCapabilities,
  assertCanonicalEvent,
  assertContract,
  createMemoryLogger,
  findForbiddenKeys,
  findMethodSpec,
  methodsOf,
  systemClock,
  validatePortResult,
  type AdapterContext,
  type AdapterEventInput,
  type CallContext,
  type JarvisAdapter,
  type LogRecord,
  type PortCategory,
} from "@jarvis/adapter-core";
import { createFakeUpstream, type FakeUpstream } from "./fake-upstream";

// ---------------------------------------------------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------------------------------------------------

export interface RouteRef {
  method: string;
  /** Path pattern in the fake upstream's syntax, e.g. `/items/:id`. */
  path: string;
}

/** Timing the adapter under test must apply to its config so that fault tests finish quickly. */
export interface ConformanceTiming {
  /** Per-attempt timeout of the adapter's HTTP client. */
  timeoutMs: number;
  /** Total attempts (first try + retries) of the adapter's HTTP client. */
  maxAttempts: number;
  /** Backoff base of the adapter's HTTP client. */
  retryBaseDelayMs: number;
  /** Background event polling interval; 0 = off (the suite triggers polls itself). */
  pollIntervalMs: number;
}

export interface ConformanceEnv {
  upstream: FakeUpstream;
  timing: ConformanceTiming;
}

export interface ConformanceTarget {
  adapter: JarvisAdapter;
  /** Config handed to `AdapterContext.config` (secrets are supplied by the suite through `getSecret`). */
  config?: Record<string, unknown>;
  /** JSON Schema exported by the adapter; checked against `manifest.configSchemaRef`. */
  configSchema?: Readonly<Record<string, unknown>>;
}

export interface ConformanceFixtures {
  /** Installs healthy routes serving `count` canonical-mappable items, paginated by `pageSize` (cursor/token semantics are the provider's). */
  seed(upstream: FakeUpstream, options: { count: number; pageSize: number }): void;
  /** List method used for the generic checks and the route behind it (fault injection targets this route). */
  list: { method: string; params?: Record<string, unknown>; route: RouteRef };
  /** Route probed by `healthCheck()`. Default: the list route. */
  healthRoute?: RouteRef;
  /** Body the list route returns for foreign data that cannot be mapped to the canonical model (valid JSON, wrong content). */
  invalidListBody(): unknown;
  /** Key names of the foreign system that must never show up in canonical output (e.g. `item_id`, `owner_bot`). */
  providerFields: readonly string[];
  /** Single-resource read; used for schema/error checks. */
  get?: { method: string; paramsFor(item: { id: string }): Record<string, unknown>; route: RouteRef };
  /** A mutating method that forwards idempotency keys. */
  mutation?: {
    method: string;
    params: Record<string, unknown>;
    route: RouteRef;
    /** Number of side effects (e.g. created records) the upstream has executed so far. */
    sideEffects(upstream: FakeUpstream): number;
  };
  /** Provider event source polled by `adapter.pollEvents()`. */
  events?: {
    route: RouteRef;
    /** Adds `count` raw provider events to the upstream. */
    publish(upstream: FakeUpstream, count: number): void;
    /** Canonical event type expected for each of the `publish`ed events (index-aligned, any count >= 3 is cycled). */
    expectedTypes: readonly JarvisEventType[];
  };
}

export interface ConformanceFaults {
  /** Latency of the slow-upstream test. Default: `timeoutMs * 4`. */
  slowDelayMs?: number;
  /** Upper bound for "ADAPTER_TIMEOUT within policy". Default: `timeoutMs * maxAttempts + 2 000`. */
  timeoutPolicyMs?: number;
}

export interface ConformanceOptions {
  /** Shown as the `describe` title. */
  name: string;
  category: PortCategory;
  /** `placeholder`: reduced profile for "not configured" adapters. Default `full`. */
  profile?: "full" | "placeholder";
  createAdapter(env: ConformanceEnv): ConformanceTarget | Promise<ConformanceTarget>;
  fixtures?: ConformanceFixtures;
  faults?: ConformanceFaults;
  timing?: Partial<ConformanceTiming>;
}

// ---------------------------------------------------------------------------------------------------------------------
// Session handling
// ---------------------------------------------------------------------------------------------------------------------

interface Session {
  upstream: FakeUpstream;
  adapter: JarvisAdapter;
  target: ConformanceTarget;
  context: AdapterContext;
  emitted: AdapterEventInput[];
  logs: LogRecord[];
  abort: AbortController;
  secrets: Record<string, string>;
  /** Everything an adapter returned, threw, emitted or logged during the test; scanned for secrets. */
  observed: unknown[];
  shutDown: boolean;
}

const DEFAULT_TIMING: ConformanceTiming = {
  timeoutMs: 250,
  maxAttempts: 3,
  retryBaseDelayMs: 5,
  pollIntervalMs: 0,
};

type Dynamic = Record<string, ((params: unknown, call: CallContext) => Promise<unknown>) | undefined>;

const call = (
  extra: Partial<CallContext> & { idempotencyKey?: string } = {},
): CallContext & { idempotencyKey?: string } => ({
  correlationId: createCorrelationId(),
  ...extra,
});

async function settle<T>(promise: Promise<T>): Promise<{ value: T } | { error: unknown }> {
  try {
    return { value: await promise };
  } catch (error) {
    return { error };
  }
}

function describeError(error: unknown): Record<string, unknown> {
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

// ---------------------------------------------------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------------------------------------------------

/** Registers the adapter conformance suite (PLAN §11.1) with Vitest. See docs/ADAPTER_CONFORMANCE.md. */
export function runConformanceSuite(options: ConformanceOptions): void {
  const profile = options.profile ?? "full";
  const timing: ConformanceTiming = { ...DEFAULT_TIMING, ...options.timing };
  const sessions: Session[] = [];

  async function open(
    overrides: Partial<ConformanceTiming> = {},
    initialize = true,
    prepare?: (upstream: FakeUpstream) => void,
  ): Promise<Session> {
    const upstream = await createFakeUpstream();
    const effectiveTiming = { ...timing, ...overrides };
    const target = await options.createAdapter({ upstream, timing: effectiveTiming });
    const { adapter } = target;
    const secrets = Object.fromEntries(
      adapter.manifest.secretFields.map((field) => [
        field,
        `sk_canary_${field}_${randomBytes(8).toString("hex")}`,
      ]),
    );
    const logger = createMemoryLogger();
    const emitted: AdapterEventInput[] = [];
    const abort = new AbortController();
    const observed: unknown[] = [];
    const context: AdapterContext = {
      adapterId: adapter.manifest.id,
      mode: "live",
      logger,
      clock: systemClock,
      config: Object.freeze({ ...(target.config ?? {}) }),
      getSecret: (field) => secrets[field],
      emit: (event) => {
        assertCanonicalEvent(event, `${adapter.manifest.id} emit`);
        emitted.push(event);
      },
      signal: abort.signal,
      correlationId: () => createCorrelationId(),
    };
    const session: Session = {
      upstream,
      adapter,
      target,
      context,
      emitted,
      logs: logger.records,
      abort,
      secrets,
      observed,
      shutDown: false,
    };
    sessions.push(session);
    prepare?.(upstream);
    if (initialize) await adapter.initialize(context);
    return session;
  }

  async function shutdown(session: Session): Promise<void> {
    if (session.shutDown) return;
    session.shutDown = true;
    session.abort.abort(new DOMException("conformance shutdown", "AbortError"));
    await session.adapter.shutdown();
  }

  afterEach(async () => {
    for (const session of sessions.splice(0)) {
      await shutdown(session).catch(() => {});
      await session.upstream.close();
    }
  });

  const method = (session: Session, name: string) => {
    const fn = (session.adapter as unknown as Dynamic)[name];
    if (!fn) throw new Error(`Adapter implementiert ${name}() nicht`);
    return (params: unknown, extra?: Partial<CallContext> & { idempotencyKey?: string }) => {
      const result = fn.call(session.adapter, params, call(extra));
      void settle(result).then((outcome) =>
        session.observed.push("value" in outcome ? outcome.value : describeError(outcome.error)),
      );
      return result;
    };
  };

  const fixtures = options.fixtures;
  const requireFixtures = (): ConformanceFixtures => {
    if (!fixtures) throw new Error(`${options.name}: Profil 'full' benötigt 'fixtures'`);
    return fixtures;
  };
  const listCall = (session: Session, params: Record<string, unknown> = {}) => {
    const f = requireFixtures();
    return method(session, f.list.method)({ ...(f.list.params ?? {}), ...params });
  };
  const healthy = (session: Session, count = 5, pageSize = 2) =>
    requireFixtures().seed(session.upstream, { count, pageSize });
  const route = (ref: RouteRef) => [ref.method, ref.path] as const;
  const expectCode = async (
    promise: Promise<unknown>,
    code: string,
    retryable?: boolean,
  ): Promise<AdapterError> => {
    const outcome = await settle(promise);
    expect("error" in outcome, `Aufruf hätte ${code} liefern müssen, lieferte aber einen Wert`).toBe(true);
    const error = (outcome as { error: unknown }).error;
    expect(error, "Fehler muss ein AdapterError sein (nie rohe Fehler nach außen)").toBeInstanceOf(
      AdapterError,
    );
    expect((error as AdapterError).code).toBe(code);
    if (retryable !== undefined) expect((error as AdapterError).retryable).toBe(retryable);
    return error as AdapterError;
  };

  describe(`Conformance: ${options.name} [${options.category}, ${profile}]`, () => {
    // ---- manifest / contract ----------------------------------------------------------------------------------
    it("manifest valid", async () => {
      const { adapter, target } = await open({}, false);
      assertContract("AdapterManifest", adapter.manifest, "manifest");
      expect(adapter.manifest.category).toBe(options.category);
      expect(adapter.manifest.apiVersion).toMatch(/^v\d+$/);
      if (target.configSchema) {
        expect(adapter.manifest.configSchemaRef).toBe((target.configSchema as { $id?: string }).$id);
        const ajv = new Ajv2020({ strict: false });
        expect(() => ajv.compile(target.configSchema as object)).not.toThrow();
        const properties = ((target.configSchema as { properties?: Record<string, unknown> }).properties ??
          {}) as Record<string, unknown>;
        for (const field of adapter.manifest.secretFields) {
          expect(Object.keys(properties), `Secret-Feld '${field}' fehlt im Config-Schema`).toContain(field);
        }
      }
    });

    it("contract version compatible", async () => {
      const { adapter } = await open({}, false);
      const major = (version: string) => Number.parseInt(version.split(".")[0] ?? "", 10);
      expect(major(adapter.manifest.contractVersion)).toBe(major(CONTRACT_VERSION));
    });

    it("capabilities match the implemented port methods", async () => {
      const session = await open();
      const { adapter } = session;
      const declared = new Set(adapter.manifest.capabilities);
      const allowed = allowedCapabilities(options.category);
      for (const capability of declared) {
        expect(
          allowed.has(capability),
          `Capability '${capability}' gehört nicht zur Kategorie ${options.category}`,
        ).toBe(true);
      }
      const reported = (await adapter.getCapabilities()).capabilities;
      for (const capability of reported)
        expect(
          declared.has(capability),
          `getCapabilities() meldet '${capability}' ohne Manifest-Eintrag`,
        ).toBe(true);

      if (profile === "placeholder") {
        expect(adapter.manifest.capabilities, "Platzhalter dürfen keine Capabilities bewerben").toEqual([]);
        expect(reported).toEqual([]);
      }
      for (const [name, spec] of methodsOf(options.category)) {
        const implemented = typeof (adapter as unknown as Dynamic)[name] === "function";
        if (declared.has(spec.capability)) {
          expect(implemented, `${spec.capability} ist deklariert, aber ${name}() fehlt`).toBe(true);
        } else if (!spec.required) {
          expect(implemented, `${name}() ist implementiert, aber ${spec.capability} nicht deklariert`).toBe(
            false,
          );
        }
      }
      if (profile === "full") {
        for (const [name, spec] of methodsOf(options.category)) {
          if (spec.required) {
            expect(declared.has(spec.capability), `Pflicht-Capability ${spec.capability} fehlt`).toBe(true);
            expect(typeof (adapter as unknown as Dynamic)[name], `${name}() fehlt`).toBe("function");
          }
        }
      }
    });

    // ---- health / offline -------------------------------------------------------------------------------------
    it("healthCheck returns the contract shape with latency", async () => {
      const session = await open();
      if (profile === "full") healthy(session);
      const report = await session.adapter.healthCheck();
      expect(["online", "degraded", "offline", "unknown", "paused"]).toContain(report.status);
      expect(report.latencyMs === null || (Number.isInteger(report.latencyMs) && report.latencyMs >= 0)).toBe(
        true,
      );
      if (profile === "full") {
        expect(report.status).toBe("online");
        expect(report.latencyMs).not.toBeNull();
      } else {
        expect(report.status).not.toBe("online");
      }
      session.observed.push(report);
    });

    it("offline behaviour: upstream down -> health offline without throwing, calls fail with ADAPTER_UNAVAILABLE", async () => {
      const session = await open();
      if (profile === "full") healthy(session);
      await session.upstream.setOffline(true);
      const report = await session.adapter.healthCheck();
      expect(report.status).toBe("offline");
      if (profile === "placeholder") {
        expect(`${report.message ?? ""}`.toLowerCase()).toContain("nicht konfiguriert");
        await expectCode(
          method(session, methodsOf(options.category).find(([, s]) => s.required)?.[0] ?? "")({}),
          "ADAPTER_UNAVAILABLE",
        );
        return;
      }
      await expectCode(listCall(session), "ADAPTER_UNAVAILABLE", true);
      await session.upstream.setOffline(false);
      healthy(session);
      expect(
        (await session.adapter.healthCheck()).status,
        "Adapter muss nach Rückkehr des Upstreams wieder online melden",
      ).toBe("online");
    });

    // ---- profile gate -----------------------------------------------------------------------------------------
    it("shutdown releases resources and later calls fail cleanly", async () => {
      const f = fixtures;
      const polling = profile === "full" && f?.events ? 25 : 0;
      const session = await open({ pollIntervalMs: polling }, true, (upstream) => {
        if (profile !== "full" || !f) return;
        f.seed(upstream, { count: 3, pageSize: 2 });
        f.events?.publish(upstream, 1);
      });
      await new Promise((resolve) => setTimeout(resolve, polling * 2));
      await shutdown(session);
      await shutdown(session); // idempotent
      const requestsAtShutdown = session.upstream.requests.length;
      await new Promise((resolve) => setTimeout(resolve, 120));
      expect(
        session.upstream.requests.length,
        "Adapter sendet nach shutdown() weiter Requests (Timer/Polling nicht beendet)",
      ).toBe(requestsAtShutdown);
      const readMethod = methodsOf(options.category).find(([, spec]) => spec.required)?.[0] ?? "";
      const outcome = await settle(
        ((session.adapter as unknown as Dynamic)[readMethod] ?? (async () => undefined)).call(
          session.adapter,
          {},
          call(),
        ),
      );
      expect("error" in outcome, "Aufrufe nach shutdown() müssen mit einem Fehler enden").toBe(true);
      expect((outcome as { error: unknown }).error).toBeInstanceOf(AdapterError);
      expect((outcome as { error: AdapterError }).error.code).toBe("ADAPTER_UNAVAILABLE");
      expect(session.upstream.requests.length).toBe(requestsAtShutdown);
    });

    it("no secret leaks in results, errors, events, health reports or logs", async () => {
      const session = await open();
      const { upstream, adapter } = session;
      const echo = (request: { headers: Record<string, string> }) => ({
        error: "rejected",
        echo: request.headers,
      });
      if (profile === "full") {
        const f = requireFixtures();
        healthy(session);
        await settle(listCall(session));
        for (const status of [401, 403, 500, 429]) {
          upstream.clearFaults();
          upstream.fault(...route(f.list.route), { status, body: echo });
          await settle(listCall(session));
        }
        upstream.clearFaults();
        upstream.fault(...route(f.list.route), { raw: `{"broken": true, `, status: 200 });
        await settle(listCall(session));
        upstream.clearFaults();
        upstream.fault(...route(f.list.route), { drop: true });
        await settle(listCall(session));
        upstream.clearFaults();
        if (f.mutation)
          await settle(
            method(session, f.mutation.method)(f.mutation.params, { idempotencyKey: createIdempotencyKey() }),
          );
        if (f.events) {
          f.events.publish(upstream, 2);
          await settle(adapter.pollEvents?.() ?? Promise.resolve(0));
        }
      } else {
        await settle(method(session, methodsOf(options.category).find(([, s]) => s.required)?.[0] ?? "")({}));
      }
      session.observed.push(
        await adapter.healthCheck(),
        session.emitted,
        session.logs,
        await adapter.getCapabilities(),
      );
      await shutdown(session);
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
    });

    if (profile === "placeholder") return;

    // ---- full profile ------------------------------------------------------------------------------------------
    it("timeout handling: slow upstream -> ADAPTER_TIMEOUT within the retry policy", async () => {
      const f = requireFixtures();
      const session = await open();
      healthy(session);
      const slow = options.faults?.slowDelayMs ?? timing.timeoutMs * 4;
      const policyMs = options.faults?.timeoutPolicyMs ?? timing.timeoutMs * timing.maxAttempts + 2_000;
      session.upstream.fault(...route(f.list.route), { latencyMs: slow });
      const started = Date.now();
      const error = await expectCode(listCall(session), "ADAPTER_TIMEOUT", true);
      expect(Date.now() - started).toBeLessThan(policyMs);
      expect(error.message.length).toBeGreaterThan(0);
    });

    it("retry behaviour: transient 503 then success succeeds; permanent 4xx is not retried", async () => {
      const f = requireFixtures();
      const session = await open();
      healthy(session);
      const listRoute = route(f.list.route);
      session.upstream.fault(...listRoute, { statusSequence: [503, 503] });
      const page = (await listCall(session)) as { items: unknown[] };
      expect(Array.isArray(page.items)).toBe(true);
      expect(session.upstream.requestsFor(...listRoute).length, "2 Fehlversuche + 1 Erfolg erwartet").toBe(3);

      for (const status of [400, 403, 404, 409, 422]) {
        session.upstream.clearFaults();
        const before = session.upstream.requestsFor(...listRoute).length;
        session.upstream.fault(...listRoute, { status });
        await expectCode(
          listCall(session),
          status === 400 || status === 422
            ? "VALIDATION_FAILED"
            : status === 403
              ? "FORBIDDEN"
              : status === 404
                ? "NOT_FOUND"
                : "CONFLICT",
          false,
        );
        expect(
          session.upstream.requestsFor(...listRoute).length - before,
          `HTTP ${status} darf nicht wiederholt werden`,
        ).toBe(1);
      }
    });

    it("retries are bounded for permanent 5xx", async () => {
      const f = requireFixtures();
      const session = await open();
      healthy(session);
      session.upstream.fault(...route(f.list.route), { status: 503 });
      await expectCode(listCall(session), "ADAPTER_UNAVAILABLE", true);
      expect(session.upstream.requestsFor(...route(f.list.route)).length).toBeLessThanOrEqual(
        timing.maxAttempts,
      );
      expect(session.upstream.requestsFor(...route(f.list.route)).length).toBeGreaterThan(1);
    });

    it("empty response -> valid empty page", async () => {
      const f = requireFixtures();
      const session = await open();
      f.seed(session.upstream, { count: 0, pageSize: 2 });
      const page = (await listCall(session)) as {
        items: unknown[];
        pageInfo: { hasNextPage: boolean; nextCursor: string | null };
      };
      expect(page.items).toEqual([]);
      expect(page.pageInfo.hasNextPage).toBe(false);
      expect(page.pageInfo.nextCursor).toBeNull();
      validatePortResult(requireSpec(f.list.method), page, { what: "empty page" });
    });

    it("pagination: a cursor walk returns every item exactly once and hasNextPage is consistent", async () => {
      const f = requireFixtures();
      const session = await open();
      const total = 7;
      f.seed(session.upstream, { count: total, pageSize: 3 });
      const ids: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      for (; pages < 20; pages += 1) {
        const page = (await listCall(session, { limit: 3, ...(cursor ? { cursor } : {}) })) as {
          items: Array<{ id: string }>;
          pageInfo: { hasNextPage: boolean; nextCursor: string | null };
        };
        ids.push(...page.items.map((item) => item.id));
        expect(page.pageInfo.hasNextPage, "hasNextPage muss zu nextCursor passen").toBe(
          page.pageInfo.nextCursor !== null,
        );
        if (!page.pageInfo.hasNextPage) break;
        expect(page.pageInfo.nextCursor).not.toBe(cursor);
        cursor = page.pageInfo.nextCursor;
      }
      expect(pages).toBeLessThan(20);
      expect(ids).toHaveLength(total);
      expect(new Set(ids).size, "Doppelte Items im Cursor-Walk").toBe(total);
      expect(pages + 1).toBeGreaterThan(1);
    });

    it("invalid foreign data is rejected with VALIDATION_FAILED and never forwarded", async () => {
      const f = requireFixtures();
      const session = await open();
      healthy(session);
      session.upstream.route(f.list.route.method, f.list.route.path, { body: f.invalidListBody() });
      const outcome = await settle(listCall(session));
      expect("error" in outcome, "Ungültige Fremddaten wurden durchgereicht").toBe(true);
      const error = (outcome as { error: unknown }).error;
      expect(error).toBeInstanceOf(AdapterError);
      expect((error as AdapterError).code).toBe("VALIDATION_FAILED");
      expect((error as AdapterError).retryable).toBe(false);
    });

    it("schema mapping: every returned object validates against its SDK schema", async () => {
      const f = requireFixtures();
      const session = await open();
      healthy(session, 5, 2);
      const page = (await listCall(session)) as { items: Array<{ id: string }> };
      expect(page.items.length).toBeGreaterThan(0);
      validatePortResult(requireSpec(f.list.method), page, { what: `${f.list.method} result` });
      if (f.get) {
        const single = await method(
          session,
          f.get.method,
        )(f.get.paramsFor({ id: (page.items[0] as { id: string }).id }));
        validatePortResult(requireSpec(f.get.method), single, { what: `${f.get.method} result` });
      }
      if (f.mutation) {
        const created = await method(session, f.mutation.method)(f.mutation.params, {
          idempotencyKey: createIdempotencyKey(),
        });
        validatePortResult(requireSpec(f.mutation.method), created, { what: `${f.mutation.method} result` });
      }
    });

    it("error normalization: every upstream failure kind maps to a canonical code", async () => {
      const f = requireFixtures();
      const table: Array<[string, Record<string, unknown>, string, boolean]> = [
        ["HTTP 400", { status: 400 }, "VALIDATION_FAILED", false],
        ["HTTP 401", { status: 401 }, "UNAUTHENTICATED", false],
        ["HTTP 403", { status: 403 }, "FORBIDDEN", false],
        ["HTTP 404", { status: 404 }, "NOT_FOUND", false],
        ["HTTP 409", { status: 409 }, "CONFLICT", false],
        ["HTTP 422", { status: 422 }, "VALIDATION_FAILED", false],
        ["HTTP 429", { status: 429, headers: { "retry-after": "0" } }, "RATE_LIMITED", true],
        ["HTTP 500", { status: 500 }, "ADAPTER_UNAVAILABLE", true],
        ["HTTP 502", { status: 502 }, "ADAPTER_UNAVAILABLE", true],
        ["HTTP 503", { status: 503 }, "ADAPTER_UNAVAILABLE", true],
        ["HTTP 504", { status: 504 }, "ADAPTER_TIMEOUT", true],
        ["dropped connection", { drop: true }, "ADAPTER_UNAVAILABLE", true],
        ["malformed JSON", { status: 200, raw: "{not json" }, "VALIDATION_FAILED", false],
      ];
      const session = await open();
      healthy(session);
      for (const [label, fault, code, retryable] of table) {
        session.upstream.clearFaults();
        session.upstream.fault(...route(f.list.route), fault);
        const error = await expectCode(listCall(session), code, retryable).catch((cause: unknown) => {
          throw new Error(`${label}: ${cause instanceof Error ? cause.message : String(cause)}`);
        });
        expect(error.severity).toMatch(/^(info|warning|error|critical)$/);
        expect(typeof error.details).toBe("object");
      }
      session.upstream.clearFaults();
      await session.upstream.setOffline(true);
      await expectCode(listCall(session), "ADAPTER_UNAVAILABLE", true); // ECONNREFUSED
      if (f.get) {
        await session.upstream.setOffline(false);
        healthy(session);
        session.upstream.fault(...route(f.get.route), { status: 404 });
        await expectCode(
          method(session, f.get.method)(f.get.paramsFor({ id: "task_00000000000000000000000000" })),
          "NOT_FOUND",
          false,
        );
      }
    });

    it("auth error (401) -> UNAUTHENTICATED, permission error (403) -> FORBIDDEN, neither retried", async () => {
      const f = requireFixtures();
      const session = await open();
      healthy(session);
      const listRoute = route(f.list.route);
      for (const [status, code] of [
        [401, "UNAUTHENTICATED"],
        [403, "FORBIDDEN"],
      ] as const) {
        session.upstream.clearFaults();
        const before = session.upstream.requestsFor(...listRoute).length;
        session.upstream.fault(...listRoute, { status });
        await expectCode(listCall(session), code, false);
        expect(session.upstream.requestsFor(...listRoute).length - before).toBe(1);
      }
      const report = await (async () => {
        session.upstream.clearFaults();
        session.upstream.fault(...route(f.healthRoute ?? f.list.route), { status: 401 });
        return session.adapter.healthCheck();
      })();
      expect(["offline", "degraded"], "healthCheck bei 401 darf nicht 'online' melden").toContain(
        report.status,
      );
    });

    it.skipIf(!fixtures?.events)(
      "event mapping: raw provider events become valid canonical events",
      async () => {
        const f = requireFixtures();
        if (!f.events) return;
        const session = await open();
        healthy(session);
        expect(typeof session.adapter.pollEvents, "Adapter mit Events muss pollEvents() anbieten").toBe(
          "function",
        );
        const count = f.events.expectedTypes.length;
        f.events.publish(session.upstream, count);
        const emitted = await session.adapter.pollEvents?.();
        expect(emitted).toBe(count);
        expect(session.emitted.map((event) => event.type)).toEqual([...f.events.expectedTypes]);
        for (const event of session.emitted) {
          assertCanonicalEvent(event);
          expect(findForbiddenKeys(event.data, f.providerFields)).toEqual([]);
          expect(event.subject.length).toBeGreaterThan(0);
        }
      },
    );

    it.skipIf(!fixtures?.events)(
      "reconnect: after a dropped event stream the adapter resumes without loss or duplicates",
      async () => {
        const f = requireFixtures();
        if (!f.events) return;
        const session = await open();
        healthy(session);
        const { events } = f;
        events.publish(session.upstream, 2);
        session.upstream.fault(...route(events.route), { drop: true, times: timing.maxAttempts });
        await expectCode(session.adapter.pollEvents?.() ?? Promise.resolve(0), "ADAPTER_UNAVAILABLE", true);
        expect(session.emitted).toHaveLength(0);

        session.upstream.clearFaults();
        expect(await session.adapter.pollEvents?.()).toBe(2);
        expect(
          await session.adapter.pollEvents?.(),
          "Zweiter Poll ohne neue Events darf nichts doppelt liefern",
        ).toBe(0);
        events.publish(session.upstream, 1);
        expect(await session.adapter.pollEvents?.()).toBe(1);
        expect(session.emitted).toHaveLength(3);
      },
    );

    it.skipIf(!fixtures?.mutation)(
      "idempotency: the same key twice causes one side effect and returns the same result",
      async () => {
        const f = requireFixtures();
        if (!f.mutation) return;
        const session = await open();
        healthy(session);
        const key = createIdempotencyKey();
        const first = (await method(session, f.mutation.method)(f.mutation.params, {
          idempotencyKey: key,
        })) as { data: { id: string } };
        const second = (await method(session, f.mutation.method)(f.mutation.params, {
          idempotencyKey: key,
        })) as { data: { id: string } };
        expect(
          f.mutation.sideEffects(session.upstream),
          "Gleicher Idempotency-Key darf nur einen Seiteneffekt auslösen",
        ).toBe(1);
        expect(second.data.id).toBe(first.data.id);
        const sent = session.upstream
          .requestsFor(...route(f.mutation.route))
          .map((request) => request.headers["idempotency-key"]);
        expect(
          sent.every((value) => value === key),
          "Idempotency-Key muss an das Fremdsystem weitergereicht werden",
        ).toBe(true);
        await method(session, f.mutation.method)(f.mutation.params, {
          idempotencyKey: createIdempotencyKey(),
        });
        expect(f.mutation.sideEffects(session.upstream)).toBe(2);
      },
    );

    it.skipIf(!fixtures?.mutation)("mutations are not retried without an idempotency key", async () => {
      const f = requireFixtures();
      if (!f.mutation) return;
      const session = await open();
      healthy(session);
      session.upstream.fault(...route(f.mutation.route), { status: 503 });
      await expectCode(method(session, f.mutation.method)(f.mutation.params), "ADAPTER_UNAVAILABLE", true);
      expect(
        session.upstream.requestsFor(...route(f.mutation.route)).length,
        "Mutation ohne Idempotency-Key darf nicht wiederholt werden",
      ).toBe(1);
    });

    it("no provider-specific fields in canonical models", async () => {
      const f = requireFixtures();
      const session = await open();
      healthy(session, 4, 2);
      const page = (await listCall(session)) as { items: unknown[] };
      expect(page.items.length).toBeGreaterThan(0);
      expect(findForbiddenKeys(page, f.providerFields)).toEqual([]);
      if (f.mutation) {
        const created = await method(session, f.mutation.method)(f.mutation.params, {
          idempotencyKey: createIdempotencyKey(),
        });
        expect(findForbiddenKeys(created, f.providerFields)).toEqual([]);
      }
      // The id must be a contract id, not the provider's.
      for (const item of page.items as Array<{ id: string; source: { externalId?: string } }>) {
        expect(item.id).toMatch(/^[a-z]+_[0-9A-Za-z]{26}$/);
      }
    });
  });

  function requireSpec(methodName: string) {
    const spec = findMethodSpec(options.category, methodName);
    if (!spec) throw new Error(`${methodName} ist kein Port-Methodenname der Kategorie ${options.category}`);
    return spec;
  }
}
