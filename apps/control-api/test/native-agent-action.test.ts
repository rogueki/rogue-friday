import { expect, it, vi } from "vitest";
import type { Agent, Task } from "@friday/sdk";
import { notFound } from "../src/util/errors";
import { startTestApi, type TestApi } from "./helpers";

async function disableTier2(owner: ReturnType<TestApi["client"]>): Promise<void> {
  const settings = (await owner.get("/api/v1/settings")).json().data;
  expect((await owner.patch("/api/v1/settings", { approvals: { ...settings.approvals, confirmTier2: false } },
    { headers: { "if-match": String(settings.version) } })).statusCode).toBe(200);
}

async function approveNative(owner: ReturnType<TestApi["client"]>, approvalId: string) {
  const opened = await owner.get(`/api/v1/approvals/${approvalId}`);
  expect(opened.statusCode, opened.body).toBe(200);
  const decision = await owner.post(`/api/v1/approvals/${approvalId}/approve`, {},
    { headers: { "x-approval-token": String(opened.headers["x-approval-token"]) } });
  expect(decision.statusCode, decision.body).toBe(200);
  return decision.json().data;
}

async function agentByName(owner: ReturnType<TestApi["client"]>, name: string): Promise<Agent> {
  const list = (await owner.get("/api/v1/agents?limit=200")).json().items as Agent[];
  const found = list.find((agent) => agent.name === name);
  expect(found, `seed agent ${name}`).toBeDefined();
  return found!;
}

function stagedRows(api: TestApi): number {
  return (api.runtime.db.prepare("SELECT COUNT(*) AS count FROM native_approval_requests").get() as { count: number }).count;
}

it("stages an agent pause and executes it only after the exact confirmation, replay included", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    await disableTier2(owner);
    const agent = await agentByName(owner, "Recherche-Agent");
    const staged = await owner.post(`/api/v1/agents/${agent.id}/pause`);
    expect(staged.statusCode, staged.body).toBe(403);
    expect(staged.json().error.details.stage).toBe("preview");
    expect(staged.json().error.details.previewText).toBe(`Agent „${agent.name}“ pausieren?`);
    const previewId = staged.json().error.details.previewId as string;
    expect((await owner.get(`/api/v1/agents/${agent.id}`)).json().data.status).not.toBe("paused");
    const wrong = await owner.post(`/api/v1/agents/${agent.id}/pause`,
      undefined, { headers: { "X-Action-Preview-Id": "corr_0000000000000000000000zz99" } });
    expect(wrong.statusCode).toBe(409);
    const confirmed = await owner.post(`/api/v1/agents/${agent.id}/pause`,
      undefined, { headers: { "X-Action-Preview-Id": previewId } });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json().data.status).toBe("paused");
    // A replay answers the stored receipt instead of re-dispatching: a real second pause from "paused" would fail 409.
    const replay = await owner.post(`/api/v1/agents/${agent.id}/pause`,
      undefined, { headers: { "X-Action-Preview-Id": previewId } });
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json().data.status).toBe("paused");
  } finally { await api.close(); }
});

it("runs an agent stop through the tier-2 approval exactly once", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    const agent = await agentByName(owner, "Recherche-Agent");
    const staged = await owner.post(`/api/v1/agents/${agent.id}/stop`);
    const previewId = staged.json().error.details.previewId as string;
    const confirmed = await owner.post(`/api/v1/agents/${agent.id}/stop`,
      undefined, { headers: { "X-Action-Preview-Id": previewId } });
    expect(confirmed.statusCode, confirmed.body).toBe(403);
    expect(confirmed.json().error.details.stage).toBe("approval");
    const approvalId = confirmed.json().error.details.approvalId as string;
    expect((await owner.get(`/api/v1/agents/${agent.id}`)).json().data.status).not.toBe("idle");
    const opened = await owner.get(`/api/v1/approvals/${approvalId}`);
    expect(opened.json().data.action).toBe(`Agent stoppen: ${agent.name}`);
    const decided = await approveNative(owner, approvalId);
    expect(decided.status).toBe("executed");
    expect(decided.executionResult).toBe(`Agent ${agent.id} gestoppt.`);
    expect((await owner.get(`/api/v1/agents/${agent.id}`)).json().data.status).toBe("idle");
    const reopened = await owner.get(`/api/v1/approvals/${approvalId}`);
    expect((await owner.post(`/api/v1/approvals/${approvalId}/approve`, {},
      { headers: { "x-approval-token": String(reopened.headers["x-approval-token"] ?? "") } })).statusCode).toBe(409);
  } finally { await api.close(); }
});

it("fails unknown agents, invalid transitions and disabled capabilities before any preview is staged", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    const unknown = await owner.post("/api/v1/agents/agt_0000000000000000000000zz99/pause");
    expect(unknown.statusCode, unknown.body).toBe(404);
    const working = await agentByName(owner, "Recherche-Agent");
    const notPaused = await owner.post(`/api/v1/agents/${working.id}/resume`);
    expect(notPaused.statusCode, notPaused.body).toBe(409);
    expect(notPaused.json().error.message).toContain("ist nicht pausiert");
    const idle = await agentByName(owner, "Kalender-Agent");
    const noWork = await owner.post(`/api/v1/agents/${idle.id}/stop`);
    expect(noWork.statusCode, noWork.body).toBe(409);
    await owner.post("/api/v1/dev/scenarios/control", { action: "capability_toggle", module: "agents", capability: "pause", enabled: false });
    const denied = await owner.post(`/api/v1/agents/${working.id}/pause`);
    expect(denied.statusCode, denied.body).toBe(403);
    expect(denied.json().error.code).toBe("CAPABILITY_MISSING");
    expect(stagedRows(api)).toBe(0);
  } finally { await api.close(); }
});

it("stages an assignment and fails unknown agents or finished tasks before staging", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    await disableTier2(owner);
    const tasks = (await owner.get("/api/v1/tasks?limit=200")).json().items as Task[];
    const open = tasks.find((task) => task.status === "todo" && !task.agentId)!;
    const done = tasks.find((task) => ["done", "failed", "cancelled"].includes(task.status));
    const agent = await agentByName(owner, "Kalender-Agent");
    const foreignAgent = await owner.post(`/api/v1/tasks/${open.id}/assign`, { agentId: "agent_0000000000000000000000zz99" });
    expect(foreignAgent.statusCode, foreignAgent.body).toBe(422);
    if (done) {
      const finished = await owner.post(`/api/v1/tasks/${done.id}/assign`, { agentId: agent.id });
      expect(finished.statusCode, finished.body).toBe(409);
    }
    const staged = await owner.post(`/api/v1/tasks/${open.id}/assign`, { agentId: agent.id });
    expect(staged.statusCode, staged.body).toBe(403);
    expect(staged.json().error.details.previewText).toBe(`Aufgabe „${open.title}“ an ${agent.name} zuweisen?`);
    expect((await owner.get(`/api/v1/tasks/${open.id}`)).json().data.agentId).toBeNull();
    const previewId = staged.json().error.details.previewId as string;
    const tampered = await owner.post(`/api/v1/tasks/${open.id}/assign`,
      { agentId: (await agentByName(owner, "Recherche-Agent")).id }, { headers: { "X-Action-Preview-Id": previewId } });
    expect(tampered.statusCode).toBe(409);
    const confirmed = await owner.post(`/api/v1/tasks/${open.id}/assign`, { agentId: agent.id },
      { headers: { "X-Action-Preview-Id": previewId } });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json().data.agentId).toBe(agent.id);
    // Replay serves the receipt; a second real dispatch is never attempted.
    const replay = await owner.post(`/api/v1/tasks/${open.id}/assign`, { agentId: agent.id },
      { headers: { "X-Action-Preview-Id": previewId } });
    expect(replay.statusCode).toBe(200);
    expect(stagedRows(api)).toBe(1);
  } finally { await api.close(); }
});

it("stages a coding-run stop and refuses terminal or unknown runs before staging", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    await disableTier2(owner);
    const runId = `run_${"a".repeat(32)}`;
    const run = (status: string) => ({ runId, status, requestedCli: "codex", requestedWorkdir: null,
      preflightVersion: null, executionVerified: true, output: null, error: null, updatedAt: Date.now() });
    let current = run("running");
    const status = vi.spyOn(api.runtime.codingRuns, "status").mockImplementation(() => Promise.resolve(current) as never);
    const stop = vi.spyOn(api.runtime.codingRuns, "stop").mockImplementation(() => {
      current = run("cancelled");
      return Promise.resolve(current) as never;
    });
    const staged = await owner.post(`/api/v1/coding-runs/${runId}/stop`);
    expect(staged.statusCode, staged.body).toBe(403);
    expect(staged.json().error.details.previewText).toContain("abbrechen");
    expect(stop).not.toHaveBeenCalled();
    const confirmed = await owner.post(`/api/v1/coding-runs/${runId}/stop`,
      undefined, { headers: { "X-Action-Preview-Id": staged.json().error.details.previewId } });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json().data.status).toBe("cancelled");
    expect(stop).toHaveBeenCalledTimes(1);
    current = run("completed");
    const terminal = await owner.post(`/api/v1/coding-runs/${runId}/stop`);
    expect(terminal.statusCode, terminal.body).toBe(409);
    status.mockRejectedValue(notFound("Coding-Run") as never);
    const missing = await owner.post(`/api/v1/coding-runs/${runId}/stop`);
    expect(missing.statusCode, missing.body).toBe(404);
  } finally { await api.close(); }
});

it("drives a spoken stop, an unknown-agent 404 and an ambiguous-agent 409 through the command path", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    await disableTier2(owner);
    const unknown = await owner.post("/api/v1/commands", { text: "Stoppe den Hologramm-Agenten", source: "text" });
    expect(unknown.statusCode, unknown.body).toBe(404);
    // The agents port is a proxy, so the duplicate-name world is injected by wrapping registry.getPort itself.
    const registry = api.runtime.registry;
    const original = registry.getPort.bind(registry);
    const realAgents = original("agents");
    const getPortSpy = vi.spyOn(registry, "getPort").mockImplementation(((category: string) =>
      category === "agents"
        ? { ...realAgents, listAgents: async () => ({ items: [
            { id: "agent_0000000000000000000000aaa1", name: "Recherche-Agent" },
            { id: "agent_0000000000000000000000aaa2", name: "Recherche-Agent" },
          ] }) }
        : original(category as never)) as never);
    const ambiguous = await owner.post("/api/v1/commands", { text: "Pausiere den Recherche-Agenten", source: "text" });
    expect(ambiguous.statusCode, ambiguous.body).toBe(409);
    expect(ambiguous.json().error.message).toContain("Mehrere Agenten");
    getPortSpy.mockRestore();
    expect(stagedRows(api)).toBe(0);
    const agent = await agentByName(owner, "Coding-Agent");
    const text = "Stoppe den Coding-Agenten";
    const preview = await owner.post("/api/v1/commands", { text, source: "text" });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().status).toBe("requires_confirmation");
    expect(preview.json().previewText).toBe(`Agent „${agent.name}“ stoppen? Laufende Arbeit wird beendet, Verlauf bleibt erhalten.`);
    const confirmed = await owner.post("/api/v1/commands",
      { text, source: "text", confirm: true, previewId: preview.json().previewId });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json().status).toBe("executed");
    expect(confirmed.json().result.message).toBe("Agent wurde gestoppt.");
    expect((await owner.get(`/api/v1/agents/${agent.id}`)).json().data.status).not.toBe("working");
  } finally { await api.close(); }
});

it("drives a spoken assignment and a spoken coding-run stop through the command path", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    await disableTier2(owner);
    const tasks = (await owner.get("/api/v1/tasks?limit=200")).json().items as Task[];
    const open = tasks.find((task) => task.status === "todo" && !task.agentId)!;
    const agent = await agentByName(owner, "Kalender-Agent");
    const text = `Weise die Aufgabe ${open.title} dem Kalender-Agenten zu`;
    const preview = await owner.post("/api/v1/commands", { text, source: "text" });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().previewText).toBe(`Aufgabe „${open.title}“ an ${agent.name} zuweisen?`);
    const confirmed = await owner.post("/api/v1/commands",
      { text, source: "text", confirm: true, previewId: preview.json().previewId });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json().status).toBe("executed");
    expect((await owner.get(`/api/v1/tasks/${open.id}`)).json().data.agentId).toBe(agent.id);

    const runId = `run_${"b".repeat(32)}`;
    const run = { runId, status: "running", requestedCli: "codex", requestedWorkdir: null,
      preflightVersion: null, executionVerified: true, output: null, error: null, updatedAt: Date.now() };
    vi.spyOn(api.runtime.codingRuns, "status").mockResolvedValue(run as never);
    const stop = vi.spyOn(api.runtime.codingRuns, "stop").mockResolvedValue({ ...run, status: "cancelled" } as never);
    const noSelection = await owner.post("/api/v1/commands", { text: "Brich den Lauf ab", source: "text" });
    expect(noSelection.statusCode, noSelection.body).toBe(422);
    const runPreview = await owner.post("/api/v1/commands",
      { text: "Brich den Lauf ab", source: "text", context: { route: "/coding", selectedIds: [runId] } });
    expect(runPreview.statusCode, runPreview.body).toBe(200);
    expect(runPreview.json().previewText).toContain(`Coding-Lauf ${runId} abbrechen?`);
    const runConfirmed = await owner.post("/api/v1/commands",
      { text: "Brich den Lauf ab", source: "text", confirm: true, previewId: runPreview.json().previewId,
        context: { route: "/coding", selectedIds: [runId] } });
    expect(runConfirmed.statusCode, runConfirmed.body).toBe(200);
    expect(runConfirmed.json().result.message).toBe("Coding-Lauf wurde abgebrochen.");
    expect(stop).toHaveBeenCalledTimes(1);
  } finally { await api.close(); }
});

it("clears staged agent drafts with the dev scenario reset", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    const agent = await agentByName(owner, "Recherche-Agent");
    const staged = await owner.post(`/api/v1/agents/${agent.id}/pause`);
    expect(staged.statusCode).toBe(403);
    expect(stagedRows(api)).toBe(1);
    await owner.post("/api/v1/dev/scenarios/control", { action: "reset" });
    expect(stagedRows(api)).toBe(0);
    const confirmed = await owner.post(`/api/v1/agents/${agent.id}/pause`,
      undefined, { headers: { "X-Action-Preview-Id": staged.json().error.details.previewId } });
    expect(confirmed.statusCode, confirmed.body).toBe(409);
  } finally { await api.close(); }
});
