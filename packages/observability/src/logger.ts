import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getCorrelationContext } from './correlation';
import { createRedactor, type RedactionPolicy, type Redactor } from './redaction';

export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_RANK: Record<LogLevel, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };

export function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}

/** PLAN §50.2 line shape; extra fields follow the fixed ones. */
export interface LogRecord {
  time: string;
  level: LogLevel;
  service: string;
  correlationId?: string;
  message: string;
  [field: string]: unknown;
}

export interface LogSink {
  write(line: string, record: LogRecord): void;
  close?(): void;
}

export interface RotatingFileOptions {
  dir: string;
  /** Active file name. Rotated files get `.1` (newest) .. `.N` suffixes. Default `friday.log`. */
  fileName?: string;
  /** Rotate when the active file would exceed this size. Default 10 MiB. */
  maxBytes?: number;
  /** Number of files kept including the active one. Default 5. */
  maxFiles?: number;
}

/**
 * Size-based rotating file sink. Writes are synchronous: log volume of a localhost control plane is low and
 * it guarantees that the last line before a crash is on disk.
 */
export function createRotatingFileSink(options: RotatingFileOptions): LogSink & { readonly path: string } {
  const fileName = options.fileName ?? 'friday.log';
  const maxBytes = options.maxBytes ?? 10 * 1024 * 1024;
  const maxFiles = Math.max(1, options.maxFiles ?? 5);
  const path = join(options.dir, fileName);
  mkdirSync(options.dir, { recursive: true });

  let size = existsSync(path) ? statSync(path).size : 0;

  const rotate = (): void => {
    if (maxFiles === 1) {
      rmSync(path, { force: true });
      return;
    }
    rmSync(`${path}.${maxFiles - 1}`, { force: true });
    for (let i = maxFiles - 2; i >= 1; i -= 1) {
      const from = `${path}.${i}`;
      if (existsSync(from)) renameSync(from, `${path}.${i + 1}`);
    }
    if (existsSync(path)) renameSync(path, `${path}.1`);
  };

  return {
    path,
    write(line) {
      const bytes = Buffer.byteLength(line) + 1;
      if (size > 0 && size + bytes > maxBytes) {
        rotate();
        size = 0;
      }
      appendFileSync(path, `${line}\n`);
      size += bytes;
    },
  };
}

export function createStreamSink(stream: { write(chunk: string): unknown }): LogSink {
  return { write: (line) => void stream.write(`${line}\n`) };
}

export interface LoggerOptions {
  service: string;
  /** Minimum level. Default `info`. */
  level?: LogLevel;
  /** Write to stdout. Default true. Pass a stream-like object to capture output. */
  stdout?: boolean | { write(chunk: string): unknown };
  /** Optional rotating file in the log dir. */
  file?: RotatingFileOptions;
  /** Extra sinks (tests, forwarding). */
  sinks?: readonly LogSink[];
  redaction?: RedactionPolicy;
  fields?: Readonly<Record<string, unknown>>;
  clock?: () => Date;
}

export interface Logger {
  readonly service: string;
  readonly level: LogLevel;
  trace(message: string, fields?: Record<string, unknown>): void;
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  fatal(message: string, fields?: Record<string, unknown>): void;
  isLevelEnabled(level: LogLevel): boolean;
  /** Child logger with additional bound fields. */
  child(fields: Record<string, unknown>): Logger;
  close(): void;
}

interface LoggerCore {
  level: LogLevel;
  service: string;
  sinks: readonly LogSink[];
  redactor: Redactor;
  clock: () => Date;
}

const RESERVED = new Set(['time', 'level', 'service', 'correlationId', 'message']);

function build(core: LoggerCore, bound: Readonly<Record<string, unknown>>): Logger {
  const emit = (level: LogLevel, message: string, fields?: Record<string, unknown>): void => {
    if (LEVEL_RANK[level] < LEVEL_RANK[core.level]) return;
    const ctx = getCorrelationContext();
    const merged: Record<string, unknown> = { ...ctx?.fields, ...bound, ...fields };
    const correlationId =
      (typeof fields?.correlationId === 'string' ? fields.correlationId : undefined) ??
      ctx?.correlationId ??
      (typeof bound.correlationId === 'string' ? bound.correlationId : undefined);

    const safeFields = core.redactor.redact(merged) as Record<string, unknown>;
    const record: LogRecord = {
      time: core.clock().toISOString(),
      level,
      service: core.service,
      ...(correlationId ? { correlationId } : {}),
      message: core.redactor.redactString(message),
    };
    for (const [key, value] of Object.entries(safeFields)) {
      if (!RESERVED.has(key)) record[key] = value;
    }

    let line: string;
    try {
      line = JSON.stringify(record);
    } catch {
      line = JSON.stringify({ ...record, ...Object.fromEntries(Object.keys(safeFields).map((k) => [k, '[Unserializable]'])) });
    }
    for (const sink of core.sinks) {
      try {
        sink.write(line, record);
      } catch (error) {
        // A failing sink (disk full, closed pipe) must never take the request path down.
        process.stderr.write(`logger sink failure: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
  };

  return {
    service: core.service,
    get level() {
      return core.level;
    },
    trace: (m, f) => emit('trace', m, f),
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
    fatal: (m, f) => emit('fatal', m, f),
    isLevelEnabled: (level) => LEVEL_RANK[level] >= LEVEL_RANK[core.level],
    child: (fields) => build(core, { ...bound, ...fields }),
    close: () => {
      for (const sink of core.sinks) sink.close?.();
    },
  };
}

export function createLogger(options: LoggerOptions): Logger {
  const sinks: LogSink[] = [];
  const stdout = options.stdout ?? true;
  if (stdout === true) sinks.push(createStreamSink(process.stdout));
  else if (stdout) sinks.push(createStreamSink(stdout));
  if (options.file) sinks.push(createRotatingFileSink(options.file));
  if (options.sinks) sinks.push(...options.sinks);

  return build(
    {
      level: options.level ?? 'info',
      service: options.service,
      sinks,
      redactor: createRedactor(options.redaction),
      clock: options.clock ?? (() => new Date()),
    },
    options.fields ?? {},
  );
}
