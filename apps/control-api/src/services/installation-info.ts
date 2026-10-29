import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONTRACT_VERSION } from "@friday/sdk";
import type { FridayConfig } from "@friday/config";

const SHA = /^[0-9a-f]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface DashboardRevision {
  commit: string | null;
  installedAt: string | null;
}

/** Installation identity, the installed dashboard commit and the process that owns the configured API port. */
export class InstallationInfoService {
  private readonly startedAt = new Date().toISOString();

  constructor(private readonly config: FridayConfig) {}

  private get installationFile(): string { return join(this.config.paths.dataDir, "installation.json"); }
  private get dashboardFile(): string { return join(this.config.paths.dataDir, "dashboard-revision.json"); }

  private storedId(): string | null {
    try {
      const value = JSON.parse(readFileSync(this.installationFile, "utf8")) as { installationId?: unknown };
      return typeof value.installationId === "string" && UUID.test(value.installationId) ? value.installationId : null;
    } catch { return null; }
  }

  installationId(): string {
    const stored = this.storedId();
    if (stored) return stored;
    // The id is persisted so it identifies this installation across restarts and updates.
    mkdirSync(this.config.paths.dataDir, { recursive: true });
    const installationId = randomUUID();
    try {
      writeFileSync(this.installationFile, JSON.stringify({ installationId }), { flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // A parallel first call won the race; its id is the installation id.
      const existing = this.storedId();
      if (existing) return existing;
      // An unusable id (edited or truncated file) is replaced with a fresh one.
      writeFileSync(this.installationFile, JSON.stringify({ installationId }), { mode: 0o600 });
    }
    return installationId;
  }

  dashboard(): DashboardRevision {
    try {
      const value = JSON.parse(readFileSync(this.dashboardFile, "utf8")) as Record<string, unknown>;
      return {
        commit: typeof value.commit === "string" && SHA.test(value.commit) ? value.commit : null,
        installedAt: typeof value.installedAt === "string" && !Number.isNaN(Date.parse(value.installedAt)) ? value.installedAt : null,
      };
    } catch { return { commit: null, installedAt: null }; }
  }

  info() {
    return {
      installationId: this.installationId(),
      dashboard: this.dashboard(),
      controlApi: {
        contractVersion: CONTRACT_VERSION,
        host: this.config.server.host,
        port: this.config.server.port,
        pid: process.pid,
        startedAt: this.startedAt,
      },
    };
  }
}
