// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrbSnapshot, OrbStatus } from "./contract-types";
import { JarvisOrb } from "./JarvisOrb";

const status = (extra: Partial<OrbStatus> = {}): OrbStatus => ({ mode: "idle", since: "2026-06-15T10:00:00Z", ...extra });

beforeEach(() => {
  // jsdom has no canvas; silence its "not implemented" notice so the fallback path stays quiet.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("<JarvisOrb> without WebGL (2D fallback path)", () => {
  it("renders German state labels and falls back to 2d", async () => {
    render(<JarvisOrb status={status()} settings={{ renderer: "2d" }} />);
    expect(await screen.findByTestId("orb-state-label")).toHaveTextContent("BEREIT");
    expect(document.querySelector("[data-orb-renderer]")?.getAttribute("data-orb-renderer")).toBe("2d");
    expect(screen.getByTestId("orb-fallback-2d")).toBeInTheDocument();
  });

  it("falls back to 2d when animations are off and when WebGL is unavailable", async () => {
    render(<JarvisOrb status={status({ mode: "working", activityText: "RECHERCHE LÄUFT" })} settings={{ animations: "off" }} />);
    expect(await screen.findByTestId("orb-fallback-2d")).toBeInTheDocument();
    expect(screen.getByTestId("orb-activity")).toHaveTextContent("RECHERCHE LÄUFT");
  });

  it("accepts a wire snapshot and shows parallel agents", async () => {
    const snapshot: OrbSnapshot = {
      status: status({ mode: "speaking", activityText: "3 AGENTEN AKTIV" }),
      layers: { voice: "speaking", work: "working", attention: "none", health: "online", activeAgentIds: ["a", "b", "c"] },
    };
    render(<JarvisOrb snapshot={snapshot} settings={{ renderer: "2d" }} />);
    expect(await screen.findByTestId("orb-state-label")).toHaveTextContent("JARVIS SPRICHT");
    expect(screen.getByTestId("orb-aria-live")).toHaveTextContent("Jarvis spricht. 3 AGENTEN AKTIV. Drei Agenten aktiv.");
  });

  it("Enter/click activates with the target of the current mode, Space toggles voice", () => {
    const onActivate = vi.fn();
    const onVoiceToggle = vi.fn();
    const { rerender } = render(<JarvisOrb status={status({ mode: "waiting_approval", approvalId: "appr_1" })} settings={{ renderer: "2d" }} onActivate={onActivate} onVoiceToggle={onVoiceToggle} />);
    const target = screen.getByRole("button");
    fireEvent.click(target);
    expect(onActivate).toHaveBeenLastCalledWith({ kind: "approval", approvalId: "appr_1" });
    fireEvent.keyDown(target, { key: " ", code: "Space" });
    expect(onVoiceToggle).toHaveBeenCalledTimes(1);

    rerender(<JarvisOrb status={status({ mode: "working", taskId: "task_9" })} settings={{ renderer: "2d" }} onActivate={onActivate} onVoiceToggle={onVoiceToggle} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onActivate).toHaveBeenLastCalledWith({ kind: "task", taskId: "task_9" });

    rerender(<JarvisOrb status={status({ mode: "error" })} settings={{ renderer: "2d" }} onActivate={onActivate} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onActivate).toHaveBeenLastCalledWith({ kind: "error" });
  });

  it("exposes a focusable button and a tooltip with state, action, runtime, agent, task and source", () => {
    render(
      <JarvisOrb
        status={status({ mode: "working", activityText: "RECHERCHE", currentAgentId: "agent_research", taskId: "task_1", sourceEventId: "evt_9" })}
        settings={{ renderer: "2d" }}
      />,
    );
    const button = screen.getByRole("button");
    fireEvent.focus(button);
    const tip = screen.getByRole("tooltip");
    for (const text of ["Zustand", "Aktion", "Laufzeit", "Agent", "Task-ID", "Quelle", "RECHERCHE", "agent_research", "task_1", "evt_9"]) {
      expect(tip).toHaveTextContent(text);
    }
    fireEvent.blur(button);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows a pause glyph label for paused and the approval label for approvals", () => {
    const { rerender } = render(<JarvisOrb status={status({ mode: "paused" })} settings={{ renderer: "2d" }} />);
    expect(screen.getByTestId("orb-state-label")).toHaveTextContent("PAUSIERT");
    rerender(<JarvisOrb status={status({ mode: "waiting_approval" })} settings={{ renderer: "2d" }} />);
    expect(screen.getByTestId("orb-state-label")).toHaveTextContent("FREIGABE ERFORDERLICH");
  });
});
