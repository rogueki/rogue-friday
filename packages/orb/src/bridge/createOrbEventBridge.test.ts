import { describe, expect, it } from "vitest";
import { createInputs } from "../audio/frame";
import { createOrbController } from "../controller/createOrbController";
import type { OrbController, OrbMode } from "../controller/types";
import { createOrbEventBridge } from "./createOrbEventBridge";
import type { OrbEventBridge } from "./OrbEventBridge";

function fresh() {
  let t = 5000;
  const controller = createOrbController({ now: () => t, epochNow: () => 1_700_000_000_000 + t, seed: 1 });
  return { controller, bridge: createOrbEventBridge(controller), tick: (ms: number) => ((t += ms), controller.readFrame(t, createInputs())) };
}

interface Row {
  name: string;
  call: (b: OrbEventBridge, c: OrbController) => void;
  mode: OrbMode;
  check?: (c: OrbController) => void;
}

const rows: Row[] = [
  { name: "onMicrophoneOpened (browser)", call: (b) => b.onMicrophoneOpened({ source: "browser" }), mode: "listening" },
  { name: "onMicrophoneOpened (service, active)", call: (b) => b.onMicrophoneOpened({ source: "service", passive: false }), mode: "listening" },
  { name: "onMicrophoneOpened (passive wake word)", call: (b) => b.onMicrophoneOpened({ source: "service", passive: true }), mode: "idle" },
  { name: "onTranscriptionStarted", call: (b) => b.onTranscriptionStarted(), mode: "transcribing" },
  { name: "onThinkingStarted", call: (b) => b.onThinkingStarted("Kalender prüfen"), mode: "thinking", check: (c) => expect(c.getState().status.activityText).toBe("Kalender prüfen") },
  {
    name: "onTaskStarted",
    call: (b) => b.onTaskStarted({ taskId: "task_1", title: "Recherche", agentName: "Atlas", progress: 0.25 }),
    mode: "working",
    check: (c) => {
      const s = c.getState().status;
      expect(s.currentTaskId).toBe("task_1");
      expect(s.currentAgentName).toBe("Atlas");
      expect(s.progress).toBeCloseTo(0.25);
      expect(s.progressMode).toBe("determinate");
    },
  },
  { name: "onTtsStarted", call: (b) => b.onTtsStarted({ utteranceId: "utt_1", engine: "elevenlabs", hasAudioAnalysis: true }), mode: "speaking" },
  { name: "onApprovalRequired", call: (b) => b.onApprovalRequired("appr_7"), mode: "waiting_approval", check: (c) => expect(c.getState().layers.approval.approvalId).toBe("appr_7") },
  { name: "onWarning", call: (b) => b.onWarning("Quelle verzögert"), mode: "warning", check: (c) => expect(c.getState().status.detailText).toBe("Quelle verzögert") },
  { name: "onError (Error object)", call: (b) => b.onError(new Error("Adapter down")), mode: "error", check: (c) => expect(c.getState().status.detailText).toBe("Adapter down") },
  { name: "onError (info)", call: (b) => b.onError({ message: "x", code: "e_1", critical: true }), mode: "error" },
  { name: "onSyncStarted", call: (b) => b.onSyncStarted("memory"), mode: "syncing", check: (c) => expect(c.getState().status.activityText).toBe("MEMORY WIRD SYNCHRONISIERT") },
  { name: "onAgentActivity", call: (b) => b.onAgentActivity(3, ["A", "B", "C"]), mode: "working", check: (c) => expect(c.getState().status.activeAgentCount).toBe(3) },
  { name: "onOffline", call: (b) => b.onOffline(), mode: "offline" },
  { name: "onPaused", call: (b) => b.onPaused(), mode: "paused" },
];

describe("OrbEventBridge: every call lands in the expected layer / mode / text", () => {
  for (const row of rows) {
    it(row.name, () => {
      const { controller, bridge } = fresh();
      row.call(bridge, controller);
      expect(controller.getState().status.mode).toBe(row.mode);
      row.check?.(controller);
    });
  }

  it("is the controller's own bridge (exchangeable interface, no hidden state)", () => {
    const { controller, bridge } = fresh();
    expect(bridge).toBe(controller.bridge);
  });

  it("completion calls undo their start calls", () => {
    const { controller, bridge, tick } = fresh();
    const pairs: Array<[(b: OrbEventBridge) => void, (b: OrbEventBridge) => void]> = [
      [(b) => b.onMicrophoneOpened({ source: "browser" }), (b) => b.onMicrophoneClosed()],
      [(b) => b.onTranscriptionStarted(), (b) => b.onTranscriptionCompleted()],
      [(b) => b.onThinkingStarted(), (b) => b.onThinkingCompleted()],
      [(b) => b.onTtsStarted(), (b) => b.onTtsEnded()],
      [(b) => b.onApprovalRequired("a"), (b) => b.onApprovalResolved("a")],
      [(b) => b.onWarning("w"), (b) => b.onWarningCleared()],
      [(b) => b.onError("e"), (b) => b.onErrorCleared()],
      [(b) => b.onSyncStarted("mail"), (b) => b.onSyncFinished()],
      [(b) => b.onOffline(), (b) => b.onOnline()],
      [(b) => b.onPaused(), (b) => b.onResumed()],
    ];
    for (const [start, end] of pairs) {
      start(bridge);
      expect(controller.getState().status.mode).not.toBe("idle");
      end(bridge);
      tick(2000);
      expect(controller.getState().status.mode).toBe("idle");
    }
  });

  it("banded levels reach the frames; a bare scalar is flagged as derived bands", () => {
    const { controller, bridge, tick } = fresh();
    const inputs = createInputs();
    bridge.onMicrophoneOpened({ source: "service" });
    bridge.onVoiceActivity({ level: 0.5, peak: 0.8, low: 0.9, mid: 0.4, high: 0.1 });
    for (let i = 0; i < 30; i++) {
      tick(16);
      controller.readFrame(5000 + 16 * i, inputs);
    }
    controller.readFrame(6000, inputs);
    expect(inputs.input.source).toBe("service-level");
    expect(inputs.input.bandsDerived).toBe(false);
    bridge.onVoiceActivity(0.4);
    controller.readFrame(6016, inputs);
    expect(inputs.input.bandsDerived).toBe(true);
  });

  it("direction separation: input levels never move the output frame and vice versa", () => {
    const { controller, bridge } = fresh();
    const inputs = createInputs();
    bridge.onVoiceActivity(0.9);
    for (let t = 5016; t < 5500; t += 16) controller.readFrame(t, inputs);
    expect(inputs.input.rms).toBeGreaterThan(0.5);
    expect(inputs.output.rms).toBe(0);
    bridge.onTtsAudioLevel(0.7);
    for (let t = 5500; t < 5800; t += 16) controller.readFrame(t, inputs);
    expect(inputs.output.rms).toBeGreaterThan(0.3);
  });

  it("onSnapshot feeds the server truth", () => {
    const { controller, bridge } = fresh();
    bridge.onSnapshot({
      status: { mode: "waiting_approval", since: "2026-10-17T10:00:00.000Z", approvalId: "appr_1" },
      layers: { voice: "idle", work: "idle", attention: "waiting_approval", health: "online", activeAgentIds: [] },
    });
    expect(controller.getState().status.mode).toBe("waiting_approval");
    expect(controller.getState().layers.approval.approvalId).toBe("appr_1");
  });
});
