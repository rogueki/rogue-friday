import { describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HermesSkillKeysService } from "../src/services/hermes-skill-keys";
import { startTestApi } from "./helpers";

const PATH = "/api/v1/settings/hermes-skill-keys";
const flags = { AIRTABLE_API_KEY: false, NOTION_API_KEY: true, TENOR_API_KEY: false, JINA_API_KEY: false };

describe("Hermes skill key settings", () => {
  it("passes key values only through child stdin", async () => {
    const invoke = vi.fn(async (_script: string, _distro: string, _user: string, _args: string[], _input?: string) => ({ configured: flags, applied: true }));
    const service = new HermesSkillKeysService("unused", invoke);
    vi.spyOn(service as unknown as { target: () => { script: string; distro: string; user: string } }, "target")
      .mockReturnValue({ script: "/mnt/d/Friday/installer/wsl/configure_skill_keys.py", distro: "Friday-Ubuntu", user: "friday" });
    await service.update("NOTION_API_KEY", "synthetic-private-value");
    const [script, distro, user, args, input] = invoke.mock.calls[0]!;
    expect(script).toMatch(/\/installer\/wsl\/configure_skill_keys\.py$/);
    expect(distro).toBe("Friday-Ubuntu");
    expect(user).toBe("friday");
    expect(args).toEqual(["update"]);
    expect(JSON.parse(input!)).toEqual({ key: "NOTION_API_KEY", value: "synthetic-private-value" });
    expect([script, distro, user, ...args].join(" ")).not.toContain("synthetic-private-value");
  });

  it.skipIf(process.platform !== "win32")("uses the installed WSL identity on Windows", async () => {
    const root = mkdtempSync(join(tmpdir(), "friday-hermes-keys-"));
    try {
      mkdirSync(join(root, "config"));
      writeFileSync(join(root, "config", "install-state.json"), JSON.stringify({ distro_name: "Friday-Ubuntu", linux_user: "friday" }));
      const invoke = vi.fn(async (_script: string, _distro: string, _user: string, _args: string[], _input?: string) => ({ configured: flags, applied: true }));
      const service = new HermesSkillKeysService(join(root, "data"), invoke);
      await service.update("NOTION_API_KEY", "synthetic-private-value");
      const [script, distro, user, args, input] = invoke.mock.calls[0]!;
      expect(script).toMatch(/\/installer\/wsl\/configure_skill_keys\.py$/);
      expect(distro).toBe("Friday-Ubuntu");
      expect(user).toBe("friday");
      expect(args).toEqual(["update"]);
      expect(JSON.parse(input!)).toEqual({ key: "NOTION_API_KEY", value: "synthetic-private-value" });
      expect([script, distro, user, ...args].join(" ")).not.toContain("synthetic-private-value");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("limits reads and mutations to the owner, applies CSRF, and never returns or logs values", async () => {
    const logs: string[] = [];
    const api = await startTestApi({ logs });
    try {
      const anonymous = api.client();
      const viewer = api.client(); await viewer.loginDev("viewer");
      const owner = api.client(); await owner.loginDev("owner");
      const input = { key: "AIRTABLE_API_KEY", value: "sample-private-token" };
      const status = vi.spyOn(api.runtime.hermesSkillKeys, "status").mockResolvedValue({ configured: flags, applied: null });
      const update = vi.spyOn(api.runtime.hermesSkillKeys, "update").mockResolvedValue({ configured: { ...flags, AIRTABLE_API_KEY: true }, applied: true });
      expect((await anonymous.get(PATH)).statusCode).toBe(401);
      expect((await viewer.get(PATH)).statusCode).toBe(403);
      expect((await anonymous.patch(PATH, input)).statusCode).toBe(401);
      expect((await viewer.patch(PATH, input)).statusCode).toBe(403);
      expect((await owner.request("PATCH", PATH, { body: input, csrf: false })).statusCode).toBe(403);
      expect((await owner.patch(PATH, { key: "OPENAI_API_KEY", value: input.value })).statusCode).toBe(422);
      const read = await owner.get(PATH);
      expect(read.statusCode).toBe(200);
      expect(read.json().data).toEqual({ configured: flags, applied: null });
      const saved = await owner.patch(PATH, input);
      expect(saved.statusCode, saved.body).toBe(200);
      expect(saved.json().data).toEqual({ configured: { ...flags, AIRTABLE_API_KEY: true }, applied: true });
      expect(status).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledWith(input.key, input.value);
      expect(read.body + saved.body + logs.join("\n")).not.toContain(input.value);
    } finally { await api.close(); }
  });
});
