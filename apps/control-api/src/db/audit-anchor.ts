import { createHmac, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { kvGet, kvSet, type Db } from "./database";

/** Where the audit chain ended when it was last written: the number of events and the hash of the last one. */
export interface AnchorRecord {
  length: number;
  hash: string;
}

export type AnchorRead = { state: "absent" } | { state: "invalid" } | { state: "ok"; record: AnchorRecord };

export interface AuditAnchorOptions {
  db: Db;
  /** HMAC key (`deriveKey(serverKey, "audit-head")`): without it nobody can forge a head that matches a truncated chain. */
  key: Buffer;
  /** Sidecar file next to the database (`<dataDir>/audit-head.json`). Omitted for in-memory databases. */
  file?: string | undefined;
  onError?: (error: unknown) => void;
}

const KV_KEY = "audit.head";

/**
 * The hash chain proves that no event was changed, removed from the middle or reordered, but a truncated tail is still a
 * valid chain. The anchor remembers the chain head (length + hash) outside the `audit_log` table: in a signed sidecar
 * file and in a signed `kv` row. `AuditStore.verify()` compares the chain with it, so cutting off the newest events (or
 * restoring an older database) is detected, and forging the head needs the server key.
 */
export class AuditAnchor {
  constructor(private readonly options: AuditAnchorOptions) {}

  private sign(record: AnchorRecord): string {
    return createHmac("sha256", this.options.key).update(`audit-head:${record.length}:${record.hash}`).digest("hex");
  }

  private encode(record: AnchorRecord): string {
    return JSON.stringify({ v: 1, length: record.length, hash: record.hash, mac: this.sign(record) });
  }

  private decode(text: string): AnchorRead {
    try {
      const value = JSON.parse(text) as { v?: unknown; length?: unknown; hash?: unknown; mac?: unknown };
      if (value.v !== 1 || !Number.isInteger(value.length) || (value.length as number) < 0 || typeof value.hash !== "string" || typeof value.mac !== "string") {
        return { state: "invalid" };
      }
      const record: AnchorRecord = { length: value.length as number, hash: value.hash };
      const expected = Buffer.from(this.sign(record), "hex");
      const actual = Buffer.from(value.mac, "hex");
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return { state: "invalid" };
      return { state: "ok", record };
    } catch {
      return { state: "invalid" };
    }
  }

  readFile(): AnchorRead {
    const { file } = this.options;
    if (!file || !existsSync(file)) return { state: "absent" };
    try {
      return this.decode(readFileSync(file, "utf8"));
    } catch {
      return { state: "invalid" };
    }
  }

  readDb(): AnchorRead {
    const stored = kvGet(this.options.db, KV_KEY);
    return stored === undefined ? { state: "absent" } : this.decode(stored);
  }

  /** Both stores; a missing one is not an error by itself (the other one still anchors the chain). */
  read(): { file: AnchorRead; db: AnchorRead } {
    return { file: this.readFile(), db: this.readDb() };
  }

  write(record: AnchorRecord): void {
    const encoded = this.encode(record);
    try {
      kvSet(this.options.db, KV_KEY, encoded);
    } catch (error) {
      this.options.onError?.(error);
    }
    const { file } = this.options;
    if (!file) return;
    try {
      const temp = `${file}.tmp`;
      writeFileSync(temp, encoded, { mode: 0o600 });
      renameSync(temp, file);
      try {
        chmodSync(file, 0o600);
      } catch {
        // Windows: POSIX modes are not supported; the data directory ACL protects the file
      }
    } catch (error) {
      this.options.onError?.(error);
    }
  }
}
