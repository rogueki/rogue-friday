import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inlineScriptHashes } from "../src/http/static";
import { startTestApi, type TestApi } from "./helpers";

const BOOTSTRAP = "self.__next_f=self.__next_f||[];";
const INDEX = `<!DOCTYPE html><html lang="de"><head><title>F.R.I.D.A.Y. Command Center</title><script>${BOOTSTRAP}</script><script src="/_next/static/app.js"></script><script type="application/json" id="data">{"a":1}</script></head><body>Shell</body></html>`;

describe("static web export", () => {
  let api: TestApi;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "jarvis-static-"));
    const web = join(dir, "web");
    mkdirSync(join(web, "_next", "static"), { recursive: true });
    mkdirSync(join(web, "tasks"), { recursive: true });
    writeFileSync(join(web, "index.html"), INDEX);
    writeFileSync(join(web, "tasks", "index.html"), "<html><body>Aufgaben</body></html>");
    writeFileSync(join(web, "404.html"), "<html><body>Seite nicht gefunden</body></html>");
    writeFileSync(join(web, "settings.html"), "<html><body>Einstellungen</body></html>");
    writeFileSync(join(web, "_next", "static", "app.js"), "console.log('app');");
    writeFileSync(join(web, "logo.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
    writeFileSync(join(dir, "secret.txt"), "nicht ausliefern");
    api = await startTestApi({ dir });
  });
  afterAll(async () => {
    await api.app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const get = (path: string, headers: Record<string, string> = {}) => api.fastify.inject({ method: "GET", url: path, headers: { host: "127.0.0.1:3100", ...headers } });

  it("serves the shell at / with a CSP that allows exactly its inline bootstrap script", async () => {
    const response = await get("/");
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(response.headers["cache-control"]).toBe("no-cache");
    const hash = `sha256-${createHash("sha256").update(BOOTSTRAP).digest("base64")}`;
    expect(response.headers["content-security-policy"]).toContain(`'${hash}'`);
    expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(response.headers["content-security-policy"]).not.toContain("unsafe-eval");
    expect(response.headers["content-security-policy"]).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(response.body).toContain("F.R.I.D.A.Y. Command Center");
  });

  it("only hashes executable inline scripts", () => {
    expect(inlineScriptHashes(INDEX)).toEqual([`sha256-${createHash("sha256").update(BOOTSTRAP).digest("base64")}`]);
  });

  it("resolves page routes (file.html, dir/index.html) and falls back to the SPA shell for unknown routes", async () => {
    expect((await get("/settings")).body).toContain("Einstellungen");
    expect((await get("/tasks")).body).toContain("Aufgaben");
    expect((await get("/tasks?task=task_01")).statusCode).toBe(200); // detail views are query params on a known route
    expect((await get("/tasks/")).body).toContain("Aufgaben");
  });

  it("answers unknown page routes with the exported 404 page and status 404 (not the overview)", async () => {
    for (const path of ["/some/deep/client/route", "/does-not-exist", "/tasks/unknown-child"]) {
      const response = await get(path);
      expect(response.statusCode, path).toBe(404);
      expect(response.headers["content-type"]).toBe("text/html; charset=utf-8");
      expect(response.body, path).toContain("Seite nicht gefunden");
      expect(response.body, path).not.toContain("Shell");
      expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    }
  });

  it("serves assets with the right type and long-lived caching for hashed build output", async () => {
    const script = await get("/_next/static/app.js");
    expect(script.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    expect(script.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect((await get("/logo.svg")).headers["content-type"]).toBe("image/svg+xml");
    expect((await get("/logo.svg")).headers["cache-control"]).toBe("public, max-age=300");
  });

  it("answers 404 for missing assets instead of the shell", async () => {
    const response = await get("/_next/static/missing.js");
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain("Shell");
  });

  it.each(["/../secret.txt", "/%2e%2e/secret.txt", "/..%2fsecret.txt", "/%2e%2e%2f%2e%2e%2fetc%2fpasswd", "/\u0000", "/%00"])("never leaves the web root (%s)", async (path) => {
    const response = await get(path);
    expect(response.body).not.toContain("nicht ausliefern");
    expect(response.body).not.toContain("root:");
  });

  it("never answers /api/* with the shell and applies the security headers to static responses", async () => {
    const unknown = await get("/api/v1/unknown");
    expect(unknown.statusCode).toBe(404);
    expect(unknown.headers["content-type"]).toContain("application/json");
    const shell = await get("/");
    expect(shell.headers["x-content-type-options"]).toBe("nosniff");
    expect(shell.headers["x-frame-options"]).toBe("DENY");
  });

  it("rejects a foreign Host header for static files as well (DNS rebinding)", async () => {
    expect((await get("/", { host: "evil.example" })).statusCode).toBe(403);
  });

  it("supports HEAD without a body", async () => {
    const response = await api.fastify.inject({ method: "HEAD", url: "/", headers: { host: "127.0.0.1:3100" } });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("");
  });
});
