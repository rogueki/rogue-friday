import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApi, type TestApi } from "./helpers";

describe("first local owner setup", () => {
  let api: TestApi;
  const dir = mkdtempSync(join(tmpdir(), "friday-owner-setup-"));

  beforeAll(async () => {
    api = await startTestApi({ authMode: "local", firstRunSetup: true, dir });
  });

  afterAll(async () => {
    await api.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates the chosen identity once and remembers the session without storing a password", async () => {
    const client = api.client();
    expect((await client.get("/api/v1/auth/session")).json().data.setupRequired).toBe(true);
    const invalid = await client.post("/api/v1/auth/login", { username: "rogue", displayName: "RogueKI", password: "short" }, { csrf: false });
    expect(invalid.statusCode).toBe(422);

    const created = await client.post("/api/v1/auth/login", {
      username: "rogue", displayName: "RogueKI", password: "sufficiently-long-test-password", rememberMe: true,
    }, { csrf: false });
    expect(created.statusCode, created.body).toBe(200);
    expect(created.json().data.user.displayName).toBe("RogueKI");
    expect(created.json().data.setupRequired).toBe(false);
    expect(String(created.headers["set-cookie"])).toContain("Max-Age=2592000");
    const hashFile = join(api.dir, "config", "owner.hash");
    expect(existsSync(hashFile)).toBe(true);
    expect(readFileSync(hashFile, "utf8")).toMatch(/^scrypt\$/);
    expect(readFileSync(hashFile, "utf8")).not.toContain("sufficiently-long-test-password");

    const second = await api.client().post("/api/v1/auth/login", {
      username: "another", displayName: "Another", password: "another-long-test-password",
    }, { csrf: false });
    expect(second.statusCode).toBe(401);
    const loggedIn = await api.client().post("/api/v1/auth/login", {
      username: "rogue", password: "sufficiently-long-test-password",
    }, { csrf: false });
    expect(loggedIn.statusCode).toBe(200);

    client.csrfToken = created.json().data.csrfToken;
    const settings = (await client.get("/api/v1/settings")).json().data;
    const noLogin = await client.patch("/api/v1/settings", { security: { ...settings.security, loginRequired: false } });
    expect(noLogin.statusCode, noLogin.body).toBe(200);
    const anonymous = api.client();
    const auto = await anonymous.get("/api/v1/auth/session");
    expect(auto.json().data.authenticated).toBe(true);

    const unsafe = await client.patch("/api/v1/settings", { security: { ...settings.security, loginRequired: false, allowRemoteAccess: true } });
    expect(unsafe.statusCode).toBe(422);
    expect((await client.patch("/api/v1/settings", { security: { ...settings.security, loginRequired: true } })).statusCode).toBe(200);
    expect((await anonymous.get("/api/v1/auth/session")).json().data.authenticated).toBe(false);

    await api.close();
    api = await startTestApi({ authMode: "local", firstRunSetup: true, dir });
    expect((await api.client().get("/api/v1/auth/session")).json().data.setupRequired).toBe(false);
    const afterRestart = await api.client().post("/api/v1/auth/login", {
      username: "rogue", password: "sufficiently-long-test-password",
    }, { csrf: false });
    expect(afterRestart.statusCode).toBe(200);
  });
});
