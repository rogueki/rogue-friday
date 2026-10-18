import type { FridayEvent, VoiceStatus } from "@friday/sdk";
import { describe, expect, it, vi } from "vitest";
import type { OrbEventBridge } from "../orbApi";
import { TASK_ERROR_HOLD_MS, createOrbRealtimeRouter, isMicrophonePassive } from "./routeRealtimeToOrb";

type Call = [string, ...unknown[]];

function setup(options: { browser?: boolean; approvals?: string[] } = {}) {
  const calls: Call[] = [];
  const bridge = new Proxy({} as OrbEventBridge, {
    get: (_target, name) => (...args: unknown[]) => { calls.push([String(name), ...args]); },
  });
  const audioCalls: Call[] = [];
  const audio = new Proxy({} as Parameters<typeof createOrbRealtimeRouter>[0]["audio"], {
    get: (_target, name) => (...args: unknown[]) => { audioCalls.push([String(name), ...args]); },
  });
  const timers: { callback: () => void; ms: number; id: number }[] = [];
  const state = { browser: options.browser ?? false, approvals: options.approvals ?? [] };
  const router = createOrbRealtimeRouter({
    bridge,
    audio,
    browserVoiceActive: () => state.browser,
    pendingApprovalIds: () => state.approvals,
    setTimer: (callback, ms) => {
      timers.push({ callback, ms, id: timers.length });
      return timers.length - 1;
    },
    clearTimer: (handle) => {
      const index = handle as number;
      if (timers[index]) timers[index] = { ...timers[index]!, callback: () => undefined };
    },
  });
  return { router, calls, audioCalls, timers, state };
}

const event = (type: string, data: unknown): FridayEvent => ({ type, data }) as unknown as FridayEvent;
const names = (calls: Call[]): string[] => calls.map(([name]) => name);

function voice(overrides: Record<string, unknown> = {}): VoiceStatus {
  return {
    mode: "idle",
    microphone: { state: "idle", active: true, deviceId: null, inputLevel: 0 },
    wakeWord: { enabled: true, state: "armed", phrase: "x" },
    tts: { engine: "e", state: "ready", latencyMs: null },
    ...overrides,
  } as unknown as VoiceStatus;
}
const task = (overrides: Record<string, unknown> = {}) => ({ id: "t1", title: "Recherche", status: "running", agentName: "Atlas", progress: { mode: "indeterminate", value: null }, ...overrides });

describe("orb snapshot", () => {
  it("passes friday.orb.status_changed to the bridge", () => {
    const { router, calls } = setup();
    const snapshot = { status: { mode: "working" }, layers: {} };
    router.route(event("friday.orb.status_changed", snapshot));
    expect(calls).toEqual([["onSnapshot", snapshot]]);
  });
});

describe("voice state", () => {
  it("armed wake word is a passive microphone, listening is an active one, off closes it", () => {
    const { router, calls } = setup();
    router.route(event("friday.voice.state_changed", voice()));
    router.route(event("friday.voice.state_changed", voice()));
    router.route(event("friday.voice.state_changed", voice({ mode: "listening", microphone: { state: "listening", active: true, deviceId: null, inputLevel: 0.2 } })));
    router.route(event("friday.voice.state_changed", voice({ microphone: { state: "off", active: false, deviceId: null, inputLevel: 0 } })));
    expect(calls).toEqual([
      ["onMicrophoneOpened", { source: "service", passive: true }],
      ["onMicrophoneOpened", { source: "service", passive: false }],
      ["onMicrophoneClosed"],
    ]);
  });

  it("maps transcribing and thinking to started/completed pairs", () => {
    const { router, calls } = setup();
    const quiet = { microphone: { state: "idle", active: false, deviceId: null, inputLevel: 0 } };
    router.route(event("friday.voice.state_changed", voice({ ...quiet, mode: "transcribing" })));
    router.route(event("friday.voice.state_changed", voice({ ...quiet, mode: "thinking" })));
    router.route(event("friday.voice.state_changed", voice({ ...quiet, mode: "idle" })));
    expect(names(calls).filter((name) => /Transcription|Thinking/.test(name))).toEqual([
      "onTranscriptionStarted",
      "onTranscriptionCompleted",
      "onThinkingStarted",
      "onThinkingCompleted",
    ]);
  });

  it("a voice error is held while the mode is error and cleared afterwards", () => {
    const { router, calls } = setup();
    router.route(event("friday.voice.state_changed", voice({ mode: "error" })));
    router.route(event("friday.voice.state_changed", voice({ mode: "error" })));
    router.route(event("friday.voice.state_changed", voice({ mode: "idle" })));
    expect(names(calls).filter((name) => /Error/.test(name))).toEqual(["onError", "onErrorCleared"]);
  });

  it("a service that only reports speaking still drives tts start and end", () => {
    const { router, calls, audioCalls } = setup();
    router.route(event("friday.voice.state_changed", voice({ mode: "speaking" })));
    router.route(event("friday.voice.state_changed", voice({ mode: "idle" })));
    expect(names(calls).filter((name) => /Tts/.test(name))).toEqual(["onTtsStarted", "onTtsEnded"]);
    expect(names(audioCalls)).toEqual(["beginSpeech", "endSpeech"]);
  });

  it("the browser voice path keeps the microphone open and only refines passive vs. active", () => {
    const { router, calls } = setup({ browser: true });
    router.route(event("friday.voice.state_changed", voice({ microphone: { state: "off", active: false, deviceId: null, inputLevel: 0 } })));
    router.route(event("friday.voice.state_changed", voice({ mode: "listening" })));
    expect(calls).toEqual([
      ["onMicrophoneOpened", { source: "browser", passive: true }],
      ["onMicrophoneOpened", { source: "browser", passive: false }],
    ]);
  });
});

describe("isMicrophonePassive", () => {
  it("is passive only while the wake word is armed and nothing was said", () => {
    expect(isMicrophonePassive(undefined)).toBe(false);
    expect(isMicrophonePassive(voice())).toBe(true);
    expect(isMicrophonePassive(voice({ mode: "listening" }))).toBe(false);
    expect(isMicrophonePassive(voice({ wakeWord: { enabled: true, state: "triggered", phrase: "x" } }))).toBe(false);
    expect(isMicrophonePassive(voice({ wakeWord: { enabled: false, state: "disabled", phrase: "x" } }))).toBe(false);
  });
});

describe("audio levels", () => {
  it("routes service levels with optional bands to the audio sources and the bridge", () => {
    const { router, calls, audioCalls } = setup();
    router.route(event("friday.voice.audio_level", { direction: "input", level: 0.4, low: 0.5, mid: 0.3, high: 0.1, peak: 0.6, at: "t" }));
    expect(audioCalls).toEqual([["pushServiceInput", { level: 0.4, peak: 0.6, low: 0.5, mid: 0.3, high: 0.1 }]]);
    expect(calls).toEqual([["onVoiceActivity", { level: 0.4, peak: 0.6, low: 0.5, mid: 0.3, high: 0.1 }]]);
  });

  it("works with a scalar-only level (no bands)", () => {
    const { router, audioCalls } = setup();
    router.route(event("friday.voice.audio_level", { direction: "input", level: 0.25, at: "t" }));
    expect(audioCalls).toEqual([["pushServiceInput", { level: 0.25 }]]);
  });

  it("only reports output levels to the bridge while a tts utterance is active", () => {
    const { router, calls, audioCalls } = setup();
    router.route(event("friday.voice.audio_level", { direction: "output", level: 0.5, at: "t" }));
    router.route(event("friday.voice.tts_started", { utteranceId: "u", engine: "e" }));
    router.route(event("friday.voice.audio_level", { direction: "output", level: 0.6, at: "t" }));
    expect(audioCalls.filter(([name]) => name === "pushServiceOutput")).toHaveLength(2);
    expect(calls.filter(([name]) => name === "onTtsAudioLevel")).toEqual([["onTtsAudioLevel", { level: 0.6 }]]);
  });

  it("ignores service levels while the browser voice path provides the real signal", () => {
    const { router, calls, audioCalls } = setup({ browser: true });
    router.route(event("friday.voice.audio_level", { direction: "input", level: 0.9, at: "t" }));
    router.route(event("friday.voice.audio_level", { direction: "output", level: 0.9, at: "t" }));
    expect(calls).toEqual([]);
    expect(audioCalls).toEqual([]);
  });
});

describe("transcripts and tts", () => {
  it("partial transcript starts, final transcript completes; the text is never forwarded", () => {
    const { router, calls } = setup();
    router.route(event("friday.voice.transcript_partial", { utteranceId: "u", text: "Hallo Welt", final: false }));
    router.route(event("friday.voice.transcript_final", { utteranceId: "u", text: "Hallo Welt", final: true }));
    expect(calls).toEqual([["onTranscriptionStarted"], ["onTranscriptionCompleted"]]);
  });

  it("tts_started/tts_ended start the speech fallback and end it, barge-in is reported as interrupted", () => {
    const { router, calls, audioCalls } = setup();
    router.route(event("friday.voice.tts_started", { utteranceId: "u1", engine: "eleven" }));
    router.route(event("friday.voice.tts_ended", { utteranceId: "u1", durationMs: 800, interrupted: true }));
    router.route(event("friday.voice.tts_ended", { utteranceId: "u1", durationMs: 800, interrupted: false })); // duplicate -> no-op
    expect(calls).toEqual([
      ["onTtsStarted", { utteranceId: "u1", engine: "eleven", hasAudioAnalysis: false }],
      ["onTtsEnded", { interrupted: true }],
    ]);
    expect(audioCalls).toEqual([["beginSpeech", { hasAudioAnalysis: false }], ["endSpeech", true]]);
  });

  it("the browser path owns tts start and end", () => {
    const { router, calls } = setup({ browser: true });
    router.route(event("friday.voice.tts_started", { utteranceId: "u1", engine: "e" }));
    router.route(event("friday.voice.tts_ended", { utteranceId: "u1", durationMs: 1, interrupted: false }));
    expect(calls).toEqual([]);
  });
});

describe("tasks", () => {
  it("running task starts working, progress is determinate only when known, completion flashes success", () => {
    const { router, calls } = setup();
    router.route(event("friday.task.created", task()));
    router.route(event("friday.task.progress", { taskId: "t1", progress: { mode: "determinate", value: 0.4 } }));
    router.route(event("friday.task.progress", { taskId: "t1", progress: { mode: "indeterminate", value: null } }));
    router.route(event("friday.task.completed", task({ status: "done" })));
    expect(calls).toEqual([
      ["onTaskStarted", { taskId: "t1", title: "Recherche", agentName: "Atlas", progress: null }],
      ["onTaskProgress", 0.4],
      ["onTaskProgress", null],
      ["onTaskCompleted", { taskId: "t1", success: true }],
    ]);
  });

  it("an update of a known task becomes progress, tasks that are not running are ignored", () => {
    const { router, calls } = setup();
    router.route(event("friday.task.created", task({ status: "todo" })));
    router.route(event("friday.task.updated", task({ progress: { mode: "determinate", value: 0.2 } }))); // chatter for an unseen task: server truth
    router.route(event("friday.task.progress", { taskId: "t1", progress: { mode: "determinate", value: 0.3 } }));
    expect(calls).toEqual([]);
    router.route(event("friday.task.created", task({ progress: { mode: "determinate", value: 0.2 } })));
    router.route(event("friday.task.updated", task({ progress: { mode: "determinate", value: 0.5 } })));
    expect(calls).toEqual([
      ["onTaskStarted", { taskId: "t1", title: "Recherche", agentName: "Atlas", progress: 0.2 }],
      ["onTaskProgress", 0.5],
    ]);
  });

  it("a failed task ends the work, shows an error and lets go after the hold time", () => {
    const { router, calls, timers } = setup();
    router.route(event("friday.task.created", task()));
    router.route(event("friday.task.failed", task({ status: "failed" })));
    expect(names(calls)).toEqual(["onTaskStarted", "onTaskCompleted", "onError"]);
    expect(calls[1]).toEqual(["onTaskCompleted", { taskId: "t1", success: false }]);
    expect(timers).toHaveLength(1);
    expect(timers[0]!.ms).toBe(TASK_ERROR_HOLD_MS);
    timers[0]!.callback();
    expect(names(calls).at(-1)).toBe("onErrorCleared");
  });

  it("a cancelled task is not a success", () => {
    const { router, calls } = setup();
    router.route(event("friday.task.cancelled", task({ status: "cancelled" })));
    expect(calls).toEqual([["onTaskCompleted", { taskId: "t1", success: false }]]);
  });
});

describe("agents and approvals", () => {
  it("leaves agent counts to the server snapshot (no local agent fact from heartbeats)", () => {
    const { router, calls } = setup();
    router.route(event("friday.agent.status_changed", { id: "a" }));
    router.route(event("friday.agent.heartbeat", { agentId: "b" }));
    expect(calls).toEqual([]);
  });

  it("requested -> required; resolved -> resolved and the next pending approval stays visible", () => {
    const { router, calls, state } = setup();
    router.route(event("friday.approval.requested", { id: "ap1", status: "pending" }));
    router.route(event("friday.approval.requested", { id: "ap2", status: "pending" }));
    state.approvals = ["ap2"];
    router.route(event("friday.approval.resolved", { id: "ap1", status: "approved" }));
    state.approvals = [];
    router.route(event("friday.approval.expired", { id: "ap2", status: "expired" }));
    expect(calls).toEqual([
      ["onApprovalRequired", "ap1"],
      ["onApprovalRequired", "ap2"],
      ["onApprovalResolved", "ap1"],
      ["onApprovalRequired", "ap2"],
      ["onApprovalResolved", "ap2"],
    ]);
  });
});

describe("errors, warnings and connection", () => {
  const notification = (id: string, priority: string, status = "open") => event("friday.notification.created", { id, priority, status, title: `T-${id}`, category: "system" });

  it("P0 is a critical error until it is resolved, P1 a warning", () => {
    const { router, calls } = setup();
    router.route(notification("n1", "P0"));
    router.route(notification("n2", "P1"));
    router.route(event("friday.notification.updated", { id: "n2", priority: "P1", status: "resolved", title: "T-n2", category: "system" }));
    router.route(event("friday.notification.updated", { id: "n1", priority: "P0", status: "acknowledged", title: "T-n1", category: "system" }));
    expect(calls).toEqual([
      ["onError", { message: "T-n1", code: "notification_system", critical: true }],
      ["onWarning", "T-n2"],
      ["onWarningCleared"],
      ["onErrorCleared"],
    ]);
  });

  it("two errors need both to be gone before the error is cleared", () => {
    const { router, calls } = setup();
    router.route(notification("n1", "P0"));
    router.route(notification("n2", "P0"));
    router.route(event("friday.notification.updated", { id: "n1", priority: "P0", status: "resolved", title: "", category: "system" }));
    expect(names(calls)).toEqual(["onError", "onError"]);
    router.route(event("friday.notification.updated", { id: "n2", priority: "P0", status: "resolved", title: "", category: "system" }));
    expect(names(calls)).toEqual(["onError", "onError", "onErrorCleared"]);
  });

  it("degraded adapters warn, recovering clears", () => {
    const { router, calls } = setup();
    router.route(event("friday.adapter.health_changed", { adapterId: "mail", status: "degraded" }));
    router.route(event("friday.adapter.health_changed", { adapterId: "mail", status: "online" }));
    expect(calls).toEqual([["onWarning", "Adapter mail eingeschränkt"], ["onWarningCleared"]]);
  });

  it("offline and back online are reported once per transition", () => {
    const { router, calls } = setup();
    router.setConnection("connecting");
    router.setConnection("offline");
    router.setConnection("offline");
    router.setConnection("polling");
    router.setConnection("online");
    expect(calls).toEqual([["onOffline"], ["onOnline"]]);
  });

  it("resync drops transient audio, ends an active utterance and closes a service microphone", () => {
    const { router, calls, audioCalls } = setup();
    router.route(event("friday.voice.state_changed", voice({ mode: "speaking" })));
    calls.length = 0;
    audioCalls.length = 0;
    router.resync();
    expect(names(audioCalls)).toEqual(["reset", "endSpeech"]);
    expect(names(calls)).toEqual(["onTtsEnded", "onMicrophoneClosed"]);
  });

  it("unknown event types are ignored", () => {
    const { router, calls } = setup();
    const spy = vi.fn();
    expect(() => router.route(event("friday.calendar.event_updated", { id: "x" }))).not.toThrow();
    expect(calls).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});
