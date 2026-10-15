import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FridayEvent } from "@friday/sdk";
import { brandText, deriveOrb, type OrbInputs } from "../src/services/core-views";
import { matchBuiltinIntent } from "../src/services/command-intents";
import { ApiClient, startTestApi, type TestApi } from "./helpers";

const errorOf = (response: { json(): unknown }) => (response.json() as { error: { code: string } }).error;

describe("branding (assistantName)", () => {
  let api: TestApi;
  let owner: ApiClient;

  beforeEach(async () => {
    api = await startTestApi();
    owner = api.client();
    await owner.loginDev("owner");
  });
  afterEach(async () => {
    await api.close();
  });

  const force = (mode: string) => owner.post("/api/v1/dev/scenarios/control", { action: "force_orb_state", mode });
  const orbText = async () => (await owner.get("/api/v1/orb/status")).json().data.status.activityText as string;

  it("defaults to F.R.I.D.A.Y. in settings, status and orb texts", async () => {
    expect((await owner.get("/api/v1/settings")).json().data.profile.assistantName).toBe("F.R.I.D.A.Y.");
    expect((await force("speaking")).statusCode).toBe(200);
    expect(await orbText()).toBe("F.R.I.D.A.Y. SPRICHT");
    expect((await force("booting")).statusCode).toBe(200);
    expect(await orbText()).toBe("F.R.I.D.A.Y. WIRD INITIALISIERT");
    const status = (await owner.get("/api/v1/status")).json().data;
    expect(status.label).toBe("F.R.I.D.A.Y. online");
    const overview = (await owner.get("/api/v1/overview")).json().data;
    expect(overview.friday.label).toBe("F.R.I.D.A.Y. online");
    expect(overview.orb.status.activityText).not.toMatch(/JARVIS/i);
  });

  it("follows the configured name without a restart", async () => {
    const settings = (await owner.get("/api/v1/settings")).json().data;
    const patched = await owner.patch("/api/v1/settings", { profile: { ...settings.profile, assistantName: "Fridolin" } });
    expect(patched.statusCode, patched.body).toBe(200);
    await force("speaking");
    expect(await orbText()).toBe("FRIDOLIN SPRICHT");
    expect((await owner.get("/api/v1/status")).json().data.label).toBe("Fridolin online");
    await force("booting");
    expect(await orbText()).toBe("FRIDOLIN WIRD INITIALISIERT");
  });

  it("makes brandText a no-op: the mock world words its texts with the configured name itself", async () => {
    const world = api.runtime.world;
    expect(world).toBeDefined();
    await force("speaking");
    expect(world?.orbSnapshot().status.activityText, "default name straight from the world").toBe("F.R.I.D.A.Y. SPRICHT");
    expect(brandText(world?.orbSnapshot().status.activityText ?? "", "F.R.I.D.A.Y.")).toBe("F.R.I.D.A.Y. SPRICHT");

    const seen: FridayEvent[] = [];
    api.runtime.hub.subscribe((event) => seen.push(event));
    const settings = (await owner.get("/api/v1/settings")).json().data;
    await owner.patch("/api/v1/settings", { profile: { ...settings.profile, assistantName: "Fridolin" } });
    // unbranded, as the world produced it
    expect(world?.orbSnapshot().status.activityText).toBe("FRIDOLIN SPRICHT");
    expect(world?.fridayStatus().label).toBe("Fridolin online");
    // and the stream already carries the new wording (no rewrite at the API edge)
    const orbEvent = seen.find((event) => event.type === "friday.orb.status_changed");
    expect((orbEvent?.data as { status: { activityText: string } } | undefined)?.status.activityText).toBe("FRIDOLIN SPRICHT");
    expect(JSON.stringify((await owner.get("/api/v1/orb/status")).json())).not.toMatch(/F\.R\.I\.D\.A\.Y\.|JARVIS/);
  });

  it("validates the name (1 to 40 characters)", async () => {
    const settings = (await owner.get("/api/v1/settings")).json().data;
    for (const assistantName of ["", "x".repeat(41), 42]) {
      const response = await owner.patch("/api/v1/settings", { profile: { ...settings.profile, assistantName } });
      expect(response.statusCode, JSON.stringify(assistantName)).toBe(422);
      expect(errorOf(response).code).toBe("VALIDATION_FAILED");
    }
    expect((await owner.patch("/api/v1/settings", { profile: { ...settings.profile, assistantName: "x".repeat(40) } })).statusCode).toBe(200);
  });

  it("keeps the name when a profile patch omits it (optional field)", async () => {
    const settings = (await owner.get("/api/v1/settings")).json().data;
    const { assistantName: _omitted, ...profile } = settings.profile;
    const response = await owner.patch("/api/v1/settings", { profile: { ...profile, displayName: "Erik Brandt" } });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().data.profile.displayName).toBe("Erik Brandt");
    expect(response.json().data.profile.assistantName ?? "F.R.I.D.A.Y.").toBe("F.R.I.D.A.Y.");
  });

  it("derives branded orb texts outside mock mode as well", () => {
    const input: OrbInputs = {
      health: "online",
      nowMs: Date.parse("2026-10-14T08:00:00.000Z"),
      workingAgentIds: [],
      runningTasks: [],
      pendingApprovals: [],
      criticalOpen: [],
      urgentOpen: [],
      voiceMode: "speaking",
      audioLevel: 0.4,
      degraded: [],
    };
    expect(deriveOrb(input, "2026-10-14T08:00:00.000Z").status.activityText).toBe("F.R.I.D.A.Y. SPRICHT");
    expect(deriveOrb({ ...input, assistantName: "Fridolin" }, "2026-10-14T08:00:00.000Z").status.activityText).toBe("FRIDOLIN SPRICHT");
  });

  it("rewrites legacy wording from adapters", () => {
    expect(brandText("JARVIS SPRICHT", "F.R.I.D.A.Y.")).toBe("F.R.I.D.A.Y. SPRICHT");
    expect(brandText("Jarvis online", "F.R.I.D.A.Y.")).toBe("F.R.I.D.A.Y. online");
    expect(brandText("{ASSISTANT} WIRD INITIALISIERT", "Fridolin")).toBe("FRIDOLIN WIRD INITIALISIERT");
    expect(brandText("BEREIT", "Fridolin")).toBe("BEREIT");
    expect(brandText("F.R.I.D.A.Y. SPRICHT", "Fridolin")).toBe("FRIDOLIN SPRICHT");
    expect(brandText("F.R.I.D.A.Y. eingeschränkt", "Fridolin")).toBe("Fridolin eingeschränkt");
  });
});

describe("command conventions of the web client", () => {
  let api: TestApi;
  let operator: ApiClient;
  let owner: ApiClient;
  const events: FridayEvent[] = [];

  beforeEach(async () => {
    api = await startTestApi();
    owner = api.client();
    operator = api.client();
    await owner.loginDev("owner");
    await operator.loginDev("operator");
    events.length = 0;
    api.runtime.hub.subscribe((event) => events.push(event));
  });
  afterEach(async () => {
    await api.close();
  });

  const voice = async () => (await owner.get("/api/v1/voice/status")).json().data;
  const execute = (text: string, client = operator, source = "voice") => client.post("/api/v1/commands", { text, source });

  it("recognizes the intent texts (case, spacing and punctuation tolerant) but not free text", () => {
    expect(matchBuiltinIntent("Sprachaufnahme starten")).toBe("voice_start");
    expect(matchBuiltinIntent("  sprachaufnahme   STARTEN! ")).toBe("voice_start");
    expect(matchBuiltinIntent("Fokus-Modus umschalten")).toBe("focus_toggle");
    expect(matchBuiltinIntent("fokusmodus umschalten")).toBe("focus_toggle");
    expect(matchBuiltinIntent("Sprachaufnahme starten und Mail schreiben")).toBeNull();
    expect(matchBuiltinIntent("Executive Briefing")).toBeNull();
  });

  it("starts the voice recording: executed, voice listening, orb listening, state event", async () => {
    const response = await execute("Sprachaufnahme starten");
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ status: "executed", requiresConfirmation: false, approvalId: null, riskTier: 1 });
    expect(response.json().commandId).toMatch(/^cmd_[0-9A-Za-z]{26}$/);
    expect((await voice()).mode).toBe("listening");
    // pending approvals outrank listening in the orb arbitration; the voice layer still reports the recording
    expect((await owner.get("/api/v1/orb/status")).json().data.layers.voice).toBe("listening");
    expect(events.some((event) => event.type === "friday.voice.state_changed")).toBe(true);
    // stopping works through the regular endpoint
    expect((await operator.post("/api/v1/voice/stop")).statusCode).toBe(200);
    expect((await voice()).mode).toBe("idle");
  });

  it("toggles the focus mode on and off", async () => {
    expect((await voice()).focusMode).toBe(false);
    const on = await execute("Fokus-Modus umschalten", operator, "quick_command");
    expect(on.statusCode, on.body).toBe(200);
    expect(on.json().status).toBe("executed");
    expect((await voice()).focusMode).toBe(true);
    const refused = await execute("Sprachaufnahme starten");
    expect(refused.json().status, "no recording while the focus mode mutes the microphone").toBe("rejected");
    const off = await execute("Fokus-Modus umschalten", operator, "quick_command");
    expect(off.json().status).toBe("executed");
    expect((await voice()).focusMode).toBe(false);
  });

  it("lists both intents in the command history of the commands adapter", async () => {
    await execute("Sprachaufnahme starten");
    await execute("Fokus-Modus umschalten", operator, "quick_command");
    const history = (await owner.get("/api/v1/commands/history", { query: { limit: "10" } })).json().items as Array<{ text: string; status: string; origin: string; riskTier: number | null }>;
    const started = history.find((entry) => entry.text === "Sprachaufnahme starten");
    const focus = history.find((entry) => entry.text === "Fokus-Modus umschalten");
    expect(started).toMatchObject({ status: "executed", origin: "voice", riskTier: 1 });
    expect(focus).toMatchObject({ status: "executed", origin: "quick_command", riskTier: 1 });
    // a rejected attempt (focus mode on) is history too
    await execute("Sprachaufnahme starten");
    const again = (await owner.get("/api/v1/commands/history", { query: { limit: "10" } })).json().items as Array<{ text: string; status: string }>;
    expect(again[0]).toMatchObject({ text: "Sprachaufnahme starten", status: "rejected" });
  });

  it("records the commands in the control-plane history and the audit trail", async () => {
    await execute("Sprachaufnahme starten");
    const [latest] = api.runtime.stores.commands.recent(1);
    expect(latest).toMatchObject({ text: "Sprachaufnahme starten", origin: "voice", status: "executed" });
    const audit = api.runtime.stores.audit.recent(3).find((event) => event.action === "command.executed");
    expect(audit, "command.executed audit event").toBeDefined();
    expect(audit?.result).toBe("success");
    expect(audit?.context).toMatchObject({ intent: "voice_start", status: "executed", source: "voice" });
  });

  it("follows the same rules as every command: roles, capabilities and outages", async () => {
    const viewer = api.client();
    await viewer.loginDev("viewer");
    expect((await execute("Sprachaufnahme starten", viewer)).statusCode).toBe(403);
    await owner.post("/api/v1/dev/scenarios/control", { action: "adapter_offline", adapterId: "mock-voice", offline: true });
    const outage = await execute("Sprachaufnahme starten");
    expect(outage.statusCode).toBe(503);
    expect(errorOf(outage).code).toBe("ADAPTER_UNAVAILABLE");
    expect((await execute("Fokus-Modus umschalten")).statusCode).toBe(503);
    // other commands keep working during the voice outage
    expect((await execute("Öffne die Aufgaben", operator, "palette")).statusCode).toBe(200);
  });

  it("treats a confirmed repeat like a normal command (no re-execution of the intent)", async () => {
    const response = await operator.post("/api/v1/commands", { text: "Sprachaufnahme starten", source: "voice", confirm: true, previewId: "prev_00000000000000000000000000" });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
  });
});
