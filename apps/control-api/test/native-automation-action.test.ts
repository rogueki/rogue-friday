import { expect, it } from "vitest";
import type { Automation } from "@friday/sdk";
import { startTestApi, type TestApi } from "./helpers";
import { confirmedHeaders, stageKnowledgeWrite } from "./support/knowledge-actions";

type Client = ReturnType<TestApi["client"]>;

async function disableTier2(owner: Client): Promise<void> {
  const settings = (await owner.get("/api/v1/settings")).json().data;
  expect((await owner.patch("/api/v1/settings", { approvals: { ...settings.approvals, confirmTier2: false } },
    { headers: { "if-match": String(settings.version) } })).statusCode).toBe(200);
}

async function approveNative(owner: Client, approvalId: string) {
  const opened = await owner.get(`/api/v1/approvals/${approvalId}`);
  expect(opened.statusCode, opened.body).toBe(200);
  const decision = await owner.post(`/api/v1/approvals/${approvalId}/approve`, {},
    { headers: { "x-approval-token": String(opened.headers["x-approval-token"]) } });
  expect(decision.statusCode, decision.body).toBe(200);
  return decision.json().data;
}

async function createAutomation(owner: Client, name: string, enabled = false): Promise<Automation> {
  const existing = (await owner.get("/api/v1/automations", { query: { limit: "200" } })).json().items as Automation[];
  const source = existing[0]!;
  const body = { name, enabled, trigger: source.trigger, conditions: source.conditions, actions: source.actions };
  const previewId = await stageKnowledgeWrite(owner, "POST", "/api/v1/automations", body);
  const created = await owner.post("/api/v1/automations", body, { headers: confirmedHeaders(previewId) });
  expect(created.statusCode, created.body).toBe(201);
  return created.json().data as Automation;
}

const listAutomations = async (owner: Client): Promise<Automation[]> =>
  (await owner.get("/api/v1/automations", { query: { limit: "200" } })).json().items as Automation[];

const byName = async (owner: Client, name: string): Promise<Automation> => {
  const found = (await listAutomations(owner)).find((automation) => automation.name === name);
  expect(found, `seed automation ${name}`).toBeDefined();
  return found!;
};

function stagedRows(api: TestApi): number {
  return (api.runtime.db.prepare("SELECT COUNT(*) AS count FROM native_approval_requests").get() as { count: number }).count;
}

it("stages an automation create and executes it only after the exact confirmation, replay included", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    await disableTier2(owner);
    const source = (await listAutomations(owner))[0]!;
    const body = { name: "Wochenreport versenden", enabled: false, trigger: source.trigger, conditions: source.conditions, actions: source.actions };
    const staged = await owner.post("/api/v1/automations", body);
    expect(staged.statusCode, staged.body).toBe(403);
    expect(staged.json().error.details).toMatchObject({ stage: "preview",
      previewText: "Automation „Wochenreport versenden“ anlegen?" });
    expect(await byName(owner, "Wochenreport versenden").then(() => true).catch(() => false)).toBe(false);
    const previewId = staged.json().error.details.previewId as string;
    const wrong = await owner.post("/api/v1/automations", { ...body, name: "Anders" },
      { headers: confirmedHeaders(previewId) });
    expect(wrong.statusCode).toBe(409);
    const confirmed = await owner.post("/api/v1/automations", body, { headers: confirmedHeaders(previewId) });
    expect(confirmed.statusCode, confirmed.body).toBe(201);
    expect(confirmed.headers.location).toBe(`/api/v1/automations/${confirmed.json().data.id}`);
    // A replayed confirmation answers the stored receipt; no second automation is created.
    const replay = await owner.post("/api/v1/automations", body, { headers: confirmedHeaders(previewId) });
    expect(replay.statusCode, replay.body).toBe(201);
    expect(replay.json().data.id).toBe(confirmed.json().data.id);
    expect((await listAutomations(owner)).filter((automation) => automation.name === "Wochenreport versenden")).toHaveLength(1);
  } finally { await api.close(); }
});

it("stages an update and refuses a tampered confirmation or a replay after the version changed", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    await disableTier2(owner);
    const automation = await createAutomation(owner, "Update-Test");
    const staged = await owner.patch(`/api/v1/automations/${automation.id}`, { description: "Neu beschrieben." });
    expect(staged.statusCode, staged.body).toBe(403);
    const previewId = staged.json().error.details.previewId as string;
    const tampered = await owner.patch(`/api/v1/automations/${automation.id}`, { description: "Tamper" },
      { headers: confirmedHeaders(previewId) });
    expect(tampered.statusCode).toBe(409);
    // A concurrent write moves the version; the pinned draft fails at dispatch.
    const other = await owner.patch(`/api/v1/automations/${automation.id}`, { description: "Dazwischen." });
    await owner.patch(`/api/v1/automations/${automation.id}`, { description: "Dazwischen." },
      { headers: confirmedHeaders(other.json().error.details.previewId as string) });
    const drifted = await owner.patch(`/api/v1/automations/${automation.id}`, { description: "Neu beschrieben." },
      { headers: confirmedHeaders(previewId) });
    expect(drifted.statusCode, drifted.body).toBe(409);
    const current = (await owner.get(`/api/v1/automations/${automation.id}`)).json().data;
    expect(current.description).toBe("Dazwischen.");
    // A fresh preview/confirmation pair applies the change once.
    const stagedAgain = await owner.patch(`/api/v1/automations/${automation.id}`, { description: "Neu beschrieben." });
    const confirmed = await owner.patch(`/api/v1/automations/${automation.id}`, { description: "Neu beschrieben." },
      { headers: confirmedHeaders(stagedAgain.json().error.details.previewId as string) });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json().data.description).toBe("Neu beschrieben.");
  } finally { await api.close(); }
});

it("stages enable/disable with pre-staging guards and runs a disable through the tier-2 approval once", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    await disableTier2(owner);
    const unknown = "auto_0000000000000000000000zz99";
    expect((await owner.post(`/api/v1/automations/${unknown}/enable`)).statusCode).toBe(404);
    expect((await owner.post(`/api/v1/automations/${unknown}/disable`)).statusCode).toBe(404);
    const automation = await byName(owner, "Morgenbriefing erstellen");
    expect(automation.enabled).toBe(true);
    const stale = await owner.post(`/api/v1/automations/${automation.id}/disable`, undefined,
      { headers: { "if-match": String(automation.version + 1) } });
    expect(stale.statusCode, stale.body).toBe(409);
    // Already-enabled automation: the preview says so, the port still accepts the explicit repeat.
    const redundant = await owner.post(`/api/v1/automations/${automation.id}/enable`);
    expect(redundant.statusCode, redundant.body).toBe(403);
    expect(redundant.json().error.details.previewText).toContain("bereits aktiviert");
    const confirmed = await owner.post(`/api/v1/automations/${automation.id}/enable`, undefined,
      { headers: confirmedHeaders(redundant.json().error.details.previewId as string) });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json().data.enabled).toBe(true);
    // Disable through the tier-2 approval: exactly one execution, honest receipt sentence.
    const settings = (await owner.get("/api/v1/settings")).json().data;
    expect((await owner.patch("/api/v1/settings", { approvals: { ...settings.approvals, confirmTier2: true } },
      { headers: { "if-match": String(settings.version) } })).statusCode).toBe(200);
    const staged = await owner.post(`/api/v1/automations/${automation.id}/disable`);
    const needsApproval = await owner.post(`/api/v1/automations/${automation.id}/disable`, undefined,
      { headers: confirmedHeaders(staged.json().error.details.previewId as string) });
    expect(needsApproval.statusCode, needsApproval.body).toBe(403);
    expect(needsApproval.json().error.details.stage).toBe("approval");
    const approvalId = needsApproval.json().error.details.approvalId as string;
    const opened = await owner.get(`/api/v1/approvals/${approvalId}`);
    expect(opened.json().data.action).toBe("Automation deaktivieren: Morgenbriefing erstellen");
    const decided = await approveNative(owner, approvalId);
    expect(decided.status).toBe("executed");
    expect(decided.executionResult).toBe(`Automation ${automation.id} deaktiviert.`);
    expect((await owner.get(`/api/v1/automations/${automation.id}`)).json().data.enabled).toBe(false);
    const reopened = await owner.get(`/api/v1/approvals/${approvalId}`);
    expect((await owner.post(`/api/v1/approvals/${approvalId}/approve`, {},
      { headers: { "x-approval-token": String(reopened.headers["x-approval-token"] ?? "") } })).statusCode).toBe(409);
    // Capability gate before any preview is staged.
    await owner.post("/api/v1/dev/scenarios/control", { action: "capability_toggle", module: "automations", capability: "enable", enabled: false });
    const denied = await owner.post(`/api/v1/automations/${automation.id}/enable`);
    expect(denied.statusCode, denied.body).toBe(403);
    expect(denied.json().error.code).toBe("CAPABILITY_MISSING");
    expect(stagedRows(api)).toBe(2);
  } finally { await api.close(); }
});

it("stages a dry run and a real test run, recording exactly one run entry each", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    await disableTier2(owner);
    const automation = await byName(owner, "Backup-Verifikation");
    const before = (await owner.get(`/api/v1/automations/${automation.id}/runs`, { query: { limit: "50" } })).json().items.length;
    const staged = await owner.post(`/api/v1/automations/${automation.id}/test`, { dryRun: true });
    expect(staged.statusCode, staged.body).toBe(403);
    expect(staged.json().error.details.previewText).toContain("Trockenlauf");
    const confirmed = await owner.post(`/api/v1/automations/${automation.id}/test`, { dryRun: true },
      { headers: confirmedHeaders(staged.json().error.details.previewId as string) });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json().data).toMatchObject({ automationId: automation.id, dryRun: true, status: "dry_run" });
    // A real run executes actions and bumps the automation counters exactly once, even on a replayed confirmation.
    const stagedReal = await owner.post(`/api/v1/automations/${automation.id}/test`, { dryRun: false });
    expect(stagedReal.json().error.details.previewText).toContain("führt die Aktionen aus");
    const previewId = stagedReal.json().error.details.previewId as string;
    const versionBefore = (await owner.get(`/api/v1/automations/${automation.id}`)).json().data.version;
    const real = await owner.post(`/api/v1/automations/${automation.id}/test`, { dryRun: false },
      { headers: confirmedHeaders(previewId) });
    expect(real.statusCode, real.body).toBe(200);
    expect(real.json().data.dryRun).toBe(false);
    const after = (await owner.get(`/api/v1/automations/${automation.id}/runs`, { query: { limit: "50" } })).json().items;
    expect(after.length).toBe(before + 2);
    const current = (await owner.get(`/api/v1/automations/${automation.id}`)).json().data;
    expect(current.version).toBe(versionBefore + 1);
    expect(current.runCount).toBe(automation.runCount + 1);
    const replay = await owner.post(`/api/v1/automations/${automation.id}/test`, { dryRun: false },
      { headers: confirmedHeaders(previewId) });
    expect(replay.statusCode, replay.body).toBe(200);
    expect((await owner.get(`/api/v1/automations/${automation.id}/runs`, { query: { limit: "50" } })).json().items.length).toBe(before + 2);
  } finally { await api.close(); }
});

it("stages pause-all, answers the receipt on replay and reports per automation", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    await disableTier2(owner);
    const before = await listAutomations(owner);
    const active = before.filter((automation) => automation.enabled && !automation.paused);
    expect(active.length).toBeGreaterThan(0);
    const staged = await owner.post("/api/v1/automations/pause-all", { reason: "Wartung" });
    expect(staged.statusCode, staged.body).toBe(403);
    expect(staged.json().error.details.previewText).toBe(`Alle ${active.length} aktiven Automationen pausieren? Grund: Wartung`);
    const previewId = staged.json().error.details.previewId as string;
    const confirmed = await owner.post("/api/v1/automations/pause-all", { reason: "Wartung" },
      { headers: confirmedHeaders(previewId) });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json().data.pausedCount).toBe(active.length);
    expect(confirmed.json().data.results.filter((entry: { outcome: string }) => entry.outcome === "paused")).toHaveLength(active.length);
    expect((await listAutomations(owner)).filter((automation) => automation.enabled && !automation.paused)).toHaveLength(0);
    // The replay answers the stored receipt: nothing is paused a second time.
    const replay = await owner.post("/api/v1/automations/pause-all", { reason: "Wartung" },
      { headers: confirmedHeaders(previewId) });
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json().data.pausedCount).toBe(0);
    expect(replay.json().data.results.every((entry: { outcome: string }) =>
      entry.outcome === "already_paused" || entry.outcome === "skipped")).toBe(true);
    // A fresh pair on the now-paused world pauses nothing.
    const stagedSecond = await owner.post("/api/v1/automations/pause-all", {});
    const second = await owner.post("/api/v1/automations/pause-all", {},
      { headers: confirmedHeaders(stagedSecond.json().error.details.previewId as string) });
    expect(second.json().data.pausedCount).toBe(0);
  } finally { await api.close(); }
});

it("drives spoken automation actions through the command path with live-registry resolution", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    await disableTier2(owner);

    const disableText = "Deaktiviere die Automation Morgenbriefing erstellen";
    const disablePreview = await owner.post("/api/v1/commands", { text: disableText, source: "text" });
    expect(disablePreview.statusCode, disablePreview.body).toBe(200);
    expect(disablePreview.json().status).toBe("requires_confirmation");
    expect(disablePreview.json().previewText).toBe("Automation „Morgenbriefing erstellen“ deaktivieren?");
    const disableConfirm = await owner.post("/api/v1/commands",
      { text: disableText, source: "text", confirm: true, previewId: disablePreview.json().previewId });
    expect(disableConfirm.json().status).toBe("executed");
    expect((await byName(owner, "Morgenbriefing erstellen")).enabled).toBe(false);

    const pauseText = "Pausiere die Automation Backup-Verifikation";
    const pausePreview = await owner.post("/api/v1/commands", { text: pauseText, source: "text" });
    expect(pausePreview.json().previewText).toBe("Automation „Backup-Verifikation“ pausieren?");
    await owner.post("/api/v1/commands",
      { text: pauseText, source: "text", confirm: true, previewId: pausePreview.json().previewId });
    expect((await byName(owner, "Backup-Verifikation")).paused).toBe(true);

    const resumeText = "Setz die Automation Backup-Verifikation fort";
    const resumePreview = await owner.post("/api/v1/commands", { text: resumeText, source: "text" });
    expect(resumePreview.json().previewText).toBe("Automation „Backup-Verifikation“ fortsetzen?");
    await owner.post("/api/v1/commands",
      { text: resumeText, source: "text", confirm: true, previewId: resumePreview.json().previewId });
    expect((await byName(owner, "Backup-Verifikation")).paused).toBe(false);

    const testText = "Teste die Automation Backup-Verifikation";
    const testPreview = await owner.post("/api/v1/commands", { text: testText, source: "text" });
    expect(testPreview.json().previewText).toContain("Trockenlauf");
    const testConfirm = await owner.post("/api/v1/commands",
      { text: testText, source: "text", confirm: true, previewId: testPreview.json().previewId });
    expect(testConfirm.json().status).toBe("executed");
    expect(testConfirm.json().result.message).toBe("Automation wurde getestet.");

    const unknown = await owner.post("/api/v1/commands", { text: "Aktiviere die Automation Hologramm", source: "text" });
    expect(unknown.statusCode, unknown.body).toBe(404);
    // Two automations with the same name make the spoken reference ambiguous: 409 before anything is staged.
    await createAutomation(owner, "Duplikatstest");
    await createAutomation(owner, "Duplikatstest");
    const ambiguous = await owner.post("/api/v1/commands", { text: "Pausiere die Automation Duplikatstest", source: "text" });
    expect(ambiguous.statusCode, ambiguous.body).toBe(409);
    expect(ambiguous.json().error.message).toContain("Mehrere Automationen");

    const pauseAllText = "Pausiere alle Automationen";
    const pauseAllPreview = await owner.post("/api/v1/commands", { text: pauseAllText, source: "text" });
    expect(pauseAllPreview.statusCode, pauseAllPreview.body).toBe(200);
    expect(pauseAllPreview.json().previewText).toMatch(/^Alle \d+ aktiven Automationen pausieren\?$/);
    const pauseAllConfirm = await owner.post("/api/v1/commands",
      { text: pauseAllText, source: "text", confirm: true, previewId: pauseAllPreview.json().previewId });
    expect(pauseAllConfirm.json().status).toBe("executed");
    expect(pauseAllConfirm.json().result.message).toBe("Alle Automationen wurden pausiert.");
    expect((await listAutomations(owner)).filter((automation) => automation.enabled && !automation.paused)).toHaveLength(0);
  } finally { await api.close(); }
});

it("clears staged automation drafts with the dev scenario reset", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    const automation = await byName(owner, "Morgenbriefing erstellen");
    const staged = await owner.post(`/api/v1/automations/${automation.id}/disable`);
    expect(staged.statusCode).toBe(403);
    expect(stagedRows(api)).toBe(1);
    await owner.post("/api/v1/dev/scenarios/control", { action: "reset" });
    expect(stagedRows(api)).toBe(0);
    const confirmed = await owner.post(`/api/v1/automations/${automation.id}/disable`, undefined,
      { headers: confirmedHeaders(staged.json().error.details.previewId as string) });
    expect(confirmed.statusCode, confirmed.body).toBe(409);
  } finally { await api.close(); }
});
