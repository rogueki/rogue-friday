import type { AdapterRegistry } from "@friday/adapter-core";
import type { Approval, Notification, Task, VoiceStatus } from "@friday/sdk";
import { describe, expect, it } from "vitest";
import { AUDIO_LEVEL_TTL_MS, OrbService, VOICE_EVENT_TTL_MS, deriveOrb, type OrbInputs } from "../src/services/core-views";

const SINCE = "2026-10-17T08:00:00.000Z";
const NOW = Date.parse(SINCE);
const AGENT_A = "agent_01JCW5E9R2Q7T4M8N3B6V00001";
const AGENT_B = "agent_01JCW5E9R2Q7T4M8N3B6V00002";
const APPROVAL = "appr_01JCW5E9R2Q7T4M8N3B6V00003";
const TASK = "task_01JCW5E9R2Q7T4M8N3B6V00004";

const base: OrbInputs = {
  health: "online",
  nowMs: NOW,
  workingAgentIds: [],
  runningTasks: [],
  pendingApprovals: [],
  criticalOpen: [],
  urgentOpen: [],
  voiceMode: "idle",
  audioLevel: undefined,
  degraded: [],
};
const derive = (patch: Partial<OrbInputs>) => deriveOrb({ ...base, ...patch }, SINCE);

const approval = { id: APPROVAL, action: "E-Mail senden", riskTier: 2, taskId: TASK, expiresAt: null } as unknown as Approval;
const running = (progress: Task["progress"]) =>
  ({ id: TASK, title: "Recherche Marktanalyse", priority: "P1", progress, status: "running" }) as unknown as Task;
const alert = (title: string, priority: "P0" | "P1") => ({ id: `notif_${title}`, title, priority }) as unknown as Notification;

describe("deriveOrb: voice pipeline phases (real event path)", () => {
  it.each([
    ["listening", "ICH HÖRE ZU"],
    ["transcribing", "SPRACHE WIRD VERARBEITET"],
    ["thinking", "ANALYSE"],
    ["speaking", "F.R.I.D.A.Y. SPRICHT"],
  ] as const)("voice %s -> orb %s", (voiceMode, text) => {
    const { status } = derive({ voiceMode });
    expect(status.mode).toBe(voiceMode);
    expect(status.activityText).toBe(text);
  });

  it("maps the phases onto the parallel layers", () => {
    expect(derive({ voiceMode: "listening" }).layers).toMatchObject({ voice: "listening", work: "idle" });
    expect(derive({ voiceMode: "transcribing" }).layers).toMatchObject({ voice: "transcribing", work: "idle" });
    expect(derive({ voiceMode: "thinking" }).layers).toMatchObject({ voice: "idle", work: "thinking" });
    expect(derive({ voiceMode: "speaking" }).layers).toMatchObject({ voice: "speaking", work: "idle" });
  });

  it("carries the audio level only for the audible phases", () => {
    expect(derive({ voiceMode: "listening", audioLevel: 0.6 }).status.audioLevel).toBe(0.6);
    expect(derive({ voiceMode: "speaking", audioLevel: 0.3 }).status.audioLevel).toBe(0.3);
    expect(derive({ voiceMode: "transcribing", audioLevel: 0.6 }).status.audioLevel).toBeUndefined();
    expect(derive({ voiceMode: "thinking", audioLevel: 0.6 }).status.audioLevel).toBeUndefined();
  });

  it("speaking keeps running work visible in the layers (parallel states)", () => {
    const out = derive({ voiceMode: "speaking", workingAgentIds: [AGENT_A], runningTasks: [running({ mode: "indeterminate", value: null })] });
    expect(out.status.mode).toBe("speaking");
    expect(out.layers.work).toBe("working");
    expect(out.layers.activeAgentIds).toEqual([AGENT_A]);
    expect(out.status.detailText).toBe("1 Agent arbeitet");
  });

  it("paused microphone without activity shows paused", () => {
    expect(derive({ voicePaused: true }).status.mode).toBe("paused");
  });
});

describe("deriveOrb: work, approval, health, error", () => {
  it("working with several agents: count text, current agent name, real progress only when determinate", () => {
    const out = derive({
      workingAgentIds: [AGENT_A, AGENT_B],
      currentAgent: { id: AGENT_A, name: "Recherche-Agent" },
      runningTasks: [running({ mode: "determinate", value: 0.4 })],
    });
    expect(out.status).toMatchObject({
      mode: "working",
      activityText: "2 AGENTEN AKTIV",
      activeAgentCount: 2,
      currentAgentId: AGENT_A,
      currentAgentName: "Recherche-Agent",
      progress: 0.4,
      progressMode: "determinate",
      taskId: TASK,
    });
    expect(out.layers).toMatchObject({ work: "working", activeAgentIds: [AGENT_A, AGENT_B] });
  });

  it("indeterminate task progress is never invented", () => {
    const { status } = derive({ runningTasks: [running({ mode: "indeterminate", value: null })] });
    expect(status).toMatchObject({ mode: "working", progress: null, progressMode: "indeterminate", activityText: "ARBEIT LÄUFT" });
  });

  it("waiting_approval carries the approval id and outranks voice and work", () => {
    const out = derive({ pendingApprovals: [approval], voiceMode: "speaking", workingAgentIds: [AGENT_A] });
    expect(out.status).toMatchObject({ mode: "waiting_approval", approvalId: APPROVAL, taskId: TASK, activityText: "FREIGABE ERFORDERLICH" });
    expect(out.layers).toMatchObject({ attention: "waiting_approval", voice: "speaking", work: "working" });
  });

  it("degraded and urgent alerts show warning; fully offline shows offline", () => {
    expect(derive({ health: "degraded", degraded: ["Sprache eingeschränkt"] }).status).toMatchObject({ mode: "warning", urgency: "warning", health: "degraded" });
    expect(derive({ urgentOpen: [alert("Speicher knapp", "P1")] }).status).toMatchObject({ mode: "warning", detailText: "Speicher knapp" });
    expect(derive({ health: "offline" }).status).toMatchObject({ mode: "offline", urgency: "critical" });
  });

  it("warning does not hide an active voice phase or work", () => {
    expect(derive({ health: "degraded", voiceMode: "thinking" }).status.mode).toBe("thinking");
    expect(derive({ health: "degraded", workingAgentIds: [AGENT_A] }).status).toMatchObject({ mode: "working", urgency: "none" });
    expect(derive({ health: "degraded", degraded: ["Aufgaben offline"], workingAgentIds: [AGENT_A] }).status.urgency).toBe("warning");
  });

  it("errors (critical alert, voice pipeline error) outrank everything", () => {
    const critical = derive({ criticalOpen: [alert("Hermes nicht erreichbar", "P0")], pendingApprovals: [approval], voiceMode: "speaking", health: "offline" });
    expect(critical.status).toMatchObject({ mode: "error", urgency: "critical" });
    expect(critical.layers.attention).toBe("error");
    expect(derive({ voiceMode: "error" }).status).toMatchObject({ mode: "error", detailText: "Sprachpipeline meldet einen Fehler" });
  });

  it("idle when nothing is going on", () => {
    expect(derive({}).status).toMatchObject({ mode: "idle", activityText: "BEREIT" });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// OrbService: event-fed voice status and audio levels
// ---------------------------------------------------------------------------------------------------------------------

function voiceStatus(mode: VoiceStatus["mode"], inputLevel = 0): VoiceStatus {
  return { mode, microphone: { state: mode === "listening" ? "listening" : "idle", active: true, deviceId: null, inputLevel } } as unknown as VoiceStatus;
}

function makeService(clock: { now: number }, agents: unknown[] = []) {
  const calls = { agents: 0, voice: 0 };
  let polledMode: VoiceStatus["mode"] = "idle";
  const page = (items: unknown[]) => ({ items, pageInfo: { nextCursor: null, hasNextPage: false }, freshness: { state: "fresh", asOf: SINCE } });
  const registry = {
    listAdapters: () => [],
    getPort: (category: string) => {
      switch (category) {
        case "agents":
          return { listAgents: async () => (calls.agents++, page(agents)) };
        case "tasks":
          return { listTasks: async () => page([]) };
        case "approvals":
          return { listApprovals: async () => page([]) };
        case "notifications":
          return { listNotifications: async () => page([]) };
        case "voice":
          return { getVoiceStatus: async () => (calls.voice++, { data: voiceStatus(polledMode), freshness: { state: "fresh", asOf: SINCE } }) };
        default:
          throw new Error(category);
      }
    },
  } as unknown as AdapterRegistry;
  const service = new OrbService({ registry, world: undefined, dataMode: "real" as never, now: () => clock.now });
  return { service, calls, setPolled: (mode: VoiceStatus["mode"]) => (polledMode = mode) };
}

describe("OrbService with the voice event path", () => {
  it("uses a state_changed payload without asking the voice port, and falls back to the port after the TTL", async () => {
    const clock = { now: NOW };
    const { service, calls, setPolled } = makeService(clock);
    service.observeVoiceStatus(voiceStatus("transcribing"), clock.now);
    expect((await service.snapshot()).status.mode).toBe("transcribing");
    expect(calls.voice).toBe(0);

    clock.now += VOICE_EVENT_TTL_MS + 1;
    setPolled("idle");
    expect((await service.snapshot()).status.mode).toBe("idle"); // vanished service must not leave the orb in a phase
    expect(calls.voice).toBe(1);
  });

  it("walks the pipeline from events and reuses the slow sources for phase-triggered derivations", async () => {
    const clock = { now: NOW };
    const { service, calls } = makeService(clock, [{ id: AGENT_A, name: "Recherche-Agent" }]);
    const modes: string[] = [];
    for (const mode of ["listening", "transcribing", "thinking", "speaking", "idle"] as const) {
      service.observeVoiceStatus(voiceStatus(mode), clock.now);
      modes.push((await service.snapshot(undefined, { reuseSlowSources: true })).status.mode);
      clock.now += 50;
    }
    expect(modes).toEqual(["listening", "transcribing", "thinking", "speaking", "working"]); // idle voice + working agent
    expect(calls.agents).toBe(1); // first run fills the cache, the following phases reuse it
    clock.now += 10_000;
    await service.snapshot(undefined, { reuseSlowSources: true });
    expect(calls.agents).toBe(2);
  });

  it("takes the level of the active direction from audio_level events and lets stale levels expire", async () => {
    const clock = { now: NOW };
    const { service } = makeService(clock);
    service.observeVoiceStatus(voiceStatus("listening", 0.1), clock.now);
    service.observeAudioLevel("input", 0.55, clock.now);
    service.observeAudioLevel("output", 0.9, clock.now);
    expect((await service.snapshot()).status.audioLevel).toBe(0.55); // listening -> microphone, never the TTS level

    service.observeVoiceStatus(voiceStatus("speaking"), clock.now);
    expect((await service.snapshot()).status.audioLevel).toBe(0.9);

    clock.now += AUDIO_LEVEL_TTL_MS + 1;
    expect((await service.snapshot()).status.audioLevel).toBeUndefined(); // no fresh output level: nothing is invented
  });

  it("exposes the leading agent's name while working", async () => {
    const clock = { now: NOW };
    const { service } = makeService(clock, [{ id: AGENT_A, name: "Recherche-Agent" }]);
    const out = await service.snapshot();
    expect(out.status).toMatchObject({ mode: "working", currentAgentId: AGENT_A, currentAgentName: "Recherche-Agent" });
  });
});
