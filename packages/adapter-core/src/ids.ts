import { createHash, randomBytes } from "node:crypto";
import { AdapterError } from "./errors";

/** Id prefixes of the contract (IMPLEMENTATION_CONVENTIONS §3). */
export const ID_PREFIXES = [
  "task",
  "agent",
  "appr",
  "mem",
  "act",
  "thr",
  "msg",
  "cal",
  "auto",
  "run",
  "rsp",
  "src",
  "fnd",
  "file",
  "ntf",
  "svc",
  "aud",
  "evt",
  "corr",
  "cmd",
] as const;
export type IdPrefix = (typeof ID_PREFIXES)[number];

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const SUFFIX_LENGTH = 26;
const MAX_REVERSIBLE_BYTES = 15;

function encodeBytes(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let out = "";
  for (let index = SUFFIX_LENGTH - 1; index >= 0; index -= 1) {
    out += ALPHABET[Number((value >> BigInt(index * 5)) & 31n)];
  }
  return out;
}

function decodeBytes(suffix: string): Uint8Array | undefined {
  if (suffix.length !== SUFFIX_LENGTH) return undefined;
  let value = 0n;
  for (const char of suffix.toUpperCase()) {
    const digit = ALPHABET.indexOf(char);
    if (digit < 0) return undefined;
    value = (value << 5n) | BigInt(digit);
  }
  if (value >> 128n !== 0n) return undefined;
  const bytes = new Uint8Array(16);
  for (let index = 15; index >= 0; index -= 1) {
    bytes[index] = Number(value & 0xffn);
    value >>= 8n;
  }
  return bytes;
}

/**
 * Creates a contract id `<prefix>_<26 chars>`. With a `seed` the id is deterministic (mocks, replays, stable mapping of
 * external ids); without it, random.
 */
export function createId(prefix: IdPrefix, seed?: string): string {
  const bytes =
    seed === undefined
      ? randomBytes(16)
      : createHash("sha256").update(`${prefix}:${seed}`).digest().subarray(0, 16);
  return `${prefix}_${encodeBytes(bytes)}`;
}

export const ID_PATTERN = (prefix: IdPrefix): RegExp => new RegExp(`^${prefix}_[0-9A-Za-z]{26}$`);

export interface IdCodec {
  readonly prefix: IdPrefix;
  /** External id -> contract id. Reversible for external ids up to 15 UTF-8 bytes; longer ones are hashed and remembered. */
  encode(externalId: string): string;
  /** Contract id -> external id; `undefined` for ids this codec never produced. */
  decode(id: string): string | undefined;
  /** Same as `decode` but raises NOT_FOUND. */
  require(id: string): string;
}

/**
 * Bidirectional mapping between a provider's ids and contract ids. Ids are opaque to the UI; adapters need the way
 * back for `getX(id)` and mutations. The hash fallback keeps a bounded in-memory table (populated by `encode`).
 */
export function createIdCodec(prefix: IdPrefix, options: { maxRemembered?: number } = {}): IdCodec {
  const remembered = new Map<string, string>();
  const maxRemembered = options.maxRemembered ?? 50_000;

  const decode = (id: string): string | undefined => {
    if (!id.startsWith(`${prefix}_`)) return undefined;
    const known = remembered.get(id);
    if (known !== undefined) return known;
    const bytes = decodeBytes(id.slice(prefix.length + 1));
    if (!bytes) return undefined;
    const length = bytes[0] ?? 0;
    if (length === 0 || length > MAX_REVERSIBLE_BYTES) return undefined;
    const candidate = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(1, 1 + length));
    return encode(candidate) === id ? candidate : undefined;
  };

  function encode(externalId: string): string {
    const raw = new TextEncoder().encode(externalId);
    if (raw.length > 0 && raw.length <= MAX_REVERSIBLE_BYTES) {
      const bytes = new Uint8Array(16);
      bytes[0] = raw.length;
      bytes.set(raw, 1);
      return `${prefix}_${encodeBytes(bytes)}`;
    }
    const id = createId(prefix, externalId);
    if (remembered.size >= maxRemembered) {
      const oldest = remembered.keys().next();
      if (!oldest.done) remembered.delete(oldest.value);
    }
    remembered.set(id, externalId);
    return id;
  }

  return {
    prefix,
    encode,
    decode,
    require(id) {
      const external = decode(id);
      if (external === undefined)
        throw new AdapterError({ code: "NOT_FOUND", message: `Unbekannte ID: ${id}`, retryable: false });
      return external;
    },
  };
}
