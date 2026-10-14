export type LogFields = Record<string, unknown>;

/** Minimal structured logger. The control API's logger satisfies it; adapters never depend on a concrete implementation. */
export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(bindings: LogFields): Logger;
}

export const noopLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return noopLogger;
  },
};

export interface LogRecord {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  fields: LogFields;
}

/** Logger that stores every record; used by tests and the conformance suite to inspect what an adapter logged. */
export function createMemoryLogger(
  records: LogRecord[] = [],
  bindings: LogFields = {},
): Logger & { records: LogRecord[] } {
  const write = (level: LogRecord["level"]) => (message: string, fields?: LogFields) => {
    records.push({ level, message, fields: { ...bindings, ...fields } });
  };
  return {
    records,
    debug: write("debug"),
    info: write("info"),
    warn: write("warn"),
    error: write("error"),
    child: (extra) => createMemoryLogger(records, { ...bindings, ...extra }),
  };
}

/** Wraps a logger so that every message and field value passes through `redact` (secret masking). */
export function createRedactingLogger(inner: Logger, redact: (value: string) => string): Logger {
  const redactValue = (value: unknown, depth = 0): unknown => {
    if (typeof value === "string") return redact(value);
    if (depth > 6 || value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map((entry) => redactValue(entry, depth + 1));
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, redactValue(entry, depth + 1)]),
    );
  };
  const wrap = (method: "debug" | "info" | "warn" | "error") => (message: string, fields?: LogFields) =>
    inner[method](redact(message), fields ? (redactValue(fields) as LogFields) : undefined);
  return {
    debug: wrap("debug"),
    info: wrap("info"),
    warn: wrap("warn"),
    error: wrap("error"),
    child: (bindings) => createRedactingLogger(inner.child(redactValue(bindings) as LogFields), redact),
  };
}
