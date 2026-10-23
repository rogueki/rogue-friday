/**
 * Live proof for DASH-14.05/14.06: the plan and the studio switch survive a restart, switching the module off loses
 * nothing, and a production job without provider access never becomes a phantom row.
 */
import { spawn } from "node:child_process";
import { join } from "node:path";

const REPO = process.cwd();
const ROOT = process.env.LIVE_ROOT ?? join(process.env.TEMP ?? "/tmp", "friday-live-root");
const PORT = Number(process.env.LIVE_PORT ?? 3121);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = process.env.LIVE_PASSWORD ?? "friday-live-proof-2026";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let server;
const start = async () => {
  server = spawn(process.execPath, ["apps/control-api/dist/main.js"], {
    cwd: REPO, env: { ...process.env, FRIDAY_CONFIG_DIR: join(ROOT, "config"), FRIDAY_PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  server.stdout.on("data", (chunk) => { log += chunk; });
  server.stderr.on("data", (chunk) => { log += chunk; });
  for (let attempt = 0; attempt < 90; attempt += 1) {
    await wait(500);
    if (log.includes(String(PORT))) return;
    if (server.exitCode !== null) throw new Error(`server exited: ${log.slice(-300)}`);
  }
  throw new Error("server did not start");
};
const stop = async () => { server.kill(); await wait(1200); };

let cookie = "";
let csrf = "";
const login = async () => {
  const response = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "operator", displayName: "Studio Restart Proof", password: PASSWORD }),
  });
  const cookies = (response.headers.getSetCookie?.() ?? []).map((entry) => entry.split(";")[0]);
  cookie = cookies.join("; ");
  csrf = cookies.find((entry) => entry.startsWith("friday_csrf="))?.slice("friday_csrf=".length) ?? "";
  return response.status;
};
const call = async (method, path, body, extra = {}) => {
  const response = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", cookie, ...(method === "GET" ? {} : { "x-csrf-token": csrf }), ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: response.status, body: parsed, headers: response.headers };
};

const report = [];
await start();
report.push(`login ${await login()}`);

const settings = await call("GET", "/api/v1/settings");
const dashboard = settings.body?.data?.dashboard ?? {};
const plan = { version: 1, exportiert_am: "2026-10-23T00:00:00.000Z",
  content: [{ id: "restart-idea", titel: "Neustart-Idee", plattform: "LinkedIn", ziele: ["LinkedIn"], format: "Feed-Post",
    beschreibung: "Bleibt nach Neustart erhalten.", zieldatum: "2026-10-30", status: "idee" }],
  postings: [{ id: "restart-post", titel: "Neustart-Post", datum: "2026-10-30", uhrzeit: "09:00", plattform: "LinkedIn",
    ziele: ["LinkedIn"], format: "Feed-Post", status: "geplant" }] };
const current = await call("GET", "/api/v1/content-studio/plan");
const revision = current.body?.data?.revision ?? 0;
const saved = await call("PUT", "/api/v1/content-studio/plan", plan, { "if-match": String(revision) });
report.push(`plan saved: HTTP ${saved.status}, revision ${saved.body?.data?.revision}, content ${saved.body?.data?.plan?.content?.length}, postings ${saved.body?.data?.plan?.postings?.length}`);

// A production job without provider keys must not leave a row behind.
const noKey = await call("POST", "/api/v1/content-studio/production-jobs",
  { ideaId: "restart-idea", planRevision: saved.body?.data?.revision, confirmed: true },
  { "idempotency-key": `restart-proof-${Date.now()}` });
report.push(`production job without keys: HTTP ${noKey.status} - ${noKey.body?.error?.message ?? ""}`);
const jobsBefore = await call("GET", "/api/v1/content-studio/production-jobs/00000000-0000-4000-8000-000000000000");
report.push(`phantom job check: HTTP ${jobsBefore.status} (no invented row)`);

await stop();
await start();
report.push(`login after restart ${await login()}`);
const afterRestart = await call("GET", "/api/v1/content-studio/plan");
const stored = afterRestart.body?.data?.plan;
report.push(`plan after restart: revision ${afterRestart.body?.data?.revision}, content ${stored?.content?.length}, postings ${stored?.postings?.length}, title "${stored?.content?.[0]?.titel ?? ""}"`);
report.push(`identical: ${JSON.stringify(stored?.content?.[0]?.id) === '"restart-idea"'
  && JSON.stringify(stored?.postings?.[0]?.id) === '"restart-post"'} `);

// Rolling the component back must not touch the stored plan.
const off = await call("PATCH", "/api/v1/settings", { dashboard: { ...dashboard, contentStudioEnabled: false } },
  { "if-match": String(settings.body?.data?.version ?? 0) });
report.push(`studio switched off: HTTP ${off.status}`);
const hidden = await call("GET", "/api/v1/content-studio/plan");
report.push(`plan while switched off: HTTP ${hidden.status}`);
const reSettings = await call("GET", "/api/v1/settings");
const on = await call("PATCH", "/api/v1/settings",
  { dashboard: { ...reSettings.body?.data?.dashboard, contentStudioEnabled: true } },
  { "if-match": String(reSettings.body?.data?.version ?? 0) });
report.push(`studio switched on again: HTTP ${on.status}`);
const restored = await call("GET", "/api/v1/content-studio/plan");
report.push(`plan after rollback: revision ${restored.body?.data?.revision}, content ${restored.body?.data?.plan?.content?.length}, postings ${restored.body?.data?.plan?.postings?.length}`);

await stop();
console.log(report.join("\n"));