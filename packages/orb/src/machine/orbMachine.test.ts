import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createActor } from "xstate";
import type { OrbLayers, OrbSnapshot, OrbStatus } from "../contract-types";
import {
  SUCCESS_FLASH_MS,
  arbitrateOrbState,
  layersFromStatus,
  normalizeProgress,
  orbMachine,
  selectOrbLayers,
  selectOrbMode,
  selectOrbSnapshot,
  selectOrbStatus,
  toInternalLayers,
  toOrbLayers,
  type OrbInternalLayers,
} from "./orbMachine";

function boot() {
  const actor = createActor(orbMachine);
  actor.start();
  actor.send({ type: "SYSTEM_READY" });
  return actor;
}

const baseLayers: OrbInternalLayers = {
  voice: "idle",
  work: "idle",
  attention: "none",
  health: "online",
  connectivity: "online",
  activeAgentIds: [],
};

describe("arbitrateOrbState priority (PLAN 18.3)", () => {
  it("returns idle for a quiet online system", () => {
    expect(arbitrateOrbState({ layers: baseLayers })).toBe("idle");
  });

  it("ranks error above everything but keeps the other layers untouched", () => {
    const layers: OrbInternalLayers = { ...baseLayers, voice: "speaking", work: "working", attention: "error", activeAgentIds: ["a", "b"] };
    expect(arbitrateOrbState({ layers })).toBe("error");
    expect(layers.voice).toBe("speaking");
    expect(layers.activeAgentIds).toHaveLength(2);
  });

  it("ranks offline at the top tier and booting above offline", () => {
    expect(arbitrateOrbState({ layers: { ...baseLayers, connectivity: "offline", attention: "approval" } })).toBe("offline");
    expect(arbitrateOrbState({ layers: { ...baseLayers, connectivity: "booting", attention: "error" } })).toBe("booting");
  });

  it("orders approval > listening/speaking > transcribing/thinking > working/syncing > idle", () => {
    expect(arbitrateOrbState({ layers: { ...baseLayers, attention: "approval", voice: "listening" } })).toBe("waiting_approval");
    expect(arbitrateOrbState({ layers: { ...baseLayers, voice: "listening", work: "working" } })).toBe("listening");
    expect(arbitrateOrbState({ layers: { ...baseLayers, voice: "speaking", work: "working" } })).toBe("speaking");
    expect(arbitrateOrbState({ layers: { ...baseLayers, voice: "thinking", work: "working" } })).toBe("thinking");
    expect(arbitrateOrbState({ layers: { ...baseLayers, voice: "transcribing", work: "syncing" } })).toBe("transcribing");
    expect(arbitrateOrbState({ layers: { ...baseLayers, work: "working" } })).toBe("working");
    expect(arbitrateOrbState({ layers: { ...baseLayers, work: "syncing" } })).toBe("syncing");
  });

  it("shows paused instead of activity and warning only when nothing busier runs", () => {
    expect(arbitrateOrbState({ layers: { ...baseLayers, connectivity: "paused", work: "working" } })).toBe("paused");
    expect(arbitrateOrbState({ layers: { ...baseLayers, attention: "warning" } })).toBe("warning");
    expect(arbitrateOrbState({ layers: { ...baseLayers, attention: "warning", work: "working" } })).toBe("working");
  });

  it("success flash outranks voice and work but not error/approval", () => {
    expect(arbitrateOrbState({ layers: { ...baseLayers, work: "working" }, flashSuccess: true })).toBe("success");
    expect(arbitrateOrbState({ layers: { ...baseLayers, attention: "approval" }, flashSuccess: true })).toBe("waiting_approval");
  });
});

describe("orbMachine", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("starts booting and becomes idle on SYSTEM_READY", () => {
    const actor = createActor(orbMachine).start();
    expect(selectOrbMode(actor.getSnapshot())).toBe("booting");
    actor.send({ type: "SYSTEM_READY" });
    expect(selectOrbMode(actor.getSnapshot())).toBe("idle");
  });

  it("walks the voice pipeline listening -> transcribing -> thinking -> working -> speaking", () => {
    const actor = boot();
    const mode = () => selectOrbMode(actor.getSnapshot());
    actor.send({ type: "MIC_OPENED" });
    expect(mode()).toBe("listening");
    actor.send({ type: "VOICE_ACTIVITY_STARTED" });
    expect(actor.getSnapshot().context.voiceActive).toBe(true);
    actor.send({ type: "VOICE_ACTIVITY_ENDED" });
    expect(actor.getSnapshot().context.voiceActive).toBe(false);
    actor.send({ type: "TRANSCRIPTION_STARTED" });
    expect(mode()).toBe("transcribing");
    actor.send({ type: "TRANSCRIPTION_FINISHED" });
    actor.send({ type: "THINKING_STARTED" });
    expect(mode()).toBe("thinking");
    actor.send({ type: "TASK_STARTED", taskId: "task_1", agentId: "agent_1", activityText: "RECHERCHE LÄUFT" });
    expect(mode()).toBe("working");
    actor.send({ type: "TTS_STARTED" });
    expect(mode()).toBe("speaking");
    actor.send({ type: "TTS_ENDED" });
    expect(mode()).toBe("working");
  });

  it("keeps layers parallel: speaking while three agents work", () => {
    const actor = boot();
    for (const id of ["agent_1", "agent_2", "agent_3"]) {
      actor.send({ type: "TASK_STARTED", taskId: `task_${id}`, agentId: id });
    }
    actor.send({ type: "TASK_PROGRESS", progress: 62 });
    actor.send({ type: "TTS_STARTED" });
    const snap = actor.getSnapshot();
    expect(snap.matches({ voice: "speaking", work: "working", connectivity: "online" })).toBe(true);
    expect(selectOrbMode(snap)).toBe("speaking");
    expect(snap.context.layers.activeAgentIds).toEqual(["agent_1", "agent_2", "agent_3"]);
    const status = selectOrbStatus(snap);
    expect(status.activeAgentCount).toBe(3);
    expect(status.progress).toBeCloseTo(0.62);
    expect(status.progressMode).toBe("determinate");
  });

  it("overlays approval without dropping working context and resolves back", () => {
    const actor = boot();
    actor.send({ type: "TASK_STARTED", taskId: "task_1", agentId: "agent_1", activityText: "PRÄSENTATION WIRD ERSTELLT" });
    actor.send({ type: "APPROVAL_REQUIRED", approvalId: "appr_1" });
    let snap = actor.getSnapshot();
    expect(selectOrbMode(snap)).toBe("waiting_approval");
    expect(snap.matches({ work: "working", attention: "approval" })).toBe(true);
    expect(selectOrbStatus(snap).approvalId).toBe("appr_1");
    expect(selectOrbStatus(snap).activityText).toBe("PRÄSENTATION WIRD ERSTELLT");
    actor.send({ type: "APPROVAL_RESOLVED" });
    snap = actor.getSnapshot();
    expect(selectOrbMode(snap)).toBe("working");
    expect(snap.matches({ attention: "none" })).toBe(true);
  });

  it("error preempts approval and recovery falls through to the pending approval", () => {
    const actor = boot();
    actor.send({ type: "APPROVAL_REQUIRED", approvalId: "appr_1" });
    actor.send({ type: "ERROR_RAISED", detailText: "Adapter nicht erreichbar" });
    expect(selectOrbMode(actor.getSnapshot())).toBe("error");
    actor.send({ type: "ERROR_CLEARED" });
    expect(selectOrbMode(actor.getSnapshot())).toBe("waiting_approval");
    actor.send({ type: "APPROVAL_RESOLVED" });
    expect(selectOrbMode(actor.getSnapshot())).toBe("idle");
  });

  it("error -> recovery returns to the underlying activity", () => {
    const actor = boot();
    actor.send({ type: "TASK_STARTED", taskId: "t", agentId: "a" });
    actor.send({ type: "ERROR_RAISED" });
    expect(selectOrbMode(actor.getSnapshot())).toBe("error");
    expect(actor.getSnapshot().context.layers.work).toBe("working");
    actor.send({ type: "ERROR_CLEARED" });
    expect(selectOrbMode(actor.getSnapshot())).toBe("working");
  });

  it("warning shows when idle and clears", () => {
    const actor = boot();
    actor.send({ type: "WARNING_RAISED" });
    expect(selectOrbMode(actor.getSnapshot())).toBe("warning");
    actor.send({ type: "WARNING_CLEARED" });
    expect(selectOrbMode(actor.getSnapshot())).toBe("idle");
  });

  it("offline outranks everything, forces health offline and recovers online", () => {
    const actor = boot();
    actor.send({ type: "TASK_STARTED", taskId: "t", agentId: "a" });
    actor.send({ type: "HEALTH_CHANGED", health: "degraded" });
    actor.send({ type: "SYSTEM_OFFLINE" });
    let snap = actor.getSnapshot();
    expect(selectOrbMode(snap)).toBe("offline");
    expect(snap.context.layers.health).toBe("offline");
    actor.send({ type: "SYSTEM_ONLINE" });
    snap = actor.getSnapshot();
    expect(selectOrbMode(snap)).toBe("working");
    expect(snap.context.layers.health).toBe("degraded");
  });

  it("pause and resume", () => {
    const actor = boot();
    actor.send({ type: "PAUSE" });
    expect(selectOrbMode(actor.getSnapshot())).toBe("paused");
    actor.send({ type: "RESUME" });
    expect(selectOrbMode(actor.getSnapshot())).toBe("idle");
  });

  it("success flash auto-returns after 1.5 s to idle and clears the progress orbit", () => {
    const actor = boot();
    actor.send({ type: "TASK_STARTED", taskId: "t", agentId: "a" });
    actor.send({ type: "TASK_PROGRESS", progress: 0.9 });
    actor.send({ type: "TASK_COMPLETED", taskId: "t", agentId: "a" });
    let snap = actor.getSnapshot();
    expect(selectOrbMode(snap)).toBe("success");
    expect(snap.context.progress).toBe(1);
    vi.advanceTimersByTime(SUCCESS_FLASH_MS - 50);
    expect(selectOrbMode(actor.getSnapshot())).toBe("success");
    vi.advanceTimersByTime(100);
    snap = actor.getSnapshot();
    expect(selectOrbMode(snap)).toBe("idle");
    expect(snap.context.progress).toBeNull();
    expect(snap.context.progressMode).toBe("none");
  });

  it("does not flash success while other agents are still working", () => {
    const actor = boot();
    actor.send({ type: "TASK_STARTED", taskId: "t1", agentId: "a1" });
    actor.send({ type: "TASK_STARTED", taskId: "t2", agentId: "a2" });
    actor.send({ type: "TASK_COMPLETED", taskId: "t1", agentId: "a1" });
    expect(selectOrbMode(actor.getSnapshot())).toBe("working");
    expect(actor.getSnapshot().context.layers.activeAgentIds).toEqual(["a2"]);
  });

  it("syncing returns to idle, and a sync during work resumes syncing after the work ends", () => {
    const actor = boot();
    actor.send({ type: "SYNC_STARTED", source: "KALENDER WIRD SYNCHRONISIERT" });
    expect(selectOrbMode(actor.getSnapshot())).toBe("syncing");
    actor.send({ type: "SYNC_FINISHED" });
    expect(selectOrbMode(actor.getSnapshot())).toBe("idle");

    actor.send({ type: "TASK_STARTED", taskId: "t", agentId: "a" });
    actor.send({ type: "SYNC_STARTED", source: "MAILS WERDEN AKTUALISIERT" });
    expect(selectOrbMode(actor.getSnapshot())).toBe("working");
    actor.send({ type: "TASK_COMPLETED", taskId: "t", agentId: "a" });
    expect(actor.getSnapshot().matches({ work: "syncing" })).toBe(true);
  });

  it("SYNC_STATUS snaps all regions to a backend OrbSnapshot", () => {
    const actor = boot();
    actor.send({ type: "TASK_STARTED", taskId: "t", agentId: "a" });
    const snap = (status: OrbStatus, layers?: OrbLayers): OrbSnapshot => ({ status, layers: layers ?? layersFromStatus(status) });
    actor.send({
      type: "SYNC_STATUS",
      snapshot: snap({ mode: "listening", audioLevel: 0.4, activeAgentCount: 2, since: "2026-06-15T10:00:00Z", sourceEventId: "evt_1" }),
    });
    let s = actor.getSnapshot();
    expect(selectOrbMode(s)).toBe("listening");
    expect(s.matches({ voice: "listening", work: "idle", attention: "none", connectivity: "online" })).toBe(true);
    expect(s.context.layers.activeAgentIds).toHaveLength(2);
    expect(s.context.audioLevel).toBeCloseTo(0.4);

    actor.send({ type: "SYNC_STATUS", snapshot: snap({ mode: "error", detailText: "x", since: "2026-06-15T10:01:00Z" }) });
    expect(selectOrbMode(actor.getSnapshot())).toBe("error");
    actor.send({ type: "SYNC_STATUS", snapshot: snap({ mode: "offline", since: "2026-06-15T10:02:00Z" }) });
    expect(selectOrbMode(actor.getSnapshot())).toBe("offline");
    actor.send({ type: "SYNC_STATUS", snapshot: snap({ mode: "success", since: "2026-06-15T10:03:00Z" }) });
    expect(selectOrbMode(actor.getSnapshot())).toBe("success");
    actor.send({ type: "SYNC_STATUS", snapshot: snap({ mode: "thinking", since: "2026-06-15T10:04:00Z" }) });
    s = actor.getSnapshot();
    expect(selectOrbMode(s)).toBe("thinking");
    expect(s.matches({ voice: "thinking" })).toBe(true);
    actor.send({ type: "SYNC_STATUS", snapshot: snap({ mode: "paused", since: "2026-06-15T10:05:00Z" }) });
    expect(selectOrbMode(actor.getSnapshot())).toBe("paused");
  });

  it("SYNC_STATUS with explicit wire layers keeps the parallel picture", () => {
    const actor = boot();
    const layers: OrbLayers = { voice: "speaking", work: "working", attention: "none", health: "online", activeAgentIds: ["a", "b", "c"] };
    actor.send({ type: "SYNC_STATUS", snapshot: { status: { mode: "speaking", since: "2026-06-15T10:00:00Z" }, layers } });
    const s = actor.getSnapshot();
    expect(s.matches({ voice: "speaking", work: "working" })).toBe(true);
    expect(s.context.layers.activeAgentIds).toHaveLength(3);
  });

  it("exposes the machine state as a wire OrbSnapshot (thinking/paused/success fold into the contract layers)", () => {
    const actor = boot();
    actor.send({ type: "THINKING_STARTED" });
    expect(selectOrbLayers(actor.getSnapshot()).work).toBe("thinking");
    actor.send({ type: "TTS_STARTED" });
    actor.send({ type: "TASK_STARTED", taskId: "t", agentId: "a" });
    const snap = selectOrbSnapshot(actor.getSnapshot());
    expect(snap.status.mode).toBe("speaking");
    expect(snap.layers).toMatchObject({ voice: "speaking", work: "working", attention: "none", health: "online", activeAgentIds: ["a"] });
    actor.send({ type: "APPROVAL_REQUIRED", approvalId: "appr_1" });
    expect(selectOrbLayers(actor.getSnapshot()).attention).toBe("waiting_approval");
    actor.send({ type: "PAUSE" });
    expect(selectOrbLayers(actor.getSnapshot()).work).toBe("paused");
    actor.send({ type: "SYSTEM_OFFLINE" });
    expect(selectOrbLayers(actor.getSnapshot()).health).toBe("offline");
  });

  it("round-trips wire layers through the internal model", () => {
    const wire: OrbLayers = { voice: "listening", work: "thinking", attention: "waiting_approval", health: "degraded", activeAgentIds: ["x"] };
    const { layers, flashSuccess } = toInternalLayers({ status: { mode: "waiting_approval", since: "s" }, layers: wire });
    expect(layers.voice).toBe("listening");
    expect(layers.attention).toBe("approval");
    expect(flashSuccess).toBe(false);
    expect(toOrbLayers({ layers, flashSuccess })).toMatchObject({ voice: "listening", attention: "waiting_approval", health: "degraded" });
  });
});

describe("helpers", () => {
  it("normalizes progress to a 0..1 fraction", () => {
    expect(normalizeProgress(0.5)).toBe(0.5);
    expect(normalizeProgress(62)).toBeCloseTo(0.62);
    expect(normalizeProgress(null)).toBeNull();
    expect(normalizeProgress(250)).toBe(1);
    expect(normalizeProgress(-3)).toBe(0);
  });

  it("maps a status to layers", () => {
    const l = layersFromStatus({ mode: "working", activeAgentCount: 3, since: "x" });
    expect(l.work).toBe("working");
    expect(layersFromStatus({ mode: "thinking", since: "x" }).work).toBe("thinking");
    expect(layersFromStatus({ mode: "paused", since: "x" }).work).toBe("paused");
    expect(layersFromStatus({ mode: "waiting_approval", since: "x" }).attention).toBe("waiting_approval");
    expect(l.activeAgentIds).toHaveLength(3);
    expect(layersFromStatus({ mode: "offline", since: "x" }).health).toBe("offline");
  });
});
