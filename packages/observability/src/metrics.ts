export type MetricType = 'counter' | 'gauge' | 'histogram';
export type Labels = Readonly<Record<string, string | number | boolean>>;

const NAME_PATTERN = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
const LABEL_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
/** Guard against unbounded label cardinality (e.g. raw URLs as a label). */
const MAX_SERIES_PER_METRIC = 500;

export const DEFAULT_LATENCY_BUCKETS_SECONDS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] as const;

export interface CounterSeries {
  labels: Record<string, string>;
  value: number;
}
export interface HistogramSeries {
  labels: Record<string, string>;
  count: number;
  sum: number;
  /** Cumulative counts per upper bound; the final bucket has `le: "+Inf"`. */
  buckets: { le: string; count: number }[];
}
export interface MetricSnapshot {
  name: string;
  type: MetricType;
  help: string;
  series: (CounterSeries | HistogramSeries)[];
}
export interface MetricsSnapshot {
  time: string;
  metrics: MetricSnapshot[];
}

function labelKey(labelNames: readonly string[], labels: Labels | undefined): string {
  if (labelNames.length === 0) return '';
  return labelNames.map((name) => `${name}=${String(labels?.[name] ?? '')}`).join('\u0001');
}

function normalizeLabels(labelNames: readonly string[], labels: Labels | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of labelNames) out[name] = String(labels?.[name] ?? '');
  return out;
}

abstract class Metric<TSeries> {
  protected readonly series = new Map<string, { labels: Record<string, string>; state: TSeries }>();
  dropped = 0;

  constructor(
    readonly name: string,
    readonly help: string,
    readonly type: MetricType,
    readonly labelNames: readonly string[],
  ) {}

  protected slot(labels: Labels | undefined, create: () => TSeries): TSeries | undefined {
    const key = labelKey(this.labelNames, labels);
    const existing = this.series.get(key);
    if (existing) return existing.state;
    if (this.series.size >= MAX_SERIES_PER_METRIC) {
      this.dropped += 1;
      return undefined;
    }
    const state = create();
    this.series.set(key, { labels: normalizeLabels(this.labelNames, labels), state });
    return state;
  }

  abstract snapshot(): MetricSnapshot;
  abstract reset(): void;
}

export class Counter extends Metric<{ value: number }> {
  inc(labels?: Labels, by = 1): void {
    if (by < 0 || !Number.isFinite(by)) return;
    const state = this.slot(labels, () => ({ value: 0 }));
    if (state) state.value += by;
  }
  value(labels?: Labels): number {
    return this.series.get(labelKey(this.labelNames, labels))?.state.value ?? 0;
  }
  /** Sum across all label combinations. */
  total(): number {
    let sum = 0;
    for (const { state } of this.series.values()) sum += state.value;
    return sum;
  }
  snapshot(): MetricSnapshot {
    return {
      name: this.name,
      type: 'counter',
      help: this.help,
      series: [...this.series.values()].map((s) => ({ labels: s.labels, value: s.state.value })),
    };
  }
  reset(): void {
    this.series.clear();
  }
}

export class Gauge extends Metric<{ value: number }> {
  set(value: number, labels?: Labels): void {
    if (!Number.isFinite(value)) return;
    const state = this.slot(labels, () => ({ value: 0 }));
    if (state) state.value = value;
  }
  inc(labels?: Labels, by = 1): void {
    const state = this.slot(labels, () => ({ value: 0 }));
    if (state) state.value += by;
  }
  dec(labels?: Labels, by = 1): void {
    this.inc(labels, -by);
  }
  value(labels?: Labels): number | undefined {
    return this.series.get(labelKey(this.labelNames, labels))?.state.value;
  }
  remove(labels?: Labels): void {
    this.series.delete(labelKey(this.labelNames, labels));
  }
  snapshot(): MetricSnapshot {
    return {
      name: this.name,
      type: 'gauge',
      help: this.help,
      series: [...this.series.values()].map((s) => ({ labels: s.labels, value: s.state.value })),
    };
  }
  reset(): void {
    this.series.clear();
  }
}

interface HistogramState {
  count: number;
  sum: number;
  counts: number[];
}

export class Histogram extends Metric<HistogramState> {
  readonly bounds: readonly number[];

  constructor(name: string, help: string, labelNames: readonly string[], buckets: readonly number[]) {
    super(name, help, 'histogram', labelNames);
    const sorted = [...buckets].sort((a, b) => a - b);
    if (sorted.length === 0 || sorted.some((b, i) => !Number.isFinite(b) || (i > 0 && b === sorted[i - 1]))) {
      throw new Error(`Histogram ${name}: buckets must be unique finite numbers`);
    }
    this.bounds = sorted;
  }

  observe(value: number, labels?: Labels): void {
    if (!Number.isFinite(value)) return;
    const state = this.slot(labels, () => ({ count: 0, sum: 0, counts: new Array<number>(this.bounds.length + 1).fill(0) }));
    if (!state) return;
    state.count += 1;
    state.sum += value;
    let index = this.bounds.findIndex((bound) => value <= bound);
    if (index === -1) index = this.bounds.length;
    state.counts[index] = (state.counts[index] ?? 0) + 1;
  }

  /** Returns a function that observes the elapsed seconds since the call. */
  startTimer(labels?: Labels): (extraLabels?: Labels) => number {
    const start = process.hrtime.bigint();
    return (extraLabels) => {
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      this.observe(seconds, { ...labels, ...extraLabels });
      return seconds;
    };
  }

  /** Estimated quantile from bucket counts (upper-bound approximation), or undefined without data. */
  quantile(q: number, labels?: Labels): number | undefined {
    const state = this.series.get(labelKey(this.labelNames, labels))?.state;
    if (!state || state.count === 0) return undefined;
    const target = q * state.count;
    let cumulative = 0;
    for (let i = 0; i < state.counts.length; i += 1) {
      cumulative += state.counts[i] ?? 0;
      if (cumulative >= target) return i < this.bounds.length ? this.bounds[i] : (this.bounds[this.bounds.length - 1] ?? 0);
    }
    return undefined;
  }

  snapshot(): MetricSnapshot {
    return {
      name: this.name,
      type: 'histogram',
      help: this.help,
      series: [...this.series.values()].map(({ labels, state }) => {
        let cumulative = 0;
        const buckets = state.counts.map((count, i) => {
          cumulative += count;
          return { le: i < this.bounds.length ? String(this.bounds[i]) : '+Inf', count: cumulative };
        });
        return { labels, count: state.count, sum: state.sum, buckets };
      }),
    };
  }
  reset(): void {
    this.series.clear();
  }
}

export class MetricsRegistry {
  private readonly metrics = new Map<string, Counter | Gauge | Histogram>();

  private register<T extends Counter | Gauge | Histogram>(metric: T): T {
    if (!NAME_PATTERN.test(metric.name)) throw new Error(`Invalid metric name: ${metric.name}`);
    for (const label of metric.labelNames) {
      if (!LABEL_PATTERN.test(label) || label === 'le') throw new Error(`Invalid label name "${label}" on ${metric.name}`);
    }
    const existing = this.metrics.get(metric.name);
    if (existing) {
      if (existing.type !== metric.type) throw new Error(`Metric ${metric.name} already registered as ${existing.type}`);
      return existing as T;
    }
    this.metrics.set(metric.name, metric);
    return metric;
  }

  counter(name: string, help: string, labelNames: readonly string[] = []): Counter {
    return this.register(new Counter(name, help, 'counter', labelNames));
  }

  gauge(name: string, help: string, labelNames: readonly string[] = []): Gauge {
    return this.register(new Gauge(name, help, 'gauge', labelNames));
  }

  histogram(
    name: string,
    help: string,
    labelNames: readonly string[] = [],
    buckets: readonly number[] = DEFAULT_LATENCY_BUCKETS_SECONDS,
  ): Histogram {
    return this.register(new Histogram(name, help, labelNames, buckets));
  }

  snapshot(now: Date = new Date()): MetricsSnapshot {
    return {
      time: now.toISOString(),
      metrics: [...this.metrics.values()].map((m) => m.snapshot()).sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  /** Prometheus text exposition format 0.0.4. */
  renderPrometheus(): string {
    const lines: string[] = [];
    for (const snap of this.snapshot().metrics) {
      lines.push(`# HELP ${snap.name} ${escapeHelp(snap.help)}`);
      lines.push(`# TYPE ${snap.name} ${snap.type}`);
      for (const series of snap.series) {
        if ('buckets' in series) {
          for (const bucket of series.buckets) {
            lines.push(`${snap.name}_bucket${formatLabels({ ...series.labels, le: bucket.le })} ${bucket.count}`);
          }
          lines.push(`${snap.name}_sum${formatLabels(series.labels)} ${formatNumber(series.sum)}`);
          lines.push(`${snap.name}_count${formatLabels(series.labels)} ${series.count}`);
        } else {
          lines.push(`${snap.name}${formatLabels(series.labels)} ${formatNumber(series.value)}`);
        }
      }
    }
    return `${lines.join('\n')}\n`;
  }

  reset(): void {
    for (const metric of this.metrics.values()) metric.reset();
  }
}

function escapeHelp(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\n/g, '\\n');
}
function escapeLabel(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}
function formatLabels(labels: Record<string, string>): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return '';
  return `{${entries.map(([k, v]) => `${k}="${escapeLabel(v)}"`).join(',')}}`;
}
function formatNumber(value: number): string {
  if (Number.isNaN(value)) return 'NaN';
  if (value === Infinity) return '+Inf';
  if (value === -Infinity) return '-Inf';
  return String(value);
}

/** Events/s over a sliding window, computed from timestamps (counters alone cannot give a rate). */
export class RateMeter {
  private readonly stamps: number[] = [];
  constructor(
    private readonly windowMs = 10_000,
    private readonly now: () => number = Date.now,
  ) {}

  mark(count = 1): void {
    const t = this.now();
    for (let i = 0; i < count; i += 1) this.stamps.push(t);
    this.trim(t);
  }

  perSecond(): number {
    const t = this.now();
    this.trim(t);
    return this.stamps.length / (this.windowMs / 1000);
  }

  private trim(t: number): void {
    const cutoff = t - this.windowMs;
    let drop = 0;
    while (drop < this.stamps.length && (this.stamps[drop] ?? 0) <= cutoff) drop += 1;
    if (drop > 0) this.stamps.splice(0, drop);
  }
}

export type AdapterHealthState = 'healthy' | 'degraded' | 'down' | 'unknown';
const HEALTH_VALUE: Record<AdapterHealthState, number> = { healthy: 1, degraded: 0.5, down: 0, unknown: -1 };

export interface FrontendReport {
  orbFps?: number;
  webglMemoryBytes?: number;
  errors?: { kind: string; count?: number }[];
}

export interface DashboardSummary {
  time: string;
  http: {
    requestsTotal: number;
    errorsTotal: number;
    errorRate: number;
    latencyP50Seconds?: number;
    latencyP95Seconds?: number;
  };
  websocket: { connections: number };
  events: { total: number; perSecond: number };
  adapters: { adapter: string; state: AdapterHealthState }[];
  cache: { hits: number; misses: number; hitRatio: number | null };
  frontend: { orbFps: number | null; webglMemoryBytes: number | null; errorsTotal: number };
}

/** Pre-defined JARVIS metrics (PLAN §50.3) on top of a registry. */
export function createJarvisMetrics(registry: MetricsRegistry = new MetricsRegistry(), now: () => number = Date.now) {
  const httpRequests = registry.counter('jarvis_http_requests_total', 'HTTP requests handled', ['method', 'route', 'status']);
  const httpErrors = registry.counter('jarvis_http_errors_total', 'HTTP responses with status >= 500', ['method', 'route']);
  const httpLatency = registry.histogram('jarvis_http_request_duration_seconds', 'HTTP request latency', ['method', 'route']);
  const wsConnections = registry.gauge('jarvis_ws_connections', 'Open WebSocket connections');
  const events = registry.counter('jarvis_events_total', 'Realtime events published', ['type']);
  const adapterHealth = registry.gauge(
    'jarvis_adapter_health',
    'Adapter health: 1 healthy, 0.5 degraded, 0 down, -1 unknown',
    ['adapter'],
  );
  const cache = registry.counter('jarvis_cache_requests_total', 'Cache lookups', ['result']);
  const orbFps = registry.gauge('jarvis_frontend_orb_fps', 'Orb frames per second reported by the browser');
  const webglMemory = registry.gauge('jarvis_frontend_webgl_memory_bytes', 'WebGL memory reported by the browser');
  const frontendErrors = registry.counter('jarvis_frontend_errors_total', 'Errors reported by the browser', ['kind']);
  const eventRate = new RateMeter(10_000, now);

  return {
    registry,
    httpRequests,
    httpErrors,
    httpLatency,
    wsConnections,
    events,
    adapterHealth,
    cache,
    orbFps,
    webglMemory,
    frontendErrors,

    recordRequest(method: string, route: string, status: number, durationSeconds: number): void {
      httpRequests.inc({ method, route, status });
      httpLatency.observe(durationSeconds, { method, route });
      if (status >= 500) httpErrors.inc({ method, route });
    },
    recordEvent(type: string): void {
      events.inc({ type });
      eventRate.mark();
    },
    recordCache(hit: boolean): void {
      cache.inc({ result: hit ? 'hit' : 'miss' });
    },
    setAdapterHealth(adapter: string, state: AdapterHealthState): void {
      adapterHealth.set(HEALTH_VALUE[state], { adapter });
    },
    recordFrontendReport(report: FrontendReport): void {
      if (report.orbFps !== undefined) orbFps.set(report.orbFps);
      if (report.webglMemoryBytes !== undefined) webglMemory.set(report.webglMemoryBytes);
      for (const error of report.errors ?? []) frontendErrors.inc({ kind: error.kind.slice(0, 64) }, error.count ?? 1);
    },

    summary(): DashboardSummary {
      const requestsTotal = httpRequests.total();
      const errorsTotal = httpErrors.total();
      const hits = cache.value({ result: 'hit' });
      const misses = cache.value({ result: 'miss' });
      const stateByValue = new Map(Object.entries(HEALTH_VALUE).map(([state, value]) => [value, state as AdapterHealthState]));
      const adapters = adapterHealth.snapshot().series.map((s) => ({
        adapter: s.labels.adapter ?? '',
        state: stateByValue.get((s as CounterSeries).value) ?? 'unknown',
      }));
      return {
        time: new Date(now()).toISOString(),
        http: {
          requestsTotal,
          errorsTotal,
          errorRate: requestsTotal === 0 ? 0 : errorsTotal / requestsTotal,
          latencyP50Seconds: aggregateQuantile(httpLatency, 0.5),
          latencyP95Seconds: aggregateQuantile(httpLatency, 0.95),
        },
        websocket: { connections: wsConnections.value() ?? 0 },
        events: { total: events.total(), perSecond: eventRate.perSecond() },
        adapters,
        cache: { hits, misses, hitRatio: hits + misses === 0 ? null : hits / (hits + misses) },
        frontend: {
          orbFps: orbFps.value() ?? null,
          webglMemoryBytes: webglMemory.value() ?? null,
          errorsTotal: frontendErrors.total(),
        },
      };
    },
  };
}
export type JarvisMetrics = ReturnType<typeof createJarvisMetrics>;

/** Quantile over all label combinations of a histogram (merges bucket counts). */
function aggregateQuantile(histogram: Histogram, q: number): number | undefined {
  const snapshot = histogram.snapshot().series as HistogramSeries[];
  const total = snapshot.reduce((sum, s) => sum + s.count, 0);
  if (total === 0) return undefined;
  const merged = new Map<string, number>();
  for (const series of snapshot) for (const b of series.buckets) merged.set(b.le, (merged.get(b.le) ?? 0) + b.count);
  const target = q * total;
  for (const [le, count] of merged) {
    if (count >= target) return le === '+Inf' ? (histogram.bounds[histogram.bounds.length - 1] ?? 0) : Number(le);
  }
  return undefined;
}
