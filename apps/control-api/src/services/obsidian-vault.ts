import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { ApiError, conflict, validationFailed } from "../util/errors";

const execute = promisify(execFile);
export interface ObsidianVaultStatus {
  path: string;
  revision: number;
  configured: boolean;
  readable: boolean;
  applied: boolean;
}

function installRoot(dataDir: string): string {
  let root = resolve(dataDir);
  for (let depth = 0; depth < 5; depth += 1) {
    if (existsSync(join(root, "config", "install-state.json")) && existsSync(join(root, "installer", "setup-obsidian.ps1"))) return root;
    const parent = dirname(root);
    if (parent === root) break;
    root = parent;
  }
  throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Friday-Installer für Obsidian ist hier nicht verfügbar." });
}

export class ObsidianVaultService {
  constructor(private readonly dataDir: string) {}

  private async run(args: string[]): Promise<ObsidianVaultStatus> {
    const root = installRoot(this.dataDir);
    try {
      const { stdout } = await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
        join(root, "installer", "setup-obsidian.ps1"), ...args, "-InstallRoot", root], { timeout: 30000, windowsHide: true, maxBuffer: 4096 });
      const parsed = JSON.parse(stdout.trim()) as ObsidianVaultStatus;
      if (typeof parsed.path !== "string" || !Number.isSafeInteger(parsed.revision) || typeof parsed.configured !== "boolean" ||
          typeof parsed.readable !== "boolean" || typeof parsed.applied !== "boolean") throw new Error("Invalid Obsidian status");
      return parsed;
    } catch (error) {
      const exit = (error as { code?: number | string }).code;
      if (exit === 3) throw conflict("Der Obsidian-Vault wurde inzwischen geändert. Bitte neu laden.");
      if (exit === 4) throw validationFailed("Dieser Vault ist in Friday-Ubuntu nicht les- und schreibbar.");
      throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Obsidian-Konfiguration in Friday-Ubuntu konnte nicht geprüft werden." });
    }
  }

  status(): Promise<ObsidianVaultStatus> { return this.run(["-Action", "status"]); }

  async set(vaultPath: string, expectedVersion: number): Promise<ObsidianVaultStatus> {
    if (!Number.isSafeInteger(expectedVersion) || !vaultPath || vaultPath.length > 1024 || /[\r\n"']/.test(vaultPath)) {
      throw validationFailed("Ungültiger Obsidian-Vault-Pfad.");
    }
    return this.run(["-Action", "set", "-VaultPath", vaultPath, "-ExpectedVersion", String(expectedVersion)]);
  }
}
