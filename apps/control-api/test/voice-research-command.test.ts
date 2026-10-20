import { expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { startTestApi } from "./helpers";
import type { MailAccount } from "../src/services/mail-accounts";

const execFileAsync = promisify(execFile);

it("limits the voice key to typed research and preserves native preview, approval and outcome", async () => {
  const search = vi.fn(async () => new Response(JSON.stringify({ results: [
    { title: "Quelle", url: "https://example.org/research", content: "Unverifiziertes Snippet" },
  ] }), { status: 200, headers: { "content-type": "application/json" } }));
  const api = await startTestApi({ dataMode: "hybrid", authMode: "local", ownerPassword: "synthetic-test-password",
    responseValidation: "throw", env: { FRIDAY_RESEARCH_SEARXNG_URL: "http://127.0.0.1:8080/" }, providerFetch: search as typeof fetch });
  try {
    const voice = api.client();
    const owner = api.client();
    expect((await owner.loginOwner("synthetic-test-password")).statusCode).toBe(200);
    const path = "/api/v1/commands";
    const headers = { authorization: `Bearer ${api.runtime.voiceBridgeKey.toString("base64")}` };
    const request = { text: "Recherchiere Energiepreise Europa", source: "voice" };
    expect((await voice.post(path, request)).statusCode).toBe(401);
    expect((await voice.post(path, { ...request, source: "text" }, { headers })).statusCode).toBe(403);
    expect((await voice.post(path, { text: "Schreibe eine Mail an X", source: "voice" }, { headers })).statusCode).toBe(403);
    expect((await api.fastify.inject({ method: "POST", url: path, remoteAddress: "192.0.2.7", headers,
      payload: request })).statusCode).toBe(401);
    const preview = await voice.post(path, request, { headers });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json()).toMatchObject({ status: "requires_confirmation", requiresConfirmation: true,
      previewText: expect.stringContaining("Energiepreise Europa") });
    const previewId = preview.json().previewId as string;
    expect(search).not.toHaveBeenCalled();
    const keyed = { ...headers, "Idempotency-Key": "voice-research-confirm-123" };
    expect((await voice.post(path, { ...request, text: "Recherchiere Fremdes Thema", confirm: true, previewId },
      { headers: keyed })).statusCode).toBe(409);
    const confirmation = await voice.post(path, { ...request, confirm: true, previewId }, { headers: keyed });
    expect(confirmation.statusCode, confirmation.body).toBe(200);
    expect(confirmation.json()).toMatchObject({ status: "requires_approval", result: {
      message: "Recherche wartet auf Freigabe.", targetRoute: expect.stringContaining("/approvals?") } });
    expect(search).not.toHaveBeenCalled();
    const id = confirmation.json().approvalId as string;
    const opened = await owner.get(`/api/v1/approvals/${id}`);
    const decision = await owner.post(`/api/v1/approvals/${id}/approve`, {},
      { headers: { "x-approval-token": String(opened.headers["x-approval-token"]) } });
    expect(decision.statusCode, decision.body).toBe(200);
    expect(search).toHaveBeenCalledTimes(1);
    expect((await owner.get("/api/v1/research/projects")).json().items).toMatchObject([
      { status: "review", sourceCount: 1, topic: "Energiepreise Europa" },
    ]);
  } finally { await api.close(); }
});

it("carries recorded PCM speech through transcription, voice dispatch, native previews and persisted outcomes", async () => {
  const search = vi.fn(async () => new Response(JSON.stringify({ results: [
    { title: "Quelle", url: "https://example.org/research", content: "Unverifiziertes Snippet" },
  ] }), { status: 200, headers: { "content-type": "application/json" } }));
  const api = await startTestApi({ listen: true, dataMode: "hybrid", authMode: "local",
    ownerPassword: "synthetic-test-password", responseValidation: "throw",
    env: { FRIDAY_RESEARCH_SEARXNG_URL: "http://127.0.0.1:8080/" }, providerFetch: search as typeof fetch });
  try {
    const root = join(api.dir, "voice-fixture-install");
    const keyDir = join(root, "dashboard", "data", "voice-bridge");
    mkdirSync(keyDir, { recursive: true });
    writeFileSync(join(keyDir, "auth.key"), api.runtime.voiceBridgeKey.toString("base64"));
    mkdirSync(join(root, "dashboard", "config"), { recursive: true });
    writeFileSync(join(root, "dashboard", "config", "dashboard.yaml"), `server:\n  port: ${api.port}\n`);
    const owner = api.client();
    expect((await owner.loginOwner("synthetic-test-password")).statusCode).toBe(200);
    const account = { id: "work", displayName: "Testpostfach", email: "owner@example.test", revision: 1,
      secretState: { imapPassword: true, smtpPassword: true } } as MailAccount;
    vi.spyOn(api.runtime.mailAccounts, "list").mockResolvedValue({ revision: 1, defaultAccountId: "work", accounts: [account] });
    vi.spyOn(api.runtime.mailAccounts, "check").mockResolvedValue({ ok: true });
    const sent = vi.spyOn(api.runtime.mailAccounts, "send").mockResolvedValue({ state: "sent", archivePending: false });
    const probe = async (scenario: string) => {
      const executable = process.platform === "win32" ? "python" : "python3";
      const script = join(process.cwd(), "installer", "voice", "tests", "audio_command_probe.py");
      const result = await execFileAsync(executable, [script, scenario, root], { timeout: 30_000, maxBuffer: 32_000,
        env: { ...process.env, FRIDAY_DASHBOARD_PORT: String(api.port), FRIDAY_DATA_DIR: join(root, "dashboard", "data") } });
      return JSON.parse(result.stdout) as { spoken: string[]; previewId: string | null;
        pendingResearch: boolean; rejectedSpeakers: number; commands: number };
    };
    const guest = await probe("guest");
    expect(guest.spoken).toEqual(["Gastzugriff ohne Aktionen."]);
    expect(guest.pendingResearch).toBe(false);
    expect((api.runtime.db.prepare("SELECT COUNT(*) AS n FROM native_approval_requests").get() as { n: number }).n).toBe(0);
    const research = await probe("research");
    expect(research.spoken[0]).toContain("Energiepreise Europa");
    expect(research.spoken[1]).toContain("wartet auf Freigabe");
    expect(research.pendingResearch).toBe(false);
    expect(search).not.toHaveBeenCalled();
    const rejected = await probe("reject");
    expect(rejected.rejectedSpeakers).toBe(1);
    expect(rejected.spoken).toHaveLength(1);
    expect(rejected.pendingResearch).toBe(false);
    expect(search).not.toHaveBeenCalled();
    const stopped = await probe("stop");
    expect(stopped.spoken).toHaveLength(1);
    expect(stopped.pendingResearch).toBe(false);
    expect(stopped.previewId).toBeTruthy();
    expect(api.runtime.db.prepare("SELECT state FROM native_approval_requests WHERE request_key = ?")
      .get(stopped.previewId)).toBeUndefined();
    const stale = await api.client().post("/api/v1/commands", { text: "Recherchiere Energiepreise Europa",
      source: "voice", confirm: true, previewId: stopped.previewId }, { headers: {
      authorization: `Bearer ${api.runtime.voiceBridgeKey.toString("base64")}`,
      "Idempotency-Key": "stale-stopped-research",
    } });
    expect(stale.statusCode).toBe(409);
    expect(search).not.toHaveBeenCalled();
    const unarmed = await probe("unarmed");
    expect(unarmed.spoken[1]).toContain("unterbrochen");
    expect(unarmed.pendingResearch).toBe(false);
    const discarded = await probe("no");
    expect(discarded.spoken[1]).toContain("verworfen");
    expect(discarded.pendingResearch).toBe(false);
    expect(search).not.toHaveBeenCalled();
    const calendar = await probe("calendar");
    expect(calendar.spoken[0]).toContain("Test");
    expect(calendar.spoken[1]).toContain("angelegt");
    expect((api.runtime.db.prepare("SELECT COUNT(*) AS n FROM local_calendar_events").get() as { n: number }).n).toBe(1);
    const mail = await probe("mail");
    expect(mail.spoken[0]).toContain("alex@example.test");
    expect(mail.spoken[1]).toContain("gesendet");
    expect(sent).toHaveBeenCalledTimes(1);
    const approvals = (await owner.get("/api/v1/approvals")).json().items as Array<{ id: string; action: string }>;
    const researchApproval = approvals.find((item) => item.action.includes("Energiepreise Europa"));
    expect(researchApproval).toBeDefined();
    const opened = await owner.get(`/api/v1/approvals/${researchApproval!.id}`);
    const decision = await owner.post(`/api/v1/approvals/${researchApproval!.id}/approve`, {},
      { headers: { "x-approval-token": String(opened.headers["x-approval-token"]) } });
    expect(decision.statusCode, decision.body).toBe(200);
    expect(search).toHaveBeenCalledTimes(1);
    expect((await owner.get("/api/v1/research/projects")).json().items).toMatchObject([
      { topic: "Energiepreise Europa", status: "review", sourceCount: 1 },
    ]);
  } finally { await api.close(); }
}, 60_000);
