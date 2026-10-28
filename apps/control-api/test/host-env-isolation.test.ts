import { isAbsolute, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { startTestApi } from "./helpers";

/**
 * Tests duerfen nie in den Vault einer echten Installation schreiben: Host-Installationsvariablen werden
 * beim Teststart entfernt und der Durable-Memory-Vault bleibt innerhalb der Testinstallation.
 */
describe("host environment isolation", () => {
  const hostInstallVariables = ["FRIDAY_OBSIDIAN_VAULT", "FRIDAY_INSTALL_ROOT", "FRIDAY_CONFIG_DIR", "FRIDAY_STATE_ROOT"] as const;

  it("does not inherit host install variables", () => {
    for (const name of hostInstallVariables) expect(process.env[name]).toBeUndefined();
  });

  it("keeps the durable memory vault inside the test installation", async () => {
    const api = await startTestApi();
    try {
      const installRoot = resolve(api.config.paths.dataDir, "..", "..");
      const rel = relative(installRoot, api.runtime.durableMemory.vaultPath);
      expect(rel.startsWith("..") || isAbsolute(rel), `Vault ${api.runtime.durableMemory.vaultPath} liegt ausserhalb von ${installRoot}`).toBe(false);
    } finally {
      await api.close();
    }
  });
});

