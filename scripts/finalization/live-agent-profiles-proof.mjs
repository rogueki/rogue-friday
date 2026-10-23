/**
 * Live proof for DASH-15: the seven domain profiles are created in the real Hermes store, so the product must list them
 * from that configuration instead of from a hardcoded card set.
 */
import { spawn } from "node:child_process";
import { join } from "node:path";

const REPO = process.cwd();
const ROOT = process.env.LIVE_ROOT ?? join(process.env.TEMP ?? "/tmp", "friday-live-root");
const PORT = Number(process.env.LIVE_PORT ?? 3122);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = process.env.LIVE_PASSWORD ?? "friday-live-proof-2026";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

try {
  const login = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "operator", displayName: "Agent Profiles Proof", password: PASSWORD }),
  });
  const cookie = (login.headers.getSetCookie?.() ?? []).map((entry) => entry.split(";")[0]).join("; ");
  const listed = await fetch(`${BASE}/api/v1/agents?limit=50`, { headers: { cookie } });
  const body = await listed.json();
  const agents = body?.data?.items ?? [];
  if (listed.status !== 200) console.log(`error body: ${JSON.stringify(body).slice(0, 400)}`);
  console.log(`GET /api/v1/agents: HTTP ${listed.status}, ${agents.length} agents, source ${body?.data?.observationSource ?? "?"}`);
  for (const agent of agents.sort((a, b) => String(a.name).localeCompare(String(b.name)))) {
    console.log(`- ${agent.name} | ${agent.status} | ${agent.role ?? "-"} | profile ${agent.profile ?? "-"} | model ${agent.model ?? "-"}`);
  }
} finally {
  child.kill();
}