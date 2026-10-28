/**
 * Live proof for DASH-10.06: restart equality and the missing-installation case.
 *
 * Starts the built Control API twice on the same data root, compares the skill state the API reports, then points
 * `config/install-state.json` at a distro that does not exist and checks that the API says why instead of quietly
 * returning an empty catalogue. Not part of the test suite: it needs a real WSL distro and the built server.
 */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPO = process.cwd();
const ROOT = process.env.LIVE_ROOT ?? join(process.env.TEMP ?? "/tmp", "friday-live-root");
const STATE = join(ROOT, "config", "install-state.json");
const PORT = Number(process.env.LIVE_PORT ?? 3112);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = process.env.LIVE_PASSWORD ?? "friday-live-proof-2026";
const original = readFileSync(STATE, "utf8");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const start = async () => {
  const child = spawn(process.execPath, ["apps/control-api/dist/main.js"], {
    cwd: REPO, env: { ...process.env, FRIDAY_CONFIG_DIR: join(ROOT, "config"), FRIDAY_PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (chunk) => { log += chunk; });
  child.stderr.on("data", (chunk) => { log += chunk; });
  for (let attempt = 0; attempt < 90; attempt += 1) {
    await wait(500);
    if (log.includes("Control API") && log.includes(String(PORT))) return { child, log: () => log };
    if (child.exitCode !== null) throw new Error(`server exited early: ${log.slice(-400)}`);
  }
  child.kill();
  throw new Error(`server did not start: ${log.slice(-400)}`);
};

const stop = async (server) => {
  server.child.kill();
  await wait(1200);
};

let cookie = "";
const login = async () => {
  cookie = "";
  const response = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "operator", displayName: "Restart Proof", password: PASSWORD }),
  });
  cookie = (response.headers.getSetCookie?.() ?? []).map((entry) => entry.split(";")[0]).join("; ");
  return response.status;
};

const get = async (path) => {
  const started = Date.now();
  const response = await fetch(BASE + path, { headers: cookie ? { cookie } : {} });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: response.status, ms: Date.now() - started, body };
};

const snapshot = (body) => {
  const skills = body?.data ?? [];
  const state = skills.map((skill) => `${skill.id}:${skill.enabled}:${skill.origin}:${skill.trust}`).sort();
  return { total: skills.length, state, source: skills[0]?.observationSource ?? null };
};

const report = [];
let server = await start();
report.push(`login ${await login()}`);
const first = await get("/api/v1/skills");
const before = snapshot(first.body);
report.push(`run 1: HTTP ${first.status} in ${Math.round(first.ms / 100) / 10} s, ${before.total} skills, source ${before.source}`);
await stop(server);

server = await start();
report.push(`login after restart ${await login()}`);
const second = await get("/api/v1/skills");
const after = snapshot(second.body);
report.push(`run 2: HTTP ${second.status} in ${Math.round(second.ms / 100) / 10} s, ${after.total} skills, source ${after.source}`);
const identical = before.state.length === after.state.length && before.state.every((entry, index) => entry === after.state[index]);
report.push(`state identical after restart: ${identical ? "yes" : "NO"}`);
if (!identical) {
  const onlyBefore = before.state.filter((entry) => !after.state.includes(entry)).slice(0, 3);
  const onlyAfter = after.state.filter((entry) => !before.state.includes(entry)).slice(0, 3);
  report.push(`  only before: ${JSON.stringify(onlyBefore)}`);
  report.push(`  only after:  ${JSON.stringify(onlyAfter)}`);
}
await stop(server);

// A distro that does not exist: the API must name the reason, not return an empty list.
writeFileSync(STATE, JSON.stringify({ assistant_name: "FRIDAY", distro_name: "Ghost-Distro", linux_user: "ubuntu",
  done: ["distro"] }, null, 2));
server = await start();
report.push(`login with a missing installation ${await login()}`);
const broken = await get("/api/v1/skills");
report.push(`missing installation: HTTP ${broken.status}, catalogError "${broken.body?.catalogError ?? ""}", hermesError "${broken.body?.hermesError ?? ""}"`);
const details = JSON.stringify(broken.body?.data ?? []);
report.push(`  catalogue stays empty (${Array.isArray(broken.body?.data) ? broken.body.data.length : "?"} entries), no invented skills: ${details.length < 20}`);
const reportCall = await get("/api/v1/skills/arxiv/diff");
report.push(`  diff with a missing installation: HTTP ${reportCall.status}, message "${reportCall.body?.error?.message ?? reportCall.body?.message ?? ""}"`);
const detail = reportCall.body?.error?.details?.detail;
report.push(`  reason kept: ${detail ? String(detail).slice(0, 160) : "(none)"}`);
await stop(server);

writeFileSync(STATE, original);
console.log(report.join("\n"));