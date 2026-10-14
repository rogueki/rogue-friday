import { describe, expect, it } from "vitest";
import { ORB_LABELS_EN, activationTarget, buildAriaSentence, formatRuntime } from "./labels";

const base = { since: "2026-06-15T10:00:00Z" };

describe("buildAriaSentence", () => {
  it("matches the PLAN section 21 example", () => {
    const s = buildAriaSentence(
      { mode: "working", activityText: "Wettbewerbsanalyse", progress: 0.62, progressMode: "determinate", activeAgentCount: 3, ...base },
      undefined,
    );
    expect(s).toBe("Jarvis arbeitet. Aufgabe Wettbewerbsanalyse. Drei Agenten aktiv. Fortschritt 62 Prozent.");
  });

  it("never announces progress for indeterminate work", () => {
    const s = buildAriaSentence({ mode: "working", progressMode: "indeterminate", ...base }, undefined);
    expect(s).toBe("Jarvis arbeitet.");
  });

  it("supports english labels and percent progress", () => {
    const s = buildAriaSentence({ mode: "working", progress: 62, progressMode: "determinate", activeAgentCount: 1, ...base }, undefined, ORB_LABELS_EN);
    expect(s).toBe("Jarvis is working. 1 agent active. Progress 62 percent.");
  });

  it("describes idle and error", () => {
    expect(buildAriaSentence({ mode: "idle", ...base }, undefined)).toBe("Jarvis ist bereit.");
    expect(buildAriaSentence({ mode: "error", activityText: "Adapter nicht erreichbar", ...base }, undefined)).toBe("Fehler aufgetreten. Adapter nicht erreichbar.");
  });
});

describe("activationTarget (PLAN section 21)", () => {
  it("routes by mode", () => {
    expect(activationTarget({ mode: "waiting_approval", approvalId: "appr_1", ...base })).toEqual({ kind: "approval", approvalId: "appr_1" });
    expect(activationTarget({ mode: "error", ...base })).toEqual({ kind: "error" });
    expect(activationTarget({ mode: "working", taskId: "task_1", ...base })).toEqual({ kind: "task", taskId: "task_1" });
    expect(activationTarget({ mode: "working", ...base })).toEqual({ kind: "activity" });
    expect(activationTarget({ mode: "idle", ...base })).toEqual({ kind: "command" });
    expect(activationTarget({ mode: "listening", ...base })).toEqual({ kind: "activity" });
  });
});

describe("formatRuntime", () => {
  it("formats seconds, minutes and hours", () => {
    const t0 = Date.parse("2026-06-15T10:00:00Z");
    expect(formatRuntime("2026-06-15T10:00:00Z", t0 + 12_000)).toBe("12s");
    expect(formatRuntime("2026-06-15T10:00:00Z", t0 + 134_000)).toBe("2m 14s");
    expect(formatRuntime("2026-06-15T10:00:00Z", t0 + 3_900_000)).toBe("1h 5m");
    expect(formatRuntime("garbage")).toBe("");
  });
});
