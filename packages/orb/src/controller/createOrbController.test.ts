import { describe, expect, it } from "vitest";
import type { OrbSnapshot } from "../contract-types";
import { createAudioFrame, createInputs } from "../audio/frame";
import { createOrbController } from "./createOrbController";
import { arbitrateLayers, layersForMode } from "./layers";
import type { OrbAudioFrame, OrbAudioFrameSource, OrbMode } from "./types";

function setup(options: { leaseMs?: number } = {}) {
  let t = 1000;
  const controller = createOrbController({ now: () => t, epochNow: () => 1_700_000_000_000 + t, leaseMs: options.leaseMs ?? 1500, seed: 7 });
  const inputs = createInputs();
  const advance = (ms: number) => {
    t += ms;
    controller.readFrame(t, inputs);
  };
  return { controller, bridge: controller.bridge, inputs, advance, now: () => t };
}

const mode = (c: { getState(): { status: { mode: OrbMode } } }): OrbMode => c.getState().status.mode;

const snapshot = (over: Partial<OrbSnapshot["layers"]> = {}, status: Partial<OrbSnapshot["status"]> = {}): OrbSnapshot => ({
  status: { mode: "idle", since: "2026-10-17T10:00:00.000Z", ...status },
  layers: { voice: "idle", work: "idle", attention: "none", health: "online", activeAgentIds: [], ...over },
});

describe("priority (owner order section 7)", () => {
  it("ranks critical error > offline > waiting approval > listening > speaking > transcribing > thinking > working > syncing > idle", () => {
    const base = layersForMode("idle");
    const sys = (patch: Partial<typeof base.systemHealth>) => ({ ...base, systemHealth: { ...base.systemHealth, ...patch } });
    expect(arbitrateLayers({ ...sys({ attention: "error", connectivity: "offline" }), primaryInteraction: "speaking" }, 0)).toBe("error");
    expect(arbitrateLayers({ ...sys({ connectivity: "offline" }), approval: { pending: true, count: 1 } }, 0)).toBe("offline");
    expect(arbitrateLayers({ ...base, approval: { pending: true, count: 1 }, primaryInteraction: "listening" }, 0)).toBe("waiting_approval");
    expect(arbitrateLayers({ ...base, primaryInteraction: "listening", backgroundWork: "working" }, 3)).toBe("listening");
    // speaking outranks transcribing/thinking by the layer table (the primary layer holds exactly one phase)
    expect(arbitrateLayers({ ...base, primaryInteraction: "speaking", backgroundWork: "working" }, 3)).toBe("speaking");
    expect(arbitrateLayers({ ...base, primaryInteraction: "transcribing", backgroundWork: "working" }, 3)).toBe("transcribing");
    expect(arbitrateLayers({ ...base, primaryInteraction: "thinking", backgroundWork: "working" }, 3)).toBe("thinking");
    expect(arbitrateLayers({ ...base, backgroundWork: "working" }, 1)).toBe("working");
    expect(arbitrateLayers({ ...base, backgroundWork: "syncing" }, 0)).toBe("syncing");
    expect(arbitrateLayers(base, 0)).toBe("idle");
  });

  it("local facts: a parallel state keeps every layer (speaking + 2 background agents + approval)", () => {
    const { controller, bridge } = setup();
    bridge.onAgentActivity(2, ["Atlas", "Nova"]);
    bridge.onTtsStarted();
    let s = controller.getState();
    expect(s.status.mode).toBe("speaking");
    expect(s.layers.backgroundWork).toBe("working");
    expect(s.status.activeAgentCount).toBe(2);
    expect(s.status.currentAgentName).toBe("Atlas");
    bridge.onApprovalRequired("appr_1");
    s = controller.getState();
    expect(s.status.mode).toBe("waiting_approval");
    expect(s.layers.primaryInteraction).toBe("speaking");
    expect(s.layers.approval).toEqual({ pending: true, count: 1, approvalId: "appr_1" });
    bridge.onError("kaputt");
    expect(mode(controller)).toBe("error");
    expect(controller.getState().layers.primaryInteraction).toBe("speaking");
    bridge.onOffline();
    expect(mode(controller)).toBe("error"); // critical error outranks offline
    bridge.onErrorCleared();
    expect(mode(controller)).toBe("offline");
    bridge.onOnline();
    expect(mode(controller)).toBe("waiting_approval");
  });

  it("an opened microphone is listening, a passive (wake-word armed) one is idle", () => {
    const { controller, bridge } = setup();
    bridge.onMicrophoneOpened({ source: "service", passive: true });
    expect(mode(controller)).toBe("idle");
    bridge.onMicrophoneOpened({ source: "service", passive: false });
    expect(mode(controller)).toBe("listening");
  });

  it("listening outranks speaking when the user opens the microphone during TTS (barge-in intent)", () => {
    const { controller, bridge } = setup();
    bridge.onTtsStarted();
    expect(mode(controller)).toBe("speaking");
    bridge.onMicrophoneOpened({ source: "browser" });
    expect(mode(controller)).toBe("listening");
  });

  it("an open microphone does not keep the orb in listening once TTS starts (hands-free conversations)", () => {
    const { controller, bridge } = setup();
    bridge.onMicrophoneOpened({ source: "browser" });
    expect(mode(controller)).toBe("listening");
    bridge.onTtsStarted();
    expect(mode(controller)).toBe("speaking");
  });
});

describe("voice pipeline facts", () => {
  it("walks listening -> transcribing -> thinking -> working -> speaking -> success -> idle", () => {
    const { controller, bridge, advance } = setup();
    const seen: OrbMode[] = [mode(controller)];
    const step = () => {
      const m = mode(controller);
      if (seen[seen.length - 1] !== m) seen.push(m);
    };
    bridge.onMicrophoneOpened({ source: "browser" });
    step();
    bridge.onMicrophoneClosed();
    bridge.onTranscriptionStarted();
    step();
    bridge.onTranscriptionCompleted();
    bridge.onThinkingStarted();
    step();
    bridge.onThinkingCompleted();
    bridge.onTaskStarted({ taskId: "t1", title: "Recherche" });
    step();
    bridge.onTtsStarted({ hasAudioAnalysis: true });
    step();
    bridge.onTtsEnded();
    step();
    bridge.onTaskCompleted({ taskId: "t1", success: true });
    step();
    advance(1600);
    step();
    expect(seen).toEqual(["idle", "listening", "transcribing", "thinking", "working", "speaking", "working", "success", "idle"]);
  });

  it("texts come from facts, never from the DOM", () => {
    const { controller, bridge } = setup();
    bridge.onThinkingStarted();
    expect(controller.getState().status.activityText).toBe("ANFRAGE WIRD ANALYSIERT");
    bridge.onThinkingCompleted();
    bridge.onSyncStarted("calendar");
    expect(controller.getState().status.activityText).toBe("KALENDER WIRD SYNCHRONISIERT");
    bridge.onSyncStarted("mail");
    expect(controller.getState().status.activityText).toBe("MAILS WERDEN AKTUALISIERT");
    bridge.onSyncFinished();
    bridge.onTaskStarted({ taskId: "t1", title: "Recherche läuft" });
    expect(controller.getState().status.activityText).toBe("RECHERCHE LÄUFT");
    controller.setActivity("EIGENER TEXT");
    expect(controller.getState().status.activityText).toBe("EIGENER TEXT");
  });

  it("marks derived phases", () => {
    const { controller, bridge } = setup();
    bridge.onTranscriptionStarted({ derived: true });
    expect(controller.getState().status.derived).toBe(true);
    bridge.onTranscriptionCompleted();
    bridge.onTranscriptionStarted();
    expect(controller.getState().status.derived).toBeUndefined();
  });
});

describe("leases", () => {
  it("a local listening fact expires without refresh and is refreshed by voice activity", () => {
    const { controller, bridge, advance } = setup({ leaseMs: 1500 });
    bridge.onMicrophoneOpened({ source: "service" });
    expect(mode(controller)).toBe("listening");
    advance(1000);
    bridge.onVoiceActivity(0.4);
    advance(1000);
    expect(mode(controller)).toBe("listening"); // refreshed at +1000 ms
    advance(1600);
    expect(mode(controller)).toBe("idle");
  });

  it("an attached live audio source keeps the microphone fact alive", () => {
    const { controller, bridge, advance } = setup({ leaseMs: 1500 });
    const live: OrbAudioFrameSource = {
      sample: (_now, out: OrbAudioFrame) => {
        out.rms = 0.3;
        out.source = "analyser";
      },
      dispose: () => undefined,
    };
    bridge.onMicrophoneOpened({ source: "service" });
    controller.setInputAudioSource(live);
    for (let i = 0; i < 20; i++) advance(500);
    expect(mode(controller)).toBe("listening");
    controller.setInputAudioSource(null);
    advance(2000);
    expect(mode(controller)).toBe("idle");
  });

  it("falls back to the server voice layer when the local fact is gone", () => {
    const { controller, bridge, advance } = setup({ leaseMs: 1000 });
    controller.applySnapshot(snapshot({ voice: "speaking" }, { mode: "speaking" }));
    expect(mode(controller)).toBe("speaking");
    bridge.onMicrophoneOpened({ source: "service" });
    expect(mode(controller)).toBe("listening");
    advance(1200);
    expect(mode(controller)).toBe("speaking");
  });

  it("barge-in: TTS end with interrupted stops speaking immediately and ignores the stale server layer for a moment", () => {
    const { controller, bridge, advance } = setup();
    bridge.onTtsStarted();
    controller.applySnapshot(snapshot({ voice: "speaking" }, { mode: "speaking" }));
    expect(mode(controller)).toBe("speaking");
    bridge.onTtsEnded({ interrupted: true });
    expect(mode(controller)).toBe("idle");
    controller.applySnapshot(snapshot({ voice: "speaking" }, { mode: "speaking" })); // poll latency
    expect(mode(controller)).toBe("idle");
    advance(1600);
    expect(mode(controller)).toBe("speaking"); // the server still claims it: server truth wins after the hold-down
  });

  it("success flash lasts 1.5 s", () => {
    const { controller, bridge, advance } = setup();
    bridge.onTaskStarted({ taskId: "t1" });
    bridge.onTaskCompleted({ taskId: "t1", success: true });
    expect(mode(controller)).toBe("success");
    advance(1400);
    expect(mode(controller)).toBe("success");
    advance(200);
    expect(mode(controller)).toBe("idle");
    bridge.onTaskStarted({ taskId: "t2" });
    bridge.onTaskCompleted({ taskId: "t2", success: false });
    expect(mode(controller)).toBe("idle"); // a failed task is reported through onError, not as success
  });
});

describe("server truth", () => {
  it("applySnapshot drives work, approval, health and agents; repeating it changes nothing", () => {
    const { controller } = setup();
    const snap = snapshot(
      { work: "working", attention: "waiting_approval", health: "degraded", activeAgentIds: ["agent_a", "agent_b"] },
      { mode: "waiting_approval", approvalId: "appr_9", progress: 0.4, progressMode: "determinate", taskId: "task_1", currentAgentName: "Atlas" },
    );
    controller.applySnapshot(snap);
    const v = controller.getState().version;
    const s = controller.getState();
    expect(s.status.mode).toBe("waiting_approval");
    expect(s.layers.backgroundWork).toBe("working");
    expect(s.layers.approval.approvalId).toBe("appr_9");
    expect(s.layers.systemHealth.health).toBe("degraded");
    expect(s.status.activeAgentCount).toBe(2);
    expect(s.status.currentTaskId).toBe("task_1");
    controller.applySnapshot(snap);
    controller.bridge.onSnapshot(snap);
    expect(controller.getState().version).toBe(v);
  });

  it("a newer snapshot without work retires stale local task facts", () => {
    const { controller, bridge, advance } = setup();
    bridge.onTaskStarted({ taskId: "t1" });
    expect(mode(controller)).toBe("working");
    advance(2500);
    controller.applySnapshot(snapshot());
    expect(mode(controller)).toBe("idle");
  });
});

describe("work layer and texts", () => {
  it("server agent counts never create a work layer (server work idle + 4 agents stays idle)", () => {
    const { controller } = setup();
    controller.applySnapshot(snapshot({ work: "idle", activeAgentIds: ["agent_a", "agent_b", "agent_c", "agent_d"] }, { mode: "idle", activeAgentCount: 4 }));
    const s = controller.getState();
    expect(s.layers.backgroundWork).toBe("idle");
    expect(s.status.mode).toBe("idle");
    expect(s.status.activeAgentCount).toBe(4);
  });

  it("a server snapshot in booting mode shows booting until the server reports online", () => {
    const { controller } = setup();
    controller.applySnapshot(snapshot({}, { mode: "booting" }));
    expect(controller.getState().status.mode).toBe("booting");
    controller.applySnapshot(snapshot({}, { mode: "idle" }));
    expect(controller.getState().status.mode).toBe("idle");
  });

  it("speaking, transcribing and listening never show a stale server text", () => {
    const { controller, bridge } = setup();
    controller.applySnapshot(snapshot({}, { mode: "idle", activityText: "BEREIT" }));
    bridge.onTtsStarted();
    expect(controller.getState().status.activityText).toBe("ANTWORT WIRD GESPROCHEN");
    bridge.onTtsEnded();
    bridge.onTranscriptionStarted();
    expect(controller.getState().status.activityText).toBe("SPRACHE WIRD VERARBEITET");
    bridge.onTranscriptionCompleted();
    bridge.onMicrophoneOpened({ source: "browser" });
    expect(controller.getState().status.activityText).toBeUndefined();
    controller.setActivity("EIGEN");
    bridge.onTtsStarted();
    expect(controller.getState().status.activityText).toBe("EIGEN");
  });
});

describe("progress is never invented", () => {
  it("indeterminate until a real value arrives; null again falls back to indeterminate", () => {
    const { controller, bridge } = setup();
    bridge.onTaskStarted({ taskId: "t1" });
    let s = controller.getState().status;
    expect(s.progressMode).toBe("indeterminate");
    expect(s.progress).toBeNull();
    bridge.onTaskProgress(0.4);
    s = controller.getState().status;
    expect(s.progressMode).toBe("determinate");
    expect(s.progress).toBeCloseTo(0.4);
    bridge.onTaskProgress(null);
    s = controller.getState().status;
    expect(s.progressMode).toBe("indeterminate");
    expect(s.progress).toBeNull();
    bridge.onTaskCompleted({ taskId: "t1", success: true });
    expect(controller.getState().status.progressMode).toBe("none");
  });

  it("setProgress overrides explicitly", () => {
    const { controller } = setup();
    controller.setProgress(0.62);
    expect(controller.getState().status.progress).toBeCloseTo(0.62);
    controller.setProgress(null, "indeterminate");
    expect(controller.getState().status.progressMode).toBe("indeterminate");
  });
});

describe("override and reset", () => {
  it("setMode wins over every fact until reset()", () => {
    const { controller, bridge } = setup();
    bridge.onTtsStarted();
    controller.setMode("thinking");
    expect(mode(controller)).toBe("thinking");
    expect(controller.getState().overrideMode).toBe("thinking");
    controller.setMode("speaking");
    controller.setAgentCount(3);
    expect(controller.getState().layers.backgroundWork).toBe("working"); // speaking + 3 background agents
    controller.reset();
    expect(controller.getState().overrideMode).toBeNull();
    expect(mode(controller)).toBe("idle");
  });
});

describe("idempotency", () => {
  it("repeated or out-of-order bridge calls do not change the state", () => {
    const { controller, bridge } = setup();
    const v0 = controller.getState().version;
    bridge.onTtsEnded();
    bridge.onTranscriptionCompleted();
    bridge.onThinkingCompleted();
    bridge.onApprovalResolved("nope");
    bridge.onWarningCleared();
    bridge.onErrorCleared();
    bridge.onSyncFinished();
    bridge.onMicrophoneClosed();
    expect(controller.getState().version).toBe(v0);
    bridge.onMicrophoneOpened({ source: "browser" });
    const v1 = controller.getState().version;
    bridge.onMicrophoneOpened({ source: "browser" });
    bridge.onMicrophoneOpened({ source: "browser" });
    expect(controller.getState().version).toBe(v1);
    bridge.onApprovalRequired("a");
    const v2 = controller.getState().version;
    bridge.onApprovalRequired("a");
    expect(controller.getState().version).toBe(v2);
    expect(controller.getState().layers.approval.count).toBe(1);
    bridge.onApprovalResolved("a");
    expect(controller.getState().layers.approval.pending).toBe(false);
  });

  it("a disposed bridge ignores everything", () => {
    const { controller, bridge } = setup();
    bridge.dispose();
    bridge.onError("x");
    expect(mode(controller)).toBe("idle");
  });

  it("notifies subscribers once per real change and supports unsubscribe", () => {
    const { controller, bridge } = setup();
    const seen: OrbMode[] = [];
    const off = controller.subscribe((s) => seen.push(s.status.mode));
    bridge.onWarning("Quelle verzögert");
    bridge.onWarning("Quelle verzögert");
    bridge.onWarningCleared();
    expect(seen).toEqual(["warning", "idle"]);
    off();
    bridge.onError("x");
    expect(seen).toHaveLength(2);
  });
});

describe("warning and error", () => {
  it("warning keeps the orb alive and carries the message; error shows first, details in the detail text", () => {
    const { controller, bridge } = setup();
    bridge.onWarning("Kalender verzögert");
    let s = controller.getState();
    expect(s.status.mode).toBe("warning");
    expect(s.status.severity).toBe("warning");
    expect(s.status.activityText).toBe("Kalender verzögert");
    bridge.onError({ message: "Adapter nicht erreichbar", code: "adapter_unreachable", critical: true });
    s = controller.getState();
    expect(s.status.mode).toBe("error");
    expect(s.status.severity).toBe("critical");
    expect(s.status.detailText).toBe("Adapter nicht erreichbar");
    bridge.onErrorCleared();
    expect(mode(controller)).toBe("warning");
    bridge.onWarningCleared();
    expect(mode(controller)).toBe("idle");
  });

  it("a non-critical error is shown as warning", () => {
    const { controller, bridge } = setup();
    bridge.onError({ message: "Langsame Quelle", critical: false });
    expect(mode(controller)).toBe("warning");
  });
});

describe("audio frames", () => {
  it("scalar convenience levels become service-level frames per direction", () => {
    const { controller, inputs, advance } = setup();
    controller.setMode("listening");
    controller.setInputAudioLevel(0.8);
    for (let i = 0; i < 30; i++) advance(16);
    expect(inputs.input.source).toBe("service-level");
    expect(inputs.input.rms).toBeGreaterThan(0.6);
    expect(inputs.output.rms).toBe(0);
  });

  it("TTS without audio analysis uses the speech envelope fallback with pauses, and stops with the TTS", () => {
    const { bridge, inputs, advance } = setup();
    bridge.onTtsStarted({ hasAudioAnalysis: false });
    const levels: number[] = [];
    for (let i = 0; i < 400; i++) {
      advance(20);
      levels.push(inputs.output.rms);
    }
    expect(inputs.speechEnvelopeActive).toBe(true);
    expect(inputs.output.source).toBe("synthetic");
    expect(Math.max(...levels)).toBeGreaterThan(0.4);
    expect(levels.some((l) => l < 0.02)).toBe(true); // pauses are visible
    bridge.onTtsEnded();
    for (let i = 0; i < 30; i++) advance(20);
    expect(inputs.output.rms).toBeLessThan(0.02);
  });

  it("barge-in silences the envelope within 150 ms", () => {
    const { controller, bridge, inputs, advance } = setup();
    bridge.onTtsStarted({ hasAudioAnalysis: false });
    for (let i = 0; i < 100; i++) advance(20);
    bridge.onTtsEnded({ interrupted: true });
    for (let i = 0; i < 8; i++) advance(20);
    expect(inputs.output.rms).toBeLessThan(0.02);
    expect(mode(controller)).toBe("idle");
  });

  it("without an analyser the envelope starts when no service level arrives; service levels scale it instead of replacing it", () => {
    const { bridge, inputs, advance } = setup();
    bridge.onTtsStarted();
    for (let i = 0; i < 6; i++) {
      advance(60);
      bridge.onTtsAudioLevel(0.5);
    }
    expect(inputs.speechEnvelopeActive).toBe(false);
    expect(inputs.output.source).toBe("service-level");
    // the service goes quiet and stays quiet: after the freshness window the envelope takes over
    for (let i = 0; i < 40; i++) advance(60);
    expect(inputs.speechEnvelopeActive).toBe(true);
  });

  it("readFrame returns silence for a disposed controller and never throws on a failing source", () => {
    const { controller, inputs, advance } = setup();
    controller.setInputAudioSource({
      sample: () => {
        throw new Error("boom");
      },
      dispose: () => undefined,
    });
    expect(() => advance(16)).not.toThrow();
    expect(inputs.input.rms).toBe(0);
    controller.dispose();
    expect(() => controller.readFrame(5000, inputs)).not.toThrow();
  });

  it("frames stay owned by the caller (the same objects are refilled)", () => {
    const { controller } = setup();
    const inputs = createInputs();
    const a = inputs.input;
    controller.readFrame(2000, inputs);
    controller.readFrame(2016, inputs);
    expect(inputs.input).toBe(a);
    expect(createAudioFrame()).toEqual({ rms: 0, peak: 0, low: 0, mid: 0, high: 0, gateOpen: false, source: "none" });
  });
});
