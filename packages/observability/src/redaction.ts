export const REDACTED = '[REDACTED]';
export const REDACTED_EMAIL = '[REDACTED_EMAIL]';

export interface RedactionPolicy {
  /** Mask e-mail addresses inside string values (personal data policy, PLAN Â§50.4). Default false. */
  redactEmails?: boolean;
  /** Additional key names (case/separator-insensitive) whose values are always masked. */
  extraKeys?: readonly string[];
  /**
   * Keys whose string values are exempt from *value* pattern matching (e.g. audit hashes that look like
   * long hex keys). Key-based redaction still wins for these keys. Default: hash-like keys.
   */
  preserveValueKeys?: readonly string[];
  /** Maximum nesting depth before a subtree is replaced by `[Truncated]`. Default 12. */
  maxDepth?: number;
}

/** Substrings of the lower-cased, separator-stripped key that mark a secret. */
const SECRET_KEY_SUBSTRINGS = [
  'password',
  'passwd',
  'passphrase',
  'secret',
  'token',
  'apikey',
  'authorization',
  'cookie',
  'privatekey',
  'accesskey',
  'credential',
  'bearer',
  'sessionid',
] as const;

/** Whole words (camelCase/snake_case split) that mark a secret; too short for substring matching. */
const SECRET_KEY_WORDS = new Set(['pin', 'pwd', 'iban', 'cvv', 'cvc', 'ssn', 'otp']);

const DEFAULT_PRESERVE_VALUE_KEYS = [
  'hash',
  'prevHash',
  'eventHash',
  'sha256',
  'checksum',
  'etag',
  'correlationId',
  'sequence',
] as const;

const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g;
const BEARER_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9\-._~+/]{6,}=*/gi;
const URL_CREDENTIALS_PATTERN = /(\b[a-z][a-z0-9+.-]*:\/\/)([^\s/:@]+):([^\s/@]+)@/gi;
const PREFIXED_KEY_PATTERN = /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bxox[abprs]-[A-Za-z0-9-]{10,}|\bAKIA[0-9A-Z]{16}\b/g;
const LONG_HEX_PATTERN = /\b[a-fA-F0-9]{32,}\b/g;
const LONG_TOKEN_PATTERN = /[A-Za-z0-9+/_-]{40,}={0,2}/g;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function splitWords(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** True when a property name denotes a secret or sensitive value. */
export function isSensitiveKey(key: string, extraKeys: readonly string[] = []): boolean {
  const normalized = normalizeKey(key);
  if (normalized.length === 0) return false;
  for (const extra of extraKeys) {
    if (normalizeKey(extra) === normalized) return true;
  }
  for (const needle of SECRET_KEY_SUBSTRINGS) {
    if (normalized.includes(needle)) return true;
  }
  const words = splitWords(key);
  for (const word of words) {
    if (SECRET_KEY_WORDS.has(word)) return true;
  }
  // "private key", "secret key" etc. written as separate words are covered by substrings after normalisation;
  // a bare trailing "key" next to api/private/signing/etc. words:
  if (words.includes('key') && words.some((w) => ['api', 'private', 'signing', 'encryption', 'master', 'ssh', 'auth'].includes(w))) {
    return true;
  }
  return false;
}

function looksLikeSecretBlob(candidate: string): boolean {
  // Require letters and digits so long slugs/paths made only of letters are left alone.
  return /[A-Za-z]/.test(candidate) && /\d/.test(candidate);
}

/** Masks secret-looking substrings in free text. */
export function redactString(input: string, policy: RedactionPolicy = {}): string {
  let out = input;
  out = out.replace(URL_CREDENTIALS_PATTERN, `$1$2:${REDACTED}@`);
  out = out.replace(BEARER_PATTERN, (_m, scheme: string) => `${scheme} ${REDACTED}`);
  out = out.replace(JWT_PATTERN, REDACTED);
  out = out.replace(PREFIXED_KEY_PATTERN, REDACTED);
  out = out.replace(LONG_HEX_PATTERN, REDACTED);
  out = out.replace(LONG_TOKEN_PATTERN, (match) => (looksLikeSecretBlob(match) ? REDACTED : match));
  if (policy.redactEmails) out = out.replace(EMAIL_PATTERN, REDACTED_EMAIL);
  return out;
}

export interface Redactor {
  /** Returns a deep, JSON-safe copy with sensitive data masked. The input is never mutated. */
  redact<T = unknown>(value: T): unknown;
  redactString(value: string): string;
}

export function createRedactor(policy: RedactionPolicy = {}): Redactor {
  const maxDepth = policy.maxDepth ?? 12;
  const preserve = new Set((policy.preserveValueKeys ?? DEFAULT_PRESERVE_VALUE_KEYS).map(normalizeKey));
  const extraKeys = policy.extraKeys ?? [];

  const walk = (value: unknown, depth: number, seen: WeakSet<object>, preserveValue: boolean): unknown => {
    if (value === null || value === undefined) return value;
    switch (typeof value) {
      case 'string':
        return preserveValue ? value : redactString(value, policy);
      case 'number':
      case 'boolean':
        return value;
      case 'bigint':
        return value.toString();
      case 'symbol':
        return value.toString();
      case 'function':
        return '[Function]';
      default:
        break;
    }
    const obj = value as object;
    if (depth >= maxDepth) return '[Truncated]';
    if (seen.has(obj)) return '[Circular]';
    if (obj instanceof Date) return Number.isNaN(obj.getTime()) ? 'Invalid Date' : obj.toISOString();
    if (obj instanceof Uint8Array) return `[Binary ${obj.byteLength} bytes]`;

    seen.add(obj);
    try {
      if (obj instanceof Error) {
        const out: Record<string, unknown> = {
          name: obj.name,
          message: redactString(obj.message, policy),
        };
        if (obj.stack) out.stack = redactString(obj.stack, policy);
        const cause = (obj as { cause?: unknown }).cause;
        if (cause !== undefined) out.cause = walk(cause, depth + 1, seen, false);
        for (const [k, v] of Object.entries(obj)) {
          out[k] = isSensitiveKey(k, extraKeys) ? REDACTED : walk(v, depth + 1, seen, false);
        }
        return out;
      }
      if (Array.isArray(obj)) return obj.map((item) => walk(item, depth + 1, seen, preserveValue));
      if (obj instanceof Map) {
        return walk(Object.fromEntries(obj as Map<string, unknown>), depth, seen, preserveValue);
      }
      if (obj instanceof Set) return walk(Array.from(obj), depth, seen, preserveValue);

      const source = typeof (obj as { toJSON?: unknown }).toJSON === 'function'
        ? (obj as { toJSON(): unknown }).toJSON()
        : obj;
      if (source !== obj) return walk(source, depth + 1, seen, preserveValue);

      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (isSensitiveKey(k, extraKeys)) {
          out[k] = v === null || v === undefined ? v : REDACTED;
        } else {
          out[k] = walk(v, depth + 1, seen, preserve.has(normalizeKey(k)));
        }
      }
      return out;
    } finally {
      seen.delete(obj);
    }
  };

  return {
    redact: (value) => walk(value, 0, new WeakSet(), false),
    redactString: (value) => redactString(value, policy),
  };
}

const defaultRedactor = createRedactor();
export function redact<T = unknown>(value: T, policy?: RedactionPolicy): unknown {
  return policy ? createRedactor(policy).redact(value) : defaultRedactor.redact(value);
}
