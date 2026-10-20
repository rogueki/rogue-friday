import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/db/database";
import { DurableMemoryService } from "../src/services/durable-memory";
import { SystemBackupService } from "../src/services/system-backup";
import { SystemRecoveryService } from "../src/services/system-recovery";

const [action, sourceOrStage, targetRoot] = process.argv.slice(2);
if (!sourceOrStage || !["prepare", "apply", "rollback"].includes(action ?? "") ||
    (action === "prepare") !== Boolean(targetRoot)) {
  process.stderr.write("Usage: system-recovery <prepare backup-path fresh-install-root | apply stage-path | rollback stage-path>\n");
  process.exitCode = 2;
} else {
  // The verifier checks the backup's own authenticated audit chain and file
  // inventory. Its scratch database is never the source installation's DB.
  const scratch = mkdtempSync(join(tmpdir(), "friday-recovery-verifier-"));
  const data = join(scratch, "dashboard", "data");
  const vault = join(scratch, "vault");
  mkdirSync(data, { recursive: true });
  mkdirSync(join(vault, ".obsidian"), { recursive: true });
  const db = openDatabase(join(data, "dashboard.sqlite"));
  const memory = new DurableMemoryService(data, vault);
  try {
    const recovery = new SystemRecoveryService(new SystemBackupService(data, db, memory));
    const result = action === "prepare" ? recovery.prepare(sourceOrStage, targetRoot!)
      : action === "apply" ? recovery.apply(sourceOrStage) : recovery.rollback(sourceOrStage);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`Recovery failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  } finally {
    memory.close();
    db.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}
