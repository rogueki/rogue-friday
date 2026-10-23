/**
 * Live proof for DASH-14.04: a publication claim needs its origin.
 *
 * Runs the built Control API against a real data root and drives the plan endpoint over HTTP. Everything here is a
 * manual marking, because no publisher adapter exists - the API has to say so instead of storing a bare "gepostet".
 */
import { spawn } from "node:child_process";
import { join } from "node:path";

const REPO = process.cwd();
const ROOT = process.env.LIVE_ROOT ?? join(process.env.TEMP ?? "/tmp", "friday-live-root");
const PORT = Number(process.env.LIVE_PORT ?? 3115);
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

let cookie = "";
for (let attempt = 0; attempt < 90 && !log.includes(String(PORT)); attempt += 1) {
  await wait(500);
  if (child.exitCode !== null) throw new Error(`server exited: ${log.slice(-300)}`);
}

let csrf = "";
const call = async (method, path, body, extra = {}) => {
  const response = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}),
      ...(csrf && method !== "GET" ? { "x-csrf-token": csrf } : {}), ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: response.status, body: parsed };
};
const login = await fetch(`${BASE}/api/v1/auth/login`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "operator", displayName: "Studio Proof", password: PASSWORD }),
});
const cookies = (login.headers.getSetCookie?.() ?? []).map((entry) => entry.split(";")[0]);
cookie = cookies.join("; ");
csrf = cookies.find((entry) => entry.startsWith("friday_csrf="))?.slice("friday_csrf=".length) ?? "";

const report = [`login ${login.status}, csrf cookie ${csrf ? "present" : "MISSING"}`];
const current = await call("GET", "/api/v1/content-studio/plan");
report.push(`plan read HTTP ${current.status}, revision ${current.body?.data?.revision}`);

const posting = { id: "proof-posting", titel: "Nachweis", datum: "2026-10-24", uhrzeit: "10:00", plattform: "LinkedIn",
  ziele: ["LinkedIn"], format: "Feed-Post" };
const document = (extra) => ({ version: 1, exportiert_am: "2026-10-23T00:00:00.000Z", content: [],
  postings: [{ ...posting, ...extra }] });

const bare = await call("PUT", "/api/v1/content-studio/plan", document({ status: "gepostet" }),
  { "if-match": String(current.body?.data?.revision ?? 0) });
report.push(`"gepostet" without origin: HTTP ${bare.status} - ${bare.body?.error?.message ?? bare.body?.message}`);

const invented = await call("PUT", "/api/v1/content-studio/plan",
  document({ status: "gepostet", veroeffentlichung: { art: "bestaetigt", am: "2026-10-24T09:00:00.000Z", quelle: "manuell" } }),
  { "if-match": String(current.body?.data?.revision ?? 0) });
report.push(`"bestaetigt" with quelle=manuell: HTTP ${invented.status} - ${invented.body?.error?.message ?? invented.body?.message}`);

const marked = await call("PUT", "/api/v1/content-studio/plan",
  document({ status: "gepostet", veroeffentlichung: { art: "manuell", am: "2026-10-24T09:00:00.000Z", quelle: "manuell" } }),
  { "if-match": String(current.body?.data?.revision ?? 0) });
report.push(`manual marking: HTTP ${marked.status}, revision ${marked.body?.data?.revision}`);

const readback = await call("GET", "/api/v1/content-studio/plan");
const stored = readback.body?.data?.plan?.postings?.[0];
report.push(`readback: status ${stored?.status}, art ${stored?.veroeffentlichung?.art}, quelle ${stored?.veroeffentlichung?.quelle}`);

child.kill();
console.log(report.join("\n"));