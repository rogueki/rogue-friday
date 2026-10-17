import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { clearOrbStatus, publishOrbStatus, useOrbControllerStatus } from "./orbHub";

afterEach(() => act(() => clearOrbStatus()));

describe("orb controller status for the HTML around the orb", () => {
  it("is null until the runtime publishes, then follows it and returns to null on clear", () => {
    const { result } = renderHook(() => useOrbControllerStatus());
    expect(result.current).toBeNull();
    act(() => publishOrbStatus({ mode: "listening", progress: null, progressMode: "none", activeAgentCount: 0 }));
    expect(result.current?.mode).toBe("listening");
    act(() => publishOrbStatus({ mode: "working", progress: 0.4, progressMode: "determinate", activeAgentCount: 2, activityText: "Recherche läuft" }));
    expect(result.current).toMatchObject({ mode: "working", progress: 0.4, activeAgentCount: 2 });
    act(() => clearOrbStatus());
    expect(result.current).toBeNull();
  });

  it("does not notify when nothing changed (no re-render at controller rate)", () => {
    let renders = 0;
    renderHook(() => {
      renders += 1;
      return useOrbControllerStatus();
    });
    const summary = { mode: "idle" as const, progress: null, progressMode: "none" as const, activeAgentCount: 0 };
    act(() => publishOrbStatus(summary));
    const afterFirst = renders;
    act(() => publishOrbStatus({ ...summary }));
    act(() => publishOrbStatus({ ...summary }));
    expect(renders).toBe(afterFirst);
  });
});
