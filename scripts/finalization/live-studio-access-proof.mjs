/**
 * Live proof for DASH-14.03: the studio is built with the app, and without provider access it says so instead of
 * pretending to produce. Runs the built Control API against a real data root.
 */
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

const REPO = process.cwd();
const ROOT = process.env.LIVE_ROOT ?? join(process.env.TEMP ?? "/tmp", "friday-live-root");
const PORT = Number(process.env.LIVE_PORT ?? 3118);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = process.env.LIVE_PASSWORD ?? "friday-live-proof-2026";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const report = [];
const artifact = join(REPO, "apps", "web", "out", "content-studio.html");
report.push(`build artefact apps/web/out/content-studio.html: ${existsSync(artifact) ? `present (${statSync(artifact).size} B)` : "MISSING"}`);

const child = spawn(process.execPath, ["apps/control-api/dist/main.js"], {
  cwd: REPO, env: { ...process.env, FRIDAY_CONFIG_DIR: join(ROOT, "config"), FRIDAY_PORT: String(PORT) },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
child.stdout.on("data", (chunk) => { log += chunk; });
child.stderr.on("data", (chunk) => { log += chunk; });
for (let attempt = 0; attempt < 90 && !log.includes(String(PORT)); attempt += 1) {
  await wait(500);
  if (child.exitCode !== null) throw new Error(`server exited: ${log.slice(-300)}`);
}

const login = await fetch(`${BASE}/api/v1/auth/login`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "operator", displayName: "Studio Access Proof", password: PASSWORD }),
});
const cookies = (login.headers.getSetCookie?.() ?? []).map((entry) => entry.split(";")[0]);
const cookie = cookies.join("; ");
const csrf = cookies.find((entry) => entry.startsWith("friday_csrf="))?.slice("friday_csrf=".length) ?? "";
report.push(`login ${login.status}, csrf ${csrf ? "present" : "MISSING"}`);

const call = async (method, path, body) => {
  const response = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", cookie, ...(method === "GET" ? {} : { "x-csrf-token": csrf }),
      ...(method === "GET" ? {} : { "idempotency-key": `proof-${Date.now()}` }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: response.status, type: response.headers.get("content-type"), body: parsed };
};

const settings = await call("GET", "/api/v1/settings");
report.push(`studio switch default: ${settings.body?.data?.dashboard?.contentStudioEnabled}`);

const media = await call("POST", "/api/v1/content-studio/kie/tasks",
  { kind: "image", aspectRatio: "1:1", prompt: "Nachweis ohne Anbieter", confirmed: true });
report.push(`media job without provider key: HTTP ${media.status} - ${media.body?.error?.code ?? ""} ${media.body?.error?.message ?? ""}`);

const speech = await call("POST", "/api/v1/content-studio/elevenlabs/speech", { text: "Nachweis", voiceId: "default", confirmed: true });
report.push(`speech without provider key: HTTP ${speech.status} - ${speech.body?.error?.code ?? ""} ${speech.body?.error?.message ?? ""}`);

// Production jobs live in content_studio_jobs (request hash, provider task id, state, result url). An unknown id must
// not turn into an invented job.
const job = await call("GET", "/api/v1/content-studio/production-jobs/00000000-0000-4000-8000-000000000000");
report.push(`unknown production job: HTTP ${job.status} - ${job.body?.error?.code ?? ""} ${job.body?.error?.message ?? ""}`);

child.kill();
console.log(report.join("\n"));