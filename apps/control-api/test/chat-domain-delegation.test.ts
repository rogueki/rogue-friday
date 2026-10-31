import { expect, it } from "vitest";
import { startTestApi } from "./helpers";

// Like a live installation without a commands adapter; task and agent ports are mock stand-ins for Hermes here.
const ADAPTERS = [
  "adapters:",
  "  commands:",
  "    provider: mock-commands",
  "    enabled: false",
  "",
].join("\n");

async function start() {
  return startTestApi({ dataMode: "mock", authMode: "local", ownerPassword: "synthetic-test-password",
    adaptersYaml: ADAPTERS, responseValidation: "throw" });
}

it("hands unmatched chat text to the domain agent after confirmation and returns at once", async () => {
  const api = await start();
  try {
    const owner = api.client();
    expect((await owner.loginOwner("synthetic-test-password")).statusCode).toBe(200);
    const text = "Vergleiche bitte drei Stromanbieter fuer Berlin";
    const gated = await owner.post("/api/v1/commands", { text, source: "text" });
    const approval = await owner.post("/api/v1/commands", { text, source: "text", confirm: true, previewId: gated.json().previewId });
    expect(approval.json().status).toBe("requires_approval");
    const settings = (await owner.get("/api/v1/settings")).json().data;
    expect((await owner.patch("/api/v1/settings", { approvals: { ...settings.approvals, confirmTier2: false } },
      { headers: { "if-match": String(settings.version) } })).statusCode).toBe(200);
    const preview = await owner.post("/api/v1/commands", { text, source: "text" });
    expect(preview.statusCode, preview.body).toBe(200);
    const staged = preview.json();
    expect(staged.status).toBe("requires_confirmation");
    expect(staged.previewText).toContain("Recherche");
    expect(staged.previewText).toContain("im Hintergrund");
    expect((await owner.get("/api/v1/tasks")).json().items.some((task: { title: string }) => task.title === text)).toBe(false);

    const confirmed = await owner.post("/api/v1/commands", { text, source: "text", confirm: true, previewId: staged.previewId });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    const accepted = confirmed.json();
    expect(accepted.status).toBe("accepted");
    expect(accepted.result.taskId).toMatch(/^task_/);
    expect(accepted.result.targetRoute).toBe(`/tasks?task=${accepted.result.taskId}`);
    const task = (await owner.get(`/api/v1/tasks/${accepted.result.taskId}`)).json().data;
    expect(task.labels).toContain("tenant:chat-research");
    expect(task.agentName).toContain("Recherche");
    expect(task.description).toContain(text);

    const replay = await owner.post("/api/v1/commands", { text, source: "text", confirm: true, previewId: staged.previewId });
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json().result.taskId).toBe(accepted.result.taskId);
    const copies = (await owner.get("/api/v1/tasks")).json().items.filter((item: { title: string }) => item.title === text);
    expect(copies).toHaveLength(1);
  } finally { await api.close(); }
});

it("routes general requests to the task agent and refuses a changed text on confirmation", async () => {
  const api = await start();
  try {
    const owner = api.client();
    expect((await owner.loginOwner("synthetic-test-password")).statusCode).toBe(200);
    const text = "Kuemmere dich um die Unterlagen fuer die Steuererklaerung";
    const staged = (await owner.post("/api/v1/commands", { text, source: "text" })).json();
    expect(staged.status).toBe("requires_confirmation");
    expect(staged.previewText).toContain("Task-Agent");
    const changed = await owner.post("/api/v1/commands",
      { text: "Kuemmere dich um die Unterlagen fuer die Hausratversicherung", source: "text", confirm: true, previewId: staged.previewId });
    expect(changed.statusCode, changed.body).toBe(409);
  } finally { await api.close(); }
});

it("keeps the honest refusal when no domain agent can take the request", async () => {
  const api = await startTestApi({ dataMode: "live", authMode: "local", ownerPassword: "synthetic-test-password",
    responseValidation: "throw" });
  try {
    const owner = api.client();
    expect((await owner.loginOwner("synthetic-test-password")).statusCode).toBe(200);
    const refused = await owner.post("/api/v1/commands", { text: "Vergleiche bitte drei Stromanbieter fuer Berlin", source: "text" });
    expect(refused.statusCode, refused.body).toBe(403);
    expect(refused.json().error.code).toBe("CAPABILITY_MISSING");
  } finally { await api.close(); }
});