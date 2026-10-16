import { describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FridayConfig } from "@friday/config";
import type { SkillsService } from "../src/services/skills";
import { CodingRunsService } from "../src/services/coding-runs";
import { HermesSkillKeysService } from "../src/services/hermes-skill-keys";
import { HimalayaAccountService } from "../src/services/himalaya-account";
import { WikiPathService } from "../src/services/wiki-path";

describe.skipIf(process.platform !== "win32")("installed WSL target", () => {
  it.each(["", "\uFEFF"])("accepts install-state.json with prefix %j", async (prefix) => {
    const root = mkdtempSync(join(tmpdir(), "friday-install-state-"));
    try {
      mkdirSync(join(root, "config"));
      writeFileSync(join(root, "config", "install-state.json"),
        prefix + JSON.stringify({ distro_name: "Friday-Ubuntu", linux_user: "friday" }), "utf8");
      const dataDir = join(root, "dashboard", "data");
      const invoke = vi.fn(async (_script: string, _distro: string, _user: string, args: string[]) => {
        if (args[0] === "cli-status") return { clis: ["codex", "opencode", "claude-code"].map((cli) =>
          ({ cli, installed: false, version: null, authState: "signed_out" })) };
        if (_script.endsWith("configure_skill_keys.py")) return { configured: Object.fromEntries(
          ["AIRTABLE_API_KEY", "NOTION_API_KEY", "TENOR_API_KEY", "JINA_API_KEY", "MSGRAPH_TENANT_ID", "MSGRAPH_CLIENT_ID", "MSGRAPH_CLIENT_SECRET"]
            .map((key) => [key, false])), applied: null };
        if (_script.endsWith("configure_wiki_path.py")) return { path: "", revision: 0, configured: false, customized: false, readable: false, applied: null };
        return { managed: false, configPresent: false, credentialsPresent: false, cliInstalled: false,
          readyForLocalUse: false, connectionChecked: false, revision: 0 };
      });
      const config = { paths: { dataDir } } as FridayConfig;
      const skills = {} as SkillsService;
      await expect(new CodingRunsService(config, skills, {}, invoke).cliStatus()).resolves.toHaveLength(3);
      await expect(new HermesSkillKeysService(dataDir, invoke).status()).resolves.toMatchObject({ applied: null });
      await expect(new WikiPathService(dataDir, invoke).status()).resolves.toMatchObject({ revision: 0 });
      await expect(new HimalayaAccountService(dataDir, invoke).status()).resolves.toMatchObject({ revision: 0 });
      expect(invoke).toHaveBeenCalledTimes(4);
      for (const [script, distro, user] of invoke.mock.calls) {
        expect(script).toMatch(/^\/mnt\/[a-z]\/.*\/installer\/wsl\/[^/]+\.py$/);
        expect(distro).toBe("Friday-Ubuntu");
        expect(user).toBe("friday");
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
