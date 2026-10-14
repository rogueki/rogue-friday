import { describe, expect, it } from "vitest";
import { ORB_LABELS_DE, ORB_LABELS_EN, activationTarget, createOrbLabels, resolveLabels, buildAriaSentence, formatRuntime } from "./labels";

const base = { since: "2026-06-15T10:00:00Z" };

describe("buildAriaSentence", () => {
  it("matches the PLAN section 21 example", () => {
    const s = buildAriaSentence(
      { mode: "working", activityText: "Wettbewerbsanalyse", progress: 0.62, progressMode: "determinate", activeAgentCount: 3, ...base },
      undefined,
    );
    expect(s).toBe("F.R.I.D.A.Y. arbeitet. Aufgabe Wettbewerbsanalyse. Drei Agenten aktiv. Fortschritt 62 Prozent.");
  });

  it("never announces progress for indeterminate work", () => {
    const s = buildAriaSentence({ mode: "working", progressMode: "indeterminate", ...base }, undefined);
    expect(s).toBe("F.R.I.D.A.Y. arbeitet.");
  });

  it("supports english labels and percent progress", () => {
    const s = buildAriaSentence({ mode: "working", progress: 62, progressMode: "determinate", activeAgentCount: 1, ...base }, undefined, ORB_LABELS_EN);
    expect(s).toBe("F.R.I.D.A.Y. is working. 1 agent active. Progress 62 percent.");
  });

  it("describes idle and error", () => {
    expect(buildAriaSentence({ mode: "idle", ...base }, undefined)).toBe("F.R.I.D.A.Y. ist bereit.");
    expect(buildAriaSentence({ mode: "error", activityText: "Adapter nicht erreichbar", ...base }, undefined)).toBe("Fehler aufgetreten. Adapter nicht erreichbar.");
  });
});

describe("assistant name", () => {
  it("defaults to F.R.I.D.A.Y. in state labels", () => {
    expect(ORB_LABELS_DE.states.booting).toBe("F.R.I.D.A.Y. WIRD INITIALISIERT");
    expect(ORB_LABELS_DE.states.speaking).toBe("F.R.I.D.A.Y. SPRICHT");
    expect(ORB_LABELS_EN.states.speaking).toBe("F.R.I.D.A.Y. SPEAKING");
  });

  it("interpolates a configured name into labels and aria sentences", () => {
    const labels = createOrbLabels({ assistantName: "Nova", locale: "de" });
    expect(labels.states.speaking).toBe("NOVA SPRICHT");
    expect(buildAriaSentence({ mode: "idle", ...base }, undefined, labels)).toBe("Nova ist bereit.");
    expect(createOrbLabels({ assistantName: "  ", locale: "en" }).aria.modes.idle).toBe("F.R.I.D.A.Y. is ready.");
  });

  it("resolveLabels keeps overrides on top of the named defaults", () => {
    const labels = resolveLabels({ hitTarget: "X" }, { assistantName: "Nova" });
    expect(labels.hitTarget).toBe("X");
    expect(labels.states.booting).toBe("NOVA WIRD INITIALISIERT");
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
