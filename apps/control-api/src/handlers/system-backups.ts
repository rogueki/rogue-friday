import { CONTRACT_VERSION, type SystemBackupActionRequest } from "@friday/sdk";
import type { Handler } from "../http/context";
import type { OperationId } from "../http/route-types";
import { validationFailed } from "../util/errors";

const envelope = (data: unknown) => ({ contractVersion: CONTRACT_VERSION, data,
  freshness: { state: "fresh", asOf: new Date().toISOString() } });

export const systemBackupHandlers: Partial<Record<OperationId, Handler>> = {
  async getSystemBackupStatus(ctx) {
    return { status: 200, body: envelope(ctx.runtime.backupJobs.status()) };
  },
  async performSystemBackupAction(ctx) {
    const input = ctx.body as SystemBackupActionRequest;
    const jobs = ctx.runtime.backupJobs;
    if (input.action === "preview") return { status: 200, body: envelope({ action: input.action, ...await jobs.preview(input.targetPath) }) };
    if (input.action === "run") {
      const result = await jobs.run();
      ctx.audit.action = "system.backup_created";
      ctx.audit.after = { fileCount: result.fileCount, verified: result.verified };
      return { status: 200, body: envelope({ action: input.action, ...result }) };
    }
    if (!input.path) throw validationFailed("Backup-Pfad erforderlich.");
    if (input.action === "verify") return { status: 200, body: envelope({ action: input.action,
      ...jobs.verify(input.path), verified: true }) };
    if (!input.targetPath) throw validationFailed("Neuer, isolierter Restore-Zielpfad erforderlich.");
    const result = jobs.restoreTest(input.path, input.targetPath);
    ctx.audit.action = "system.backup_restore_tested";
    ctx.audit.after = { fileCount: result.fileCount, verified: true };
    return { status: 200, body: envelope({ action: input.action, ...result, verified: true }) };
  },
};
