import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApi, type TestApi } from "./helpers";

const PATH = "/api/v1/settings/content-studio-keys";
const removeTestDir = (dir: string): void => {
  if (!resolve(dir).startsWith(`${resolve(tmpdir())}${sep}`)) throw new Error("Unsafe test directory");
  rmSync(dir, { recursive: true, force: true });
};

describe("Content Studio provider credentials", () => {
  let api: TestApi;
  beforeAll(async () => { api = await startTestApi(); });
  afterAll(async () => { await api.close(); });

  it("requires owner role and CSRF and never returns a key", async () => {
    const viewer = api.client();
    await viewer.loginDev("viewer");
    expect((await viewer.get(PATH)).statusCode).toBe(403);
    expect((await viewer.patch(PATH, { provider: "kie", key: "private-test-value" })).statusCode).toBe(403);

    const owner = api.client();
    await owner.loginDev("owner");
    expect((await owner.patch(PATH, { provider: "kie", key: "private-test-value" }, { csrf: false })).statusCode).toBe(403);
    const saved = await owner.patch(PATH, { provider: "kie", key: "private-test-value" });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().data.kie).toBe(true);
    expect(saved.body).not.toContain("private-test-value");
    const status = await owner.get(PATH);
    expect(status.json().data.kie).toBe(true);
    expect(status.body).not.toContain("private-test-value");
    expect((await owner.get("/api/v1/settings/export")).body).not.toContain("private-test-value");
    expect((await owner.get("/api/v1/audit/events", { query: { limit: "100" } })).body).not.toContain("private-test-value");
    expect((await owner.patch(PATH, { provider: "unknown", key: "x" })).statusCode).toBe(422);
    const cleared = await owner.patch(PATH, { provider: "kie", key: "" });
    expect(cleared.json().data.kie).toBe(false);
  });

  it("persists only encrypted values across restart, supports deletion and environment fallback", async () => {
    const dir = mkdtempSync(join(tmpdir(), "friday-studio-keys-"));
    try {
      const first = await startTestApi({ dir, env: { CAPCUT_API_KEY: "env-capcut-value" } });
      const owner = first.client();
      await owner.loginDev("owner");
      for (const [provider, key] of [["kie", "private-kie-restart"], ["elevenlabs", "private-eleven-restart"], ["capcut", "private-capcut-restart"]] as const) {
        const saved = await owner.patch(PATH, { provider, key });
        expect(saved.statusCode, saved.body).toBe(200);
        expect(saved.body).not.toContain(key);
        const stored = first.runtime.db.prepare("SELECT value FROM kv WHERE key = ?").get(`content-studio.secret.${provider}`) as { value: string };
        expect(stored.value).toMatch(/^v1:/);
        expect(stored.value).not.toContain(key);
      }
      expect(first.runtime.contentStudioKeys.get("kie")).toBe("private-kie-restart");
      expect(first.runtime.contentStudioKeys.get("capcut")).toBe("private-capcut-restart");
      await first.close();
      for (const name of ["dashboard.sqlite", "dashboard.sqlite-wal"]) {
        const file = join(dir, "data", name);
        if (existsSync(file)) {
          const bytes = readFileSync(file);
          for (const secret of ["private-kie-restart", "private-eleven-restart", "private-capcut-restart"]) {
            expect(bytes.includes(Buffer.from(secret))).toBe(false);
          }
        }
      }

      const second = await startTestApi({ dir, env: { CAPCUT_API_KEY: "env-capcut-value" } });
      const restartedOwner = second.client();
      await restartedOwner.loginDev("owner");
      expect((await restartedOwner.get(PATH)).json().data).toMatchObject({ kie: true, elevenlabs: true, capcut: true });
      expect(second.runtime.contentStudioKeys.get("kie")).toBe("private-kie-restart");
      expect(second.runtime.contentStudioKeys.get("elevenlabs")).toBe("private-eleven-restart");
      expect(second.runtime.contentStudioKeys.get("capcut")).toBe("private-capcut-restart");
      const cleared = await restartedOwner.patch(PATH, { provider: "capcut", key: "" });
      expect(cleared.json().data.capcut).toBe(true); // environment fallback remains active
      expect(second.runtime.contentStudioKeys.get("capcut")).toBe("env-capcut-value");
      expect(second.runtime.db.prepare("SELECT value FROM kv WHERE key = ?").get("content-studio.secret.capcut")).toBeUndefined();
      await restartedOwner.patch(PATH, { provider: "kie", key: "" });
      expect(second.runtime.contentStudioKeys.get("kie")).toBeUndefined();
      await second.close();
    } finally {
      removeTestDir(dir);
    }
  });

  it("fails startup with preserved ciphertext if auth.key is missing or replaced", async () => {
    const dir = mkdtempSync(join(tmpdir(), "friday-studio-key-loss-"));
    try {
      const first = await startTestApi({ dir });
      const owner = first.client();
      await owner.loginDev("owner");
      await owner.patch(PATH, { provider: "kie", key: "private-recovery-value" });
      await first.close();
      const authPath = join(dir, "data", "auth.key");
      const backupPath = join(dir, "data", "auth.key.backup");
      const original = readFileSync(authPath);
      renameSync(authPath, backupPath);
      await expect(startTestApi({ dir })).rejects.toThrow(/original auth\.key/);
      renameSync(backupPath, authPath);
      writeFileSync(authPath, Buffer.alloc(32, 7).toString("base64"));
      await expect(startTestApi({ dir, env: { KIE_API_KEY: "env-must-not-mask-wrong-master" } })).rejects.toThrow(/cannot be decrypted/);
      writeFileSync(authPath, original);
      const recovered = await startTestApi({ dir });
      expect(recovered.runtime.contentStudioKeys.get("kie")).toBe("private-recovery-value");
      await recovered.close();
    } finally {
      removeTestDir(dir);
    }
  });
});
