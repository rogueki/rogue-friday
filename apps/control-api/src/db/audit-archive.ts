import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { GENESIS_HASH } from "@friday/observability";
import type { Db } from "./database";

export interface ArchivedAuditRow {
  seq: number; id: string; occurred_at: string; correlation_id: string; category: string; action: string;
  json: string; prev_hash: string; hash: string;
}

interface Segment {
  filename: string; first_seq: number; last_seq: number; row_count: number;
  previous_hash: string; head_hash: string; sha256: string;
}

const digest = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
const namePattern = /^audit-[a-f0-9-]{36}\.json$/;

/** Cold audit segments remain on disk for legal/integrity hold; this archives hot rows, not permanent erasure. */
export class AuditArchive {
  constructor(private readonly db: Db, private readonly directory: string) {}

  private segments(): Segment[] {
    return this.db.prepare("SELECT * FROM audit_archive_segments ORDER BY first_seq").all() as unknown as Segment[];
  }

  rows(): ArchivedAuditRow[] {
    if (existsSync(this.directory) && (lstatSync(this.directory).isSymbolicLink() || !lstatSync(this.directory).isDirectory()))
      throw new Error("Audit archive directory is unsafe");
    const all: ArchivedAuditRow[] = [];
    let nextSeq = 1;
    let previousHash = GENESIS_HASH;
    for (const segment of this.segments()) {
      if (!namePattern.test(segment.filename) || segment.first_seq !== nextSeq || segment.previous_hash !== previousHash ||
          segment.row_count < 1 || segment.last_seq !== segment.first_seq + segment.row_count - 1)
        throw new Error("Audit archive segment registry is invalid");
      const file = join(this.directory, segment.filename);
      if (!existsSync(file) || lstatSync(file).isSymbolicLink() || !lstatSync(file).isFile())
        throw new Error("Audit archive segment is missing or linked");
      const bytes = readFileSync(file);
      if (digest(bytes) !== segment.sha256) throw new Error("Audit archive segment checksum mismatch");
      const content = JSON.parse(bytes.toString("utf8")) as { version: number; rows: ArchivedAuditRow[] };
      if (content.version !== 1 || !Array.isArray(content.rows) || content.rows.length !== segment.row_count)
        throw new Error("Audit archive segment content is invalid");
      for (const row of content.rows) {
        if (!row || row.seq !== nextSeq || row.prev_hash !== previousHash || typeof row.json !== "string" ||
            !/^[a-f0-9]{64}$/.test(row.hash)) throw new Error("Audit archive segment chain is invalid");
        all.push(row);
        nextSeq += 1;
        previousHash = row.hash;
      }
      if (previousHash !== segment.head_hash) throw new Error("Audit archive segment head mismatch");
    }
    return all;
  }

  archivedCount(): number {
    return (this.db.prepare("SELECT COALESCE(SUM(row_count), 0) AS n FROM audit_archive_segments").get() as { n: number }).n;
  }

  countEligible(cutoffIso: string): number {
    const rows = this.db.prepare("SELECT seq, occurred_at FROM audit_log ORDER BY seq").all() as Array<{ seq: number; occurred_at: string }>;
    let count = 0;
    for (const row of rows) { if (row.occurred_at >= cutoffIso) break; count += 1; }
    return count;
  }

  archiveBefore(cutoffIso: string, verify: () => boolean, beforeCommit?: () => void): number {
    if (!verify()) throw new Error("Audit chain failed verification before archive");
    const count = this.countEligible(cutoffIso);
    if (!count) return 0;
    const rows = this.db.prepare("SELECT * FROM audit_log ORDER BY seq LIMIT ?").all(count) as unknown as ArchivedAuditRow[];
    const last = rows.at(-1)!;
    const prior = this.segments().at(-1);
    if (rows[0]!.seq !== (prior?.last_seq ?? 0) + 1 || rows[0]!.prev_hash !== (prior?.head_hash ?? GENESIS_HASH))
      throw new Error("Audit archive prefix is not contiguous");
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    if (lstatSync(this.directory).isSymbolicLink() || !lstatSync(this.directory).isDirectory())
      throw new Error("Audit archive directory is linked");
    if (process.platform === "win32") {
      const user = process.env.USERNAME;
      if (!user) throw new Error("Audit archive owner is unknown");
      const principal = process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${user}` : user;
      execFileSync("icacls", [this.directory, "/inheritance:r", "/grant:r", `${principal}:(OI)(CI)(F)`],
        { stdio: "ignore", windowsHide: true, timeout: 10_000 });
    } else chmodSync(this.directory, 0o700);
    const filename = `audit-${randomUUID()}.json`;
    if (!namePattern.test(filename) || basename(filename) !== filename) throw new Error("Invalid audit archive filename");
    const final = join(this.directory, filename);
    const temp = `${final}.tmp`;
    const bytes = Buffer.from(JSON.stringify({ version: 1, rows }), "utf8");
    writeFileSync(temp, bytes, { flag: "wx", mode: 0o600, flush: true });
    renameSync(temp, final);
    const fd = openSync(final, "r+");
    try { fsyncSync(fd); } finally { closeSync(fd); }
    if (process.platform !== "win32") {
      const directoryFd = openSync(this.directory, "r");
      try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
    }
    try {
      beforeCommit?.();
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.prepare(`INSERT INTO audit_archive_segments
          (id, filename, first_seq, last_seq, row_count, previous_hash, head_hash, sha256, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(randomUUID(), filename, rows[0]!.seq, last.seq, rows.length,
          rows[0]!.prev_hash, last.hash, digest(bytes), new Date().toISOString());
        const removed = this.db.prepare("DELETE FROM audit_log WHERE seq BETWEEN ? AND ?").run(rows[0]!.seq, last.seq);
        if (Number(removed.changes) !== rows.length) throw new Error("Audit archive prefix changed during commit");
        this.db.exec("COMMIT");
      } catch (error) { this.db.exec("ROLLBACK"); throw error; }
      return rows.length;
    } catch (error) {
      // A published but unregistered segment may remain after a crash; it is never trusted or auto-pruned.
      if (!existsSync(final)) rmSync(temp, { force: true });
      throw error;
    }
  }
}
