import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { startTestApi, type TestApi } from "./helpers";
import { createApprovedTask } from "./support/task-actions";

/** Phase 12 gate (docs/SECURITY.md §9): checks that no other suite covers. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const opened: TestApi[] = [];
const start = async (options: Parameters<typeof startTestApi>[0] = {}) => {
  const api = await startTestApi(options);
  opened.push(api);
  return api;
};
afterEach(async () => {
  for (const api of opened.splice(0)) await api.close().catch(() => undefined);
});

describe("no permissive CORS", () => {
  it("sends no Access-Control-* header, also not for a foreign Origin or a preflight", async () => {
    const api = await start();
    const owner = api.client();
    await owner.loginDev("owner");
    for (const response of [
      await owner.get("/api/v1/tasks", { headers: { origin: "https://evil.example" } }),
      await owner.request("OPTIONS", "/api/v1/tasks", { headers: { origin: "https://evil.example", "access-control-request-method": "POST" } }),
      await api.client().get("/api/v1/health", { headers: { origin: "https://evil.example" } }),
    ]) {
      const names = Object.keys(response.headers).filter((name) => name.startsWith("access-control-"));
      expect(names).toEqual([]);
    }
  });
});

describe("cookies behind TLS", () => {
  it("adds Secure and HSTS when auth.secureCookies is on, and omits both on plain localhost", async () => {
    const plain = await start();
    const plainLogin = await plain.client().post("/api/v1/auth/login", { username: "dev-owner", password: "dev" }, { csrf: false });
    const plainCookies = ([] as string[]).concat(plainLogin.headers["set-cookie"] ?? []);
    expect(plainCookies.length).toBeGreaterThan(0);
    for (const cookie of plainCookies) expect(cookie).not.toMatch(/;\s*Secure/i);
    expect(plainLogin.headers["strict-transport-security"]).toBeUndefined();

    const secure = await start({ secureCookies: true });
    const login = await secure.client().post("/api/v1/auth/login", { username: "dev-owner", password: "dev" }, { csrf: false });
    const cookies = ([] as string[]).concat(login.headers["set-cookie"] ?? []);
    expect(cookies.find((cookie) => cookie.startsWith("friday_session="))).toMatch(/;\s*Secure/i);
    expect(cookies.find((cookie) => cookie.startsWith("friday_csrf="))).toMatch(/;\s*Secure/i);
    expect(login.headers["strict-transport-security"]).toContain("max-age=");
  });
});

describe("server key loss (auth.key)", () => {
  it("invalidates only CSRF tokens: sessions, data and the audit trail survive; a fresh session read reissues a working token", async () => {
    const dir = mkdtempSync(join(tmpdir(), "friday-keyloss-"));
    let restarted: TestApi | undefined;
    try {
      const first = await start({ dir });
      const before = first.client();
      await before.loginDev("owner");
      const created = await createApprovedTask(before, { title: "Vor dem Schlüsselverlust" });
      expect(created.task.title).toBe("Vor dem Schlüsselverlust");
      const staleCsrf = before.csrfToken;
      const cookies = new Map(before.cookies);
      const auditBefore = first.runtime.stores.audit.count();
      await first.app.close();
      opened.splice(opened.indexOf(first), 1);

      unlinkSync(join(first.config.paths.dataDir, "auth.key"));
      const second = await start({ dir });
      restarted = second;
      const after = second.client();
      for (const [name, value] of cookies) after.cookies.set(name, value);
      after.csrfToken = staleCsrf;
      expect((await after.get("/api/v1/tasks")).statusCode, "the stored session is still valid").toBe(200);
      expect((await after.post("/api/v1/tasks", { title: "mit altem Token" })).statusCode).toBe(403);
      const session = await after.get("/api/v1/auth/session");
      after.csrfToken = (session.json() as { data: { csrfToken: string } }).data.csrfToken;
      after.cookies.set("friday_csrf", after.csrfToken);
      expect((await createApprovedTask(after, { title: "mit neuem Token" })).task.title).toBe("mit neuem Token");
      expect(second.runtime.stores.audit.count()).toBeGreaterThanOrEqual(auditBefore);
      expect(second.runtime.stores.audit.verify()).toMatchObject({ valid: true });
    } finally {
      if (restarted) {
        await restarted.app.close();
        opened.splice(opened.indexOf(restarted), 1);
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("still reports a really tampered trail after the key was regenerated", async () => {
    const dir = mkdtempSync(join(tmpdir(), "friday-keyloss-"));
    let restarted: TestApi | undefined;
    try {
      const first = await start({ dir });
      const client = first.client();
      await client.loginDev("owner");
      await createApprovedTask(client, { title: "a" });
      await createApprovedTask(client, { title: "b" });
      const victim = first.runtime.db.prepare("SELECT seq, json FROM audit_log WHERE seq = 2").get() as { seq: number; json: string };
      first.runtime.db.prepare("UPDATE audit_log SET json = ? WHERE seq = ?").run(victim.json.replace('"action"', '"tampered"'), victim.seq);
      await first.app.close();
      opened.splice(opened.indexOf(first), 1);
      unlinkSync(join(first.config.paths.dataDir, "auth.key"));
      const second = await start({ dir });
      restarted = second;
      expect(second.runtime.stores.audit.verify()).toMatchObject({ valid: false });
    } finally {
      if (restarted) {
        await restarted.app.close();
        opened.splice(opened.indexOf(restarted), 1);
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/** Raw request line, so the client cannot normalise the path before it reaches the server. */
function rawGet(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolvePromise, reject) => {
    const req = request({ host: "127.0.0.1", port, method: "GET", path, headers: { host: `127.0.0.1:${port}` } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolvePromise({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("static files over a real socket", () => {
  it.each(["/../../../../etc/passwd", "/..%2f..%2f..%2fetc%2fpasswd", "/%2e%2e/%2e%2e/etc/passwd", "/_next/../../etc/passwd", "/..\\..\\etc\\passwd", "/%252e%252e/etc/passwd"])(
    "never serves files outside the web root (%s)",
    async (path) => {
      const api = await start({ listen: true });
      const response = await rawGet(api.port, path);
      expect(response.body).not.toContain("root:");
      expect(response.body).not.toContain("auth.key");
      expect([200, 400, 403, 404]).toContain(response.status);
    },
  );

  it("does not expose the data directory (auth.key, sqlite) through the web root", async () => {
    const api = await start({ listen: true });
    for (const path of ["/auth.key", "/dashboard.sqlite", "/../data/auth.key"]) {
      const response = await rawGet(api.port, path);
      expect(response.status === 200 ? response.body : "").not.toMatch(/^[A-Za-z0-9+/=]{40,}$/);
    }
  });
});

describe("browser bundle", () => {
  const out = join(ROOT, "apps", "web", "out");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : /\.(js|html|css|json|txt|map)$/.test(name) ? [path] : [];
    });

  it.skipIf(!existsSync(join(out, "index.html")))("contains no secret material, server paths or credentials", () => {
    const patterns: Array<[string, RegExp]> = [
      ["scrypt hash", /scrypt\$\d+\$/],
      ["owner hash env", /FRIDAY_OWNER_PASSWORD_HASH/],
      ["bearer token", /Bearer\s+[A-Za-z0-9._-]{20,}/],
      ["vendor key", /\b(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16})\b/],
      ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
      ["server key file", /auth\.key/],
    ];
    const hits: string[] = [];
    for (const file of files(out)) {
      const text = readFileSync(file, "utf8");
      for (const [label, pattern] of patterns) if (pattern.test(text)) hits.push(`${label}: ${file.slice(out.length)}`);
    }
    expect(hits).toEqual([]);
  });

  it("only the MSW switch is a public build variable", () => {
    const source = execFileSync("git", ["grep", "-ho", "NEXT_PUBLIC_[A-Z_]*", "--", "apps/web/src", "apps/web/next.config.ts", "apps/web/scripts"], { cwd: ROOT, encoding: "utf8" });
    expect([...new Set(source.split("\n").filter(Boolean))]).toEqual(["NEXT_PUBLIC_FRIDAY_MSW"]);
  });
});

describe("repository hygiene", () => {
  it.each([".env", ".env.local", "data/", "logs/", "backups/", "MEMORY.md", "SCOPE.md", "AGENTS.md", "PROMPT.md"])("%s is git-ignored", (path) => {
    expect(() => execFileSync("git", ["check-ignore", "-q", path], { cwd: ROOT })).not.toThrow();
  });

  it(".env.example is tracked and .env is not", () => {
    const tracked = execFileSync("git", ["ls-files", ".env", ".env.example"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
    expect(tracked).toEqual([".env.example"]);
  });

  it("the installer deploys an allowlist of sources only: no agent metadata, .env, data, logs or docs", () => {
    const script = readFileSync(join(ROOT, "installer", "install-friday.ps1"), "utf8");
    const list = (name: string): string[] => {
      const match = new RegExp(`\\$${name}\\s*=\\s*@\\(([^)]*)\\)`).exec(script);
      return [...(match?.[1] ?? "").matchAll(/'([^']+)'/g)].map((entry) => entry[1] as string);
    };
    const dirs = list("DashSyncDirs");
    const rootFiles = list("DashRootFiles");
    expect(dirs).toEqual(["apps", "packages", "adapters", "scripts"]);
    for (const forbidden of ["CLAUDE.md", "MEMORY.md", "SCOPE.md", "AGENTS.md", ".env", "docs", "data", "logs", "backups"]) {
      expect([...dirs, ...rootFiles], forbidden).not.toContain(forbidden);
    }
    expect(list("DashExcludeDirs")).toEqual(expect.arrayContaining([".claude", "node_modules", ".git", "evidence", "fixtures"]));
  });

  it("the dashboard sync never copies key material from the source tree", () => {
    const sync = readFileSync(join(ROOT, "installer", "lib", "dashboard-sync.ps1"), "utf8");
    const mirror = sync.split("\n").find((line) => line.includes("robocopy.exe") && line.includes("/MIR")) ?? "";
    for (const pattern of ["'*.key'", "'*.pem'", "'*.pfx'", "'*.p12'"]) expect(mirror, pattern).toContain(pattern);
  });

  it("the downloadable source archive leaves out agent metadata and working drafts", () => {
    for (const path of ["CLAUDE.md", ".claude/agents/implementer.md", "docs/agent-work/finalization/issue-ledger.csv"]) {
      const attribute = execFileSync("git", ["check-attr", "export-ignore", "--", path], { cwd: ROOT, encoding: "utf8" });
      expect(attribute.trim(), path).toMatch(/export-ignore: set$/);
    }
    const kept = execFileSync("git", ["check-attr", "export-ignore", "--", "installer/install-friday.ps1", "README.md"], { cwd: ROOT, encoding: "utf8" });
    expect(kept).not.toContain("set");
  });

  it("ships only the synthetic voice outputs and test audio, never own voice recordings", () => {
    const audio = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" }).split("\0")
      .filter((path) => /\.(wav|mp3|flac|ogg|m4a|opus|npy|npz)$/i.test(path)).sort();
    expect(audio).toEqual([
      "installer/voice/tests/fixtures/audio/calendar.wav",
      "installer/voice/tests/fixtures/audio/mail.wav",
      "installer/voice/tests/fixtures/audio/no.wav",
      "installer/voice/tests/fixtures/audio/research.wav",
      "installer/voice/tests/fixtures/audio/yes.wav",
      "installer/voice_models/friday_ref.wav",
      "installer/voice_models/jarvis_ref.wav",
    ]);
    const ignored = execFileSync("git", ["check-ignore", "--no-index", "-v", "installer/voice_models/owner_recording.wav"], { cwd: ROOT, encoding: "utf8" });
    expect(ignored).toContain(".gitignore");
  });
});
