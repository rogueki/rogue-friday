/**
 * Live proof: the running Control API against the real Hermes CLI in WSL (distro FRIDAY-2).
 * Not part of the test suite - it needs a started server, a real WSL distro and network for the registries.
 */
const BASE = process.env.LIVE_BASE ?? "http://127.0.0.1:3111";
const PASSWORD = process.env.LIVE_PASSWORD ?? "friday-live-proof-2026";
let cookie = "";

const call = async (path, init = {}) => {
  const started = Date.now();
  const response = await fetch(BASE + path, {
    ...init,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(init.headers ?? {}) },
  });
  const setCookie = response.headers.getSetCookie?.() ?? [];
  if (setCookie.length > 0) cookie = setCookie.map((entry) => entry.split(";")[0]).join("; ");
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, ms: Date.now() - started, body };
};

const show = (label, result, pick) => {
  const detail = pick ? pick(result.body) : result.body;
  console.log(`${label}: HTTP ${result.status} in ${result.ms} ms`);
  console.log("  " + String(typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 300).replaceAll("\n", " ⏎ "));
  return result.body;
};

const login = await call("/api/v1/auth/login", { method: "POST",
  body: JSON.stringify({ username: "operator", displayName: "Live Proof", password: PASSWORD }) });
show("login", login, (b) => ({ role: b?.data?.role }));

const skills = await call("/api/v1/skills");
show("GET /skills", skills, (b) => {
  const list = b?.data ?? [];
  const byOrigin = list.reduce((acc, skill) => ({ ...acc, [skill.origin ?? "?"]: (acc[skill.origin ?? "?"] ?? 0) + 1 }), {});
  return { total: list.length, byOrigin, source: list[0]?.observationSource };
});

const modified = await call("/api/v1/skills/modified");
show("GET /skills/modified", modified, (b) => b?.data?.names ?? b?.error);

const diff = await call("/api/v1/skills/arxiv/diff");
show("GET /skills/arxiv/diff", diff, (b) => b?.data?.text ?? b?.message);

const unknown = await call("/api/v1/skills/definitely-not-a-skill/diff");
show("GET /skills/<unknown>/diff", unknown, (b) => b?.data?.text ?? b?.message);

const inspectName = await call("/api/v1/skills/arxiv/inspect");
show("GET /skills/arxiv/inspect", inspectName, (b) => b?.data?.text?.slice(0, 160) ?? b?.message);

const identifier = encodeURIComponent("official/devops/hermes-s6-container-supervision");
const inspectIdentifier = await call(`/api/v1/skills/${identifier}/inspect`);
show("GET /skills/<identifier>/inspect", inspectIdentifier, (b) => b?.data?.text?.slice(0, 160) ?? b?.message);

const taps = await call("/api/v1/skills/reports?command=tap-list");
show("GET /skills/reports?command=tap-list", taps, (b) => b?.data?.text ?? b?.message);

const badQuery = await call("/api/v1/skills/reports?command=config");
show("GET /skills/reports?command=config (not offered)", badQuery, (b) => b?.message ?? b?.error);

const markdown = await call("/api/v1/skills/arxiv/markdown");
show("GET /skills/arxiv/markdown", markdown, (b) => ({ bytes: b?.data?.text?.length, name: b?.data?.name }));

console.log(`GET /skills without session: HTTP ${(await call("/api/v1/skills", { headers: { cookie: "" } })).status}`);