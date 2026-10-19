import { createRedactor, getCorrelationContext, type LogLevel, type Logger } from "@friday/observability";
import type { AdapterLogEntry } from "@friday/sdk";

type Level = AdapterLogEntry["level"];
type Context = AdapterLogEntry["context"];

const LEVEL_RANK: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const CORRELATION_ID = /^corr_[0-9A-Za-z]{26}$/;
const MAX_VALUE_LENGTH = 300;

const toLevel = (level: LogLevel): Level => (level === "trace" || level === "debug" ? "debug" : level === "fatal" ? "error" : level);

interface Entry extends AdapterLogEntry {
  /** Category taken from the record (`category` or the `operation` prefix); matches lines that carry no adapter id. */
  category: string | null;
}

export interface LogBufferOptions {
  /** Maximum number of lines kept (oldest dropped first). Default 2000. */
  capacity?: number;
  redactEmails?: boolean;
  clock?: () => Date;
}

/**
 * Bounded in-memory copy of the control API's log lines that concern adapters (`GET /adapters/{id}/logs`, PLAN §40.4).
 * Every line is redacted (secret keys, tokens, optionally e-mail addresses) before it is stored, context values are
 * reduced to short scalars and stack traces never enter the buffer. It only holds what the logger would write.
 */
export class LogBuffer {
  private readonly entries: Entry[] = [];
  private readonly capacity: number;
  private readonly redactor: ReturnType<typeof createRedactor>;
  private readonly clock: () => Date;

  constructor(options: LogBufferOptions = {}) {
    this.capacity = options.capacity ?? 2000;
    this.redactor = createRedactor({ redactEmails: options.redactEmails ?? false });
    this.clock = options.clock ?? (() => new Date());
  }

  get size(): number {
    return this.entries.length;
  }

  /** Stores a record when it names an adapter (`adapterId`) or a port category (`category`, `operation: "tasks.listTasks"`). */
  record(level: LogLevel, message: string, fields: Record<string, unknown> = {}): void {
    const safe = this.redactor.redact(fields) as Record<string, unknown>;
    const adapterId = typeof safe.adapterId === "string" ? safe.adapterId : null;
    const operation = typeof safe.operation === "string" ? safe.operation.split(".")[0] : undefined;
    const category = typeof safe.category === "string" ? safe.category : (operation ?? null);
    if (!adapterId && !category) return;
    const correlation = typeof safe.correlationId === "string" ? safe.correlationId : getCorrelationContext()?.correlationId;
    const context: Context = {};
    for (const [key, value] of Object.entries(safe)) {
      if (key === "adapterId" || key === "correlationId" || value === undefined) continue;
      context[key] = scalar(value);
    }
    this.entries.push({
      timestamp: this.clock().toISOString(),
      level: toLevel(level),
      message: this.redactor.redactString(message).slice(0, 500),
      adapterId: adapterId ?? "",
      correlationId: correlation && CORRELATION_ID.test(correlation) ? correlation : null,
      context,
      category,
    });
    if (this.entries.length > this.capacity) this.entries.splice(0, this.entries.length - this.capacity);
  }

  /** The newest `limit` lines of one adapter from `level` upwards, oldest first. */
  query(adapter: { id: string; category: string }, options: { limit?: number; level?: Level } = {}): AdapterLogEntry[] {
    const minimum = LEVEL_RANK[options.level ?? "debug"];
    const lines = this.entries.filter(
      (entry) => LEVEL_RANK[entry.level] >= minimum && (entry.adapterId === adapter.id || (entry.adapterId === "" && entry.category === adapter.category)),
    );
    const limit = options.limit ?? 100;
    return lines.slice(-limit).map(({ category: _category, adapterId, ...rest }) => ({ ...rest, adapterId: adapterId || adapter.id }));
  }
}

function scalar(value: unknown): string | number | boolean | null {
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.slice(0, MAX_VALUE_LENGTH);
  // Redacted errors carry name/message/stack; only the message is of interest, never the stack.
  if (typeof value === "object" && typeof (value as { message?: unknown }).message === "string") return String((value as { message: string }).message).slice(0, MAX_VALUE_LENGTH);
  return JSON.stringify(value)?.slice(0, MAX_VALUE_LENGTH) ?? null;
}

/**
 * Returns a logger that behaves exactly like `inner` and additionally mirrors its records into `buffer`: everything from
 * `info` upwards whatever the configured log level (the System page should explain an outage even when the log file only
 * keeps warnings), debug and trace only when the inner logger writes them. Bound fields of `child()` loggers (e.g.
 * `adapterId`) travel with the mirrored records.
 */
export function withLogBuffer(inner: Logger, buffer: LogBuffer, bound: Record<string, unknown> = {}): Logger {
  const through =
    (level: LogLevel) =>
    (message: string, fields?: Record<string, unknown>): void => {
      inner[level](message, fields);
      if (level !== "trace" && level !== "debug") buffer.record(level, message, { ...bound, ...fields });
      else if (inner.isLevelEnabled(level)) buffer.record(level, message, { ...bound, ...fields });
    };
  return {
    service: inner.service,
    get level() {
      return inner.level;
    },
    trace: through("trace"),
    debug: through("debug"),
    info: through("info"),
    warn: through("warn"),
    error: through("error"),
    fatal: through("fatal"),
    isLevelEnabled: (level) => inner.isLevelEnabled(level),
    ...(inner.setLevel ? { setLevel: (level: LogLevel) => inner.setLevel?.(level) } : {}),
    child: (fields) => withLogBuffer(inner.child(fields), buffer, { ...bound, ...fields }),
    close: () => inner.close(),
  };
}
